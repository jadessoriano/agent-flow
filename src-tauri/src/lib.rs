mod agent_manager;
mod db;
mod error_log;
mod executor;
mod git_watcher;
mod pipeline_engine;
mod project_manager;
mod secrets;
mod settings;

use std::sync::Mutex;
use tauri::Manager;
use tokio::sync::Mutex as TokioMutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(git_watcher::WatcherState { _watcher: None }))
        .manage(TokioMutex::new(executor::ExecutorState::new()))
        .invoke_handler(tauri::generate_handler![
            // Agent CRUD
            agent_manager::list_agents,
            agent_manager::read_agent,
            agent_manager::write_agent,
            agent_manager::delete_agent,
            agent_manager::create_agent,
            // Pipeline CRUD
            pipeline_engine::list_pipelines,
            pipeline_engine::read_pipeline,
            pipeline_engine::write_pipeline,
            pipeline_engine::delete_pipeline,
            pipeline_engine::rename_pipeline,
            pipeline_engine::generate_pipeline,
            // Executor
            executor::start_run,
            executor::cancel_run,
            executor::respond_to_approval,
            executor::get_run_state,
            executor::list_run_history,
            executor::get_run_details,
            executor::resume_run,
            executor::get_cost_summary,
            executor::get_usage_stats,
            executor::get_avg_ai_cost,
            executor::estimate_run,
            // Project management
            project_manager::scan_project,
            project_manager::init_project,
            project_manager::get_recent_projects,
            project_manager::add_recent_project,
            project_manager::remove_recent_project,
            project_manager::detect_project_from_cwd,
            // Settings
            settings::get_settings,
            settings::save_settings,
            settings::detect_claude_cli,
            settings::detect_claude_cli_detailed,
            // File watcher
            git_watcher::start_watching,
            git_watcher::stop_watching,
            // Secrets
            secrets::list_secrets,
            secrets::set_secret,
            secrets::delete_secret,
            // Error log
            error_log::get_error_log,
            error_log::get_full_log,
            error_log::get_log_path,
            error_log::clear_error_log,
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Initialize SQLite pool
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                match db::init_pool(&handle).await {
                    Ok(pool) => {
                        handle.manage(pool);
                    }
                    Err(e) => {
                        log::error!("Failed to initialize database: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
