import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { EventStream, Type } from "@earendil-works/pi-ai";

function assistantToolCallMessage() {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-1", name: "delayed_tool", arguments: {} }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function assistantStream() {
	const stream = new EventStream(
		(event) => event.type === "done" || event.type === "error",
		(event) => event.type === "done" ? event.message : event.error,
	);
	queueMicrotask(() => {
		stream.push({ type: "done", reason: "toolUse", message: assistantToolCallMessage() });
	});
	return stream;
}

test("Pi ignores tool progress updates after the tool and agent run settle", async () => {
	let delayedUpdate;
	const events = [];
	const unhandledRejections = [];
	const onUnhandledRejection = (error) => unhandledRejections.push(error);
	const agent = new Agent({
		initialState: {
			tools: [{
				name: "delayed_tool",
				label: "Delayed Tool",
				description: "Captures a progress callback for a late update regression test",
				parameters: Type.Object({}),
				async execute(_toolCallId, _params, _signal, onUpdate) {
					delayedUpdate = onUpdate;
					onUpdate?.({ content: [{ type: "text", text: "running" }], details: { status: "running" } });
					return {
						content: [{ type: "text", text: "done" }],
						details: { status: "done" },
						terminate: true,
					};
				},
			}],
		},
		streamFn: assistantStream,
	});
	agent.subscribe((event) => events.push(event));
	process.on("unhandledRejection", onUnhandledRejection);
	try {
		await agent.prompt("run tool");
		const eventCountAfterPrompt = events.length;
		const updatesAfterPrompt = events.filter((event) => event.type === "tool_execution_update").length;

		assert.equal(typeof delayedUpdate, "function");
		delayedUpdate({ content: [{ type: "text", text: "late" }], details: { status: "late" } });
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(updatesAfterPrompt, 1);
		assert.equal(events.length, eventCountAfterPrompt);
		assert.deepEqual(unhandledRejections, []);
	} finally {
		process.off("unhandledRejection", onUnhandledRejection);
	}
});
