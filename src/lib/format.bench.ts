import { bench, describe } from "vitest";
import { formatMs, formatDuration, clearDurationCache } from "./format";

describe("formatMs", () => {
  const values = [42, 999, 1500, 15000, 90000, 3600000, 7261000];

  bench("formatMs / 7 mixed values", () => {
    for (const v of values) {
      formatMs(v);
    }
  });
});

describe("formatDuration", () => {
  const pairs = Array.from({ length: 100 }, (_, i) => {
    const start = new Date(2026, 0, 1, 0, 0, i).toISOString();
    const end = new Date(2026, 0, 1, 0, i + 1, i * 2).toISOString();
    return [start, end] as const;
  });

  bench("formatDuration / cold (100 unique pairs)", () => {
    clearDurationCache();
    for (const [s, e] of pairs) {
      formatDuration(s, e);
    }
  });

  bench("formatDuration / warm (100 cached pairs)", () => {
    // Cache is already warm from the cold run above
    for (const [s, e] of pairs) {
      formatDuration(s, e);
    }
  });

  bench("formatDuration / mixed (100 keys, half hits)", () => {
    clearDurationCache();
    // Populate half the cache
    for (let i = 0; i < 50; i++) {
      formatDuration(pairs[i][0], pairs[i][1]);
    }
    // Now access all 100 (50 hits + 50 misses)
    for (const [s, e] of pairs) {
      formatDuration(s, e);
    }
  });
});
