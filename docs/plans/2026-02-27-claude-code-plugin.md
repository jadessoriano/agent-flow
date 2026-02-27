# AgentFlow Claude Code Plugin — Build Plan

**Date:** 2026-02-27
**Status:** Design drafted, pending implementation

## Context

AgentFlow is a Tauri desktop app that orchestrates multi-step Claude Code agent pipelines visually. CLI power users don't need the GUI — they want pipeline orchestration directly inside Claude Code. This plan extracts the Rust execution engine from Tauri and packages it as a Claude Code plugin with MCP tools and slash command skills.

The plugin gives CLI users: pipeline running, cost tracking, run history, approval gates, and resume-from-failure — all without leaving the terminal.

---

## Architecture

```
Claude Code (terminal)
    ↕ MCP protocol (JSON-RPC over stdio)
agent-flow-engine binary (--mcp mode)
    ├── PipelineRunner (core logic)
    ├── SQLite DB (~/.agent-flow/agentflow.db)
    └── spawns claude CLI per node
```

Single Rust binary, dual mode:
- `--mcp` → MCP server for Claude Code
- No flag → standalone CLI (for debugging)

Both the plugin and desktop app share the same DB, pipeline files, and agent files.

---

## Phase 1: Core Extraction — Cargo Workspace

**Goal**: Extract pure logic from Tauri into `agent-flow-core` crate.

### New workspace structure

```
agent-flow/
  Cargo.toml                      # workspace root (NEW)
  crates/
    agent-flow-core/              # pure logic (NEW)
      src/
        lib.rs
        types.rs                  # NodeStatus, RunState, RunStateDelta, etc.
        callbacks.rs              # ExecutionCallbacks trait
        executor.rs               # DAG execution (refactored)
        pipeline_engine.rs        # Pipeline CRUD (moved, decorators stripped)
        db.rs                     # SQLite (moved, AppHandle→Path)
        agent_manager.rs          # Agent CRUD (moved)
        project_manager.rs        # scan_project, init_project (partial move)
        settings.rs               # detect_claude_cli (partial move)
        secrets.rs                # Keyring access (moved)
    agent-flow-engine/            # standalone binary (NEW)
      src/
        main.rs                   # MCP server + CLI modes
        stdio_callbacks.rs        # JSON-Lines output
        mcp_server.rs             # MCP protocol handler
        tools.rs                  # MCP tool definitions
  src-tauri/                      # desktop app (MODIFIED, now thin wrapper)
    src/
      lib.rs                      # Thin #[tauri::command] wrappers
      tauri_callbacks.rs          # ExecutionCallbacks → AppHandle.emit()
      git_watcher.rs              # stays (Tauri-specific)
      error_log.rs                # stays (Tauri-specific)
  agent-flow-plugin/              # plugin distribution package (NEW)
    .claude-plugin/plugin.json
    skills/
    .mcp.json
    bin/                          # compiled binaries (CI-built)
```

### Key refactoring: ExecutionCallbacks trait

```rust
// crates/agent-flow-core/src/callbacks.rs
#[async_trait]
pub trait ExecutionCallbacks: Send + Sync {
    fn on_run_update(&self, state: &RunState);
    fn on_run_delta(&self, delta: RunStateDelta);
    fn on_node_log(&self, run_id: &str, node_id: &str, line: &str);
    fn on_node_log_batch(&self, run_id: &str, node_id: &str, lines: Vec<String>);
    async fn on_approval_requested(
        &self, run_id: &str, node_id: &str, node_name: &str,
    ) -> tokio::sync::oneshot::Receiver<bool>;
}
```

This replaces all 106 `app.emit()` calls in `executor.rs`. Two implementations:
- `TauriCallbacks` (desktop) — delegates to `AppHandle.emit()`
- `StdioCallbacks` (plugin) — writes JSON-Lines to stdout

### PipelineRunner struct

```rust
pub struct PipelineRunner {
    state: Arc<Mutex<ExecutorState>>,
    pool: SqlitePool,
    callbacks: Arc<dyn ExecutionCallbacks>,
}
```

Methods: `start_run`, `cancel_run`, `respond_to_approval`, `get_run_state`, `resume_run`, `list_run_history`, `get_run_details`, `get_cost_summary`, `get_usage_stats`, `estimate_run`

### Files to modify

| File | Action | Key Change |
|------|--------|-----------|
| `src-tauri/src/executor.rs` | Refactor → `crates/agent-flow-core/src/executor.rs` | Replace `app: &AppHandle` with `callbacks: &dyn ExecutionCallbacks` across ~60 function signatures |
| `src-tauri/src/db.rs` | Move → `crates/agent-flow-core/src/db.rs` | `init_pool(app: &AppHandle)` → `init_pool(db_path: &Path)` |
| `src-tauri/src/pipeline_engine.rs` | Move → `crates/agent-flow-core/src/pipeline_engine.rs` | Strip `#[tauri::command]` decorators |
| `src-tauri/src/agent_manager.rs` | Move → `crates/agent-flow-core/src/agent_manager.rs` | Strip `#[tauri::command]` decorators |
| `src-tauri/src/secrets.rs` | Move → `crates/agent-flow-core/src/secrets.rs` | No changes needed |
| `src-tauri/src/lib.rs` | Rewrite | Thin wrappers delegating to `PipelineRunner` |
| `src-tauri/Cargo.toml` | Modify | Add `agent-flow-core` dependency, remove moved code deps |

### Dependencies split

**agent-flow-core**: sqlx, tokio, serde, serde_json, chrono, sha2, keyring, async-trait, log
**agent-flow-engine**: agent-flow-core, clap (CLI args), tracing (logging)
**src-tauri**: agent-flow-core, tauri, tauri-plugin-*

---

## Phase 2: Tauri Integration Layer

**Goal**: Desktop app works identically using `agent-flow-core`.

1. Create `src-tauri/src/tauri_callbacks.rs` implementing `ExecutionCallbacks`
2. In `lib.rs` setup, create `PipelineRunner` with `TauriCallbacks` and store in Tauri managed state
3. Each `#[tauri::command]` becomes a 3-line wrapper calling `runner.method()`
4. Verify: `npm run tauri dev` works, all 19 Rust tests pass, benchmarks unchanged

---

## Phase 3: Standalone Engine Binary

**Goal**: `agent-flow-engine` can run pipelines from command line.

### Binary modes

```
agent-flow-engine --mcp                    # MCP server mode
agent-flow-engine run <pipeline> [--input key=val]  # Direct run
agent-flow-engine list [--project .]       # List pipelines
agent-flow-engine history [--limit 10]     # Show run history
agent-flow-engine status                   # Current run state
```

### StdioCallbacks output format (JSON-Lines)

```json
{"event":"run-started","data":{"run_id":"run-123","pipeline_name":"ticket-to-pr"}}
{"event":"node-log","data":{"run_id":"run-123","node_id":"parse-input","line":"Parsing ticket ID..."}}
{"event":"node-complete","data":{"run_id":"run-123","node_id":"parse-input","status":"success","cost_usd":0.003}}
{"event":"approval-requested","data":{"run_id":"run-123","node_id":"approve-plan","name":"Approve Plan"}}
{"event":"run-complete","data":{"run_id":"run-123","status":"success","total_cost_usd":0.234}}
```

### DB location

Shared: `~/.agent-flow/agentflow.db` — both desktop and plugin use same DB via SQLite WAL mode (concurrent readers).

---

## Phase 4: MCP Server

**Goal**: MCP tools accessible from Claude Code.

### MCP tool definitions

**Pipeline management:**
| Tool | Params | Returns |
|------|--------|---------|
| `list_pipelines` | `project_path?` | `PipelineInfo[]` |
| `read_pipeline` | `project_path?, name` | `Pipeline` |
| `write_pipeline` | `project_path?, pipeline` | `{path}` |
| `delete_pipeline` | `project_path?, name` | `{}` |
| `validate_pipeline` | `project_path?, name` | `{valid, errors[]}` |

**Execution:**
| Tool | Params | Returns |
|------|--------|---------|
| `run_pipeline` | `project_path?, name, inputs?` | `{run_id, status}` or `{status:"awaiting_approval", gate:{...}}` |
| `cancel_run` | `run_id` | `{}` |
| `approve_gate` | `run_id, approved` | `{}` |
| `get_run_status` | `run_id?` | `RunState` with `recent_logs` |
| `resume_run` | `project_path?, original_run_id, name` | `{run_id}` |

**History/cost:**
| Tool | Params | Returns |
|------|--------|---------|
| `list_run_history` | `limit?` | `RunRow[]` |
| `get_run_details` | `run_id` | `{run, steps[]}` |
| `get_cost_summary` | — | `CostSummary` |
| `get_usage_stats` | — | `UsageStats` |

**Agents:**
| Tool | Params | Returns |
|------|--------|---------|
| `list_agents` | `project_path?` | `AgentInfo[]` |
| `read_agent` | `project_path?, name` | `{content}` |
| `write_agent` | `project_path?, name, content` | `{path}` |

All tools default `project_path` to cwd when omitted.

### Approval gates in CLI context

1. Pipeline hits approval gate → engine emits `approval-requested` event
2. MCP server returns intermediate result from `run_pipeline`: `{status: "awaiting_approval", gate: {...}}`
3. Claude reads this, prompts user: "Pipeline paused at 'Approve Plan'. Approve?"
4. User responds → Claude calls `approve_gate` tool
5. MCP server sends approval to engine → execution resumes

### Log streaming

Primary: MCP notifications (`notifications/agent-flow/node-log`)
Fallback: `get_run_status` returns `recent_logs` (circular buffer of last N lines)

---

## Phase 5: Skills and Plugin Packaging

**Goal**: Plugin installable via Claude Code.

### Plugin manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "agent-flow",
  "version": "0.1.0",
  "description": "Pipeline orchestration for Claude Code — run multi-step agent workflows from the CLI",
  "author": {"name": "AgentFlow"},
  "license": "MIT",
  "keywords": ["pipeline", "orchestration", "workflow", "automation"]
}
```

### MCP config (`.mcp.json`)

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/agent-flow-engine",
      "args": ["--mcp"]
    }
  }
}
```

### Skills

| Skill | Invocation | Tools Used |
|-------|-----------|-----------|
| `pipeline-run` | `/agent-flow:run <name> [key=val]` | `run_pipeline`, `get_run_status`, `approve_gate`, `list_pipelines` |
| `pipeline-list` | `/agent-flow:list` | `list_pipelines`, `scan_project` |
| `pipeline-status` | `/agent-flow:status` | `get_run_status`, `list_run_history`, `get_run_details` |
| `pipeline-history` | `/agent-flow:history [limit]` | `list_run_history`, `get_run_details` |
| `pipeline-cost` | `/agent-flow:cost` | `get_cost_summary`, `get_usage_stats` |
| `pipeline-create` | `/agent-flow:create <description>` | `write_pipeline`, `list_pipelines` |
| `agent-list` | `/agent-flow:agents [list\|read\|create\|delete]` | `list_agents`, `read_agent`, `write_agent`, `delete_agent` |

Each skill uses YAML frontmatter with `allowed-tools` restricted to relevant MCP tools.

---

## Phase 6: CI/CD and Distribution

**Goal**: Automated cross-platform builds.

### Build targets

| Platform | Target | CI Runner |
|----------|--------|-----------|
| macOS ARM | `aarch64-apple-darwin` | `macos-14` |
| macOS Intel | `x86_64-apple-darwin` | `macos-13` |
| Linux x86_64 | `x86_64-unknown-linux-gnu` | `ubuntu-latest` |

### Binary optimization

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
```

Target size: 10-15 MB per platform.

### Distribution

- **Marketplace**: `claude plugin install agent-flow@agentflow-marketplace`
- **Manual**: `claude --plugin-dir ./agent-flow-plugin`
- **Development**: `claude --plugin-dir ./agent-flow-plugin` (uncompiled, uses local build)

---

## Verification

1. **Core extraction**: `cd crates/agent-flow-core && cargo test` — all 19 existing tests pass
2. **Desktop regression**: `npm run tauri dev` — app works identically, run a pipeline end-to-end
3. **Engine binary**: `./agent-flow-engine run rust-check-test-build --project .` — pipeline executes, outputs JSON-Lines
4. **MCP server**: `claude --plugin-dir ./agent-flow-plugin` then `/agent-flow:list` — shows pipelines
5. **Full flow**: `/agent-flow:run ticket-to-pr JIRA_TICKET_KEY=PROJ-123` — runs pipeline with approval gate interaction
6. **Shared data**: Run from CLI, check history in desktop app — same run appears in both
