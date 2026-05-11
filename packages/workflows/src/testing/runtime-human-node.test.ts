import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dispatchWorkflowHumanNode, json, SqliteWorkflowRunStore, text, validateWorkflow } from "../index.js";
import type { JsonSchema, WorkflowDefinition, WorkflowRun, WorkflowRuntimeEvent } from "../index.js";

const draftPort = json({
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
  additionalProperties: false,
});

const decisionSchema: JsonSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
};

const decisionPort = json(decisionSchema);

function createHumanWorkflow(): WorkflowDefinition {
  return {
    id: "test.human-node-dispatch",
    version: "1.0.0",
    input: draftPort,
    output: decisionPort,
    initial: "review",
    final: "review",
    nodes: {
      review: {
        kind: "human",
        prompt: "Review the draft before release.",
        input: draftPort,
        output: decisionPort,
        schema: decisionSchema,
        actions: [
          { id: "workflow.human.approve", kind: "approve" },
          { id: "workflow.human.reject", kind: "reject" },
          { id: "workflow.human.resume", kind: "resume" },
          { id: "workflow.human.cancel", kind: "cancel" },
        ],
        timeout: { kind: "minutes", value: 30 },
      },
    },
    edges: {},
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_human",
    workflowId: "test.human-node-dispatch",
    workflowVersion: "1.0.0",
    ownerScope: "user:human",
    status: "running",
    current: { nodeId: "review", status: "running" },
    input: { title: "Workflow waits", body: "Draft body" },
    state: { global: {} },
    createdAt: "2026-05-11T01:00:00.000Z",
    updatedAt: "2026-05-11T01:00:00.000Z",
  };
}

describe("workflow human node dispatch", () => {
  it("creates a durable wait token and moves the node and run to waiting", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-human-test-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const externalEvents: WorkflowRuntimeEvent[] = [];

    try {
      const definition = createHumanWorkflow();
      assert.equal(validateWorkflow(definition).ok, true);

      const result = await dispatchWorkflowHumanNode(
        definition,
        createRun(),
        "review",
        { title: "Workflow waits", body: "Draft body" },
        {
          store,
          now: () => "2026-05-11T01:00:01.000Z",
          createNodeAttemptId: () => "wna_human_review",
          createWaitTokenId: () => "wwt_human_review",
          emitEvent: (event) => {
            externalEvents.push(event);
          },
        },
      );

      assert.equal(result.ok, true);
      assert.equal(result.run.status, "waiting");
      assert.deepEqual(result.run.current, { nodeId: "review", status: "waiting" });
      assert.equal(result.nodeAttempt.status, "waiting");
      assert.equal(result.nodeAttempt.metadata?.waitTokenId, "wwt_human_review");
      assert.deepEqual(result.events.map((event) => event.type), ["node.started", "wait.created"]);
      assert.deepEqual(externalEvents, result.events);
      assert.deepEqual(result.waitToken, {
        id: "wwt_human_review",
        workflowRunId: "wfr_human",
        nodeAttemptId: "wna_human_review",
        humanNodeId: "review",
        actions: [
          { id: "workflow.human.approve", kind: "approve" },
          { id: "workflow.human.reject", kind: "reject" },
          { id: "workflow.human.resume", kind: "resume" },
          { id: "workflow.human.cancel", kind: "cancel" },
        ],
        prompt: "Review the draft before release.",
        schema: decisionSchema,
        status: "pending",
        createdAt: "2026-05-11T01:00:01.000Z",
        expiresAt: "2026-05-11T01:30:01.000Z",
      });
      assert.deepEqual(store.getRun("wfr_human"), result.run);
      assert.deepEqual(store.getWaitToken("wwt_human_review"), result.waitToken);
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      assert.deepEqual(reopened.getRun("wfr_human"), result.run);
      assert.deepEqual(reopened.getWaitToken("wwt_human_review"), result.waitToken);
      assert.deepEqual(reopened.listWaitTokens({ status: "pending" }), [result.waitToken]);
      reopened.close();
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed by the restart check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails before durable wait creation when the human node input is invalid", async () => {
    const store = new SqliteWorkflowRunStore(":memory:");

    try {
      const result = await dispatchWorkflowHumanNode(createHumanWorkflow(), createRun(), "review", "not a draft", {
        store,
        createNodeAttemptId: () => "wna_bad_human_input",
      });

      assert.equal(result.ok, false);
      assert.equal(result.run.status, "failed");
      assert.equal(result.nodeAttempt?.status, "failed");
      assert.equal(result.error.code, "WorkflowRuntimeError.humanNodeDispatchFailed");
      assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch"));
      assert.deepEqual(store.listWaitTokens(), []);
      assert.deepEqual(result.events.map((event) => event.type), ["node.started", "node.failed"]);
    } finally {
      store.close();
    }
  });

  it("rejects dispatching a non-human node", async () => {
    const store = new SqliteWorkflowRunStore(":memory:");
    const definition = createHumanWorkflow();
    definition.nodes.agent = {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: text(),
      output: text(),
    };

    try {
      const result = await dispatchWorkflowHumanNode(definition, createRun(), "agent", "hello", { store });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "WorkflowRuntimeError.humanNodeRequired");
      assert.equal(result.nodeAttempt, undefined);
      assert.deepEqual(store.listWaitTokens(), []);
    } finally {
      store.close();
    }
  });
});
