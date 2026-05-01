import { InitialSessionContextBuilder } from "../core/profiles.js";
import { definePiboPlugin } from "./registry.js";

const CODEX_COMPAT_TOOL_NAMES = [
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
] as const;

const CODEX_COMPAT_SUBAGENTS = ["default", "explorer", "worker"] as const;

const toolDescriptions: Record<(typeof CODEX_COMPAT_TOOL_NAMES)[number], string> = {
	exec_command: "Runs a shell command and can return a session id for long-running interaction.",
	write_stdin: "Writes characters to an existing exec_command session.",
	apply_patch: "Applies a Codex-style patch to workspace files.",
	web_search: "Provider-delegated web search for supported Responses models.",
	view_image: "Reads a local image path and returns it for visual inspection.",
	spawn_agent: "Starts a delegated child agent with a Codex-compatible role.",
	send_input: "Sends follow-up input to an existing delegated child agent.",
	resume_agent: "Returns state for a delegated child agent handle.",
	wait_agent: "Waits for delegated child agents to reach terminal status.",
	close_agent: "Closes a delegated child agent handle.",
};

export const piboCodexCompatPlugin = definePiboPlugin({
	id: "pibo.codex-compat",
	name: "Pibo Codex Compatibility",
	register(api) {
		for (const name of CODEX_COMPAT_TOOL_NAMES) {
			api.registerTool({
				name,
				description: toolDescriptions[name],
			});
		}

		api.registerContextFile({
			key: "Codex AGENTS.md",
			label: "Codex AGENTS.md",
			path: "AGENTS.md",
		});
		api.registerContextFile({
			key: "Codex RULES.md",
			label: "Codex RULES.md",
			path: "RULES.md",
		});
		api.registerContextFile({
			key: "Codex GLOSSARY.md",
			label: "Codex GLOSSARY.md",
			path: "GLOSSARY.md",
		});

		api.registerSubagents([
			{
				name: "default",
				description: "General delegated Codex-compatible child agent.",
				targetProfile: "codex-compat",
			},
			{
				name: "explorer",
				description: "Read-focused delegated agent for scoped codebase questions.",
				targetProfile: "codex-compat",
			},
			{
				name: "worker",
				description: "Execution-focused delegated agent for bounded implementation work.",
				targetProfile: "codex-compat",
			},
		]);

		api.registerProfile({
			name: "codex-compat",
			aliases: ["codex"],
			description: "Codex-compatible Pibo profile with Codex-like tools, prompt framing, and subagents.",
			create(context) {
				return new InitialSessionContextBuilder("codex-compat")
					.withBuiltinTools("disabled")
					.withToolPackages({
						codexCompat: true,
						providerWebSearch: true,
						runControl: false,
					})
					.addTools(context.getTools(CODEX_COMPAT_TOOL_NAMES))
					.addSubagents(context.getSubagents(CODEX_COMPAT_SUBAGENTS))
					.addContextFile(context.getContextFile("Codex AGENTS.md"))
					.addContextFile(context.getContextFile("Codex RULES.md"))
					.addContextFile(context.getContextFile("Codex GLOSSARY.md"))
					.createSession();
			},
		});
	},
});
