import { useState, useEffect, useMemo, useRef, memo } from "react";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { NodeType, RetryPolicy } from "../../types/pipeline";
import { NODE_TYPE_META } from "../../types/pipeline";
import NodeIcon from "../canvas/nodes/NodeIcons";
import { HelpIcon } from "../HintOverlay";

const isSubPipeline = (type: string) => type === "sub-pipeline";
const isComment = (type: string) => type === "comment";
const isCodeNode = (type: string) => type === "shell" || type === "git";
const isLoop = (type: string) => type === "loop";
const isParallelOrLoop = (type: string) => type === "parallel" || type === "loop";

const TIMEOUT_OPTIONS = [
  { label: "None", value: 0 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "30 min", value: 1800 },
];

export default memo(function NodeConfig() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const selectedNodeId = usePipelineStore((s) => s.selectedNodeId);
  const updateNode = usePipelineStore((s) => s.updateNode);
  const removeNode = usePipelineStore((s) => s.removeNode);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const agents = useAgentStore((s) => s.agents);
  const pipelines = usePipelineStore((s) => s.pipelines);
  const mode = useSettingsStore((s) => s.local.mode);
  const isSimple = mode === "simple";

  const node = useMemo(
    () => currentPipeline?.nodes.find((n) => n.id === selectedNodeId),
    [currentPipeline?.nodes, selectedNodeId],
  );
  const nodeId = node?.id;

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
  const [simpleRetry, setSimpleRetry] = useState(false);

  // Lazy-load marked for markdown preview (avoids bundling it eagerly)
  const markedRef = useRef<typeof import("marked")["marked"] | null>(null);
  const [markedReady, setMarkedReady] = useState(false);
  useEffect(() => {
    if (markedRef.current) return;
    import("marked").then((m) => {
      markedRef.current = m.marked;
      setMarkedReady(true);
    });
  }, []);

  // Compute upstream nodes for "Use output from" dropdown
  const edges = currentPipeline?.edges;
  const nodes = currentPipeline?.nodes;
  const upstreamNodes = useMemo(() => {
    if (!edges || !nodes || !nodeId) return [];
    const incomingEdges = edges.filter((e) => e.to === nodeId);
    const upstreamIds = new Set(incomingEdges.map((e) => e.from));
    return nodes.filter((n) => upstreamIds.has(n.id));
  }, [edges, nodes, nodeId]);

  // Eligible nodes for parallel/loop children checkboxes
  const nodeType = node?.type;
  const eligibleChildNodes = useMemo(() => {
    if (!nodes || !nodeId || !nodeType || !isParallelOrLoop(nodeType)) return [];
    return nodes.filter(
      (n) => n.id !== nodeId && n.type !== "parallel" && n.type !== "loop",
    );
  }, [nodes, nodeId, nodeType]);

  // Filtered agents (exclude self-referencing pipeline agents)
  const pipelineName = currentPipeline?.name;
  const filteredAgents = useMemo(() => {
    const safeName = pipelineName?.replace(/[^a-zA-Z0-9\-_]/g, "-").toLowerCase();
    return agents.filter((a) => {
      if (!safeName) return true;
      const aNameLower = a.name.toLowerCase();
      if (aNameLower === `_pipeline--${safeName}`) return false;
      if (aNameLower === safeName) return false;
      if (a.origin === "pipeline" && (a.display_name ?? "").toLowerCase() === safeName) return false;
      return true;
    });
  }, [agents, pipelineName]);

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
      setSimpleRetry((node.retry?.max ?? 0) > 0);
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
    return markedRef.current ? (markedRef.current.parse(instructions) as string) : instructions;
  }, [instructions, node, markedReady]);

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Select a node on the canvas to configure it
      </div>
    );
  }

  const meta = NODE_TYPE_META[node.type as NodeType];

  const handleSave = () => {
    let effectiveRetryMax = retryMax;
    let effectiveRetryDelay = retryDelay;
    if (isSimple) {
      effectiveRetryMax = simpleRetry ? 3 : 0;
      effectiveRetryDelay = simpleRetry ? 5 : 0;
    }
    const retry: RetryPolicy | undefined =
      effectiveRetryMax > 0 ? { max: effectiveRetryMax, delay: effectiveRetryDelay } : undefined;

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

  const insertOutputRef = (nodeId: string) => {
    const ref = `{output.${nodeId}}`;
    if (!instructions.includes(ref)) {
      setInstructions((prev) => (prev ? `${prev}\n${ref}` : ref));
    }
  };

  const getInstructionLabel = () => {
    if (isSimple) {
      if (node.type === "ai-task") return "What should this step do?";
      if (node.type === "shell") return "Command to run";
      if (node.type === "git") return "Git command";
      if (isLoop(node.type)) return "Items to loop over";
      return "Instructions";
    }
    if (isCodeNode(node.type)) return "Command";
    if (isLoop(node.type)) return "Items Source";
    return "Instructions";
  };

  const getInstructionPlaceholder = () => {
    if (isSimple) {
      if (node.type === "ai-task") return 'Describe what Claude should do, e.g., "Review the code for bugs and suggest fixes"';
      if (node.type === "shell") return "e.g., npm test";
      if (node.type === "git") return "e.g., git add -A && git commit";
      return "Describe what this step should do...";
    }
    if (node.type === "shell") return "e.g., npm test";
    if (isLoop(node.type)) return "{output.upstream-node} or one item per line";
    return "Describe what this step should do...";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Node type badge */}
        <div className="flex items-center gap-2">
          <NodeIcon type={node.type as NodeType} className="h-4 w-4" />
          <span className="text-xs font-medium text-zinc-400">
            {isSimple ? meta.friendlyLabel : meta.label}
          </span>
          {!isSimple && (
            <span className="text-[10px] text-zinc-600">{node.id}</span>
          )}
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
              {isSimple ? "Note" : "Comment Text"}
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

        {/* "Use output from" dropdown (Simple Mode only) */}
        {isSimple && !isComment(node.type) && !isSubPipeline(node.type) && upstreamNodes.length > 0 && (
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-zinc-400">
              Use output from
              <HelpIcon text="Insert a reference to a previous step's output into the instructions below." />
            </label>
            <div className="flex flex-wrap gap-1">
              {upstreamNodes.map((un) => (
                <button
                  key={un.id}
                  type="button"
                  onClick={() => insertOutputRef(un.id)}
                  className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                    instructions.includes(`{output.${un.id}}`)
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-violet-500/30 hover:text-zinc-200"
                  }`}
                >
                  {un.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Instructions (hidden for sub-pipeline and comment nodes) */}
        {!isSubPipeline(node.type) && !isComment(node.type) && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="flex items-center gap-1 text-xs font-medium text-zinc-400">
                {getInstructionLabel()}
                {isSimple && (
                  <HelpIcon text="Tell Claude what to do. Be specific about the expected output." />
                )}
              </label>
              {!isSimple && (
                <button
                  type="button"
                  onClick={() => setShowPreview((p) => !p)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                >
                  {showPreview ? "Edit" : "Preview"}
                </button>
              )}
            </div>
            {showPreview && !isSimple ? (
              <div
                className="markdown-preview w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200"
                style={{ minHeight: "7.5rem" }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={isSimple ? 4 : 5}
                className={`w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none ${
                  !isSimple ? "font-mono" : ""
                }`}
                placeholder={getInstructionPlaceholder()}
              />
            )}
          </div>
        )}

        {/* Loop separator (advanced mode only in simple mode) */}
        {isLoop(node.type) && !isSimple && (
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

        {/* Loop max iterations (advanced mode only) */}
        {isLoop(node.type) && !isSimple && (
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

        {/* Loop model override (advanced mode only) */}
        {isLoop(node.type) && !isSimple && (
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
              {eligibleChildNodes.map((n) => (
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
              {eligibleChildNodes.length === 0 && (
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
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-zinc-400">
              Agent
              {isSimple && (
                <HelpIcon text="Choose a pre-configured Claude agent, or leave blank for the default." />
              )}
            </label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None (use instructions only)</option>
              {filteredAgents.map((a) => (
                  <option key={a.path} value={a.name}>
                    {a.display_name ?? a.name}{a.origin === "pipeline" ? " (pipeline)" : ""}
                  </option>
                ))}
            </select>
            {!isSimple && (
              <p className="mt-1 text-[10px] text-zinc-600">
                {agent
                  ? `Will run: claude --agent ${agent} --print "..."`
                  : "Will run: claude --print \"...\""}
              </p>
            )}
          </div>
        )}

        {/* Model selector (AI tasks only) */}
        {!isComment(node.type) && node.type === "ai-task" && (
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-zinc-400">
              Model
              {isSimple && (
                <HelpIcon text="Pick which AI model to use. Haiku is fastest, Opus is most capable." />
              )}
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
            {!isSimple && (
              <p className="mt-1 text-[10px] text-zinc-600">
                {model
                  ? `Will use: --model ${model}`
                  : currentPipeline?.default_model
                    ? `Uses pipeline default: ${currentPipeline.default_model}`
                    : "Uses default model"}
              </p>
            )}
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

        {/* Required MCP Tools (advanced mode only) */}
        {!isSimple && !isComment(node.type) && node.type === "ai-task" && (
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

        {/* Inputs (advanced mode only) */}
        {!isSimple && !isComment(node.type) && (
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

        {/* Outputs (advanced mode only) */}
        {!isSimple && !isComment(node.type) && (
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

        {/* Retry — Simple Mode: checkbox, Advanced Mode: full controls */}
        {!isComment(node.type) && (
          isSimple ? (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="simple-retry"
                checked={simpleRetry}
                onChange={(e) => {
                  setSimpleRetry(e.target.checked);
                  if (e.target.checked) {
                    setRetryMax(3);
                    setRetryDelay(5);
                  } else {
                    setRetryMax(0);
                    setRetryDelay(0);
                  }
                }}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
              />
              <label htmlFor="simple-retry" className="flex items-center gap-1 text-xs text-zinc-400">
                Retry on failure
                <HelpIcon text="If this step fails, retry it automatically up to 3 times." />
              </label>
            </div>
          ) : (
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
          )
        )}

        {/* Timeout — Simple Mode: dropdown, Advanced Mode: number input */}
        {!isComment(node.type) && (
          isSimple ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Timeout
              </label>
              <select
                value={TIMEOUT_OPTIONS.some((o) => o.value === timeout) ? timeout : 0}
                onChange={(e) => setTimeout_(Number(e.target.value))}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
              >
                {TIMEOUT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ) : (
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
          )
        )}

        {/* Total Loop Timeout (advanced mode only) */}
        {isLoop(node.type) && !isSimple && (
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
