use crate::db;
use crate::pipeline_engine::{Pipeline, PipelineNode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NodeStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeResult {
    pub node_id: String,
    pub status: NodeStatus,
    pub exit_code: Option<i32>,
    pub output: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub attempt: u32,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunState {
    pub run_id: String,
    pub pipeline_name: String,
    pub status: String,
    pub node_results: HashMap<String, NodeResult>,
    pub current_node: Option<String>,
    pub total_cost_usd: f64,
}

pub struct ActiveRun {
    pub state: RunState,
    pub cancelled: bool,
    pub approval_tx: Option<tokio::sync::oneshot::Sender<bool>>,
}

pub type ActiveRunHandle = Arc<Mutex<Option<ActiveRun>>>;

pub struct ExecutorState {
    pub active_run: ActiveRunHandle,
}

impl ExecutorState {
    pub fn new() -> Self {
        Self {
            active_run: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Debug, Deserialize)]
struct McpConfig {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: HashMap<String, serde_json::Value>,
}

fn read_available_mcp_tools(project_path: &str) -> HashSet<String> {
    let mut tools = HashSet::new();

    // Read global ~/.claude/mcp.json
    if let Ok(home) = std::env::var("HOME") {
        let global_path = std::path::Path::new(&home).join(".claude").join("mcp.json");
        if let Ok(content) = std::fs::read_to_string(&global_path) {
            if let Ok(config) = serde_json::from_str::<McpConfig>(&content) {
                tools.extend(config.mcp_servers.keys().cloned());
            }
        }
    }

    // Read project-level .mcp.json
    let project_mcp = std::path::Path::new(project_path).join(".mcp.json");
    if let Ok(content) = std::fs::read_to_string(&project_mcp) {
        if let Ok(config) = serde_json::from_str::<McpConfig>(&content) {
            tools.extend(config.mcp_servers.keys().cloned());
        }
    }

    tools
}

fn validate_sub_pipeline_refs(pipeline: &Pipeline) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for node in &pipeline.nodes {
        if node.node_type == "sub-pipeline" {
            match &node.pipeline_ref {
                None => {
                    errors.push(format!(
                        "  Node \"{}\": no pipeline selected",
                        node.name
                    ));
                }
                Some(r) if r.is_empty() => {
                    errors.push(format!(
                        "  Node \"{}\": no pipeline selected",
                        node.name
                    ));
                }
                _ => {}
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Unconfigured sub-pipeline nodes:\n{}",
            errors.join("\n")
        ))
    }
}

fn validate_required_tools(pipeline: &Pipeline, project_path: &str) -> Result<(), String> {
    // Collect all requires_tools from ai-task nodes only
    let requirements: Vec<(&str, &str)> = pipeline
        .nodes
        .iter()
        .filter(|n| n.node_type == "ai-task" && !n.requires_tools.is_empty())
        .flat_map(|n| {
            n.requires_tools
                .iter()
                .map(move |t| (n.name.as_str(), t.as_str()))
        })
        .collect();

    // Short-circuit if no requirements exist (no file reads)
    if requirements.is_empty() {
        return Ok(());
    }

    let available = read_available_mcp_tools(project_path);

    let mut missing: Vec<String> = Vec::new();
    for (node_name, tool) in &requirements {
        if !available.contains(*tool) {
            missing.push(format!("  Node \"{}\": missing [{}]", node_name, tool));
        }
    }

    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Missing MCP tools detected. Pipeline cannot run until these are configured:\n{}",
            missing.join("\n")
        ))
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn emit_run_update(app: &AppHandle, state: &RunState) {
    let _ = app.emit("run-update", state.clone());
}

fn emit_node_log(app: &AppHandle, run_id: &str, node_id: &str, line: &str) {
    let _ = app.emit(
        "node-log",
        serde_json::json!({ "run_id": run_id, "node_id": node_id, "line": line }),
    );
}

fn hash_instructions(instructions: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(instructions.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hash_pipeline(pipeline: &Pipeline) -> String {
    let mut hasher = Sha256::new();
    let mut sorted: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
    for node in &pipeline.nodes {
        sorted.insert(&node.id, &node.instructions);
    }
    for (id, instr) in &sorted {
        hasher.update(id.as_bytes());
        hasher.update(instr.as_bytes());
    }
    for edge in &pipeline.edges {
        hasher.update(edge.from.as_bytes());
        hasher.update(edge.to.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn parse_cost_from_stderr(lines: &[String]) -> Option<f64> {
    for line in lines.iter().rev() {
        // Match patterns like "Total cost: $0.0042" or "Cost: $1.23"
        if let Some(rest) = line.strip_prefix("Total cost: $") {
            if let Ok(cost) = rest.trim().parse::<f64>() {
                return Some(cost);
            }
        }
        // Also check for total_cost_usd in JSON-like output
        if line.contains("total_cost_usd") {
            if let Some(start) = line.find("total_cost_usd") {
                let after = &line[start..];
                // Extract number after colon
                if let Some(colon_pos) = after.find(':') {
                    let num_str = after[colon_pos + 1..]
                        .trim()
                        .trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
                    if let Ok(cost) = num_str.parse::<f64>() {
                        return Some(cost);
                    }
                }
            }
        }
    }
    None
}

/// Execute a shell or Claude CLI command, returning status, exit code, and cost (for Claude nodes).
#[allow(clippy::too_many_arguments)]
async fn execute_shell_or_claude(
    app: &AppHandle,
    run_id: &str,
    node_id: &str,
    is_claude: bool,
    instructions: &str,
    cli_path: &str,
    cwd: &str,
    timeout_secs: Option<u64>,
    agent: Option<&str>,
) -> (NodeStatus, Option<i32>, Option<f64>) {
    let mut cmd = if is_claude {
        let mut c = Command::new(cli_path);
        if let Some(agent_name) = agent {
            c.arg("--agent").arg(agent_name);
        }
        c.arg("--print").arg(instructions).current_dir(cwd);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c").arg(instructions).current_dir(cwd);
        c
    };

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Node {} spawn error: {}", node_id, e);
            emit_node_log(app, run_id, node_id, &format!("Spawn error: {}", e));
            return (NodeStatus::Failed, None, None);
        }
    };

    // Stream stdout line-by-line
    if let Some(stdout) = child.stdout.take() {
        let a = app.clone();
        let r = run_id.to_string();
        let n = node_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_node_log(&a, &r, &n, &line);
            }
        });
    }

    // Stream stderr line-by-line AND buffer for cost extraction
    let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    if let Some(stderr) = child.stderr.take() {
        let a = app.clone();
        let r = run_id.to_string();
        let n = node_id.to_string();
        let buf = stderr_buffer.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_node_log(&a, &r, &n, &format!("[stderr] {}", line));
                buf.lock().await.push(line);
            }
        });
    }

    let result = if let Some(secs) = timeout_secs {
        match tokio::time::timeout(std::time::Duration::from_secs(secs), child.wait()).await {
            Ok(r) => r,
            Err(_) => {
                let _ = child.kill().await;
                log::error!("Node {} timed out after {}s", node_id, secs);
                emit_node_log(app, run_id, node_id, &format!("Timeout after {}s", secs));
                return (NodeStatus::Failed, None, None);
            }
        }
    } else {
        child.wait().await
    };

    match result {
        Ok(exit) => {
            let code = exit.code().unwrap_or(-1);
            let status = if code == 0 {
                NodeStatus::Success
            } else {
                NodeStatus::Failed
            };
            // Extract cost from stderr for Claude nodes
            let cost = if is_claude {
                let buf = stderr_buffer.lock().await;
                parse_cost_from_stderr(&buf)
            } else {
                None
            };
            (status, Some(code), cost)
        }
        Err(e) => {
            log::error!("Node {} process error: {}", node_id, e);
            emit_node_log(app, run_id, node_id, &format!("Process error: {}", e));
            (NodeStatus::Failed, None, None)
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn execute_node(
    app: &AppHandle,
    node: &PipelineNode,
    run_id: &str,
    variables: &HashMap<String, String>,
    inputs: &HashMap<String, String>,
    cli_path: &str,
    project_path: &str,
    active_run: &ActiveRunHandle,
    pipeline_name: &str,
) -> NodeResult {
    let started_at = now_iso();

    // Check cancellation
    {
        let guard = active_run.lock().await;
        if let Some(run) = guard.as_ref() {
            if run.cancelled {
                return NodeResult {
                    node_id: node.id.clone(),
                    status: NodeStatus::Cancelled,
                    exit_code: None,
                    output: "Cancelled".into(),
                    started_at: Some(started_at),
                    finished_at: Some(now_iso()),
                    attempt: 1,
                    cost_usd: None,
                };
            }
        }
    }

    // Substitute variables
    let mut instructions = node.instructions.clone();
    for (k, v) in variables {
        instructions = instructions.replace(&format!("${}", k), v);
        instructions = instructions.replace(&format!("${{{}}}", k), v);
    }
    for (k, v) in inputs {
        instructions = instructions.replace(&format!("{{input.{}}}", k), v);
        instructions = instructions.replace(&format!("{{{}}}", k), v);
    }

    let max_attempts = node.retry.as_ref().map(|r| r.max).unwrap_or(1).max(1);
    let retry_delay = node.retry.as_ref().map(|r| r.delay).unwrap_or(0);

    for attempt in 1..=max_attempts {
        emit_node_log(
            app,
            run_id,
            &node.id,
            &format!("--- {} (attempt {}/{}) ---", node.name, attempt, max_attempts),
        );

        let (status, exit_code, cost_usd) = match node.node_type.as_str() {
            "shell" | "git" => {
                execute_shell_or_claude(
                    app,
                    run_id,
                    &node.id,
                    false,
                    &instructions,
                    cli_path,
                    project_path,
                    node.timeout,
                    None,
                )
                .await
            }
            "ai-task" => {
                // Self-reference guard: prevent a pipeline from invoking its own auto-generated agent
                if let Some(ref agent_name) = node.agent {
                    let pipeline_safe_name: String = pipeline_name
                        .chars()
                        .map(|c| {
                            if c.is_alphanumeric() || c == '-' || c == '_' {
                                c
                            } else {
                                '-'
                            }
                        })
                        .collect();
                    let prefixed = format!("_pipeline--{}", pipeline_safe_name);
                    if agent_name == &prefixed || agent_name == &pipeline_safe_name {
                        let msg = format!(
                            "Self-reference detected: node '{}' references agent '{}' which belongs to the current pipeline '{}'. This would cause an infinite loop.",
                            node.name, agent_name, pipeline_name
                        );
                        emit_node_log(app, run_id, &node.id, &msg);
                        return NodeResult {
                            node_id: node.id.clone(),
                            status: NodeStatus::Failed,
                            exit_code: Some(1),
                            output: msg,
                            started_at: Some(started_at),
                            finished_at: Some(now_iso()),
                            attempt: 1,
                            cost_usd: None,
                        };
                    }
                }
                execute_shell_or_claude(
                    app,
                    run_id,
                    &node.id,
                    true,
                    &instructions,
                    cli_path,
                    project_path,
                    node.timeout,
                    node.agent.as_deref(),
                )
                .await
            }
            "approval-gate" => {
                emit_node_log(
                    app,
                    run_id,
                    &node.id,
                    &format!("Waiting for approval: {}", node.name),
                );
                let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
                {
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.approval_tx = Some(tx);
                    }
                }
                let _ = app.emit(
                    "approval-requested",
                    serde_json::json!({
                        "run_id": run_id, "node_id": node.id, "name": node.name,
                    }),
                );
                let approved = if let Some(secs) = node.timeout {
                    tokio::time::timeout(std::time::Duration::from_secs(secs), rx)
                        .await
                        .ok()
                        .and_then(|r| r.ok())
                        .unwrap_or(false)
                } else {
                    rx.await.unwrap_or(false)
                };
                if approved {
                    (NodeStatus::Success, Some(0), None)
                } else {
                    (NodeStatus::Failed, Some(1), None)
                }
            }
            "sub-pipeline" | "parallel" => (NodeStatus::Success, Some(0), None),
            _ => (NodeStatus::Success, Some(0), None),
        };

        if status == NodeStatus::Success || attempt == max_attempts {
            return NodeResult {
                node_id: node.id.clone(),
                status,
                exit_code,
                output: String::new(),
                started_at: Some(started_at),
                finished_at: Some(now_iso()),
                attempt,
                cost_usd,
            };
        }

        if retry_delay > 0 {
            emit_node_log(
                app,
                run_id,
                &node.id,
                &format!("Retrying in {}s...", retry_delay),
            );
            tokio::time::sleep(std::time::Duration::from_secs(retry_delay as u64)).await;
        }
    }
    unreachable!()
}

fn should_execute_edge(condition: &Option<String>, prev_status: &NodeStatus) -> bool {
    match condition {
        None => true, // No condition = always fire regardless of predecessor status
        Some(c) if c == "success" => *prev_status == NodeStatus::Success,
        Some(c) if c == "failure" => *prev_status == NodeStatus::Failed,
        Some(c) if c == "always" => true,
        _ => true,
    }
}

fn build_execution_order(pipeline: &Pipeline) -> Vec<Vec<String>> {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();

    for node in &pipeline.nodes {
        in_degree.entry(node.id.clone()).or_insert(0);
        adj.entry(node.id.clone()).or_default();
    }
    for edge in &pipeline.edges {
        adj.entry(edge.from.clone())
            .or_default()
            .push(edge.to.clone());
        *in_degree.entry(edge.to.clone()).or_insert(0) += 1;
    }

    let mut order = Vec::new();
    let mut queue: Vec<String> = in_degree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| id.clone())
        .collect();

    while !queue.is_empty() {
        order.push(queue.clone());
        let mut next = Vec::new();
        for id in &queue {
            if let Some(neighbors) = adj.get(id) {
                for n in neighbors {
                    if let Some(deg) = in_degree.get_mut(n) {
                        *deg -= 1;
                        if *deg == 0 {
                            next.push(n.clone());
                        }
                    }
                }
            }
        }
        queue = next;
    }
    order
}

/// Shared execution loop used by both start_run and resume_run.
#[allow(clippy::too_many_arguments)]
async fn run_pipeline_loop(
    app: &AppHandle,
    pool: &SqlitePool,
    run_id: &str,
    pipeline: &Pipeline,
    inputs: &HashMap<String, String>,
    cli_path: &str,
    project_path: &str,
    active_run: &ActiveRunHandle,
    prior_results: HashMap<String, NodeResult>,
    prior_approvals: HashMap<String, String>,
    prior_instructions: HashMap<String, String>,
    ancestor_pipelines: &HashSet<String>,
) -> String {
    let exec_order = build_execution_order(pipeline);
    let node_map: HashMap<String, PipelineNode> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.clone()))
        .collect();
    let mut results: HashMap<String, NodeResult> = HashMap::new();
    let mut skipped: std::collections::HashSet<String> = std::collections::HashSet::new();

    for level in &exec_order {
        let mut runnable = Vec::new();
        for node_id in level {
            if skipped.contains(node_id) {
                continue;
            }
            let any_allows = {
                let incoming: Vec<_> = pipeline.edges.iter().filter(|e| e.to == *node_id).collect();
                incoming.is_empty()
                    || incoming.iter().any(|e| {
                        results
                            .get(&e.from)
                            .map(|r| should_execute_edge(&e.condition, &r.status))
                            .unwrap_or(true)
                    })
            };
            if any_allows {
                runnable.push(node_id.clone());
            } else {
                skipped.insert(node_id.clone());
                results.insert(
                    node_id.clone(),
                    NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Skipped,
                        exit_code: None,
                        output: "Skipped".into(),
                        started_at: None,
                        finished_at: None,
                        attempt: 0,
                        cost_usd: None,
                    },
                );
            }
        }

        let mut handles = Vec::new();
        for node_id in &runnable {
            let Some(node) = node_map.get(node_id) else {
                continue;
            };

            // Check if we can reuse a prior result (resume)
            if let Some(prior) = prior_results.get(node_id) {
                if prior.status == NodeStatus::Success {
                    let current_hash = hash_instructions(&node.instructions);
                    let original_hash = prior_instructions.get(node_id);
                    if original_hash == Some(&current_hash) {
                        emit_node_log(
                            app,
                            run_id,
                            node_id,
                            "--- Reusing previous result (resumed) ---",
                        );
                        results.insert(node_id.clone(), prior.clone());

                        // Persist the reused step
                        let _ = db::insert_run_step(
                            pool,
                            run_id,
                            node_id,
                            &node.name,
                            "Success",
                            prior.attempt as i32,
                            &current_hash,
                        )
                        .await;

                        {
                            let mut guard = active_run.lock().await;
                            if let Some(run) = guard.as_mut() {
                                run.state.node_results.insert(node_id.clone(), prior.clone());
                                emit_run_update(app, &run.state);
                            }
                        }
                        continue;
                    } else {
                        emit_node_log(
                            app,
                            run_id,
                            node_id,
                            "--- Instructions changed, re-executing ---",
                        );
                    }
                }
            }

            // Auto-approve previously approved gates
            if node.node_type == "approval-gate"
                && prior_approvals.get(node_id) == Some(&"approved".to_string())
            {
                    emit_node_log(app, run_id, node_id, "Auto-approved (previously approved)");
                    let result = NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Success,
                        exit_code: Some(0),
                        output: "Auto-approved".into(),
                        started_at: Some(now_iso()),
                        finished_at: Some(now_iso()),
                        attempt: 1,
                        cost_usd: None,
                    };
                    results.insert(node_id.clone(), result.clone());

                    let instr_hash = hash_instructions(&node.instructions);
                    if let Ok(step_id) = db::insert_run_step(
                        pool,
                        run_id,
                        node_id,
                        &node.name,
                        "Success",
                        1,
                        &instr_hash,
                    )
                    .await
                    {
                        let _ =
                            db::update_step_approval(pool, step_id, "approved").await;
                    }

                    {
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            run.state.node_results.insert(node_id.clone(), result);
                            emit_run_update(app, &run.state);
                        }
                    }
                    continue;
            }

            // Parallel group: run children in parallel
            if node.node_type == "parallel" {
                if let Some(children) = &node.children {
                    for cid in children {
                        if let Some(cn) = node_map.get(cid) {
                            let a = app.clone();
                            let n = cn.clone();
                            let r = run_id.to_string();
                            let v = pipeline.variables.clone();
                            let i = inputs.clone();
                            let c = cli_path.to_string();
                            let p = project_path.to_string();
                            let h = active_run.clone();
                            let pn = pipeline.name.clone();
                            handles.push(tokio::spawn(async move {
                                execute_node(&a, &n, &r, &v, &i, &c, &p, &h, &pn).await
                            }));
                        }
                    }
                }
                continue;
            }

            // Sub-pipeline: load and execute referenced pipeline recursively
            if node.node_type == "sub-pipeline" {
                let pipeline_ref = match &node.pipeline_ref {
                    Some(r) if !r.is_empty() => r.clone(),
                    _ => {
                        let msg = format!(
                            "No pipeline selected for sub-pipeline node '{}'",
                            node.name
                        );
                        emit_node_log(app, run_id, node_id, &msg);
                        let result = NodeResult {
                            node_id: node_id.clone(),
                            status: NodeStatus::Failed,
                            exit_code: Some(1),
                            output: msg,
                            started_at: Some(now_iso()),
                            finished_at: Some(now_iso()),
                            attempt: 1,
                            cost_usd: None,
                        };
                        results.insert(node_id.clone(), result.clone());
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            run.state.node_results.insert(node_id.clone(), result);
                            emit_run_update(app, &run.state);
                        }
                        continue;
                    }
                };

                // Circular reference detection
                if ancestor_pipelines.contains(&pipeline_ref) {
                    let chain: Vec<&str> = ancestor_pipelines.iter().map(|s| s.as_str()).collect();
                    let msg = format!(
                        "Circular pipeline reference detected: {} -> {}",
                        chain.join(" -> "),
                        pipeline_ref
                    );
                    emit_node_log(app, run_id, node_id, &msg);
                    let result = NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Failed,
                        exit_code: Some(1),
                        output: msg,
                        started_at: Some(now_iso()),
                        finished_at: Some(now_iso()),
                        attempt: 1,
                        cost_usd: None,
                    };
                    results.insert(node_id.clone(), result.clone());
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), result);
                        emit_run_update(app, &run.state);
                    }
                    continue;
                }

                // Load the referenced pipeline
                let sub_pipeline =
                    match crate::pipeline_engine::load_pipeline_by_name(project_path, &pipeline_ref)
                    {
                        Ok(p) => p,
                        Err(e) => {
                            emit_node_log(app, run_id, node_id, &e);
                            let result = NodeResult {
                                node_id: node_id.clone(),
                                status: NodeStatus::Failed,
                                exit_code: Some(1),
                                output: e,
                                started_at: Some(now_iso()),
                                finished_at: Some(now_iso()),
                                attempt: 1,
                                cost_usd: None,
                            };
                            results.insert(node_id.clone(), result.clone());
                            let mut guard = active_run.lock().await;
                            if let Some(run) = guard.as_mut() {
                                run.state.node_results.insert(node_id.clone(), result);
                                emit_run_update(app, &run.state);
                            }
                            continue;
                        }
                    };

                // Emit running status for the sub-pipeline node
                {
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.current_node = Some(node_id.clone());
                        run.state.node_results.insert(
                            node_id.clone(),
                            NodeResult {
                                node_id: node_id.clone(),
                                status: NodeStatus::Running,
                                exit_code: None,
                                output: format!("Executing sub-pipeline '{}'", pipeline_ref),
                                started_at: Some(now_iso()),
                                finished_at: None,
                                attempt: 1,
                                cost_usd: None,
                            },
                        );
                        emit_run_update(app, &run.state);
                    }
                }

                let started_at = now_iso();

                // Persist a run_step for the sub-pipeline node (Running)
                let instr_hash = hash_instructions(&pipeline_ref);
                let step_id = db::insert_run_step(
                    pool,
                    run_id,
                    node_id,
                    &node.name,
                    "Running",
                    1,
                    &instr_hash,
                )
                .await
                .ok();

                // Build new ancestor set
                let mut sub_ancestors = ancestor_pipelines.clone();
                sub_ancestors.insert(sub_pipeline.name.clone());

                // Execute the sub-pipeline recursively
                let sub_result = Box::pin(run_pipeline_loop(
                    app,
                    pool,
                    run_id,
                    &sub_pipeline,
                    inputs,
                    cli_path,
                    project_path,
                    active_run,
                    HashMap::new(),
                    HashMap::new(),
                    HashMap::new(),
                    &sub_ancestors,
                ))
                .await;

                let sub_status = if sub_result == "success" {
                    NodeStatus::Success
                } else {
                    NodeStatus::Failed
                };

                // Aggregate cost from sub-pipeline's node results
                let sub_cost = {
                    let guard = active_run.lock().await;
                    guard.as_ref().map(|run| {
                        run.state
                            .node_results
                            .iter()
                            .filter(|(id, _)| {
                                sub_pipeline.nodes.iter().any(|n| n.id == **id)
                            })
                            .filter_map(|(_, r)| r.cost_usd)
                            .sum::<f64>()
                    })
                };
                let cost = sub_cost.filter(|c| *c > 0.0);

                let result = NodeResult {
                    node_id: node_id.clone(),
                    status: sub_status,
                    exit_code: Some(if sub_result == "success" { 0 } else { 1 }),
                    output: format!("Sub-pipeline '{}' {}", pipeline_ref, sub_result),
                    started_at: Some(started_at),
                    finished_at: Some(now_iso()),
                    attempt: 1,
                    cost_usd: cost,
                };

                // Update the run_step with final status
                let status_str = if sub_result == "success" {
                    "Success"
                } else {
                    "Failed"
                };
                if let Some(sid) = step_id {
                    let _ = db::update_run_step(pool, sid, status_str, result.exit_code, None).await;
                    if let Some(c) = cost {
                        let _ = db::update_step_tokens(pool, sid, c, "sub-pipeline").await;
                    }
                }

                results.insert(node_id.clone(), result.clone());
                {
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), result);
                        run.state.total_cost_usd = run
                            .state
                            .node_results
                            .values()
                            .filter_map(|r| r.cost_usd)
                            .sum();
                        emit_run_update(app, &run.state);
                    }
                }
                continue;
            }

            // Emit running status
            {
                let mut guard = active_run.lock().await;
                if let Some(run) = guard.as_mut() {
                    run.state.current_node = Some(node_id.clone());
                    run.state.node_results.insert(
                        node_id.clone(),
                        NodeResult {
                            node_id: node_id.clone(),
                            status: NodeStatus::Running,
                            exit_code: None,
                            output: String::new(),
                            started_at: Some(now_iso()),
                            finished_at: None,
                            attempt: 1,
                            cost_usd: None,
                        },
                    );
                    emit_run_update(app, &run.state);
                }
            }

            let a = app.clone();
            let n = node.clone();
            let r = run_id.to_string();
            let v = pipeline.variables.clone();
            let i = inputs.clone();
            let c = cli_path.to_string();
            let p = project_path.to_string();
            let h = active_run.clone();
            let pn = pipeline.name.clone();
            handles.push(tokio::spawn(
                async move { execute_node(&a, &n, &r, &v, &i, &c, &p, &h, &pn).await },
            ));
        }

        for handle in handles {
            if let Ok(result) = handle.await {
                // Persist step to DB
                let node = node_map.get(&result.node_id);
                let node_name = node.map(|n| n.name.as_str()).unwrap_or("");
                let instr_hash = node
                    .map(|n| hash_instructions(&n.instructions))
                    .unwrap_or_default();
                let status_str = match &result.status {
                    NodeStatus::Success => "Success",
                    NodeStatus::Failed => "Failed",
                    NodeStatus::Cancelled => "Cancelled",
                    NodeStatus::Skipped => "Skipped",
                    NodeStatus::Running => "Running",
                    NodeStatus::Pending => "Pending",
                };

                if let Ok(step_id) = db::insert_run_step(
                    pool,
                    run_id,
                    &result.node_id,
                    node_name,
                    status_str,
                    result.attempt as i32,
                    &instr_hash,
                )
                .await
                {
                    let _ = db::update_run_step(
                        pool,
                        step_id,
                        status_str,
                        result.exit_code,
                        None,
                    )
                    .await;

                    // Persist cost if available
                    if let Some(cost) = result.cost_usd {
                        let _ = db::update_step_tokens(pool, step_id, cost, "claude").await;
                    }

                    // Track approval state
                    if let Some(n) = node {
                        if n.node_type == "approval-gate" {
                            let state = if result.status == NodeStatus::Success {
                                "approved"
                            } else {
                                "rejected"
                            };
                            let _ = db::update_step_approval(pool, step_id, state).await;
                        }
                    }
                }

                results.insert(result.node_id.clone(), result.clone());
                let mut guard = active_run.lock().await;
                if let Some(run) = guard.as_mut() {
                    run.state
                        .node_results
                        .insert(result.node_id.clone(), result);
                    // Update total cost
                    run.state.total_cost_usd = run
                        .state
                        .node_results
                        .values()
                        .filter_map(|r| r.cost_usd)
                        .sum();
                    emit_run_update(app, &run.state);
                }
            }
        }

        // Handle parallel group status
        for node_id in &runnable {
            if let Some(node) = node_map.get(node_id) {
                if node.node_type == "parallel" {
                    let ok = node
                        .children
                        .as_ref()
                        .map(|kids| {
                            kids.iter().all(|c| {
                                results
                                    .get(c)
                                    .map(|r| r.status == NodeStatus::Success)
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(true);
                    let gr = NodeResult {
                        node_id: node_id.clone(),
                        status: if ok {
                            NodeStatus::Success
                        } else {
                            NodeStatus::Failed
                        },
                        exit_code: Some(if ok { 0 } else { 1 }),
                        output: "Parallel group completed".into(),
                        started_at: Some(now_iso()),
                        finished_at: Some(now_iso()),
                        attempt: 1,
                        cost_usd: None,
                    };
                    results.insert(node_id.clone(), gr.clone());
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), gr);
                        emit_run_update(app, &run.state);
                    }
                }
            }
        }

        // Check cancellation
        {
            let g = active_run.lock().await;
            if g.as_ref().map(|r| r.cancelled).unwrap_or(false) {
                break;
            }
        }
    }

    let cancelled = {
        active_run
            .lock()
            .await
            .as_ref()
            .map(|r| r.cancelled)
            .unwrap_or(false)
    };
    if cancelled {
        "cancelled".to_string()
    } else if results.values().any(|r| r.status == NodeStatus::Failed) {
        "failed".to_string()
    } else {
        "success".to_string()
    }
}

#[tauri::command]
pub async fn start_run(
    app: AppHandle,
    pipeline: Pipeline,
    inputs: HashMap<String, String>,
    claude_cli_path: String,
    project_path: String,
) -> Result<String, String> {
    let run_id = format!("run-{}", chrono::Utc::now().timestamp_millis());

    let active_run: ActiveRunHandle = {
        let es = app.state::<tokio::sync::Mutex<ExecutorState>>();
        let es_guard = es.lock().await;
        let guard = es_guard.active_run.lock().await;
        if guard.is_some() {
            return Err("A run is already in progress".into());
        }
        drop(guard);
        es_guard.active_run.clone()
    };

    // Pre-flight validation
    validate_sub_pipeline_refs(&pipeline)?;
    validate_required_tools(&pipeline, &project_path)?;

    let state = RunState {
        run_id: run_id.clone(),
        pipeline_name: pipeline.name.clone(),
        status: "running".into(),
        node_results: HashMap::new(),
        current_node: None,
        total_cost_usd: 0.0,
    };

    {
        let mut guard = active_run.lock().await;
        *guard = Some(ActiveRun {
            state: state.clone(),
            cancelled: false,
            approval_tx: None,
        });
    }
    emit_run_update(&app, &state);

    // Persist run to DB
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone());
    let p_hash = hash_pipeline(&pipeline);
    if let Some(ref pool) = pool {
        let trigger = serde_json::to_string(&inputs).ok();
        let _ = db::insert_run(
            pool,
            &run_id,
            &pipeline.name,
            "running",
            trigger.as_deref(),
            None,
            &p_hash,
        )
        .await;
    }

    let arh = active_run.clone();
    let app_c = app.clone();
    let rid = run_id.clone();

    tokio::spawn(async move {
        let cli = if claude_cli_path.is_empty() {
            "claude".into()
        } else {
            claude_cli_path
        };

        // Get pool inside the spawned task
        let pool = app_c
            .try_state::<SqlitePool>()
            .map(|s| s.inner().clone());
        let empty_pool;
        let pool_ref = match &pool {
            Some(p) => p,
            None => {
                // Create a dummy — DB calls will just fail silently
                empty_pool = SqlitePool::connect("sqlite::memory:")
                    .await
                    .expect("in-memory pool");
                &empty_pool
            }
        };

        let mut ancestors = HashSet::new();
        ancestors.insert(pipeline.name.clone());
        let final_status = run_pipeline_loop(
            &app_c,
            pool_ref,
            &rid,
            &pipeline,
            &inputs,
            &cli,
            &project_path,
            &arh,
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            &ancestors,
        )
        .await;

        // Find failed node for DB
        let failed_node_id = if final_status == "failed" {
            let guard = arh.lock().await;
            guard.as_ref().and_then(|run| {
                run.state
                    .node_results
                    .iter()
                    .find(|(_, r)| r.status == NodeStatus::Failed)
                    .map(|(id, _)| id.clone())
            })
        } else {
            None
        };

        // Update run status in DB
        if let Some(ref pool) = pool {
            let _ = db::update_run_status(
                pool,
                &rid,
                &final_status,
                failed_node_id.as_deref(),
            )
            .await;
        }

        {
            let mut guard = arh.lock().await;
            if let Some(run) = guard.as_mut() {
                run.state.status = final_status;
                run.state.current_node = None;
                emit_run_update(&app_c, &run.state);
            }
            *guard = None;
        }
    });

    Ok(run_id)
}

#[tauri::command]
pub async fn resume_run(
    app: AppHandle,
    original_run_id: String,
    pipeline: Pipeline,
    inputs: HashMap<String, String>,
    claude_cli_path: String,
    project_path: String,
) -> Result<String, String> {
    let run_id = format!("run-{}", chrono::Utc::now().timestamp_millis());

    let active_run: ActiveRunHandle = {
        let es = app.state::<tokio::sync::Mutex<ExecutorState>>();
        let es_guard = es.lock().await;
        let guard = es_guard.active_run.lock().await;
        if guard.is_some() {
            return Err("A run is already in progress".into());
        }
        drop(guard);
        es_guard.active_run.clone()
    };

    // Pre-flight validation
    validate_sub_pipeline_refs(&pipeline)?;
    validate_required_tools(&pipeline, &project_path)?;

    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;

    // Load original run steps
    let steps = db::get_run_steps(&pool, &original_run_id).await?;

    // Build prior results, approvals, and instruction hashes
    let mut prior_results: HashMap<String, NodeResult> = HashMap::new();
    let mut prior_approvals: HashMap<String, String> = HashMap::new();
    let mut prior_instructions: HashMap<String, String> = HashMap::new();

    for step in &steps {
        if step.status == "Success" {
            prior_results.insert(
                step.node_id.clone(),
                NodeResult {
                    node_id: step.node_id.clone(),
                    status: NodeStatus::Success,
                    exit_code: step.exit_code,
                    output: String::new(),
                    started_at: step.started_at.clone(),
                    finished_at: step.finished_at.clone(),
                    attempt: step.attempt as u32,
                    cost_usd: step.cost_usd,
                },
            );
        }
        if let Some(ref approval) = step.approval_state {
            prior_approvals.insert(step.node_id.clone(), approval.clone());
        }
        if let Some(ref hash) = step.instructions_hash {
            prior_instructions.insert(step.node_id.clone(), hash.clone());
        }
    }

    let state = RunState {
        run_id: run_id.clone(),
        pipeline_name: pipeline.name.clone(),
        status: "running".into(),
        node_results: HashMap::new(),
        current_node: None,
        total_cost_usd: 0.0,
    };

    {
        let mut guard = active_run.lock().await;
        *guard = Some(ActiveRun {
            state: state.clone(),
            cancelled: false,
            approval_tx: None,
        });
    }
    emit_run_update(&app, &state);

    // Persist new run to DB
    let p_hash = hash_pipeline(&pipeline);
    let trigger = serde_json::to_string(&inputs).ok();
    let _ = db::insert_run(
        &pool,
        &run_id,
        &pipeline.name,
        "running",
        trigger.as_deref(),
        Some(&original_run_id),
        &p_hash,
    )
    .await;

    let arh = active_run.clone();
    let app_c = app.clone();
    let rid = run_id.clone();
    let pool_c = pool.clone();

    tokio::spawn(async move {
        let cli = if claude_cli_path.is_empty() {
            "claude".into()
        } else {
            claude_cli_path
        };

        let mut ancestors = HashSet::new();
        ancestors.insert(pipeline.name.clone());
        let final_status = run_pipeline_loop(
            &app_c,
            &pool_c,
            &rid,
            &pipeline,
            &inputs,
            &cli,
            &project_path,
            &arh,
            prior_results,
            prior_approvals,
            prior_instructions,
            &ancestors,
        )
        .await;

        let failed_node_id = if final_status == "failed" {
            let guard = arh.lock().await;
            guard.as_ref().and_then(|run| {
                run.state
                    .node_results
                    .iter()
                    .find(|(_, r)| r.status == NodeStatus::Failed)
                    .map(|(id, _)| id.clone())
            })
        } else {
            None
        };

        let _ = db::update_run_status(
            &pool_c,
            &rid,
            &final_status,
            failed_node_id.as_deref(),
        )
        .await;

        {
            let mut guard = arh.lock().await;
            if let Some(run) = guard.as_mut() {
                run.state.status = final_status;
                run.state.current_node = None;
                emit_run_update(&app_c, &run.state);
            }
            *guard = None;
        }
    });

    Ok(run_id)
}

#[tauri::command]
pub async fn cancel_run(app: AppHandle) -> Result<(), String> {
    let es = app.state::<tokio::sync::Mutex<ExecutorState>>();
    let es_guard = es.lock().await;
    let mut guard = es_guard.active_run.lock().await;
    if let Some(run) = guard.as_mut() {
        run.cancelled = true;
        Ok(())
    } else {
        Err("No active run".into())
    }
}

#[tauri::command]
pub async fn respond_to_approval(app: AppHandle, approved: bool) -> Result<(), String> {
    let es = app.state::<tokio::sync::Mutex<ExecutorState>>();
    let es_guard = es.lock().await;
    let mut guard = es_guard.active_run.lock().await;
    if let Some(run) = guard.as_mut() {
        if let Some(tx) = run.approval_tx.take() {
            let _ = tx.send(approved);
            Ok(())
        } else {
            Err("No pending approval".into())
        }
    } else {
        Err("No active run".into())
    }
}

#[tauri::command]
pub async fn get_run_state(app: AppHandle) -> Result<Option<RunState>, String> {
    let es = app.state::<tokio::sync::Mutex<ExecutorState>>();
    let es_guard = es.lock().await;
    let guard: tokio::sync::MutexGuard<'_, Option<ActiveRun>> =
        es_guard.active_run.lock().await;
    Ok(guard.as_ref().map(|r| r.state.clone()))
}

#[tauri::command]
pub async fn list_run_history(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<db::RunRow>, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    db::list_runs(&pool, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn get_run_details(
    app: AppHandle,
    run_id: String,
) -> Result<(db::RunRow, Vec<db::RunStepRow>), String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    let run = db::get_run(&pool, &run_id)
        .await?
        .ok_or_else(|| "Run not found".to_string())?;
    let steps = db::get_run_steps(&pool, &run_id).await?;
    Ok((run, steps))
}

#[tauri::command]
pub async fn get_cost_summary(app: AppHandle) -> Result<db::CostSummary, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    db::get_cost_summary(&pool).await
}

#[tauri::command]
pub async fn get_usage_stats(app: AppHandle) -> Result<db::UsageStats, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    db::get_usage_stats(&pool).await
}

#[tauri::command]
pub async fn get_avg_ai_cost(app: AppHandle) -> Result<Option<f64>, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    db::get_avg_ai_step_cost(&pool).await
}
