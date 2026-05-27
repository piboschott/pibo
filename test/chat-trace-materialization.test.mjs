import assert from "node:assert/strict";
import test from "node:test";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { createTraceViewVersion } from "../dist/apps/chat/trace.js";

const now = "2026-01-01T00:00:00.000Z";

function session(overrides = {}) {
	return {
		id: "ps_root",
		piSessionId: "pi_root",
		channel: "chat-web",
		kind: "chat",
		profile: "default",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		...overrides,
	};
}

function storedEvent(sequence, text) {
	return {
		id: `event-${sequence}`,
		piboSessionId: "ps_root",
		eventSequence: sequence,
		type: "message_queued",
		createdAt: `2026-01-01T00:00:0${sequence}.000Z`,
		payload: {
			type: "message_queued",
			eventId: `turn-${sequence}`,
			piboSessionId: "ps_root",
			source: "user",
			text,
		},
	};
}

function runNotificationText(notification) {
	return `<pibo_run_notification>${JSON.stringify(notification)}</pibo_run_notification>`;
}

test("trace engine omits raw events by default", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [storedEvent(1, "hello")],
	});

	assert.equal(view.rawEvents.length, 0);
	assert.deepEqual(view.nodes.map((node) => node.type), ["user.message"]);
});

test("raw event tail is opt-in and bounded", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [storedEvent(1, "one"), storedEvent(2, "two"), storedEvent(3, "three")],
		includeRawEvents: true,
		rawEventsLimit: 2,
	});

	assert.deepEqual(view.rawEvents.map((event) => event.id), ["event-2", "event-3"]);
	assert.deepEqual(view.nodes.map((node) => node.summary), ["one", "two", "three"]);
});

test("legacy transcript run notifications render yielded-run nodes", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-run-note",
				type: "message",
				timestamp: now,
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: runNotificationText({
								completed: [{ runId: "run_done" }],
								failed: [{ runId: "run_failed" }],
							}),
						},
					],
				},
			},
		],
		events: [],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "yielded.run");
	assert.equal(view.nodes[0].title, "Run Notification");
	assert.equal(view.nodes[0].status, "error");
	assert.equal(view.nodes[0].summary, "1 completed, 1 failed");
	assert.equal(view.nodes[0].source, "transcript");
	assert.equal(view.nodes[0].runId, undefined);
});

test("service run notification events render running yielded-run nodes", () => {
	const event = storedEvent(1, runNotificationText({ running: [{ runId: "run_active" }] }));
	event.payload.source = "service";

	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [event],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "yielded.run");
	assert.equal(view.nodes[0].status, "running");
	assert.equal(view.nodes[0].summary, "1 running");
	assert.equal(view.nodes[0].runId, "run_active");
	assert.equal(view.nodes[0].source, "event-log");
});

test("subagent tool events link likely child sessions by tool name and thread key", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		sessions: [
			{
				id: "ps_child",
				parentId: "ps_root",
				updatedAt: now,
				metadata: { subagentToolName: "pibo_subagent_researcher", threadKey: "qa" },
			},
		],
		events: [
			{
				id: "event-subagent-tool",
				piboSessionId: "ps_root",
				eventSequence: 1,
				type: "tool_call",
				createdAt: now,
				payload: {
					type: "tool_call",
					piboSessionId: "ps_root",
					eventId: "turn-1",
					toolCallId: "tool-subagent",
					toolName: "pibo_subagent_researcher",
					args: { message: "inspect", threadKey: "qa" },
				},
			},
		],
		status: "running",
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "agent.delegation");
	assert.equal(view.nodes[0].linkedPiboSessionId, "ps_child");
});

test("v2 event mapper preserves session error details for trace rendering", () => {
	const event = storedPiboEventFromV2Row({
		stream_id: 42,
		session_id: "ps_root",
		session_sequence: 7,
		room_id: "room_1",
		topic: "pibo.output",
		type: "session_error",
		source: "actor",
		actor_type: "agent",
		actor_id: "agent",
		turn_id: "turn_1",
		event_id: "turn_1",
		tool_call_id: null,
		run_id: null,
		workflow_run_id: null,
		idempotency_key: "err_1",
		retention_class: "trace_event",
		payload_ref: null,
		preview_text: "WebSocket error",
		attributes_json: JSON.stringify({
			error: "WebSocket error",
			errorDetails: { provider: "openai-codex", model: "gpt-5.5" },
		}),
		created_at: now,
	});

	assert.equal(event.payload.type, "session_error");
	assert.equal(event.payload.error, "WebSocket error");
	assert.equal(event.payload.errorDetails.errorClass, "provider_transport");
	assert.equal(event.payload.errorDetails.code, "websocket_error");
	assert.equal(event.payload.errorDetails.provider, "openai-codex");
	assert.equal(event.payload.errorDetails.model, "gpt-5.5");

	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [event],
	});

	assert.equal(view.nodes[0].type, "error");
	assert.equal(view.nodes[0].title, "Session Error");
	assert.equal(view.nodes[0].error, "WebSocket error");
	assert.equal(view.nodes[0].input.errorClass, "provider_transport");
	assert.equal(view.nodes[0].input.code, "websocket_error");
});

test("trace version changes for transcript metadata", () => {
	const base = {
		session: session(),
		sessions: [session()],
		events: [storedEvent(1, "hello")],
		status: "idle",
		latestStreamId: 7,
	};
	const first = createTraceViewVersion({
		...base,
		metadata: { sessionPath: "/tmp/session.jsonl", sessionSize: 10, sessionMtimeMs: 100, modified: now },
	});
	const second = createTraceViewVersion({
		...base,
		metadata: { sessionPath: "/tmp/session.jsonl", sessionSize: 11, sessionMtimeMs: 100, modified: now },
	});

	assert.notEqual(first, second);
});

test("trace version changes when child or origin sessions change", () => {
	const root = session();
	const child = session({ id: "ps_child", piSessionId: "pi_child", parentId: "ps_root" });
	const fork = session({ id: "ps_fork", piSessionId: "pi_fork", originId: "ps_root" });
	const first = createTraceViewVersion({
		session: root,
		sessions: [root, child, fork],
		events: [],
		status: "idle",
	});
	const second = createTraceViewVersion({
		session: root,
		sessions: [root, { ...child, updatedAt: "2026-01-01T00:01:00.000Z" }, fork],
		events: [],
		status: "idle",
	});
	const third = createTraceViewVersion({
		session: root,
		sessions: [root, child, { ...fork, originId: "ps_child" }],
		events: [],
		status: "idle",
	});

	assert.notEqual(first, second);
	assert.notEqual(first, third);
});
