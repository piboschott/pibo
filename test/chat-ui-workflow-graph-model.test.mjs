import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runWorkflowGraphModelScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			createWorkflowGraphProjection,
			nextGraphNodePosition,
			projectionHasElement,
			readEdgeEndpointNodeId,
			readWorkflowEdgeDefinitions,
			readWorkflowNodeDefinitions,
			readWorkflowPositions,
			workflowInitialNodeIds,
			workflowNodeKind,
			workflowNodeLabel,
		} from "./src/apps/chat-ui/src/workflows/workflow-graph-model.ts";

		const definition = {
			initial: ["agent_1", 42, "adapter_1"],
			nodes: {
				agent_1: { kind: "agent", label: "  Agent Start  " },
				adapter_1: { kind: "adapter", ui: { position: { x: 310, y: 90 } } },
				human_1: { kind: "human" },
				ignored: "not an object",
			},
			edges: {
				edge_valid: { from: { nodeId: "agent_1" }, to: { nodeId: "adapter_1" }, kind: "control" },
				edge_default_kind: { from: { nodeId: "adapter_1" }, to: { nodeId: "human_1" } },
				edge_missing_target: { from: { nodeId: "human_1" }, to: { nodeId: "missing" } },
				ignored: null,
			},
			ui: {
				positions: {
					agent_1: { x: 100, y: 200 },
					invalid: { x: "bad", y: 0 },
				},
			},
		};
		const diagnostics = [
			{ code: "direct", message: "direct", severity: "error", nodeId: "agent_1" },
			{ code: "path", message: "path", severity: "warning", path: "$.nodes.agent_1.input" },
			{ code: "other", message: "other", severity: "warning", path: "$.nodes.adapter_1" },
		];

		const projection = createWorkflowGraphProjection(definition, diagnostics);
		assert.deepEqual(projection.nodes.map((node) => node.id), ["agent_1", "adapter_1", "human_1"]);
		assert.equal(projection.usedAutoLayout, true);
		assert.equal(projection.missingPositionCount, 1);
		assert.deepEqual(projection.nodes[0].position, { x: 100, y: 200 });
		assert.deepEqual(projection.nodes[1].position, { x: 310, y: 90 });
		assert.deepEqual(projection.nodes[2].position, { x: 80, y: 230 });
		assert.equal(projection.nodes[0].data.label, "Agent Start");
		assert.equal(projection.nodes[2].data.label, "Human human_1");
		assert.equal(projection.nodes[0].data.validationCount, 2);
		assert.equal(projection.nodes[1].data.validationCount, 1);
		assert.equal(projection.nodes[0].data.isInitial, true);
		assert.equal(projection.nodes[2].data.isInitial, false);

		assert.deepEqual(projection.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label]), [
			["edge_valid", "agent_1", "adapter_1", "control"],
			["edge_default_kind", "adapter_1", "human_1", "data"],
		]);
		assert.equal(projectionHasElement(projection, { type: "node", id: "human_1" }), true);
		assert.equal(projectionHasElement(projection, { type: "edge", id: "edge_missing_target" }), false);

		assert.deepEqual(Object.keys(readWorkflowNodeDefinitions(definition)), ["agent_1", "adapter_1", "human_1"]);
		assert.deepEqual(Object.keys(readWorkflowEdgeDefinitions(definition)), ["edge_valid", "edge_default_kind", "edge_missing_target"]);
		assert.deepEqual(readWorkflowPositions(definition), { agent_1: { x: 100, y: 200 } });
		assert.deepEqual(workflowInitialNodeIds(definition), ["agent_1", "adapter_1"]);
		assert.equal(workflowNodeKind({}), "node");
		assert.equal(workflowNodeLabel("fallback", {}), "Node fallback");
		assert.equal(readEdgeEndpointNodeId({ nodeId: "  human_1  " }), "human_1");
		assert.deepEqual(nextGraphNodePosition(projection.nodes), { x: 80, y: 230 });
	`;
	return execFileAsync("npx", ["tsx", "--eval", script], {
		cwd: "/workspace",
		maxBuffer: 1024 * 1024,
	});
}

test("workflow graph model projects nodes, edges, positions, and diagnostics", async () => {
	const { stdout, stderr } = await runWorkflowGraphModelScenario();
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
