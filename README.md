# AgentFlow

A desktop application for visually building, managing, and running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agent pipelines. Design multi-step AI workflows with a drag-and-drop canvas, then execute them with a single click.

AgentFlow is a GUI layer on top of what Claude Code already supports — agents are stored as standard `.claude/agents/*.md` files in your git repo, so your team can use the visual editor or the CLI interchangeably.

## Features

### Visual Pipeline Builder
- Drag-and-drop canvas powered by [React Flow](https://reactflow.dev/)
- 6 node types with color-coded styling:
  - **AI Task** — send instructions to Claude Code
  - **Shell** — run bash commands
  - **Git** — git operations (commit, push, branch)
  - **Parallel** — run multiple nodes simultaneously
  - **Approval Gate** — pause for human review before continuing
  - **Sub-pipeline** — call another pipeline as a nested workflow
- Conditional edges (success/failure branching)
- Auto-layout with dagre positioning

### Pipeline Execution
- One-click pipeline runs with real-time canvas status animations
- Streaming log output per node
- Cancel running pipelines at any time
- Resume failed pipelines from the point of failure
- Retry policies with configurable max attempts and delay
- Per-node timeout support

### Cost & Performance Tracking
- Per-node and per-run token cost estimation (USD)
- Cost dashboard with aggregate stats: total spend, top pipelines, top nodes
- Execution duration displayed across all UI surfaces
- Per-node model selection (Opus, Sonnet, Haiku)
- Budget limits with automatic halt when exceeded
- Output caching — skips re-execution when node instructions haven't changed
- SQLite-persisted run history

### Runtime Performance
- SQLite WAL mode with indexed queries for non-blocking reads during execution
- IPC log batching (50ms flush) eliminates per-line event overhead
- `React.memo` on canvas nodes and log rows prevents cascading re-renders
- `tokio::sync::watch` channel for zero-cost cancellation instead of mutex polling
- `JoinSet` processes parallel child results in completion order

### Agent Library
- Browse, search, and manage `.claude/agents/*.md` files
- Markdown editor with live preview
- Pipelines auto-generate agent markdown for CLI compatibility

### Error Management
- Persistent file logging with in-app error log viewer
- Toast notifications (replacing disruptive browser alerts)
- One-click GitHub issue creation with pre-filled error context
- Copy error logs to clipboard for sharing

### Team Collaboration
- Git-native storage — agents and pipelines sync via `git pull`/`git push`
- File watcher detects when teammates push new agents
- No central server or infrastructure required

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Tauri App                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                React Frontend                      │  │
│  │                                                    │  │
│  │  Canvas (React Flow)  │  Side Panels (config,      │  │
│  │  always visible       │  logs, library, history)   │  │
│  │                       │                            │  │
│  └───────────┬───────────┴────────────────────────────┘  │
│              │ Tauri IPC (invoke / events)                │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │                Rust Backend                        │  │
│  │                                                    │  │
│  │  Agent Manager    Pipeline Engine    Executor      │  │
│  │  (CRUD .md)       (parse/run flow)   (spawn CLI)  │  │
│  │                                                    │  │
│  │  Git Watcher      Run History        Error Log     │  │
│  │  (live reload)    (SQLite)           (file log)    │  │
│  └────────────────────────────────┬───────────────────┘  │
└───────────────────────────────────┼──────────────────────┘
                                    ▼
                             Claude Code CLI
                             (child process)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19, TypeScript, [Tailwind CSS v4](https://tailwindcss.com/) |
| State management | [Zustand](https://github.com/pmndrs/zustand) |
| Flow editor | [@xyflow/react](https://reactflow.dev/) (React Flow) |
| Database | SQLite via [sqlx](https://github.com/launchbadge/sqlx) |
| Async runtime | [Tokio](https://tokio.rs/) |
| Build tool | [Vite 7](https://vite.dev/) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.77.2+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- System dependencies for Tauri:
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), WebView2

### Installation

```bash
git clone https://github.com/jadessoriano/agent-flow.git
cd agent-flow
npm install
```

### Development

```bash
# Start dev server with hot reload
npm run tauri dev
```

This launches both the Vite dev server (frontend) and the Tauri Rust backend with hot reload.

### Production Build

```bash
npm run tauri build
```

Outputs platform-specific installers in `src-tauri/target/release/bundle/`:
- **Linux**: `.deb`, `.AppImage`
- **macOS**: `.dmg`
- **Windows**: `.msi`, `.exe`

### Type Checking

```bash
# Frontend
npx tsc --noEmit

# Backend
cd src-tauri && cargo check
```

## Usage

### 1. Open a Project

Launch AgentFlow and select a project directory that contains (or will contain) a `.claude/` folder. AgentFlow watches this directory for changes.

### 2. Create a Pipeline

Click **+ New** in the bottom bar to create a pipeline. Drag nodes from the palette onto the canvas:

- **AI Task**: Provide instructions for Claude to execute
- **Shell**: Run any bash command
- **Git**: Execute git operations
- **Parallel**: Group nodes to run simultaneously
- **Approval Gate**: Add a human checkpoint
- **Sub-pipeline**: Reference another pipeline

Connect nodes by dragging edges between them. Click an edge to set success/failure conditions.

### 3. Configure Nodes

Click any node to open the configuration panel:
- Set the node name and instructions
- Assign a specific agent (from `.claude/agents/`)
- Configure retry policies and timeouts
- Define inputs and outputs

### 4. Run the Pipeline

Click **Run** in the top bar. If the pipeline has required inputs, you'll be prompted to provide them. The canvas switches to run mode:

- **Gray** — pending
- **Blue pulse** — running
- **Green** — success
- **Red** — failed
- **Yellow** — cancelled

Click any node during or after execution to view its log output.

### 5. Resume from Failure

If a pipeline fails, click **Resume from failure** in the Run History panel. AgentFlow skips completed nodes and retries from the failure point.

## Pipeline Format

Pipelines are stored as JSON in `.claude/pipelines/`:

```json
{
  "name": "ticket-to-pr",
  "description": "Jira ticket to merged PR",
  "version": "1.0.0",
  "variables": {
    "BASE_BRANCH": "develop"
  },
  "nodes": [
    {
      "id": "fetch-ticket",
      "name": "Fetch Jira Ticket",
      "type": "ai-task",
      "instructions": "Fetch Jira ticket {input.ticketKey}...",
      "inputs": ["ticketKey"],
      "outputs": ["summary", "issueType"],
      "position": { "x": 100, "y": 200 }
    },
    {
      "id": "run-tests",
      "name": "Run Tests",
      "type": "shell",
      "instructions": "npm test",
      "retry": { "max": 3, "delay": 5 },
      "position": { "x": 400, "y": 200 }
    }
  ],
  "edges": [
    { "id": "e1", "from": "fetch-ticket", "to": "run-tests", "condition": "success" }
  ]
}
```

AgentFlow auto-generates a corresponding `.claude/agents/*.md` file so the pipeline works with Claude Code CLI directly — no app required for teammates.

### Node Types

| Type | Description | Executed by |
|------|------------|-------------|
| `ai-task` | Sends instructions to Claude for AI-powered work | Claude Code CLI (`claude --agent`) |
| `shell` | Runs a bash command | Tauri Rust backend |
| `git` | Git operations (commit, push, branch) | Tauri Rust backend |
| `parallel` | Runs children simultaneously, waits for all | Pipeline engine |
| `approval-gate` | Pauses for human approve/reject | Pipeline engine |
| `sub-pipeline` | Calls another pipeline by name | Pipeline engine |

### Variables

Define pipeline-level variables and reference them in any node with `$VARIABLE_NAME`:

```json
"variables": {
  "JIRA_PROJECT_KEY": "ML",
  "BASE_BRANCH": "develop"
}
```

## File Structure

```
your-project/
  .claude/
    agents/             # Agent markdown files (Claude Code standard)
      test-writer.md
      ticket-to-pr.md   # Auto-generated from pipeline
    pipelines/          # Pipeline JSON definitions
      ticket-to-pr.pipeline.json
```

Both directories are designed to be committed to git and shared across your team.

## Project Structure

```
agent-flow/
├── .github/workflows/      # CI and release workflows
├── src/                     # React frontend
│   ├── components/
│   │   ├── canvas/          # React Flow canvas, nodes, edges, palette
│   │   ├── panels/          # Side panels (config, logs, library, settings)
│   │   ├── topbar/          # Top bar, pipeline selector
│   │   ├── bottombar/       # Bottom bar navigation
│   │   └── modals/          # Input prompt, generate prompt
│   ├── stores/              # Zustand state management
│   ├── types/               # TypeScript type definitions
│   ├── lib/                 # Utilities (Tauri IPC, formatting, error reporting)
│   └── hooks/               # Custom React hooks
├── src-tauri/               # Rust backend
│   └── src/
│       ├── lib.rs           # Plugin registration, command handlers
│       ├── executor.rs      # Pipeline execution engine
│       ├── pipeline_engine.rs   # Pipeline CRUD, agent markdown generation
│       ├── db.rs            # SQLite persistence
│       ├── agent_manager.rs # Agent file management
│       ├── error_log.rs     # Log file operations
│       ├── settings.rs      # App settings, CLI detection
│       └── git_watcher.rs   # File system watcher
└── docs/plans/              # Design documents
```

## CI/CD

### CI (on push/PR to main)

- TypeScript type checking
- Rust `cargo check` + `cargo clippy`
- Cross-platform build (Linux, macOS, Windows)
- Build artifacts uploaded for inspection

### Release (on tag push)

Tag a version to trigger a release:

```bash
git tag v0.2.0
git push origin v0.2.0
```

This builds for all platforms and creates a GitHub Release with downloadable installers.

### Download Links

| Platform | Format | Link |
|----------|--------|------|
| Linux | `.deb` | [agent-flow_0.2.0_amd64.deb](https://github.com/jadessoriano/agent-flow/releases/download/v0.2.0/agent-flow_0.2.0_amd64.deb) |
| Linux | `.AppImage` | [agent-flow_0.2.0_amd64.AppImage](https://github.com/jadessoriano/agent-flow/releases/download/v0.2.0/agent-flow_0.2.0_amd64.AppImage) |
| macOS | `.dmg` | [AgentFlow_0.2.0_aarch64.dmg](https://github.com/jadessoriano/agent-flow/releases/download/v0.2.0/AgentFlow_0.2.0_aarch64.dmg) |
| Windows | `.msi` | [AgentFlow_0.2.0_x64_en-US.msi](https://github.com/jadessoriano/agent-flow/releases/download/v0.2.0/AgentFlow_0.2.0_x64_en-US.msi) |
| Windows | `.exe` | [AgentFlow_0.2.0_x64-setup.exe](https://github.com/jadessoriano/agent-flow/releases/download/v0.2.0/AgentFlow_0.2.0_x64-setup.exe) |

> **Note**: Download links become available after the release is published. Visit the [Releases page](https://github.com/jadessoriano/agent-flow/releases/latest) for the latest version.

## How It Works

1. **You design** a pipeline visually on the canvas
2. **AgentFlow saves** two files:
   - `.claude/pipelines/{name}.pipeline.json` — the source of truth
   - `.claude/agents/{name}.md` — auto-generated for Claude Code CLI compatibility
3. **You click Run** — AgentFlow executes nodes in order, spawning Claude Code CLI for AI tasks and bash for shell commands
4. **Your team syncs** via git — teammates get both files on `git pull`
5. **Teammates choose** — use the visual editor or Claude Code CLI directly

AgentFlow never calls the Anthropic API directly. Claude Code CLI is always the execution engine, which means all your existing Claude Code settings, MCP servers, and custom skills work automatically.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run type checks (`npx tsc --noEmit` and `cargo check`)
5. Commit and push
6. Open a pull request

## License

This project is licensed under the [MIT License](LICENSE).
