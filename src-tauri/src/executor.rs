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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStateDelta {
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_node: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_result: Option<NodeResult>,
}

pub struct ActiveRun {
    pub state: RunState,
    pub cancelled: bool,
    pub approval_tx: Option<tokio::sync::oneshot::Sender<bool>>,
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
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

fn emit_run_delta(app: &AppHandle, delta: RunStateDelta) {
    let _ = app.emit("run-update-delta", delta);
}

fn node_delta(
    run_id: &str,
    nr: NodeResult,
    status: Option<&str>,
    current_node: Option<Option<String>>,
    cost: Option<f64>,
) -> RunStateDelta {
    RunStateDelta {
        run_id: run_id.to_string(),
        status: status.map(|s| s.to_string()),
        current_node,
        total_cost_usd: cost,
        node_result: Some(nr),
    }
}

fn emit_node_log(app: &AppHandle, run_id: &str, node_id: &str, line: &str) {
    let _ = app.emit(
        "node-log",
        serde_json::json!({ "run_id": run_id, "node_id": node_id, "line": line }),
    );
}

fn emit_node_log_batch(app: &AppHandle, run_id: &str, node_id: &str, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }
    let _ = app.emit(
        "node-log-batch",
        serde_json::json!({ "run_id": run_id, "node_id": node_id, "lines": lines }),
    );
}

pub fn hash_instructions(instructions: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(instructions.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn hash_pipeline(pipeline: &Pipeline) -> String {
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

/// Maximum bytes of stdout to capture per node for output passing.
const MAX_STDOUT_CAPTURE: usize = 102_400; // 100 KB

/// Convert camelCase or kebab-case to SCREAMING_SNAKE_CASE for env vars.
/// e.g. "branchName" → "BRANCH_NAME", "worktree-path" → "WORKTREE_PATH"
fn to_env_var_name(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c == '-' || c == '.' {
            result.push('_');
        } else if c.is_uppercase() && i > 0 {
            let prev = s.chars().nth(i - 1).unwrap_or('_');
            if prev != '_' && prev != '-' && !prev.is_uppercase() {
                result.push('_');
            }
            result.push(c);
        } else {
            result.push(c.to_ascii_uppercase());
        }
    }
    result
}

/// Parse structured outputs from AI node output.
/// Looks for a `--- OUTPUTS ---` marker followed by a JSON object.
pub fn parse_structured_outputs(output: &str) -> Option<HashMap<String, String>> {
    let marker = "--- OUTPUTS ---";
    let idx = output.rfind(marker)?;
    let after = output[idx + marker.len()..].trim();

    // Find the JSON object boundaries
    let start = after.find('{')?;
    let end = after.rfind('}')?;
    if end <= start {
        return None;
    }

    let json_str = &after[start..=end];
    let json: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let obj = json.as_object()?;

    let mut map = HashMap::new();
    for (k, v) in obj {
        let val = match v {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Null => String::new(),
            other => other.to_string(),
        };
        map.insert(k.clone(), val);
    }
    Some(map)
}

pub fn parse_cost_from_stderr(lines: &[String]) -> Option<f64> {
    for line in lines.iter().rev() {
        let lower = line.to_lowercase();

        // Match patterns like "Total cost: $0.0042" or "total cost: $1.23" (case-insensitive)
        if let Some(pos) = lower.find("total cost:") {
            let after = &line[pos + "total cost:".len()..];
            // Find the dollar amount after the colon
            if let Some(dollar_pos) = after.find('$') {
                let num_str = after[dollar_pos + 1..]
                    .trim()
                    .split(|c: char| !c.is_ascii_digit() && c != '.')
                    .next()
                    .unwrap_or("");
                if let Ok(cost) = num_str.parse::<f64>() {
                    return Some(cost);
                }
            }
        }

        // Match "cost: $X.XX" (without "Total" prefix, case-insensitive)
        if lower.contains("cost:") && !lower.contains("total cost:") {
            if let Some(pos) = lower.find("cost:") {
                let after = &line[pos + "cost:".len()..];
                if let Some(dollar_pos) = after.find('$') {
                    let num_str = after[dollar_pos + 1..]
                        .trim()
                        .split(|c: char| !c.is_ascii_digit() && c != '.')
                        .next()
                        .unwrap_or("");
                    if let Ok(cost) = num_str.parse::<f64>() {
                        return Some(cost);
                    }
                }
            }
        }

        // Match any $X.XX pattern on lines containing "cost" (case-insensitive fallback)
        if lower.contains("cost") {
            let mut search_from = 0;
            while let Some(dollar_pos) = line[search_from..].find('$') {
                let abs_pos = search_from + dollar_pos + 1;
                if abs_pos < line.len() {
                    let num_str: String = line[abs_pos..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit() || *c == '.')
                        .collect();
                    if !num_str.is_empty() {
                        if let Ok(cost) = num_str.parse::<f64>() {
                            return Some(cost);
                        }
                    }
                }
                search_from = abs_pos;
            }
        }

        // Check for total_cost_usd in JSON-like output
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

/// Execute a shell or Claude CLI command, returning (status, exit_code, cost, captured_stdout).
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
    cancel_rx: &tokio::sync::watch::Receiver<bool>,
    env_vars: &HashMap<String, String>,
    continue_session: bool,
    model: Option<&str>,
) -> (NodeStatus, Option<i32>, Option<f64>, String) {
    let mut cmd = if is_claude {
        let mut c = Command::new(cli_path);
        if let Some(agent_name) = agent {
            c.arg("--agent").arg(agent_name);
        }
        if let Some(m) = model {
            c.arg("--model").arg(m);
        }
        if continue_session {
            c.arg("--continue");
        }
        c.arg("--print")
            .arg("--output-format").arg("stream-json")
            .arg("--verbose")
            .arg(instructions)
            .current_dir(cwd);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c").arg(instructions).current_dir(cwd);
        c
    };

    // Inject environment variables (used by shell/git nodes to access upstream outputs)
    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Node {} spawn error: {}", node_id, e);
            emit_node_log(app, run_id, node_id, &format!("Spawn error: {}", e));
            return (NodeStatus::Failed, None, None, String::new());
        }
    };

    // Completion signals for stdout/stderr reader tasks
    let stdout_done = Arc::new(tokio::sync::Notify::new());
    let stderr_done = Arc::new(tokio::sync::Notify::new());

    // Shared log batch buffer: reader tasks push lines here, flush task drains every 50ms
    let log_batch: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let flush_done = Arc::new(tokio::sync::Notify::new());

    // Spawn flush task: drains log_batch every 50ms and emits node-log-batch events
    {
        let a = app.clone();
        let r = run_id.to_string();
        let n = node_id.to_string();
        let batch = log_batch.clone();
        let stdout_sig = stdout_done.clone();
        let stderr_sig = stderr_done.clone();
        let done = flush_done.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                let lines: Vec<String> = {
                    let mut buf = batch.lock().await;
                    if buf.is_empty() {
                        // Check if both readers are done (try_notified doesn't exist,
                        // so we use a select with zero timeout)
                        drop(buf);
                        continue;
                    }
                    std::mem::take(&mut *buf)
                };
                emit_node_log_batch(&a, &r, &n, lines);
            }
        });
        // Spawn a cleanup task that waits for both readers to finish, flushes remaining, and signals done
        let a2 = app.clone();
        let r2 = run_id.to_string();
        let n2 = node_id.to_string();
        let batch2 = log_batch.clone();
        tokio::spawn(async move {
            stdout_sig.notified().await;
            stderr_sig.notified().await;
            // Small delay to let any remaining lines arrive
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            // Final flush
            let lines: Vec<String> = std::mem::take(&mut *batch2.lock().await);
            emit_node_log_batch(&a2, &r2, &n2, lines);
            done.notify_one();
        });
    }

    // Stream stdout line-by-line AND buffer for output passing.
    // For Claude nodes with --output-format stream-json, parse JSON events
    // and emit assistant text as live logs. The final "result" event provides the full output.
    let stdout_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_size: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    // Stream-json: stores the final result text and cost extracted from the "result" event
    let stream_result_text: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let stream_result_cost: Arc<Mutex<Option<f64>>> = Arc::new(Mutex::new(None));
    if let Some(stdout) = child.stdout.take() {
        let buf = stdout_buffer.clone();
        let sz = stdout_size.clone();
        let done = stdout_done.clone();
        let is_claude_stream = is_claude;
        let srt = stream_result_text.clone();
        let src = stream_result_cost.clone();
        let batch = log_batch.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if is_claude_stream {
                    // Parse stream-json events from Claude CLI
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        let event_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match event_type {
                            "assistant" => {
                                // Extract text content from assistant message
                                if let Some(content) = json.pointer("/message/content") {
                                    if let Some(arr) = content.as_array() {
                                        for item in arr {
                                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                                    // Push each line to batch buffer
                                                    {
                                                        let mut b = batch.lock().await;
                                                        for text_line in text.lines() {
                                                            if !text_line.is_empty() {
                                                                b.push(text_line.to_string());
                                                            }
                                                        }
                                                    }
                                                    // Buffer the text for output passing
                                                    let mut size = sz.lock().await;
                                                    if *size < MAX_STDOUT_CAPTURE {
                                                        *size += text.len() + 1;
                                                        buf.lock().await.push(text.to_string());
                                                    }
                                                }
                                            } else if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                                // Log tool usage
                                                let tool_name = item.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                                batch.lock().await.push(format!("[tool] {}", tool_name));
                                            }
                                        }
                                    }
                                }
                            }
                            "result" => {
                                // Extract final result text and cost
                                if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                                    *srt.lock().await = Some(result_text.to_string());
                                    // Also buffer it for output passing
                                    let mut size = sz.lock().await;
                                    if *size == 0 {
                                        // Only set if we haven't buffered any assistant text
                                        *size += result_text.len();
                                        buf.lock().await.push(result_text.to_string());
                                    }
                                }
                                if let Some(cost) = json.get("total_cost_usd").and_then(|c| c.as_f64()) {
                                    *src.lock().await = Some(cost);
                                }
                            }
                            _ => {
                                // Skip system, hook, rate_limit events
                            }
                        }
                    }
                } else {
                    // Non-Claude: push to batch buffer
                    batch.lock().await.push(line.clone());
                    let mut size = sz.lock().await;
                    if *size < MAX_STDOUT_CAPTURE {
                        *size += line.len() + 1;
                        buf.lock().await.push(line);
                    }
                }
            }
            done.notify_one();
        });
    } else {
        stdout_done.notify_one();
    }

    // Stream stderr line-by-line AND buffer for cost extraction (capped like stdout)
    let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_size: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buffer.clone();
        let sz = stderr_size.clone();
        let done = stderr_done.clone();
        let batch = log_batch.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                batch.lock().await.push(format!("[stderr] {}", line));
                let mut size = sz.lock().await;
                if *size < MAX_STDOUT_CAPTURE {
                    *size += line.len() + 1;
                    buf.lock().await.push(line);
                }
            }
            done.notify_one();
        });
    } else {
        stderr_done.notify_one();
    }

    // Event-driven cancellation via watch channel (zero-cost until signaled)
    let cancel_check = {
        let mut rx = cancel_rx.clone();
        async move {
            loop {
                if rx.changed().await.is_err() {
                    // Sender dropped — run is gone, treat as cancel
                    break;
                }
                if *rx.borrow() {
                    break;
                }
            }
        }
    };

    let result = if let Some(secs) = timeout_secs {
        tokio::select! {
            r = tokio::time::timeout(std::time::Duration::from_secs(secs), child.wait()) => {
                match r {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = child.kill().await;
                        log::error!("Node {} timed out after {}s", node_id, secs);
                        emit_node_log(app, run_id, node_id, &format!("Timeout after {}s", secs));
                        let captured = stdout_buffer.lock().await.join("\n");
                        return (NodeStatus::Failed, None, None, captured);
                    }
                }
            }
            _ = cancel_check => {
                let _ = child.kill().await;
                log::info!("Node {} killed due to run cancellation", node_id);
                emit_node_log(app, run_id, node_id, "Cancelled — process killed");
                let captured = stdout_buffer.lock().await.join("\n");
                return (NodeStatus::Cancelled, None, None, captured);
            }
        }
    } else {
        tokio::select! {
            r = child.wait() => r,
            _ = cancel_check => {
                let _ = child.kill().await;
                log::info!("Node {} killed due to run cancellation", node_id);
                emit_node_log(app, run_id, node_id, "Cancelled — process killed");
                let captured = stdout_buffer.lock().await.join("\n");
                return (NodeStatus::Cancelled, None, None, captured);
            }
        }
    };

    // Wait for stdout/stderr reader tasks and log flush to finish.
    // Uses event-driven signals with a 500ms safety fallback.
    tokio::select! {
        _ = flush_done.notified() => {}
        _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {}
    }
    // For Claude stream-json: prefer the parsed result text over raw stdout buffer
    let captured = if is_claude {
        let stream_text = stream_result_text.lock().await;
        if let Some(ref text) = *stream_text {
            text.clone()
        } else {
            stdout_buffer.lock().await.join("\n")
        }
    } else {
        stdout_buffer.lock().await.join("\n")
    };

    match result {
        Ok(exit) => {
            let code = exit.code().unwrap_or(-1);
            let status = if code == 0 {
                NodeStatus::Success
            } else {
                NodeStatus::Failed
            };
            // Extract cost: prefer stream-json cost, fall back to stderr parsing
            let cost = if is_claude {
                let stream_cost = stream_result_cost.lock().await;
                if let Some(c) = *stream_cost {
                    log::info!("Node {}: stream-json cost ${:.4}", node_id, c);
                    Some(c)
                } else {
                    let buf = stderr_buffer.lock().await;
                    log::debug!(
                        "Node {} stderr ({} lines): {:?}",
                        node_id,
                        buf.len(),
                        buf.iter().rev().take(10).collect::<Vec<_>>()
                    );
                    let parsed = parse_cost_from_stderr(&buf);
                    if parsed.is_none() {
                        log::debug!("Node {}: no cost extracted", node_id);
                    } else {
                        log::info!("Node {}: stderr cost ${:.4}", node_id, parsed.unwrap());
                    }
                    parsed
                }
            } else {
                None
            };
            (status, Some(code), cost, captured)
        }
        Err(e) => {
            log::error!("Node {} process error: {}", node_id, e);
            emit_node_log(app, run_id, node_id, &format!("Process error: {}", e));
            (NodeStatus::Failed, None, None, captured)
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
    node_outputs: &HashMap<String, String>,
    cli_path: &str,
    project_path: &str,
    active_run: &ActiveRunHandle,
    cancel_rx: &tokio::sync::watch::Receiver<bool>,
    pipeline_name: &str,
    pipeline_edges: &[crate::pipeline_engine::PipelineEdge],
    continue_session: bool,
    pipeline_default_model: Option<&str>,
) -> NodeResult {
    let started_at = now_iso();

    // Check cancellation via watch channel (no mutex lock needed)
    if *cancel_rx.borrow() {
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

    let is_shell = matches!(node.node_type.as_str(), "shell" | "git");

    // Substitute variables in instruction text
    let mut instructions = node.instructions.clone();
    for (k, v) in variables {
        instructions = instructions.replace(&format!("${}", k), v);
        instructions = instructions.replace(&format!("${{{}}}", k), v);
    }
    for (k, v) in inputs {
        instructions = instructions.replace(&format!("{{input.{}}}", k), v);
        instructions = instructions.replace(&format!("{{{}}}", k), v);
    }
    // Substitute upstream node outputs: {output.NODE_ID} or {output.node-name-slug}
    for (k, v) in node_outputs {
        instructions = instructions.replace(&format!("{{output.{}}}", k), v);
    }

    // Build environment variables for shell/git nodes.
    // These let shell scripts access upstream values as $BRANCH_NAME, $WORKTREE_PATH, etc.
    let env_vars: HashMap<String, String> = if is_shell {
        let mut vars = HashMap::new();
        // Pipeline variables (already SCREAMING_SNAKE typically)
        for (k, v) in variables {
            vars.insert(k.clone(), v.clone());
        }
        // Pipeline inputs
        for (k, v) in inputs {
            vars.insert(to_env_var_name(k), v.clone());
        }
        // All structured node_outputs (includes parsed keys like branchName → BRANCH_NAME)
        for (k, v) in node_outputs {
            vars.insert(to_env_var_name(k), v.clone());
        }
        vars
    } else {
        HashMap::new()
    };

    // --- AI-only context appends (would break bash if appended to shell instructions) ---
    if !is_shell {
        // Append pipeline inputs as context for AI nodes that declare inputs
        if !node.inputs.is_empty() {
            let mut context_parts = Vec::new();
            for input_key in &node.inputs {
                let val = inputs
                    .get(input_key.as_str())
                    .or_else(|| node_outputs.get(input_key.as_str()))
                    .or_else(|| variables.get(input_key.as_str()));
                if let Some(v) = val {
                    if !v.is_empty() {
                        context_parts.push(format!("{}: {}", input_key, v));
                    }
                }
            }
            if !context_parts.is_empty() {
                instructions.push_str("\n\n--- Pipeline Inputs ---\n");
                instructions.push_str(&context_parts.join("\n"));
            }
        }

        // Append upstream node outputs as context for downstream AI nodes.
        // Skip when using --continue since Claude already has this context from the prior turn.
        if !continue_session {
            let mut upstream_parts = Vec::new();
            let max_context = 4096;
            for edge in pipeline_edges {
                if edge.to == node.id {
                    if let Some(output) = node_outputs.get(&edge.from) {
                        if !output.is_empty() {
                            let trimmed = if output.len() > max_context {
                                format!("[truncated]\n{}", &output[output.len() - max_context..])
                            } else {
                                output.clone()
                            };
                            upstream_parts.push(format!("[{}]:\n{}", edge.from, trimmed));
                        }
                    }
                }
            }
            if !upstream_parts.is_empty() {
                instructions.push_str("\n\n--- Previous Step Results ---\n");
                instructions.push_str(&upstream_parts.join("\n\n"));
            }
        }

        // Prompt AI nodes to emit structured outputs if they declare outputs
        if !node.outputs.is_empty() {
            let json_template: String = node
                .outputs
                .iter()
                .map(|k| format!("\"{}\": \"...\"", k))
                .collect::<Vec<_>>()
                .join(", ");
            instructions.push_str(&format!(
                "\n\nAt the end, output:\n--- OUTPUTS ---\n{{{}}}",
                json_template
            ));
        }
    }

    // Resolve effective model: node override > pipeline default > None
    let effective_model = node.model.as_deref().or(pipeline_default_model);

    let max_attempts = node.retry.as_ref().map(|r| r.max).unwrap_or(1).max(1);
    let retry_delay = node.retry.as_ref().map(|r| r.delay).unwrap_or(0);

    for attempt in 1..=max_attempts {
        emit_node_log(
            app,
            run_id,
            &node.id,
            &format!("--- {} (attempt {}/{}) ---", node.name, attempt, max_attempts),
        );

        let (status, exit_code, cost_usd, captured_output) = match node.node_type.as_str() {
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
                    cancel_rx,
                    &env_vars,
                    false,
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
                if continue_session {
                    log::info!("Node {}: using --continue (session sharing)", node.id);
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
                    cancel_rx,
                    &env_vars,
                    continue_session,
                    effective_model,
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
                    (NodeStatus::Success, Some(0), None, String::new())
                } else {
                    (NodeStatus::Failed, Some(1), None, String::new())
                }
            }
            "comment" => (NodeStatus::Skipped, Some(0), None, String::new()),
            "sub-pipeline" | "parallel" => (NodeStatus::Success, Some(0), None, String::new()),
            _ => (NodeStatus::Success, Some(0), None, String::new()),
        };

        if status == NodeStatus::Success || attempt == max_attempts {
            return NodeResult {
                node_id: node.id.clone(),
                status,
                exit_code,
                output: captured_output,
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

pub fn should_execute_edge(condition: &Option<String>, prev_status: &NodeStatus) -> bool {
    match condition {
        None => true, // No condition = always fire regardless of predecessor status
        Some(c) if c == "success" => *prev_status == NodeStatus::Success,
        Some(c) if c == "failure" => *prev_status == NodeStatus::Failed,
        Some(c) if c == "always" => true,
        _ => true,
    }
}

/// Detect back edges in the pipeline graph using DFS with WHITE/GRAY/BLACK coloring.
/// A back edge is one that points to a node currently on the DFS stack (GRAY),
/// which means it creates a cycle. These must be excluded from topological sort.
pub fn find_back_edges(pipeline: &Pipeline) -> HashSet<(String, String)> {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    let node_ids: HashSet<String> = pipeline.nodes.iter().map(|n| n.id.clone()).collect();

    for node in &pipeline.nodes {
        adj.entry(node.id.clone()).or_default();
    }
    for edge in &pipeline.edges {
        adj.entry(edge.from.clone())
            .or_default()
            .push(edge.to.clone());
    }
    // Include implicit parallel group -> child edges
    for node in &pipeline.nodes {
        if node.node_type == "parallel" {
            if let Some(children) = &node.children {
                for cid in children {
                    adj.entry(node.id.clone()).or_default().push(cid.clone());
                }
            }
        }
    }

    // DFS coloring: 0=WHITE (unvisited), 1=GRAY (in stack), 2=BLACK (done)
    let mut color: HashMap<String, u8> = node_ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut back_edges: HashSet<(String, String)> = HashSet::new();

    fn dfs(
        node: &str,
        adj: &HashMap<String, Vec<String>>,
        color: &mut HashMap<String, u8>,
        back_edges: &mut HashSet<(String, String)>,
    ) {
        color.insert(node.to_string(), 1); // GRAY
        if let Some(neighbors) = adj.get(node) {
            for neighbor in neighbors {
                match color.get(neighbor.as_str()).copied().unwrap_or(0) {
                    0 => dfs(neighbor, adj, color, back_edges), // WHITE -> recurse
                    1 => {
                        // GRAY -> back edge (cycle)
                        back_edges.insert((node.to_string(), neighbor.clone()));
                    }
                    _ => {} // BLACK -> already fully explored, cross/forward edge
                }
            }
        }
        color.insert(node.to_string(), 2); // BLACK
    }

    // Compute in-degree to find root nodes (in-degree 0).
    // Starting DFS from roots ensures back edges are correctly identified
    // as the cycle-closing edges rather than arbitrary edges in the cycle.
    let mut in_deg: HashMap<String, usize> = node_ids.iter().map(|id| (id.clone(), 0)).collect();
    for edges in adj.values() {
        for target in edges {
            *in_deg.entry(target.clone()).or_insert(0) += 1;
        }
    }

    // Visit root nodes first (in-degree 0), then any remaining unvisited
    let mut roots: Vec<&String> = in_deg
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| id)
        .collect();
    roots.sort(); // deterministic order
    for id in &roots {
        if color.get(id.as_str()).copied().unwrap_or(0) == 0 {
            dfs(id, &adj, &mut color, &mut back_edges);
        }
    }
    // Handle any remaining nodes (disconnected components or all-cycle graphs)
    let mut remaining: Vec<&String> = node_ids.iter().collect();
    remaining.sort();
    for id in &remaining {
        if color.get(id.as_str()).copied().unwrap_or(0) == 0 {
            dfs(id, &adj, &mut color, &mut back_edges);
        }
    }

    back_edges
}

/// Build topological execution order, excluding back edges from in-degree computation.
/// Returns (execution_levels, back_edges) where back_edges are cycle-creating edges
/// that should be handled separately via re-queuing in run_pipeline_loop.
pub fn build_execution_order(pipeline: &Pipeline) -> (Vec<Vec<String>>, HashSet<(String, String)>) {
    let back_edges = find_back_edges(pipeline);

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
        // Only count forward edges for in-degree
        if !back_edges.contains(&(edge.from.clone(), edge.to.clone())) {
            *in_degree.entry(edge.to.clone()).or_insert(0) += 1;
        }
    }
    // Implicit edges: parallel group -> each child.
    // Children must not run before the group itself is reached.
    for node in &pipeline.nodes {
        if node.node_type == "parallel" {
            if let Some(children) = &node.children {
                for cid in children {
                    adj.entry(node.id.clone()).or_default().push(cid.clone());
                    *in_degree.entry(cid.clone()).or_insert(0) += 1;
                }
            }
        }
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
                    // Skip back edges during topological traversal
                    if back_edges.contains(&(id.clone(), n.clone())) {
                        continue;
                    }
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
    (order, back_edges)
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
    cancel_rx: &tokio::sync::watch::Receiver<bool>,
    prior_results: HashMap<String, NodeResult>,
    prior_approvals: HashMap<String, String>,
    prior_instructions: HashMap<String, String>,
    ancestor_pipelines: &HashSet<String>,
) -> String {
    let (exec_order, back_edges) = build_execution_order(pipeline);

    if !back_edges.is_empty() {
        let edge_strs: Vec<String> = back_edges
            .iter()
            .map(|(f, t)| format!("{} -> {}", f, t))
            .collect();
        log::info!(
            "Pipeline '{}' has {} back edge(s): {}",
            pipeline.name,
            back_edges.len(),
            edge_strs.join(", ")
        );
    }

    // Build outgoing back-edge map: source_node -> [(target_node, edge)]
    let mut back_edge_map: HashMap<String, Vec<(String, Option<String>)>> = HashMap::new();
    for (from, to) in &back_edges {
        // Find the condition for this back edge from the pipeline edges
        let condition = pipeline
            .edges
            .iter()
            .find(|e| e.from == *from && e.to == *to)
            .and_then(|e| e.condition.clone());
        back_edge_map
            .entry(from.clone())
            .or_default()
            .push((to.clone(), condition));
    }

    /// Maximum times a node can be re-executed via back edges to prevent infinite loops.
    const MAX_BACK_EDGE_REEXECUTIONS: u32 = 3;

    let node_map: HashMap<String, PipelineNode> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.clone()))
        .collect();
    let mut results: HashMap<String, NodeResult> = HashMap::new();
    let mut node_outputs: HashMap<String, String> = HashMap::new();
    let mut skipped: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut reexec_counts: HashMap<String, u32> = HashMap::new();
    let mut requeue: Vec<String> = Vec::new();

    // Session sharing state: track whether we can use --continue for AI nodes
    let mut has_run_ai_node = false;
    let mut last_ai_agent: Option<String> = None;

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

        let mut join_set = tokio::task::JoinSet::new();
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
                            let delta_nr = prior.clone();
                            let mut guard = active_run.lock().await;
                            if let Some(run) = guard.as_mut() {
                                run.state.node_results.insert(node_id.clone(), prior.clone());
                                emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
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
                        let delta_nr = result.clone();
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            run.state.node_results.insert(node_id.clone(), result);
                            emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
                        }
                    }
                    continue;
            }

            // Output caching: skip execution if instructions haven't changed
            if node.cache && node.node_type == "ai-task" {
                // Resolve instructions with variable/input/output substitution for accurate hash
                let mut resolved = node.instructions.clone();
                for (k, v) in &pipeline.variables {
                    resolved = resolved.replace(&format!("${}", k), v);
                    resolved = resolved.replace(&format!("${{{}}}", k), v);
                }
                for (k, v) in inputs {
                    resolved = resolved.replace(&format!("{{input.{}}}", k), v);
                    resolved = resolved.replace(&format!("{{{}}}", k), v);
                }
                for (k, v) in &node_outputs {
                    resolved = resolved.replace(&format!("{{output.{}}}", k), v);
                }
                let eff_model = node.model.as_deref().or(pipeline.default_model.as_deref()).unwrap_or("");
                let cache_key = hash_instructions(&format!("{}\n{}", resolved, eff_model));

                if let Ok(Some((cached_output, cached_cost))) = db::find_cached_step(pool, &cache_key).await {
                    emit_node_log(app, run_id, node_id, "--- Using cached result ---");
                    let result = NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Success,
                        exit_code: Some(0),
                        output: cached_output,
                        started_at: Some(now_iso()),
                        finished_at: Some(now_iso()),
                        attempt: 1,
                        cost_usd: cached_cost,
                    };
                    results.insert(node_id.clone(), result.clone());

                    // Store output for downstream node substitution
                    if !result.output.is_empty() {
                        node_outputs.insert(result.node_id.clone(), result.output.clone());
                        let slug: String = node.name.to_lowercase()
                            .chars()
                            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
                            .collect();
                        node_outputs.insert(slug, result.output.clone());
                        if let Some(parsed) = parse_structured_outputs(&result.output) {
                            for (k, v) in &parsed {
                                node_outputs.insert(k.clone(), v.clone());
                            }
                        }
                    }

                    // Persist the cached step to DB
                    let _ = db::insert_run_step(pool, run_id, node_id, &node.name, "Success", 1, &cache_key).await;

                    {
                        let delta_nr = result.clone();
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            run.state.node_results.insert(node_id.clone(), result);
                            emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
                        }
                    }
                    continue;
                }
            }

            // Parallel group: run children in parallel
            // Parallel children start fresh sessions (no --continue) since they run concurrently
            if node.node_type == "parallel" {
                if let Some(children) = &node.children {
                    // Emit Running status for all parallel children so the UI shows them as active
                    {
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            for cid in children {
                                let nr = NodeResult {
                                    node_id: cid.clone(),
                                    status: NodeStatus::Running,
                                    exit_code: None,
                                    output: String::new(),
                                    started_at: Some(now_iso()),
                                    finished_at: None,
                                    attempt: 1,
                                    cost_usd: None,
                                };
                                run.state.node_results.insert(cid.clone(), nr.clone());
                                emit_run_delta(app, node_delta(run_id, nr, None, None, None));
                            }
                        }
                    }
                    for cid in children {
                        if let Some(cn) = node_map.get(cid) {
                            let a = app.clone();
                            let n = cn.clone();
                            let r = run_id.to_string();
                            let v = pipeline.variables.clone();
                            let i = inputs.clone();
                            let o = node_outputs.clone();
                            let c = cli_path.to_string();
                            let p = project_path.to_string();
                            let h = active_run.clone();
                            let crx = cancel_rx.clone();
                            let pn = pipeline.name.clone();
                            let pe = pipeline.edges.clone();
                            let dm = pipeline.default_model.clone();
                            join_set.spawn(async move {
                                execute_node(&a, &n, &r, &v, &i, &o, &c, &p, &h, &crx, &pn, &pe, false, dm.as_deref()).await
                            });
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
                        let delta_nr = result.clone();
                        let mut guard = active_run.lock().await;
                        if let Some(run) = guard.as_mut() {
                            run.state.node_results.insert(node_id.clone(), result);
                            emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
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
                    let delta_nr = result.clone();
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), result);
                        emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
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
                            let delta_nr = result.clone();
                            let mut guard = active_run.lock().await;
                            if let Some(run) = guard.as_mut() {
                                run.state.node_results.insert(node_id.clone(), result);
                                emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
                            }
                            continue;
                        }
                    };

                // Emit running status for the sub-pipeline node
                {
                    let nr = NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Running,
                        exit_code: None,
                        output: format!("Executing sub-pipeline '{}'", pipeline_ref),
                        started_at: Some(now_iso()),
                        finished_at: None,
                        attempt: 1,
                        cost_usd: None,
                    };
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.current_node = Some(node_id.clone());
                        run.state.node_results.insert(node_id.clone(), nr.clone());
                        emit_run_delta(app, node_delta(run_id, nr, None, Some(Some(node_id.clone())), None));
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
                    cancel_rx,
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
                    let delta_nr = result.clone();
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), result);
                        run.state.total_cost_usd = run
                            .state
                            .node_results
                            .values()
                            .filter_map(|r| r.cost_usd)
                            .sum();
                        // Budget check after sub-pipeline
                        let budget_status = if let Some(limit) = pipeline.max_cost_usd {
                            if run.state.total_cost_usd > limit {
                                emit_node_log(
                                    app, run_id, node_id,
                                    &format!("Budget limit exceeded: ${:.4} > ${:.2}", run.state.total_cost_usd, limit),
                                );
                                run.cancelled = true;
                                let _ = run.cancel_tx.send(true);
                                run.state.status = "budget_exceeded".to_string();
                                Some("budget_exceeded")
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        emit_run_delta(app, node_delta(run_id, delta_nr, budget_status, None, Some(run.state.total_cost_usd)));
                    }
                }
                continue;
            }

            // Emit running status
            {
                let nr = NodeResult {
                    node_id: node_id.clone(),
                    status: NodeStatus::Running,
                    exit_code: None,
                    output: String::new(),
                    started_at: Some(now_iso()),
                    finished_at: None,
                    attempt: 1,
                    cost_usd: None,
                };
                let mut guard = active_run.lock().await;
                if let Some(run) = guard.as_mut() {
                    run.state.current_node = Some(node_id.clone());
                    run.state.node_results.insert(node_id.clone(), nr.clone());
                    emit_run_delta(app, node_delta(run_id, nr, None, Some(Some(node_id.clone())), None));
                }
            }

            // Determine whether this node should continue the Claude session
            let continue_session = if node.node_type == "ai-task"
                && pipeline.shared_session
                && has_run_ai_node
            {
                // Continue only if the agent matches the last AI node's agent
                node.agent == last_ai_agent
            } else {
                false
            };

            let a = app.clone();
            let n = node.clone();
            let r = run_id.to_string();
            let v = pipeline.variables.clone();
            let i = inputs.clone();
            let o = node_outputs.clone();
            let c = cli_path.to_string();
            let p = project_path.to_string();
            let h = active_run.clone();
            let crx = cancel_rx.clone();
            let pn = pipeline.name.clone();
            let pe = pipeline.edges.clone();
            let dm = pipeline.default_model.clone();
            join_set.spawn(
                async move { execute_node(&a, &n, &r, &v, &i, &o, &c, &p, &h, &crx, &pn, &pe, continue_session, dm.as_deref()).await },
            );
        }

        while let Some(handle_result) = join_set.join_next().await {
            if let Ok(result) = handle_result {
                // Update session sharing state after AI node execution
                if let Some(node) = node_map.get(&result.node_id) {
                    if node.node_type == "ai-task" && result.status == NodeStatus::Success {
                        has_run_ai_node = true;
                        last_ai_agent = node.agent.clone();
                    }
                }

                // Persist step to DB (fire-and-forget to avoid blocking execution loop)
                let node = node_map.get(&result.node_id);
                let node_name = node.map(|n| n.name.as_str()).unwrap_or("").to_string();
                // For cacheable AI nodes, use the cache key (resolved instructions + model)
                // so that find_cached_step can match on the same hash
                let instr_hash = node
                    .map(|n| {
                        if n.cache && n.node_type == "ai-task" {
                            let mut resolved = n.instructions.clone();
                            for (k, v) in &pipeline.variables {
                                resolved = resolved.replace(&format!("${}", k), v);
                                resolved = resolved.replace(&format!("${{{}}}", k), v);
                            }
                            for (k, v) in inputs {
                                resolved = resolved.replace(&format!("{{input.{}}}", k), v);
                                resolved = resolved.replace(&format!("{{{}}}", k), v);
                            }
                            for (k, v) in &node_outputs {
                                resolved = resolved.replace(&format!("{{output.{}}}", k), v);
                            }
                            let eff_model = n.model.as_deref().or(pipeline.default_model.as_deref()).unwrap_or("");
                            hash_instructions(&format!("{}\n{}", resolved, eff_model))
                        } else {
                            hash_instructions(&n.instructions)
                        }
                    })
                    .unwrap_or_default();
                let status_str = match &result.status {
                    NodeStatus::Success => "Success",
                    NodeStatus::Failed => "Failed",
                    NodeStatus::Cancelled => "Cancelled",
                    NodeStatus::Skipped => "Skipped",
                    NodeStatus::Running => "Running",
                    NodeStatus::Pending => "Pending",
                };
                {
                    let db_pool = pool.clone();
                    let db_run_id = run_id.to_string();
                    let db_node_id = result.node_id.clone();
                    let db_node_name = node_name.clone();
                    let db_status = status_str.to_string();
                    let db_attempt = result.attempt as i32;
                    let db_hash = instr_hash.clone();
                    let db_exit_code = result.exit_code;
                    let db_cost = result.cost_usd;
                    let db_is_approval = node.map(|n| n.node_type == "approval-gate").unwrap_or(false);
                    let db_approval_state = if db_is_approval {
                        Some(if result.status == NodeStatus::Success { "approved" } else { "rejected" }.to_string())
                    } else {
                        None
                    };
                    let db_model = node
                        .and_then(|n| n.model.as_deref().or(pipeline.default_model.as_deref()))
                        .unwrap_or("claude")
                        .to_string();
                    let db_output = result.output.clone();
                    tokio::spawn(async move {
                        let _ = db::insert_complete_run_step(
                            &db_pool, &db_run_id, &db_node_id, &db_node_name,
                            &db_status, db_attempt, &db_hash,
                            db_exit_code, Some(&db_output),
                            db_cost, Some(&db_model),
                            db_approval_state.as_deref(),
                        ).await;
                    });
                }

                // Store output for downstream node substitution
                if result.status == NodeStatus::Success && !result.output.is_empty() {
                    node_outputs.insert(result.node_id.clone(), result.output.clone());
                    // Also key by slugified node name for convenience
                    if let Some(n) = node {
                        let slug: String = n.name.to_lowercase()
                            .chars()
                            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
                            .collect();
                        node_outputs.insert(slug, result.output.clone());
                    }
                    // Parse structured outputs (--- OUTPUTS --- JSON block)
                    // and store each key-value pair individually so downstream
                    // shell nodes can access them as $BRANCH_NAME, $WORKTREE_PATH, etc.
                    if let Some(parsed) = parse_structured_outputs(&result.output) {
                        for (k, v) in &parsed {
                            node_outputs.insert(k.clone(), v.clone());
                        }
                        let keys: Vec<&str> = parsed.keys().map(|k| k.as_str()).collect();
                        log::info!(
                            "Parsed structured outputs from node {}: {:?}",
                            result.node_id, keys
                        );
                    }
                }

                // Check if this node has outgoing back edges that should fire
                if let Some(targets) = back_edge_map.get(&result.node_id) {
                    for (target, condition) in targets {
                        if should_execute_edge(condition, &result.status) {
                            let count = reexec_counts.get(target).copied().unwrap_or(0);
                            if count < MAX_BACK_EDGE_REEXECUTIONS {
                                log::info!(
                                    "Back-edge triggered: re-executing {} (attempt {}/{})",
                                    target,
                                    count + 1,
                                    MAX_BACK_EDGE_REEXECUTIONS
                                );
                                emit_node_log(
                                    app,
                                    run_id,
                                    target,
                                    &format!(
                                        "Back-edge triggered: re-executing (retry {}/{})",
                                        count + 1,
                                        MAX_BACK_EDGE_REEXECUTIONS
                                    ),
                                );
                                requeue.push(target.clone());
                                *reexec_counts.entry(target.clone()).or_insert(0) += 1;
                                // Clear prior result so the node runs fresh
                                results.remove(target);
                                skipped.remove(target);
                            } else {
                                log::warn!(
                                    "Back-edge to {} exceeded max re-executions ({}), skipping",
                                    target,
                                    MAX_BACK_EDGE_REEXECUTIONS
                                );
                                emit_node_log(
                                    app,
                                    run_id,
                                    target,
                                    &format!(
                                        "Back-edge re-execution limit reached ({} max)",
                                        MAX_BACK_EDGE_REEXECUTIONS
                                    ),
                                );
                            }
                        }
                    }
                }

                results.insert(result.node_id.clone(), result.clone());
                let delta_nr = result.clone();
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
                    // Budget check
                    let budget_status = if let Some(limit) = pipeline.max_cost_usd {
                        if run.state.total_cost_usd > limit {
                            emit_node_log(
                                app, run_id, &run.state.current_node.clone().unwrap_or_default(),
                                &format!("Budget limit exceeded: ${:.4} > ${:.2}", run.state.total_cost_usd, limit),
                            );
                            run.cancelled = true;
                            let _ = run.cancel_tx.send(true);
                            run.state.status = "budget_exceeded".to_string();
                            Some("budget_exceeded")
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    emit_run_delta(app, node_delta(run_id, delta_nr, budget_status, None, Some(run.state.total_cost_usd)));
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
                    let delta_nr = gr.clone();
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(node_id.clone(), gr);
                        emit_run_delta(app, node_delta(run_id, delta_nr, None, None, None));
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

    // Process re-queued nodes from back edges.
    // Each re-queued node runs from its position in the execution order forward,
    // which may trigger further re-queues (up to the per-node limit).
    while !requeue.is_empty() {
        let batch: Vec<String> = requeue.drain(..).collect();

        // Check cancellation before processing re-queue batch
        {
            let g = active_run.lock().await;
            if g.as_ref().map(|r| r.cancelled).unwrap_or(false) {
                break;
            }
        }

        // Find the re-queued nodes in topological order and re-execute them
        // plus all their downstream dependents
        let requeue_set: HashSet<String> = batch.into_iter().collect();
        let mut pending_from_requeue: HashSet<String> = requeue_set.clone();

        // Walk the execution order and collect all nodes reachable from re-queued roots
        let forward_adj: HashMap<String, Vec<String>> = {
            let mut adj: HashMap<String, Vec<String>> = HashMap::new();
            for edge in &pipeline.edges {
                if !back_edges.contains(&(edge.from.clone(), edge.to.clone())) {
                    adj.entry(edge.from.clone())
                        .or_default()
                        .push(edge.to.clone());
                }
            }
            adj
        };
        // BFS to find all downstream nodes from re-queued roots
        let mut bfs_queue: Vec<String> = requeue_set.iter().cloned().collect();
        while let Some(n) = bfs_queue.pop() {
            if let Some(children) = forward_adj.get(&n) {
                for child in children {
                    if pending_from_requeue.insert(child.clone()) {
                        bfs_queue.push(child.clone());
                    }
                }
            }
        }

        // Re-execute in topological order
        for level in &exec_order {
            let mut join_set = tokio::task::JoinSet::new();
            for node_id in level {
                if !pending_from_requeue.contains(node_id) {
                    continue;
                }

                let Some(node) = node_map.get(node_id) else {
                    continue;
                };

                // Check if incoming forward edges allow execution
                let any_allows = {
                    let incoming: Vec<_> = pipeline
                        .edges
                        .iter()
                        .filter(|e| e.to == *node_id && !back_edges.contains(&(e.from.clone(), e.to.clone())))
                        .collect();
                    incoming.is_empty()
                        || incoming.iter().any(|e| {
                            results
                                .get(&e.from)
                                .map(|r| should_execute_edge(&e.condition, &r.status))
                                .unwrap_or(true)
                        })
                };
                if !any_allows {
                    skipped.insert(node_id.clone());
                    continue;
                }

                // Emit running status
                {
                    let nr = NodeResult {
                        node_id: node_id.clone(),
                        status: NodeStatus::Running,
                        exit_code: None,
                        output: String::new(),
                        started_at: Some(now_iso()),
                        finished_at: None,
                        attempt: 1,
                        cost_usd: None,
                    };
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.current_node = Some(node_id.clone());
                        run.state.node_results.insert(node_id.clone(), nr.clone());
                        emit_run_delta(app, node_delta(run_id, nr, None, Some(Some(node_id.clone())), None));
                    }
                }

                let a = app.clone();
                let n = node.clone();
                let r = run_id.to_string();
                let v = pipeline.variables.clone();
                let i = inputs.clone();
                let o = node_outputs.clone();
                let c = cli_path.to_string();
                let p = project_path.to_string();
                let h = active_run.clone();
                let crx = cancel_rx.clone();
                let pn = pipeline.name.clone();
                let pe = pipeline.edges.clone();
                let dm = pipeline.default_model.clone();
                // Re-queued nodes start fresh sessions (back-edge re-executions)
                join_set.spawn(async move {
                    execute_node(&a, &n, &r, &v, &i, &o, &c, &p, &h, &crx, &pn, &pe, false, dm.as_deref()).await
                });
            }

            while let Some(handle_result) = join_set.join_next().await {
                if let Ok(result) = handle_result {
                    let node = node_map.get(&result.node_id);
                    let node_name = node.map(|n| n.name.as_str()).unwrap_or("").to_string();
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

                    // Fire-and-forget DB write for requeue loop (single consolidated insert)
                    {
                        let db_pool = pool.clone();
                        let db_run_id = run_id.to_string();
                        let db_node_id = result.node_id.clone();
                        let db_node_name = node_name.clone();
                        let db_status = status_str.to_string();
                        let db_attempt = result.attempt as i32;
                        let db_hash = instr_hash.clone();
                        let db_exit_code = result.exit_code;
                        let db_cost = result.cost_usd;
                        let db_model = node
                            .and_then(|n| n.model.as_deref().or(pipeline.default_model.as_deref()))
                            .unwrap_or("claude")
                            .to_string();
                        let db_output = result.output.clone();
                        tokio::spawn(async move {
                            let _ = db::insert_complete_run_step(
                                &db_pool, &db_run_id, &db_node_id, &db_node_name,
                                &db_status, db_attempt, &db_hash,
                                db_exit_code, Some(&db_output),
                                db_cost, Some(&db_model), None,
                            ).await;
                        });
                    }

                    if result.status == NodeStatus::Success && !result.output.is_empty() {
                        node_outputs.insert(result.node_id.clone(), result.output.clone());
                        if let Some(n) = node {
                            let slug: String = n.name.to_lowercase()
                                .chars()
                                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
                                .collect();
                            node_outputs.insert(slug, result.output.clone());
                        }
                        if let Some(parsed) = parse_structured_outputs(&result.output) {
                            for (k, v) in &parsed {
                                node_outputs.insert(k.clone(), v.clone());
                            }
                        }
                    }

                    // Check back edges from re-executed node
                    if let Some(targets) = back_edge_map.get(&result.node_id) {
                        for (target, condition) in targets {
                            if should_execute_edge(condition, &result.status) {
                                let count = reexec_counts.get(target).copied().unwrap_or(0);
                                if count < MAX_BACK_EDGE_REEXECUTIONS {
                                    log::info!(
                                        "Back-edge triggered: re-executing {} (attempt {}/{})",
                                        target, count + 1, MAX_BACK_EDGE_REEXECUTIONS
                                    );
                                    emit_node_log(
                                        app, run_id, target,
                                        &format!(
                                            "Back-edge triggered: re-executing (retry {}/{})",
                                            count + 1, MAX_BACK_EDGE_REEXECUTIONS
                                        ),
                                    );
                                    requeue.push(target.clone());
                                    *reexec_counts.entry(target.clone()).or_insert(0) += 1;
                                    results.remove(target);
                                    skipped.remove(target);
                                } else {
                                    log::warn!(
                                        "Back-edge to {} exceeded max re-executions ({}), skipping",
                                        target, MAX_BACK_EDGE_REEXECUTIONS
                                    );
                                }
                            }
                        }
                    }

                    results.insert(result.node_id.clone(), result.clone());
                    let delta_nr = result.clone();
                    let mut guard = active_run.lock().await;
                    if let Some(run) = guard.as_mut() {
                        run.state.node_results.insert(result.node_id.clone(), result);
                        run.state.total_cost_usd = run.state.node_results.values().filter_map(|r| r.cost_usd).sum();
                        // Budget check in requeue loop
                        let budget_status = if let Some(limit) = pipeline.max_cost_usd {
                            if run.state.total_cost_usd > limit {
                                emit_node_log(
                                    app, run_id, &run.state.current_node.clone().unwrap_or_default(),
                                    &format!("Budget limit exceeded: ${:.4} > ${:.2}", run.state.total_cost_usd, limit),
                                );
                                run.cancelled = true;
                                let _ = run.cancel_tx.send(true);
                                run.state.status = "budget_exceeded".to_string();
                                Some("budget_exceeded")
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        emit_run_delta(app, node_delta(run_id, delta_nr, budget_status, None, Some(run.state.total_cost_usd)));
                    }
                }
            }

            // Check cancellation during re-queue processing
            {
                let g = active_run.lock().await;
                if g.as_ref().map(|r| r.cancelled).unwrap_or(false) {
                    break;
                }
            }
        }
    }

    let (cancelled, budget_exceeded) = {
        let guard = active_run.lock().await;
        let c = guard.as_ref().map(|r| r.cancelled).unwrap_or(false);
        let b = guard
            .as_ref()
            .map(|r| r.state.status == "budget_exceeded")
            .unwrap_or(false);
        (c, b)
    };
    if budget_exceeded {
        "budget_exceeded".to_string()
    } else if cancelled {
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

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = active_run.lock().await;
        *guard = Some(ActiveRun {
            state: state.clone(),
            cancelled: false,
            approval_tx: None,
            cancel_tx,
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

        // Inject secrets into pipeline variables as secret.KEY_NAME
        let secrets = crate::secrets::load_secrets(&project_path);
        let mut pipeline = pipeline;
        for (k, v) in secrets {
            pipeline.variables.insert(format!("secret.{}", k), v);
        }

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
            &cancel_rx,
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

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = active_run.lock().await;
        *guard = Some(ActiveRun {
            state: state.clone(),
            cancelled: false,
            approval_tx: None,
            cancel_tx,
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

        // Inject secrets into pipeline variables as secret.KEY_NAME
        let secrets = crate::secrets::load_secrets(&project_path);
        let mut pipeline = pipeline;
        for (k, v) in secrets {
            pipeline.variables.insert(format!("secret.{}", k), v);
        }

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
            &cancel_rx,
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
        let _ = run.cancel_tx.send(true);
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

#[derive(Debug, Serialize)]
pub struct RunEstimate {
    pub ai_node_count: usize,
    pub shell_node_count: usize,
    pub other_node_count: usize,
    pub avg_ai_cost: Option<f64>,
    pub estimated_low: Option<f64>,
    pub estimated_high: Option<f64>,
    pub max_cost_usd: Option<f64>,
}

#[tauri::command]
pub async fn estimate_run(
    app: AppHandle,
    pipeline: Pipeline,
) -> Result<RunEstimate, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;

    let ai_count = pipeline
        .nodes
        .iter()
        .filter(|n| n.node_type == "ai-task")
        .count();
    let shell_count = pipeline
        .nodes
        .iter()
        .filter(|n| n.node_type == "shell" || n.node_type == "git")
        .count();
    let other_count = pipeline.nodes.len() - ai_count - shell_count;

    let avg = db::get_avg_ai_step_cost(&pool).await?;

    let (low, high) = if let Some(avg_cost) = avg {
        if ai_count > 0 {
            (
                Some(avg_cost * ai_count as f64 * 0.5),
                Some(avg_cost * ai_count as f64 * 1.5),
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    Ok(RunEstimate {
        ai_node_count: ai_count,
        shell_node_count: shell_count,
        other_node_count: other_count,
        avg_ai_cost: avg,
        estimated_low: low,
        estimated_high: high,
        max_cost_usd: pipeline.max_cost_usd,
    })
}

#[tauri::command]
pub async fn get_avg_ai_cost(app: AppHandle) -> Result<Option<f64>, String> {
    let pool = app
        .try_state::<SqlitePool>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "Database not available".to_string())?;
    db::get_avg_ai_step_cost(&pool).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline_engine::{Pipeline, PipelineEdge, PipelineNode, Position};

    fn make_node(id: &str, name: &str) -> PipelineNode {
        PipelineNode {
            id: id.into(),
            name: name.into(),
            node_type: "shell".into(),
            instructions: format!("echo {}", id),
            agent: None,
            inputs: vec![],
            outputs: vec![],
            retry: None,
            timeout: None,
            children: None,
            pipeline_ref: None,
            requires_tools: vec![],
            model: None,
            cache: false,
            position: Position { x: 0.0, y: 0.0 },
        }
    }

    fn make_edge(from: &str, to: &str, condition: Option<&str>) -> PipelineEdge {
        PipelineEdge {
            id: format!("{}->{}", from, to),
            from: from.into(),
            to: to.into(),
            condition: condition.map(|s| s.to_string()),
        }
    }

    // --- parse_cost_from_stderr ---

    #[test]
    fn parse_cost_total_cost_line() {
        let lines = vec![
            "Some output".into(),
            "Total cost: $0.0042".into(),
        ];
        assert_eq!(parse_cost_from_stderr(&lines), Some(0.0042));
    }

    #[test]
    fn parse_cost_no_cost() {
        let lines = vec!["No cost info here".into()];
        assert_eq!(parse_cost_from_stderr(&lines), None);
    }

    #[test]
    fn parse_cost_empty() {
        let lines: Vec<String> = vec![];
        assert_eq!(parse_cost_from_stderr(&lines), None);
    }

    #[test]
    fn parse_cost_json_format() {
        let lines = vec![r#"{"total_cost_usd": 1.23}"#.into()];
        assert_eq!(parse_cost_from_stderr(&lines), Some(1.23));
    }

    #[test]
    fn parse_cost_picks_last_match() {
        let lines = vec![
            "Total cost: $0.01".into(),
            "Total cost: $0.05".into(),
        ];
        // iter().rev() finds the last one first
        assert_eq!(parse_cost_from_stderr(&lines), Some(0.05));
    }

    // --- hash_instructions ---

    #[test]
    fn hash_instructions_deterministic() {
        let h1 = hash_instructions("echo hello");
        let h2 = hash_instructions("echo hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_instructions_different_inputs() {
        let h1 = hash_instructions("echo hello");
        let h2 = hash_instructions("echo world");
        assert_ne!(h1, h2);
    }

    // --- hash_pipeline ---

    #[test]
    fn hash_pipeline_deterministic() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A"), make_node("b", "B")],
            edges: vec![make_edge("a", "b", None)],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let h1 = hash_pipeline(&p);
        let h2 = hash_pipeline(&p);
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_pipeline_changes_with_instructions() {
        let mut p1 = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A")],
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let h1 = hash_pipeline(&p1);
        p1.nodes[0].instructions = "echo changed".into();
        let h2 = hash_pipeline(&p1);
        assert_ne!(h1, h2);
    }

    // --- should_execute_edge ---

    #[test]
    fn edge_no_condition_always_fires() {
        assert!(should_execute_edge(&None, &NodeStatus::Success));
        assert!(should_execute_edge(&None, &NodeStatus::Failed));
        assert!(should_execute_edge(&None, &NodeStatus::Cancelled));
    }

    #[test]
    fn edge_success_condition() {
        assert!(should_execute_edge(&Some("success".into()), &NodeStatus::Success));
        assert!(!should_execute_edge(&Some("success".into()), &NodeStatus::Failed));
    }

    #[test]
    fn edge_failure_condition() {
        assert!(!should_execute_edge(&Some("failure".into()), &NodeStatus::Success));
        assert!(should_execute_edge(&Some("failure".into()), &NodeStatus::Failed));
    }

    #[test]
    fn edge_always_condition() {
        assert!(should_execute_edge(&Some("always".into()), &NodeStatus::Success));
        assert!(should_execute_edge(&Some("always".into()), &NodeStatus::Failed));
    }

    // --- build_execution_order ---

    #[test]
    fn exec_order_linear_chain() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A"), make_node("b", "B"), make_node("c", "C")],
            edges: vec![make_edge("a", "b", None), make_edge("b", "c", None)],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        assert_eq!(order.len(), 3);
        assert_eq!(order[0], vec!["a"]);
        assert_eq!(order[1], vec!["b"]);
        assert_eq!(order[2], vec!["c"]);
        assert!(back_edges.is_empty());
    }

    #[test]
    fn exec_order_parallel_roots() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A"), make_node("b", "B")],
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        assert_eq!(order.len(), 1);
        assert_eq!(order[0].len(), 2);
        assert!(back_edges.is_empty());
    }

    #[test]
    fn exec_order_diamond() {
        // a -> b, a -> c, b -> d, c -> d
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![
                make_node("a", "A"),
                make_node("b", "B"),
                make_node("c", "C"),
                make_node("d", "D"),
            ],
            edges: vec![
                make_edge("a", "b", None),
                make_edge("a", "c", None),
                make_edge("b", "d", None),
                make_edge("c", "d", None),
            ],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        assert_eq!(order.len(), 3);
        assert_eq!(order[0], vec!["a"]);
        assert_eq!(order[1].len(), 2); // b and c in parallel
        assert_eq!(order[2], vec!["d"]);
        assert!(back_edges.is_empty());
    }

    #[test]
    fn exec_order_empty_pipeline() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![],
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        assert!(order.is_empty());
        assert!(back_edges.is_empty());
    }

    // --- back edges ---

    #[test]
    fn exec_order_with_back_edge_includes_all_nodes() {
        // Pipeline: a -> b -> c -> a (back edge on failure)
        // Without back-edge handling, Kahn's algorithm would drop b and c.
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A"), make_node("b", "B"), make_node("c", "C")],
            edges: vec![
                make_edge("a", "b", None),
                make_edge("b", "c", None),
                make_edge("c", "a", Some("failure")), // back edge
            ],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        // All 3 nodes should be in the execution order (back edge excluded from in-degree)
        let all_nodes: HashSet<String> = order.iter().flat_map(|level| level.iter().cloned()).collect();
        assert!(all_nodes.contains("a"), "node 'a' should be in execution order");
        assert!(all_nodes.contains("b"), "node 'b' should be in execution order");
        assert!(all_nodes.contains("c"), "node 'c' should be in execution order");
        assert_eq!(order.len(), 3); // a, then b, then c
        // The c->a edge should be detected as a back edge
        assert!(back_edges.contains(&("c".to_string(), "a".to_string())));
        assert_eq!(back_edges.len(), 1);
    }

    #[test]
    fn exec_order_complex_with_back_edge() {
        // a -> b -> c -> d, d -> b (back edge on failure)
        // Should produce: [a], [b], [c], [d] with d->b as back edge
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![
                make_node("a", "A"),
                make_node("b", "B"),
                make_node("c", "C"),
                make_node("d", "D"),
            ],
            edges: vec![
                make_edge("a", "b", None),
                make_edge("b", "c", None),
                make_edge("c", "d", None),
                make_edge("d", "b", Some("failure")),
            ],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let (order, back_edges) = build_execution_order(&p);
        let all_nodes: HashSet<String> = order.iter().flat_map(|level| level.iter().cloned()).collect();
        assert_eq!(all_nodes.len(), 4);
        assert!(back_edges.contains(&("d".to_string(), "b".to_string())));
        assert_eq!(back_edges.len(), 1);
    }

    #[test]
    fn find_back_edges_no_cycle() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A"), make_node("b", "B")],
            edges: vec![make_edge("a", "b", None)],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        assert!(find_back_edges(&p).is_empty());
    }

    #[test]
    fn find_back_edges_self_loop() {
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![make_node("a", "A")],
            edges: vec![make_edge("a", "a", Some("failure"))],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        let back = find_back_edges(&p);
        assert_eq!(back.len(), 1);
        assert!(back.contains(&("a".to_string(), "a".to_string())));
    }

    // --- cost parsing (broadened) ---

    #[test]
    fn parse_cost_case_insensitive() {
        let lines = vec!["total cost: $0.0078".into()];
        assert_eq!(parse_cost_from_stderr(&lines), Some(0.0078));
    }

    #[test]
    fn parse_cost_uppercase() {
        let lines = vec!["TOTAL COST: $2.50".into()];
        assert_eq!(parse_cost_from_stderr(&lines), Some(2.50));
    }

    #[test]
    fn parse_cost_without_total_prefix() {
        let lines = vec!["Session cost: $0.15".into()];
        assert_eq!(parse_cost_from_stderr(&lines), Some(0.15));
    }

    #[test]
    fn parse_cost_dollar_on_cost_line() {
        let lines = vec!["API cost was $3.42 for this run".into()];
        assert_eq!(parse_cost_from_stderr(&lines), Some(3.42));
    }

    // --- validate_sub_pipeline_refs ---

    #[test]
    fn validate_sub_pipeline_refs_ok() {
        let mut node = make_node("a", "Sub");
        node.node_type = "sub-pipeline".into();
        node.pipeline_ref = Some("other-pipeline".into());
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![node],
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        assert!(validate_sub_pipeline_refs(&p).is_ok());
    }

    #[test]
    fn validate_sub_pipeline_refs_missing() {
        let mut node = make_node("a", "Sub");
        node.node_type = "sub-pipeline".into();
        let p = Pipeline {
            name: "test".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes: vec![node],
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };
        assert!(validate_sub_pipeline_refs(&p).is_err());
    }

    // --- shared_session deserialization ---

    #[test]
    fn shared_session_defaults_to_true() {
        let json = r#"{
            "name": "test",
            "description": "",
            "version": "1.0",
            "variables": {},
            "nodes": [],
            "edges": []
        }"#;
        let p: Pipeline = serde_json::from_str(json).unwrap();
        assert!(p.shared_session);
    }

    #[test]
    fn shared_session_can_be_disabled() {
        let json = r#"{
            "name": "test",
            "description": "",
            "version": "1.0",
            "variables": {},
            "nodes": [],
            "edges": [],
            "shared_session": false
        }"#;
        let p: Pipeline = serde_json::from_str(json).unwrap();
        assert!(!p.shared_session);
    }
}
