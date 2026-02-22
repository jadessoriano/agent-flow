import { bench, describe } from "vitest";
import { makeLinearPipeline } from "./benchHelpers";
import type { PipelineNode, PipelineEdge } from "../types/pipeline";

interface FlowNodeData {
  label: string;
  nodeType: string;
  instructions: string;
  inputs: string[];
  outputs: string[];
  agent?: string;
  pipelineRef?: string;
  runStatus?: string;
  costUsd?: number;
  durationStr?: string;
}

/**
 * Extracted from Canvas.tsx — pipelineNodesToFlow
 */
function pipelineNodesToFlow(
  nodes: PipelineNode[],
  nodeStatuses?: Record<string, string>,
  nodeCosts?: Record<string, number | null>,
): { id: string; type: string; position: { x: number; y: number }; data: FlowNodeData }[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "pipelineNode",
    position: n.position,
    data: {
      label: n.name,
      nodeType: n.type,
      instructions: n.instructions,
      inputs: n.inputs,
      outputs: n.outputs,
      agent: n.agent,
      pipelineRef: n.pipeline_ref,
      runStatus: nodeStatuses?.[n.id],
      costUsd: nodeCosts?.[n.id] ?? undefined,
    },
  }));
}

/**
 * Extracted from Canvas.tsx — pipelineEdgesToFlow
 */
function pipelineEdgesToFlow(
  edges: PipelineEdge[],
): { id: string; source: string; target: string; type: string; style: { stroke: string } }[] {
  return edges.map((e) => {
    const strokeColor =
      e.condition === "success" ? "#22c55e" : e.condition === "failure" ? "#ef4444" : "#71717a";
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: "conditional",
      style: { stroke: strokeColor },
    };
  });
}

describe("canvas transforms", () => {
  for (const size of [10, 50, 200]) {
    const pipeline = makeLinearPipeline(size);
    const statuses: Record<string, string> = {};
    const costs: Record<string, number | null> = {};
    for (const n of pipeline.nodes) {
      statuses[n.id] = "Success";
      costs[n.id] = 0.005;
    }

    bench(`pipelineNodesToFlow / ${size} nodes`, () => {
      pipelineNodesToFlow(pipeline.nodes, statuses, costs);
    });

    bench(`pipelineEdgesToFlow / ${size} edges`, () => {
      pipelineEdgesToFlow(pipeline.edges);
    });

    bench(`both transforms / ${size} nodes`, () => {
      pipelineNodesToFlow(pipeline.nodes, statuses, costs);
      pipelineEdgesToFlow(pipeline.edges);
    });
  }
});
