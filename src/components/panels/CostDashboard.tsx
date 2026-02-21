import { useEffect, useState } from "react";
import { getUsageStats } from "../../lib/tauri";
import type { UsageStats } from "../../types/run";
import { formatMs } from "../../lib/format";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function CostDashboard() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getUsageStats()
      .then((s) => {
        if (mounted) setStats(s);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Loading usage data...
      </div>
    );
  }

  if (!stats || (stats.total_runs === 0 && stats.runs.length === 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <svg
          className="mb-3 h-10 w-10 text-zinc-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
        <div className="text-sm text-zinc-400">No usage data yet</div>
        <div className="mt-1 text-xs text-zinc-600">
          Run a pipeline with AI tasks to see stats here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Overview Stats */}
      <div className="border-b border-zinc-700 px-4 py-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Total Usage
        </div>
        <div className="mt-2 flex items-baseline gap-4">
          <div className="text-2xl font-semibold text-violet-400">
            {formatCost(stats.total_cost_usd)}
          </div>
          <div className="text-sm text-zinc-400">
            {stats.total_runs} run{stats.total_runs !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span>
            Avg {formatCost(stats.avg_cost_per_run)}/run
          </span>
          {stats.avg_duration_secs != null && (
            <span>
              Avg {formatMs(stats.avg_duration_secs * 1000)}/run
            </span>
          )}
          <span>
            {stats.total_ai_steps} AI step{stats.total_ai_steps !== 1 ? "s" : ""}
          </span>
          <span>
            Avg {formatCost(stats.avg_cost_per_ai_step)}/AI step
          </span>
        </div>
      </div>

      {/* Top Pipelines */}
      {stats.top_pipelines.length > 0 && (
        <div className="border-b border-zinc-700 px-4 py-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Top Pipelines by Cost
          </div>
          {stats.top_pipelines.map((p, i) => (
            <div
              key={p.pipeline_name}
              className="flex items-center justify-between py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-zinc-600">
                    {i + 1}.
                  </span>
                  <span className="truncate text-xs text-zinc-300">
                    {p.pipeline_name}
                  </span>
                </div>
                <div className="ml-5 text-[10px] text-zinc-600">
                  avg {formatCost(p.avg_cost_per_run)}/run
                  {p.avg_duration_secs != null && (
                    <> · avg {formatMs(p.avg_duration_secs * 1000)}</>
                  )}
                </div>
              </div>
              <div className="ml-2 text-right">
                <div className="text-xs font-medium text-violet-400">
                  {formatCost(p.total_cost_usd)}
                </div>
                <div className="text-[10px] text-zinc-600">
                  {p.run_count}x
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Nodes */}
      {stats.top_nodes.length > 0 && (
        <div className="border-b border-zinc-700 px-4 py-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Top Node Executions by Cost
          </div>
          {stats.top_nodes.map((n, i) => (
            <div
              key={`${n.run_id}-${n.node_id}-${i}`}
              className="flex items-center justify-between py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-zinc-600">
                    {i + 1}.
                  </span>
                  <span className="truncate text-xs text-zinc-300">
                    {n.node_name || n.node_id}
                  </span>
                </div>
                <div className="ml-5 text-[10px] text-zinc-600">
                  {n.pipeline_name}
                  {n.started_at && (
                    <> · {formatTime(n.started_at)}</>
                  )}
                  {n.duration_secs != null && (
                    <> · {formatMs(n.duration_secs * 1000)}</>
                  )}
                </div>
              </div>
              <span className="ml-2 text-xs font-medium text-violet-400">
                {formatCost(n.cost_usd)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent Runs */}
      <div className="px-4 py-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Recent Runs
        </div>
        {stats.runs.length === 0 ? (
          <div className="py-2 text-xs text-zinc-600">No runs yet.</div>
        ) : (
          stats.runs.map((run) => (
            <div
              key={run.run_id}
              className="flex items-center justify-between border-b border-zinc-800/50 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-zinc-300">
                  {run.pipeline_name}
                </div>
                <div className="text-[10px] text-zinc-600">
                  {formatTime(run.started_at)}
                  {run.duration_secs != null && (
                    <> · {formatMs(run.duration_secs * 1000)}</>
                  )}
                </div>
              </div>
              <span
                className={`ml-2 text-xs font-medium ${
                  run.cost_usd > 0 ? "text-violet-400" : "text-zinc-600"
                }`}
              >
                {formatCost(run.cost_usd)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
