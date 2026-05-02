import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

export type CodexCompatibleWebSearchConfig = {
	external_web_access: boolean;
	filters?: {
		allowed_domains?: string[];
	};
	user_location?: {
		type: "approximate";
		country?: string;
		region?: string;
		city?: string;
		timezone?: string;
	};
	search_context_size?: "low" | "medium" | "high";
};

export type CodexCompatExtensionOptions = {
	shell?: string;
	isChildSession?: boolean;
	webSearch?: CodexCompatibleWebSearchConfig;
};

type ProviderPayload = {
	input?: unknown;
	tools?: unknown;
	[key: string]: unknown;
};

const CODEX_COMPAT_SUBAGENTS = ["default", "explorer", "worker"] as const;

function currentDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function currentTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function hasProviderResponsesShape(payload: unknown): payload is ProviderPayload {
	return Boolean(payload && typeof payload === "object" && "input" in payload);
}

function hasWebSearchTool(tools: unknown[]): boolean {
	return tools.some((tool) => {
		if (!tool || typeof tool !== "object") return false;
		const type = (tool as { type?: unknown }).type;
		return type === "web_search_preview" || type === "web_search";
	});
}

function buildWebSearchProviderTool(config: CodexCompatibleWebSearchConfig): Record<string, unknown> {
	const tool: Record<string, unknown> = {
		type: "web_search",
	};
	if (config.search_context_size) tool.search_context_size = config.search_context_size;
	if (config.user_location) tool.user_location = config.user_location;
	if (config.filters?.allowed_domains?.length) {
		tool.filters = { allowed_domains: config.filters.allowed_domains };
	}
	return tool;
}

export function addCodexCompatWebSearchProviderTool(
	payload: unknown,
	config: CodexCompatibleWebSearchConfig,
): unknown {
	if (!config.external_web_access) return payload;
	if (!hasProviderResponsesShape(payload)) return payload;

	const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
	if (hasWebSearchTool(tools)) return payload;

	return {
		...payload,
		tools: [...tools, buildWebSearchProviderTool(config)],
	};
}

export function buildCodexCompatSystemPrompt(options: {
	baseSystemPrompt: string;
	cwd: string;
	shell: string;
	currentDate?: string;
	timezone?: string;
	isChildSession?: boolean;
}): string {
	const childInstructions = options.isChildSession
		? [
				"## Delegated Child Agent",
				"You are a child agent working as part of a team. Complete the delegated task, continue the thread when the parent sends more input, and return a concise final result for the parent agent.",
			].join("\n")
		: "";

	const compatibilityInstructions = [
		"# Codex-Compatible Runtime",
		"You are running in Pibo through the codex-compat profile. Match Codex-style tool use where the exposed Pibo tools support it, while staying truthful about implemented behavior.",
		"Use direct execution for normal coding tasks. If a structured planning or user-input tool is not present, ask concise questions in normal chat.",
		"Provider-backed web search is exposed as a provider tool in supported Responses requests; do not expect a local browser search stack.",
		childInstructions,
		"<environment_context>",
		`  <cwd>${options.cwd}</cwd>`,
		`  <shell>${options.shell}</shell>`,
		`  <current_date>${options.currentDate ?? currentDate()}</current_date>`,
		`  <timezone>${options.timezone ?? currentTimezone()}</timezone>`,
		`  <subagents>${CODEX_COMPAT_SUBAGENTS.join(", ")}</subagents>`,
		"</environment_context>",
		options.baseSystemPrompt,
	];

	return compatibilityInstructions.filter((section) => section.trim().length > 0).join("\n\n");
}

export function createCodexCompatExtension(options: CodexCompatExtensionOptions = {}): ExtensionFactory {
	return (pi) => {
		pi.on("before_agent_start", (event, ctx) => ({
			systemPrompt: buildCodexCompatSystemPrompt({
				baseSystemPrompt: event.systemPrompt,
				cwd: ctx.cwd,
				shell: options.shell ?? process.env.SHELL ?? "bash",
				isChildSession: options.isChildSession,
			}),
		}));

		if (options.webSearch) {
			pi.on("before_provider_request", (event) =>
				addCodexCompatWebSearchProviderTool(event.payload, options.webSearch!),
			);
		}
	};
}
