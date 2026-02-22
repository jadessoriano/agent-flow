import { describe, it, expect } from "vitest";
import { validatePipeline, type ValidationError } from "./validatePipeline";
import type { Pipeline, PipelineNode, PipelineEdge } from "../types/pipeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function uid(): string {
  return `node-${++_id}`;
}

function makeNode(overrides: Partial<PipelineNode> & { id?: string; name?: string; type?: PipelineNode["type"] }): PipelineNode {
  return {
    id: overrides.id ?? uid(),
    name: overrides.name ?? "Unnamed",
    type: overrides.type ?? "ai-task",
    instructions: overrides.instructions ?? "do something",
    inputs: overrides.inputs ?? [],
    outputs: overrides.outputs ?? [],
    position: overrides.position ?? { x: 0, y: 0 },
    ...overrides,
  };
}

function makeEdge(from: string, to: string, condition?: string): PipelineEdge {
  return { id: `${from}->${to}`, from, to, condition };
}

function makePipeline(nodes: PipelineNode[], edges: PipelineEdge[]): Pipeline {
  return {
    name: "test-pipeline",
    description: "",
    version: "1.0",
    variables: {},
    nodes,
    edges,
  };
}

function errorMessages(errors: ValidationError[]): string[] {
  return errors.map((e) => e.message);
}

function errorsBySeverity(errors: ValidationError[], severity: "error" | "warning"): ValidationError[] {
  return errors.filter((e) => e.severity === severity);
}

// ---------------------------------------------------------------------------
// 1. Disconnected nodes
// ---------------------------------------------------------------------------

describe("disconnected nodes", () => {
  it("should not warn when a single node has no edges", () => {
    const a = makeNode({ name: "Only" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "warning")).toHaveLength(0);
  });

  it("should warn when a node has no incoming or outgoing edges in a multi-node pipeline", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    const errors = validatePipeline(makePipeline([a, b, c], [makeEdge(a.id, b.id)]));
    const warnings = errorsBySeverity(errors, "warning");
    expect(warnings.some((w) => w.message.includes('"C"'))).toBe(true);
    expect(warnings.some((w) => w.nodeId === c.id)).toBe(true);
  });

  it("should skip comment nodes even if disconnected", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const comment = makeNode({ name: "Note", type: "comment" });
    const errors = validatePipeline(makePipeline([a, b, comment], [makeEdge(a.id, b.id)]));
    expect(errors.some((e) => e.nodeId === comment.id)).toBe(false);
  });

  it("should not warn when all nodes are connected", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const errors = validatePipeline(makePipeline([a, b], [makeEdge(a.id, b.id)]));
    expect(errorsBySeverity(errors, "warning")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty instructions
// ---------------------------------------------------------------------------

describe("empty instructions", () => {
  it("should error when ai-task node has empty instructions", () => {
    const a = makeNode({ name: "Empty AI", type: "ai-task", instructions: "" });
    const errors = validatePipeline(makePipeline([a], []));
    const blockers = errorsBySeverity(errors, "error");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain('"Empty AI"');
    expect(blockers[0].nodeId).toBe(a.id);
  });

  it("should error when shell node has whitespace-only instructions", () => {
    const a = makeNode({ name: "Blank Shell", type: "shell", instructions: "   " });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(1);
  });

  it("should error when git node has empty instructions", () => {
    const a = makeNode({ name: "Git", type: "git", instructions: "" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(1);
  });

  it("should not error when parallel node has empty instructions", () => {
    const a = makeNode({ name: "Group", type: "parallel", instructions: "" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
  });

  it("should not error when comment node has empty instructions", () => {
    const a = makeNode({ name: "Note", type: "comment", instructions: "" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
  });

  it("should not error when approval-gate has empty instructions", () => {
    const a = makeNode({ name: "Gate", type: "approval-gate", instructions: "" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
  });

  it("should not error when instructions are non-empty", () => {
    const a = makeNode({ name: "OK", type: "ai-task", instructions: "Fix the bug" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Cycle detection
// ---------------------------------------------------------------------------

describe("cycle detection", () => {
  it("should detect a simple cycle (A -> B -> A)", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const errors = validatePipeline(
      makePipeline([a, b], [makeEdge(a.id, b.id), makeEdge(b.id, a.id)]),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should detect a longer cycle (A -> B -> C -> A)", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [makeEdge(a.id, b.id), makeEdge(b.id, c.id), makeEdge(c.id, a.id)],
      ),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should not flag a linear pipeline as a cycle", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    const errors = validatePipeline(
      makePipeline([a, b, c], [makeEdge(a.id, b.id), makeEdge(b.id, c.id)]),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should exclude conditional (success) back-edges from cycle detection", () => {
    const a = makeNode({ name: "Run Tests" });
    const b = makeNode({ name: "Fix Failures" });
    // Normal forward edge
    const fwd = makeEdge(a.id, b.id);
    // Conditional back-edge (retry on failure)
    const back = makeEdge(b.id, a.id, "failure");
    const errors = validatePipeline(makePipeline([a, b], [fwd, back]));
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should exclude conditional (failure) back-edges from cycle detection", () => {
    const a = makeNode({ name: "Deploy" });
    const b = makeNode({ name: "Rollback" });
    const errors = validatePipeline(
      makePipeline(
        [a, b],
        [makeEdge(a.id, b.id), makeEdge(b.id, a.id, "failure")],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should still detect a cycle when only unconditional edges form it", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    // A -> B (normal), B -> C (normal), C -> A (normal) = cycle
    // Plus a separate conditional edge that isn't part of the cycle
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, c.id),
          makeEdge(c.id, a.id), // unconditional back-edge = real cycle
          makeEdge(c.id, b.id, "failure"), // this conditional one is fine
        ],
      ),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });
});

// ---------------------------------------------------------------------------
// 3b. Self-reference loops
// ---------------------------------------------------------------------------

describe("self-reference loops", () => {
  it("should detect an unconditional self-loop (A -> A)", () => {
    const a = makeNode({ name: "Stuck" });
    const errors = validatePipeline(
      makePipeline([a], [makeEdge(a.id, a.id)]),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow a conditional self-loop (retry on self with failure condition)", () => {
    const a = makeNode({ name: "Retry Self" });
    const errors = validatePipeline(
      makePipeline([a], [makeEdge(a.id, a.id, "failure")]),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow a conditional self-loop with success condition", () => {
    const a = makeNode({ name: "Loop Until Done" });
    const errors = validatePipeline(
      makePipeline([a], [makeEdge(a.id, a.id, "success")]),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should detect self-loop when node also has other edges", () => {
    const a = makeNode({ name: "Start" });
    const b = makeNode({ name: "Self Loop" });
    const c = makeNode({ name: "End" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, b.id),  // unconditional self-loop
          makeEdge(b.id, c.id),
        ],
      ),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });
});

// ---------------------------------------------------------------------------
// 3c. Retry patterns & conditional edge handling
// ---------------------------------------------------------------------------

describe("retry patterns and conditional edges", () => {
  it("should allow retry loop: A -> B -> C, C -> A on failure (2-hop back)", () => {
    const a = makeNode({ name: "Build" });
    const b = makeNode({ name: "Test" });
    const c = makeNode({ name: "Evaluate" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, c.id),
          makeEdge(c.id, a.id, "failure"),  // retry from end to start
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow multiple retry targets from same node", () => {
    // C can retry to either A or B depending on condition
    const a = makeNode({ name: "Fetch" });
    const b = makeNode({ name: "Process" });
    const c = makeNode({ name: "Validate" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, c.id),
          makeEdge(c.id, a.id, "failure"),   // retry from scratch
          makeEdge(c.id, b.id, "success"),   // re-process on partial success
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow all-conditional cycle (every edge has a condition)", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    // All edges are conditional — no unconditional cycle exists
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [
          makeEdge(a.id, b.id, "success"),
          makeEdge(b.id, c.id, "success"),
          makeEdge(c.id, a.id, "failure"),
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow custom condition strings (not just success/failure)", () => {
    const a = makeNode({ name: "Check" });
    const b = makeNode({ name: "Retry" });
    const errors = validatePipeline(
      makePipeline(
        [a, b],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, a.id, "needs-review"),  // custom condition
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow parallel retry: multiple nodes retry to same target via conditions", () => {
    const start = makeNode({ name: "Start" });
    const a = makeNode({ name: "Path A" });
    const b = makeNode({ name: "Path B" });
    const check = makeNode({ name: "Check" });
    const errors = validatePipeline(
      makePipeline(
        [start, a, b, check],
        [
          makeEdge(start.id, a.id),
          makeEdge(start.id, b.id),
          makeEdge(a.id, check.id),
          makeEdge(b.id, check.id),
          makeEdge(check.id, a.id, "failure"),   // retry path A
          makeEdge(check.id, b.id, "failure"),   // retry path B
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should detect cycle when unconditional edges form loop alongside conditional edges", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const errors = validatePipeline(
      makePipeline(
        [a, b],
        [
          makeEdge(a.id, b.id),            // unconditional forward
          makeEdge(b.id, a.id),            // unconditional back = CYCLE
          makeEdge(b.id, a.id, "failure"), // conditional back (fine but irrelevant)
        ],
      ),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow complex retry chain: A -> B -> C -> D, D retries to B on failure", () => {
    const a = makeNode({ name: "Init" });
    const b = makeNode({ name: "Build" });
    const c = makeNode({ name: "Test" });
    const d = makeNode({ name: "Deploy" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c, d],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, c.id),
          makeEdge(c.id, d.id),
          makeEdge(d.id, b.id, "failure"),  // retry mid-pipeline
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should allow nested retry loops at different levels", () => {
    // A -> B -> C -> D
    // C retries to B (inner loop), D retries to A (outer loop)
    const a = makeNode({ name: "Fetch" });
    const b = makeNode({ name: "Parse" });
    const c = makeNode({ name: "Validate" });
    const d = makeNode({ name: "Store" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c, d],
        [
          makeEdge(a.id, b.id),
          makeEdge(b.id, c.id),
          makeEdge(c.id, d.id),
          makeEdge(c.id, b.id, "failure"),   // inner retry
          makeEdge(d.id, a.id, "failure"),   // outer retry
        ],
      ),
    );
    expect(errorMessages(errors)).not.toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });

  it("should detect cycle in isolated subgraph even with valid main path", () => {
    // Main path: A -> B (fine)
    // Isolated: C -> D -> C (unconditional cycle, disconnected from main)
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    const d = makeNode({ name: "D" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c, d],
        [
          makeEdge(a.id, b.id),
          makeEdge(c.id, d.id),
          makeEdge(d.id, c.id),
        ],
      ),
    );
    expect(errorMessages(errors)).toContain(
      "Pipeline contains a cycle — nodes cannot reference each other in a loop",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Missing pipeline_ref on sub-pipeline nodes
// ---------------------------------------------------------------------------

describe("sub-pipeline validation", () => {
  it("should error when sub-pipeline node has no pipeline_ref", () => {
    const a = makeNode({ name: "SubP", type: "sub-pipeline", pipeline_ref: undefined });
    const errors = validatePipeline(makePipeline([a], []));
    const blockers = errorsBySeverity(errors, "error");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain('"SubP"');
    expect(blockers[0].message).toContain("no pipeline selected");
  });

  it("should not error when sub-pipeline node has a pipeline_ref", () => {
    const a = makeNode({ name: "SubP", type: "sub-pipeline", pipeline_ref: "other.pipeline.json" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
  });

  it("should error with empty string pipeline_ref", () => {
    const a = makeNode({ name: "SubP", type: "sub-pipeline", pipeline_ref: "" });
    const errors = validatePipeline(makePipeline([a], []));
    expect(errorsBySeverity(errors, "error")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Dead-end detection
// ---------------------------------------------------------------------------

describe("dead-end detection", () => {
  it("should not warn when there is exactly one terminal node", () => {
    const a = makeNode({ name: "Start" });
    const b = makeNode({ name: "End" });
    const errors = validatePipeline(
      makePipeline([a, b], [makeEdge(a.id, b.id)]),
    );
    expect(errorsBySeverity(errors, "warning")).toHaveLength(0);
  });

  it("should warn when there are multiple terminal nodes", () => {
    const a = makeNode({ name: "Start" });
    const b = makeNode({ name: "DeadEnd1" });
    const c = makeNode({ name: "DeadEnd2" });
    const errors = validatePipeline(
      makePipeline(
        [a, b, c],
        [makeEdge(a.id, b.id), makeEdge(a.id, c.id)],
      ),
    );
    const warnings = errorsBySeverity(errors, "warning");
    expect(warnings.length).toBe(2);
    expect(warnings.some((w) => w.message.includes('"DeadEnd1"'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('"DeadEnd2"'))).toBe(true);
  });

  it("should skip comment nodes from dead-end analysis", () => {
    const a = makeNode({ name: "Start" });
    const b = makeNode({ name: "End" });
    const comment = makeNode({ name: "Note", type: "comment" });
    const errors = validatePipeline(
      makePipeline([a, b, comment], [makeEdge(a.id, b.id)]),
    );
    expect(errors.some((e) => e.nodeId === comment.id)).toBe(false);
  });

  it("should not flag a source node (no incoming) as a dead end", () => {
    const a = makeNode({ name: "Source" });
    const b = makeNode({ name: "Middle" });
    const c = makeNode({ name: "End" });
    const errors = validatePipeline(
      makePipeline([a, b, c], [makeEdge(a.id, b.id), makeEdge(b.id, c.id)]),
    );
    // Source has outgoing but no incoming — should not be flagged
    expect(errors.some((w) => w.nodeId === a.id && w.severity === "warning")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5b. Dead-end detection: parallel groups
// ---------------------------------------------------------------------------

describe("dead-end detection for parallel groups", () => {
  it("should NOT flag a parallel group as dead end when its children have outgoing edges", () => {
    // Mimics ticket-to-pr: parallel group -> children -> downstream
    const parallelGroup = makeNode({
      name: "Run Tests",
      type: "parallel",
      instructions: "",
      children: ["child-1", "child-2"],
    });
    const child1 = makeNode({ id: "child-1", name: "Backend Tests", type: "shell" });
    const child2 = makeNode({ id: "child-2", name: "Frontend Tests", type: "shell" });
    const downstream = makeNode({ name: "Fix Failures" });
    const report = makeNode({ name: "Report Results" });

    // Realistic: start -> parallel group, children -> fix-failures, fix-failures -> report
    const start = makeNode({ name: "Start" });
    const pipeline = makePipeline(
      [start, parallelGroup, child1, child2, downstream, report],
      [
        makeEdge(start.id, parallelGroup.id),
        // Children have outgoing edges
        makeEdge(child1.id, downstream.id),
        makeEdge(child2.id, downstream.id),
        makeEdge(downstream.id, report.id),
      ],
    );

    const errors = validatePipeline(pipeline);
    const warnings = errorsBySeverity(errors, "warning");
    // The parallel group should NOT be flagged as a dead end
    expect(warnings.some((w) => w.nodeId === parallelGroup.id && w.message.includes("dead end"))).toBe(false);
  });

  it("should flag a parallel group as dead end when neither it nor its children have outgoing edges", () => {
    const parallelGroup = makeNode({
      name: "Run Tests",
      type: "parallel",
      instructions: "",
      children: ["child-1", "child-2"],
    });
    const child1 = makeNode({ id: "child-1", name: "Backend Tests", type: "shell" });
    const child2 = makeNode({ id: "child-2", name: "Frontend Tests", type: "shell" });
    const start = makeNode({ name: "Start" });
    const otherEnd = makeNode({ name: "Other End" });

    const pipeline = makePipeline(
      [start, parallelGroup, child1, child2, otherEnd],
      [
        makeEdge(start.id, parallelGroup.id),
        makeEdge(start.id, otherEnd.id),
        // No outgoing edges from children or from the group itself
      ],
    );

    const errors = validatePipeline(pipeline);
    const warnings = errorsBySeverity(errors, "warning");
    // Both parallelGroup and otherEnd are terminal, so both flagged
    expect(warnings.some((w) => w.nodeId === parallelGroup.id)).toBe(true);
    expect(warnings.some((w) => w.nodeId === otherEnd.id)).toBe(true);
  });

  it("should not flag parallel group when only some children have outgoing edges", () => {
    const parallelGroup = makeNode({
      name: "Run Tests",
      type: "parallel",
      instructions: "",
      children: ["child-1", "child-2"],
    });
    const child1 = makeNode({ id: "child-1", name: "Backend Tests", type: "shell" });
    const child2 = makeNode({ id: "child-2", name: "Frontend Tests", type: "shell" });
    const start = makeNode({ name: "Start" });
    const next = makeNode({ name: "Next" });

    const pipeline = makePipeline(
      [start, parallelGroup, child1, child2, next],
      [
        makeEdge(start.id, parallelGroup.id),
        // Only child1 has outgoing edge
        makeEdge(child1.id, next.id),
      ],
    );

    const errors = validatePipeline(pipeline);
    const warnings = errorsBySeverity(errors, "warning");
    // Parallel group should NOT be flagged (at least one child has outgoing)
    expect(warnings.some((w) => w.nodeId === parallelGroup.id && w.message.includes("dead end"))).toBe(false);
  });

  it("should handle parallel group with empty children array", () => {
    const parallelGroup = makeNode({
      name: "Empty Group",
      type: "parallel",
      instructions: "",
      children: [],
    });
    const start = makeNode({ name: "Start" });
    const otherEnd = makeNode({ name: "Other End" });

    const pipeline = makePipeline(
      [start, parallelGroup, otherEnd],
      [
        makeEdge(start.id, parallelGroup.id),
        makeEdge(start.id, otherEnd.id),
      ],
    );

    const errors = validatePipeline(pipeline);
    const warnings = errorsBySeverity(errors, "warning");
    // No children with edges, so group is a dead end (along with otherEnd)
    expect(warnings.some((w) => w.nodeId === parallelGroup.id)).toBe(true);
  });

  it("should handle parallel group with undefined children", () => {
    const parallelGroup = makeNode({
      name: "No Children",
      type: "parallel",
      instructions: "",
      // children is undefined
    });
    const start = makeNode({ name: "Start" });
    const otherEnd = makeNode({ name: "Other End" });

    const pipeline = makePipeline(
      [start, parallelGroup, otherEnd],
      [
        makeEdge(start.id, parallelGroup.id),
        makeEdge(start.id, otherEnd.id),
      ],
    );

    const errors = validatePipeline(pipeline);
    const warnings = errorsBySeverity(errors, "warning");
    expect(warnings.some((w) => w.nodeId === parallelGroup.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Realistic pipeline scenarios
// ---------------------------------------------------------------------------

describe("realistic pipeline: ticket-to-pr", () => {
  // Mimics the actual ticket-to-pr pipeline structure
  it("should have no errors or warnings for a well-formed ticket-to-pr pipeline", () => {
    const readTicket = makeNode({ id: "read-ticket", name: "Read Ticket", type: "ai-task" });
    const planImpl = makeNode({ id: "plan-impl", name: "Plan Implementation", type: "ai-task" });
    const approval = makeNode({ id: "approval", name: "Review Plan", type: "approval-gate", instructions: "" });
    const implement = makeNode({ id: "implement", name: "Implement Changes", type: "ai-task" });
    const runTests = makeNode({
      id: "run-tests",
      name: "Run Tests",
      type: "parallel",
      instructions: "",
      children: ["run-backend-tests", "run-frontend-tests"],
    });
    const backendTests = makeNode({ id: "run-backend-tests", name: "Backend Tests", type: "shell" });
    const frontendTests = makeNode({ id: "run-frontend-tests", name: "Frontend Tests", type: "shell" });
    const fixFailures = makeNode({ id: "fix-failures", name: "Fix Failures", type: "ai-task" });
    const reportResults = makeNode({ id: "report-results", name: "Report Results", type: "ai-task" });

    const pipeline = makePipeline(
      [readTicket, planImpl, approval, implement, runTests, backendTests, frontendTests, fixFailures, reportResults],
      [
        makeEdge("read-ticket", "plan-impl"),
        makeEdge("plan-impl", "approval"),
        makeEdge("approval", "implement"),
        makeEdge("implement", "run-tests"),
        // Children have outgoing to fix-failures
        makeEdge("run-backend-tests", "fix-failures"),
        makeEdge("run-frontend-tests", "fix-failures"),
        // Fix failures -> report (on success) and back to run-tests (on failure)
        makeEdge("fix-failures", "report-results"),
        makeEdge("fix-failures", "run-tests", "failure"), // retry loop
      ],
    );

    const errors = validatePipeline(pipeline);
    expect(errorsBySeverity(errors, "error")).toHaveLength(0);
    expect(errorsBySeverity(errors, "warning")).toHaveLength(0);
  });
});

describe("realistic pipeline: simple linear", () => {
  it("should pass validation for A -> B -> C with no issues", () => {
    const a = makeNode({ name: "Fetch Data", type: "shell" });
    const b = makeNode({ name: "Process", type: "ai-task" });
    const c = makeNode({ name: "Output", type: "shell" });

    const errors = validatePipeline(
      makePipeline([a, b, c], [makeEdge(a.id, b.id), makeEdge(b.id, c.id)]),
    );
    expect(errors).toHaveLength(0);
  });
});

describe("realistic pipeline: diamond with approval gate", () => {
  it("should pass validation for diamond-shaped pipeline", () => {
    const start = makeNode({ name: "Start", type: "ai-task" });
    const left = makeNode({ name: "Left Branch", type: "shell" });
    const right = makeNode({ name: "Right Branch", type: "shell" });
    const gate = makeNode({ name: "Approve", type: "approval-gate", instructions: "" });
    const end = makeNode({ name: "Deploy", type: "shell" });

    const errors = validatePipeline(
      makePipeline(
        [start, left, right, gate, end],
        [
          makeEdge(start.id, left.id),
          makeEdge(start.id, right.id),
          makeEdge(left.id, gate.id),
          makeEdge(right.id, gate.id),
          makeEdge(gate.id, end.id),
        ],
      ),
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("should handle an empty pipeline with no nodes", () => {
    const errors = validatePipeline(makePipeline([], []));
    expect(errors).toHaveLength(0);
  });

  it("should handle multiple validation errors at once", () => {
    const emptyAi = makeNode({ name: "Empty", type: "ai-task", instructions: "" });
    const subNoRef = makeNode({ name: "Sub", type: "sub-pipeline", pipeline_ref: undefined, instructions: "" });
    const disconnected = makeNode({ name: "Lone", type: "shell" });

    const errors = validatePipeline(
      makePipeline(
        [emptyAi, subNoRef, disconnected],
        [makeEdge(emptyAi.id, subNoRef.id)],
      ),
    );
    // Should have: empty instructions on emptyAi, no pipeline_ref on subNoRef, disconnected on disconnected
    expect(errorsBySeverity(errors, "error").length).toBeGreaterThanOrEqual(2);
    expect(errorsBySeverity(errors, "warning").length).toBeGreaterThanOrEqual(1);
  });

  it("should include nodeId on all node-specific errors", () => {
    const a = makeNode({ name: "Empty", type: "ai-task", instructions: "" });
    const b = makeNode({ name: "Sub", type: "sub-pipeline", pipeline_ref: undefined, instructions: "" });
    const errors = validatePipeline(makePipeline([a, b], [makeEdge(a.id, b.id)]));
    for (const err of errors) {
      if (err.message.includes("cycle")) continue; // cycle errors are pipeline-level
      expect(err.nodeId).toBeDefined();
    }
  });

  it("should not flag the only terminal node as a dead end even with complex upstream", () => {
    const a = makeNode({ name: "A" });
    const b = makeNode({ name: "B" });
    const c = makeNode({ name: "C" });
    const d = makeNode({ name: "Terminal" });
    // A -> B -> D, A -> C -> D (diamond, single terminal)
    const errors = validatePipeline(
      makePipeline(
        [a, b, c, d],
        [makeEdge(a.id, b.id), makeEdge(a.id, c.id), makeEdge(b.id, d.id), makeEdge(c.id, d.id)],
      ),
    );
    expect(errorsBySeverity(errors, "warning")).toHaveLength(0);
  });
});
