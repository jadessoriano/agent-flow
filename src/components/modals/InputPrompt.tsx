import { useState, useEffect } from "react";
import type { PipelineVariables, Pipeline } from "../../types/pipeline";
import { estimateRun, type RunEstimate } from "../../lib/tauri";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

interface InputPromptProps {
  open: boolean;
  pipeline: Pipeline | null;
  variables: PipelineVariables;
  onRun: (inputs: Record<string, string>) => void;
  onCancel: () => void;
}

export default function InputPrompt({
  open,
  pipeline,
  variables,
  onRun,
  onCancel,
}: InputPromptProps) {
  const varKeys = Object.keys(variables);

  // Compute root node inputs: inputs on nodes that have no incoming edges
  // and are not children of a parallel group.
  // These are the "entry point" values the user needs to provide.
  const rootInputKeys = (() => {
    if (!pipeline) return [];
    const targetNodeIds = new Set(pipeline.edges.map((e) => e.to));
    // Collect all child IDs of parallel/loop groups — they're implicitly connected
    const parallelChildIds = new Set<string>();
    for (const node of pipeline.nodes) {
      if ((node.type === "parallel" || node.type === "loop") && node.children) {
        for (const cid of node.children) parallelChildIds.add(cid);
      }
    }
    const rootNodes = pipeline.nodes.filter(
      (n) => !targetNodeIds.has(n.id) && !parallelChildIds.has(n.id),
    );
    const keys = new Set<string>();
    for (const node of rootNodes) {
      for (const inp of node.inputs) {
        // Skip inputs that are already pipeline variables
        if (!(inp in variables)) {
          keys.add(inp);
        }
      }
    }
    return [...keys];
  })();

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    varKeys.forEach((k) => {
      init[k] = variables[k] || "";
    });
    rootInputKeys.forEach((k) => {
      init[k] = "";
    });
    return init;
  });

  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [costLoading, setCostLoading] = useState(true);

  useEffect(() => {
    if (!open || !pipeline) return;
    let cancelled = false;
    setCostLoading(true);
    estimateRun(pipeline)
      .then((est) => { if (!cancelled) setEstimate(est); })
      .catch(() => { if (!cancelled) setEstimate(null); })
      .finally(() => { if (!cancelled) setCostLoading(false); });
    return () => { cancelled = true; };
  }, [open, pipeline]);

  // Reset values when variables or pipeline change
  useEffect(() => {
    const init: Record<string, string> = {};
    Object.keys(variables).forEach((k) => {
      init[k] = variables[k] || "";
    });
    rootInputKeys.forEach((k) => {
      init[k] = "";
    });
    setValues(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables, pipeline]);

  if (!open) return null;

  // Use backend estimate for node counts and cost projections
  const aiCount = estimate?.ai_node_count ?? 0;
  const shellCount = estimate?.shell_node_count ?? 0;
  const subPipelineCount = pipeline
    ? pipeline.nodes.filter((n) => n.type === "sub-pipeline").length
    : 0;
  const otherCount = (estimate?.other_node_count ?? 0) - subPipelineCount;

  const requiredTools = pipeline
    ? [...new Set(
        pipeline.nodes
          .filter((n) => n.type === "ai-task" && n.requires_tools?.length)
          .flatMap((n) => n.requires_tools!)
      )]
    : [];

  const avgAiCost = estimate?.avg_ai_cost ?? null;
  const hasEstimate = estimate?.estimated_low != null;
  const estimatedLow = estimate?.estimated_low ?? null;
  const estimatedHigh = estimate?.estimated_high ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRun(values);
  };

  const runButtonLabel = (() => {
    if (hasEstimate && estimatedLow !== null) {
      return `Run ~${formatCost(estimatedLow)}+`;
    }
    return "Run";
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-200">
            Run Pipeline
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {rootInputKeys.length > 0 || varKeys.length > 0
              ? "Provide inputs and variables before starting."
              : "Ready to run this pipeline."}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {(rootInputKeys.length > 0 || varKeys.length > 0) && (
            <div className="max-h-64 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-3">
                {/* Pipeline inputs (root node entry-point data) */}
                {rootInputKeys.length > 0 && (
                  <>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Pipeline Inputs
                    </div>
                    {rootInputKeys.map((key) => (
                      <div key={key}>
                        <label className="mb-1 block text-xs font-medium text-violet-400">
                          {key}
                        </label>
                        <input
                          type="text"
                          value={values[key] || ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [key]: e.target.value }))
                          }
                          placeholder={`Enter ${key}...`}
                          className="w-full rounded border border-violet-500/30 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                          autoFocus={rootInputKeys.indexOf(key) === 0}
                        />
                      </div>
                    ))}
                  </>
                )}
                {/* Pipeline variables (global substitutions) */}
                {varKeys.length > 0 && (
                  <>
                    {rootInputKeys.length > 0 && (
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        Variables
                      </div>
                    )}
                    {varKeys.map((key) => (
                      <div key={key}>
                        <label className="mb-1 block text-xs font-medium text-zinc-400">
                          {key}
                        </label>
                        <input
                          type="text"
                          value={values[key] || ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [key]: e.target.value }))
                          }
                          placeholder={variables[key] || `Enter ${key}...`}
                          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Cost Estimate Section */}
          {pipeline && (
            <div className="mx-6 mb-4 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Cost Estimate
              </div>
              {costLoading ? (
                <div className="text-xs text-zinc-500">Calculating...</div>
              ) : aiCount === 0 && subPipelineCount === 0 ? (
                <div className="text-xs text-green-400">
                  No AI nodes — this run is free
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-zinc-300 flex-wrap">
                    {aiCount > 0 && (
                      <span>
                        {aiCount} AI node{aiCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {shellCount > 0 && (
                      <>
                        {aiCount > 0 && <span className="text-zinc-600">·</span>}
                        <span>
                          {shellCount} shell node{shellCount !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {subPipelineCount > 0 && (
                      <>
                        {(aiCount > 0 || shellCount > 0) && <span className="text-zinc-600">·</span>}
                        <span className="text-cyan-400">
                          {subPipelineCount} sub-pipeline{subPipelineCount !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {otherCount > 0 && (
                      <>
                        <span className="text-zinc-600">·</span>
                        <span>
                          {otherCount} other
                        </span>
                      </>
                    )}
                  </div>
                  {requiredTools.length > 0 && (
                    <div className="text-[10px] text-amber-400/80 mt-1">
                      Requires MCP: {requiredTools.join(", ")}
                    </div>
                  )}
                  {subPipelineCount > 0 && (
                    <div className="text-[10px] text-cyan-400/70 mt-1">
                      Sub-pipelines may contain additional AI nodes not reflected in the estimate
                    </div>
                  )}
                  {hasEstimate && estimatedLow !== null && estimatedHigh !== null ? (
                    <>
                      <div className="text-sm font-medium text-violet-400">
                        Estimated: {formatCost(estimatedLow)} – {formatCost(estimatedHigh)}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Based on avg {formatCost(avgAiCost!)}/AI node
                        {subPipelineCount > 0 ? " (top-level only)" : ""}
                      </div>
                    </>
                  ) : aiCount === 0 && subPipelineCount > 0 ? (
                    <div className="text-xs text-zinc-500">
                      Cost depends on sub-pipeline contents
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">
                      No estimate yet — first AI run
                    </div>
                  )}
                  {estimate?.max_cost_usd != null && (
                    <div className="text-xs text-amber-400 mt-1">
                      Budget cap: {formatCost(estimate.max_cost_usd)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-6 py-4">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
            >
              {runButtonLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
