import { useState, useRef, useEffect } from "react";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useProjectStore } from "../../stores/projectStore";
import { logError, addToast } from "../../lib/errorReporter";
import GeneratePrompt from "../modals/GeneratePrompt";

export default function PipelineSelector() {
  const pipelines = usePipelineStore((s) => s.pipelines);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const currentPipelinePath = usePipelineStore((s) => s.currentPipelinePath);
  const dirty = usePipelineStore((s) => s.dirty);
  const loadPipelines = usePipelineStore((s) => s.loadPipelines);
  const openPipeline = usePipelineStore((s) => s.openPipeline);
  const createPipeline = usePipelineStore((s) => s.createPipeline);
  const deletePipeline = usePipelineStore((s) => s.deletePipeline);
  const closePipeline = usePipelineStore((s) => s.closePipeline);
  const currentProject = useProjectStore((s) => s.currentProject);

  const confirmUnsaved = (): boolean => {
    if (!dirty) return true;
    return confirm("You have unsaved changes. Discard them?");
  };
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const loadGeneratedPipeline = usePipelineStore((s) => s.loadGeneratedPipeline);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentProject) {
      loadPipelines(currentProject.path);
    }
  }, [currentProject, loadPipelines]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleCreate = () => {
    if (!currentProject || !newName.trim()) return;
    if (!confirmUnsaved()) return;
    createPipeline(currentProject.path, newName.trim());
    setNewName("");
    setShowCreate(false);
    setOpen(false);
  };

  const handleDelete = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentProject) return;
    if (confirm("Delete this pipeline?")) {
      await deletePipeline(currentProject.path, path);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        <svg
          className="h-4 w-4 text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z"
          />
        </svg>
        <span className="max-w-[200px] truncate">
          {currentPipeline?.name ?? "No pipeline"}
        </span>
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

      {open && (
        <div className="absolute top-full left-1/2 z-50 mt-1 w-72 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-850 shadow-xl">
          {/* Pipeline list */}
          {pipelines.length > 0 && (
            <div className="p-2">
              {pipelines.map((p) => (
                <div
                  key={p.path}
                  className={`group flex items-center justify-between rounded px-3 py-1.5 text-sm hover:bg-zinc-700 ${
                    currentPipelinePath === p.path
                      ? "bg-zinc-700/50 text-zinc-100"
                      : "text-zinc-300"
                  }`}
                >
                  <button
                    onClick={() => {
                      if (!confirmUnsaved()) return;
                      openPipeline(p.path);
                      setOpen(false);
                    }}
                    className="flex-1 text-left"
                  >
                    <div className="truncate">{p.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {p.node_count} nodes
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleDelete(p.path, e)}
                    className="ml-2 rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-600 hover:text-zinc-300 group-hover:opacity-100"
                  >
                    <svg
                      className="h-3 w-3"
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
          )}

          <div className="border-t border-zinc-700 p-2">
            {showCreate ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Pipeline name..."
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-500"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
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
                New Pipeline
              </button>
            )}
          </div>

          {/* Generate with AI */}
          <div className="border-t border-zinc-700 p-2">
            <button
              onClick={() => {
                setOpen(false);
                setGenerateOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              <svg
                className="h-4 w-4 text-violet-400"
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
              Generate with AI
            </button>
          </div>

          {/* Import / Export */}
          <div className="border-t border-zinc-700 p-2">
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file || !currentProject) return;
                  try {
                    const text = await file.text();
                    const pipeline = JSON.parse(text);
                    if (pipeline.name && pipeline.nodes) {
                      const { writePipeline } = await import("../../lib/tauri");
                      await writePipeline(currentProject.path, pipeline);
                      loadPipelines(currentProject.path);
                      openPipeline(
                        `${currentProject.path}/.claude/pipelines/${pipeline.name}.pipeline.json`,
                      );
                      setOpen(false);
                    }
                  } catch (err) {
                    logError(`Import failed: ${err}`, "PipelineSelector");
                    addToast(`Import failed: ${err}`);
                  }
                };
                input.click();
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
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
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              Import Pipeline
            </button>
            {currentPipeline && (
              <button
                onClick={() => {
                  const json = JSON.stringify(currentPipeline, null, 2);
                  const blob = new Blob([json], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${currentPipeline.name}.pipeline.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
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
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                Export Pipeline
              </button>
            )}
          </div>

          {currentPipeline && (
            <>
              <div className="border-t border-zinc-700 p-2">
                <button
                  onClick={() => {
                    if (!confirmUnsaved()) return;
                    closePipeline();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                >
                  Close Pipeline
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <GeneratePrompt
        open={generateOpen}
        onGenerated={async (pipeline) => {
          setGenerateOpen(false);
          if (currentProject) {
            try {
              await loadGeneratedPipeline(currentProject.path, pipeline);
            } catch (e) {
              logError(`Failed to load generated pipeline: ${e}`, "PipelineSelector");
              addToast(`Failed to load generated pipeline: ${e}`);
            }
          }
        }}
        onCancel={() => setGenerateOpen(false)}
      />
    </div>
  );
}
