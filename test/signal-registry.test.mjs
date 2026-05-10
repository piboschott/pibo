import assert from "node:assert/strict";
import test from "node:test";
import { createPiboSignalRegistry } from "../dist/signals/registry.js";

function session(id, parentId) {
	return {
		id,
		piSessionId: `pi-${id}`,
		channel: "test",
		kind: parentId ? "subagent" : "runtime",
		profile: "test-profile",
		parentId,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function run(id, status, extra = {}) {
	return {
		runId: id,
		kind: "tool",
		ownerPiboSessionId: "root",
		status,
		completionPolicy: "tracked",
		consumed: false,
		toolName: "bash",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...extra,
	};
}

test("signal registry aggregates a three-level active descendant", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "session_created", session: session("child", "root") });
	registry.project({ type: "session_created", session: session("grandchild", "child") });
	registry.project({ type: "session_processing_changed", piboSessionId: "grandchild", processing: true, queuedMessages: 0 });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.localStatus, "idle");
	assert.equal(snapshot.sessions.root.isTreeActive, true);
	assert.equal(snapshot.sessions.root.hasActiveDescendant, true);
	assert.equal(snapshot.sessions.child.hasActiveDescendant, true);
	assert.equal(snapshot.sessions.grandchild.isLocalActive, true);
});

test("deep child tool start sets parent and root active", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "session_created", session: session("child", "root") });
	registry.project({ type: "session_created", session: session("grandchild", "child") });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_started", piboSessionId: "grandchild", toolCallId: "tc1", toolName: "bash" } });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.grandchild.activeToolCalls.length, 1);
	assert.equal(snapshot.sessions.child.hasActiveDescendant, true);
	assert.equal(snapshot.sessions.root.isTreeActive, true);
	assert.equal(snapshot.sessions.root.activeChildren[0].piboSessionId, "child");
});

test("child error sets parent error descendant", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "session_created", session: session("child", "root") });
	registry.project({ type: "pibo_output", event: { type: "session_error", piboSessionId: "child", eventId: "m1", error: "boom" } });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.child.hasError, true);
	assert.equal(snapshot.sessions.root.hasErrorDescendant, true);
	assert.equal(snapshot.sessions.root.errors.some((error) => error.message === "boom"), true);
});

test("yielded run keeps session tree active and completion removes active run", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "run_changed", run: run("run_1", "running") });

	let snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.localStatus, "running");
	assert.equal(snapshot.sessions.root.isTreeActive, true);
	assert.equal(snapshot.sessions.root.activeRuns.length, 1);

	registry.project({ type: "run_changed", run: run("run_1", "completed", { completedAt: new Date().toISOString() }) });
	snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.isTreeActive, false);
	assert.equal(snapshot.sessions.root.activeRuns.length, 0);
});

test("failed yielded run does not mark session as runtime error", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({
		type: "run_changed",
		run: run("run_1", "failed", {
			completedAt: new Date().toISOString(),
			summary: "bash run failed.",
			error: "Command exited with code 1",
		}),
	});

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.hasError, false);
	assert.equal(snapshot.sessions.root.hasErrorDescendant, false);
	assert.equal(snapshot.sessions.root.localStatus, "idle");
	assert.equal(snapshot.nodes["run:run_1"].status, "error");
});

test("queue count changes local status and repeated count is ignored", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	const first = registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 1 });
	const repeated = registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 1 });

	let snapshot = registry.snapshotTree("root");
	assert.equal(first?.sessionSnapshots.some((item) => item.piboSessionId === "root"), true);
	assert.equal(repeated, undefined);
	assert.equal(snapshot.sessions.root.localStatus, "queued");
	assert.equal(snapshot.sessions.root.queuedMessages, 1);

	registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 0 });
	snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.localStatus, "idle");
	assert.equal(snapshot.sessions.root.queuedMessages, 0);
});

test("prune terminal node sends remove patch", async () => {
	const registry = createPiboSignalRegistry({ terminalSuccessTtlMs: 100, terminalErrorTtlMs: 1000 });
	const patches = [];
	registry.subscribe("root", (patch) => patches.push(patch));
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "pibo_output", event: { type: "message_finished", piboSessionId: "root", eventId: "m1" } });

	const pruned = registry.pruneTerminalNodes({ nowMs: Date.now() + 200 });
	await new Promise((resolve) => setImmediate(resolve));
	const removePatch = patches.find((patch) => patch.removes.includes("turn:root:m1"));
	assert.equal(pruned >= 1, true);
	assert.ok(removePatch);
	assert.equal(registry.snapshotTree("root").nodes["turn:root:m1"], undefined);
});

test("metadata change produces a patch and identical metadata input does not", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_started", piboSessionId: "root", toolCallId: "tc1", toolName: "bash" } });
	const changed = registry.project({ type: "pibo_output", event: { type: "tool_execution_updated", piboSessionId: "root", toolCallId: "tc1", toolName: "edit" } });
	const repeated = registry.project({ type: "pibo_output", event: { type: "tool_execution_updated", piboSessionId: "root", toolCallId: "tc1", toolName: "edit" } });

	assert.equal(changed?.upserts.some((node) => node.id === "tool:root:tc1" && node.metadata.toolName === "edit"), true);
	assert.equal(repeated, undefined);
	assert.equal(registry.snapshotTree("root").sessions.root.activeToolCalls[0].toolName, "edit");
});

test("snapshot updatedAt only advances on semantic change", async () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 1 });
	const before = registry.snapshotTree("root").sessions.root.updatedAt;
	assert.equal(registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 1 }), undefined);
	assert.equal(registry.snapshotTree("root").sessions.root.updatedAt, before);

	await new Promise((resolve) => setTimeout(resolve, 2));
	registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 0 });
	assert.notEqual(registry.snapshotTree("root").sessions.root.updatedAt, before);
});

test("patch versions are monotonic per root", () => {
	const registry = createPiboSignalRegistry();
	const first = registry.project({ type: "session_created", session: session("root") });
	const second = registry.project({ type: "queue_changed", piboSessionId: "root", queuedMessages: 1 });
	assert.equal(first?.fromVersion, 0);
	assert.equal(first?.toVersion, 1);
	assert.equal(second?.fromVersion, 1);
	assert.equal(second?.toVersion, 2);
});

test("message finish settles active tool signals without matching tool finish", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_started", piboSessionId: "root", eventId: "m1", toolCallId: "tc1", toolName: "bash" } });
	assert.equal(registry.snapshotTree("root").sessions.root.isTreeActive, true);

	registry.project({ type: "pibo_output", event: { type: "message_finished", piboSessionId: "root", eventId: "m1" } });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.nodes["tool:root:tc1"].status, "done");
	assert.equal(snapshot.sessions.root.aggregateStatus, "idle");
	assert.equal(snapshot.sessions.root.isTreeActive, false);
});

test("processing false settles orphan active tool signals", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_started", piboSessionId: "root", eventId: "m1", toolCallId: "tc1", toolName: "bash" } });

	registry.project({ type: "session_processing_changed", piboSessionId: "root", processing: false, queuedMessages: 0 });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.nodes["tool:root:tc1"].status, "done");
	assert.equal(snapshot.sessions.root.aggregateStatus, "idle");
	assert.equal(snapshot.sessions.root.isTreeActive, false);
});

test("tool call errors do not mark the session signal as failed", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_started", piboSessionId: "root", eventId: "m1", toolCallId: "tc1", toolName: "bash" } });
	registry.project({ type: "pibo_output", event: { type: "tool_execution_finished", piboSessionId: "root", eventId: "m1", toolCallId: "tc1", toolName: "bash", isError: true } });
	registry.project({ type: "pibo_output", event: { type: "message_finished", piboSessionId: "root", eventId: "m1" } });
	registry.project({ type: "session_processing_changed", piboSessionId: "root", processing: false, queuedMessages: 0 });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.nodes["tool:root:tc1"].status, "error");
	assert.equal(snapshot.sessions.root.hasError, false);
	assert.equal(snapshot.sessions.root.aggregateStatus, "idle");
});

test("queued message signal settles after a provider error", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_queued", piboSessionId: "root", eventId: "m1", queuedMessages: 1 } });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "session_processing_changed", piboSessionId: "root", processing: false, queuedMessages: 0 });
	registry.project({ type: "pibo_output", event: { type: "session_error", piboSessionId: "root", eventId: "m1", error: "No API key" } });
	registry.project({ type: "session_processing_changed", piboSessionId: "root", processing: false, queuedMessages: 0 });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.localStatus, "error");
	assert.equal(snapshot.sessions.root.aggregateStatus, "error");
	assert.equal(snapshot.sessions.root.isTreeActive, false);
	assert.equal(snapshot.nodes["message:root:m1"].status, "error");
});

test("signal snapshot dedupes identical local errors", () => {
	const registry = createPiboSignalRegistry();
	registry.project({ type: "session_created", session: session("root") });
	registry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "root", eventId: "m1", text: "hi" } });
	registry.project({ type: "pibo_output", event: { type: "session_error", piboSessionId: "root", eventId: "m1", error: "No API key" } });

	const snapshot = registry.snapshotTree("root");
	assert.equal(snapshot.sessions.root.errors.length, 1);
	assert.deepEqual(snapshot.sessions.root.errors[0], { message: "No API key", source: "pi" });
});
