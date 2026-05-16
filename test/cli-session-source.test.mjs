import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { CliSourceError, createDefaultFakeCliSessionSource } from "../dist/cli-session/index.js";

const fixedNow = "2026-05-16T12:00:00.000Z";

test("fake CLI session source exposes deterministic rooms sessions agents and status", async () => {
	const source = createDefaultFakeCliSessionSource();

	const rooms = await source.listRooms();
	assert.deepEqual(rooms, [{ id: "room_fake_main", title: "Fake Room", description: "Deterministic CLI session source room" }]);

	const sessions = await source.listSessions({ roomId: "room_fake_main" });
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].id, "ps_fake_existing");
	assert.equal(sessions[0].profile, "pibo-agent");
	assert.equal(sessions[0].updatedAt, fixedNow);

	const agents = await source.listAgents();
	assert.deepEqual(agents.map((agent) => agent.id), ["pibo-agent", "codex-compat-openai-web"]);

	const status = await source.getStatus({ sessionId: "ps_fake_existing" });
	assert.equal(status.source, "fake");
	assert.equal(status.mode, "fake");
	assert.equal(status.connected, true);
	assert.equal(status.activeSessionId, "ps_fake_existing");
	assert.equal(status.activeAgentId, "pibo-agent");
	assert.equal(status.updatedAt, fixedNow);
});

test("fake CLI session source opens trace fixtures compatible with shared compact rows", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");

	assert.equal(opened.session.title, "Existing fake session");
	assert.equal(opened.traceView?.piboSessionId, "ps_fake_existing");
	const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user", "message.assistant"]);
	assert.match(JSON.stringify(rows), /Hello from fake source/);
	assert.match(JSON.stringify(rows), /Fake assistant response/);

	opened.close();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);
});

test("fake CLI session source emits trace and session updates and cleans subscriptions", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");
	const updates = [];
	const unsubscribe = opened.subscribe((update) => updates.push(update));

	await source.sendMessage("ps_fake_existing", "Follow up from test");
	assert.equal(source.listenerCount("ps_fake_existing"), 1);
	assert.deepEqual(updates.map((update) => update.type), ["session", "trace"]);
	assert.match(JSON.stringify(updates.at(-1).traceView), /Follow up from test/);

	unsubscribe();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);

	const secondOpened = await source.openSession("ps_fake_existing");
	secondOpened.subscribe(() => {});
	assert.equal(source.listenerCount("ps_fake_existing"), 1);
	secondOpened.close();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);

	const thirdOpened = await source.openSession("ps_fake_existing");
	thirdOpened.subscribe(() => {});
	source.close();
	assert.equal(source.listenerCount(), 0);
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("fake CLI session source creates sessions and applies existing agents only", async () => {
	const source = createDefaultFakeCliSessionSource();
	const created = await source.createSession({ roomId: "room_fake_main", title: "Created from test", agentId: "codex-compat-openai-web" });

	assert.equal(created.id, "ps_fake_created_1");
	assert.equal(created.profile, "codex-compat-openai-web");
	assert.equal(created.agentId, "codex-compat-openai-web");
	assert.equal(created.createdAt, fixedNow);

	const opened = await source.openSession(created.id);
	assert.deepEqual(opened.traceView?.nodes, []);

	const updated = await source.setSessionAgent(created.id, "pibo-agent");
	assert.equal(updated.profile, "pibo-agent");
	assert.equal(updated.agentId, "pibo-agent");

	await assert.rejects(
		() => source.setSessionAgent(created.id, "missing-agent"),
		(error) => error instanceof CliSourceError && error.code === "agent_not_found",
	);
});

test("CLI session source modules avoid renderer dependencies", () => {
	const sourceDir = path.resolve("src/cli-session");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|ink|react-dom|react-virtuoso|lucide-react|@uiw\/react-json-view|react-markdown)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|className=/i, `${file} must not use browser presentation APIs`);
	}
});
