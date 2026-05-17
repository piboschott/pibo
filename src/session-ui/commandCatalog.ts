import { redactTerminalSecret } from "./statusViewModel.js";

export type SlashCommandSupport = "supported" | "terminal-adapted" | "browser-only" | "product-area" | "deferred";

export type SlashCommandDescriptor = {
	id: string;
	slash: `/${string}`;
	actionName?: string;
	description: string;
	argumentHint?: string;
	group: "session" | "navigation" | "runtime" | "cli" | "unsupported";
	support: SlashCommandSupport;
	unsupportedReason?: string;
	terminalAdaptation?: string;
	aliases?: readonly `/${string}`[];
};

export type GatewayCommandCapability = {
	name?: string;
	slash?: string;
	actionName?: string;
	description?: string;
	argumentHint?: string;
	supported?: boolean;
	browserOnly?: boolean;
	productArea?: boolean;
	unsupportedReason?: string;
};

export const CLI_ONLY_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
	{ id: "help", slash: "/help", description: "Show command help and keyboard controls.", group: "cli", support: "supported" },
	{ id: "new", slash: "/new", description: "Create a new session in the active or selected room.", group: "navigation", support: "supported" },
	{ id: "room", slash: "/room", description: "Select the active room for the current owner.", group: "navigation", support: "supported" },
	{ id: "session", slash: "/session", description: "Select a room, then open or create a session.", group: "navigation", support: "supported" },
	{ id: "agent", slash: "/agent", description: "Select an existing agent/profile for the session.", group: "navigation", support: "supported" },
	{ id: "owner", slash: "/owner", description: "Switch the effective Web owner or Root recovery owner.", group: "navigation", support: "supported", aliases: ["/profile"] },
	{ id: "profile", slash: "/profile", description: "Alias for /owner.", group: "navigation", support: "supported" },
	{ id: "repair-user-unknown", slash: "/repair-user-unknown", description: "Repair legacy CLI sessions stored under user:unknown.", group: "cli", support: "supported" },
	{ id: "clear", slash: "/clear", description: "Clear the local terminal display without deleting session data.", group: "cli", support: "supported" },
	{ id: "exit", slash: "/exit", description: "Exit the terminal UI.", group: "cli", support: "supported", aliases: ["/quit"] },
	{ id: "quit", slash: "/quit", description: "Exit the terminal UI.", group: "cli", support: "supported" },
];

export const WEB_PARITY_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
	{ id: "status", slash: "/status", actionName: "status", description: "Show session, runtime, model, queue, and usage status.", group: "session", support: "supported" },
	{ id: "compact", slash: "/compact", actionName: "compact", description: "Run session compaction when the runtime supports it.", group: "runtime", support: "terminal-adapted" },
	{ id: "abort", slash: "/abort", actionName: "abort", description: "Abort the active response.", group: "runtime", support: "terminal-adapted" },
	{ id: "kill", slash: "/kill", actionName: "kill", description: "Dispose the active session runtime.", group: "runtime", support: "terminal-adapted" },
	{ id: "kill-all", slash: "/kill-all", actionName: "kill-all", description: "Dispose all routed runtimes for the selected owner when supported.", group: "runtime", support: "terminal-adapted" },
	{ id: "fast", slash: "/fast", actionName: "fast_mode", description: "Toggle fast mode for the active session.", argumentHint: "[on|off]", group: "runtime", support: "terminal-adapted" },
	{ id: "thinking", slash: "/thinking", actionName: "thinking", description: "Show or set model thinking level.", argumentHint: "[off|minimal|low|medium|high|xhigh]", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Without an argument, open a keyboard picker." },
	{ id: "model", slash: "/model", actionName: "model", description: "Choose an authenticated provider model.", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Open provider and model pickers." },
	{ id: "login", slash: "/login", actionName: "login", description: "Authenticate a model provider.", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Show provider/auth-method instructions in terminal." },
	{ id: "session-current", slash: "/session-current", actionName: "session-current", description: "Show metadata for the active session.", group: "session", support: "terminal-adapted" },
	{ id: "sessions", slash: "/sessions", actionName: "sessions", description: "List sessions for the selected owner and room.", group: "session", support: "terminal-adapted" },
	{ id: "clone", slash: "/clone", actionName: "clone", description: "Clone or derive the active session when supported.", group: "session", support: "terminal-adapted" },
	{ id: "fork-candidates", slash: "/fork-candidates", actionName: "fork-candidates", description: "Inspect Web fork candidates.", group: "unsupported", support: "deferred", unsupportedReason: "Terminal fork navigation is defined in a later keyboard-flow story." },
	{ id: "download", slash: "/download", description: "Download browser-side transcript artifacts.", group: "unsupported", support: "browser-only", unsupportedReason: "Browser download APIs are not available in a terminal; use a path-based export command when implemented." },
	{ id: "upload", slash: "/upload", description: "Upload files through browser file selection.", group: "unsupported", support: "browser-only", unsupportedReason: "Browser file picker APIs are not available in a terminal; use a path-based upload command when implemented." },
	{ id: "thinking-show", slash: "/thinking-show", actionName: "thinking", description: "Show thinking controls in Web.", group: "unsupported", support: "deferred", unsupportedReason: "Use /thinking in terminal." },
];

export function buildSlashCommandCatalog(capabilities: readonly GatewayCommandCapability[] = []): SlashCommandDescriptor[] {
	const bySlash = new Map<string, SlashCommandDescriptor>();
	for (const command of [...WEB_PARITY_SLASH_COMMANDS, ...CLI_ONLY_SLASH_COMMANDS]) bySlash.set(command.slash, command);
	for (const capability of capabilities) {
		const slash = normalizeSlash(capability.slash ?? capability.name);
		if (!slash) continue;
		const existing = bySlash.get(slash);
		bySlash.set(slash, {
			id: slash.slice(1),
			slash,
			actionName: capability.actionName ?? existing?.actionName ?? capability.name,
			description: redactTerminalSecret(capability.description ?? existing?.description ?? `Run ${slash}.`),
			argumentHint: capability.argumentHint ?? existing?.argumentHint,
			group: capability.browserOnly || capability.productArea ? "unsupported" : existing?.group ?? "session",
			support: supportForCapability(capability, existing),
			unsupportedReason: redactTerminalSecret(capability.unsupportedReason ?? existing?.unsupportedReason ?? "" ) || undefined,
			terminalAdaptation: existing?.terminalAdaptation,
			aliases: existing?.aliases,
		});
	}
	return [...bySlash.values()].sort((left, right) => left.slash.localeCompare(right.slash));
}

export function filterSlashCommands(catalog: readonly SlashCommandDescriptor[], input: string): SlashCommandDescriptor[] {
	const normalized = input.trim().toLowerCase();
	const prefix = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return catalog.filter((command) => command.slash.toLowerCase().startsWith(prefix) || command.aliases?.some((alias) => alias.toLowerCase().startsWith(prefix)));
}

function normalizeSlash(value: string | undefined): `/${string}` | undefined {
	if (!value) return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	return (trimmed.startsWith("/") ? trimmed : `/${trimmed}`) as `/${string}`;
}

function supportForCapability(capability: GatewayCommandCapability, existing?: SlashCommandDescriptor): SlashCommandSupport {
	if (capability.browserOnly) return "browser-only";
	if (capability.productArea) return "product-area";
	if (capability.supported === false) return "deferred";
	return existing?.support ?? "terminal-adapted";
}
