# AgentFlow

Visual pipeline builder and runner for Claude Code agents.

## Project Structure

```
agent-flow/
├── src/                    # React frontend (TypeScript)
│   ├── components/
│   │   ├── canvas/         # React Flow canvas, BaseNode, NodeIcons, NodeConfig
│   │   ├── panels/         # SidePanel, LiveLog, RunHistory, CostDashboard, ErrorLog, AgentLibrary, Settings
│   │   ├── topbar/         # TopBar, PipelineSelector
│   │   ├── bottombar/      # BottomBar
│   │   ├── Toast.tsx       # Toast notification stack
│   │   ├── ErrorBoundary.tsx
│   │   └── WelcomeScreen.tsx
│   ├── stores/             # Zustand state management
│   │   ├── pipelineStore.ts
│   │   ├── runStore.ts
│   │   ├── agentStore.ts
│   │   ├── projectStore.ts
│   │   ├── settingsStore.ts
│   │   ├── uiStore.ts
│   │   └── errorLogStore.ts
│   ├── types/              # TypeScript type definitions
│   ├── lib/                # Utilities (tauri.ts, format.ts, errorReporter.ts, autoLayout.ts)
│   └── hooks/              # Custom React hooks
├── src-tauri/              # Rust backend (Tauri v2)
│   └── src/
│       ├── lib.rs          # Plugin registration, command handlers
│       ├── main.rs         # Entry point
│       ├── executor.rs     # Pipeline execution engine (process spawning, CLI invocation)
│       ├── pipeline_engine.rs  # Pipeline CRUD, agent markdown generation
│       ├── db.rs           # SQLite persistence (runs, costs, usage stats)
│       ├── agent_manager.rs    # Agent file management
│       ├── project_manager.rs  # Project directory management
│       ├── git_watcher.rs  # File system watcher for live reload
│       ├── settings.rs     # App settings, CLI detection
│       └── error_log.rs    # Log file reading/export commands
└── docs/plans/             # Design documents
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Zustand, React Flow (@xyflow/react)
- **Backend**: Rust, Tauri v2, SQLite (sqlx), tokio
- **Build**: Vite 7, tauri-cli

## Key Patterns

- **Tauri IPC**: Frontend calls Rust via `invoke()` from `@tauri-apps/api/core`. Backend exposes `#[tauri::command]` functions.
- **State management**: Zustand stores with actions that call Tauri commands. No Redux.
- **Error handling**: Use `logError()` / `logWarning()` from `src/lib/errorReporter.ts` + `addToast()` from `uiStore`. Never use `alert()`.
- **Styling**: Tailwind utility classes. Dark theme (zinc/violet palette). No CSS modules or styled-components.
- **Pipeline data**: JSON files in `.claude/pipelines/`. Agent markdown in `.claude/agents/`. Both are git-trackable.

## Development

```bash
npm install              # Install frontend dependencies
npm run tauri dev        # Start dev server with hot reload
npm run tauri build      # Production build
npx tsc --noEmit         # Type-check frontend
cd src-tauri && cargo check  # Type-check backend
```

## Conventions

- Node types are defined in `src/types/pipeline.ts` (`NODE_TYPE_META`)
- All Tauri command wrappers live in `src/lib/tauri.ts`
- Duration formatting uses `formatDuration()` / `formatMs()` from `src/lib/format.ts`
- Cost formatting: `$X.XX` for >= $0.01, `$X.XXXX` for < $0.01
