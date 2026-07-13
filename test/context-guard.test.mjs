import assert from "node:assert/strict";
import test from "node:test";
import {
	PIBO_CONTEXT_GUARD_NOTICE,
	PIBO_CONTEXT_GUARD_RESUME_MESSAGE_TYPE,
	PIBO_CONTEXT_GUARD_RESUME_PROMPT,
	createPiboAssistantContextGuardExtension,
	createPiboAssistantContextGuardRecovery,
	projectAssistantContextGuard,
} from "../dist/core/context-guard.js";

function userMessage(text) {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMessage(text) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function sessionEntry(id, parentId, message) {
	return { type: "message", id, parentId, timestamp: new Date().toISOString(), message };
}

function createExtensionHarness({ contextWindow = 200, contextTokens = 20, branchEntries = [] } = {}) {
	const handlers = new Map();
	const aborts = [];
	const compactCalls = [];
	const sentMessages = [];
	const recovery = createPiboAssistantContextGuardRecovery();
	const ctx = {
		model: { contextWindow },
		sessionManager: {
			getLeafId() { return branchEntries.at(-1)?.id ?? null; },
			getBranch() { return branchEntries; },
		},
		getContextUsage() {
			return contextTokens === null ? { tokens: null, contextWindow, percent: null } : { tokens: contextTokens, contextWindow, percent: contextTokens / contextWindow };
		},
		abort() { aborts.push(true); },
		compact(options) { compactCalls.push(options); },
	};
	const api = {
		on(name, handler) { handlers.set(name, handler); },
		sendMessage(message, options) { sentMessages.push({ message, options }); },
	};
	return {
		handlers,
		ctx,
		aborts,
		compactCalls,
		sentMessages,
		recovery,
		install: (options) => createPiboAssistantContextGuardExtension(options, recovery)(api),
	};
}

async function tripGuard(harness) {
	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_update")({
		type: "message_update",
		message: assistantMessage("x".repeat(120)),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(120) },
	}, harness.ctx);
	await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("x".repeat(120)) }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);
}

test("context guard lets assistant messages below the projected budget persist", async () => {
	const harness = createExtensionHarness({ contextWindow: 120, contextTokens: 30 });
	await harness.install({ reserveTokens: 20 });

	const result = await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("small response") }, harness.ctx);

	assert.equal(result, undefined);
	assert.equal(harness.aborts.length, 0);
	assert.equal(harness.compactCalls.length, 0);
});

test("context guard replaces oversized assistant message and queues compaction", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	await harness.install({ reserveTokens: 20 });

	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_update")({
		type: "message_update",
		message: assistantMessage("x".repeat(120)),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(120) },
	}, harness.ctx);
	const result = await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("x".repeat(120)) }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);

	assert.equal(harness.aborts.length, 1);
	assert.equal(result.message.role, "assistant");
	assert.equal(result.message.content[0].text, PIBO_CONTEXT_GUARD_NOTICE);
	assert.equal(result.message.stopReason, "aborted");
	assert.equal(harness.compactCalls.length, 1);
	assert.match(harness.compactCalls[0].customInstructions, /interrupted the previous assistant response/);
});

test("context guard resumes exactly once after compaction and settles after the resumed turn", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	await harness.install({ reserveTokens: 20 });

	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_update")({
		type: "message_update",
		message: assistantMessage("x".repeat(120)),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(120) },
	}, harness.ctx);
	await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("x".repeat(120)) }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);

	const recovery = harness.recovery.wait();
	let recoverySettled = false;
	void recovery.then(() => { recoverySettled = true; });
	harness.compactCalls[0].onComplete();
	harness.compactCalls[0].onComplete();
	assert.deepEqual(harness.sentMessages, [{
		message: {
			customType: PIBO_CONTEXT_GUARD_RESUME_MESSAGE_TYPE,
			content: [{ type: "text", text: PIBO_CONTEXT_GUARD_RESUME_PROMPT }],
			display: false,
		},
		options: { triggerTurn: true },
	}]);

	await harness.handlers.get("agent_start")({ type: "agent_start" }, harness.ctx);
	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("done") }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);
	await Promise.resolve();
	assert.equal(recoverySettled, false, "the routed queue must stay blocked until Pi marks the resumed run idle");
	await harness.handlers.get("agent_settled")({ type: "agent_settled" }, harness.ctx);

	assert.equal(await recovery, true);
	assert.equal(await harness.recovery.wait(), false);
});

test("claimed context guard recovery delegates continuation to the routed session", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	harness.recovery.claim();
	await harness.install({ reserveTokens: 20 });
	await tripGuard(harness);

	const recovery = harness.recovery.wait();
	harness.compactCalls[0].onComplete();

	assert.equal(await recovery, true);
	assert.equal(harness.sentMessages.length, 0);
});

test("context guard exposes compaction failures to the routed lifecycle", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	await harness.install({ reserveTokens: 20 });

	await harness.handlers.get("message_start")({ type: "message_start", message: assistantMessage("") }, harness.ctx);
	await harness.handlers.get("message_update")({
		type: "message_update",
		message: assistantMessage("x".repeat(120)),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(120) },
	}, harness.ctx);
	await harness.handlers.get("message_end")({ type: "message_end", message: assistantMessage("x".repeat(120)) }, harness.ctx);
	await harness.handlers.get("agent_end")({ type: "agent_end" }, harness.ctx);

	const recovery = harness.recovery.wait();
	harness.compactCalls[0].onError(new Error("compaction failed"));
	await assert.rejects(recovery, /compaction failed/);
	assert.equal(harness.sentMessages.length, 0);
});

test("context guard stops repeated compaction-resume loops", async () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 60 });
	await harness.install({ reserveTokens: 20 });

	await tripGuard(harness);
	const recovery = harness.recovery.wait();
	for (let attempt = 0; attempt < 3; attempt++) {
		harness.compactCalls[attempt].onComplete();
		await harness.handlers.get("agent_start")({ type: "agent_start" }, harness.ctx);
		await tripGuard(harness);
	}

	await assert.rejects(recovery, /exceeded 3 compaction attempts/);
	assert.equal(harness.compactCalls.length, 3);
	assert.equal(harness.sentMessages.length, 3);
});

test("context guard recovery cancellation releases waiters and resets extension state", async () => {
	const recovery = createPiboAssistantContextGuardRecovery();
	let cancelled = false;
	recovery.onCancel(() => { cancelled = true; });
	recovery.begin();
	const wait = recovery.wait();

	recovery.cancel(new Error("session replaced"));

	await assert.rejects(wait, /session replaced/);
	assert.equal(cancelled, true);

	recovery.begin();
	recovery.complete();
	recovery.cancel(new Error("session disposed"));
	await assert.rejects(recovery.wait(), /session disposed/);
});

test("context guard falls back to session branch token estimates when usage is unknown", () => {
	const branchEntries = [sessionEntry("u1", null, userMessage("u".repeat(240)))];
	const harness = createExtensionHarness({ contextWindow: 120, contextTokens: null, branchEntries });

	const projection = projectAssistantContextGuard(harness.ctx, 50, { reserveTokens: 20 });

	assert.equal(projection.contextTokens, 60);
	assert.equal(projection.assistantTokens, 50);
	assert.equal(projection.projectedTokens, 130);
	assert.equal(projection.exceedsLimit, true);
});

test("context guard reserve is configurable", () => {
	const harness = createExtensionHarness({ contextWindow: 100, contextTokens: 50 });

	assert.equal(projectAssistantContextGuard(harness.ctx, 10, { reserveTokens: 30 }).exceedsLimit, false);
	assert.equal(projectAssistantContextGuard(harness.ctx, 10, { reserveTokens: 50 }).exceedsLimit, true);
});
