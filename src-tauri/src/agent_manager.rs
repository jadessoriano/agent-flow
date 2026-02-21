use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentInfo {
    pub name: String,
    pub display_name: String,
    pub path: String,
    pub description: String,
    pub origin: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentContent {
    pub name: String,
    pub path: String,
    pub content: String,
}

fn agents_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".claude").join("agents")
}

fn extract_description(content: &str) -> String {
    // Skip leading blank lines and headings, grab the first meaningful paragraph
    let mut lines = content.lines().peekable();
    let mut description = String::new();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        // Skip empty lines and markdown headings at the top
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Found first content line — collect until blank line
        description.push_str(trimmed);
        while let Some(next) = lines.peek() {
            if next.trim().is_empty() {
                break;
            }
            description.push(' ');
            description.push_str(next.trim());
            lines.next();
        }
        break;
    }

    // Truncate to ~120 chars
    if description.len() > 120 {
        let truncated = &description[..120];
        // Try to break at a word boundary
        if let Some(pos) = truncated.rfind(' ') {
            return format!("{}...", &truncated[..pos]);
        }
        return format!("{}...", truncated);
    }

    description
}

fn name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string()
}

#[tauri::command]
pub fn list_agents(project_path: String) -> Result<Vec<AgentInfo>, String> {
    let dir = agents_dir(&project_path);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read agents dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let content =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
            let raw_name = name_from_path(&path);
            let (display_name, origin) = if raw_name.starts_with("_pipeline--") {
                (
                    raw_name.strip_prefix("_pipeline--").unwrap().to_string(),
                    "pipeline".to_string(),
                )
            } else {
                (raw_name.clone(), "manual".to_string())
            };
            agents.push(AgentInfo {
                name: raw_name,
                display_name,
                path: path.to_string_lossy().to_string(),
                description: extract_description(&content),
                origin,
            });
        }
    }

    agents.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(agents)
}

#[tauri::command]
pub fn read_agent(path: String) -> Result<AgentContent, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Agent file not found: {}", path));
    }

    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read agent: {}", e))?;

    Ok(AgentContent {
        name: name_from_path(file_path),
        path,
        content,
    })
}

#[tauri::command]
pub fn write_agent(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write agent: {}", e))
}

#[tauri::command]
pub fn delete_agent(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete agent: {}", e))
}

#[tauri::command]
pub fn create_agent(project_path: String, name: String, content: String) -> Result<String, String> {
    let dir = agents_dir(&project_path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create agents dir: {}", e))?;

    // Sanitize name for filename
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    if safe_name.starts_with("_pipeline--") {
        return Err("Names starting with '_pipeline--' are reserved for pipeline-generated agents".into());
    }

    let file_path = dir.join(format!("{}.md", safe_name));
    if file_path.exists() {
        return Err(format!("Agent '{}' already exists", safe_name));
    }

    fs::write(&file_path, &content).map_err(|e| format!("Failed to create agent file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
