use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState {
    pub _watcher: Option<RecommendedWatcher>,
}

#[tauri::command]
pub fn start_watching(app: AppHandle, project_path: String) -> Result<(), String> {
    let claude_dir = Path::new(&project_path).join(".claude");
    if !claude_dir.exists() {
        return Err("No .claude directory found".to_string());
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let agents_dir = claude_dir.join("agents");
    let pipelines_dir = claude_dir.join("pipelines");

    if agents_dir.exists() {
        watcher
            .watch(&agents_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch agents dir: {}", e))?;
    }

    if pipelines_dir.exists() {
        watcher
            .watch(&pipelines_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch pipelines dir: {}", e))?;
    }

    let app_clone = app.clone();
    thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if let Ok(event) = event {
                let kind = format!("{:?}", event.kind);
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();

                let _ = app_clone.emit(
                    "file-changed",
                    serde_json::json!({
                        "kind": kind,
                        "paths": paths,
                    }),
                );
            }
        }
    });

    // Store the watcher so it doesn't get dropped
    let state = app.state::<Mutex<WatcherState>>();
    let mut guard = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    guard._watcher = Some(watcher);

    Ok(())
}

#[tauri::command]
pub fn stop_watching(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WatcherState>>();
    let mut guard = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    guard._watcher = None;
    Ok(())
}
