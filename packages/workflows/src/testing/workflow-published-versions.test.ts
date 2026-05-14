import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowPublishedVersionRecord,
  createWorkflowRegistry,
  hashWorkflowDefinition,
  minimalOneNodePiboAgentWorkflowFixture,
  registerWorkflowPublishedVersion,
  resolveWorkflowDefinition,
  SqliteWorkflowRunStore,
} from "../index.js";
import type { WorkflowDefinition } from "../index.js";

const publishedAt = "2026-05-11T04:00:00.000Z";
const createdAt = "2026-05-11T04:00:01.000Z";

function createDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    ...minimalOneNodePiboAgentWorkflowFixture,
    id: "workflow.ui.published",
    version: "1.0.0",
    title: "Published UI workflow",
    ...overrides,
  };
}

describe("published workflow version persistence", () => {
  it("stores immutable published versions with definition hashes and hydrates the registry", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-published-version-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const definition = createDefinition();
    const record = createWorkflowPublishedVersionRecord({
      workflowId: definition.id,
      version: definition.version,
      definition,
      publishedFromDraftId: "wfd_1",
      publishedBy: "user:published",
      publishedAt,
      createdAt,
    });

    try {
      assert.equal(record.definitionHash, hashWorkflowDefinition(definition));

      const store = new SqliteWorkflowRunStore(dbPath);
      try {
        store.savePublishedWorkflowVersion(record);
      } finally {
        store.close();
      }

      const reopened = new SqliteWorkflowRunStore(dbPath);
      try {
        assert.deepEqual(reopened.getPublishedWorkflowVersion(definition.id, definition.version), record);
        assert.deepEqual(reopened.listPublishedWorkflowVersions({ workflowId: definition.id }), [record]);

        const registry = createWorkflowRegistry();
        registerWorkflowPublishedVersion(registry, record);
        assert.deepEqual(resolveWorkflowDefinition(registry, definition.id, definition.version), definition);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects attempts to replace an existing published definition body", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-published-immutable-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const definition = createDefinition();
    const record = createWorkflowPublishedVersionRecord({
      workflowId: definition.id,
      version: definition.version,
      definition,
      publishedAt,
      createdAt,
    });
    const changedDefinition = createDefinition({ title: "Changed after publish" });
    const changedRecord = createWorkflowPublishedVersionRecord({
      workflowId: changedDefinition.id,
      version: changedDefinition.version,
      definition: changedDefinition,
      publishedAt: "2026-05-11T04:05:00.000Z",
      createdAt: "2026-05-11T04:05:01.000Z",
    });
    const store = new SqliteWorkflowRunStore(dbPath);

    try {
      store.savePublishedWorkflowVersion(record);
      store.savePublishedWorkflowVersion(record);
      assert.throws(() => store.savePublishedWorkflowVersion(changedRecord), /immutable/);
      assert.deepEqual(store.getPublishedWorkflowVersion(definition.id, definition.version), record);
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
