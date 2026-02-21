use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub has_claude_dir: bool,
    pub agent_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct RecentProjects {
    pub projects: Vec<RecentProject>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
}

fn recent_projects_path(app: &AppHandle) -> std::path::PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("recent_projects.json")
}

#[tauri::command]
pub fn scan_project(project_path: String) -> Result<ProjectInfo, String> {
    let path = Path::new(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Directory does not exist: {}", project_path));
    }

    let claude_dir = path.join(".claude");
    let agents_dir = claude_dir.join("agents");
    let has_claude_dir = claude_dir.exists();

    let agent_count = if agents_dir.exists() {
        fs::read_dir(&agents_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(ProjectInfo {
        path: project_path,
        name,
        has_claude_dir,
        agent_count,
    })
}

#[tauri::command]
pub fn init_project(project_path: String) -> Result<(), String> {
    let agents_dir = Path::new(&project_path).join(".claude").join("agents");
    fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create .claude/agents: {}", e))?;

    let pipelines_dir = Path::new(&project_path).join(".claude").join("pipelines");
    fs::create_dir_all(&pipelines_dir)
        .map_err(|e| format!("Failed to create .claude/pipelines: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_recent_projects(app: AppHandle) -> Result<RecentProjects, String> {
    let path = recent_projects_path(&app);
    if !path.exists() {
        return Ok(RecentProjects::default());
    }

    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read recent projects: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse recent projects: {}", e))
}

#[tauri::command]
pub fn add_recent_project(app: AppHandle, project_path: String) -> Result<(), String> {
    let file_path = recent_projects_path(&app);
    let mut recent = if file_path.exists() {
        let data = fs::read_to_string(&file_path).unwrap_or_default();
        serde_json::from_str::<RecentProjects>(&data).unwrap_or_default()
    } else {
        RecentProjects::default()
    };

    // Remove existing entry for this path
    recent.projects.retain(|p| p.path != project_path);

    let name = Path::new(&project_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Insert at front
    recent.projects.insert(
        0,
        RecentProject {
            path: project_path,
            name,
            last_opened: now,
        },
    );

    // Keep max 10
    recent.projects.truncate(10);

    let json =
        serde_json::to_string_pretty(&recent).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&file_path, json).map_err(|e| format!("Failed to save recent projects: {}", e))
}

#[tauri::command]
pub fn remove_recent_project(app: AppHandle, project_path: String) -> Result<(), String> {
    let file_path = recent_projects_path(&app);
    if !file_path.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(&file_path).unwrap_or_default();
    let mut recent = serde_json::from_str::<RecentProjects>(&data).unwrap_or_default();
    recent.projects.retain(|p| p.path != project_path);

    let json =
        serde_json::to_string_pretty(&recent).map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&file_path, json).map_err(|e| format!("Failed to save recent projects: {}", e))
}

#[tauri::command]
pub fn detect_project_from_cwd() -> Result<Option<String>, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {}", e))?;
    let mut dir = cwd.as_path();

    loop {
        if dir.join(".claude").exists() {
            return Ok(Some(dir.to_string_lossy().to_string()));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return Ok(None),
        }
    }
}
