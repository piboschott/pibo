import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { CliSourceError, CLI_ROOT_RECOVERY_OWNER_SCOPE, cliDefaultRoomIdForOwner, createDefaultFakeCliSessionSource, FakeCliSessionSource, LocalCliSessionSource, redactCliSecretText } from "../dist/cli-session/index.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

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

test("fake CLI session source switches active owners and filters owner-scoped rooms and sessions", async () => {
	const source = new FakeCliSessionSource({
		owners: [
			{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" },
			{ ownerScope: "user:beta", label: "Beta", kind: "web-user" },
		],
		rooms: [
			{ id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" },
			{ id: "room_beta", title: "Beta Room", ownerScope: "user:beta" },
		],
		sessions: [
			{ id: "ps_alpha", title: "Alpha Session", roomId: "room_alpha", ownerScope: "user:alpha", profile: "pibo-agent", status: "idle" },
			{ id: "ps_beta", title: "Beta Session", roomId: "room_beta", ownerScope: "user:beta", profile: "pibo-agent", status: "idle" },
		],
	});

	assert.equal((await source.getActiveOwner()).ownerScope, "user:alpha");
	assert.deepEqual((await source.listRooms()).map((room) => room.id), ["room_alpha"]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), ["ps_alpha"]);

	await source.setActiveOwner("user:beta");
	assert.equal((await source.getActiveOwner()).ownerScope, "user:beta");
	assert.deepEqual((await source.listRooms()).map((room) => room.id), ["room_beta"]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), ["ps_beta"]);
	const created = await source.createSession({ roomId: "room_beta", title: "Beta Created" });
	assert.equal(created.ownerScope, "user:beta");
	assert.equal(created.roomId, "room_beta");
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

test("local CLI session source lists existing sessions, derived rooms, agents, and redacted status", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_cli_local_a",
		piSessionId: "pi_cli_local_a",
		channel: "chat-web",
		kind: "chat",
		profile: "pibo-agent",
		ownerScope: "user:one",
		workspace: "/workspace/project-a",
		title: "Local A",
		metadata: { chatRoomId: "room_one", chatRoomName: "Main Room", status: "idle" },
		activeModel: { provider: "openai", id: "gpt-test" },
	});
	store.create({
		id: "ps_cli_local_b",
		piSessionId: "pi_cli_local_b",
		channel: "chat-web",
		kind: "chat",
		profile: "codex-compat-openai-web",
		ownerScope: "user:two",
		title: "Hidden for owner filter",
		metadata: { chatRoomId: "room_two", status: "running" },
	});
	const source = new LocalCliSessionSource({
		sessionStore: store,
		ownerScope: "user:one",
		now: () => fixedNow,
		statusMessage: "OPENAI_API_KEY=sk-testsecret token:abcdef123456 password=hunter2",
	});

	const rooms = await source.listRooms();
	assert.ok(rooms.some((room) => room.title === "Personal Chat" && room.ownerScope === "user:one" && room.isDefault === true));
	assert.ok(rooms.some((room) => room.id === "room_one" && room.title === "Main Room" && room.ownerScope === "user:one"));

	const sessions = await source.listSessions({ roomId: "room_one" });
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].id, "ps_cli_local_a");
	assert.equal(sessions[0].status, "idle");
	assert.deepEqual(sessions[0].model, { provider: "openai", id: "gpt-test" });
	assert.equal(sessions[0].workspace, "/workspace/project-a");

	const agents = await source.listAgents();
	assert.ok(agents.some((agent) => agent.id === "codex-compat-openai-web"));

	const status = await source.getStatus({ sessionId: "ps_cli_local_a" });
	assert.equal(status.source, "local/direct");
	assert.equal(status.mode, "local");
	assert.equal(status.rooms, "supported");
	assert.equal(status.sessions, "supported");
	assert.equal(status.activeRoomId, "room_one");
	assert.equal(status.activeAgentId, "pibo-agent");
	assert.equal(status.updatedAt, fixedNow);
	assert.doesNotMatch(status.message ?? "", /sk-testsecret|abcdef123456|hunter2/);
	assert.match(status.message ?? "", /\[redacted\]/);
});

test("local CLI session source resolves Root recovery owner and default Personal Chat when no owners exist", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow });

	const activeOwner = await source.getActiveOwner();
	assert.equal(activeOwner.ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(activeOwner.kind, "root-recovery");
	assert.equal(activeOwner.isFallback, true);
	assert.deepEqual((await source.listOwners()).map((owner) => owner.ownerScope), [CLI_ROOT_RECOVERY_OWNER_SCOPE]);

	const rooms = await source.listRooms();
	assert.equal(rooms[0].id, cliDefaultRoomIdForOwner(CLI_ROOT_RECOVERY_OWNER_SCOPE));
	assert.equal(rooms[0].title, "Personal Chat");
	assert.equal(rooms[0].ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(rooms[0].isDefault, true);

	const created = await source.createSession({ title: "Root recovery created", profile: "codex-compat-openai-web" });
	assert.equal(created.ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(created.roomId, rooms[0].id);
	assert.equal(store.get(created.id).ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.notEqual(created.ownerScope, "user:unknown");
});

test("local CLI session source discovers one owner and multiple owners from sessions rooms navigation and custom agents", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	rooms.createRoom({ id: "room_two", ownerScope: "user:two", name: "Two Room", type: "chat" });
	dataStore.navigation.upsertSession({ ownerScope: "user:three", roomId: "room_three", sessionId: "ps_nav_three", title: "Nav Three", profile: "pibo-agent", status: "idle", lastActivityAt: fixedNow, sortKey: fixedNow, updatedAt: fixedNow });
	dataStore.eventLog.appendEvent({ sessionId: "ps_event_four", roomId: "room_four", topic: "chat", type: "message.accepted", source: "test", actorType: "user", actorId: "user:four", retentionClass: "standard", previewText: "owner discovery", createdAt: fixedNow });
	const session = sessionStore.create({ id: "ps_owner_one", piSessionId: "pi_owner_one", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:one", title: "Owner One", metadata: { chatRoomId: "room_one", chatRoomName: "One Room", status: "idle" } });
	assert.equal(session.ownerScope, "user:one");

	const source = new LocalCliSessionSource({
		dataStore,
		sessionStore,
		ownerSummaries: [{ ownerScope: "user:custom", label: "Custom owner", description: "custom agent", kind: "web-user" }],
		now: () => fixedNow,
	});

	const ownerScopes = (await source.listOwners()).map((owner) => owner.ownerScope);
	assert.deepEqual(ownerScopes, ["user:custom", "user:four", "user:one", "user:three", "user:two"]);
	assert.equal((await source.getActiveOwner()).ownerScope, "user:custom");

	await source.setActiveOwner("user:two");
	assert.equal((await source.getActiveOwner()).ownerScope, "user:two");
	assert.ok((await source.listRooms()).every((room) => room.ownerScope === "user:two"));

	const oneSource = new LocalCliSessionSource({ sessionStore, ownerScope: "user:one", dataStore, now: () => fixedNow });
	assert.equal((await oneSource.getActiveOwner()).ownerScope, "user:one");
	const oneRooms = await oneSource.listRooms();
	assert.ok(oneRooms.some((room) => room.title === "Personal Chat" && room.isDefault === true));
	assert.ok(oneRooms.some((room) => room.id === "room_one"));
	await source.close();
	await oneSource.close();
	dataStore.close();
});

test("local CLI session source owner and room contract filters sessions and creates in selected owner default room", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const defaultRoom = rooms.ensureDefaultRoom({ ownerScope: "user:one", principalId: "user:one", name: "Personal Chat" });
	rooms.createRoom({ id: "room_two", ownerScope: "user:two", name: "Other Owner Room", type: "chat" });
	const one = sessionStore.create({ id: "ps_filter_one", piSessionId: "pi_filter_one", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:one", title: "Filter One", metadata: { chatRoomId: defaultRoom.id, chatRoomName: "Personal Chat", status: "idle" } });
	const two = sessionStore.create({ id: "ps_filter_two", piSessionId: "pi_filter_two", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:two", title: "Filter Two", metadata: { chatRoomId: "room_two", chatRoomName: "Other Owner Room", status: "idle" } });

	const source = new LocalCliSessionSource({ dataStore, sessionStore, ownerScope: "user:one", now: () => fixedNow });
	assert.deepEqual((await source.listSessions()).map((session) => session.id), [one.id]);
	assert.deepEqual((await source.listSessions({ ownerScope: "user:two" })).map((session) => session.id), [two.id]);
	assert.deepEqual((await source.listSessions({ roomId: defaultRoom.id })).map((session) => session.id), [one.id]);

	const created = await source.createSession({ title: "Created in default", profile: "codex-compat-openai-web" });
	assert.equal(created.ownerScope, "user:one");
	assert.equal(created.roomId, defaultRoom.id);
	const persisted = dataStore.db.prepare("SELECT owner_scope, room_id FROM sessions WHERE id = ?").get(created.id);
	assert.equal(persisted.owner_scope, "user:one");
	assert.equal(persisted.room_id, defaultRoom.id);

	await source.close();
	dataStore.close();
});

test("local CLI session source creates opens sends and cleans local trace subscriptions", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, ownerScope: "user:one", now: () => fixedNow });

	const defaultCreated = await source.createSession({ roomId: "room_one", title: "Default CLI Created" });
	assert.ok(defaultCreated.profile.length > 0);
	const created = await source.createSession({ roomId: "room_one", title: "CLI Created", agentId: "codex-compat-openai-web", workspace: "/workspace/cli" });
	assert.equal(created.title, "CLI Created");
	assert.equal(created.profile, "codex-compat-openai-web");
	assert.equal(created.ownerScope, "user:one");
	assert.equal(created.roomId, "room_one");
	assert.equal(created.workspace, "/workspace/cli");
	assert.equal(created.status, "idle");

	const opened = await source.openSession(created.id);
	assert.equal(opened.traceView?.nodes.length, 0);
	const updates = [];
	const unsubscribe = opened.subscribe((update) => updates.push(update));
	await source.sendMessage(created.id, " hello from local cli ");

	assert.equal(source.listenerCount(created.id), 1);
	assert.deepEqual(updates.map((update) => update.type), ["trace", "session"]);
	const traceUpdate = updates.find((update) => update.type === "trace");
	assert.match(JSON.stringify(traceUpdate.traceView), /hello from local cli/);
	const rows = buildCompactTerminalRows(traceUpdate.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user"]);

	unsubscribe();
	assert.equal(source.listenerCount(created.id), 0);
	const reopened = await source.openSession(created.id);
	reopened.subscribe(() => {});
	await source.close();
	assert.equal(source.listenerCount(), 0);
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("local CLI session source can project router live events into trace updates", async () => {
	const store = new InMemoryPiboSessionStore();
	const listeners = new Set();
	const router = {
		emitted: [],
		disposed: false,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async emit(event) {
			this.emitted.push(event);
			for (const listener of listeners) {
				listener({ type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 1, text: event.text, source: event.source });
				listener({ type: "assistant_delta", piboSessionId: event.piboSessionId, eventId: event.id, assistantIndex: 0, contentIndex: 0, text: "partial " });
				listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, assistantIndex: 0, contentIndex: 0, text: "partial done" });
				listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id, source: event.source });
			}
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 1, text: event.text, source: event.source };
		},
		getSessionRuntimeStatus() {
			return { piboSessionId: "unused", queuedMessages: 1, processing: true, streaming: false, activeTools: [], enabledTools: [], cwd: "/workspace", disposed: false };
		},
		async disposeAll() {
			this.disposed = true;
		},
	};
	const source = new LocalCliSessionSource({ sessionStore: store, router, ownsRouter: true, now: () => fixedNow });
	const created = await source.createSession({ title: "Router Session", profile: "codex-compat-openai-web" });
	const opened = await source.openSession(created.id);
	const updates = [];
	opened.subscribe((update) => updates.push(update));

	await source.sendMessage(created.id, "route me");
	assert.equal(router.emitted.length, 1);
	assert.equal(router.emitted[0].type, "message");
	assert.equal(updates.filter((update) => update.type === "trace").length, 3);
	assert.match(JSON.stringify(updates.at(-2).traceView), /partial done/);
	assert.equal((await source.getStatus({ sessionId: created.id })).message, "Runtime ready; queued=1 processing=true streaming=false");

	await source.close();
	assert.equal(router.disposed, true);
	assert.equal(listeners.size, 0);
});

test("local CLI session source reports clear errors and current-session agent limits", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow, agentSummaries: [{ id: "codex-compat-openai-web", name: "codex-compat-openai-web", profileName: "codex-compat-openai-web", description: "Built-in" }, { id: "custom-agent", name: "custom-agent", profileName: "custom-agent", description: "Custom agent" }] });
	const rooms = await source.listRooms();
	assert.equal(rooms.length, 1);
	assert.equal(rooms[0].ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.deepEqual(await source.listSessions(), []);
	const status = await source.getStatus();
	assert.equal(status.rooms, "supported");
	assert.equal(status.message, "Local CLI source ready; discovered 0 sessions.");

	await assert.rejects(() => source.openSession("missing"), (error) => error instanceof CliSourceError && error.code === "session_not_found");
	await assert.rejects(() => source.sendMessage("missing", "hello"), (error) => error instanceof CliSourceError && error.code === "session_not_found");
	await assert.rejects(() => source.sendMessage("missing", "   "), (error) => error instanceof CliSourceError && error.code === "empty_message");
	await assert.rejects(() => source.createSession({ agentId: "missing-agent" }), (error) => error instanceof CliSourceError && error.code === "agent_not_found");
	assert.deepEqual((await source.listAgents()).map((agent) => agent.id), ["codex-compat-openai-web", "custom-agent"]);

	const created = await source.createSession({ title: "Agent unchanged", profile: "codex-compat-openai-web" });
	assert.equal((await source.setSessionAgent(created.id, "codex-compat-openai-web")).profile, "codex-compat-openai-web");
	await assert.rejects(() => source.setSessionAgent(created.id, "custom-agent"), (error) => error instanceof CliSourceError && error.code === "unsupported");

	await source.close();
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("CLI status redaction removes common secret-shaped values", () => {
	const redacted = redactCliSecretText("api-key:sk-secretvalue token=ghp_abcdefghijklmnopqrstuvwxyz password:supersecret");
	assert.doesNotMatch(redacted, /sk-secretvalue|ghp_abcdefghijklmnopqrstuvwxyz|supersecret/);
	assert.match(redacted, /\[redacted\]/);
});

test("CLI session source modules avoid renderer dependencies", () => {
	const sourceDir = path.resolve("src/cli-session");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|ink|react-dom|react-virtuoso|lucide-react|@uiw\/react-json-view|react-markdown)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|className=/i, `${file} must not use browser presentation APIs`);
	}
});
