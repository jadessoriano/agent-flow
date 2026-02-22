import { bench, describe } from "vitest";
import { makeRunRow } from "./benchHelpers";
import type { RunRow } from "../types/run";

/**
 * Simulates the dedup + filter pattern used in RunHistory panel
 * when merging live runHistory with persisted DB history.
 */
function dedupAndFilter(
  liveHistory: RunRow[],
  persistedHistory: RunRow[],
  filterPipeline?: string,
): RunRow[] {
  const seen = new Set<string>();
  const merged: RunRow[] = [];

  // Live entries first (higher priority)
  for (const r of liveHistory) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  // Then persisted
  for (const r of persistedHistory) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  if (filterPipeline) {
    return merged.filter((r) => r.pipeline_name === filterPipeline);
  }

  return merged;
}

describe("runHistory dedup + filter", () => {
  for (const size of [50, 500, 1000]) {
    // 20% overlap between live and persisted
    const overlapCount = Math.floor(size * 0.2);
    const liveHistory = Array.from({ length: overlapCount }, (_, i) => makeRunRow(i));
    const persistedHistory = Array.from({ length: size }, (_, i) => makeRunRow(i));

    bench(`dedup / ${size} runs (no filter)`, () => {
      dedupAndFilter(liveHistory, persistedHistory);
    });

    bench(`dedup + filter / ${size} runs`, () => {
      dedupAndFilter(liveHistory, persistedHistory, "pipeline-0");
    });
  }
});
