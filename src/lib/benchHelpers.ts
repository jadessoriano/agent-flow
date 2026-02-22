import type { PipelineNode, PipelineEdge, Pipeline } from "../types/pipeline";
import type { NodeResult, RunState, RunStateDelta, RunRow } from "../types/run";

let idCounter = 0;

export function makeNode(overrides: Partial<PipelineNode> = {}): PipelineNode {
  const id = overrides.id ?? `node-${idCounter++}`;
  return {
    id,
    name: overrides.name ?? `Node ${id}`,
    type: overrides.type ?? "ai-task",
    instructions: overrides.instructions ?? `Do something for ${id}`,
    inputs: overrides.inputs ?? [],
    outputs: overrides.outputs ?? [],
    position: overrides.position ?? { x: Math.random() * 800, y: Math.random() * 600 },
    ...overrides,
  };
}

export function makeEdge(from: string, to: string, condition?: string): PipelineEdge {
  return {
    id: `${from}->${to}`,
    from,
    to,
    condition: condition as PipelineEdge["condition"],
  };
}

export function makeLinearPipeline(n: number): Pipeline {
  idCounter = 0;
  const nodes = Array.from({ length: n }, (_, i) => makeNode({ id: `n${i}`, name: `Node ${i}` }));
  const edges = Array.from({ length: Math.max(0, n - 1) }, (_, i) =>
    makeEdge(`n${i}`, `n${i + 1}`),
  );
  return {
    name: "bench-pipeline",
    description: "Benchmark pipeline",
    version: "1.0",
    variables: {},
    nodes,
    edges,
  };
}

export function makeNodeResult(nodeId: string, overrides: Partial<NodeResult> = {}): NodeResult {
  return {
    node_id: nodeId,
    status: "Success",
    exit_code: 0,
    output: `Output for ${nodeId}`,
    started_at: "2026-02-22T00:00:00Z",
    finished_at: "2026-02-22T00:01:00Z",
    attempt: 1,
    cost_usd: 0.005,
    ...overrides,
  };
}

export function makeRunState(nodeCount: number, overrides: Partial<RunState> = {}): RunState {
  const nodeResults: Record<string, NodeResult> = {};
  for (let i = 0; i < nodeCount; i++) {
    const id = `n${i}`;
    nodeResults[id] = makeNodeResult(id);
  }
  return {
    run_id: overrides.run_id ?? `run-${Date.now()}`,
    pipeline_name: overrides.pipeline_name ?? "bench-pipeline",
    status: overrides.status ?? "running",
    node_results: overrides.node_results ?? nodeResults,
    current_node: overrides.current_node ?? `n${nodeCount - 1}`,
    total_cost_usd: overrides.total_cost_usd ?? nodeCount * 0.005,
  };
}

export function makeRunRow(i: number): RunRow {
  return {
    id: `run-${i}`,
    pipeline_name: `pipeline-${i % 5}`,
    started_at: new Date(Date.now() - i * 60000).toISOString(),
    finished_at: new Date(Date.now() - i * 60000 + 30000).toISOString(),
    status: i % 3 === 0 ? "failed" : "success",
    trigger_input: null,
    resumed_from: null,
    failed_node_id: i % 3 === 0 ? "n0" : null,
    pipeline_hash: `hash-${i}`,
  };
}

export function makeRunDelta(
  runId: string,
  nodeId: string,
  overrides: Partial<RunStateDelta> = {},
): RunStateDelta {
  return {
    run_id: runId,
    status: overrides.status,
    current_node: overrides.current_node,
    total_cost_usd: overrides.total_cost_usd,
    node_result: overrides.node_result ?? makeNodeResult(nodeId),
  };
}
