import { useState } from "react";
import { useProjectStore } from "../stores/projectStore";
import { scanProject } from "../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { logError, addToast } from "../lib/errorReporter";
import AboutModal from "./AboutModal";

export default function WelcomeScreen() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const { recentProjects, openProject, initProject, removeRecent } =
    useProjectStore();

  const handleOpen = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    const path = selected as string;
    try {
      const info = await scanProject(path);
      if (!info.has_claude_dir) {
        if (
          confirm(
            `No .claude/ directory found in "${info.name}". Create .claude/agents/ and .claude/pipelines/ now?`,
          )
        ) {
          await initProject(path);
        }
      }
      await openProject(path);
    } catch (e) {
      logError(`Failed to open project: ${e}`, "WelcomeScreen");
      addToast(`Failed to open project: ${e}`);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <svg
              className="h-8 w-8 text-violet-400"
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
            <h1 className="text-2xl font-bold text-zinc-100">AgentFlow</h1>
          </div>
          <p className="text-sm text-zinc-500">
            Visual management for Claude Code agent pipelines
          </p>
        </div>

        {/* Open Project */}
        <button
          onClick={handleOpen}
          className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-500"
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
              d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
            />
          </svg>
          Open Project
        </button>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Recent Projects
            </h3>
            <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              {recentProjects.map((p) => (
                <div
                  key={p.path}
                  className="group flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-800"
                >
                  <button
                    onClick={() => openProject(p.path)}
                    className="flex-1 text-left"
                  >
                    <div className="text-sm font-medium text-zinc-200">
                      {p.name}
                    </div>
                    <div className="text-xs text-zinc-600 truncate">
                      {p.path}
                    </div>
                  </button>
                  <button
                    onClick={() => removeRecent(p.path)}
                    className="ml-2 rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-700 hover:text-zinc-400 group-hover:opacity-100"
                    title="Remove from list"
                  >
                    <svg
                      className="h-3.5 w-3.5"
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
              ))}
            </div>
          </div>
        )}
        {/* About link */}
        <div className="mt-6 text-center">
          <button
            onClick={() => setAboutOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
              />
            </svg>
            What is AgentFlow?
          </button>
        </div>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
