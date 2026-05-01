import assert from "node:assert/strict";
import { basename } from "node:path";
import test from "node:test";
import { buildCodexCompatSystemPrompt, addCodexCompatWebSearchProviderTool } from "../dist/core/codex-compat.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";

test("default registry exposes the codex-compatible profile and tool surface", () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex");

	assert.equal(profile.profileName, "codex-compat");
	assert.equal(profile.builtinTools, "disabled");
	assert.equal(profile.toolPackages.codexCompat, true);
	assert.deepEqual(
		profile.tools.map((tool) => tool.name),
		[
			"exec_command",
			"write_stdin",
			"apply_patch",
			"web_search",
			"view_image",
			"spawn_agent",
			"send_input",
			"resume_agent",
			"wait_agent",
			"close_agent",
		],
	);
	assert.deepEqual(
		profile.subagents.map((subagent) => subagent.name),
		["default", "explorer", "worker"],
	);
});

test("codex-compatible profile inspection shows active generated tools and provider web search", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex-compat");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.filter((tool) => tool.active).map((tool) => tool.name));

	for (const toolName of [
		"exec_command",
		"write_stdin",
		"apply_patch",
		"web_search",
		"view_image",
		"spawn_agent",
		"send_input",
		"resume_agent",
		"wait_agent",
		"close_agent",
	]) {
		assert.equal(activeTools.has(toolName), true, `${toolName} should be active`);
	}
	assert.deepEqual(
		inspection.contextFiles
			.map((contextFile) => basename(contextFile.path))
			.filter((path) => /^(?:AGENTS|RULES|GLOSSARY)\.md$/.test(path)),
		["AGENTS.md", "RULES.md", "GLOSSARY.md"],
	);
	assert.equal(inspection.subagents.every((subagent) => subagent.active), false);
});

test("codex-compatible prompt adds environment and child-agent framing without plan-mode tools", () => {
	const prompt = buildCodexCompatSystemPrompt({
		baseSystemPrompt: "Base prompt with AGENTS.md, RULES.md, and GLOSSARY.md content.",
		cwd: "/repo",
		shell: "bash",
		currentDate: "2026-05-02",
		timezone: "Europe/Berlin",
		isChildSession: true,
	});

	assert.match(prompt, /# Codex-Compatible Runtime/);
	assert.match(prompt, /<cwd>\/repo<\/cwd>/);
	assert.match(prompt, /<shell>bash<\/shell>/);
	assert.match(prompt, /<current_date>2026-05-02<\/current_date>/);
	assert.match(prompt, /<timezone>Europe\/Berlin<\/timezone>/);
	assert.match(prompt, /<subagents>default, explorer, worker<\/subagents>/);
	assert.match(prompt, /Delegated Child Agent/);
	assert.doesNotMatch(prompt, /request_user_input tool/);
	assert.doesNotMatch(prompt, /update_plan tool/);
});

test("codex-compatible web search is serialized as a provider Responses tool", () => {
	const payload = addCodexCompatWebSearchProviderTool(
		{
			model: "gpt-5.4",
			input: [],
			tools: [{ type: "function", name: "exec_command" }],
		},
		{
			external_web_access: true,
			search_context_size: "high",
			filters: { allowed_domains: ["example.com"] },
			user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		},
	);

	assert.deepEqual(payload.tools.at(-1), {
		type: "web_search_preview",
		search_context_size: "high",
		user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		filters: { allowed_domains: ["example.com"] },
	});
});
