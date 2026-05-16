import React from "react";
import { render } from "ink";
import { createCustomAgentProfileDefinition } from "../../apps/chat/agent-profiles.js";
import { createDefaultCustomAgentStore } from "../../apps/chat/agent-store.js";
import { createDefaultFakeCliSessionSource, LocalCliSessionSource, type CliSessionSource } from "../../cli-session/index.js";
import { PiboSessionRouter } from "../../core/session-router.js";
import { PiboDataStore } from "../../data/pibo-store.js";
import { createDefaultPiboPluginRegistry } from "../../plugins/builtin.js";
import { PiboDataSessionStore } from "../../sessions/pibo-data-store.js";
import { InkSessionApp } from "./InkSessionApp.js";

export type RunCliSessionsUiOptions = {
	source?: CliSessionSource;
	useFakeSource?: boolean;
	initialSessionId?: string;
	ownerScope?: string;
	maxRows?: number;
	maxLineChars?: number;
	stdin?: NodeJS.ReadStream;
	stdout?: NodeJS.WriteStream;
	stderr?: NodeJS.WriteStream;
	allowNonTty?: boolean;
};

export async function runCliSessionsUi(options: RunCliSessionsUiOptions = {}): Promise<void> {
	const stdin = options.stdin ?? process.stdin;
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	if (options.allowNonTty !== true && (stdin.isTTY !== true || stdout.isTTY !== true)) {
		stderr.write("pibo tui:sessions requires interactive stdin and stdout TTYs. Re-run from a terminal, SSH session, or use --help for command usage.\n");
		process.exitCode = 1;
		return;
	}
	const source = options.source ?? (options.useFakeSource
		? createDefaultFakeCliSessionSource()
		: createDefaultLocalCliSessionSource({ ownerScope: options.ownerScope }));
	const instance = render(React.createElement(InkSessionApp, {
		initialSessionId: options.initialSessionId,
		maxLineChars: options.maxLineChars ?? terminalLineLimitFromColumns(stdout.columns),
		maxRows: options.maxRows,
		source,
	}), {
		stdin,
		stdout,
		stderr,
	});
	await instance.waitUntilExit();
}

export function createDefaultLocalCliSessionSource(options: { ownerScope?: string } = {}): LocalCliSessionSource {
	const dataStore = new PiboDataStore();
	const sessionStore = new PiboDataSessionStore(dataStore);
	const pluginRegistry = createDefaultPiboPluginRegistry();
	const builtInAgentSummaries = pluginRegistry.getProfileInfos().map((profile) => ({ id: profile.name, name: profile.name, description: profile.description, profileName: profile.name }));
	const customAgentStore = createDefaultCustomAgentStore();
	const customAgents = customAgentStore.list();
	try {
		for (const agent of customAgents) pluginRegistry.upsertProfile(createCustomAgentProfileDefinition(agent));
	} finally {
		customAgentStore.close();
	}
	const agentSummaries = [
		...builtInAgentSummaries,
		...customAgents.map((agent) => ({ id: agent.profileName, name: agent.profileName, description: agent.description || agent.displayName, profileName: agent.profileName })),
	];
	const router = new PiboSessionRouter({ sessionStore, pluginRegistry });
	return new LocalCliSessionSource({
		ownerScope: options.ownerScope,
		sessionStore,
		ownsSessionStore: true,
		pluginRegistry,
		router,
		ownsRouter: true,
		dataStore,
		ownsDataStore: true,
		agentSummaries,
	});
}

export function terminalLineLimitFromColumns(columns: number | undefined): number | undefined {
	if (columns === undefined || !Number.isFinite(columns) || columns <= 0) return undefined;
	return Math.max(20, Math.floor(columns) - 4);
}

export function cliSessionsHelpText(): string {
	return `pibo tui:sessions - reduced Web Chat-derived session UI for terminals

Usage:
  pibo tui:sessions [options]

Options:
  --session <id>       Open a specific Pibo session id
  --owner-scope <id>   Limit local/direct discovery to one owner scope
  --max-rows <count>   Limit rendered transcript rows (default: 20)
  --demo               Use deterministic fake session data for smoke testing
  -h, --help           Show this help

V1 commands inside the app:
  /help /new /session /agent /status /clear /exit /quit

Scope:
  CLI Sessions is a reduced session/chat UI for SSH, bootstrap, recovery, and quick local work.
  It starts only when stdin and stdout are interactive TTYs; pipes fail with a clear error.
  Transcript rendering uses a bounded default tail window of 20 rows and truncates narrow terminal lines.
  Web Chat remains the full control center for projects, workflows, Cron, Ralph, Agent Designer, settings, and context management.

Related existing commands:
  pibo tui
  pibo tui:routed
`;
}
