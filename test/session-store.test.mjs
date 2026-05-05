import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import { SqlitePiboSessionStore, createDefaultPiboSessionStore } from "../dist/sessions/sqlite-store.js";

test("pibo session builder creates opaque product and Pi identities", () => {
	const session = createPiboSession(
		{
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "pibo-minimal",
			ownerScope: "user:user-1",
			workspace: "/workspace",
			metadata: { source: "test" },
		},
		"2026-04-28T00:00:00.000Z",
	);

	assert.match(session.id, /^ps_[0-9a-f-]{36}$/);
	assert.match(session.piSessionId, /^[0-9a-f-]{36}$/);
	assert.equal(session.channel, "pibo.chat-web");
	assert.equal(session.kind, "chat");
	assert.equal(session.profile, "pibo-minimal");
	assert.equal(session.ownerScope, "user:user-1");
	assert.equal(session.workspace, "/workspace");
	assert.deepEqual(session.metadata, { source: "test" });
	assert.equal(session.createdAt, "2026-04-28T00:00:00.000Z");
	assert.equal(session.updatedAt, "2026-04-28T00:00:00.000Z");
});

test("in-memory pibo session store creates, updates, and finds sessions", () => {
	const store = new InMemoryPiboSessionStore();
	const parent = store.create({
		id: "ps_parent",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "pibo-minimal",
		ownerScope: "user:user-1",
	});
	const child = store.create({
		id: "ps_child",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "researcher",
		ownerScope: "user:user-1",
		parentId: parent.id,
		metadata: { subagentName: "researcher", threadKey: "auth" },
	});

	const updated = store.update(child.id, { title: "Research", workspace: "/workspace" });

	assert.equal(updated.id, child.id);
	assert.equal(updated.title, "Research");
	assert.equal(updated.workspace, "/workspace");
	assert.deepEqual(store.find({ ownerScope: "user:user-1" }).map((session) => session.id).sort(), [
		"ps_child",
		"ps_parent",
	]);
	assert.deepEqual(store.find({ parentId: parent.id }).map((session) => session.id), ["ps_child"]);
	assert.deepEqual(store.find({ metadata: { threadKey: "auth" } }).map((session) => session.id), ["ps_child"]);
});

test("in-memory pibo session store rejects duplicate Pi session ownership", () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_first",
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "pibo-minimal",
	});

	assert.throws(
		() =>
			store.create({
				id: "ps_second",
				piSessionId: "11111111-1111-4111-8111-111111111111",
				channel: "pibo.chat-web",
				kind: "branch",
				profile: "pibo-minimal",
			}),
		/Pi session "11111111-1111-4111-8111-111111111111" is already attached/,
	);
});

test("default sqlite pibo session store uses PIBO_HOME, not cwd", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-session-home-"));
	const previousPiboHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = dir;
	const store = createDefaultPiboSessionStore();

	try {
		store.create({
			id: "ps_home",
			piSessionId: "44444444-4444-4444-8444-444444444444",
			channel: "pibo.test",
			kind: "chat",
			profile: "pibo-minimal",
		});
		const reopened = new SqlitePiboSessionStore(join(dir, "pibo-sessions.sqlite"));
		try {
			assert.equal(reopened.get("ps_home")?.id, "ps_home");
		} finally {
			reopened.close();
		}
	} finally {
		store.close();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		await rm(dir, { recursive: true, force: true });
	}
});

test("sqlite pibo session store persists structured session fields", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-sessions-"));
	const dbPath = join(dir, "sessions.sqlite");
	const store = new SqlitePiboSessionStore(dbPath);

	try {
		const parent = store.create({
			id: "ps_parent",
			piSessionId: "11111111-1111-4111-8111-111111111111",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "pibo-minimal",
			ownerScope: "user:user-1",
		});
		const child = store.create({
			id: "ps_child",
			piSessionId: "22222222-2222-4222-8222-222222222222",
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "researcher",
			ownerScope: "user:user-1",
			parentId: parent.id,
			originId: parent.id,
			metadata: { subagentName: "researcher", threadKey: "auth" },
		});

		const reopened = new SqlitePiboSessionStore(dbPath);
		try {
			assert.deepEqual(reopened.get(child.id), {
				...child,
				metadata: { subagentName: "researcher", threadKey: "auth" },
			});
			assert.deepEqual(reopened.find({ parentId: parent.id }).map((session) => session.id), ["ps_child"]);
			assert.deepEqual(reopened.find({ originId: parent.id }).map((session) => session.id), ["ps_child"]);
			assert.deepEqual(reopened.find({ metadata: { threadKey: "auth" } }).map((session) => session.id), [
				"ps_child",
			]);
		} finally {
			reopened.close();
		}
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});
