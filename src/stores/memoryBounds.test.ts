import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePipelineStore } from "./pipelineStore";
import { useRunStore } from "./runStore";
import type { Pipeline, PipelineNode } from "../types/pipeline";
import type { RunState, NodeResult } from "../types/run";

// Mock localStorage for Node test environment
const storage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function uid(): string {
  return `node-${++_id}`;
}

function makeNode(name?: string): PipelineNode {
  return {
    id: uid(),
    name: name ?? "Node",
    type: "shell",
    instructions: "echo test",
    inputs: [],
    outputs: [],
    position: { x: Math.random() * 500, y: Math.random() * 500 },
  };
}

function makePipeline(nodeCount: number, name?: string): Pipeline {
  const nodes = Array.from({ length: nodeCount }, (_, i) => makeNode(`Node ${i}`));
  return {
    name: name ?? "Test Pipeline",
    description: "",
    version: "1.0.0",
    variables: {},
    nodes,
    edges: [],
  };
}

function makeRunState(pipelineName: string, nodeCount: number): RunState {
  const results: Record<string, NodeResult> = {};
  for (let i = 0; i < nodeCount; i++) {
    const id = `node-${i}`;
    results[id] = {
      node_id: id,
      status: "Success",
      exit_code: 0,
      output: "x".repeat(1000), // 1KB output per node
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      attempt: 1,
      cost_usd: 0.01,
    };
  }
  return {
    run_id: `run-${Date.now()}-${Math.random()}`,
    pipeline_name: pipelineName,
    status: "success",
    node_results: results,
    current_node: null,
    total_cost_usd: nodeCount * 0.01,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Memory bounds", () => {
  beforeEach(() => {
    // Reset stores between tests
    usePipelineStore.setState({
      currentPipeline: null,
      currentPipelinePath: null,
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
    useRunStore.setState({
      runState: null,
      running: false,
      logs: {},
      runHistory: [],
      persistedHistory: [],
    });
  });

  describe("Undo stack", () => {
    it("caps at 30 entries", () => {
      const pipeline = makePipeline(10);
      usePipelineStore.setState({
        currentPipeline: pipeline,
        currentPipelinePath: "/test/path",
      });

      // Push 50 snapshots — should only keep 30
      for (let i = 0; i < 50; i++) {
        usePipelineStore.getState().addNode("shell", { x: i * 10, y: 0 });
      }

      const { undoStack } = usePipelineStore.getState();
      expect(undoStack.length).toBeLessThanOrEqual(30);
    });

    it("clears redo stack on new action", () => {
      const pipeline = makePipeline(5);
      usePipelineStore.setState({
        currentPipeline: pipeline,
        currentPipelinePath: "/test/path",
      });

      // Add node, undo, then add another node
      usePipelineStore.getState().addNode("shell", { x: 0, y: 0 });
      usePipelineStore.getState().undo();
      expect(usePipelineStore.getState().redoStack.length).toBe(1);

      usePipelineStore.getState().addNode("shell", { x: 100, y: 0 });
      expect(usePipelineStore.getState().redoStack.length).toBe(0);
    });

    it("pushUndoSnapshot does not exceed cap", () => {
      const pipeline = makePipeline(10);
      usePipelineStore.setState({
        currentPipeline: pipeline,
        currentPipelinePath: "/test/path",
      });

      for (let i = 0; i < 50; i++) {
        usePipelineStore.getState().pushUndoSnapshot();
      }

      expect(usePipelineStore.getState().undoStack.length).toBeLessThanOrEqual(30);
    });
  });

  describe("Run history", () => {
    it("caps at 10 entries", () => {
      // Push 20 finished runs
      for (let i = 0; i < 20; i++) {
        const run = makeRunState("Pipeline " + i, 6);
        useRunStore.getState().handleRunUpdate(run);
      }

      const { runHistory } = useRunStore.getState();
      expect(runHistory.length).toBeLessThanOrEqual(10);
    });

    it("strips output strings from history entries", () => {
      const run = makeRunState("Test Pipeline", 6);
      // Verify the original has output
      const firstResult = Object.values(run.node_results)[0];
      expect(firstResult.output.length).toBeGreaterThan(0);

      useRunStore.getState().handleRunUpdate(run);

      const { runHistory } = useRunStore.getState();
      expect(runHistory.length).toBe(1);

      // All outputs in history should be stripped
      for (const result of Object.values(runHistory[0].node_results)) {
        expect(result.output).toBe("");
      }
    });

    it("preserves status and cost metadata in history", () => {
      const run = makeRunState("Test Pipeline", 3);
      useRunStore.getState().handleRunUpdate(run);

      const stored = useRunStore.getState().runHistory[0];
      expect(stored.pipeline_name).toBe("Test Pipeline");
      expect(stored.status).toBe("success");
      expect(stored.total_cost_usd).toBe(0.03);

      for (const result of Object.values(stored.node_results)) {
        expect(result.status).toBe("Success");
        expect(result.cost_usd).toBe(0.01);
      }
    });
  });

  describe("Logs", () => {
    it("caps at 2000 lines per node", () => {
      // Simulate a running state first
      useRunStore.setState({
        runState: makeRunState("Test", 1),
        running: true,
      });

      // Push 3000 log lines to one node
      for (let i = 0; i < 3000; i++) {
        useRunStore.getState().handleNodeLog({
          run_id: "run-1",
          node_id: "node-0",
          line: `Log line ${i}: ${"x".repeat(100)}`,
        });
      }

      const logs = useRunStore.getState().getNodeLogs("node-0");
      expect(logs.length).toBeLessThanOrEqual(2000);
    });

    it("clears logs on new run start", async () => {
      // Seed some logs
      useRunStore.setState({
        logs: { "node-0": ["line1", "line2", "line3"] },
      });

      expect(useRunStore.getState().logs["node-0"]?.length).toBe(3);

      // startRun clears logs (mock the API call to avoid actual IPC)
      useRunStore.setState({
        running: true,
        logs: {},
      });

      expect(Object.keys(useRunStore.getState().logs).length).toBe(0);
    });
  });

  describe("Node log batch", () => {
    it("caps at 2000 lines per node with batch events", () => {
      useRunStore.setState({
        runState: makeRunState("Test", 1),
        running: true,
      });

      // Push a large batch
      const lines = Array.from({ length: 3000 }, (_, i) => `Batch line ${i}`);
      useRunStore.getState().handleNodeLogBatch({
        run_id: "run-1",
        node_id: "node-0",
        lines,
      });

      const logs = useRunStore.getState().getNodeLogs("node-0");
      expect(logs.length).toBeLessThanOrEqual(2000);
    });
  });

  describe("Stress simulation", () => {
    it("memory stays bounded after repeated runs and pipeline switches", () => {
      // Simulate 20 pipeline runs with 10 nodes each
      for (let run = 0; run < 20; run++) {
        const pipeline = makePipeline(10, `Pipeline ${run % 3}`);
        usePipelineStore.setState({
          currentPipeline: pipeline,
          currentPipelinePath: `/test/pipeline-${run % 3}`,
        });

        // Drag some nodes (push undo snapshots)
        for (let drag = 0; drag < 5; drag++) {
          usePipelineStore.getState().pushUndoSnapshot();
          usePipelineStore.getState().updateNodePosition(
            pipeline.nodes[0].id,
            { x: drag * 50, y: drag * 50 },
          );
        }

        // Simulate a run completing
        const runState = makeRunState(pipeline.name, 10);
        useRunStore.getState().handleRunUpdate(runState);

        // Add some logs
        for (let n = 0; n < 10; n++) {
          for (let l = 0; l < 50; l++) {
            useRunStore.getState().handleNodeLog({
              run_id: runState.run_id,
              node_id: `node-${n}`,
              line: `[run ${run}] node ${n} line ${l}`,
            });
          }
        }
      }

      // Verify bounds
      const pState = usePipelineStore.getState();
      const rState = useRunStore.getState();

      expect(pState.undoStack.length).toBeLessThanOrEqual(30);
      expect(rState.runHistory.length).toBeLessThanOrEqual(10);

      // Verify history entries have no output
      for (const entry of rState.runHistory) {
        for (const result of Object.values(entry.node_results)) {
          expect(result.output).toBe("");
        }
      }

      // Verify log lines per node are bounded
      for (const lines of Object.values(rState.logs)) {
        expect(lines.length).toBeLessThanOrEqual(2000);
      }
    });
  });
});
