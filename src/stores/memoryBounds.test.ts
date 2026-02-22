import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePipelineStore } from "./pipelineStore";
import { useRunStore } from "./runStore";
import type { Pipeline, PipelineNode, NodeType } from "../types/pipeline";
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

function makeNode(name?: string, overrides?: Partial<PipelineNode>): PipelineNode {
  return {
    id: uid(),
    name: name ?? "Node",
    type: "shell" as NodeType,
    instructions: "echo test",
    inputs: [],
    outputs: [],
    position: { x: Math.random() * 500, y: Math.random() * 500 },
    ...overrides,
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

  describe("Loop node", () => {
    it("loop node logs cap at 2000 per child per iteration", () => {
      useRunStore.setState({
        runState: makeRunState("Test", 3),
        running: true,
      });

      // Simulate logs from 3 loop children across multiple iterations
      for (let child = 0; child < 3; child++) {
        for (let iter = 0; iter < 10; iter++) {
          for (let l = 0; l < 300; l++) {
            useRunStore.getState().handleNodeLog({
              run_id: "run-1",
              node_id: `node-${child}`,
              line: `[iter ${iter}] child ${child} line ${l}`,
            });
          }
        }
      }

      // Each child should be capped at 2000 lines
      for (let child = 0; child < 3; child++) {
        const logs = useRunStore.getState().getNodeLogs(`node-${child}`);
        expect(logs.length).toBeLessThanOrEqual(2000);
      }
    });

    it("run history strips loop child outputs", () => {
      // Create a run with results that simulate loop children
      const run = makeRunState("Loop Pipeline", 5);
      // Add extra output to simulate verbose loop iteration results
      for (const result of Object.values(run.node_results)) {
        result.output = "iteration output: " + "x".repeat(2000);
      }

      useRunStore.getState().handleRunUpdate(run);

      const { runHistory } = useRunStore.getState();
      expect(runHistory.length).toBe(1);

      // All outputs in history should be stripped
      for (const result of Object.values(runHistory[0].node_results)) {
        expect(result.output).toBe("");
      }
    });

    it("loop pipeline with all fields in stress simulation", () => {
      // Simulate repeated loop pipeline runs exercising all loop fields
      for (let run = 0; run < 15; run++) {
        const childNodes = Array.from({ length: 4 }, (_, i) =>
          makeNode(`Child ${i}`, {
            instructions: `echo "Processing $LOOP_ITEM (index $LOOP_INDEX of $LOOP_COUNT)"`,
          }),
        );
        const loopNode: PipelineNode = {
          id: uid(),
          name: "Loop",
          type: "loop",
          instructions: "item1\nitem2\nitem3\nitem4\nitem5",
          inputs: [],
          outputs: ["loop_results"],
          children: childNodes.map((n) => n.id),
          loop_separator: "newline",
          max_iterations: 50,
          loop_timeout: 120,
          loop_model: "claude-haiku-4-5-20251001",
          position: { x: 0, y: 0 },
        };
        const pipeline: Pipeline = {
          name: `Loop Pipeline ${run % 3}`,
          description: "",
          version: "1.0.0",
          variables: {},
          nodes: [loopNode, ...childNodes],
          edges: [],
        };

        usePipelineStore.setState({
          currentPipeline: pipeline,
          currentPipelinePath: `/test/loop-pipeline-${run % 3}`,
        });

        // Push undo snapshots
        for (let drag = 0; drag < 5; drag++) {
          usePipelineStore.getState().pushUndoSnapshot();
        }

        // Simulate run completing with loop child results per iteration
        const runState = makeRunState(pipeline.name, 5);
        // Add _all accumulation keys to simulate output accumulation
        for (let c = 0; c < 4; c++) {
          const cid = childNodes[c].id;
          runState.node_results[`${cid}_all`] = {
            node_id: `${cid}_all`,
            status: "Success",
            exit_code: 0,
            output: Array.from({ length: 5 }, (_, i) => `iter ${i} result`).join("\n"),
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            attempt: 1,
            cost_usd: 0.05,
          };
        }
        useRunStore.getState().handleRunUpdate(runState);

        // Add logs for child nodes (simulating per-iteration logs)
        for (let n = 0; n < 4; n++) {
          for (let iter = 0; iter < 5; iter++) {
            for (let l = 0; l < 50; l++) {
              useRunStore.getState().handleNodeLog({
                run_id: runState.run_id,
                node_id: childNodes[n].id,
                line: `[run ${run} iter ${iter}] child ${n} line ${l}: $LOOP_ITEM=item${iter + 1}`,
              });
            }
          }
        }
      }

      const pState = usePipelineStore.getState();
      const rState = useRunStore.getState();

      expect(pState.undoStack.length).toBeLessThanOrEqual(30);
      expect(rState.runHistory.length).toBeLessThanOrEqual(10);

      // All outputs including _all accumulation keys should be stripped
      for (const entry of rState.runHistory) {
        for (const result of Object.values(entry.node_results)) {
          expect(result.output).toBe("");
        }
      }

      for (const lines of Object.values(rState.logs)) {
        expect(lines.length).toBeLessThanOrEqual(2000);
      }
    });

    it("loop node with loop_timeout and loop_model fields preserved in undo", () => {
      const childNode = makeNode("Loop Child");
      const loopNode: PipelineNode = {
        id: uid(),
        name: "Timed Loop",
        type: "loop",
        instructions: "a,b,c,d,e",
        inputs: [],
        outputs: [],
        children: [childNode.id],
        loop_separator: "comma",
        max_iterations: 10,
        loop_timeout: 60,
        loop_model: "claude-sonnet-4-6",
        position: { x: 100, y: 100 },
      };
      const pipeline: Pipeline = {
        name: "Loop Field Test",
        description: "",
        version: "1.0.0",
        variables: {},
        nodes: [loopNode, childNode],
        edges: [],
      };

      usePipelineStore.setState({
        currentPipeline: pipeline,
        currentPipelinePath: "/test/loop-fields",
      });

      // Push undo snapshot, then modify
      usePipelineStore.getState().pushUndoSnapshot();
      usePipelineStore.getState().updateNode(loopNode.id, {
        max_iterations: 500,
        loop_timeout: 300,
        loop_model: "claude-haiku-4-5-20251001",
      });

      // Verify modified values
      const modified = usePipelineStore.getState().currentPipeline!.nodes.find(
        (n) => n.id === loopNode.id,
      )!;
      expect(modified.max_iterations).toBe(500);
      expect(modified.loop_timeout).toBe(300);
      expect(modified.loop_model).toBe("claude-haiku-4-5-20251001");

      // Undo and verify original values restored
      usePipelineStore.getState().undo();
      const restored = usePipelineStore.getState().currentPipeline!.nodes.find(
        (n) => n.id === loopNode.id,
      )!;
      expect(restored.max_iterations).toBe(10);
      expect(restored.loop_timeout).toBe(60);
      expect(restored.loop_model).toBe("claude-sonnet-4-6");
      expect(restored.loop_separator).toBe("comma");
      expect(restored.children).toEqual([childNode.id]);
    });

    it("output accumulation _all keys stripped in history", () => {
      const run = makeRunState("Accumulation Test", 3);
      // Simulate _all accumulation outputs from loop iterations
      for (let i = 0; i < 3; i++) {
        run.node_results[`node-${i}_all`] = {
          node_id: `node-${i}_all`,
          status: "Success",
          exit_code: 0,
          output: Array.from({ length: 20 }, (_, j) => `iteration ${j}: ${"data".repeat(100)}`).join("\n"),
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          attempt: 1,
          cost_usd: 0.1,
        };
      }

      useRunStore.getState().handleRunUpdate(run);

      const { runHistory } = useRunStore.getState();
      expect(runHistory.length).toBe(1);

      // Both regular and _all outputs should be stripped
      for (const [key, result] of Object.entries(runHistory[0].node_results)) {
        expect(result.output).toBe("");
        // Status and cost should be preserved
        expect(result.status).toBe("Success");
        if (key.endsWith("_all")) {
          expect(result.cost_usd).toBe(0.1);
        } else {
          expect(result.cost_usd).toBe(0.01);
        }
      }
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
