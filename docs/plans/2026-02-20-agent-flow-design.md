# AgentFlow — Design & Implementation Plan

A Tauri desktop app that lets developer teams visually create, manage, and run Claude Code agent pipelines. Agents are stored as `.claude/agents/*.md` files in the git repo — the app is a GUI layer on top of what Claude Code already supports.

---

## Product Overview

**Name**: AgentFlow
**Platform**: Tauri v2 desktop app (Rust backend, React/TypeScript frontend)
**Core principle**: The app manages agents and pipelines. Claude Code executes them. Clean separation — no AI reimplementation.

**Target users**: Developer teams where each member has their own local Claude Code installation.

**Tech stack**:
- **Shell**: Tauri v2 (Rust backend, WebView frontend)
- **Frontend**: React + TypeScript + Tailwind CSS
- **State management**: Zustand
- **Flow editor**: React Flow (node/edge canvas library)
- **Markdown editor**: MDX editor with live preview
- **Execution**: Spawns Claude Code CLI as child process
- **History storage**: SQLite (local)
- **Agent sync**: Git-native — agents live in `.claude/agents/`, sync via git pull/push

---

## Core Features

### 1. Agent Creation & Editing
- Visual editor for `.claude/agents/*.md` files
- Rich markdown editor with live preview
- Create new agents from templates or from scratch

### 2. Agent Discovery
- Searchable library of all agents in the project
- View agent details, last run time, description
- Distinguish between single agents and pipelines

### 3. Pipeline Orchestration
- Visual drag-and-drop flow editor (React Flow canvas)
- Chain agents and commands into multi-step pipelines
- Parallel execution, conditional branching, retry policies
- Pipelines auto-generate agent markdown files for Claude Code compatibility

---

## Architecture

```
+------------------------------------------------------+
|                   Tauri App                           |
|                                                       |
|  +------------------------------------------------+  |
|  |              React Frontend                     |  |
|  |                                                 |  |
|  |  - Canvas (React Flow) — always visible         |  |
|  |  - Side panels (library, config, logs, history) |  |
|  |  - Node palette (drag to canvas)                |  |
|  |  - Pipeline selector dropdown                   |  |
|  |  - Top bar (run, save, settings)                |  |
|  +---------------------+-------------------------+  |
|                         | Tauri IPC (invoke/events)   |
|  +---------------------v--------------------------+  |
|  |              Rust Backend                       |  |
|  |                                                 |  |
|  |  +------------+ +------------+ +------------+  |  |
|  |  | Agent      | | Pipeline   | | Executor   |  |  |
|  |  | Manager    | | Engine     | |            |  |  |
|  |  |            | |            | | spawns     |  |  |
|  |  | read/write | | parse flow | | claude cli |  |  |
|  |  | .md files  | | run nodes  | | processes  |  |  |
|  |  +------------+ +------------+ +------+-----+  |  |
|  |  +------------+ +------------+        |        |  |
|  |  | Git        | | Run        |        |        |  |
|  |  | Watcher    | | History    |        |        |  |
|  |  |            | | (SQLite)   |        |        |  |
|  |  | detect     | |            |        |        |  |
|  |  | agent      | | store logs |        |        |  |
|  |  | changes    | | & results  |        |        |  |
|  |  +------------+ +------------+        |        |  |
|  +---------------------------------------+--------+  |
+--------------------------------------+---------------+
                                       |
                                       v
                                Claude Code CLI
                                (child process)
```

### Rust Backend Modules

| Module | Responsibility |
|---|---|
| **Agent Manager** | CRUD `.claude/agents/*.md` files. Parse markdown to/from structured data. |
| **Pipeline Engine** | Parse flow graph (nodes + edges). Execute nodes in order, handle parallel groups, conditions, retries. |
| **Executor** | Spawn Claude Code CLI or shell commands as child processes. Stream stdout/stderr back to frontend via Tauri events. |
| **Git Watcher** | Watch `.claude/agents/` and `.claude/pipelines/` for file changes (teammate pushes new agent). Auto-refresh library. |
| **Run History** | SQLite database. Store pipeline runs, logs, results, duration. |

---

## Data Model & File Formats

### Agent Files (existing Claude Code format)
Standard `.claude/agents/*.md` — the app reads/writes these directly.

```
.claude/agents/
  test-writer.md
  doc-updater.md
  pr-prep.md
  ticket-to-pr.md
```

### Pipeline Files (new format)
Stored as `.claude/pipelines/*.json` — define the visual flow graph.

```
.claude/pipelines/
  ticket-to-pr.pipeline.json
  hotfix.pipeline.json
```

### Pipeline JSON Schema

```json
{
  "name": "ticket-to-pr",
  "description": "Jira ticket to merged PR",
  "version": "1.0.0",
  "variables": {
    "JIRA_PROJECT_KEY": "ML",
    "BASE_BRANCH": "develop",
    "ORG": "Betrnk-Cloud-Org"
  },
  "nodes": [
    {
      "id": "fetch-ticket",
      "name": "Fetch Jira Ticket",
      "type": "ai-task",
      "instructions": "Fetch Jira ticket {input.ticketKey} using Atlassian MCP tools. Extract summary, description, issue type.",
      "inputs": ["ticketKey"],
      "outputs": ["summary", "issueType", "description"],
      "position": { "x": 100, "y": 200 }
    },
    {
      "id": "create-worktree",
      "name": "Create Worktree",
      "type": "shell",
      "instructions": "git fetch origin $BASE_BRANCH && git worktree add .worktrees/{branchName} -b {branchName} origin/$BASE_BRANCH",
      "inputs": ["branchName"],
      "outputs": ["worktreePath"],
      "position": { "x": 400, "y": 200 }
    },
    {
      "id": "run-tests",
      "name": "Run Tests",
      "type": "parallel",
      "children": ["backend-tests", "frontend-tests"],
      "position": { "x": 1000, "y": 200 }
    },
    {
      "id": "backend-tests",
      "name": "Backend Tests",
      "type": "shell",
      "instructions": "cd backend && php artisan test",
      "retry": { "max": 3, "delay": 5 },
      "position": { "x": 900, "y": 100 }
    },
    {
      "id": "frontend-tests",
      "name": "Frontend Tests",
      "type": "shell",
      "instructions": "cd frontend && npm test",
      "retry": { "max": 3, "delay": 5 },
      "position": { "x": 900, "y": 300 }
    },
    {
      "id": "review-gate",
      "name": "Review Before PR",
      "type": "approval-gate",
      "instructions": "Review the changes before creating PR",
      "position": { "x": 1300, "y": 200 }
    }
  ],
  "edges": [
    { "from": "fetch-ticket", "to": "create-worktree" },
    { "from": "create-worktree", "to": "implement" },
    { "from": "implement", "to": "run-tests" },
    { "from": "run-tests", "to": "review-gate", "condition": "success" },
    { "from": "run-tests", "to": "fix-tests", "condition": "failure" },
    { "from": "fix-tests", "to": "run-tests" },
    { "from": "review-gate", "to": "create-pr" }
  ]
}
```

### Node Definition

Each node in the pipeline has:

| Field | Description | Example |
|---|---|---|
| **id** | Unique identifier | "fetch-ticket" |
| **name** | Display label | "Fetch Jira Ticket" |
| **type** | `ai-task`, `shell`, `git`, `parallel`, `approval-gate`, `sub-pipeline` | `shell` |
| **instructions** | Prompt (AI) or command (shell) | `cd backend && php artisan test` |
| **inputs** | Data from upstream nodes | `["ticketKey"]` |
| **outputs** | Data passed downstream | `["summary", "issueType"]` |
| **retry** | Retry policy | `{ "max": 3, "delay": 5 }` |
| **timeout** | Max execution time in seconds | `120` |
| **children** | Child node IDs (parallel groups only) | `["backend-tests", "frontend-tests"]` |
| **condition** | Edge condition for branching | `"success"` or `"failure"` |
| **position** | Canvas x/y coordinates | `{ "x": 100, "y": 200 }` |

### Node Types

| Type | What it does | Executed by |
|---|---|---|
| **ai-task** | Sends instructions to Claude for AI-powered work | Claude Code CLI |
| **shell** | Runs a bash command directly | Tauri Rust backend |
| **git** | Git operations (commit, push, branch) | Tauri Rust backend |
| **parallel** | Container that runs children simultaneously, waits for all | Pipeline engine |
| **approval-gate** | Pauses pipeline, waits for dev to approve/reject in app | Pipeline engine |
| **sub-pipeline** | Calls another pipeline by name (like a function call) | Pipeline engine |

### Pipeline Variables

Defined at pipeline level, referenced in any node with `$VARIABLE_NAME`:

```json
"variables": {
  "JIRA_PROJECT_KEY": "ML",
  "BASE_BRANCH": "develop"
}
```

Secret variables stored in OS keychain (never committed to git).

### Run History (SQLite)

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_name TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  status TEXT NOT NULL DEFAULT 'running',  -- running, success, failed, cancelled
  trigger_input TEXT  -- JSON of input variables
);

CREATE TABLE run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, success, failed, skipped
  log_output TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

### Auto-Generation

Pipeline JSON is the source of truth. The app auto-generates `.claude/agents/*.md` from pipeline files so Claude Code works without the app:

```
Developer creates pipeline in visual editor
  -> App saves .claude/pipelines/ticket-to-pr.pipeline.json
  -> App also generates .claude/agents/ticket-to-pr.md
  -> Git commit -> teammates get both files on pull
  -> Teammate opens app -> sees pipeline in library
  -> OR teammate uses Claude Code CLI directly -> agent .md works
```

---

## UI Design — Canvas-First

The app has ONE main screen (the canvas) with slide-in panels.

### Layout

```
+-----------------------------------------------------------+
|  Top Bar                                                   |
|  Logo  |  Pipeline selector v  |  > Run  |  Save  |  Gear |
+-----------------------------------------------------------+
|                                                   |        |
|                                                   | Side   |
|                    Canvas                         | Panel  |
|               (always visible)                    | (slides|
|                                                   |  in)   |
|            [React Flow node graph]                |        |
|                                                   |        |
+-----------------------------------------------------------+
|  Bottom Bar                                                |
|  Library  |  Runs  |  + New  |               Zoom: 100%   |
+-----------------------------------------------------------+
```

### Side Panel Modes

| Trigger | Panel shows |
|---|---|
| Click a node | **Node Config** — edit name, type, instructions, retry, conditions |
| Click Library (bottom bar) | **Agent Library** — browse/search all agents and pipelines |
| Click Runs (bottom bar) | **Run History** — past runs with status, duration, logs |
| Click Settings (top bar) | **Settings** — project path, CLI path, variables |
| Click running node | **Live Log** — streaming output for that node |

### Canvas Modes

**Edit mode** (default):
- Drag nodes from palette to canvas
- Connect nodes with edges (draw arrows)
- Click nodes to configure in side panel
- Delete/duplicate nodes
- Zoom/pan canvas

**Run mode** (activated when > Run is clicked):
- Canvas becomes read-only
- Nodes animate with status:
  - Gray outline = pending
  - Pulsing yellow = running
  - Green = success
  - Red = failed
- Active node has a glow effect
- Click any completed node to see its log in side panel
- Cancel button appears in top bar
- Auto-switches back to edit mode when finished

### Pipeline Selector (top bar dropdown)

Lists all pipelines in `.claude/pipelines/`. Quick switch between pipelines.
Options: edit, duplicate, delete, + New Pipeline, + Import from file.

### Node Palette (bottom-left corner, always visible)

Draggable node types:
- AI Task
- Shell Command
- Git Operation
- Parallel Group
- Approval Gate
- Sub-pipeline

Drag a node type onto the canvas to create it.

---

## Implementation Phases

### Phase 1 — Foundation (MVP)
Get the app running with basic agent management.

**Tasks:**
1. Initialize Tauri v2 project with React + TypeScript + Tailwind
2. Set up project structure:
   ```
   agent-flow/
     src-tauri/        # Rust backend
       src/
         main.rs
         agent_manager.rs
         lib.rs
     src/              # React frontend
       App.tsx
       components/
       stores/
       types/
     package.json
     tauri.conf.json
   ```
3. Rust backend: `agent_manager.rs`
   - `list_agents(project_path)` — scan `.claude/agents/*.md`, return list
   - `read_agent(path)` — parse markdown file, return name + content
   - `write_agent(path, content)` — write markdown to file
   - `delete_agent(path)` — remove file
4. Tauri IPC commands: expose Rust functions to frontend
5. Frontend: Agent Library side panel
   - List all agents with name, description, file type (agent vs pipeline)
   - Search/filter agents
   - Click to view full content
6. Frontend: Agent Editor
   - Markdown editor (left) + live preview (right)
   - Save button writes back to `.md` file via Tauri IPC
   - Create new agent from blank or template
7. Frontend: Settings panel
   - Configure project directory path
   - Configure Claude Code CLI path (auto-detect if possible)
   - Store in Tauri app data directory
8. Empty React Flow canvas (placeholder for Phase 2)

**Deliverable**: App that can browse, create, and edit `.claude/agents/*.md` files visually.

### Phase 2 — Pipeline Builder
The core visual flow editor.

**Tasks:**
1. Define pipeline JSON schema (as documented above)
2. Rust backend: `pipeline_engine.rs`
   - `list_pipelines(project_path)` — scan `.claude/pipelines/*.json`
   - `read_pipeline(path)` — parse JSON, return structured pipeline
   - `write_pipeline(path, pipeline)` — save JSON
   - `generate_agent_md(pipeline)` — convert pipeline JSON to agent markdown
3. React Flow canvas implementation:
   - Custom node components for each type (AI Task, Shell, Git, Parallel, Gate, Sub-pipeline)
   - Each node type has distinct visual style (icon, color, shape)
   - Edge drawing with click-to-connect
   - Drag from node palette to canvas to create nodes
4. Node config side panel:
   - Dynamic form based on node type
   - Name, type, instructions fields
   - Inputs/outputs configuration
   - Retry policy (max, delay)
   - Timeout setting
5. Pipeline selector dropdown in top bar
   - List all pipelines
   - Switch between pipelines (swap canvas content)
   - Create new / duplicate / delete pipeline
6. Save pipeline:
   - Save to `.claude/pipelines/{name}.pipeline.json`
   - Auto-generate `.claude/agents/{name}.md`
   - Both files committed together via git
7. Rust backend: `git_watcher.rs`
   - Watch `.claude/agents/` and `.claude/pipelines/` directories
   - Emit Tauri event when files change (teammate pushed new agent)
   - Frontend auto-refreshes library on event
8. Conditional edges:
   - Edge labels showing "success" / "failure"
   - Click edge to set condition
   - Visual distinction (green edge for success, red for failure)

**Deliverable**: Visual pipeline builder that creates real pipeline JSON and agent markdown files.

### Phase 3 — Execution Engine
Run pipelines from the app.

**Tasks:**
1. Rust backend: `executor.rs`
   - `start_run(pipeline, inputs)` — begin pipeline execution
   - For `shell` nodes: spawn bash child process, capture stdout/stderr
   - For `ai-task` nodes: spawn `claude` CLI with `--agent` flag as child process
   - For `git` nodes: execute git commands directly
   - Stream all output via Tauri events to frontend
   - Track node status: pending -> running -> success/failed
2. Rust backend: `run_history.rs`
   - Initialize SQLite database on first launch
   - `create_run(pipeline_name, inputs)` — insert new run
   - `update_step(run_id, node_id, status, log)` — update step progress
   - `list_runs(limit, offset)` — paginated history
   - `get_run(run_id)` — full run details with all steps
3. Frontend: Canvas run mode
   - Toggle edit mode -> run mode on "Run" click
   - Node status animations (pending/running/success/failed)
   - Glow effect on active node
   - Progress indicator on top bar (step 3/8)
4. Frontend: Live log panel
   - Click running or completed node to see output
   - Streaming log display (auto-scroll, monospace font)
   - Copy log to clipboard button
5. Frontend: Run history panel (bottom bar)
   - List past runs with status, duration, pipeline name
   - Click to view run details and per-step logs
   - Filter by pipeline, status, date
6. Cancel/abort:
   - Cancel button in top bar during run mode
   - Kill child processes gracefully (SIGTERM, then SIGKILL after timeout)
   - Mark run and remaining steps as "cancelled"
7. Input prompt:
   - Before running, if pipeline has required inputs (e.g., `ticketKey`), show modal to collect them
   - Pre-fill from last run if available

**Deliverable**: Full run loop — build a pipeline, click Run, watch nodes execute on canvas, view logs.

### Phase 4 — Advanced Nodes
Complex pipeline features.

**Tasks:**
1. Parallel group nodes:
   - Container node that visually wraps child nodes
   - Engine spawns all children simultaneously
   - Waits for ALL children to complete before proceeding
   - If any child fails, the parallel group fails
   - Canvas shows all children running simultaneously with individual status
2. Conditional branching:
   - Edges with conditions (`success`, `failure`, custom expressions)
   - Engine evaluates conditions based on previous node exit code/output
   - Visual: green arrows for success path, red for failure path
   - Support retry loops (failure edge back to same node)
3. Retry policies:
   - Per-node: max attempts, delay between retries
   - Engine retries failed nodes automatically
   - Canvas shows retry count on node (attempt 2/3)
   - Log output includes all attempts
4. Approval gates:
   - Node type that pauses pipeline execution
   - Shows system notification to developer
   - Side panel shows "Approve" / "Reject" buttons
   - Pipeline resumes on approve, aborts on reject
   - Timeout option: auto-reject after N minutes
5. Sub-pipeline nodes:
   - Reference another pipeline by name
   - Engine loads and executes the sub-pipeline inline
   - Inputs/outputs pass between parent and child pipeline
   - Canvas shows sub-pipeline as a single node (expandable to see internals)
6. Timeout per node:
   - Engine kills node process after timeout
   - Mark as failed with "timeout" reason
   - Trigger failure edge if configured

**Deliverable**: Full pipeline orchestration with branching, parallelism, retries, and human-in-the-loop gates.

### Phase 5 — Variables & Polish
Production-ready features.

**Tasks:**
1. Pipeline-level variables:
   - Define variables in pipeline settings (key-value pairs)
   - Reference in any node with `$VARIABLE_NAME`
   - Engine substitutes variables before execution
   - Override variables per-run via input prompt
2. Secret variables:
   - Stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
   - Never written to pipeline JSON or committed to git
   - Shown as masked (`***`) in UI
   - Use for API keys, tokens, passwords
3. Import/export:
   - Export pipeline as standalone `.pipeline.json` file
   - Import pipeline from file into current project
   - Copy pipeline between projects
4. Keyboard shortcuts:
   - `Cmd+S` / `Ctrl+S` — save pipeline
   - `Cmd+R` / `Ctrl+R` — run pipeline
   - `Delete` / `Backspace` — delete selected node
   - `Cmd+D` / `Ctrl+D` — duplicate selected node
   - `Cmd+Z` / `Ctrl+Z` — undo
   - `Space` — zoom to fit
   - `Escape` — close side panel / cancel
5. Run notifications:
   - System notification when pipeline completes or fails
   - Notification shows pipeline name, status, duration
   - Click notification to open app and view results
6. Error recovery:
   - "Resume from failed node" option on failed runs
   - Skips already-completed nodes
   - Retries the failed node and continues
7. Undo/redo:
   - Track canvas changes (add/remove/move nodes, edit config)
   - Undo stack with `Cmd+Z`, redo with `Cmd+Shift+Z`

**Deliverable**: Polished, team-ready desktop app.

---

## Project Setup

### Initialize the project

```bash
# Install Tauri CLI
cargo install tauri-cli

# Create Tauri v2 project with React + TypeScript
npm create tauri-app@latest agent-flow -- --template react-ts

# Navigate to project
cd agent-flow

# Install frontend dependencies
npm install react-flow-renderer zustand tailwindcss @tailwindcss/typography
npm install -D @types/react @types/react-dom

# Install Tauri plugins
cargo add tauri-plugin-sql    # SQLite support
cargo add tauri-plugin-fs     # File system access
cargo add tauri-plugin-shell  # Spawn child processes
cargo add notify              # File system watcher
```

### Project Structure

```
agent-flow/
  src-tauri/
    src/
      main.rs                 # Tauri app entry point
      lib.rs                  # Module declarations
      agent_manager.rs        # Read/write .claude/agents/*.md
      pipeline_engine.rs      # Parse and execute pipeline flows
      executor.rs             # Spawn Claude Code CLI / shell processes
      git_watcher.rs          # Watch for file changes
      run_history.rs          # SQLite run storage
    tauri.conf.json           # Tauri app config
    Cargo.toml
  src/
    App.tsx                   # Main app component
    main.tsx                  # React entry point
    components/
      canvas/
        Canvas.tsx            # React Flow wrapper
        nodes/
          AiTaskNode.tsx      # AI task node component
          ShellNode.tsx       # Shell command node
          GitNode.tsx         # Git operation node
          ParallelNode.tsx    # Parallel group container
          ApprovalNode.tsx    # Approval gate node
          SubPipelineNode.tsx # Sub-pipeline reference
        edges/
          ConditionalEdge.tsx # Edge with condition label
        NodePalette.tsx       # Draggable node type list
      panels/
        AgentLibrary.tsx      # Browse/search agents
        AgentEditor.tsx       # Markdown editor + preview
        NodeConfig.tsx        # Node configuration form
        LiveLog.tsx           # Streaming log output
        RunHistory.tsx        # Past runs list
        Settings.tsx          # App settings
      topbar/
        TopBar.tsx            # Logo, pipeline selector, run button
        PipelineSelector.tsx  # Dropdown to switch pipelines
      shared/
        StatusBadge.tsx       # Run status indicator
        NodeIcon.tsx          # Node type icons
    stores/
      pipelineStore.ts        # Zustand store for current pipeline state
      agentStore.ts           # Zustand store for agent library
      runStore.ts             # Zustand store for active run
      settingsStore.ts        # Zustand store for app settings
    types/
      pipeline.ts             # Pipeline, Node, Edge type definitions
      agent.ts                # Agent type definitions
      run.ts                  # Run, RunStep type definitions
    lib/
      tauri.ts                # Tauri IPC invoke wrappers
      markdown.ts             # Markdown parsing utilities
      pipeline-to-md.ts       # Convert pipeline JSON to agent markdown
    styles/
      globals.css             # Tailwind base styles
  package.json
  tsconfig.json
  tailwind.config.ts
  docs/
    plans/
      2026-02-20-agent-flow-design.md  # This document
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | Tauri v2 | Lightweight (vs Electron), Rust backend for fast filesystem ops, web frontend (React) |
| UI pattern | Canvas-first | Pipeline builder is the primary feature — make it the home screen |
| Flow editor | React Flow | Battle-tested, customizable nodes/edges, built-in zoom/pan/selection |
| State management | Zustand | Lightweight, no boilerplate, works well with React Flow |
| Agent storage | Git-native `.md` files | Zero infrastructure, team syncs via git, Claude Code compatible |
| Pipeline storage | JSON files | Structured, parseable by Rust, stores canvas positions |
| Execution | Shell out to Claude Code CLI | Each dev already authenticated, all settings/MCP/skills work |
| History | SQLite | Perfect for local desktop apps, queryable, no server needed |
| Sync | Git pull/push | No central server, no extra infrastructure |
| Auto-generate | Pipeline JSON -> agent markdown | Claude Code works without the app installed |

---

## How to Use This Plan

This plan is designed to be fed to a Claude Code session for implementation. Start with Phase 1 and work through each phase sequentially. Each phase builds on the previous one.

**To start implementation:**
1. Open a new Claude Code session in the `agent-flow` directory
2. Feed this plan file
3. Say: "Implement Phase 1 of the AgentFlow design plan"
4. Continue through phases as each is completed

**Important context:**
- This app is built for a team that uses Claude Code with custom agents
- The pipeline JSON format is new — it generates standard `.claude/agents/*.md` files
- The Rust backend handles filesystem, process spawning, and SQLite
- The React frontend handles all visual/interactive elements
- Claude Code CLI is always the execution engine — this app never calls the Anthropic API directly
