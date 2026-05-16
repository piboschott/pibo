import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboRuntimeTelemetryRecorder, turnIdForEvent } from "../dist/core/runtime-telemetry.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-runtime-telemetry-payloads-")) });
}

const session = {
	id: "ps_runtime_telemetry",
	piSessionId: "11111111-2222-4333-8444-555555555555",
	channel: "pibo.test",
	kind: "chat",
	profile: "test-profile",
	ownerScope: "user:test",
	metadata: { chatRoomId: "room_runtime_telemetry" },
	createdAt: "2026-05-16T00:00:00.000Z",
	updatedAt: "2026-05-16T00:00:00.000Z",
};

function status(queuedMessages = 0) {
	return {
		piboSessionId: session.id,
		queuedMessages,
		processing: queuedMessages > 0,
		streaming: false,
		activeTools: [],
		enabledTools: [],
		cwd: process.cwd(),
		disposed: false,
	};
}

function phaseByName(timeline, name) {
	return timeline.phases.find((phase) => phase.name === name);
}

test("runtime telemetry records queued, started, and completed turn lifecycle", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_lifecycle";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 3, text: "hello", source: "ui" }, { session, status: status(3) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "hello", source: "ui" }, { session, status: status(2) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "ui" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.piboSessionId, session.id);
		assert.equal(timeline.turn.roomId, "room_runtime_telemetry");
		assert.equal(timeline.turn.source, "ui");
		assert.equal(timeline.turn.status, "ok");
		assert.equal(timeline.turn.queuedBehind, 2);
		assert.equal(timeline.turn.queueDepth, 0);
		assert.equal(timeline.turn.eventId, eventId);
		assert.deepEqual(timeline.phases.map((phase) => [phase.name, phase.status]), [
			["queued", "ok"],
			["message_started", "ok"],
			["finish", "ok"],
		]);
	} finally {
		store.close();
	}
});

test("runtime telemetry marks active turns errored from session errors", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_error";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "boom", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "boom", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "session_error", piboSessionId: session.id, eventId, error: "Provider failed with a safe summary" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "error");
		assert.equal(timeline.turn.currentPhase, "error");
		assert.equal(timeline.phases.at(-1).name, "error");
		assert.equal(timeline.phases.at(-1).status, "error");
		assert.equal(timeline.phases.at(-1).summary, "Provider failed with a safe summary");
	} finally {
		store.close();
	}
});

test("runtime telemetry marks active turns aborted from abort execution results", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_abort";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "stop", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "stop", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "execution_result", piboSessionId: session.id, action: "abort", result: { aborted: true } }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "aborted");
		assert.equal(timeline.turn.currentPhase, "abort");
		assert.equal(timeline.phases.at(-1).name, "abort");
		assert.equal(timeline.phases.at(-1).status, "aborted");
	} finally {
		store.close();
	}
});

test("runtime telemetry captures assistant and reasoning phase transitions from normalized events", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_assistant_phases";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "hello", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "hello", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_started", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0 }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_delta", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0, text: "hidden reasoning" }, { session, status: status(0) });
		recorder.recordOutput({ type: "thinking_finished", piboSessionId: session.id, eventId, contentIndex: 0, thinkingIndex: 0 }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 1, text: "visible answer" }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_message", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 1, text: "visible answer" }, { session, status: status(0) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "ok");
		assert.equal(phaseByName(timeline, "message_started").status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "ok");
		assert.equal(phaseByName(timeline, "reasoning").status, "ok");
		assert.equal(phaseByName(timeline, "assistant_text").status, "ok");
		assert.equal(phaseByName(timeline, "finish").status, "ok");
	} finally {
		store.close();
	}
});

test("runtime telemetry keeps partial tool args open and links completed tool execution phases", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_tool_phases";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "use a tool", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "use a tool", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo" }, argsComplete: false }, { session, status: status(0) });

		let timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.currentPhase, "tool_args");
		assert.equal(phaseByName(timeline, "tool_args").status, "open");
		assert.equal(phaseByName(timeline, "tool_args").toolCallId, "call_runtime_1");

		recorder.recordOutput({ type: "tool_call", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" }, argsComplete: true }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_started", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" } }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_updated", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", args: { command: "echo hi" }, partialResult: "short" }, { session, status: status(0) });
		recorder.recordOutput({ type: "tool_execution_finished", piboSessionId: session.id, eventId, toolCallId: "call_runtime_1", toolName: "bash", result: "done", isError: false }, { session, status: status(0) });
		recorder.recordOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" }, { session, status: status(0) });

		timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "ok");
		assert.equal(phaseByName(timeline, "provider_stream").status, "ok");
		assert.equal(phaseByName(timeline, "tool_args").status, "ok");
		assert.equal(phaseByName(timeline, "tool_execution").status, "ok");
		assert.equal(phaseByName(timeline, "tool_execution").toolCallId, "call_runtime_1");
	} finally {
		store.close();
	}
});

test("runtime telemetry marks open normalized phases errored when the turn errors", () => {
	const store = createStore();
	try {
		const recorder = new PiboRuntimeTelemetryRecorder(store.telemetry);
		const eventId = "evt_phase_error";
		recorder.recordOutput({ type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "fail", source: "user" }, { session, status: status(1) });
		recorder.recordOutput({ type: "message_started", piboSessionId: session.id, eventId, text: "fail", source: "user" }, { session, status: status(0) });
		recorder.recordOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, contentIndex: 0, text: "partial" }, { session, status: status(0) });
		recorder.recordOutput({ type: "session_error", piboSessionId: session.id, eventId, error: "stream parser failed safely" }, { session, status: status(0) });

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.status, "error");
		assert.equal(phaseByName(timeline, "provider_stream").status, "error");
		assert.equal(phaseByName(timeline, "assistant_text").status, "error");
		assert.equal(phaseByName(timeline, "error").status, "error");
	} finally {
		store.close();
	}
});
