import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assert.match(source, pattern, label);
	}
}

function sortAndStripUi(value) {
	if (Array.isArray(value)) return value.map((item) => sortAndStripUi(item));
	if (value && typeof value === "object") {
		const output = {};
		for (const key of Object.keys(value).sort()) {
			if (key === "ui") continue;
			const next = sortAndStripUi(value[key]);
			if (next !== undefined) output[key] = next;
		}
		return output;
	}
	return value;
}

function runtimeSemanticsJson(definition) {
	return JSON.stringify(sortAndStripUi(definition));
}

test("Workflow V2 builder tests cover visual editing and publish flow", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowsAreaSource = await readSource("src/apps/chat-ui/src/WorkflowsArea.tsx");

	assertAllMatch(webChannelTests, [
		["duplicate/open builder wrappers are integration-tested", /workflow builder draft loader opens starter and duplicated UI draft wrappers/],
		["builder loader never exposes raw XState source", /starterPayload\.draft\.definition\.xstate, undefined[\s\S]*loadedDuplicatePayload\.draft\.definition\.xstate, undefined/],
		["graph editing adds a node", /graphEditedDefinition\.nodes\.agent_2 = \{/],
		["graph editing connects an edge", /graphEditedDefinition\.edges\.edge_agent_to_agent_2 = \{/],
		["graph editing saves manual layout positions", /graphEditedDefinition\.ui = \{[\s\S]*layout: "manual"[\s\S]*positions:[\s\S]*agent_2: \{ x: 420, y: 100 \}/],
		["prompt editing is covered by prompt asset revisions", /workflow prompt asset revisions create managed assets and draft prompt refs[\s\S]*editTrigger: "prompt_edit"/],
		["schema editing is covered by subset diagnostics", /editTrigger: "schema_edit"[\s\S]*WorkflowInterfaceError\.unsupportedSchemaKeyword/],
		["manual validate route is covered", /\/api\/chat\/workflows\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/validate[\s\S]*validatePayload\.validation\.trigger, "prompt_edit"/],
		["publish rejection is covered for invalid drafts", /publishPayload\.validation\.trigger, "before_publish"[\s\S]*publishPayload\.validation\.blocksPublish, true/],
		["publish success and version allocation are covered", /workflow draft publish allocates patch, minor, and major versions[\s\S]*patchPublish\.payload\.publishedVersion\.version, "2\.0\.1"/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["graph canvas exposes the add-node control", /Add Agent node/],
		["graph canvas exposes the connect-edge control", /Connect nodes/],
		["graph canvas exposes the layout save control", /Save layout/],
		["layout copy states runtime semantics are unchanged", /Saving layout writes only display metadata and does not change nodes, edges, ports, guards, adapters, runtime routing, or validation semantics/],
		["publish panel exposes validation and publish actions", /Validate draft[\s\S]*Publish draft/],
	]);
});

test("Workflow V2 builder tests cover raw IR safe sync and last-valid preservation", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowsAreaSource = await readSource("src/apps/chat-ui/src/WorkflowsArea.tsx");

	assertAllMatch(webChannelTests, [
		["raw IR valid sync patches through rawDefinitionText", /rawDefinitionText: JSON\.stringify\(validDefinition\)[\s\S]*rawPatchPayload\.validation\.trigger, "raw_ir_edit"[\s\S]*rawPatchPayload\.validation\.ok, true/],
		["invalid raw JSON returns warning diagnostics", /rawDefinitionText: "\{ invalid raw workflow ir"[\s\S]*WorkflowBuilderWarning\.invalidRawIrText/],
		["invalid raw JSON preserves the previous revision", /invalidRawPatchPayload\.draft\.revision, rawPatchPayload\.draft\.revision/],
		["invalid raw JSON preserves the last valid definition", /assert\.deepEqual\(invalidRawPatchPayload\.draft\.definition, rawPatchPayload\.draft\.definition\)/],
		["reloading after invalid raw JSON keeps the last valid object", /reloadedAfterInvalidRawPayload\.draft\.revision, rawPatchPayload\.draft\.revision[\s\S]*assert\.deepEqual\(reloadedAfterInvalidRawPayload\.draft\.definition, rawPatchPayload\.draft\.definition\)/],
		["raw repair clears invalid raw warning", /rawRepairDefinition\.title = "Raw IR safe sync"[\s\S]*code === "WorkflowBuilderWarning\.invalidRawIrText"\), false/],
		["invalid workflow diagnostics remain covered after raw sync", /invalidDefinition\.nodes\.agent\.profile\.id = "missing-workflow-profile"[\s\S]*WorkflowGraphError\.unknownAgentProfileRef/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["raw editor submits rawDefinitionText", /patchWorkflowDraft\(draft\.draftId, \{ rawDefinitionText: rawText, editTrigger: "raw_ir_edit" \}\)/],
		["raw editor preserves invalid text for repair", /Raw Workflow IR text was not saved; the last valid draft object remains unchanged/],
		["raw editor renders the last valid object separately", /Last valid Pibo Workflow IR object/],
		["raw editor says XState is not editable", /raw XState JSON is not exposed here/],
	]);
});

test("Workflow Builder layout metadata does not change serialized runtime semantics", () => {
	const baseDefinition = {
		id: "layout-semantics-workflow",
		title: "Layout semantics workflow",
		version: "1.0.0",
		input: { kind: "json", schema: { type: "object" } },
		output: { kind: "json", schema: { type: "object" } },
		nodes: {
			agent: {
				kind: "agent",
				runtime: "pibo",
				profile: { kind: "fixed", id: "pibo-agent" },
				promptTemplate: "Summarize the input.",
				ui: { position: { x: 80, y: 80 } },
			},
		},
		edges: {},
		ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
	};
	const movedDefinition = structuredClone(baseDefinition);
	movedDefinition.ui = { layout: "manual", positions: { agent: { x: 320, y: 180 } } };
	movedDefinition.nodes.agent.ui = { position: { x: 320, y: 180 } };

	assert.notDeepEqual(baseDefinition.ui, movedDefinition.ui);
	assert.notDeepEqual(baseDefinition.nodes.agent.ui, movedDefinition.nodes.agent.ui);
	assert.equal(runtimeSemanticsJson(movedDefinition), runtimeSemanticsJson(baseDefinition));
});
