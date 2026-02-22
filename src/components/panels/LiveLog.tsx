import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRunStore } from "../../stores/runStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { NodeStatus, NodeResult } from "../../types/run";
import { formatDuration } from "../../lib/format";

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

/* ── Node row sub-component (allows hooks like useElapsed) ── */

const MAX_VISIBLE_LOGS = 200;

interface NodeRowProps {
  nodeId: string;
  name: string;
  result: NodeResult | undefined;
  nodeLogs: string[];
  isActive: boolean;
  isExpanded: boolean;
  onToggle: (nodeId: string) => void;
  activeLogRef: React.RefObject<HTMLPreElement | null>;
}

const NodeRow = memo(function NodeRow({ nodeId, name, result, nodeLogs, isActive, isExpanded, onToggle, activeLogRef }: NodeRowProps) {
  const status: NodeStatus = result?.status ?? "Pending";
  const hasDetails = !!result || nodeLogs.length > 0;
  // A node is "running" based on its own status (covers parallel children too)
  const isRunning = status === "Running";

  // Live-ticking elapsed timer for any running node
  const elapsed = useElapsed(result?.started_at, isRunning);

  return (
    <div className="border-b border-zinc-800">
      {/* Node header - clickable to expand */}
      <div
        onClick={() => hasDetails && onToggle(nodeId)}
        className={`flex items-center gap-2 px-4 py-2 ${
          isActive ? "bg-zinc-800/50" : ""
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
                {nodeLogs.length > MAX_VISIBLE_LOGS && (
                  <div className="mb-1 text-[10px] text-zinc-600">
                    ... {nodeLogs.length - MAX_VISIBLE_LOGS} earlier lines hidden
                  </div>
                )}
                <pre
                  ref={isActive ? activeLogRef : undefined}
                  className={`${isRunning ? "max-h-96" : "max-h-60"} overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400`}
                >
                  {nodeLogs.length > MAX_VISIBLE_LOGS
                    ? nodeLogs.slice(-MAX_VISIBLE_LOGS).join("\n")
                    : nodeLogs.join("\n")}
                </pre>
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
  prev.isExpanded === next.isExpanded
);

/* ── Main LiveLog component ── */

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
  const lastRunInputs = useRunStore((s) => s.lastRunInputs);
  const approvalResponse = useRunStore((s) => s.approvalResponse);
  const logEndRef = useRef<HTMLDivElement>(null);
  const activeLogRef = useRef<HTMLPreElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const expandedRunningRef = useRef<Set<string>>(new Set());
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  // Guard to suppress scroll-handler feedback during programmatic scrolls
  const programmaticScrollRef = useRef(false);

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

  // Track whether user has scrolled away from the bottom of the outer container.
  // Ignores scroll events caused by programmatic scrollIntoView calls.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (programmaticScrollRef.current) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setUserScrolledAway(!atBottom);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll only when user hasn't manually scrolled away
  useEffect(() => {
    if (!userScrolledAway && logEndRef.current) {
      programmaticScrollRef.current = true;
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
      // Clear guard after the smooth scroll animation completes
      setTimeout(() => { programmaticScrollRef.current = false; }, 400);
    }
  }, [logs, userScrolledAway]);

  // Auto-scroll the active node's inner log pane (only when user isn't scrolled away)
  useEffect(() => {
    if (!userScrolledAway && activeLogRef.current) {
      activeLogRef.current.scrollTo({
        top: activeLogRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [logs, runState?.current_node, userScrolledAway]);

  const scrollToLatest = () => {
    programmaticScrollRef.current = true;
    setUserScrolledAway(false);
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 400);
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

  const handleExport = async () => {
    if (!runState) return;
    const { generateRunReport } = await import("../../lib/exportReport");
    const report = generateRunReport(runState, logs, currentPipeline);
    await navigator.clipboard.writeText(report);
  };

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
              isExpanded={expandedNodes.has(nodeId)}
              onToggle={toggleExpanded}
              activeLogRef={activeLogRef}
            />
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Floating scroll-to-latest button */}
        {userScrolledAway && running && (
          <button
            onClick={scrollToLatest}
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-opacity hover:bg-blue-500"
          >
            <span className="text-[10px]">{"\u25BC"}</span>
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
