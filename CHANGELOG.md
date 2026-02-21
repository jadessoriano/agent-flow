# Changelog

All notable changes to AgentFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
