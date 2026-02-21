import type { Pipeline } from "../types/pipeline";

export interface DiffEntry {
  type: "added" | "removed" | "changed";
  category: "node" | "edge" | "variable" | "meta";
  id?: string;
  description: string;
}

export function computePipelineDiff(saved: Pipeline, current: Pipeline): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // Meta changes
  if (saved.name !== current.name) {
    entries.push({ type: "changed", category: "meta", description: `Name: "${saved.name}" → "${current.name}"` });
  }
  if (saved.description !== current.description) {
    entries.push({ type: "changed", category: "meta", description: `Description updated` });
  }
  if (saved.version !== current.version) {
    entries.push({ type: "changed", category: "meta", description: `Version: "${saved.version}" → "${current.version}"` });
  }

  // Node changes
  const savedNodeMap = new Map(saved.nodes.map((n) => [n.id, n]));
  const currentNodeMap = new Map(current.nodes.map((n) => [n.id, n]));

  for (const [id, node] of currentNodeMap) {
    const savedNode = savedNodeMap.get(id);
    if (!savedNode) {
      entries.push({ type: "added", category: "node", id, description: `Added node "${node.name}" (${node.type})` });
    } else {
      const changes: string[] = [];
      if (savedNode.name !== node.name) changes.push(`name: "${savedNode.name}" → "${node.name}"`);
      if (savedNode.type !== node.type) changes.push(`type: ${savedNode.type} → ${node.type}`);
      if (savedNode.instructions !== node.instructions) changes.push("instructions updated");
      if (savedNode.agent !== node.agent) changes.push(`agent: ${savedNode.agent || "none"} → ${node.agent || "none"}`);
      if (changes.length > 0) {
        entries.push({ type: "changed", category: "node", id, description: `Node "${node.name}": ${changes.join(", ")}` });
      }
    }
  }
  for (const [id, node] of savedNodeMap) {
    if (!currentNodeMap.has(id)) {
      entries.push({ type: "removed", category: "node", id, description: `Removed node "${node.name}"` });
    }
  }

  // Edge changes
  const savedEdgeMap = new Map(saved.edges.map((e) => [e.id, e]));
  const currentEdgeMap = new Map(current.edges.map((e) => [e.id, e]));

  for (const [id, edge] of currentEdgeMap) {
    if (!savedEdgeMap.has(id)) {
      entries.push({ type: "added", category: "edge", id, description: `Added edge ${edge.from} → ${edge.to}` });
    } else {
      const savedEdge = savedEdgeMap.get(id)!;
      if (savedEdge.condition !== edge.condition) {
        entries.push({ type: "changed", category: "edge", id, description: `Edge condition: ${savedEdge.condition || "none"} → ${edge.condition || "none"}` });
      }
    }
  }
  for (const [id, edge] of savedEdgeMap) {
    if (!currentEdgeMap.has(id)) {
      entries.push({ type: "removed", category: "edge", id, description: `Removed edge ${edge.from} → ${edge.to}` });
    }
  }

  // Variable changes
  const savedVars = saved.variables || {};
  const currentVars = current.variables || {};
  const allKeys = new Set([...Object.keys(savedVars), ...Object.keys(currentVars)]);
  for (const key of allKeys) {
    if (!(key in savedVars)) {
      entries.push({ type: "added", category: "variable", description: `Added variable "${key}"` });
    } else if (!(key in currentVars)) {
      entries.push({ type: "removed", category: "variable", description: `Removed variable "${key}"` });
    } else if (savedVars[key] !== currentVars[key]) {
      entries.push({ type: "changed", category: "variable", description: `Variable "${key}" value changed` });
    }
  }

  return entries;
}
