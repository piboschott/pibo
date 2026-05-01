import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { createSubagentToolDefinitions, createSubagentToolName } from "../dist/subagents/tool.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { findCliToolEntry, getInstalledCliToolContextFile } from "../dist/tools/registry.js";
import { getToolPythonRuntimePaths } from "../dist/tools/python-runtime.js";

const noopSubagentRunner = {
	async runSubagent(input) {
		return {
			piboSessionId: "ps_child",
			eventId: "event-1",
			reply: {
				type: "assistant_message",
				piboSessionId: "ps_child",
				eventId: "event-1",
				text: `helper result for ${input.subagent.name}`,
			},
		};
	},
};

async function withPiboHome(piboHome, run) {
	const previous = process.env.PIBO_HOME;
	process.env.PIBO_HOME = piboHome;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previous;
	}
}

test("subagent helpers create stable tool names and reject collisions", () => {
	assert.equal(createSubagentToolName("research-helper"), "pibo_subagent_research_helper");
	assert.equal(createSubagentToolName("Research Helper"), "pibo_subagent_research_helper");
	assert.throws(
		() =>
			createSubagentToolDefinitions(
				[
					{ name: "same-name", targetProfile: "helper-profile" },
					{ name: "same_name", targetProfile: "helper-profile" },
				],
				noopSubagentRunner,
			),
		/Duplicate subagent tool name "pibo_subagent_same_name"/,
	);
});

test("session context builder preserves Pi parent session ids", () => {
	const context = new InitialSessionContextBuilder("child-profile")
		.withSessionId("child-session")
		.withParentSessionId("parent-session")
		.createSession();

	assert.equal(context.sessionId, "child-session");
	assert.equal(context.parentSessionId, "parent-session");
});

test("profiles can disable automatic AGENTS.md context discovery", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-context-files-"));
	writeFileSync(join(cwd, "AGENTS.md"), "automatic workspace instructions", "utf-8");
	writeFileSync(join(cwd, "profile-context.md"), "explicit profile context", "utf-8");
	const profile = new InitialSessionContextBuilder("context-profile")
		.withAutoContextFiles(false)
		.addContextFile({ path: "profile-context.md" })
		.createSession();

	await withPiboHome(join(cwd, "pibo-home"), async () => {
		const inspection = await inspectPiboProfile({ cwd, profile, persistSession: false });
		const contextFileNames = inspection.contextFiles.map((contextFile) => basename(contextFile.path));

		assert.deepEqual(contextFileNames, ["profile-context.md"]);
	});
});

test("installed pibo tools are injected into the runtime context and disappear when removed", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-installed-tools-context-"));
	const profile = new InitialSessionContextBuilder("context-profile").withAutoContextFiles(false).createSession();
	const browserUse = findCliToolEntry("browser-use");

	assert.ok(browserUse);

	await withPiboHome(join(cwd, "pibo-home"), async () => {
		const paths = getToolPythonRuntimePaths(browserUse.name, browserUse.runtime);
		mkdirSync(paths.binDir, { recursive: true });
		writeFileSync(paths.executablePath, "#!/bin/sh\n");

		const toolContextFile = getInstalledCliToolContextFile();
		assert.ok(toolContextFile);
		assert.equal(toolContextFile.path, ".pibo/context/installed-pibo-tools.md");
		assert.match(toolContextFile.content, /# Installed Pibo Tools/);
		assert.match(toolContextFile.content, /## browser-use/);
		assert.match(toolContextFile.content, /tools env browser-use/);
		assert.match(toolContextFile.content, /tools browser-use lease acquire/);

		const withToolInstalled = await inspectPiboProfile({ cwd, profile, persistSession: false });
		assert.equal(
			withToolInstalled.contextFiles.some((contextFile) => contextFile.path === toolContextFile.path),
			true,
		);

		rmSync(paths.rootDir, { recursive: true, force: true });

		assert.equal(getInstalledCliToolContextFile(), undefined);

		const afterRemoval = await inspectPiboProfile({ cwd, profile, persistSession: false });
		assert.equal(
			afterRemoval.contextFiles.some((contextFile) => contextFile.path === ".pibo/context/installed-pibo-tools.md"),
			false,
		);
	});
});

test("subagent tool definitions delegate execution to the provided runner", async () => {
	let observed;
	const [tool] = createSubagentToolDefinitions(
		[
			{
				name: "helper",
				description: "Ask the helper agent.",
				targetProfile: "helper-profile",
			},
		],
		{
			async runSubagent(input) {
				observed = input;
				return noopSubagentRunner.runSubagent(input);
			},
		},
	);

	assert.equal(tool.name, "pibo_subagent_helper");
	assert.equal(tool.executionMode, "parallel");

	const result = await tool.execute("tool-call-1", {
		message: "Find the relevant files.",
		threadKey: "files",
	});

	assert.equal(observed.message, "Find the relevant files.");
	assert.equal(observed.threadKey, "files");
	assert.equal(observed.toolCallId, "tool-call-1");
	assert.equal(result.details.piboSessionId, "ps_child");
	assert.equal(result.content[0].text, "helper result for helper");
});

test("profiles can expose subagents as active router tools", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	registry.registerPlugin(
		definePiboPlugin({
			id: "test.subagents",
			register(api) {
				api.registerSubagent({
					name: "helper",
					description: "Ask the helper profile.",
					targetProfile: "helper-profile",
				});
				api.registerProfile({
					name: "parent-profile",
					create(context) {
						return new InitialSessionContextBuilder("parent-profile")
							.addSubagent(context.getSubagent("helper"))
							.createSession();
					},
				});
				api.registerProfile({
					name: "helper-profile",
					create() {
						return new InitialSessionContextBuilder("helper-profile").createSession();
					},
				});
			},
		}),
	);

	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "parent-profile",
		ownerScope: "user:test",
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
	});

	try {
		const output = await router.emit({
			type: "execution",
			piboSessionId: "ps_parent",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("pibo_subagent_helper"), true);
	} finally {
		await router.disposeAll();
	}
});

test("subagent runner emits a parent link event before waiting for the child reply", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_parent",
		piSessionId: "parent-session",
		channel: "pibo.test",
		kind: "chat",
		profile: "pibo-run-yield-qa",
		ownerScope: "user:test",
		metadata: { chatRoomId: "room_parent" },
	});
	const router = new PiboSessionRouter({ persistSession: false, sessionStore: store });
	const events = [];
	router.subscribe((event) => events.push(event));
	router.emitMessageAndWaitForReply = async (event) => ({
		type: "assistant_message",
		piboSessionId: event.piboSessionId,
		eventId: event.id,
		text: "child reply",
	});

	try {
		const runner = router.createSubagentRunner("ps_parent");
		const result = await runner.runSubagent({
			subagent: { name: "qa-researcher", targetProfile: "pibo-minimal" },
			message: "check this",
			threadKey: "qa",
			toolCallId: "tool-1",
		});
		const linkEvent = events.find((event) => event.type === "subagent_session");

		assert.equal(linkEvent.piboSessionId, "ps_parent");
		assert.equal(linkEvent.toolCallId, "tool-1");
		assert.equal(linkEvent.toolName, "pibo_subagent_qa_researcher");
		assert.equal(linkEvent.subagentName, "qa-researcher");
		assert.equal(linkEvent.childPiboSessionId, result.piboSessionId);
		assert.equal(linkEvent.threadKey, "qa");
		assert.equal(store.get(result.piboSessionId).parentId, "ps_parent");
		assert.equal(store.get(result.piboSessionId).metadata.chatRoomId, "room_parent");
	} finally {
		await router.disposeAll();
	}
});

test("default run-yield QA profile exposes run control tools", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("run-yield-qa");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.map((tool) => tool.name));

	assert.deepEqual(
		inspection.subagents.map((subagent) => subagent.name),
		["qa-researcher", "qa-reviewer"],
	);
	assert.equal(activeTools.has("pibo_echo"), true);
	assert.equal(activeTools.has("pibo_workspace_info"), true);
	assert.equal(activeTools.has("pibo_exec"), true);
	assert.equal(activeTools.has("pibo_subagent_qa_researcher"), true);
	assert.equal(activeTools.has("pibo_subagent_qa_reviewer"), true);
	assert.equal(activeTools.has("pibo_run_start"), true);
	assert.equal(activeTools.has("pibo_run_list"), true);
	assert.equal(activeTools.has("pibo_run_wait"), true);
	assert.equal(activeTools.has("pibo_run_read"), true);
	assert.equal(activeTools.has("pibo_run_cancel"), true);
	assert.equal(activeTools.has("pibo_run_ack"), true);
	assert.equal(inspection.subagents.every((subagent) => subagent.active), true);
	assert.equal(inspection.diagnostics.length, 0);
});
