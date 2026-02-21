use serde::Serialize;
use std::fs;
use std::io::Write;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogInfo {
    pub path: String,
    pub size_bytes: u64,
    pub entries: Vec<LogEntry>,
}

fn log_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {}", e))?;
    Ok(log_dir.join("agentflow.log"))
}

fn parse_log_line(line: &str) -> Option<LogEntry> {
    // Format: [date][level][target] message
    // or: 2024-01-01T12:00:00.000 [LEVEL] message
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try bracket format: [2024-01-01][12:00:00][LEVEL] message
    if trimmed.starts_with('[') {
        let mut parts = Vec::new();
        let mut rest = trimmed;
        while rest.starts_with('[') {
            if let Some(end) = rest.find(']') {
                parts.push(&rest[1..end]);
                rest = &rest[end + 1..];
            } else {
                break;
            }
        }
        if parts.len() >= 3 {
            return Some(LogEntry {
                timestamp: format!("{} {}", parts[0], parts[1]),
                level: parts[2].to_string(),
                message: rest.trim().to_string(),
            });
        }
    }

    // Try ISO format: 2024-01-01T12:00:00 [LEVEL] message
    if trimmed.len() > 20 && trimmed.chars().nth(4) == Some('-') {
        if let Some(bracket_start) = trimmed.find('[') {
            if let Some(bracket_end) = trimmed[bracket_start..].find(']') {
                let timestamp = trimmed[..bracket_start].trim().to_string();
                let level = trimmed[bracket_start + 1..bracket_start + bracket_end].to_string();
                let message = trimmed[bracket_start + bracket_end + 1..].trim().to_string();
                return Some(LogEntry {
                    timestamp,
                    level,
                    message,
                });
            }
        }
    }

    // Fallback: treat entire line as message
    Some(LogEntry {
        timestamp: String::new(),
        level: "INFO".to_string(),
        message: trimmed.to_string(),
    })
}

#[tauri::command]
pub fn get_error_log(app: AppHandle, limit: Option<u32>) -> Result<LogInfo, String> {
    let path = log_file_path(&app)?;
    let path_str = path.to_string_lossy().to_string();

    if !path.exists() {
        return Ok(LogInfo {
            path: path_str,
            size_bytes: 0,
            entries: vec![],
        });
    }

    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read log metadata: {}", e))?;
    let size_bytes = metadata.len();

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read log file: {}", e))?;
    let max = limit.unwrap_or(200) as usize;

    let entries: Vec<LogEntry> = content
        .lines()
        .rev()
        .filter_map(|line| {
            let entry = parse_log_line(line)?;
            let level_upper = entry.level.to_uppercase();
            if level_upper.contains("ERROR") || level_upper.contains("WARN") {
                Some(entry)
            } else {
                None
            }
        })
        .take(max)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    Ok(LogInfo {
        path: path_str,
        size_bytes,
        entries,
    })
}

#[tauri::command]
pub fn get_full_log(app: AppHandle) -> Result<String, String> {
    let path = log_file_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read log file: {}", e))
}

#[tauri::command]
pub fn get_log_path(app: AppHandle) -> Result<String, String> {
    let path = log_file_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_error_log(app: AppHandle) -> Result<(), String> {
    let path = log_file_path(&app)?;
    if path.exists() {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| format!("Failed to truncate log: {}", e))?;
        file.flush().map_err(|e| format!("Failed to flush: {}", e))?;
    }
    Ok(())
}
