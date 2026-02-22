import dagre from "@dagrejs/dagre";

interface LayoutNode {
  id: string;
}

interface LayoutEdge {
  from: string;
  to: string;
}

interface LayoutRequest {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

interface LayoutResponse {
  positions: Record<string, { x: number; y: number }>;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
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
      positions[node.id] = {
        x: Math.round(pos.x - NODE_WIDTH / 2),
        y: Math.round(pos.y - NODE_HEIGHT / 2),
      };
    }
  }

  return positions;
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { nodes, edges } = e.data;
  const positions = computeLayout(nodes, edges);
  self.postMessage({ positions } satisfies LayoutResponse);
};
