import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

test("pibo data inventory is read-only and reports missing stores", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-inventory-"));
	try {
		const result = await execFileAsync("node", [cliPath, "data", "inventory", "--root", root, "--json"]);
		const parsed = JSON.parse(result.stdout);
		assert.ok(Array.isArray(parsed.stores));
		assert.ok(parsed.stores.some((store) => store.name === "v2" && store.exists === false));
		assert.ok(parsed.stores.some((store) => store.name === "legacy-chat" && store.exists === false));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pibo data repair unread-baseline seeds historical read cursors", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-data-unread-baseline-"));
	try {
		const v2 = new DatabaseSync(join(root, "pibo.sqlite"));
		try {
			v2.exec(`
				CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, deleted_at TEXT);
				CREATE TABLE event_log (session_id TEXT NOT NULL, stream_id INTEGER NOT NULL, created_at TEXT NOT NULL);
				CREATE TABLE principal_session_stats (
					session_id TEXT NOT NULL,
					principal_id TEXT NOT NULL,
					unread_count INTEGER NOT NULL DEFAULT 0,
					last_read_stream_id INTEGER NOT NULL DEFAULT 0,
					last_read_message_sequence INTEGER NOT NULL DEFAULT 0,
					last_read_at TEXT,
					updated_at TEXT NOT NULL,
					PRIMARY KEY(session_id, principal_id)
				);
			`);
			v2.prepare("INSERT INTO sessions (id, owner_scope, deleted_at) VALUES (?, ?, NULL)").run("ps_old", "user:test");
			v2.prepare("INSERT INTO sessions (id, owner_scope, deleted_at) VALUES (?, ?, NULL)").run("ps_existing", "user:test");
			v2.prepare("INSERT INTO sessions (id, owner_scope, deleted_at) VALUES (?, ?, NULL)").run("ps_other", "user:other");
			v2.prepare("INSERT INTO event_log (session_id, stream_id, created_at) VALUES (?, ?, ?)").run("ps_old", 10, "2026-05-09T00:00:00.000Z");
			v2.prepare("INSERT INTO event_log (session_id, stream_id, created_at) VALUES (?, ?, ?)").run("ps_old", 20, "2026-05-10T00:00:00.000Z");
			v2.prepare("INSERT INTO event_log (session_id, stream_id, created_at) VALUES (?, ?, ?)").run("ps_existing", 5, "2026-05-09T00:00:00.000Z");
			v2.prepare("INSERT INTO event_log (session_id, stream_id, created_at) VALUES (?, ?, ?)").run("ps_other", 8, "2026-05-09T00:00:00.000Z");
			v2.prepare("INSERT INTO principal_session_stats (session_id, principal_id, last_read_stream_id, updated_at) VALUES (?, ?, ?, ?)").run("ps_existing", "user:test", 2, "2026-05-09T00:00:00.000Z");
		} finally {
			v2.close();
		}

		const dryRun = await execFileAsync("node", [cliPath, "data", "repair", "unread-baseline", "--root", root, "--owner-scope", "user:test", "--before", "2026-05-09T23:59:59.999Z", "--dry-run", "--json"]);
		const dryRunReport = JSON.parse(dryRun.stdout);
		assert.equal(dryRunReport.candidateSessions, 2);
		assert.equal(dryRunReport.changedSessions, 2);
		assert.equal(dryRunReport.inserted, 1);
		assert.equal(dryRunReport.updated, 1);

		await execFileAsync("node", [cliPath, "data", "repair", "unread-baseline", "--root", root, "--owner-scope", "user:test", "--before", "2026-05-09T23:59:59.999Z", "--json"]);

		const repaired = new DatabaseSync(join(root, "pibo.sqlite"), { readOnly: true });
		try {
			assert.equal(repaired.prepare("SELECT last_read_stream_id FROM principal_session_stats WHERE session_id = ? AND principal_id = ?").get("ps_old", "user:test").last_read_stream_id, 10);
			assert.equal(repaired.prepare("SELECT last_read_stream_id FROM principal_session_stats WHERE session_id = ? AND principal_id = ?").get("ps_existing", "user:test").last_read_stream_id, 5);
			assert.equal(repaired.prepare("SELECT COUNT(*) AS count FROM principal_session_stats WHERE principal_id = ?").get("user:other").count, 0);
		} finally {
			repaired.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
