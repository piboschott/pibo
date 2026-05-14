import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readWorkflowsAreaSource() {
	return readFile(new URL("../src/apps/chat-ui/src/WorkflowsArea.tsx", import.meta.url), "utf8");
}

test("Workflow Builder publish panel gates publish on error diagnostics", async () => {
	const source = await readWorkflowsAreaSource();

	assert.match(source, /publishErrorCount/);
	assert.match(source, /publishBlocked = currentDraft\.validation\?\.blocksPublish === true \|\| publishErrorCount > 0/);
	assert.match(source, /aria-label="Workflow publish gate"/);
	assert.match(source, /Publish is disabled because/);
	assert.match(source, /Draft save remains allowed while you fix errors/);
	assert.match(source, /workflow input\/output ports and at least one node/);
	assert.match(source, /Warnings do not block publishing/);
	assert.match(source, /disabled=\{publishActionBusy \|\| publishBlocked\}/);
	assert.match(source, /aria-describedby="workflow-publish-gate"/);
});
