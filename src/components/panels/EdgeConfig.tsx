import { useState, useEffect } from "react";
import { usePipelineStore } from "../../stores/pipelineStore";

export default function EdgeConfig() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const selectedEdgeId = usePipelineStore((s) => s.selectedEdgeId);
  const updateEdge = usePipelineStore((s) => s.updateEdge);
  const removeEdge = usePipelineStore((s) => s.removeEdge);

  const edge = currentPipeline?.edges.find((e) => e.id === selectedEdgeId);

  const [condition, setCondition] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (edge) {
      setCondition(edge.condition || "");
      setConfirmDelete(false);
    }
  }, [edge]);

  if (!edge) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Select an edge on the canvas to configure it
      </div>
    );
  }

  const sourceNode = currentPipeline?.nodes.find((n) => n.id === edge.from);
  const targetNode = currentPipeline?.nodes.find((n) => n.id === edge.to);

  const handleSave = () => {
    updateEdge(edge.id, {
      condition: condition || undefined,
    });
  };

  const handleDelete = () => {
    removeEdge(edge.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Edge info */}
        <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">
              {sourceNode?.name || edge.from}
            </span>
            <svg
              className="h-3 w-3 text-zinc-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
            <span className="font-medium text-zinc-300">
              {targetNode?.name || edge.to}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-600">{edge.id}</div>
        </div>

        {/* Condition */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Condition
          </label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
          >
            <option value="" className="bg-zinc-800 text-zinc-200">Always (default)</option>
            <option value="success" className="bg-zinc-800 text-zinc-200">On Success</option>
            <option value="failure" className="bg-zinc-800 text-zinc-200">On Failure</option>
          </select>
          <p className="mt-1 text-[10px] text-zinc-600">
            {condition === "success"
              ? "This edge only triggers when the source node succeeds."
              : condition === "failure"
                ? "This edge only triggers when the source node fails."
                : "This edge always triggers when the source node completes."}
          </p>
        </div>

        {/* Apply */}
        <button
          onClick={handleSave}
          className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          Apply Changes
        </button>
      </div>

      {/* Delete */}
      <div className="border-t border-zinc-700 px-4 py-3">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">Delete this edge?</span>
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
            Delete edge
          </button>
        )}
      </div>
    </div>
  );
}
