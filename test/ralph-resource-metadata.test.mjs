import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiboRalphStore } from "../dist/ralph/store.js";

function tableColumns(db, tableName) {
	return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function indexNames(db, tableName) {
	return db.prepare(`PRAGMA index_list(${tableName})`).all().map((index) => index.name);
}

function createJob(store) {
	return store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "work", enabled: true });
}

test("Ralph store persists app-global job and run resource metadata", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "work",
			enabled: true,
			resources: { workerId: " worker-1 ", browserLeaseIds: ["lease-a", "lease-a", " "], cleanupState: "active" },
		});
		assert.equal("ownerScope" in job, false);
		assert.deepEqual(job.target, { kind: "default-chat" });
		assert.deepEqual(job.resources, { workerId: "worker-1", browserLeaseIds: ["lease-a"], cleanupState: "active" });

		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const updated = store.updateJobResources(job.id, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" }, new Date("2026-05-17T12:00:00.000Z"));
		assert.equal(updated.updatedAt, "2026-05-17T12:00:00.000Z");
		assert.deepEqual(updated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-b"], cleanupState: "retained", retainedUntil, dirtyReason: "needs inspection" });
		const crossAccountUpdate = store.updateJobResources(job.id, { workerId: "worker-cross" });
		assert.equal(crossAccountUpdate.resources.workerId, "worker-cross");
		store.updateJobResources(job.id, updated.resources);

		const reserved = store.reserveRun(job.id, new Date("2026-05-17T12:01:00.000Z"));
		assert.ok(reserved);
		assert.deepEqual(reserved.run.resources, updated.resources);

		const runUpdated = store.updateRunResources({ runId: reserved.run.id, resources: { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" } }, new Date("2026-05-17T12:02:00.000Z"));
		assert.deepEqual(runUpdated.resources, { workerId: "worker-2", browserLeaseIds: ["lease-c"], cleanupState: "dirty", dirtyReason: "cdp release failed" });
		assert.equal(runUpdated.updatedAt, "2026-05-17T12:02:00.000Z");
		const crossRunUpdate = store.updateRunResources({ runId: reserved.run.id, resources: { workerId: "worker-run-cross" } });
		assert.equal(crossRunUpdate.resources.workerId, "worker-run-cross");
		store.updateRunResources({ runId: reserved.run.id, resources: runUpdated.resources });

		assert.deepEqual(store.listJobs({ includeDisabled: true })[0].resources, updated.resources);
		assert.deepEqual(store.listRuns({})[0].resources, runUpdated.resources);
		assert.deepEqual(store.listJobs({ includeDisabled: true }).map((item) => item.id), [job.id]);
		assert.deepEqual(store.listRuns({}).map((item) => item.id), [reserved.run.id]);
	} finally { store.close(); }
});

test("Ralph resource metadata remains compatible with older store rows", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-resource-"));
	const dbPath = join(dir, "ralph.sqlite");
	const db = new DatabaseSync(dbPath);
	try {
		const createdAt = "2026-05-17T10:00:00.000Z";
		db.exec(`CREATE TABLE pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE INDEX idx_ralph_jobs_owner ON pibo_ralph_jobs(owner_scope, updated_at);
			CREATE TABLE pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_scope TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE INDEX idx_ralph_runs_owner ON pibo_ralph_runs(owner_scope, created_at);
			CREATE TABLE pibo_ralph_run_facts (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, job_id TEXT NOT NULL, run_id TEXT, pibo_session_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
			CREATE INDEX idx_ralph_facts_owner ON pibo_ralph_run_facts(owner_scope, created_at);`);
		db.prepare("INSERT INTO pibo_ralph_jobs (id, owner_scope, name, description, enabled, target_json, profile, prompt, max_iterations, runtime_options_json, stop_policy_json, state_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)").run("ralph_old", "user:a", "old", 1, JSON.stringify({ kind: "personal", principalId: "user:a" }), "codex", "work", JSON.stringify({ completedIterations: 0 }), createdAt, createdAt);
		db.prepare("INSERT INTO pibo_ralph_runs (id, job_id, owner_scope, pibo_session_id, status, reason, error, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?)").run("rrun_old", "ralph_old", "user:a", "running", createdAt, createdAt, createdAt);
		db.prepare("INSERT INTO pibo_ralph_run_facts (id, owner_scope, job_id, run_id, pibo_session_id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)").run("rfact_old", "user:a", "ralph_old", "rrun_old", "git.commit.created", "plugin", JSON.stringify({ sha: "abc" }), createdAt);
	} finally { db.close(); }

	const store = new PiboRalphStore({ path: dbPath });
	try {
		const oldJob = store.getJob("ralph_old");
		assert.ok(oldJob);
		assert.equal(oldJob.resources, undefined);
		assert.equal("ownerScope" in oldJob, false);
		assert.deepEqual(oldJob.target, { kind: "default-chat" });
		assert.equal(store.listRuns({})[0].resources, undefined);
		assert.equal("ownerScope" in store.listRuns({})[0], false);
		assert.equal("ownerScope" in store.listRunFacts({ jobId: "ralph_old" })[0], false);
		assert.equal(store.listRunFacts({ jobId: "ralph_old" })[0].type, "git.commit.created");
		for (const table of ["pibo_ralph_jobs", "pibo_ralph_runs", "pibo_ralph_run_facts"]) {
			assert.equal(tableColumns(store.db, table).has("owner_scope"), false, `${table}.owner_scope should be removed`);
			assert.equal(indexNames(store.db, table).some((name) => name.includes("owner")), false, `${table} owner indexes should be removed`);
		}

		const updatedJob = store.updateJobResources("ralph_old", { workerId: "worker-old", cleanupState: "active" });
		const updatedRun = store.updateRunResources({ runId: "rrun_old", resources: { browserLeaseIds: ["lease-old"], cleanupState: "released" } });
		assert.deepEqual(updatedJob.resources, { workerId: "worker-old", cleanupState: "active" });
		assert.deepEqual(updatedRun.resources, { browserLeaseIds: ["lease-old"], cleanupState: "released" });
	} finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Ralph resource metadata validation rejects unsupported values", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = createJob(store);
		assert.throws(() => store.updateJobResources(job.id, { cleanupState: "ignored" }), /cleanupState/);
		assert.throws(() => store.updateRunResources({ runId: "rrun_missing", resources: { browserLeaseIds: "lease" } }), /browserLeaseIds/);
	} finally { store.close(); }
});
