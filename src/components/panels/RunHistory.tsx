import { useRunStore } from "../../stores/runStore";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import type { RunRow } from "../../types/run";
import { formatDuration } from "../../lib/format";

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

export default function RunHistory() {
  const runHistory = useRunStore((s) => s.runHistory);
  const persistedHistory = useRunStore((s) => s.persistedHistory);
  const running = useRunStore((s) => s.running);
  const resumeRun = useRunStore((s) => s.resumeRun);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const settings = useSettingsStore((s) => s.settings);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Merge in-memory and persisted history, deduplicate by run_id
  const seen = new Set<string>();
  const allRuns: Array<{ type: "memory"; data: (typeof runHistory)[0] } | { type: "persisted"; data: RunRow }> = [];

  for (const run of runHistory) {
    if (!seen.has(run.run_id)) {
      seen.add(run.run_id);
      allRuns.push({ type: "memory", data: run });
    }
  }
  for (const run of persistedHistory) {
    if (!seen.has(run.id)) {
      seen.add(run.id);
      allRuns.push({ type: "persisted", data: run });
    }
  }

  if (allRuns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        No run history yet. Run a pipeline to see results here.
      </div>
    );
  }

  const lastRunInputs = useRunStore((s) => s.lastRunInputs);

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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {allRuns.map((entry, i) => {
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
              {run.status === "failed" && !running && (
                <button
                  onClick={() => handleResume(run.run_id)}
                  className="mt-2 rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-600/30"
                >
                  Resume from failure
                </button>
              )}
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
              {run.status === "failed" && !running && (
                <button
                  onClick={() => handleResume(run.id, run.trigger_input)}
                  className="mt-2 rounded bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-600/30"
                >
                  Resume from failure
                </button>
              )}
            </div>
          );
        }
      })}
    </div>
  );
}
