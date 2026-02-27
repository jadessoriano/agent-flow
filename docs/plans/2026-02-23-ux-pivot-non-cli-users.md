# AgentFlow UX Pivot: Targeting Non-CLI Users

**Date:** 2026-02-23
**Status:** Design approved, pending implementation

## Problem

AgentFlow was built for power users who already use agent pipelines in the terminal. These users prefer the CLI and don't need a GUI — the app adds friction, not value. The pivot targets people who *don't* know how to set up pipelines or run CLI tools but would benefit from AI-powered dev automation.

## Target Audience

Non-technical or semi-technical users who want custom development workflows but won't touch a terminal. They think in workflows (like Zapier/n8n users) but need software development automation, not SaaS integration.

## Key Differentiator

Unlike Zapier/n8n/Make (which connect SaaS APIs), AgentFlow orchestrates AI agents that read code, write code, run commands, and interact with git. It automates *software development tasks* locally on your codebase.

## Design Approach

UX/onboarding overhaul — not a feature rewrite. The execution engine is solid; the front door is the problem. Explicit Simple Mode and Advanced Mode to serve both audiences.

---

## Section 1: First Launch & Onboarding Flow

When a new user opens AgentFlow for the first time:

1. **Welcome Screen** (replaces current blank canvas) — shows a brief tagline: *"Automate your development workflow with AI"*, then immediately presents a **Template Gallery** as the main content. No setup required to browse.

2. **Template Gallery** — a grid of pre-built workflow cards with icons, titles, and one-line descriptions:
   - "Fix a Bug from Jira Ticket" — reads ticket, implements fix, runs tests, creates PR
   - "Add a Feature" — takes requirements, scaffolds code, writes tests
   - "Code Review" — reviews a PR and posts comments
   - "Run Tests & Fix Failures" — runs test suite, auto-fixes failing tests
   - "Refactor Module" — takes a file/folder, refactors with best practices
   - "Generate API Docs" — reads code, generates documentation
   - "+ Create from Scratch" — opens blank canvas (advanced)

3. **"Use This Template" button** — when clicked, the template loads onto the canvas with pre-configured nodes. The user sees the workflow visually *before* needing to set anything up.

4. **Setup triggered on "Run"** — only when they hit the Run button does the guided setup start (CLI detection, API key, project selection). This way they explore first, commit second.

---

## Section 2: Simple Mode UX

Simple Mode is the default for new users. It strips away technical syntax and replaces it with form-based configuration.

### What changes in Simple Mode

- **Node config panel** — instead of raw text fields with `{output.NODE_ID}` syntax, show:
  - A plain English "Instructions" textarea (what should the AI do?)
  - A dropdown for "Use output from" that lists upstream nodes by name — selecting one auto-inserts the variable reference behind the scenes
  - Checkboxes for common options instead of manual flags

- **Node labels** — instead of type names like "ai-task" or "shell", show friendly names: "AI Step", "Run Command", "Git Action", "Wait for Approval"

- **Edge labels** — instead of showing condition syntax, show "If successful ->" and "If failed ->" as plain labels

- **Variable references hidden** — the underlying `{output.NODE_ID}` and `$VARIABLE_NAME` syntax still powers the pipeline, but the UI presents dropdowns and selectors instead of requiring users to type syntax

- **Node palette** — simplified to 4-5 core types with descriptions. Advanced types (loop, sub-pipeline, parallel) hidden behind an "Advanced Nodes" expandable section

- **Canvas tooltips** — hovering over a node shows a one-line description of what it does: *"This step asks Claude to write code based on your instructions"*

### What stays the same

The canvas, drag-and-drop, edges, run controls, live logs, cost tracking — all work identically. Simple Mode is a presentation layer, not a different engine.

---

## Section 3: Guided Setup Wizard

Triggered when the user clicks "Run" for the first time (or any time the app detects missing prerequisites).

### Step 1: Claude Code CLI Detection
- Auto-scan for `claude` in PATH
- If found: green checkmark, show version, skip to next step
- If not found: show a single "Install Claude Code" button that opens the install page, plus a "I've installed it" retry button. No terminal commands shown — just the link and a button.

### Step 2: API Key / Authentication
- Check if Claude Code is already authenticated (`claude auth status` or similar)
- If authenticated: green checkmark, show account info, skip ahead
- If not: show "Sign in to Claude" button that triggers `claude login` behind the scenes. The user sees a browser auth flow, not terminal output.

### Step 3: Select Project
- File picker dialog: "Which project folder should AgentFlow work on?"
- After selection, show the folder name and a brief scan result: *"Found: Next.js project with 142 files"*
- This sets the working directory for all pipeline executions

### Step 4: Confirmation
- Summary card: CLI version, account, project path
- "Start Pipeline" button that dismisses the wizard and immediately runs the pipeline they originally clicked

### Key Principle

Each step auto-detects and skips if already configured. A returning user who switches projects only sees Step 3. A fully configured user never sees the wizard at all.

---

## Section 4: Contextual Learning

Instead of a separate tutorial mode, learning is embedded into the normal workflow through contextual hints that appear at the right moment.

### First-time hints (shown once, dismissed permanently)

- **First template load** — a small banner above the canvas: *"This is your workflow. Each box is a step. Click any step to see what it does."*
- **First node click** — tooltip on the config panel: *"Edit the instructions here to change what this step does."*
- **First successful run** — celebration toast with: *"Your first workflow ran successfully! Try editing a step and running again."*
- **First edge hover** — tooltip: *"This arrow connects steps. The workflow follows these arrows in order."*

### Persistent help (always available)

- **"?" icon** on each config field — clicking shows a 1-2 sentence explanation of what that field does
- **Node type descriptions** — in the palette, each node type has a subtitle: "AI Step — *Ask Claude to do something with your code*"
- **Empty state guidance** — when the canvas is blank: *"Drag a step from the left panel, or pick a template to get started"*

### Progressive disclosure to Advanced Mode

- After 3+ successful pipeline runs, a subtle prompt appears: *"Want more control? Try Advanced Mode for variable references, loops, and parallel execution."*
- The user can dismiss this permanently or switch modes

No interactive tutorial, no video walkthroughs, no documentation to read. Just the right hint at the right moment.

---

## Section 5: Mode Switching (Simple <-> Advanced)

- **Toggle location** — a switch in the top bar or Settings panel: "Simple Mode / Advanced Mode"
- **Default** — new users start in Simple Mode. The preference is persisted in settings.
- **Switching to Advanced** — all hidden syntax becomes visible. Dropdowns are replaced with raw text fields. Advanced node types (loop, parallel, sub-pipeline) appear in the palette. No data is lost — the pipeline is the same, just shown differently.
- **Switching to Simple** — raw syntax fields are replaced with dropdowns/forms where possible. If a node has manually-typed variable references that can't be mapped to a dropdown, show a warning: *"This step uses advanced syntax. It will still work, but you'll need Advanced Mode to edit it."*
- **Per-pipeline indicator** — if a pipeline uses advanced features (loops, parallel, complex variables), show a small "Advanced" badge on it in the pipeline list so Simple Mode users know it may need mode switching to fully edit.

---

## Implementation Priority

1. **Template Gallery & Welcome Screen** — highest impact, gets users exploring immediately
2. **Guided Setup Wizard** — unblocks first run without terminal knowledge
3. **Simple Mode node config** — form-based config with dropdowns instead of syntax
4. **Contextual hints** — lightweight, can ship incrementally
5. **Mode switching** — ties everything together, depends on Simple Mode being implemented
