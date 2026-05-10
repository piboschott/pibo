import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { json, recordWorkflowEdgeTransfer, text, transferWorkflowEdgeData } from "../index.js";
import type {
  NodeAttempt,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowRunStore,
} from "../index.js";

function createTwoNodeWorkflow(): WorkflowDefinition {
  return {
    id: "test.two-node-transfer",
    version: "1.0.0",
    title: "Two node transfer test workflow",
    input: text(),
    output: text(),
    initial: "draft",
    final: "review",
    nodes: {
      draft: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: text(),
      },
      review: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: text(),
      },
    },
    edges: {
      "draft-to-review": {
        id: "draft-to-review",
        from: { nodeId: "draft" },
        to: { nodeId: "review" },
        kind: "data",
      },
    },
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_edge_transfer",
    workflowId: "test.two-node-transfer",
    workflowVersion: "1.0.0",
    ownerScope: "user:test",
    status: "running",
    current: { nodeId: "draft", status: "running" },
    input: "Start here.",
    state: { global: {} },
    createdAt: "2026-05-10T23:20:00.000Z",
    updatedAt: "2026-05-10T23:20:00.000Z",
  };
}

function createSourceAttempt(overrides: Partial<NodeAttempt> = {}): NodeAttempt {
  return {
    id: "wna_draft",
    workflowRunId: "wfr_edge_transfer",
    nodeId: "draft",
    attempt: 1,
    kind: "agent",
    status: "completed",
    input: "Start here.",
    output: "Draft output for review.",
    startedAt: "2026-05-10T23:20:01.000Z",
    completedAt: "2026-05-10T23:20:02.000Z",
    ...overrides,
  };
}

describe("workflow edge data transfer", () => {
  it("creates a transferred edge payload from a completed source node output", () => {
    const definition = createTwoNodeWorkflow();
    const result = transferWorkflowEdgeData(definition, createRun(), "draft-to-review", createSourceAttempt(), {
      now: () => "2026-05-10T23:20:03.000Z",
      createEdgeTransferId: () => "wet_draft_to_review",
    });

    assert.equal(result.ok, true);
    assert.equal(result.targetInput, "Draft output for review.");
    assert.deepEqual(result.transfer, {
      id: "wet_draft_to_review",
      workflowRunId: "wfr_edge_transfer",
      edgeId: "draft-to-review",
      sourceNodeAttemptId: "wna_draft",
      targetNodeId: "review",
      status: "transferred",
      payload: "Draft output for review.",
      createdAt: "2026-05-10T23:20:03.000Z",
    });
  });

  it("records an edge transfer event and advances the workflow run cursor", async () => {
    const definition = createTwoNodeWorkflow();
    const run = createRun();
    const events: WorkflowRuntimeEvent[] = [];
    const emittedEvents: WorkflowRuntimeEvent[] = [];
    const savedRuns: WorkflowRun[] = [];
    const store: WorkflowRunStore = {
      saveRun(savedRun) {
        savedRuns.push(structuredClone(savedRun));
      },
      getRun(id) {
        return savedRuns.find((savedRun) => savedRun.id === id);
      },
    };

    const result = await recordWorkflowEdgeTransfer(
      definition,
      run,
      "draft-to-review",
      createSourceAttempt(),
      {
        now: () => "2026-05-10T23:20:03.000Z",
        createEdgeTransferId: () => "wet_draft_to_review",
        events,
        emitEvent: (event) => {
          emittedEvents.push(event);
        },
        store,
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.events, [
      {
        type: "edge.transferred",
        runId: "wfr_edge_transfer",
        edgeTransferId: "wet_draft_to_review",
        edgeId: "draft-to-review",
      },
    ]);
    assert.deepEqual(emittedEvents, result.events);
    assert.deepEqual(run.current, { edgeId: "draft-to-review", status: "running" });
    assert.equal(run.updatedAt, "2026-05-10T23:20:03.000Z");
    assert.equal(savedRuns.length, 1);
    assert.deepEqual(savedRuns[0]?.current, { edgeId: "draft-to-review", status: "running" });
  });

  it("does not record an event when edge transfer validation fails", async () => {
    const run = createRun();
    const originalCursor = structuredClone(run.current);
    const result = await recordWorkflowEdgeTransfer(
      createTwoNodeWorkflow(),
      run,
      "draft-to-review",
      createSourceAttempt({ status: "running" }),
      {
        emitEvent() {
          throw new Error("failed transfers should not emit events");
        },
      },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.events, []);
    assert.deepEqual(run.current, originalCursor);
  });

  it("validates target node input before transferring the payload", () => {
    const definition = createTwoNodeWorkflow();
    definition.nodes.review.input = json({
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    });

    const result = transferWorkflowEdgeData(definition, createRun(), "draft-to-review", createSourceAttempt());

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidEdgePayload");
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch" && diagnostic.edgeId === "draft-to-review",
      ),
    );
  });

  it("rejects edge transfer before the source attempt has completed output", () => {
    const sourceAttempt = createSourceAttempt({ status: "running" });
    delete sourceAttempt.output;

    const result = transferWorkflowEdgeData(createTwoNodeWorkflow(), createRun(), "draft-to-review", sourceAttempt);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.edgeTransferFailed");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.sourceAttemptIncomplete"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.sourceOutputMissing"));
  });
});
