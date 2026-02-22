import type { Pipeline } from "../types/pipeline";

export interface ValidationError {
  nodeId?: string;
  severity: "error" | "warning";
  message: string;
}

export function validatePipeline(pipeline: Pipeline): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Check for disconnected nodes (no incoming or outgoing edges)
  // Collect nodes that are children of a parallel or loop node (implicitly connected)
  const childOfGroup = new Set<string>();
  for (const node of pipeline.nodes) {
    if ((node.type === "parallel" || node.type === "loop") && node.children?.length) {
      for (const cid of node.children) childOfGroup.add(cid);
    }
  }
  for (const node of pipeline.nodes) {
    if (node.type === "comment") continue; // comments don't need connections
    if (childOfGroup.has(node.id)) continue; // implicitly connected via parent
    const hasIncoming = pipeline.edges.some((e) => e.to === node.id);
    const hasOutgoing = pipeline.edges.some((e) => e.from === node.id);
    if (!hasIncoming && !hasOutgoing && pipeline.nodes.length > 1) {
      errors.push({
        nodeId: node.id,
        severity: "warning",
        message: `Node "${node.name}" is disconnected (no edges)`,
      });
    }
  }

  // 2. Check for empty instructions on ai-task/shell/git nodes
  for (const node of pipeline.nodes) {
    if (["ai-task", "shell", "git"].includes(node.type) && !node.instructions.trim()) {
      errors.push({
        nodeId: node.id,
        severity: "error",
        message: `Node "${node.name}" has empty instructions`,
      });
    }
  }

  // 3. Cycle detection using Kahn's algorithm
  // Exclude conditional (failure/success) back-edges — these are intentional
  // retry/recovery loops handled by the executor, not true DAG violations.
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of pipeline.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const edge of pipeline.edges) {
    if (edge.condition) continue; // conditional edges can form retry loops
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  if (visited < pipeline.nodes.length) {
    errors.push({
      severity: "error",
      message: "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    });
  }

  // 4. Missing pipeline_ref on sub-pipeline nodes
  for (const node of pipeline.nodes) {
    if (node.type === "sub-pipeline" && !node.pipeline_ref) {
      errors.push({
        nodeId: node.id,
        severity: "error",
        message: `Sub-pipeline node "${node.name}" has no pipeline selected`,
      });
    }
  }

  // 5. Dead-end warnings (nodes with incoming but no outgoing, that aren't the last in chain)
  // Helper: check if a node (or its children for parallel groups) has outgoing edges
  const hasEffectiveOutgoing = (nodeId: string): boolean => {
    if (pipeline.edges.some((e) => e.from === nodeId)) return true;
    // For parallel groups, check if any child has outgoing edges
    const n = pipeline.nodes.find((nd) => nd.id === nodeId);
    if ((n?.type === "parallel" || n?.type === "loop") && n.children?.length) {
      return n.children.some((childId) => pipeline.edges.some((e) => e.from === childId));
    }
    return false;
  };

  for (const node of pipeline.nodes) {
    if (node.type === "comment") continue;
    const hasIncoming = pipeline.edges.some((e) => e.to === node.id);
    if (hasIncoming && !hasEffectiveOutgoing(node.id)) {
      // This is a terminal node — only warn if there are other terminal nodes
      const terminalCount = pipeline.nodes.filter((n) => {
        if (n.type === "comment") return false;
        return pipeline.edges.some((e) => e.to === n.id) && !hasEffectiveOutgoing(n.id);
      }).length;
      if (terminalCount > 1) {
        errors.push({
          nodeId: node.id,
          severity: "warning",
          message: `Node "${node.name}" is a dead end (has inputs but no outputs)`,
        });
      }
    }
  }

  return errors;
}
