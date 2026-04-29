import assert from "node:assert/strict";
import test from "node:test";
import { traceNodesFromEntries } from "../dist/apps/chat/trace.js";

test("chat trace preserves assistant content part order", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-1",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "first reason" },
					{ type: "text", text: "then answer" },
				],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => node.type),
		["model.reasoning", "assistant.message"],
	);
	assert.equal(nodes[0].output, "first reason");
	assert.equal(nodes[1].output, "then answer");
	assert.equal(nodes[0].parentId, undefined);
	assert.equal(nodes[1].parentId, undefined);
});

test("chat trace groups tool calls with the final assistant response", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "user-1",
			parentId: "root",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "read files" }],
			},
		},
		{
			type: "message",
			id: "assistant-tools",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "plan" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "RULES.md" } },
					{ type: "toolCall", id: "tool-2", name: "read", arguments: { path: "package.json" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-1",
			parentId: "assistant-tools",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [{ type: "text", text: "rules" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "result-2",
			parentId: "result-1",
			timestamp: "2026-04-29T08:00:03.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-2",
				toolName: "read",
				content: [{ type: "text", text: "package" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-final",
			parentId: "result-2",
			timestamp: "2026-04-29T08:00:04.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "final answer" }],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => node.type),
		["user.message", "model.reasoning", "assistant.message"],
	);
	const response = nodes[2];
	assert.equal(response.output, "final answer");
	assert.equal(response.children.length, 2);
	assert.deepEqual(
		response.children.map((node) => [node.type, node.toolCallId, node.output.content[0].text]),
		[
			["tool.call", "tool-1", "rules"],
			["tool.call", "tool-2", "package"],
		],
	);
});
