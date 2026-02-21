interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <div className="flex items-center gap-2">
            <svg
              className="h-6 w-6 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-zinc-100">
              About AgentFlow
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-6 px-6 py-5 text-sm text-zinc-300">
          {/* What is AgentFlow */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              What is AgentFlow?
            </h3>
            <p className="leading-relaxed text-zinc-400">
              AgentFlow is a desktop application for visually creating, managing,
              and running Claude Code agent pipelines. It provides a drag-and-drop
              canvas for building multi-step workflows from agents and commands,
              all stored as standard files in your project's git repository.
            </p>
          </section>

          {/* Features */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              Features
            </h3>
            <ul className="flex flex-col gap-2 text-zinc-400">
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Visual Pipeline Builder</strong>{" "}
                  — Drag-and-drop nodes onto a canvas to chain AI tasks, shell
                  commands, git operations, parallel groups, approval gates, and
                  sub-pipelines.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Sub-Pipeline Composition</strong>{" "}
                  — Nest pipelines inside each other for modular, reusable
                  workflows with circular-reference protection.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Agent Management</strong>{" "}
                  — Browse, create, edit, and delete{" "}
                  <code className="rounded bg-zinc-800 px-1 text-xs">.claude/agents/*.md</code>{" "}
                  files with a built-in Markdown editor and live preview.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">MCP Tool Validation</strong>{" "}
                  — Declare required MCP servers per node. Pipelines fail
                  immediately if tools are missing — zero tokens wasted.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Cost Estimation & Tracking</strong>{" "}
                  — See estimated costs before running and real-time per-node
                  cost breakdown during execution.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Resume from Failure</strong>{" "}
                  — When a pipeline fails, resume from where it left off with
                  all prior context and inputs preserved.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Run History</strong>{" "}
                  — Every pipeline run is persisted locally. Review past results,
                  costs, and re-run from history.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Git-Native Storage</strong>{" "}
                  — Agents and pipelines are plain files in your repo. Share them
                  with your team via normal git push/pull.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Smart CLI Detection</strong>{" "}
                  — Auto-detects Claude Code CLI across nvm, bun, Homebrew,
                  Claude Desktop, snap, and system paths.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Multi-Project Support</strong>{" "}
                  — Open any project directory. Recent projects are remembered for
                  quick switching.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-violet-400">-</span>
                <span>
                  <strong className="text-zinc-300">Auto-Generated Agents</strong>{" "}
                  — Pipelines auto-generate compatible{" "}
                  <code className="rounded bg-zinc-800 px-1 text-xs">.md</code>{" "}
                  files so Claude Code works without this app.
                </span>
              </li>
            </ul>
          </section>

          {/* Privacy & Security */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-400">
              Privacy & Security
            </h3>
            <ul className="flex flex-col gap-2 text-zinc-400">
              <li className="flex gap-2">
                <span className="mt-0.5 text-green-400">-</span>
                <span>
                  <strong className="text-zinc-300">No data collection.</strong>{" "}
                  AgentFlow does not collect, transmit, or store any telemetry,
                  analytics, or usage data. Zero network calls to external services.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-green-400">-</span>
                <span>
                  <strong className="text-zinc-300">Not an AI/LLM.</strong>{" "}
                  This app is a management layer only. It reads and writes local
                  files, and when you run a pipeline, it spawns your local Claude
                  Code CLI as a child process. The app itself contains no AI model.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-green-400">-</span>
                <span>
                  <strong className="text-zinc-300">Fully local.</strong>{" "}
                  All data stays on your machine. Settings are stored in your OS
                  app data directory. Agents and pipelines live in your git repo.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 text-green-400">-</span>
                <span>
                  <strong className="text-zinc-300">Open file formats.</strong>{" "}
                  Agents are Markdown files. Pipelines are JSON files. No
                  proprietary formats or lock-in.
                </span>
              </li>
            </ul>
          </section>

          {/* How it works */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              How It Works
            </h3>
            <p className="leading-relaxed text-zinc-400">
              AgentFlow sits between you and your existing Claude Code setup. When
              you run a pipeline, it validates MCP tool requirements, estimates
              costs, then executes each step by either spawning the{" "}
              <code className="rounded bg-zinc-800 px-1 text-xs">claude</code>{" "}
              CLI (for AI tasks) or running shell commands directly. Sub-pipelines
              are resolved and executed inline with circular-reference protection.
              Your authentication, MCP servers, skills, and configuration are all
              handled by Claude Code — AgentFlow just orchestrates the sequence.
            </p>
          </section>

          {/* Keyboard shortcuts */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-400">
              Keyboard Shortcuts
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Ctrl+S</kbd> Save pipeline</span>
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Ctrl+Z</kbd> Undo</span>
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Ctrl+Shift+Z</kbd> Redo</span>
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Space</kbd> Zoom to fit</span>
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Delete</kbd> Remove node</span>
              <span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Escape</kbd> Deselect</span>
            </div>
          </section>

          {/* Version */}
          <div className="border-t border-zinc-800 pt-4 text-center text-xs text-zinc-600">
            AgentFlow v0.2.0 — Built with Tauri, React, and TypeScript
          </div>
        </div>
      </div>
    </div>
  );
}
