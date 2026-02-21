import { useEffect, useRef } from "react";
import { useRunStore } from "../../stores/runStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { NodeStatus } from "../../types/run";
import { formatDuration } from "../../lib/format";

const statusColors: Record<NodeStatus, string> = {
  Pending: "text-zinc-500",
  Running: "text-blue-400",
  Success: "text-green-400",
  Failed: "text-red-400",
  Skipped: "text-zinc-600",
  Cancelled: "text-yellow-400",
};

const statusIcons: Record<NodeStatus, string> = {
  Pending: "\u25CB",
  Running: "\u25CF",
  Success: "\u2713",
  Failed: "\u2717",
  Skipped: "\u2014",
  Cancelled: "\u25A0",
};

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export default function LiveLog() {
  const runState = useRunStore((s) => s.runState);
  const running = useRunStore((s) => s.running);
  const logs = useRunStore((s) => s.logs);
  const approvalRequest = useRunStore((s) => s.approvalRequest);
  const respondToApproval = useRunStore((s) => s.respondToApproval);
  const cancelRun = useRunStore((s) => s.cancelRun);
  const resumeRun = useRunStore((s) => s.resumeRun);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const settings = useSettingsStore((s) => s.settings);
  const currentProject = useProjectStore((s) => s.currentProject);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, runState]);

  if (!runState) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        No active run. Click Run to start a pipeline.
      </div>
    );
  }

  // Build node order from pipeline nodes, then append any sub-pipeline child node IDs
  const pipelineNodeIds = new Set(currentPipeline?.nodes.map((n) => n.id) ?? []);
  const nodeNames: Record<string, string> = {};
  currentPipeline?.nodes.forEach((n) => {
    nodeNames[n.id] = n.name;
  });

  // Include sub-pipeline child nodes that aren't in the parent pipeline
  const extraNodeIds: string[] = [];
  if (runState) {
    for (const nodeId of Object.keys(runState.node_results)) {
      if (!pipelineNodeIds.has(nodeId)) {
        extraNodeIds.push(nodeId);
      }
    }
  }
  // Also include nodes with logs but no result yet
  for (const nodeId of Object.keys(logs)) {
    if (!pipelineNodeIds.has(nodeId) && !extraNodeIds.includes(nodeId)) {
      extraNodeIds.push(nodeId);
    }
  }

  const nodeOrder = [...(currentPipeline?.nodes.map((n) => n.id) ?? []), ...extraNodeIds];

  const lastRunInputs = useRunStore((s) => s.lastRunInputs);
  const approvalResponse = useRunStore((s) => s.approvalResponse);

  const handleResume = async () => {
    if (!currentPipeline || !currentProject || !runState) return;
    const cliPath = settings?.claude_cli_path || "claude";
    try {
      await resumeRun(
        runState.run_id,
        currentPipeline,
        lastRunInputs,
        cliPath,
        currentProject.path,
      );
    } catch (e) {
      console.error("Resume failed:", e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Run status header */}
      <div className="border-b border-zinc-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium ${
                runState.status === "running"
                  ? "text-blue-400"
                  : runState.status === "success"
                    ? "text-green-400"
                    : runState.status === "failed"
                      ? "text-red-400"
                      : "text-zinc-400"
              }`}
            >
              {runState.status.toUpperCase()}
            </span>
            <span className="text-xs text-zinc-600">
              {runState.pipeline_name}
            </span>
            {runState.total_cost_usd > 0 && (
              <span className="text-xs text-violet-400">
                {formatCost(runState.total_cost_usd)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {runState.status === "failed" && !running && (
              <button
                onClick={handleResume}
                className="rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-600/30"
              >
                Resume
              </button>
            )}
            {running && (
              <button
                onClick={() => cancelRun()}
                className="rounded bg-red-600/20 px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/30"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Approval request banner */}
      {approvalRequest && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <div className="mb-2 text-sm text-yellow-300">
            Approval required for: <strong>{approvalRequest.name}</strong>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => respondToApproval(true)}
              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500"
            >
              Approve
            </button>
            <button
              onClick={() => respondToApproval(false)}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Approval response confirmation */}
      {approvalResponse && !approvalRequest && (
        <div className={`border-b px-4 py-2 text-xs font-medium ${
          approvalResponse === "approved"
            ? "border-green-500/30 bg-green-500/10 text-green-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        }`}>
          Gate {approvalResponse === "approved" ? "approved" : "rejected"}
        </div>
      )}

      {/* Node results list */}
      <div className="flex-1 overflow-y-auto">
        {nodeOrder.map((nodeId) => {
          const result = runState.node_results[nodeId];
          const nodeLogs = logs[nodeId] || [];
          const status: NodeStatus = result?.status ?? "Pending";
          const isActive = runState.current_node === nodeId;

          return (
            <div key={nodeId} className="border-b border-zinc-800">
              {/* Node header */}
              <div
                className={`flex items-center gap-2 px-4 py-2 ${
                  isActive ? "bg-zinc-800/50" : ""
                }`}
              >
                <span
                  className={`text-sm ${statusColors[status]} ${
                    status === "Running" ? "animate-pulse" : ""
                  }`}
                >
                  {statusIcons[status]}
                </span>
                <span className="text-xs font-medium text-zinc-300">
                  {nodeNames[nodeId] || nodeId}
                </span>
                {result?.started_at && result?.finished_at && (
                  <span className="text-[10px] text-zinc-500">
                    {formatDuration(result.started_at, result.finished_at)}
                  </span>
                )}
                {result?.exit_code !== null &&
                  result?.exit_code !== undefined && (
                    <span className="text-[10px] text-zinc-600">
                      exit: {result.exit_code}
                    </span>
                  )}
                {result?.attempt && result.attempt > 1 && (
                  <span className="text-[10px] text-zinc-600">
                    attempt {result.attempt}
                  </span>
                )}
                {result?.cost_usd != null && result.cost_usd > 0 && (
                  <span className="text-[10px] text-violet-400">
                    {formatCost(result.cost_usd)}
                  </span>
                )}
              </div>

              {/* Log output */}
              {nodeLogs.length > 0 && (
                <div className="bg-zinc-950 px-4 py-2">
                  <pre className="max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-400">
                    {nodeLogs.join("\n")}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
