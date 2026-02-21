import dagre from "@dagrejs/dagre";
import type { PipelineNode, PipelineEdge } from "../types/pipeline";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/**
 * Compute a left-to-right dagre layout for pipeline nodes and edges.
 * Returns a position map keyed by node id.
 */
export function computeLayout(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      // dagre returns center coords; convert to top-left for React Flow
      positions[node.id] = {
        x: Math.round(pos.x - NODE_WIDTH / 2),
        y: Math.round(pos.y - NODE_HEIGHT / 2),
      };
    }
  }

  return positions;
}
