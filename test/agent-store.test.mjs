import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";

async function withCwd(cwd, run) {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

test("custom agent store migrates legacy profile names before listing", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const db = new DatabaseSync(path);
	db.prepare(`
		INSERT INTO chat_agents (
			id,
			profile_name,
			owner_scope,
			display_name,
			description,
			native_tools_json,
			skills_json,
			context_files_json,
			subagents_json,
			builtin_tools,
			run_control,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		"user:test",
		"test-agent-2",
		null,
		"[]",
		"[]",
		"[]",
		"[]",
		"default",
		0,
		"2026-05-01T00:00:00.000Z",
		"2026-05-01T00:00:00.000Z",
	);

	const [agent] = store.list("user:test");
	assert.equal(agent.profileName, "test-agent-2");
	assert.equal(agent.displayName, "test-agent-2");
	assert.equal(
		db.prepare("SELECT profile_name FROM chat_agents WHERE id = ?").get("agent_02d60a56-9bd4-4606-921b-495e3daf69d8").profile_name,
		"test-agent-2",
	);

	db.close();
	store.close();
});

test("custom agent store archives and deletes agents", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({ ownerScope: "user:test", displayName: "archive-me" });

	assert.deepEqual(store.list("user:test").map((item) => item.profileName), ["archive-me"]);
	const archived = store.setArchived(agent.id, true);
	assert.ok(archived.archivedAt);
	assert.deepEqual(store.list("user:test"), []);
	assert.deepEqual(store.list("user:test", { includeArchived: true }).map((item) => item.profileName), ["archive-me"]);

	const restored = store.setArchived(agent.id, false);
	assert.equal(restored.archivedAt, undefined);
	assert.equal(store.delete(agent.id), true);
	assert.equal(store.get(agent.id), undefined);

	store.close();
});

test("custom agent store persists automatic context file setting", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const defaultAgent = store.create({ ownerScope: "user:test", displayName: "default-context" });
	const disabledAgent = store.create({
		ownerScope: "user:test",
		displayName: "disabled-context",
		autoContextFiles: false,
	});

	assert.equal(defaultAgent.autoContextFiles, true);
	assert.equal(disabledAgent.autoContextFiles, false);

	const updated = store.update(defaultAgent.id, { autoContextFiles: false });
	assert.equal(updated.autoContextFiles, false);

	store.close();
});

test("custom agent store persists selected MCP servers", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		ownerScope: "user:test",
		displayName: "mcp-context",
		mcpServers: ["filesystem", "filesystem", "deepwiki"],
	});

	assert.deepEqual(agent.mcpServers, ["filesystem", "deepwiki"]);

	const updated = store.update(agent.id, { mcpServers: ["deepwiki"] });
	assert.deepEqual(updated.mcpServers, ["deepwiki"]);
	assert.deepEqual(store.get(agent.id).mcpServers, ["deepwiki"]);

	store.close();
});

test("custom agent store persists selected built-in tools", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pibo-agent-store-")), "agents.sqlite");
	const store = new CustomAgentStore(path);
	const agent = store.create({
		ownerScope: "user:test",
		displayName: "basic-tools",
		builtinToolNames: ["read", "bash", "bash", "unknown"],
	});

	assert.deepEqual(agent.builtinToolNames, ["read", "bash"]);

	const updated = store.update(agent.id, { builtinToolNames: ["read"] });
	assert.deepEqual(updated.builtinToolNames, ["read"]);
	assert.deepEqual(store.get(agent.id).builtinToolNames, ["read"]);

	store.close();
});

test("custom agent store persists selected registered Pi packages", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-agent-store-pi-packages-"));
	await withCwd(cwd, () => {
		upsertPiPackage({
			id: "demo-package",
			name: "demo-package",
			source: "/tmp/demo-package",
			installSpec: "/tmp/demo-package",
			resourceTypes: ["extension"],
			installStatus: "installed",
			installPath: "/tmp/demo-package",
			diagnostics: [],
		});
		const store = new CustomAgentStore(join(cwd, "agents.sqlite"));
		const agent = store.create({
			ownerScope: "user:test",
			displayName: "package-agent",
			piPackages: ["demo-package", "demo-package"],
		});

		assert.deepEqual(agent.piPackages, ["demo-package"]);
		assert.throws(
			() => store.update(agent.id, { piPackages: ["missing-package"] }),
			/Unknown Pi package "missing-package"/,
		);

		store.close();
	});
});
