import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimalOneNodePiboAgentWorkflowFixture,
  requiredWorkflowFixtures,
  validateWorkflow,
} from "../index.js";
import type { JsonSchema, ValidationResult, WorkflowDefinition, WorkflowDiagnostic } from "../index.js";

function diagnosticCodes(result: ValidationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

function findDiagnostic(
  result: ValidationResult,
  code: string,
  predicate: (diagnostic: WorkflowDiagnostic) => boolean = () => true,
): WorkflowDiagnostic {
  const diagnostic = result.diagnostics.find((item) => item.code === code && predicate(item));
  assert.ok(diagnostic, `expected diagnostic ${code}; got ${diagnosticCodes(result).join(", ")}`);
  return diagnostic;
}

function withDefinitionMutation(mutator: (definition: WorkflowDefinition) => void): WorkflowDefinition {
  const definition = structuredClone(minimalOneNodePiboAgentWorkflowFixture) as WorkflowDefinition;
  mutator(definition);
  return definition;
}

describe("workflow definition validation", () => {
  it("accepts the required workflow fixtures", () => {
    for (const fixture of requiredWorkflowFixtures) {
      const result = validateWorkflow(fixture);
      assert.equal(result.ok, true, `${fixture.id} should validate: ${diagnosticCodes(result).join(", ")}`);
    }
  });

  it("rejects JSON workflow ports with non-object roots", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.input = {
        kind: "json",
        schema: { type: "string" },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.rootMustBeObject", (diagnostic) => diagnostic.path === "$.input.schema.type");
  });

  it("rejects root anyOf schemas for workflow ports", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.output = {
        kind: "json",
        schema: {
          anyOf: [
            {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          ],
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.rootAnyOf", (diagnostic) => diagnostic.path === "$.output.schema.anyOf");
  });

  it("rejects object schemas that are not strict Structured Outputs objects", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer.output = {
        kind: "json",
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["answer"],
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.objectAdditionalProperties",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.output.schema.additionalProperties",
    );
    findDiagnostic(
      result,
      "WorkflowInterfaceError.objectPropertyNotRequired",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.output.schema.required",
    );
  });

  it("rejects malformed human response schemas", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer = {
        kind: "human",
        prompt: "Choose the next step.",
        schema: {
          type: "object",
          properties: {
            decision: {
              oneOf: [{ type: "string", enum: ["approve", "reject"] }],
            },
          },
          required: ["decision"],
          additionalProperties: false,
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unsupportedOneOf",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.schema.properties.decision.oneOf",
    );
  });

  it("rejects malformed edge adapter output schemas", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: strictObjectSchema({ value: { type: "string" } }) },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        adapter: {
          kind: "edgeAdapter",
          transform: "fixture.adapters.answerToNext",
          output: {
            kind: "json",
            schema: {
              $ref: "#/$defs/Missing",
            },
          },
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unresolvedRef",
      (diagnostic) => diagnostic.edgeId === "answer-to-next" && diagnostic.path === "$.edges.answer-to-next.adapter.output.schema.$ref",
    );
  });
});

function strictObjectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
