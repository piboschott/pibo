import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRoutedTuiClient, createLocalRoutedTuiExtension } from "../dist/local/tui.js";

function createFakeExtensionApi() {
	const handlers = new Map();
	const commands = new Map();
	const renderers = new Map();
	const messages = [];

	return {
		handlers,
		commands,
		renderers,
		messages,
		api: {
			on(event, handler) {
				handlers.set(event, handler);
			},
			registerCommand(name, options) {
				commands.set(name, options);
			},
			registerMessageRenderer(customType, renderer) {
				renderers.set(customType, renderer);
			},
			sendMessage(message) {
				messages.push(message);
			},
		},
	};
}

function createFakeExtensionContext(statuses) {
	const autocompleteProviders = [];
	const terminalInputHandlers = [];
	let editorText = "";
	return {
		autocompleteProviders,
		terminalInputHandlers,
		get editorText() {
			return editorText;
		},
		set editorText(value) {
			editorText = value;
		},
		ui: {
			setStatus(key, text) {
				statuses.set(key, text);
			},
			addAutocompleteProvider(provider) {
				autocompleteProviders.push(provider);
			},
			onTerminalInput(handler) {
				terminalInputHandlers.push(handler);
				return () => {
					const index = terminalInputHandlers.indexOf(handler);
					if (index !== -1) terminalInputHandlers.splice(index, 1);
				};
			},
			getEditorText() {
				return editorText;
			},
			setEditorText(text) {
				editorText = text;
			},
		},
	};
}

function createFakeClient() {
	const eventListeners = new Set();
	const sentMessages = [];
	const sentExecutions = [];
	let closeCount = 0;

	return {
		eventListeners,
		sentMessages,
		sentExecutions,
		get closeCount() {
			return closeCount;
		},
		binding: {
			sessionKey: "local-tui:pibo-run-yield-qa:default",
			sessionId: "local-session-1",
			channel: "local-tui",
			externalId: "pibo-run-yield-qa:default",
			originalProfile: "pibo-run-yield-qa",
			createdAt: "2026-04-27T00:00:00.000Z",
			updatedAt: "2026-04-27T00:00:00.000Z",
		},
		capabilities: {
			actions: [
				{ name: "status", slashCommands: ["status"] },
				{ name: "session_id", slashCommands: ["session"] },
				{ name: "session.tree", slashCommands: ["tree"] },
				{ name: "session.current", slashCommands: ["session-current"] },
			],
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		sendMessage(text) {
			sentMessages.push(text);
			return Promise.resolve({ ok: true });
		},
		sendExecution(action, params) {
			sentExecutions.push({ action, params });
			return Promise.resolve({ ok: true });
		},
		close() {
			closeCount += 1;
		},
	};
}

test("local routed TUI extension routes input through the local client", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);

	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	assert.match(fake.messages[0].content, /Connected to pibo local routed session local-tui:pibo-run-yield-qa:default/);
	assert.match(fake.messages[0].content, /Routed commands: \/status, \/session-current/);
	assert.doesNotMatch(fake.messages[0].content, /Routed commands: .*\/session(?:,|\n|$)/);
	assert.doesNotMatch(fake.messages[0].content, /\/tree\b/);
	assert.deepEqual([...fake.commands.keys()], ["status", "session-current"]);
	assert.equal(typeof fake.renderers.get("pibo.local-routed"), "function");
	assert.equal(ctx.autocompleteProviders.length, 1);
	assert.equal(statuses.get("pibo.local"), "local connected");

	const messageResult = await fake.handlers.get("input")(
		{ type: "input", text: "Hallo local", source: "interactive" },
		ctx,
	);
	assert.deepEqual(messageResult, { action: "handled" });
	assert.deepEqual(client.sentMessages, ["Hallo local"]);
	assert.equal(fake.messages[1].content, "Hallo local");

	await fake.commands.get("status").handler("");
	assert.deepEqual(client.sentExecutions[0], { action: "status", params: undefined });

	const quitResult = await fake.handlers.get("input")(
		{ type: "input", text: "/quit", source: "interactive" },
		ctx,
	);
	assert.deepEqual(quitResult, { action: "continue" });

	const blockedResult = await fake.handlers.get("input")(
		{ type: "input", text: "/tree", source: "interactive" },
		ctx,
	);
	assert.deepEqual(blockedResult, { action: "handled" });
	assert.match(fake.messages.at(-1).content, /not available in local routed mode/);
	assert.equal(client.sentExecutions.length, 1);

	for (const listener of client.eventListeners) {
		listener({
			type: "assistant_message",
			sessionKey: "local-tui:pibo-run-yield-qa:default",
			eventId: "msg-1",
			text: "Antwort aus der lokalen Session",
		});
	}
	assert.equal(fake.messages.at(-1).content, "Antwort aus der lokalen Session");

	await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
	assert.equal(client.closeCount, 1);
});

test("local routed TUI submit guard blocks leading conflicting Pi commands only", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	assert.equal(ctx.terminalInputHandlers.length, 1);
	const guard = ctx.terminalInputHandlers[0];

	ctx.editorText = "  /fork";
	assert.deepEqual(guard("\r"), { consume: true });
	assert.equal(ctx.editorText, "");
	assert.match(fake.messages.at(-1).content, /Command "\/fork" is not available in local routed mode/);

	ctx.editorText = "Bitte erkläre /fork im Text";
	assert.equal(guard("\r"), undefined);
	assert.equal(ctx.editorText, "Bitte erkläre /fork im Text");

	ctx.editorText = "/forked";
	assert.equal(guard("\r"), undefined);
	assert.equal(ctx.editorText, "/forked");

	ctx.editorText = "/clone now";
	assert.deepEqual(guard("\n"), { consume: true });
	assert.equal(ctx.editorText, "");
	assert.match(fake.messages.at(-1).content, /Command "\/clone now" is not available in local routed mode/);

	await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
	assert.equal(ctx.terminalInputHandlers.length, 0);
});

test("local routed TUI renderer keeps assistant unboxed and fills boxed headers", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const renderer = fake.renderers.get("pibo.local-routed");
	const userLines = renderer({
		content: "Hallo",
		details: { role: "user" },
	}).render(24);
	const assistantLines = renderer({
		content: "Hallo",
		details: { role: "assistant" },
	}).render(24);
	const executionLines = renderer({
		content: "status: ok",
		details: { role: "execution" },
	}).render(24);

	assert.equal(userLines[0].startsWith("\x1b[48;5;24m"), true);
	assert.match(userLines[0], /\s+\x1b\[0m$/);
	assert.equal(executionLines[0].startsWith("\x1b[48;5;58m"), true);
	assert.match(executionLines[0], /\s+\x1b\[0m$/);
	assert.equal(assistantLines.some((line) => line.includes("\x1b[48;5;")), false);
	assert.equal(userLines.length, 3);
	assert.equal(assistantLines.length, 3);
	assert.equal(executionLines.length, 3);
});

test("local routed TUI client uses a profile-scoped local session key", async () => {
	const client = createLocalRoutedTuiClient({ profile: "run-yield-qa", persistSession: false });

	try {
		assert.equal(client.binding.sessionKey, "local-tui:pibo-run-yield-qa:default");
		assert.equal(client.binding.channel, "local-tui");
		assert.equal(client.binding.externalId, "pibo-run-yield-qa:default");
		assert.equal(client.binding.originalProfile, "pibo-run-yield-qa");
		assert.ok(client.capabilities.actions.some((action) => action.name === "status"));
	} finally {
		await client.close();
	}
});
