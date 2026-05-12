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

test("Workflow V2 lifecycle tests cover immutable publish records and registry visibility", async () => {
	const publishedVersionTests = await readSource("packages/workflows/src/testing/workflow-published-versions.test.ts");
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(publishedVersionTests, [
		["published records store a definition hash", /assert\.equal\(record\.definitionHash, hashWorkflowDefinition\(definition\)\)/],
		["published records hydrate registry lookup by id and version", /registerWorkflowPublishedVersion\(registry, record\)[\s\S]*resolveWorkflowDefinition\(registry, definition\.id, definition\.version\)/],
		["published version bodies are immutable", /rejects attempts to replace an existing published definition body[\s\S]*assert\.throws\(\(\) => store\.savePublishedWorkflowVersion\(changedRecord\), \/immutable\//],
	]);

	assertAllMatch(catalogEntityTests, [
		["catalog entities keep identity, draft, published, archive, and tombstone records separate", /stores identity, draft, published version, archive, and tombstone records as separate entities/],
		["published catalog entities assert source and status", /assert\.equal\(published\.source, "ui"\)[\s\S]*assert\.equal\(published\.status, "published"\)/],
	]);

	assertAllMatch(webChannelTests, [
		["catalog lifecycle integration publishes UI versions", /workflow catalog lifecycle APIs create, validate, publish, and expose version resources/],
		["published API response includes a sha256 definition hash", /assert\.match\(publishPayload\.publishedVersion\.definitionHash, \/\^sha256:\[a-f0-9\]\{64\}\$\/\)/],
		["version list exposes published UI records", /versionsPayload\.versions\.map\(\(version\) => `\$\{version\.version\}:\$\{version\.source\}:\$\{version\.status\}`\)[\s\S]*\["0\.1\.1:ui:published"\]/],
		["version inspect resolves a published definition", /versionInspectPayload\.version\.status, "published"[\s\S]*versionInspectPayload\.definition\.id, "ui-lifecycle-api-draft"/],
	]);
});

test("Workflow V2 lifecycle tests cover version bumps and one-active-draft enforcement", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["draft store rejects a second active draft for one workflow identity", /persists partial invalid UI drafts and enforces one active draft per workflow identity[\s\S]*already has an active draft/],
	]);

	assertAllMatch(webChannelTests, [
		["patch, minor, and major version bumps are integration-tested", /workflow draft publish allocates patch, minor, and major versions/],
		["default patch publish allocates the next patch version", /patchPublish\.payload\.publishedVersion\.version, "2\.0\.1"[\s\S]*patch version bump/],
		["publishing the same draft again is idempotent", /repeatedPatchPublish\.payload\.alreadyPublished, true[\s\S]*repeatedPatchPublish\.payload\.publishedVersion\.version, "2\.0\.1"/],
		["minor intent allocates the next minor version", /minorPublish\.payload\.publishedVersion\.version, "1\.1\.0"/],
		["major intent allocates the next major version", /majorPublish\.payload\.publishedVersion\.version, "2\.0\.0"/],
		["published version rows are persisted in durable storage", /SELECT workflow_id, version FROM workflow_published_versions[\s\S]*ui-review-workflow[\s\S]*2\.0\.1/],
		["edit-published creates then reuses one next-version draft", /workflow published edit creates or reuses one next-version draft[\s\S]*createPayload\.reused, false[\s\S]*reusePayload\.reused, true/],
	]);
});

test("Workflow V2 lifecycle tests cover archive filters, delete tombstones, and historical snapshots", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const lifecycleUiTests = await readSource("test/workflow-v2-lifecycle-confirmation-ui.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["delete tombstones preserve definition snapshots at the store layer", /records delete tombstones without removing historical definition snapshots[\s\S]*listDefinitionSnapshots\(\{ workflowId: definition\.id \}\)/],
	]);

	assertAllMatch(webChannelTests, [
		["archive API applies at workflow identity scope", /workflow archive API applies at workflow identity scope and hides archived workflows from selection/],
		["archived workflows are hidden from the default catalog", /defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false/],
		["archived workflows are visible through includeArchived", /archivedCatalogPayload\.workflows\.find\(\(workflow\) => workflow\.id === "ui-review-workflow"\)[\s\S]*archivedWorkflow\.status, "archived"/],
		["archived workflows are hidden from Project workflow-version pickers", /pickerPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false/],
		["archived workflows remain in version history", /historyPayload\.options\.some\(\(option\) => `\$\{option\.id\}@\$\{option\.version\}:\$\{option\.status\}` === "ui-review-workflow@2\.0\.0:archived"\)/],
		["delete API tombstones UI workflows while preserving Project snapshots", /workflow delete API tombstones UI workflows while preserving Project snapshots/],
		["delete requires authentication and exact workflow id confirmation", /unauthenticatedDelete\.status, 401[\s\S]*badConfirmation\.status, 400[\s\S]*Type "ui-review-workflow"/],
		["delete tombstone captures last-known workflow metadata", /deletePayload\.tombstone\.lastKnownTitle, "UI Review Workflow"[\s\S]*deletePayload\.tombstone\.lastKnownVersion, "2\.0\.0"[\s\S]*lastDefinitionHash/],
		["deleted workflows are absent from catalog, picker, version history, inspect, and duplicate surfaces", /defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false[\s\S]*archivedCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false[\s\S]*pickerPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false[\s\S]*historyPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false[\s\S]*inspectDeletedResponse\.status, 404[\s\S]*duplicateDeletedResponse\.status, 404/],
		["Project bootstrap renders deleted-definition snapshot-only links", /workflowDefinitionLink\.status, "snapshot_only_definition_deleted"[\s\S]*workflowDefinitionLink\.href, undefined/],
		["historical restart returns the existing run and immutable saved snapshot", /historicalRunPayload\.alreadyStarted, true[\s\S]*historicalRunPayload\.snapshot\.id, sessionPayload\.snapshot\.id[\s\S]*historicalRunPayload\.snapshot\.effectiveDefinition, sessionPayload\.snapshot\.effectiveDefinition/],
	]);

	assertAllMatch(lifecycleUiTests, [
		["UI source tests cover archive/delete confirmation safeguards", /Workflow Library renders deliberate archive and delete confirmation copy/],
		["delete confirmation requires typing the workflow id", /Workflow Library delete confirmation requires typing the workflow id/],
	]);
});
