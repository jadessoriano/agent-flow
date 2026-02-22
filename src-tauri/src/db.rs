use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::str::FromStr;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRow {
    pub id: String,
    pub pipeline_name: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub trigger_input: Option<String>,
    pub resumed_from: Option<String>,
    pub failed_node_id: Option<String>,
    pub pipeline_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStepRow {
    pub id: i64,
    pub run_id: String,
    pub node_id: String,
    pub node_name: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub log_output: Option<String>,
    pub attempt: i32,
    pub cost_usd: Option<f64>,
    pub model: Option<String>,
    pub approval_state: Option<String>,
    pub instructions_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostSummary {
    pub total_cost_usd: f64,
    pub runs: Vec<RunCost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCost {
    pub run_id: String,
    pub pipeline_name: String,
    pub started_at: String,
    pub cost_usd: f64,
    pub duration_secs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub total_cost_usd: f64,
    pub total_runs: u32,
    pub total_ai_steps: u32,
    pub avg_cost_per_run: f64,
    pub avg_cost_per_ai_step: f64,
    pub avg_duration_secs: Option<f64>,
    pub runs: Vec<RunCost>,
    pub top_nodes: Vec<NodeCostEntry>,
    pub top_pipelines: Vec<PipelineCostEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCostEntry {
    pub node_name: String,
    pub node_id: String,
    pub run_id: String,
    pub pipeline_name: String,
    pub cost_usd: f64,
    pub started_at: String,
    pub duration_secs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineCostEntry {
    pub pipeline_name: String,
    pub total_cost_usd: f64,
    pub run_count: u32,
    pub avg_cost_per_run: f64,
    pub avg_duration_secs: Option<f64>,
}

pub async fn init_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    let db_path = data_dir.join("agentflow.db");
    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .map_err(|e| format!("Invalid DB path: {}", e))?
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| format!("Failed to connect to DB: {}", e))?;

    run_migrations(&pool).await?;

    // Enable WAL mode for concurrent reads during writes
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to enable WAL mode: {}", e))?;
    sqlx::query("PRAGMA synchronous=NORMAL")
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to set synchronous mode: {}", e))?;

    Ok(pool)
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            pipeline_name TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL DEFAULT 'running',
            trigger_input TEXT,
            resumed_from TEXT,
            failed_node_id TEXT,
            pipeline_hash TEXT
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Migration failed (runs): {}", e))?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS run_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            node_name TEXT,
            started_at TEXT,
            finished_at TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            exit_code INTEGER,
            log_output TEXT,
            attempt INTEGER DEFAULT 1,
            cost_usd REAL,
            model TEXT,
            approval_state TEXT,
            instructions_hash TEXT,
            FOREIGN KEY (run_id) REFERENCES runs(id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Migration failed (run_steps): {}", e))?;

    // Performance indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id)")
        .execute(pool)
        .await
        .map_err(|e| format!("Migration failed (idx_run_steps_run_id): {}", e))?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_run_steps_cache ON run_steps(instructions_hash, status)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Migration failed (idx_run_steps_cache): {}", e))?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_run_steps_cost ON run_steps(cost_usd) WHERE cost_usd IS NOT NULL AND cost_usd > 0",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Migration failed (idx_run_steps_cost): {}", e))?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC)")
        .execute(pool)
        .await
        .map_err(|e| format!("Migration failed (idx_runs_started_at): {}", e))?;

    Ok(())
}

// --- Run persistence ---

pub async fn insert_run(
    pool: &SqlitePool,
    id: &str,
    pipeline_name: &str,
    status: &str,
    trigger_input: Option<&str>,
    resumed_from: Option<&str>,
    pipeline_hash: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO runs (id, pipeline_name, started_at, status, trigger_input, resumed_from, pipeline_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(pipeline_name)
    .bind(&now)
    .bind(status)
    .bind(trigger_input)
    .bind(resumed_from)
    .bind(pipeline_hash)
    .execute(pool)
    .await
    .map_err(|e| format!("insert_run failed: {}", e))?;
    Ok(())
}

pub async fn update_run_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    failed_node_id: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE runs SET status = ?, finished_at = ?, failed_node_id = ? WHERE id = ?",
    )
    .bind(status)
    .bind(&now)
    .bind(failed_node_id)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| format!("update_run_status failed: {}", e))?;
    Ok(())
}

pub async fn list_runs(pool: &SqlitePool, limit: u32) -> Result<Vec<RunRow>, String> {
    let rows = sqlx::query(
        "SELECT id, pipeline_name, started_at, finished_at, status, trigger_input, resumed_from, failed_node_id, pipeline_hash
         FROM runs ORDER BY started_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("list_runs failed: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| RunRow {
            id: r.get("id"),
            pipeline_name: r.get("pipeline_name"),
            started_at: r.get("started_at"),
            finished_at: r.get("finished_at"),
            status: r.get("status"),
            trigger_input: r.get("trigger_input"),
            resumed_from: r.get("resumed_from"),
            failed_node_id: r.get("failed_node_id"),
            pipeline_hash: r.get("pipeline_hash"),
        })
        .collect())
}

pub async fn get_run(pool: &SqlitePool, run_id: &str) -> Result<Option<RunRow>, String> {
    let row = sqlx::query(
        "SELECT id, pipeline_name, started_at, finished_at, status, trigger_input, resumed_from, failed_node_id, pipeline_hash
         FROM runs WHERE id = ?",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("get_run failed: {}", e))?;

    Ok(row.map(|r| RunRow {
        id: r.get("id"),
        pipeline_name: r.get("pipeline_name"),
        started_at: r.get("started_at"),
        finished_at: r.get("finished_at"),
        status: r.get("status"),
        trigger_input: r.get("trigger_input"),
        resumed_from: r.get("resumed_from"),
        failed_node_id: r.get("failed_node_id"),
        pipeline_hash: r.get("pipeline_hash"),
    }))
}

// --- Step persistence ---

pub async fn insert_run_step(
    pool: &SqlitePool,
    run_id: &str,
    node_id: &str,
    node_name: &str,
    status: &str,
    attempt: i32,
    instructions_hash: &str,
) -> Result<i64, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO run_steps (run_id, node_id, node_name, started_at, status, attempt, instructions_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(run_id)
    .bind(node_id)
    .bind(node_name)
    .bind(&now)
    .bind(status)
    .bind(attempt)
    .bind(instructions_hash)
    .execute(pool)
    .await
    .map_err(|e| format!("insert_run_step failed: {}", e))?;
    Ok(result.last_insert_rowid())
}

pub async fn update_run_step(
    pool: &SqlitePool,
    step_id: i64,
    status: &str,
    exit_code: Option<i32>,
    log_output: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE run_steps SET status = ?, exit_code = ?, log_output = ?, finished_at = ? WHERE id = ?",
    )
    .bind(status)
    .bind(exit_code)
    .bind(log_output)
    .bind(&now)
    .bind(step_id)
    .execute(pool)
    .await
    .map_err(|e| format!("update_run_step failed: {}", e))?;
    Ok(())
}

pub async fn update_step_tokens(
    pool: &SqlitePool,
    step_id: i64,
    cost_usd: f64,
    model: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE run_steps SET cost_usd = ?, model = ? WHERE id = ?")
        .bind(cost_usd)
        .bind(model)
        .bind(step_id)
        .execute(pool)
        .await
        .map_err(|e| format!("update_step_tokens failed: {}", e))?;
    Ok(())
}

pub async fn update_step_approval(
    pool: &SqlitePool,
    step_id: i64,
    state: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE run_steps SET approval_state = ? WHERE id = ?")
        .bind(state)
        .bind(step_id)
        .execute(pool)
        .await
        .map_err(|e| format!("update_step_approval failed: {}", e))?;
    Ok(())
}

/// Insert a complete run step in a single query (replaces the 4-step insert+update pattern).
#[allow(clippy::too_many_arguments)]
pub async fn insert_complete_run_step(
    pool: &SqlitePool,
    run_id: &str,
    node_id: &str,
    node_name: &str,
    status: &str,
    attempt: i32,
    instructions_hash: &str,
    exit_code: Option<i32>,
    log_output: Option<&str>,
    cost_usd: Option<f64>,
    model: Option<&str>,
    approval_state: Option<&str>,
) -> Result<i64, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO run_steps (run_id, node_id, node_name, started_at, finished_at, status, attempt, instructions_hash, exit_code, log_output, cost_usd, model, approval_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(run_id)
    .bind(node_id)
    .bind(node_name)
    .bind(&now)
    .bind(&now)
    .bind(status)
    .bind(attempt)
    .bind(instructions_hash)
    .bind(exit_code)
    .bind(log_output)
    .bind(cost_usd)
    .bind(model)
    .bind(approval_state)
    .execute(pool)
    .await
    .map_err(|e| format!("insert_complete_run_step failed: {}", e))?;
    Ok(result.last_insert_rowid())
}

pub async fn get_run_steps(pool: &SqlitePool, run_id: &str) -> Result<Vec<RunStepRow>, String> {
    let rows = sqlx::query(
        "SELECT id, run_id, node_id, node_name, started_at, finished_at, status, exit_code, log_output, attempt, cost_usd, model, approval_state, instructions_hash
         FROM run_steps WHERE run_id = ? ORDER BY id ASC",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_run_steps failed: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| RunStepRow {
            id: r.get("id"),
            run_id: r.get("run_id"),
            node_id: r.get("node_id"),
            node_name: r.get("node_name"),
            started_at: r.get("started_at"),
            finished_at: r.get("finished_at"),
            status: r.get("status"),
            exit_code: r.get("exit_code"),
            log_output: r.get("log_output"),
            attempt: r.get("attempt"),
            cost_usd: r.get("cost_usd"),
            model: r.get("model"),
            approval_state: r.get("approval_state"),
            instructions_hash: r.get("instructions_hash"),
        })
        .collect())
}

// --- Duration helper ---

fn compute_duration_secs(started_at: &str, finished_at: Option<&str>) -> Option<f64> {
    let finished = finished_at?;
    let start = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(finished).ok()?;
    let dur = (end - start).num_milliseconds() as f64 / 1000.0;
    if dur >= 0.0 { Some(dur) } else { None }
}

// --- Cost queries ---

#[allow(dead_code)]
pub async fn get_run_cost(pool: &SqlitePool, run_id: &str) -> Result<f64, String> {
    let row = sqlx::query("SELECT COALESCE(SUM(cost_usd), 0.0) as total FROM run_steps WHERE run_id = ?")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("get_run_cost failed: {}", e))?;
    Ok(row.get::<f64, _>("total"))
}

pub async fn get_cost_summary(pool: &SqlitePool) -> Result<CostSummary, String> {
    let total_row = sqlx::query("SELECT COALESCE(SUM(cost_usd), 0.0) as total FROM run_steps")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("get_cost_summary total failed: {}", e))?;
    let total_cost_usd: f64 = total_row.get("total");

    let run_rows = sqlx::query(
        "SELECT r.id as run_id, r.pipeline_name, r.started_at, r.finished_at,
                COALESCE(SUM(s.cost_usd), 0.0) as cost_usd
         FROM runs r LEFT JOIN run_steps s ON r.id = s.run_id
         GROUP BY r.id ORDER BY r.started_at DESC LIMIT 100",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_cost_summary runs failed: {}", e))?;

    let runs = run_rows
        .iter()
        .map(|r| {
            let started: String = r.get("started_at");
            let finished: Option<String> = r.get("finished_at");
            let duration_secs = compute_duration_secs(&started, finished.as_deref());
            RunCost {
                run_id: r.get("run_id"),
                pipeline_name: r.get("pipeline_name"),
                started_at: started,
                cost_usd: r.get("cost_usd"),
                duration_secs,
            }
        })
        .collect();

    Ok(CostSummary {
        total_cost_usd,
        runs,
    })
}

pub async fn get_usage_stats(pool: &SqlitePool) -> Result<UsageStats, String> {
    // Consolidated scalar query: total cost, total runs, total AI steps, avg duration (4 queries → 1)
    let stats_row = sqlx::query(
        "SELECT
            (SELECT COALESCE(SUM(cost_usd), 0.0) FROM run_steps) as total_cost,
            (SELECT COUNT(*) FROM runs) as total_runs,
            (SELECT COUNT(*) FROM run_steps WHERE cost_usd IS NOT NULL AND cost_usd > 0) as total_ai_steps,
            (SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400)
             FROM runs WHERE finished_at IS NOT NULL) as avg_dur",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("get_usage_stats stats failed: {}", e))?;

    let total_cost_usd: f64 = stats_row.get("total_cost");
    let total_runs: u32 = stats_row.get::<i32, _>("total_runs") as u32;
    let total_ai_steps: u32 = stats_row.get::<i32, _>("total_ai_steps") as u32;
    let avg_duration_secs: Option<f64> = stats_row.get("avg_dur");

    let avg_cost_per_run = if total_runs > 0 {
        total_cost_usd / total_runs as f64
    } else {
        0.0
    };
    let avg_cost_per_ai_step = if total_ai_steps > 0 {
        total_cost_usd / total_ai_steps as f64
    } else {
        0.0
    };

    // 5. Runs list
    let run_rows = sqlx::query(
        "SELECT r.id as run_id, r.pipeline_name, r.started_at, r.finished_at,
                COALESCE(SUM(s.cost_usd), 0.0) as cost_usd
         FROM runs r LEFT JOIN run_steps s ON r.id = s.run_id
         GROUP BY r.id ORDER BY r.started_at DESC LIMIT 100",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_usage_stats runs failed: {}", e))?;

    let runs: Vec<RunCost> = run_rows
        .iter()
        .map(|r| {
            let started: String = r.get("started_at");
            let finished: Option<String> = r.get("finished_at");
            let duration_secs = compute_duration_secs(&started, finished.as_deref());
            RunCost {
                run_id: r.get("run_id"),
                pipeline_name: r.get("pipeline_name"),
                started_at: started,
                cost_usd: r.get("cost_usd"),
                duration_secs,
            }
        })
        .collect();

    // 6. Top nodes (top 10 most expensive single executions)
    let node_rows = sqlx::query(
        "SELECT s.node_name, s.node_id, s.run_id, r.pipeline_name, s.cost_usd,
                s.started_at, s.finished_at
         FROM run_steps s JOIN runs r ON s.run_id = r.id
         WHERE s.cost_usd IS NOT NULL AND s.cost_usd > 0
         ORDER BY s.cost_usd DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_usage_stats top nodes failed: {}", e))?;

    let top_nodes: Vec<NodeCostEntry> = node_rows
        .iter()
        .map(|r| {
            let started: Option<String> = r.get("started_at");
            let finished: Option<String> = r.get("finished_at");
            let duration_secs =
                compute_duration_secs(started.as_deref().unwrap_or(""), finished.as_deref());
            NodeCostEntry {
                node_name: r.get::<Option<String>, _>("node_name").unwrap_or_default(),
                node_id: r.get("node_id"),
                run_id: r.get("run_id"),
                pipeline_name: r.get("pipeline_name"),
                cost_usd: r.get("cost_usd"),
                started_at: started.unwrap_or_default(),
                duration_secs,
            }
        })
        .collect();

    // 7. Top pipelines (most expensive by total spend)
    let pipeline_rows = sqlx::query(
        "SELECT r.pipeline_name,
                COALESCE(SUM(s.cost_usd), 0.0) as total_cost_usd,
                COUNT(DISTINCT r.id) as run_count,
                AVG(CASE WHEN r.finished_at IS NOT NULL
                    THEN (julianday(r.finished_at) - julianday(r.started_at)) * 86400
                    ELSE NULL END) as avg_dur
         FROM runs r LEFT JOIN run_steps s ON r.id = s.run_id
         GROUP BY r.pipeline_name
         HAVING total_cost_usd > 0
         ORDER BY total_cost_usd DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_usage_stats top pipelines failed: {}", e))?;

    let top_pipelines: Vec<PipelineCostEntry> = pipeline_rows
        .iter()
        .map(|r| {
            let total: f64 = r.get("total_cost_usd");
            let count: i32 = r.get("run_count");
            PipelineCostEntry {
                pipeline_name: r.get("pipeline_name"),
                total_cost_usd: total,
                run_count: count as u32,
                avg_cost_per_run: if count > 0 {
                    total / count as f64
                } else {
                    0.0
                },
                avg_duration_secs: r.get("avg_dur"),
            }
        })
        .collect();

    Ok(UsageStats {
        total_cost_usd,
        total_runs,
        total_ai_steps,
        avg_cost_per_run,
        avg_cost_per_ai_step,
        avg_duration_secs,
        runs,
        top_nodes,
        top_pipelines,
    })
}

/// Find a cached successful step matching the given instructions hash.
/// Returns (log_output, cost_usd) if found.
pub async fn find_cached_step(
    pool: &SqlitePool,
    hash: &str,
) -> Result<Option<(String, Option<f64>)>, String> {
    let row = sqlx::query(
        "SELECT log_output, cost_usd FROM run_steps
         WHERE instructions_hash = ? AND status = 'Success' AND log_output IS NOT NULL
         ORDER BY id DESC LIMIT 1",
    )
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("find_cached_step failed: {}", e))?;

    Ok(row.map(|r| {
        let output: String = r.get::<Option<String>, _>("log_output").unwrap_or_default();
        let cost: Option<f64> = r.get("cost_usd");
        (output, cost)
    }))
}

pub async fn get_avg_ai_step_cost(pool: &SqlitePool) -> Result<Option<f64>, String> {
    let row = sqlx::query(
        "SELECT AVG(cost_usd) as avg_cost FROM run_steps WHERE cost_usd IS NOT NULL AND cost_usd > 0",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("get_avg_ai_step_cost failed: {}", e))?;
    Ok(row.get::<Option<f64>, _>("avg_cost"))
}
