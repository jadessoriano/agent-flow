import { useUIStore } from "../../stores/uiStore";
import ErrorBoundary from "../ErrorBoundary";
import AgentLibrary from "./AgentLibrary";
import AgentEditor from "./AgentEditor";
import Settings from "./Settings";
import NodeConfig from "./NodeConfig";
import EdgeConfig from "./EdgeConfig";
import PipelineSettings from "./PipelineSettings";
import LiveLog from "./LiveLog";
import RunHistory from "./RunHistory";
import CostDashboard from "./CostDashboard";
import ErrorLog from "./ErrorLog";

export default function SidePanel() {
  const panelView = useUIStore((s) => s.panelView);
  const panelOpen = useUIStore((s) => s.panelOpen);
  const closePanel = useUIStore((s) => s.closePanel);

  const title = {
    library: "Agent Library",
    editor: "Agent Editor",
    settings: "Settings",
    nodeConfig: "Node Config",
    edgeConfig: "Edge Config",
    pipelineSettings: "Pipeline Settings",
    liveLog: "Run Output",
    runHistory: "Run History",
    costDashboard: "Usage Stats",
    errorLog: "Error Log",
  }[panelView ?? "library"];

  return (
    <div
      className={`absolute top-0 right-0 h-full border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl transition-[width] duration-200 ${
        panelOpen ? "w-96" : "w-0 overflow-hidden border-l-0"
      }`}
    >
      {panelOpen && (
        <div className="flex h-full flex-col">
          {/* Panel header */}
          <div className="flex h-10 items-center justify-between border-b border-[var(--border)] px-4">
            <span className="text-sm font-medium text-zinc-200">{title}</span>
            <button
              onClick={closePanel}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <ErrorBoundary>
              {panelView === "library" && <AgentLibrary />}
              {panelView === "editor" && <AgentEditor />}
              {panelView === "settings" && <Settings />}
              {panelView === "nodeConfig" && <NodeConfig />}
              {panelView === "edgeConfig" && <EdgeConfig />}
              {panelView === "pipelineSettings" && <PipelineSettings />}
              {panelView === "liveLog" && <LiveLog />}
              {panelView === "runHistory" && <RunHistory />}
              {panelView === "costDashboard" && <CostDashboard />}
              {panelView === "errorLog" && <ErrorLog />}
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
}
