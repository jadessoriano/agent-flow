import { useState, useRef, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useRunStore } from "../../stores/runStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import { open } from "@tauri-apps/plugin-dialog";
import { logError, addToast } from "../../lib/errorReporter";
import PipelineSelector from "./PipelineSelector";
import AboutModal from "../AboutModal";
import InputPrompt from "../modals/InputPrompt";
import GeneratePrompt from "../modals/GeneratePrompt";
import DiffModal from "../modals/DiffModal";

export default function TopBar() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const openProject = useProjectStore((s) => s.openProject);
  const closeProject = useProjectStore((s) => s.closeProject);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const dirty = usePipelineStore((s) => s.dirty);
  const savePipeline = usePipelineStore((s) => s.savePipeline);
  const undo = usePipelineStore((s) => s.undo);
  const redo = usePipelineStore((s) => s.redo);
  const canUndo = usePipelineStore((s) => s.canUndo);
  const canRedo = usePipelineStore((s) => s.canRedo);
  const running = useRunStore((s) => s.running);
  const startRun = useRunStore((s) => s.startRun);
  const cancelRun = useRunStore((s) => s.cancelRun);
  const settings = useSettingsStore((s) => s.settings);
  const togglePanel = useUIStore((s) => s.togglePanel);
  const openPanel = useUIStore((s) => s.openPanel);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [inputPromptOpen, setInputPromptOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const savedPipeline = usePipelineStore((s) => s.savedPipeline);
  const loadGeneratedPipeline = usePipelineStore((s) => s.loadGeneratedPipeline);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleOpenProject = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openProject(selected as string);
      setSwitcherOpen(false);
    }
  };

  const handleSave = async () => {
    if (!currentProject || !currentPipeline) return;
    try {
      await savePipeline(currentProject.path);
    } catch (e) {
      logError(`Save failed: ${e}`, "TopBar");
      addToast(`Save failed: ${e}`);
    }
  };

  const handleRunClick = async () => {
    if (!currentPipeline || !currentProject) return;
    if (running) {
      cancelRun();
      return;
    }
    // Validate pipeline before running
    try {
      const { validatePipeline } = await import("../../lib/validatePipeline");
      const errors = validatePipeline(currentPipeline);
      const blockers = errors.filter((e) => e.severity === "error");
      const warnings = errors.filter((e) => e.severity === "warning");
      if (blockers.length > 0) {
        for (const err of blockers) {
          const nodeId = err.nodeId;
          addToast(
            err.message,
            "error",
            nodeId ? () => useUIStore.getState().focusNode(nodeId) : undefined,
          );
        }
        return;
      }
      if (warnings.length > 0) {
        for (const warn of warnings) {
          const nodeId = warn.nodeId;
          addToast(
            warn.message,
            "warning",
            nodeId ? () => useUIStore.getState().focusNode(nodeId) : undefined,
          );
        }
      }
    } catch {
      // Validation import failed — proceed anyway
    }
    // Always show the modal for cost visibility
    setInputPromptOpen(true);
  };

  const doRun = async (inputs: Record<string, string>) => {
    if (!currentPipeline || !currentProject) return;
    setInputPromptOpen(false);
    openPanel("liveLog");
    try {
      await startRun(
        currentPipeline,
        inputs,
        settings.claude_cli_path || "claude",
        currentProject.path,
      );
    } catch (e) {
      logError(`Run failed: ${e}`, "TopBar");
      addToast(`Run failed: ${e}`);
    }
  };

  // Ctrl+S / Cmd+S save shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentProject, currentPipeline, savePipeline]);

  return (
    <div className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4">
      {/* Left: Project Switcher */}
      <div className="flex items-center gap-3" ref={switcherRef}>
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen(!switcherOpen)}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <svg
              className="h-4 w-4 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <span>{currentProject?.name ?? "AgentFlow"}</span>
            <svg
              className="h-3 w-3 text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {switcherOpen && (
            <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
              <div className="p-2">
                <button
                  onClick={handleOpenProject}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  Open Another Project...
                </button>
              </div>
              {recentProjects.length > 0 && (
                <>
                  <div className="border-t border-zinc-700" />
                  <div className="p-2">
                    <div className="px-3 py-1 text-xs font-medium text-zinc-500">
                      Recent
                    </div>
                    {recentProjects.map((p) => (
                      <button
                        key={p.path}
                        onClick={() => {
                          openProject(p.path);
                          setSwitcherOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="ml-2 max-w-[120px] shrink-0 truncate text-xs text-zinc-600">
                          {p.path}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {currentProject && (
                <>
                  <div className="border-t border-zinc-700" />
                  <div className="p-2">
                    <button
                      onClick={() => {
                        closeProject();
                        setSwitcherOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    >
                      Close Project
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Center: Pipeline selector + Generate */}
      <div className="flex items-center gap-1">
        <PipelineSelector />
        {currentProject && (
          <button
            onClick={() => setGenerateOpen(true)}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-violet-400"
            title="Generate Pipeline with AI"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {currentPipeline && (
          <div className="flex items-center">
            <button
              onClick={undo}
              disabled={!canUndo()}
              className="rounded-l p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
              title="Undo (Ctrl+Z)"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            </button>
            <button
              onClick={redo}
              disabled={!canRedo()}
              className="rounded-r p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
              title="Redo (Ctrl+Shift+Z)"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
            </button>
          </div>
        )}
        {currentPipeline && dirty && (
          <>
            {savedPipeline && (
              <button
                onClick={() => setDiffOpen(true)}
                className="rounded bg-zinc-700/50 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                title="Review changes before saving"
              >
                Review
              </button>
            )}
            <button
              onClick={handleSave}
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-500"
            >
              Save
            </button>
          </>
        )}
        <button
          disabled={!currentPipeline}
          onClick={handleRunClick}
          className={`rounded px-3 py-1 text-sm font-medium disabled:cursor-not-allowed ${
            running
              ? "bg-red-600 text-white hover:bg-red-500"
              : "bg-green-600 text-white hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          }`}
        >
          {running ? "Cancel" : "Run"}
        </button>
        <button
          onClick={() => togglePanel("settings")}
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="Settings"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        <button
          onClick={() => setAboutOpen(true)}
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="About AgentFlow"
        >
          <svg
            className="h-5 w-5"
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
        </button>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <InputPrompt
        open={inputPromptOpen}
        pipeline={currentPipeline}
        variables={currentPipeline?.variables || {}}
        onRun={doRun}
        onCancel={() => setInputPromptOpen(false)}
      />
      <GeneratePrompt
        open={generateOpen}
        onGenerated={async (pipeline) => {
          setGenerateOpen(false);
          if (currentProject) {
            try {
              await loadGeneratedPipeline(currentProject.path, pipeline);
            } catch (e) {
              logError(`Failed to load generated pipeline: ${e}`, "TopBar");
              addToast(`Failed to load generated pipeline: ${e}`);
            }
          }
        }}
        onCancel={() => setGenerateOpen(false)}
      />
      {savedPipeline && currentPipeline && (
        <DiffModal
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          saved={savedPipeline}
          current={currentPipeline}
        />
      )}
    </div>
  );
}
