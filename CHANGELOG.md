# Changelog

All notable changes to AgentFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-22

### Added

- **Per-node model selection** — choose Claude model per node (Opus, Sonnet, Haiku) in the node config panel
- **Output caching** — skip re-execution of nodes whose instructions haven't changed since last successful run
- **Budget limits** — set a max cost per pipeline run; execution halts when the budget is exceeded
- **Cost estimates** — pre-run cost estimation based on historical per-node averages
- **Node output data passing** — reference upstream node output with `{output.NODE_ID}` substitution in downstream instructions
- **Conditional edges** — visual edge labels and configuration for success/failure branching
- **Pipeline settings panel** — configure pipeline-level variables, description, budget, and shared session settings
- **Input prompt modal** — prompt for pipeline inputs with validation before execution

### Performance

- **Database indexes** — added 4 indexes on `run_steps` and `runs` tables for O(log n) lookups on cached steps, costs, and run history
- **WAL mode** — enabled SQLite write-ahead logging with `PRAGMA synchronous=NORMAL` for concurrent read/write
- **Consolidated DB writes** — replaced 4 sequential INSERT/UPDATE calls per node with a single `insert_complete_run_step` call
- **Consolidated usage stats query** — merged 4 scalar queries into 1 with SQL subselects
- **Watch channel cancellation** — replaced 250ms mutex polling with `tokio::sync::watch` channel for zero-cost event-driven cancellation
- **IPC log batching** — buffered stdout/stderr lines and flush every 50ms as `node-log-batch` events instead of per-line IPC
- **Log array optimization** — `push()` instead of spread for per-node log arrays in Zustand store
- **Canvas useMemo simplification** — removed 3 intermediate `useMemo` hooks; compute status/cost/duration directly from `runState` in useEffect
- **NodeRow memoization** — wrapped `NodeRow` with `React.memo` and custom comparator to prevent sibling re-renders
- **Log truncation** — only render last 200 log lines with "N earlier lines hidden" indicator
- **Stable callbacks** — `useCallback` for `toggleExpanded` with `nodeId` prop to preserve `React.memo` benefits
- **BaseNode memoization** — wrapped `BaseNode` with `React.memo` for canvas node render optimization
- **JoinSet for parallel results** — `tokio::task::JoinSet` processes parallel child results in completion order instead of spawn order

### Changed

- Updated app icons
- Improved theme and styling (expanded globals.css with custom properties)
- Enhanced pipeline selector with better UX

## [0.2.0] - 2026-02-21

### Added

- **Pipeline validation** — cycle detection and sub-pipeline reference checks before run
- **Copy/paste nodes** — Ctrl+C/V support on the canvas
- **Desktop notifications** — notify on run completion and approval gates when app is backgrounded
- **Starter templates** — 5 pipeline templates to get started quickly
- **Run history filtering** — filter by status, pipeline, and date
- **Expandable node output** — view full node output in LiveLog panel
- **Onboarding flow** — guided setup for new projects without `.claude/` directory
- **Pipeline diff review** — review changes before saving
- **Comment nodes** — non-executable sticky notes on the canvas
- **Export run reports** — export run history as markdown
- **Light/dark theme toggle** — theme switcher with CSS custom properties
- **Secret variables** — OS keychain integration via `secret.KEY_NAME` syntax
- **Auto-updater** — in-app update banner with signed builds
- **Node output passing** — reference upstream output with `{output.NODE_ID}` substitution
- **Pipeline-agent namespace** — `_pipeline--` prefix prevents naming collisions with manual agents
- **Self-reference protection** — prevents infinite loops from pipeline nodes referencing their own agent
- **Agent origin tracking** — UI badges distinguish pipeline-generated vs manual agents
- **Pipeline rename cleanup** — atomic rename of both JSON and markdown files

### Fixed

- Tauri dev rebuild loop caused by CLAUDE.md files in watched directories
- Updater error spam in development mode
- Welcome screen flash on startup (loading state race condition)
- Updater endpoint URL pointing to wrong repository
- Secrets not injected during resume-from-failure runs

### Changed

- Version bump from 0.1.0 to 0.2.0
- Release workflow now includes signing keys, updater artifacts, and `latest.json` generation

## [0.1.0] - 2026-02-21

### Added

- **Visual Pipeline Builder** — drag-and-drop canvas for designing Claude Code agent pipelines using React Flow
- **Node types** — AI Task, Shell, Git, Parallel, Approval Gate, Sub-Pipeline with color-coded visual styling
- **Pipeline execution engine** — run pipelines with real-time status updates, cancellation support, and retry policies
- **Resume from failure** — re-run failed pipelines from the point of failure with original inputs preserved
- **Token cost tracking** — per-node and per-run cost estimation with USD display on canvas nodes and in run history
- **Cost dashboard** — aggregate usage stats: total cost, top pipelines by cost, top node executions, recent runs
- **Run history** — in-memory and SQLite-persisted run history with deduplication
- **Agent library** — browse, search, and manage Claude Code agent markdown files from `.claude/agents/`
- **Project manager** — open/switch between project directories with file system watcher for live reload
- **Settings panel** — configure Claude CLI path with auto-detection, model selection
- **Error logging system** — persistent file logging (Rust `tauri-plugin-log`), in-app error log viewer with Session/Log File tabs
- **Error reporting** — copy errors to clipboard, copy full log, open pre-filled GitHub issue from error panel
- **Toast notifications** — auto-dismissing toast stack replacing all browser `alert()` calls
- **Execution duration display** — node and pipeline durations shown in LiveLog, RunHistory, Canvas nodes, and Cost Dashboard
- **Error boundary** — React error boundary with crash recovery UI wrapping all panel content
- **Global error handling** — unhandled rejection and uncaught error capture in main entry point
- **Keyboard shortcuts** — configurable shortcuts for common actions
- **Auto-layout** — dagre-based automatic node positioning with layout caching
- **Dark theme** — zinc/violet dark UI built with Tailwind CSS v4
