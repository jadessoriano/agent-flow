import { useState, useEffect, useMemo, memo } from "react";
import { marked } from "marked";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useAgentStore } from "../../stores/agentStore";
import type { NodeType, RetryPolicy } from "../../types/pipeline";
import { NODE_TYPE_META } from "../../types/pipeline";
import NodeIcon from "../canvas/nodes/NodeIcons";

const isSubPipeline = (type: string) => type === "sub-pipeline";
const isComment = (type: string) => type === "comment";
const isCodeNode = (type: string) => type === "shell" || type === "git";
const isLoop = (type: string) => type === "loop";
const isParallelOrLoop = (type: string) => type === "parallel" || type === "loop";

export default memo(function NodeConfig() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const selectedNodeId = usePipelineStore((s) => s.selectedNodeId);
  const updateNode = usePipelineStore((s) => s.updateNode);
  const removeNode = usePipelineStore((s) => s.removeNode);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const agents = useAgentStore((s) => s.agents);
  const pipelines = usePipelineStore((s) => s.pipelines);

  const node = currentPipeline?.nodes.find((n) => n.id === selectedNodeId);

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [inputs, setInputs] = useState("");
  const [outputs, setOutputs] = useState("");
  const [agent, setAgent] = useState("");
  const [requiresTools, setRequiresTools] = useState("");
  const [pipeline_ref, setPipelineRef] = useState("");
  const [retryMax, setRetryMax] = useState(0);
  const [retryDelay, setRetryDelay] = useState(0);
  const [timeout, setTimeout_] = useState(0);
  const [model, setModel] = useState("");
  const [loopModel, setLoopModel] = useState("");
  const [cache, setCache] = useState(false);
  const [children, setChildren] = useState<string[]>([]);
  const [loopSeparator, setLoopSeparator] = useState("newline");
  const [maxIterations, setMaxIterations] = useState(100);
  const [loopTimeout, setLoopTimeout] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (node) {
      setName(node.name);
      setInstructions(node.instructions);
      setAgent(node.agent || "");
      setPipelineRef(node.pipeline_ref || "");
      setRequiresTools((node.requires_tools ?? []).join(", "));
      setInputs(node.inputs.join(", "));
      setOutputs(node.outputs.join(", "));
      setRetryMax(node.retry?.max ?? 0);
      setRetryDelay(node.retry?.delay ?? 0);
      setTimeout_(node.timeout ?? 0);
      setModel(node.model || "");
      setLoopModel(node.loop_model || "");
      setCache(node.cache || false);
      setChildren(node.children ?? []);
      setLoopSeparator(node.loop_separator || "newline");
      setMaxIterations(node.max_iterations ?? 100);
      setLoopTimeout(node.loop_timeout ?? 0);
      setConfirmDelete(false);
      setShowPreview(false);
    }
  }, [node]);

  const previewHtml = useMemo(() => {
    if (!instructions) return "";
    if (node && isCodeNode(node.type)) {
      const escaped = instructions
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="code-preview"><code>${escaped}</code></pre>`;
    }
    return marked.parse(instructions) as string;
  }, [instructions, node]);

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Select a node on the canvas to configure it
      </div>
    );
  }

  const meta = NODE_TYPE_META[node.type as NodeType];

  const handleSave = () => {
    const retry: RetryPolicy | undefined =
      retryMax > 0 ? { max: retryMax, delay: retryDelay } : undefined;

    const toolsList = requiresTools
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    updateNode(node.id, {
      name,
      instructions,
      agent: agent || undefined,
      pipeline_ref: pipeline_ref || undefined,
      inputs: inputs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      outputs: outputs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requires_tools: toolsList.length > 0 ? toolsList : undefined,
      retry,
      timeout: timeout > 0 ? timeout : undefined,
      model: model || undefined,
      loop_model: isLoop(node.type) && loopModel ? loopModel : undefined,
      cache: cache || undefined,
      children: isParallelOrLoop(node.type) ? children : undefined,
      loop_separator: isLoop(node.type) ? loopSeparator : undefined,
      max_iterations: isLoop(node.type) ? Math.max(1, Math.min(1000, maxIterations || 100)) : undefined,
      loop_timeout: isLoop(node.type) && loopTimeout > 0 ? loopTimeout : undefined,
    });
  };

  const handleDelete = () => {
    removeNode(node.id);
    selectNode(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Node type badge */}
        <div className="flex items-center gap-2">
          <NodeIcon type={node.type as NodeType} className="h-4 w-4" />
          <span className="text-xs font-medium text-zinc-400">
            {meta.label}
          </span>
          <span className="text-[10px] text-zinc-600">{node.id}</span>
        </div>

        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
          />
        </div>

        {/* Comment mode: show only text area */}
        {isComment(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Comment Text
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
              placeholder="Write your comment or note here..."
            />
          </div>
        )}

        {/* Sub-pipeline selector */}
        {!isComment(node.type) && isSubPipeline(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Pipeline
            </label>
            <select
              value={pipeline_ref}
              onChange={(e) => setPipelineRef(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">
                Select a pipeline...
              </option>
              {pipelines
                .filter((p) => p.name !== currentPipeline?.name)
                .map((p) => (
                  <option key={p.path} value={p.name}>
                    {p.name}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[10px] text-zinc-600">
              Executes the selected pipeline with full orchestration
            </p>
          </div>
        )}

        {/* Instructions (hidden for sub-pipeline and comment nodes) */}
        {!isSubPipeline(node.type) && !isComment(node.type) && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-400">
                {isCodeNode(node.type) ? "Command" : isLoop(node.type) ? "Items Source" : "Instructions"}
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((p) => !p)}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            </div>
            {showPreview ? (
              <div
                className="markdown-preview w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200"
                style={{ minHeight: "7.5rem" }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={5}
                className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-mono text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder={
                  node.type === "shell"
                    ? "e.g., npm test"
                    : isLoop(node.type)
                      ? "{output.upstream-node} or one item per line"
                      : "Describe what this step should do..."
                }
              />
            )}
          </div>
        )}

        {/* Loop separator */}
        {isLoop(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Separator
            </label>
            <select
              value={["newline", "comma", "space", "tab"].includes(loopSeparator) ? loopSeparator : "custom"}
              onChange={(e) => setLoopSeparator(e.target.value === "custom" ? "" : e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="newline">Newline</option>
              <option value="comma">Comma</option>
              <option value="space">Space</option>
              <option value="tab">Tab</option>
              <option value="custom">Custom</option>
            </select>
            {!["newline", "comma", "space", "tab"].includes(loopSeparator) && (
              <input
                type="text"
                value={loopSeparator}
                onChange={(e) => setLoopSeparator(e.target.value)}
                placeholder="e.g., || or ; or any delimiter"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-mono text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
              />
            )}
            <p className="mt-1 text-[10px] text-zinc-600">
              How to split the items source into individual items
            </p>
          </div>
        )}

        {/* Loop max iterations */}
        {isLoop(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Max Iterations
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              Safety limit to prevent runaway loops
            </p>
          </div>
        )}

        {/* Loop model override */}
        {isLoop(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Loop Model
            </label>
            <select
              value={loopModel}
              onChange={(e) => setLoopModel(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">(use child/pipeline default)</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="claude-opus-4-6">Opus 4.6</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            </select>
            <p className="mt-1 text-[10px] text-zinc-600">
              Override the model used for all child nodes in this loop
            </p>
          </div>
        )}

        {/* Children (parallel and loop groups) */}
        {isParallelOrLoop(node.type) && currentPipeline && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Children
            </label>
            <div className="rounded border border-zinc-700 bg-zinc-800 p-2 max-h-40 overflow-y-auto">
              {currentPipeline.nodes
                .filter((n) => n.id !== node.id && n.type !== "parallel" && n.type !== "loop")
                .map((n) => (
                  <label key={n.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-zinc-700/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={children.includes(n.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setChildren([...children, n.id]);
                        } else {
                          setChildren(children.filter((c) => c !== n.id));
                        }
                      }}
                      className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
                    />
                    <span className="text-xs text-zinc-300">{n.name}</span>
                    <span className="text-[10px] text-zinc-600">{n.type}</span>
                  </label>
                ))}
              {currentPipeline.nodes.filter((n) => n.id !== node.id && n.type !== "parallel" && n.type !== "loop").length === 0 && (
                <p className="text-[10px] text-zinc-600 px-1">No other nodes in pipeline</p>
              )}
            </div>
            <p className="mt-1 text-[10px] text-zinc-600">
              {isLoop(node.type)
                ? "Nodes to execute for each iteration"
                : "Nodes to execute in parallel"}
            </p>
          </div>
        )}

        {/* Agent selector (AI tasks only, not comments) */}
        {!isComment(node.type) && node.type === "ai-task" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Agent
            </label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None (use instructions only)</option>
              {agents
                .filter((a) => {
                  // Filter out agents that would cause self-reference with the current pipeline
                  if (!currentPipeline) return true;
                  const safeName = currentPipeline.name.replace(/[^a-zA-Z0-9\-_]/g, '-').toLowerCase();
                  const aNameLower = a.name.toLowerCase();
                  // Block: prefixed auto-generated agent (_pipeline--ticket-to-pr)
                  if (aNameLower === `_pipeline--${safeName}`) return false;
                  // Block: unprefixed agent with same name (ticket-to-pr)
                  if (aNameLower === safeName) return false;
                  // Block: any pipeline-origin agent whose display_name matches
                  if (a.origin === "pipeline" && (a.display_name ?? "").toLowerCase() === safeName) return false;
                  return true;
                })
                .map((a) => (
                  <option key={a.path} value={a.name}>
                    {a.display_name ?? a.name}{a.origin === "pipeline" ? " (pipeline)" : ""}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[10px] text-zinc-600">
              {agent
                ? `Will run: claude --agent ${agent} --print "..."`
                : "Will run: claude --print \"...\""}
            </p>
          </div>
        )}

        {/* Model selector (AI tasks only) */}
        {!isComment(node.type) && node.type === "ai-task" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">(default)</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="claude-opus-4-6">Opus 4.6</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            </select>
            <p className="mt-1 text-[10px] text-zinc-600">
              {model
                ? `Will use: --model ${model}`
                : currentPipeline?.default_model
                  ? `Uses pipeline default: ${currentPipeline.default_model}`
                  : "Uses default model"}
            </p>
          </div>
        )}

        {/* Cache output (AI tasks only) */}
        {!isComment(node.type) && node.type === "ai-task" && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="cache-output"
              checked={cache}
              onChange={(e) => setCache(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
            />
            <label htmlFor="cache-output" className="text-xs text-zinc-400">
              Cache output
            </label>
            <span className="text-[10px] text-zinc-600">
              Reuse result if instructions haven't changed
            </span>
          </div>
        )}

        {/* Required MCP Tools (AI tasks only, not comments) */}
        {!isComment(node.type) && node.type === "ai-task" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Required MCP Tools
            </label>
            <input
              type="text"
              value={requiresTools}
              onChange={(e) => setRequiresTools(e.target.value)}
              placeholder="e.g., mcp-atlassian, github-mcp"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              Comma-separated MCP server names. Pipeline will fail before running if any are missing.
            </p>
          </div>
        )}

        {/* Inputs (hidden for comments) */}
        {!isComment(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Inputs
            </label>
            <input
              type="text"
              value={inputs}
              onChange={(e) => setInputs(e.target.value)}
              placeholder="comma-separated input names"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        )}

        {/* Outputs */}
        {!isComment(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Outputs
            </label>
            <input
              type="text"
              value={outputs}
              onChange={(e) => setOutputs(e.target.value)}
              placeholder="comma-separated output names"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        )}

        {/* Retry */}
        {!isComment(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Retry Policy
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-zinc-500">
                  Max attempts
                </label>
                <input
                  type="number"
                  min={0}
                  value={retryMax}
                  onChange={(e) => setRetryMax(Number(e.target.value))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-zinc-500">
                  Delay (sec)
                </label>
                <input
                  type="number"
                  min={0}
                  value={retryDelay}
                  onChange={(e) => setRetryDelay(Number(e.target.value))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Timeout */}
        {!isComment(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {isLoop(node.type) ? "Per-Iteration Timeout (seconds)" : "Timeout (seconds)"}
            </label>
            <input
              type="number"
              min={0}
              value={timeout}
              onChange={(e) => setTimeout_(Number(e.target.value))}
              placeholder="0 = no timeout"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        )}

        {/* Total Loop Timeout */}
        {isLoop(node.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Total Loop Timeout (seconds)
            </label>
            <input
              type="number"
              min={0}
              value={loopTimeout}
              onChange={(e) => setLoopTimeout(Number(e.target.value))}
              placeholder="0 = no limit"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              Maximum wall-clock time for all iterations combined
            </p>
          </div>
        )}

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
            <span className="text-xs text-red-400">Delete this node?</span>
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
            Delete node
          </button>
        )}
      </div>
    </div>
  );
});
