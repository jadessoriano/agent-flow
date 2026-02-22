import { useState, useMemo, memo } from "react";
import { useRunStore } from "../../stores/runStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { RunRow } from "../../types/run";
import { formatDuration } from "../../lib/format";
import { addToast } from "../../lib/errorReporter";

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

type StatusFilter = "all" | "success" | "failed" | "cancelled";
type DateFilter = "all" | "today" | "week" | "month";

export default memo(function RunHistory() {
  const runHistory = useRunStore((s) => s.runHistory);
  const persistedHistory = useRunStore((s) => s.persistedHistory);
  const running = useRunStore((s) => s.running);
  const resumeRun = useRunStore((s) => s.resumeRun);
  const lastRunInputs = useRunStore((s) => s.lastRunInputs);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const settings = useSettingsStore((s) => s.settings);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pipelineFilter, setPipelineFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  // Merge in-memory and persisted history, deduplicate by run_id
  const allRuns = useMemo(() => {
    const seen = new Set<string>();
    const runs: Array<{ type: "memory"; data: (typeof runHistory)[0] } | { type: "persisted"; data: RunRow }> = [];

    for (const run of runHistory) {
      if (!seen.has(run.run_id)) {
        seen.add(run.run_id);
        runs.push({ type: "memory", data: run });
      }
    }
    for (const run of persistedHistory) {
      if (!seen.has(run.id)) {
        seen.add(run.id);
        runs.push({ type: "persisted", data: run });
      }
    }
    return runs;
  }, [runHistory, persistedHistory]);

  // Apply filters — precompute date thresholds once instead of per-row
  const filteredRuns = useMemo(() => {
    const nowMs = Date.now();
    const todayStr = dateFilter === "today" ? new Date(nowMs).toDateString() : "";
    const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const monthAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;
    const lowerFilter = pipelineFilter.toLowerCase();

    return allRuns.filter((entry) => {
      const status = entry.data.status;
      const pName = entry.data.pipeline_name;
      const startedAt = entry.type === "persisted" ? entry.data.started_at : null;

      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (lowerFilter && !pName.toLowerCase().includes(lowerFilter)) return false;
      if (dateFilter !== "all" && startedAt) {
        const dMs = new Date(startedAt).getTime();
        if (dateFilter === "today") {
          if (new Date(dMs).toDateString() !== todayStr) return false;
        } else if (dateFilter === "week") {
          if (dMs < weekAgoMs) return false;
        } else if (dateFilter === "month") {
          if (dMs < monthAgoMs) return false;
        }
      }
      return true;
    });
  }, [allRuns, statusFilter, pipelineFilter, dateFilter]);

  const parseInputs = (triggerInput: string | null): Record<string, string> => {
    if (!triggerInput) return {};
    try {
      return JSON.parse(triggerInput);
    } catch {
      return {};
    }
  };

  const handleResume = async (runId: string, triggerInput?: string | null) => {
    if (!currentPipeline || !currentProject) return;
    const cliPath = settings?.claude_cli_path || "claude";
    // Use persisted trigger_input if available, fall back to last in-memory inputs
    const inputs = triggerInput ? parseInputs(triggerInput) : lastRunInputs;
    try {
      await resumeRun(runId, currentPipeline, inputs, cliPath, currentProject.path);
    } catch (e) {
      console.error("Resume failed:", e);
    }
  };

  const handleExportRun = async (runId: string) => {
    try {
      const { getRunDetails } = await import("../../lib/tauri");
      const [run, steps] = await getRunDetails(runId);
      const { generateRunReport } = await import("../../lib/exportReport");
      // Build a minimal RunState from persisted data
      const nodeResults: Record<string, { status: string; exit_code?: number | null; output: string; started_at?: string | null; finished_at?: string | null; attempt: number; cost_usd?: number | null }> = {};
      for (const step of steps) {
        nodeResults[step.node_id] = {
          status: step.status,
          exit_code: step.exit_code,
          output: "",
          started_at: step.started_at,
          finished_at: step.finished_at,
          attempt: step.attempt,
          cost_usd: step.cost_usd,
        };
      }
      const report = generateRunReport(
        { run_id: run.id, pipeline_name: run.pipeline_name, status: run.status, node_results: nodeResults as never, current_node: null, total_cost_usd: 0 },
        {},
        null,
      );
      await navigator.clipboard.writeText(report);
      addToast("Run report copied to clipboard", "info");
    } catch {
      addToast("Failed to export run report", "warning");
    }
  };

  if (allRuns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        No run history yet. Run a pipeline to see results here.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="border-b border-zinc-800 px-4 py-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {(["all", "success", "failed", "cancelled"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                statusFilter === s
                  ? s === "success" ? "bg-green-500/20 text-green-400"
                    : s === "failed" ? "bg-red-500/20 text-red-400"
                    : s === "cancelled" ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-zinc-600/30 text-zinc-200"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={pipelineFilter}
            onChange={(e) => setPipelineFilter(e.target.value)}
            placeholder="Filter by pipeline..."
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      {filteredRuns.map((entry, i) => {
        if (entry.type === "memory") {
          const run = entry.data;
          const nodeCount = Object.keys(run.node_results).length;
          const succeeded = Object.values(run.node_results).filter(
            (r) => r.status === "Success",
          ).length;
          const failed = Object.values(run.node_results).filter(
            (r) => r.status === "Failed",
          ).length;
          const totalCost = run.total_cost_usd;

          return (
            <div
              key={`${run.run_id}-${i}`}
              className="border-b border-zinc-800 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  {run.pipeline_name}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium ${
                      run.status === "success"
                        ? "text-green-400"
                        : run.status === "failed"
                          ? "text-red-400"
                          : run.status === "cancelled"
                            ? "text-yellow-400"
                            : "text-zinc-400"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500">
                <span>{run.run_id}</span>
                <span>
                  {succeeded}/{nodeCount} passed
                </span>
                {failed > 0 && (
                  <span className="text-red-400">{failed} failed</span>
                )}
                {totalCost > 0 && (
                  <span className="text-violet-400">
                    {formatCost(totalCost)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                {run.status === "failed" && !running && (
                  <button
                    onClick={() => handleResume(run.run_id)}
                    className="rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-600/30"
                  >
                    Resume from failure
                  </button>
                )}
              </div>
            </div>
          );
        } else {
          const run = entry.data;
          return (
            <div
              key={`${run.id}-${i}`}
              className="border-b border-zinc-800 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  {run.pipeline_name}
                </span>
                <div className="flex items-center gap-2">
                  {run.resumed_from && (
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-400">
                      resumed
                    </span>
                  )}
                  <span
                    className={`text-xs font-medium ${
                      run.status === "success"
                        ? "text-green-400"
                        : run.status === "failed"
                          ? "text-red-400"
                          : run.status === "cancelled"
                            ? "text-yellow-400"
                            : "text-zinc-400"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500">
                <span>{formatTime(run.started_at)}</span>
                {run.finished_at && (
                  <span className="text-zinc-400">
                    {formatDuration(run.started_at, run.finished_at)}
                  </span>
                )}
                <span>{run.id}</span>
              </div>
              <div className="mt-2 flex gap-2">
                {run.status === "failed" && !running && (
                  <button
                    onClick={() => handleResume(run.id, run.trigger_input)}
                    className="rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-600/30"
                  >
                    Resume from failure
                  </button>
                )}
                <button
                  onClick={() => handleExportRun(run.id)}
                  className="rounded bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                >
                  Export
                </button>
              </div>
            </div>
          );
        }
      })}
      </div>
    </div>
  );
});
