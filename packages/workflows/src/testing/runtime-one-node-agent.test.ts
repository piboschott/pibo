import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimalOneNodePiboAgentWorkflowFixture,
  runOneNodeAgentWorkflow,
  validateOneNodeAgentWorkflowPath,
} from "../index.js";
import type { WorkflowDefinition } from "../index.js";

function cloneMinimalWorkflow(): WorkflowDefinition {
  return structuredClone(minimalOneNodePiboAgentWorkflowFixture) as WorkflowDefinition;
}

describe("one-node agent workflow runtime path", () => {
  it("runs a minimal pibo-agent workflow from input to completion", async () => {
    const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Explain workflow runs.", {
      ownerScope: "user:test",
      now: () => "2026-05-10T22:55:00.000Z",
      createRunId: () => "wfr_test",
      createNodeAttemptId: () => "wna_test",
      agentExecutor: (context) => {
        assert.equal(context.profileId, "pibo-agent");
        assert.equal(
          context.prompt,
          "Answer the user request using normal Pibo Runtime routing: Explain workflow runs.",
        );

        return {
          output: "Workflow runs execute nodes and validate outputs.",
          piboSessionId: "ps_test",
          piSessionId: "pi_test",
          effectiveProfile: "pibo-agent",
          effectiveTools: ["read"],
          effectiveSkills: ["workflow-test"],
          effectiveContextFiles: ["AGENTS.md"],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Workflow runs execute nodes and validate outputs.");
    assert.equal(result.run.id, "wfr_test");
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.output, "Workflow runs execute nodes and validate outputs.");
    assert.equal(result.nodeAttempt.id, "wna_test");
    assert.equal(result.nodeAttempt.status, "completed");
    assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "pibo-agent");
    assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_test");
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["workflow.started", "node.started", "node.completed", "workflow.completed"],
    );
  });

  it("rejects workflows outside the one-node agent shape", () => {
    const definition = cloneMinimalWorkflow();
    definition.edges = {
      extra: {
        id: "extra",
        from: { nodeId: "answer" },
        to: { nodeId: "answer" },
      },
    };

    const result = validateOneNodeAgentWorkflowPath(definition);

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.edgesUnsupported"));
  });

  it("fails the run when the agent output does not match the node/workflow output port", async () => {
    const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Return structured data.", {
      now: () => "2026-05-10T22:56:00.000Z",
      createRunId: () => "wfr_invalid_output",
      createNodeAttemptId: () => "wna_invalid_output",
      agentExecutor: () => ({ output: { answer: "not a text value" } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.run?.status, "failed");
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidNodeOutput");
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.textValueExpected"),
    );
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["workflow.started", "node.started", "node.failed", "workflow.failed"],
    );
  });
});
