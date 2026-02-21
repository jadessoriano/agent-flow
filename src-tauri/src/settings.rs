use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub claude_cli_path: Option<String>,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            claude_cli_path: None,
            theme: "dark".to_string(),
        }
    }
}

fn settings_path(app: &AppHandle) -> std::path::PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("settings.json")
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app);
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse settings: {}", e))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app);
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to save settings: {}", e))
}

/// Verify a candidate path is an executable file.
fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = path.metadata() {
            return meta.permissions().mode() & 0o111 != 0;
        }
    }
    #[cfg(not(unix))]
    {
        return true; // On non-unix, existence is good enough
    }
    false
}

/// Build a list of candidate paths where the Claude CLI might live.
fn candidate_paths() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut paths = Vec::new();

    if !home.is_empty() {
        let h = Path::new(&home);

        // npm global installs (nvm, fnm, direct)
        // Walk nvm versions dir for all installed node versions
        let nvm_dir = std::env::var("NVM_DIR")
            .unwrap_or_else(|_| format!("{}/.nvm", home));
        let versions_dir = Path::new(&nvm_dir).join("versions").join("node");
        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                paths.push(entry.path().join("bin").join("claude"));
            }
        }

        // fnm
        let fnm_dir = h.join(".local").join("share").join("fnm").join("node-versions");
        if let Ok(entries) = fs::read_dir(&fnm_dir) {
            for entry in entries.flatten() {
                paths.push(entry.path().join("installation").join("bin").join("claude"));
            }
        }

        // bun global
        paths.push(h.join(".bun").join("bin").join("claude"));

        // npm global (no version manager)
        paths.push(h.join(".npm-global").join("bin").join("claude"));

        // Claude Desktop / local installs
        paths.push(h.join(".claude").join("local").join("claude"));

        // Cargo-installed (unlikely but possible)
        paths.push(h.join(".cargo").join("bin").join("claude"));

        // Local bin
        paths.push(h.join(".local").join("bin").join("claude"));
    }

    // Homebrew (macOS)
    paths.push(PathBuf::from("/opt/homebrew/bin/claude"));
    // Homebrew (Linux linuxbrew)
    paths.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin/claude"));

    // System-wide
    paths.push(PathBuf::from("/usr/local/bin/claude"));
    paths.push(PathBuf::from("/usr/bin/claude"));

    // Snap
    paths.push(PathBuf::from("/snap/bin/claude"));

    paths
}

#[derive(Debug, Serialize, Clone)]
pub struct CliDetectResult {
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: Option<String>,
}

/// Identify which install source a path belongs to.
fn identify_source(path: &str) -> String {
    if path.contains(".nvm/") {
        "nvm (Node.js)".to_string()
    } else if path.contains("fnm") {
        "fnm (Node.js)".to_string()
    } else if path.contains(".bun/") {
        "bun".to_string()
    } else if path.contains(".claude/local") {
        "Claude Desktop".to_string()
    } else if path.contains("homebrew") || path.contains("linuxbrew") {
        "Homebrew".to_string()
    } else if path.contains(".npm-global") {
        "npm global".to_string()
    } else if path.contains("/snap/") {
        "snap".to_string()
    } else if path.starts_with("/usr/local") || path.starts_with("/usr/bin") {
        "system PATH".to_string()
    } else {
        "PATH".to_string()
    }
}

/// Try to get the version string from a Claude binary.
fn get_cli_version(path: &str) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    if output.status.success() {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ver.is_empty() {
            return Some(ver);
        }
    }
    None
}

#[tauri::command]
pub fn detect_claude_cli() -> Result<Option<String>, String> {
    let result = detect_claude_cli_detailed()?;
    Ok(result.path)
}

#[tauri::command]
pub fn detect_claude_cli_detailed() -> Result<CliDetectResult, String> {
    // 1. Try `which claude` first (respects user's PATH)
    if let Ok(output) = Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && is_executable(Path::new(&path)) {
                let source = identify_source(&path);
                let version = get_cli_version(&path);
                return Ok(CliDetectResult {
                    path: Some(path),
                    version,
                    source: Some(source),
                });
            }
        }
    }

    // 2. Probe known install locations
    for candidate in candidate_paths() {
        if is_executable(&candidate) {
            let path_str = candidate.to_string_lossy().to_string();
            let source = identify_source(&path_str);
            let version = get_cli_version(&path_str);
            return Ok(CliDetectResult {
                path: Some(path_str),
                version,
                source: Some(source),
            });
        }
    }

    // 3. Nothing found
    log::warn!("Claude CLI not found in any known location");
    Ok(CliDetectResult {
        path: None,
        version: None,
        source: None,
    })
}
