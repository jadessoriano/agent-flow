use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RetryPolicy {
    #[serde(default, alias = "max_attempts", alias = "retries", alias = "max_retries")]
    pub max: u32,
    #[serde(default, alias = "delay_seconds", alias = "delay_sec", alias = "delay_ms")]
    pub delay: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(default)]
    pub inputs: Vec<String>,
    #[serde(default)]
    pub outputs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<RetryPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires_tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default)]
    pub cache: bool,
    pub position: Position,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Pipeline {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub variables: HashMap<String, String>,
    pub nodes: Vec<PipelineNode>,
    pub edges: Vec<PipelineEdge>,
    #[serde(default = "default_true")]
    pub shared_session: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cost_usd: Option<f64>,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PipelineInfo {
    pub name: String,
    pub path: String,
    pub description: String,
    pub node_count: usize,
}

fn pipelines_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".claude").join("pipelines")
}

#[tauri::command]
pub fn list_pipelines(project_path: String) -> Result<Vec<PipelineInfo>, String> {
    let dir = pipelines_dir(&project_path);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut pipelines = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read pipelines dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".pipeline.json"))
            .unwrap_or(false)
        {
            let content =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
            if let Ok(pipeline) = serde_json::from_str::<Pipeline>(&content) {
                pipelines.push(PipelineInfo {
                    name: pipeline.name.clone(),
                    path: path.to_string_lossy().to_string(),
                    description: pipeline.description.clone(),
                    node_count: pipeline.nodes.len(),
                });
            }
        }
    }

    pipelines.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(pipelines)
}

#[tauri::command]
pub fn read_pipeline(path: String) -> Result<Pipeline, String> {
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read pipeline: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse pipeline: {}", e))
}

#[tauri::command]
pub fn write_pipeline(project_path: String, pipeline: Pipeline) -> Result<String, String> {
    let dir = pipelines_dir(&project_path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create pipelines dir: {}", e))?;

    let safe_name: String = pipeline
        .name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    let file_path = dir.join(format!("{}.pipeline.json", safe_name));
    let json = serde_json::to_string_pretty(&pipeline)
        .map_err(|e| format!("Failed to serialize pipeline: {}", e))?;
    fs::write(&file_path, &json).map_err(|e| format!("Failed to write pipeline file: {}", e))?;

    // Auto-generate agent markdown with _pipeline-- prefix
    let agents_dir = Path::new(&project_path).join(".claude").join("agents");
    fs::create_dir_all(&agents_dir).ok();

    // Migrate legacy (non-prefixed) auto-generated agent if present
    migrate_legacy_agent_md(&agents_dir, &safe_name);

    let md_content = generate_agent_markdown(&pipeline);
    let md_path = agents_dir.join(format!("_pipeline--{}.md", safe_name));
    fs::write(&md_path, md_content).ok();

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_pipeline(project_path: String, path: String) -> Result<(), String> {
    // Delete the pipeline JSON
    fs::remove_file(&path).map_err(|e| format!("Failed to delete pipeline: {}", e))?;

    // Try to delete the auto-generated agent md too
    if let Some(name) = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_suffix(".pipeline.json"))
    {
        let md_path = Path::new(&project_path)
            .join(".claude")
            .join("agents")
            .join(format!("_pipeline--{}.md", name));
        fs::remove_file(&md_path).ok();
        // Also clean up legacy (non-prefixed) auto-generated agent if present
        let legacy_md_path = Path::new(&project_path)
            .join(".claude")
            .join("agents")
            .join(format!("{}.md", name));
        if legacy_md_path.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_md_path) {
                if content.contains("auto-generated by AgentFlow") {
                    fs::remove_file(&legacy_md_path).ok();
                }
            }
        }
    }

    Ok(())
}

/// If a legacy `{safe_name}.md` exists in the agents dir and contains the
/// auto-generation marker, delete it so it can be replaced by the prefixed version.
/// User-created agents with the same name are left untouched.
fn migrate_legacy_agent_md(agents_dir: &Path, safe_name: &str) {
    let legacy_path = agents_dir.join(format!("{}.md", safe_name));
    if legacy_path.exists() {
        if let Ok(content) = fs::read_to_string(&legacy_path) {
            if content.contains("auto-generated by AgentFlow") {
                fs::remove_file(&legacy_path).ok();
            }
        }
    }
}

/// Load a pipeline by name from a project path.
pub fn load_pipeline_by_name(project_path: &str, name: &str) -> Result<Pipeline, String> {
    let safe_name = sanitize_name(name);
    let path = pipelines_dir(project_path).join(format!("{}.pipeline.json", safe_name));
    let content = fs::read_to_string(&path)
        .map_err(|_| format!("Pipeline '{}' not found at {}", name, path.display()))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse pipeline '{}': {}", name, e))
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

#[tauri::command]
pub fn rename_pipeline(
    project_path: String,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    // Read the existing pipeline
    let content =
        fs::read_to_string(&old_path).map_err(|e| format!("Failed to read pipeline: {}", e))?;
    let mut pipeline: Pipeline =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse pipeline: {}", e))?;

    // Compute old safe name from the existing file
    let old_safe_name = Path::new(&old_path)
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_suffix(".pipeline.json"))
        .ok_or_else(|| "Invalid pipeline path".to_string())?
        .to_string();

    let new_safe_name = sanitize_name(&new_name);

    // Update the pipeline name
    pipeline.name = new_name;

    // Write new pipeline JSON
    let dir = pipelines_dir(&project_path);
    let new_path = dir.join(format!("{}.pipeline.json", new_safe_name));
    let json = serde_json::to_string_pretty(&pipeline)
        .map_err(|e| format!("Failed to serialize pipeline: {}", e))?;
    fs::write(&new_path, &json).map_err(|e| format!("Failed to write pipeline file: {}", e))?;

    // Delete old pipeline file (if name actually changed)
    if old_safe_name != new_safe_name {
        fs::remove_file(&old_path).ok();
    }

    // Handle agent markdown files
    let agents_dir = Path::new(&project_path).join(".claude").join("agents");
    if agents_dir.exists() {
        // Delete old prefixed agent md
        let old_md = agents_dir.join(format!("_pipeline--{}.md", old_safe_name));
        fs::remove_file(&old_md).ok();
        // Also clean up legacy non-prefixed if present
        migrate_legacy_agent_md(&agents_dir, &old_safe_name);
    }

    // Write new prefixed agent md
    fs::create_dir_all(&agents_dir).ok();
    let md_content = generate_agent_markdown(&pipeline);
    let new_md = agents_dir.join(format!("_pipeline--{}.md", new_safe_name));
    fs::write(&new_md, md_content).ok();

    Ok(new_path.to_string_lossy().to_string())
}

const PIPELINE_SCHEMA_PROMPT: &str = r#"You are a pipeline generator. Given a user description, produce a JSON pipeline object. Respond with ONLY valid JSON — no markdown fences, no explanation, no extra text.

The JSON must match this exact schema:

{
  "name": "string — short pipeline name",
  "description": "string — one-line description",
  "version": "1.0.0",
  "variables": { "key": "default_value" },
  "default_model": null,
  "max_cost_usd": null,
  "nodes": [
    {
      "id": "node-1",
      "name": "string — human-readable step name",
      "type": "ai-task | shell | git | parallel | approval-gate | sub-pipeline",
      "instructions": "string — what this node should do (shell command for shell/git, prompt for ai-task)",
      "agent": null,
      "inputs": [],
      "outputs": [],
      "retry": null,
      "timeout": null,
      "children": null,
      "pipeline_ref": null,
      "requires_tools": [],
      "model": null,
      "cache": false,
      "position": { "x": 300, "y": 100 }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "from": "node-1",
      "to": "node-2",
      "condition": "success | failure | null"
    }
  ]
}

Field details:
- "retry": null OR {"max": 3, "delay": 5} — max is max retry attempts (integer), delay is seconds between retries (integer). Use EXACTLY these field names (not "retries", not "delay_seconds", not "max_attempts").
- "timeout": null OR integer (seconds) — max time before the node is killed.
- "children": null OR ["node-2", "node-3"] — only used for "parallel" type nodes, lists IDs of child nodes.
- "pipeline_ref": null OR "pipeline-name" — only used for "sub-pipeline" type nodes.
- "agent": null OR "agent-name" — only used for "ai-task" nodes, specifies a custom Claude agent.
- "requires_tools": [] — MCP tools required by ai-task nodes.
- "model": null OR "claude-sonnet-4-6" | "claude-opus-4-6" | "claude-haiku-4-5-20251001" — per-node model override for ai-task nodes.
- "cache": false — when true, reuse cached output if instructions haven't changed (ai-task only).
- "default_model": null OR model string — pipeline-level default model for all AI nodes.
- "max_cost_usd": null OR number — budget limit; pipeline stops if total cost exceeds this.

Node types:
- "shell": Run a shell command. Put the command in "instructions".
- "ai-task": Ask Claude to perform a task. Put the prompt in "instructions".
- "git": Run a git command. Put the command in "instructions" (e.g., "git add . && git commit -m 'message'").
- "parallel": A group node whose "children" array lists node IDs that run concurrently.
- "approval-gate": Pauses for human approval before continuing.
- "sub-pipeline": Calls another pipeline by name via "pipeline_ref".

Rules:
- Node IDs: "node-1", "node-2", etc.
- Edge IDs: "edge-1", "edge-2", etc.
- Lay out nodes top-to-bottom: first node at {x: 300, y: 100}, increment y by 150 for each subsequent node.
- Connect sequential nodes with edges. Use "condition": "success" for conditional flows.
- For parallel tasks, create a "parallel" node with children, then connect the parallel node to the next step.
- Keep the pipeline practical and minimal — don't over-engineer.
- Use "shell" type for running commands, linters, tests, builds, deployments.
- Use "ai-task" type when the step requires Claude to think, analyze, or generate content.
- The "variables" object should include any values the user might want to customize (e.g., branch names, environment names).

User's description:
"#;

#[tauri::command]
pub async fn generate_pipeline(
    prompt: String,
    cli_path: String,
    project_path: String,
) -> Result<Pipeline, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }

    let full_prompt = format!("{}{}\"\n\nRespond with ONLY the JSON object.", PIPELINE_SCHEMA_PROMPT, prompt);

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        Command::new(&cli_path)
            .arg("--print")
            .arg(&full_prompt)
            .current_dir(&project_path)
            .output(),
    )
    .await
    .map_err(|_| "Pipeline generation timed out after 120 seconds".to_string())?
    .map_err(|e| {
        log::error!("Failed to spawn Claude CLI at '{}': {}", cli_path, e);
        format!("Failed to spawn Claude CLI at '{}': {}", cli_path, e)
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("Claude CLI generation error: {}", stderr.trim());
        return Err(format!("Claude CLI exited with error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stdout = stdout.trim();

    // Try parsing directly first
    let pipeline: Pipeline = serde_json::from_str(stdout).or_else(|_| {
        // Fallback: extract JSON from markdown fences
        extract_json_from_fences(stdout)
            .ok_or_else(|| "No JSON block found".to_string())
            .and_then(|json| {
                serde_json::from_str(&json)
                    .map_err(|e| format!("Failed to parse extracted JSON: {}", e))
            })
    }).map_err(|e| format!("Failed to parse Claude's response as a pipeline: {}. Raw output starts with: {}", e, &stdout[..stdout.len().min(200)]))?;

    // Validate edge references
    let node_ids: Vec<&str> = pipeline.nodes.iter().map(|n| n.id.as_str()).collect();
    for edge in &pipeline.edges {
        if !node_ids.contains(&edge.from.as_str()) {
            return Err(format!("Edge '{}' references non-existent source node '{}'", edge.id, edge.from));
        }
        if !node_ids.contains(&edge.to.as_str()) {
            return Err(format!("Edge '{}' references non-existent target node '{}'", edge.id, edge.to));
        }
    }

    // If name is empty, generate from prompt
    let mut pipeline = pipeline;
    if pipeline.name.is_empty() {
        let name: String = prompt
            .chars()
            .take(30)
            .collect::<String>()
            .trim()
            .to_string();
        pipeline.name = if name.is_empty() {
            "Generated Pipeline".to_string()
        } else {
            name
        };
    }

    Ok(pipeline)
}

/// Extract JSON from markdown code fences (```json ... ``` or ``` ... ```)
fn extract_json_from_fences(text: &str) -> Option<String> {
    // Try ```json ... ```
    if let Some(start) = text.find("```json") {
        let json_start = start + 7; // length of "```json"
        if let Some(end) = text[json_start..].find("```") {
            return Some(text[json_start..json_start + end].trim().to_string());
        }
    }
    // Try ``` ... ```
    if let Some(start) = text.find("```") {
        let json_start = start + 3;
        if let Some(end) = text[json_start..].find("```") {
            return Some(text[json_start..json_start + end].trim().to_string());
        }
    }
    // Try finding raw JSON object
    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) {
        if start < end {
            return Some(text[start..=end].to_string());
        }
    }
    None
}

fn generate_agent_markdown(pipeline: &Pipeline) -> String {
    let mut md = String::new();

    md.push_str(&format!("# {}\n\n", pipeline.name));

    if !pipeline.description.is_empty() {
        md.push_str(&format!("{}\n\n", pipeline.description));
    }

    md.push_str("## Pipeline Steps\n\n");
    md.push_str("This agent was auto-generated by AgentFlow from a pipeline definition.\n\n");

    // Build execution order from edges
    for (i, node) in pipeline.nodes.iter().enumerate() {
        let type_label = match node.node_type.as_str() {
            "ai-task" => "AI Task",
            "shell" => "Shell Command",
            "git" => "Git Operation",
            "parallel" => "Parallel Group",
            "approval-gate" => "Approval Gate",
            "sub-pipeline" => "Sub-pipeline",
            _ => &node.node_type,
        };

        md.push_str(&format!(
            "### Step {}: {} ({})\n\n",
            i + 1,
            node.name,
            type_label
        ));

        if let Some(ref pref) = node.pipeline_ref {
            md.push_str(&format!("**References pipeline**: {}\n\n", pref));
        }

        if !node.instructions.is_empty() {
            md.push_str(&format!("{}\n\n", node.instructions));
        }

        if !node.inputs.is_empty() {
            md.push_str(&format!("**Inputs**: {}\n\n", node.inputs.join(", ")));
        }

        if !node.outputs.is_empty() {
            md.push_str(&format!("**Outputs**: {}\n\n", node.outputs.join(", ")));
        }

        if !node.requires_tools.is_empty() {
            md.push_str(&format!(
                "**Required MCP Tools**: {}\n\n",
                node.requires_tools.join(", ")
            ));
        }

        if let Some(retry) = &node.retry {
            md.push_str(&format!(
                "**Retry**: up to {} attempts, {}s delay\n\n",
                retry.max, retry.delay
            ));
        }
    }

    if !pipeline.variables.is_empty() {
        md.push_str("## Variables\n\n");
        for (key, value) in &pipeline.variables {
            md.push_str(&format!("- `{}`: {}\n", key, value));
        }
        md.push('\n');
    }

    md
}
