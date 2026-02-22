import { bench, describe } from "vitest";
import { makeLinearPipeline } from "./benchHelpers";

describe("pipeline clone strategies", () => {
  for (const size of [5, 50, 200]) {
    const pipeline = makeLinearPipeline(size);

    bench(`structuredClone / ${size} nodes`, () => {
      structuredClone(pipeline);
    });

    bench(`JSON round-trip / ${size} nodes`, () => {
      JSON.parse(JSON.stringify(pipeline));
    });

    bench(`spread (shallow) / ${size} nodes`, () => {
      ({
        ...pipeline,
        nodes: pipeline.nodes.map((n) => ({ ...n })),
        edges: pipeline.edges.map((e) => ({ ...e })),
      });
    });
  }
});
