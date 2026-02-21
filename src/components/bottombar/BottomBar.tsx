import { useUIStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useRunStore } from "../../stores/runStore";
import { useErrorLogStore } from "../../stores/errorLogStore";

function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export default function BottomBar() {
  const togglePanel = useUIStore((s) => s.togglePanel);
  const panelView = useUIStore((s) => s.panelView);
  const panelOpen = useUIStore((s) => s.panelOpen);
  const agents = useAgentStore((s) => s.agents);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const dirty = usePipelineStore((s) => s.dirty);
  const running = useRunStore((s) => s.running);
  const runHistory = useRunStore((s) => s.runHistory);
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const unreadErrors = useErrorLogStore((s) => s.unreadCount);

  return (
    <div className="flex h-8 items-center justify-between border-t border-zinc-700/70 bg-zinc-900 px-4">
      {/* Left: Panel toggles */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => togglePanel("library")}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
            panelOpen && panelView === "library"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
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
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
            />
          </svg>
          Agents
          {agents.length > 0 && (
            <span className="text-zinc-500">{agents.length}</span>
          )}
        </button>

        <button
          onClick={() => togglePanel("liveLog")}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
            panelOpen && panelView === "liveLog"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          <svg
            className={`h-3.5 w-3.5 ${running ? "text-green-400 animate-pulse" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
            />
          </svg>
          {running ? "Running" : "Output"}
        </button>

        <button
          onClick={() => togglePanel("runHistory")}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
            panelOpen && panelView === "runHistory"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
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
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          History
          {runHistory.length > 0 && (
            <span className="text-zinc-500">{runHistory.length}</span>
          )}
        </button>

        <button
          onClick={() => togglePanel("costDashboard")}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
            panelOpen && panelView === "costDashboard"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
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
              d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Usage
        </button>

        <button
          onClick={() => togglePanel("pipelineSettings")}
          disabled={!currentPipeline}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:text-zinc-700 ${
            panelOpen && panelView === "pipelineSettings"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
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
              d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
            />
          </svg>
          Variables
        </button>

        <button
          onClick={() => togglePanel("errorLog")}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${
            panelOpen && panelView === "errorLog"
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
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
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          Errors
          {unreadErrors > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
              {unreadErrors}
            </span>
          )}
        </button>
      </div>

      {/* Center: Pipeline info */}
      {currentPipeline && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>{currentPipeline.nodes.length} nodes</span>
          <span className="text-zinc-600">|</span>
          <span>{currentPipeline.edges.length} edges</span>
          {dirty && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-amber-400">unsaved</span>
            </>
          )}
        </div>
      )}

      {/* Right: Zoom indicator */}
      <div className="text-xs text-zinc-500">{formatZoom(zoomLevel)}</div>
    </div>
  );
}
