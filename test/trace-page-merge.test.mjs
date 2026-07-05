import assert from "node:assert/strict";
import test from "node:test";
import { mergeOlderTracePage } from "../dist/shared/trace-page-merge.js";

test("mergeOlderTracePage dedupes overlapping nested timeline nodes", () => {
	const current = traceView({
		nodes: [
			node("turn-1", {
				type: "agent.turn",
				children: [
					node("assistant-1", {
						parentId: "turn-1",
						type: "assistant.message",
						output: "current assistant text",
					}),
					node("tool-2", {
						parentId: "turn-1",
						type: "tool.call",
						title: "bash",
					}),
				],
			}),
		],
		nextBeforeSequence: 100,
	});
	const older = traceView({
		nodes: [
			node("assistant-1", {
				parentId: "turn-1",
				type: "assistant.message",
				output: "older duplicate assistant text",
			}),
			node("turn-1", {
				type: "agent.turn",
				children: [
					node("tool-1", {
						parentId: "turn-1",
						type: "tool.call",
						title: "read",
					}),
					node("assistant-1", {
						parentId: "turn-1",
						type: "assistant.message",
						output: "older duplicate assistant text",
					}),
				],
			}),
		],
		nextBeforeSequence: 50,
	});

	const merged = mergeOlderTracePage(current, older);
	const flat = flattenNodes(merged.nodes);
	const ids = flat.map((entry) => entry.id);

	assert.equal(ids.filter((id) => id === "assistant-1").length, 1);
	assert.deepEqual(new Set(ids), new Set(["turn-1", "tool-1", "assistant-1", "tool-2"]));
	assert.equal(flat.find((entry) => entry.id === "assistant-1")?.output, "current assistant text");
	assert.equal(merged.nextBeforeSequence, 50);
	assert.equal(merged.hasOlderEvents, true);
});

function traceView(overrides = {}) {
	return {
		piboSessionId: "ps_test",
		piSessionId: "pi_test",
		title: "Test",
		version: "v1",
		latestStreamId: 1,
		eventCount: 0,
		eventLimit: 50,
		pageSize: 50,
		firstEventSequence: 1,
		lastEventSequence: 100,
		nextBeforeSequence: undefined,
		hasOlderEvents: true,
		nodes: [],
		rawEvents: [],
		...overrides,
	};
}

function node(id, overrides = {}) {
	return {
		id,
		type: "tool.call",
		title: id,
		status: "done",
		startedAt: "2026-07-05T00:00:00.000Z",
		children: [],
		...overrides,
	};
}

function flattenNodes(nodes) {
	const result = [];
	const stack = [...nodes].reverse();
	while (stack.length) {
		const current = stack.pop();
		result.push(current);
		for (let index = current.children.length - 1; index >= 0; index -= 1) {
			stack.push(current.children[index]);
		}
	}
	return result;
}
