import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  WorkflowRun,
  WorkflowRunId,
  WorkflowRunStatus,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWaitTokenStatus,
} from "../types/index.js";

export type WorkflowRunStore = {
  saveRun(run: WorkflowRun): void | Promise<void>;
  getRun(id: WorkflowRunId): WorkflowRun | undefined | Promise<WorkflowRun | undefined>;
};

export type WorkflowWaitTokenStore = {
  saveWaitToken(token: WorkflowWaitToken): void | Promise<void>;
  getWaitToken(id: WorkflowWaitTokenId): WorkflowWaitToken | undefined | Promise<WorkflowWaitToken | undefined>;
  listWaitTokens(filter?: WorkflowWaitTokenListFilter): WorkflowWaitToken[] | Promise<WorkflowWaitToken[]>;
};

export type WorkflowRunListFilter = {
  workflowId?: string;
  status?: WorkflowRunStatus;
  ownerScope?: string;
  limit?: number;
};

export type WorkflowWaitTokenListFilter = {
  workflowRunId?: WorkflowRunId;
  status?: WorkflowWaitTokenStatus;
  humanNodeId?: string;
  limit?: number;
};

type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  workflow_version: string;
  owner_scope: string;
  parent_run_id: string | null;
  parent_node_attempt_id: string | null;
  pibo_session_id: string | null;
  project_id: string | null;
  environment_json: string | null;
  status: WorkflowRunStatus;
  current_node_id: string | null;
  current_edge_id: string | null;
  current_status: WorkflowRunStatus | null;
  current_json: string;
  input_json: string;
  output_json: string | null;
  output_present: number;
  state_json: string;
  checkpoint_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
};

type WorkflowWaitTokenRow = {
  id: string;
  workflow_run_id: string;
  node_attempt_id: string | null;
  human_node_id: string | null;
  actions_json: string;
  prompt: string;
  schema_json: string | null;
  status: WorkflowWaitTokenStatus;
  resume_payload_json: string | null;
  resume_payload_present: number;
  created_at: string;
  expires_at: string | null;
  resumed_at: string | null;
};

export class SqliteWorkflowRunStore implements WorkflowRunStore, WorkflowWaitTokenStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = path === ":memory:" ? path : resolve(path);
    if (resolvedPath !== ":memory:") {
      mkdirSync(dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        owner_scope TEXT NOT NULL,
        parent_run_id TEXT,
        parent_node_attempt_id TEXT,
        pibo_session_id TEXT,
        project_id TEXT,
        environment_json TEXT,
        status TEXT NOT NULL,
        current_node_id TEXT,
        current_edge_id TEXT,
        current_status TEXT,
        current_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        output_present INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL,
        checkpoint_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        failed_at TEXT,
        cancelled_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
        ON workflow_runs(workflow_id, workflow_version, updated_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
        ON workflow_runs(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_owner
        ON workflow_runs(owner_scope, updated_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_current_node
        ON workflow_runs(current_node_id, updated_at);

      CREATE TABLE IF NOT EXISTS workflow_wait_tokens (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL,
        node_attempt_id TEXT,
        human_node_id TEXT,
        actions_json TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schema_json TEXT,
        status TEXT NOT NULL,
        resume_payload_json TEXT,
        resume_payload_present INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        resumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_run
        ON workflow_wait_tokens(workflow_run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_status
        ON workflow_wait_tokens(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_node
        ON workflow_wait_tokens(human_node_id, created_at);
    `);
  }

  saveRun(run: WorkflowRun): void {
    this.db.prepare(`
      INSERT INTO workflow_runs (
        id,
        workflow_id,
        workflow_version,
        owner_scope,
        parent_run_id,
        parent_node_attempt_id,
        pibo_session_id,
        project_id,
        environment_json,
        status,
        current_node_id,
        current_edge_id,
        current_status,
        current_json,
        input_json,
        output_json,
        output_present,
        state_json,
        checkpoint_json,
        created_at,
        updated_at,
        completed_at,
        failed_at,
        cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        workflow_version = excluded.workflow_version,
        owner_scope = excluded.owner_scope,
        parent_run_id = excluded.parent_run_id,
        parent_node_attempt_id = excluded.parent_node_attempt_id,
        pibo_session_id = excluded.pibo_session_id,
        project_id = excluded.project_id,
        environment_json = excluded.environment_json,
        status = excluded.status,
        current_node_id = excluded.current_node_id,
        current_edge_id = excluded.current_edge_id,
        current_status = excluded.current_status,
        current_json = excluded.current_json,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        output_present = excluded.output_present,
        state_json = excluded.state_json,
        checkpoint_json = excluded.checkpoint_json,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        failed_at = excluded.failed_at,
        cancelled_at = excluded.cancelled_at
    `).run(
      run.id,
      run.workflowId,
      run.workflowVersion,
      run.ownerScope,
      run.parentRunId ?? null,
      run.parentNodeAttemptId ?? null,
      run.piboSessionId ?? null,
      run.projectId ?? null,
      serializeOptional(run.environment),
      run.status,
      run.current.nodeId ?? null,
      run.current.edgeId ?? null,
      run.current.status ?? null,
      serialize(run.current),
      serialize(run.input),
      run.output === undefined ? null : serialize(run.output),
      run.output === undefined ? 0 : 1,
      serialize(run.state),
      serializeOptional(run.checkpoint),
      run.createdAt,
      run.updatedAt,
      run.completedAt ?? null,
      run.failedAt ?? null,
      run.cancelledAt ?? null,
    );
  }

  getRun(id: WorkflowRunId): WorkflowRun | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRunRow | undefined;
    return row ? workflowRunFromRow(row) : undefined;
  }

  listRuns(filter: WorkflowRunListFilter = {}): WorkflowRun[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.workflowId !== undefined) {
      clauses.push("workflow_id = ?");
      values.push(filter.workflowId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.ownerScope !== undefined) {
      clauses.push("owner_scope = ?");
      values.push(filter.ownerScope);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...values, limit) as WorkflowRunRow[];
    return rows.map(workflowRunFromRow);
  }

  saveWaitToken(token: WorkflowWaitToken): void {
    this.db.prepare(`
      INSERT INTO workflow_wait_tokens (
        id,
        workflow_run_id,
        node_attempt_id,
        human_node_id,
        actions_json,
        prompt,
        schema_json,
        status,
        resume_payload_json,
        resume_payload_present,
        created_at,
        expires_at,
        resumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        node_attempt_id = excluded.node_attempt_id,
        human_node_id = excluded.human_node_id,
        actions_json = excluded.actions_json,
        prompt = excluded.prompt,
        schema_json = excluded.schema_json,
        status = excluded.status,
        resume_payload_json = excluded.resume_payload_json,
        resume_payload_present = excluded.resume_payload_present,
        expires_at = excluded.expires_at,
        resumed_at = excluded.resumed_at
    `).run(
      token.id,
      token.workflowRunId,
      token.nodeAttemptId ?? null,
      token.humanNodeId ?? null,
      serialize(token.actions),
      token.prompt,
      serializeOptional(token.schema),
      token.status,
      token.resumePayload === undefined ? null : serialize(token.resumePayload),
      token.resumePayload === undefined ? 0 : 1,
      token.createdAt,
      token.expiresAt ?? null,
      token.resumedAt ?? null,
    );
  }

  getWaitToken(id: WorkflowWaitTokenId): WorkflowWaitToken | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_wait_tokens WHERE id = ?").get(id) as
      | WorkflowWaitTokenRow
      | undefined;
    return row ? workflowWaitTokenFromRow(row) : undefined;
  }

  listWaitTokens(filter: WorkflowWaitTokenListFilter = {}): WorkflowWaitToken[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.workflowRunId !== undefined) {
      clauses.push("workflow_run_id = ?");
      values.push(filter.workflowRunId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.humanNodeId !== undefined) {
      clauses.push("human_node_id = ?");
      values.push(filter.humanNodeId);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const rows = this.db
      .prepare(`SELECT * FROM workflow_wait_tokens ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, limit) as WorkflowWaitTokenRow[];
    return rows.map(workflowWaitTokenFromRow);
  }

  close(): void {
    this.db.close();
  }
}

function workflowRunFromRow(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ownerScope: row.owner_scope,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.parent_node_attempt_id ? { parentNodeAttemptId: row.parent_node_attempt_id } : {}),
    ...(row.pibo_session_id ? { piboSessionId: row.pibo_session_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.environment_json ? { environment: parseJson(row.environment_json) } : {}),
    status: row.status,
    current: parseJson(row.current_json),
    input: parseJson(row.input_json) as WorkflowValue,
    ...(row.output_present ? { output: parseJson(row.output_json ?? "null") as WorkflowValue } : {}),
    state: parseJson(row.state_json),
    ...(row.checkpoint_json ? { checkpoint: parseJson(row.checkpoint_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}

function workflowWaitTokenFromRow(row: WorkflowWaitTokenRow): WorkflowWaitToken {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    ...(row.node_attempt_id ? { nodeAttemptId: row.node_attempt_id } : {}),
    ...(row.human_node_id ? { humanNodeId: row.human_node_id } : {}),
    actions: parseJson(row.actions_json),
    prompt: row.prompt,
    ...(row.schema_json ? { schema: parseJson(row.schema_json) } : {}),
    status: row.status,
    ...(row.resume_payload_present ? { resumePayload: parseJson(row.resume_payload_json ?? "null") as WorkflowValue } : {}),
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.resumed_at ? { resumedAt: row.resumed_at } : {}),
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function serializeOptional(value: unknown | undefined): string | null {
  return value === undefined ? null : serialize(value);
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
