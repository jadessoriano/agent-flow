import { useState, useEffect } from "react";
import { marked } from "marked";
import { useAgentStore } from "../../stores/agentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useUIStore } from "../../stores/uiStore";

export default function AgentEditor() {
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const saving = useAgentStore((s) => s.saving);
  const saveAgent = useAgentStore((s) => s.saveAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const currentProject = useProjectStore((s) => s.currentProject);
  const openPanel = useUIStore((s) => s.openPanel);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (selectedAgent) {
      setContent(selectedAgent.content);
      setDirty(false);
      setConfirmDelete(false);
    }
  }, [selectedAgent]);

  if (!selectedAgent) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Select an agent from the library to edit
      </div>
    );
  }

  const handleSave = async () => {
    await saveAgent(selectedAgent.path, content);
    setDirty(false);
    // Refresh agent list
    if (currentProject) {
      useAgentStore.getState().loadAgents(currentProject.path);
    }
  };

  const handleDelete = async () => {
    if (!currentProject) return;
    await deleteAgent(selectedAgent.path, currentProject.path);
    openPanel("library");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => openPanel("library")}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Back to library"
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
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </button>
          <span className="text-sm font-medium text-zinc-200">
            {selectedAgent.name}
          </span>
          {dirty && (
            <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
              unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`rounded px-2 py-1 text-xs ${
              showPreview
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex-1 ${showPreview ? "w-1/2" : "w-full"}`}>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                if (dirty) handleSave();
              }
            }}
            className="h-full w-full resize-none bg-zinc-950 p-4 font-mono text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none"
            placeholder="Write your agent instructions in Markdown..."
            spellCheck={false}
          />
        </div>

        {showPreview && (
          <div className="w-1/2 overflow-y-auto border-l border-zinc-700 p-4">
            <div
              className="prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
            />
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="border-t border-zinc-700 px-4 py-3">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">
              Delete {selectedAgent.name}?
            </span>
            <button
              onClick={handleDelete}
              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-zinc-500 hover:text-red-400"
          >
            Delete agent
          </button>
        )}
      </div>
    </div>
  );
}
