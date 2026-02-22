import { bench, describe } from "vitest";
import { makeRunState, makeNodeResult } from "./benchHelpers";
import type { RunState, RunStateDelta } from "../types/run";

/**
 * Extracted from runStore.ts — handleRunDelta merge logic
 */
function applyDelta(state: RunState, delta: RunStateDelta): RunState {
  return {
    ...state,
    status: delta.status ?? state.status,
    current_node: delta.current_node !== undefined ? delta.current_node : state.current_node,
    total_cost_usd: delta.total_cost_usd ?? state.total_cost_usd,
    node_results: delta.node_result
      ? { ...state.node_results, [delta.node_result.node_id]: delta.node_result }
      : state.node_results,
  };
}

/**
 * Apply a batch of deltas sequentially (simulates rapid node completions)
 */
function applyDeltaBatch(state: RunState, deltas: RunStateDelta[]): RunState {
  let current = state;
  for (const delta of deltas) {
    current = applyDelta(current, delta);
  }
  return current;
}

describe("runStore delta merging", () => {
  for (const nodeCount of [5, 20, 50, 200]) {
    const state = makeRunState(nodeCount);

    // Single delta with node_result update
    const singleDelta: RunStateDelta = {
      run_id: state.run_id,
      total_cost_usd: state.total_cost_usd + 0.01,
      node_result: makeNodeResult(`n${nodeCount - 1}`, { status: "Running" }),
    };

    bench(`single delta / ${nodeCount} nodes`, () => {
      applyDelta(state, singleDelta);
    });

    // Batch of deltas — every node completes sequentially
    const batchDeltas: RunStateDelta[] = Array.from({ length: nodeCount }, (_, i) => ({
      run_id: state.run_id,
      current_node: `n${i}`,
      total_cost_usd: (i + 1) * 0.005,
      node_result: makeNodeResult(`n${i}`, {
        status: "Success",
        cost_usd: 0.005,
      }),
    }));

    bench(`batch delta (${nodeCount}x) / ${nodeCount} nodes`, () => {
      applyDeltaBatch(state, batchDeltas);
    });

    // Status-only delta (no node_result, avoids node_results spread)
    const statusDelta: RunStateDelta = {
      run_id: state.run_id,
      status: "running",
      current_node: `n0`,
    };

    bench(`status-only delta / ${nodeCount} nodes`, () => {
      applyDelta(state, statusDelta);
    });
  }
});
