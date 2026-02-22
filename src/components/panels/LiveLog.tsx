import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRunStore } from "../../stores/runStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { NodeStatus, NodeResult } from "../../types/run";
import { formatDuration } from "../../lib/format";
import VirtualLogPane from "./VirtualLogPane";

/** Hook that returns elapsed seconds since `startIso`, ticking every second while active. */
function useElapsed(startIso: string | null | undefined, active: boolean): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !startIso) {
      setElapsed(null);
      return;
    }
    const start = new Date(startIso).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso, active]);
  return elapsed;
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

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

/* ── Loop progress indicator ── */

function LoopProgress({ logs, totalCost, loopStartCost }: { logs: string[]; totalCost: number; loopStartCost: number }) {
  // Parse last iteration marker from logs (backward scan avoids array copy + reverse)
  let lastMarker: string | undefined;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].startsWith("--- Loop iteration ")) {
      lastMarker = logs[i];
      break;
    }
  }
  if (!lastMarker) return null;

  const match = lastMarker.match(/Loop iteration (\d+)\/(\d+)/);
  if (!match) return null;

  const current = parseInt(match[1]);
  const total = parseInt(match[2]);
  const loopCost = totalCost - loopStartCost;
  const costPerIter = current > 0 ? loopCost / current : 0;
  const estimatedTotal = costPerIter * total;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs border-b border-zinc-800/50 bg-pink-500/5">
      <span className="text-pink-400 font-medium">Iteration {current}/{total}</span>
      <span className="text-zinc-400">{formatCost(loopCost)} spent</span>
      {current > 1 && (
        <>
          <span className="text-zinc-500">~{formatCost(costPerIter)}/iter</span>
          <span className="text-amber-400">~{formatCost(estimatedTotal)} est. total</span>
        </>
      )}
      <div className="flex-1">
        <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-pink-500/60 transition-all duration-300"
            style={{ width: `${Math.min(100, (current / total) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Node row sub-component (allows hooks like useElapsed) ── */

interface NodeRowProps {
  nodeId: string;
  name: string;
  result: NodeResult | undefined;
  nodeLogs: string[];
  isActive: boolean;
  isHighlighted: boolean;
  isExpanded: boolean;
  onToggle: (nodeId: string) => void;
  activeLogRef: React.RefObject<HTMLPreElement | null>;
  loopStartCost: number | null;
  totalCost: number;
}

const NodeRow = memo(function NodeRow({ nodeId, name, result, nodeLogs, isActive, isHighlighted, isExpanded, onToggle, activeLogRef, loopStartCost, totalCost }: NodeRowProps) {
  const status: NodeStatus = result?.status ?? "Pending";
  const hasDetails = !!result || nodeLogs.length > 0;
  // A node is "running" based on its own status (covers parallel children too)
  const isRunning = status === "Running";

  // Live-ticking elapsed timer for any running node
  const elapsed = useElapsed(result?.started_at, isRunning);

  return (
    <div className="border-b border-zinc-800" data-node-id={nodeId}>
      {/* Node header - clickable to expand */}
      <div
        onClick={() => hasDetails && onToggle(nodeId)}
        className={`flex items-center gap-2 px-4 py-2 ${
          isHighlighted ? "bg-violet-500/15 ring-1 ring-inset ring-violet-500/30" : isActive ? "bg-zinc-800/50" : ""
        } ${hasDetails ? "cursor-pointer hover:bg-zinc-800/30" : ""}`}
      >
        {hasDetails && (
          <span className="text-[10px] text-zinc-600">
            {isExpanded ? "\u25BC" : "\u25B6"}
          </span>
        )}
        <span
          className={`text-sm ${statusColors[status]} ${
            status === "Running" ? "animate-pulse" : ""
          }`}
        >
          {statusIcons[status]}
        </span>
        <span className="text-xs font-medium text-zinc-300">
          {name}
        </span>
        {/* Completed duration */}
        {result?.started_at && result?.finished_at && (
          <span className="text-[10px] text-zinc-500">
            {formatDuration(result.started_at, result.finished_at)}
          </span>
        )}
        {/* Live elapsed timer while running */}
        {isRunning && elapsed != null && (
          <span className="text-[10px] tabular-nums text-blue-400/70">
            {formatElapsed(elapsed)}
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
        {nodeLogs.some((l) => l.includes("Using cached result")) && (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
            cached
          </span>
        )}
      </div>

      {/* Loop progress indicator */}
      {isRunning && loopStartCost != null && (
        <LoopProgress logs={nodeLogs} totalCost={totalCost} loopStartCost={loopStartCost} />
      )}

      {/* Expanded details */}
      {isExpanded && (
        <>
          {/* Structured output */}
          {result?.output && status !== "Running" && (
            <div className="bg-zinc-900/50 px-4 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-zinc-500">Output</div>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                {result.output}
              </pre>
            </div>
          )}

          {/* Log output */}
          <div className="bg-zinc-950 px-4 py-2">
            {nodeLogs.length > 0 && (
              <>
                <div className="mb-1 text-[10px] font-medium uppercase text-zinc-500">Logs</div>
                {nodeLogs.length > 500 ? (
                  <VirtualLogPane lines={nodeLogs} isRunning={isRunning} activeLogRef={activeLogRef} />
                ) : (
                  <pre
                    ref={isActive ? activeLogRef : undefined}
                    className={`${isRunning ? "max-h-96" : "max-h-60"} overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400`}
                  >
                    {nodeLogs.join("\n")}
                  </pre>
                )}
              </>
            )}

            {/* Loading indicator for running nodes */}
            {isRunning && (
              <div className="flex items-center gap-2 py-2">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" />
                </span>
                <span className="text-[11px] text-zinc-500">
                  {nodeLogs.length === 0
                    ? "Waiting for output..."
                    : "Processing..."}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}, (prev, next) =>
  prev.name === next.name &&
  prev.result === next.result &&
  prev.nodeLogs === next.nodeLogs &&
  prev.isActive === next.isActive &&
  prev.isHighlighted === next.isHighlighted &&
  prev.isExpanded === next.isExpanded &&
  prev.loopStartCost === next.loopStartCost &&
  prev.totalCost === next.totalCost
);

/* ── Main LiveLog component ── */

export default memo(function LiveLog() {
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
  const lastRunInputs = useRunStore((s) => s.lastRunInputs);
  const approvalResponse = useRunStore((s) => s.approvalResponse);
  const loopCostSnapshot = useRunStore((s) => s.loopCostSnapshot);
  const logEndRef = useRef<HTMLDivElement>(null);
  const activeLogRef = useRef<HTMLPreElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const expandedRunningRef = useRef<Set<string>>(new Set());
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-expand any node that transitions to Running (covers parallel children + sequential)
  useEffect(() => {
    if (!runState) return;
    const newRunning: string[] = [];
    for (const [nodeId, result] of Object.entries(runState.node_results)) {
      if (result.status === "Running" && !expandedRunningRef.current.has(nodeId)) {
        newRunning.push(nodeId);
      }
    }
    if (newRunning.length > 0) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        for (const id of newRunning) {
          next.add(id);
          expandedRunningRef.current.add(id);
        }
        return next;
      });
    }
  }, [runState]);

  const scrollToLatest = () => {
    // Find the last node that has results or logs, expand and highlight it
    const latestNodeId = [...nodeOrder].reverse().find(
      (id) => runState?.node_results[id] || (logs[id] && logs[id].length > 0),
    );
    if (latestNodeId) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        next.add(latestNodeId);
        return next;
      });
      // Highlight with auto-clear after 2s
      setHighlightedNodeId(latestNodeId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedNodeId(null);
        highlightTimerRef.current = null;
      }, 2000);
      // Scroll to the node after React re-renders with expanded content
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current?.querySelector(`[data-node-id="${latestNodeId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          logEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
    } else {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Build node order from pipeline nodes, then append any sub-pipeline child node IDs
  // NOTE: This must be above the early return so hooks are called in consistent order.
  const { nodeOrder, nodeNames } = useMemo(() => {
    if (!runState) return { nodeOrder: [], nodeNames: {} };
    const pipelineNodeIds = new Set(currentPipeline?.nodes.map((n) => n.id) ?? []);
    const names: Record<string, string> = {};
    currentPipeline?.nodes.forEach((n) => {
      names[n.id] = n.name;
    });

    // Include sub-pipeline child nodes that aren't in the parent pipeline
    const extraNodeIds: string[] = [];
    for (const nodeId of Object.keys(runState.node_results)) {
      if (!pipelineNodeIds.has(nodeId)) {
        extraNodeIds.push(nodeId);
      }
    }
    // Also include nodes with logs but no result yet
    for (const nodeId of Object.keys(logs)) {
      if (!pipelineNodeIds.has(nodeId) && !extraNodeIds.includes(nodeId)) {
        extraNodeIds.push(nodeId);
      }
    }

    const order = [...(currentPipeline?.nodes.map((n) => n.id) ?? []), ...extraNodeIds];
    return { nodeOrder: order, nodeNames: names };
  }, [currentPipeline, runState, logs]);

  const handleExport = async () => {
    if (!runState) return;
    const { generateRunReport } = await import("../../lib/exportReport");
    const report = generateRunReport(runState, logs, currentPipeline);
    await navigator.clipboard.writeText(report);
  };

  // Hide run output when viewing a different pipeline than the one that ran
  const runBelongsToPipeline =
    runState != null &&
    currentPipeline != null &&
    runState.pipeline_name === currentPipeline.name;

  if (!runState || !runBelongsToPipeline) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        No active run. Click Run to start a pipeline.
      </div>
    );
  }

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
                      : runState.status === "budget_exceeded"
                        ? "text-amber-400"
                        : "text-zinc-400"
              }`}
            >
              {runState.status === "budget_exceeded" ? "BUDGET EXCEEDED" : runState.status.toUpperCase()}
            </span>
            <span className="text-xs text-zinc-600">
              {runState.pipeline_name}
            </span>
            {runState.total_cost_usd > 0 && (
              <span className="text-xs text-violet-400">
                {formatCost(runState.total_cost_usd)}
                {currentPipeline?.max_cost_usd != null && (
                  <span className="text-zinc-500"> / ${currentPipeline.max_cost_usd.toFixed(2)} budget</span>
                )}
              </span>
            )}
            {runState.total_cost_usd === 0 && currentPipeline?.max_cost_usd != null && (
              <span className="text-xs text-zinc-500">
                Budget: ${currentPipeline.max_cost_usd.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!running && runState.status !== "running" && (
              <button
                onClick={handleExport}
                className="rounded bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                title="Copy run report to clipboard"
              >
                Export
              </button>
            )}
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
      <div className="relative flex-1">
        <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto">
          {nodeOrder.map((nodeId) => (
            <NodeRow
              key={nodeId}
              nodeId={nodeId}
              name={nodeNames[nodeId] || nodeId}
              result={runState.node_results[nodeId]}
              nodeLogs={logs[nodeId] || []}
              isActive={runState.current_node === nodeId}
              isHighlighted={highlightedNodeId === nodeId}
              isExpanded={expandedNodes.has(nodeId)}
              onToggle={toggleExpanded}
              activeLogRef={activeLogRef}
              loopStartCost={loopCostSnapshot[nodeId] ?? null}
              totalCost={runState.total_cost_usd}
            />
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Floating scroll-to-latest button */}
        <button
          onClick={scrollToLatest}
          className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-zinc-700/80 px-3 py-1.5 text-xs font-medium text-zinc-300 shadow-lg hover:bg-zinc-600"
        >
          <span className="text-[10px]">{"\u25BC"}</span>
          Latest
        </button>
      </div>
    </div>
  );
});
