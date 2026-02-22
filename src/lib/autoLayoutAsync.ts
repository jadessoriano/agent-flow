import { computeLayout } from "./autoLayout";
import type { PipelineNode, PipelineEdge } from "../types/pipeline";

const WORKER_THRESHOLD = 50;
const WORKER_TIMEOUT = 10_000;

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/**
 * Compute layout asynchronously via Web Worker for large pipelines.
 * Falls back to synchronous computation for small pipelines (< 50 nodes).
 */
export function computeLayoutAsync(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Promise<Record<string, { x: number; y: number }>> {
  // For small pipelines, synchronous is faster (no worker overhead)
  if (nodes.length < WORKER_THRESHOLD) {
    return Promise.resolve(computeLayout(nodes, edges));
  }

  return new Promise((resolve, reject) => {
    const w = getWorker();
    const timeout = setTimeout(() => {
      reject(new Error("Layout worker timed out after 10s"));
    }, WORKER_TIMEOUT);

    const handler = (e: MessageEvent<{ positions: Record<string, { x: number; y: number }> }>) => {
      clearTimeout(timeout);
      w.removeEventListener("message", handler);
      resolve(e.data.positions);
    };

    w.addEventListener("message", handler);
    w.postMessage({
      nodes: nodes.map((n) => ({ id: n.id })),
      edges: edges.map((e) => ({ from: e.from, to: e.to })),
    });
  });
}
