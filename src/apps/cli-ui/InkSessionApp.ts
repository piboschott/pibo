import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { isCliSourceError } from "../../cli-session/index.js";
import { buildCompactTerminalRows, type CompactTerminalRow } from "../../session-ui/index.js";
import type {
	CliAgentSummary,
	CliOpenSession,
	CliRuntimeStatus,
	CliSessionSource,
	CliSessionSummary,
} from "../../cli-session/index.js";
import { InkTerminalView } from "./InkTerminalView.js";

export type InkSessionPickerItem = {
	id: string;
	label: string;
	description?: string;
};

export type InkSessionPickerState = {
	kind: "session" | "agent";
	title: string;
	items: readonly InkSessionPickerItem[];
	selectedIndex: number;
	emptyMessage: string;
};

export type InkSessionAppState = {
	loading: boolean;
	status?: CliRuntimeStatus;
	session?: CliSessionSummary;
	rows: readonly CompactTerminalRow[];
	input: string;
	mode: "transcript" | "session-picker" | "agent-picker" | "detail" | "picker";
	picker?: InkSessionPickerState;
	message?: string;
	error?: string;
};

export type InkSessionAppProps = {
	source: CliSessionSource;
	initialSessionId?: string;
	maxRows?: number;
	maxLineChars?: number;
	onExit?: () => void;
};

const INITIAL_STATE: InkSessionAppState = {
	loading: true,
	rows: [],
	input: "",
	mode: "transcript",
};

export function InkSessionApp({ source, initialSessionId, maxRows, maxLineChars, onExit }: InkSessionAppProps): React.ReactElement {
	const app = useApp();
	const [state, setState] = useState<InkSessionAppState>(INITIAL_STATE);
	const openedRef = useRef<CliOpenSession | undefined>(undefined);
	const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
	const closedRef = useRef(false);
	const stateRef = useRef(state);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const closeOpenSession = useCallback(() => {
		unsubscribeRef.current?.();
		unsubscribeRef.current = undefined;
		void openedRef.current?.close();
		openedRef.current = undefined;
	}, []);

	const cleanup = useMemo(() => createCliSessionCleanup(closeOpenSession, () => {
		void source.close();
	}), [closeOpenSession, source]);

	const openSession = useCallback(async (sessionId: string, message?: string) => {
		closeOpenSession();
		const opened = await source.openSession(sessionId);
		openedRef.current = opened;
		const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
		setState((current) => ({
			...current,
			loading: false,
			status: opened.status,
			session: opened.session,
			rows,
			mode: "transcript",
			picker: undefined,
			message,
			error: undefined,
		}));
		unsubscribeRef.current = opened.subscribe((sourceUpdate) => {
			setState((current) => ({
				...current,
				session: sourceUpdate.session ?? current.session,
				status: sourceUpdate.status ?? current.status,
				rows: sourceUpdate.traceView === undefined ? current.rows : buildCompactTerminalRows(sourceUpdate.traceView, { showThinking: false }),
				error: sourceUpdate.error?.message ?? current.error,
			}));
		});
	}, [closeOpenSession, source]);

	const requestExit = useCallback(() => {
		cleanup();
		onExit?.();
		app.exit();
	}, [app, cleanup, onExit]);

	const submitCommandOrMessage = useCallback(async (rawInput: string) => {
		await handleCliSessionSubmittedInput(rawInput, source, stateRef.current, setState, openSession, requestExit);
	}, [openSession, requestExit, source]);

	const selectPickerItem = useCallback(async () => {
		const picker = stateRef.current.picker;
		const item = picker?.items[picker.selectedIndex];
		if (!picker || !item) {
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, message: picker?.emptyMessage ?? "Nothing to select." }));
			return;
		}
		try {
			if (picker.kind === "session") {
				await openSession(item.id, `Opened session ${item.label}.`);
				return;
			}
			const sessionId = stateRef.current.session?.id;
			if (!sessionId) throw new Error("No session is open. Use /new or /session first.");
			const session = await source.setSessionAgent(sessionId, item.id);
			const status = await source.getStatus({ sessionId });
			setState((current) => ({
				...current,
				session,
				status,
				mode: "transcript",
				picker: undefined,
				message: `Selected agent ${item.label}.`,
				error: undefined,
			}));
		} catch (error) {
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, error: boundedLine(formatCliSessionError(error)), message: undefined }));
		}
	}, [openSession, source]);

	useEffect(() => {
		closedRef.current = false;
		void (async () => {
			try {
				const sessions = await source.listSessions();
				const sessionId = initialSessionId ?? sessions[0]?.id;
				if (!sessionId) {
					const status = await source.getStatus();
					const rooms = await safeListRooms(source);
					setState((current) => ({
						...current,
						loading: false,
						status,
						message: emptySessionRecoveryMessage(status, rooms),
					}));
					return;
				}
				await openSession(sessionId);
			} catch (error) {
				setState((current) => ({ ...current, loading: false, error: formatCliSessionError(error) }));
			}
		})();

		return () => {
			closedRef.current = true;
			cleanup();
		};
	}, [cleanup, initialSessionId, openSession, source]);

	useInput((input, key) => {
		if (closedRef.current) return;
		if (key.ctrl && input === "c") {
			requestExit();
			return;
		}
		if (key.escape) {
			setState((current) => reduceInkSessionInputState(current, { type: "escape" }));
			return;
		}
		if (key.upArrow) {
			setState((current) => reduceInkSessionInputState(current, { type: "up" }));
			return;
		}
		if (key.downArrow) {
			setState((current) => reduceInkSessionInputState(current, { type: "down" }));
			return;
		}
		if (key.return) {
			if (stateRef.current.picker) {
				void selectPickerItem();
				return;
			}
			const submitted = stateRef.current.input;
			setState((current) => reduceInkSessionInputState(current, { type: "enter" }));
			void submitCommandOrMessage(submitted);
			return;
		}
		if (key.backspace || key.delete) {
			setState((current) => reduceInkSessionInputState(current, { type: "backspace" }));
			return;
		}
		if (input && !key.ctrl && !key.meta) {
			setState((current) => reduceInkSessionInputState(current, { type: "text", value: input }));
		}
	});

	return React.createElement(InkSessionAppView, { state, maxRows, maxLineChars });
}

export type InkSessionAppViewProps = {
	state: InkSessionAppState;
	maxRows?: number;
	maxLineChars?: number;
};

export function InkSessionAppView({ state, maxRows = 20, maxLineChars }: InkSessionAppViewProps): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	const statusText = useMemo(() => boundedLine(formatStatusLine(state), lineLimit), [lineLimit, state]);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: state.status?.connected === false ? "red" : "cyan" }, statusText),
		React.createElement(Text, { color: "gray" }, boundedLine("Commands: /help /new /session /agent /status /clear /exit /quit", lineLimit)),
		state.loading ? React.createElement(Text, { color: "yellow" }, "Loading CLI session…") : null,
		state.error ? React.createElement(Text, { color: "red" }, boundedLine(`Error: ${state.error}`, lineLimit)) : null,
		state.message ? React.createElement(Text, { color: "gray" }, boundedLine(state.message, lineLimit)) : null,
		state.picker ? React.createElement(InkSessionPickerView, { picker: state.picker, maxLineChars: lineLimit }) : null,
		React.createElement(InkTerminalView, { rows: state.rows, maxRows, maxLineChars: lineLimit }),
		React.createElement(Text, { color: state.mode === "transcript" ? "green" : "yellow" }, boundedLine(`› ${state.input}`, lineLimit)),
	);
}

export function normalizeTerminalLineLimit(maxLineChars: number | undefined): number {
	if (maxLineChars === undefined || !Number.isFinite(maxLineChars)) return 220;
	return Math.max(20, Math.floor(maxLineChars));
}

export function InkSessionPickerView({ picker, maxLineChars }: { picker: InkSessionPickerState; maxLineChars?: number }): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	if (picker.items.length === 0) {
		return React.createElement(Box, { flexDirection: "column" },
			React.createElement(Text, { color: "yellow" }, boundedLine(picker.title, lineLimit)),
			React.createElement(Text, { color: "gray" }, boundedLine(picker.emptyMessage, lineLimit)),
		);
	}
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: "yellow" }, boundedLine(`${picker.title} (↑/↓ select, Enter open, Esc cancel)`, lineLimit)),
		...picker.items.map((item, index) => React.createElement(Text, { key: item.id, color: index === picker.selectedIndex ? "green" : "white" }, boundedLine(`${index === picker.selectedIndex ? "❯" : " "} ${item.label}${item.description ? ` — ${item.description}` : ""}`, lineLimit))),
	);
}

export type InkSessionInputAction =
	| { type: "text"; value: string }
	| { type: "backspace" }
	| { type: "enter" }
	| { type: "escape" }
	| { type: "up" }
	| { type: "down" };

export function reduceInkSessionInputState(state: InkSessionAppState, action: InkSessionInputAction): InkSessionAppState {
	if (action.type === "text") return { ...state, input: state.input + action.value, message: undefined, error: undefined };
	if (action.type === "backspace") return { ...state, input: state.input.slice(0, -1) };
	if (action.type === "escape") return { ...state, input: "", mode: "transcript", picker: undefined, message: "Canceled." };
	if (action.type === "up" || action.type === "down") {
		if (!state.picker || state.picker.items.length === 0) return state;
		const direction = action.type === "up" ? -1 : 1;
		const selectedIndex = (state.picker.selectedIndex + direction + state.picker.items.length) % state.picker.items.length;
		return { ...state, picker: { ...state.picker, selectedIndex } };
	}
	return {
		...state,
		input: "",
		message: undefined,
		error: undefined,
	};
}

export type ParsedCliSessionInput =
	| { type: "empty" }
	| { type: "message"; text: string }
	| { type: "command"; command: CliSessionSlashCommand };

export type CliSessionSlashCommand = {
	name: string;
	args: string;
	raw: string;
};

export function parseCliSessionInput(input: string): ParsedCliSessionInput {
	const trimmed = input.trim();
	if (trimmed.length === 0) return { type: "empty" };
	if (!trimmed.startsWith("/")) return { type: "message", text: trimmed };
	const withoutSlash = trimmed.slice(1);
	const [name = "", ...rest] = withoutSlash.split(/\s+/);
	return { type: "command", command: { name: name.toLowerCase(), args: rest.join(" ").trim(), raw: trimmed } };
}

export function cliSessionSlashHelpText(): string {
	return "Commands: /help, /new, /session, /agent, /status, /clear, /exit, /quit. Web-only in V1: projects, workflows, Cron, Ralph, Agent Designer, full settings, context management, /model, /thinking, /fork, /details.";
}

export function formatCliSessionStatus(status: CliRuntimeStatus | undefined, session: CliSessionSummary | undefined): string {
	if (!status && !session) return "Status unavailable.";
	const parts = [
		`source=${status?.source ?? "unknown"}`,
		`mode=${status?.mode ?? "unknown"}`,
		`connected=${status?.connected === false ? "no" : "yes"}`,
		`session=${session?.id ?? status?.activeSessionId ?? "none"}`,
		`agent=${session?.agentId ?? session?.profile ?? status?.activeAgentId ?? "default"}`,
		`model=${status?.activeModel ? `${status.activeModel.provider}/${status.activeModel.id}` : "unknown"}`,
		`rooms=${status?.rooms ?? "unknown"}`,
		`agents=${status?.agents ?? "unknown"}`,
	];
	if (status?.message) parts.push(`message=${redactCliSessionStatusText(status.message)}`);
	return parts.join(" | ");
}

export async function handleCliSessionSubmittedInput(
	rawInput: string,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string) => Promise<void>,
	requestExit: () => void,
): Promise<void> {
	const parsed = parseCliSessionInput(rawInput);
	if (parsed.type === "empty") return;
	if (parsed.type === "message") {
		const sessionId = state.session?.id;
		if (!sessionId) {
			setState((current) => ({ ...current, error: "No session is open. Use /new to create one or /session to select an existing session." }));
			return;
		}
		try {
			await source.sendMessage(sessionId, parsed.text);
			setState((current) => ({ ...current, message: "Message sent.", error: undefined }));
		} catch (error) {
			setState((current) => ({ ...current, error: boundedLine(formatCliSessionError(error)), message: undefined }));
		}
		return;
	}
	try {
		await handleSlashCommand(parsed.command, source, state, setState, openSession, requestExit);
	} catch (error) {
		setState((current) => ({ ...current, error: boundedLine(formatCliSessionError(error)), message: undefined, mode: "transcript", picker: undefined }));
	}
}

async function handleSlashCommand(
	command: CliSessionSlashCommand,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string) => Promise<void>,
	requestExit: () => void,
): Promise<void> {
	if (command.name === "help") {
		setState((current) => ({ ...current, message: cliSessionSlashHelpText(), error: undefined }));
		return;
	}
	if (command.name === "status") {
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => ({ ...current, status, message: formatCliSessionStatus(status, current.session), error: undefined }));
		return;
	}
	if (command.name === "clear") {
		setState((current) => ({ ...current, rows: [], message: "Cleared local display. Session data was not deleted.", error: undefined }));
		return;
	}
	if (command.name === "exit" || command.name === "quit") {
		requestExit();
		return;
	}
	if (command.name === "new") {
		const created = await source.createSession({ roomId: state.status?.activeRoomId, agentId: state.status?.activeAgentId });
		await openSession(created.id, `Created session ${created.title}.`);
		return;
	}
	if (command.name === "session") {
		const sessions = await source.listSessions();
		const status = await source.getStatus({ sessionId: state.session?.id });
		const rooms = await safeListRooms(source);
		const emptyMessage = emptySessionRecoveryMessage(status, rooms);
		setState((current) => ({
			...current,
			status,
			mode: "session-picker",
			picker: {
				kind: "session",
				title: "Select session",
				items: sessions.map(sessionPickerItem),
				selectedIndex: 0,
				emptyMessage,
			},
			message: sessions.length === 0 ? emptyMessage : "Select a session with arrow keys.",
			error: undefined,
		}));
		return;
	}
	if (command.name === "agent") {
		const agents = await source.listAgents();
		setState((current) => ({
			...current,
			mode: "agent-picker",
			picker: {
				kind: "agent",
				title: "Select existing agent/profile",
				items: agents.map(agentPickerItem),
				selectedIndex: 0,
				emptyMessage: "No existing agents/profiles are available from this source.",
			},
			message: agents.length === 0 ? "No existing agents/profiles are available." : "Select an existing agent/profile with arrow keys.",
			error: undefined,
		}));
		return;
	}
	setState((current) => ({ ...current, error: `Unknown command ${command.raw}. Use /help for supported CLI commands.`, message: undefined }));
}

function sessionPickerItem(session: CliSessionSummary): InkSessionPickerItem {
	return {
		id: session.id,
		label: session.title || session.id,
		description: [session.profile, session.status, session.updatedAt].filter(Boolean).join(" | "),
	};
}

function agentPickerItem(agent: CliAgentSummary): InkSessionPickerItem {
	return {
		id: agent.id,
		label: agent.name || agent.id,
		description: agent.description ?? agent.profileName,
	};
}

function formatStatusLine(state: InkSessionAppState): string {
	const source = state.status?.source ?? "starting";
	const session = state.session?.title ?? state.status?.activeSessionId ?? "no session";
	const agent = state.session?.agentId ?? state.session?.profile ?? state.status?.activeAgentId ?? "default";
	const model = state.status?.activeModel ? `${state.status.activeModel.provider}/${state.status.activeModel.id}` : "model unknown";
	const mode = state.mode === "transcript" ? "transcript" : state.mode;
	return boundedLine(`Pibo CLI Sessions | ${source} | ${session} | ${agent} | ${model} | ${mode}`);
}

function boundedLine(value: string, max = 220): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 12))}… truncated`;
}

export function createCliSessionCleanup(closeOpenSession: () => void, closeSource: () => void): () => void {
	let cleanedUp = false;
	return () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try {
			closeOpenSession();
		} finally {
			try {
				closeSource();
			} catch {
				// Exit cleanup must be best-effort so terminal shutdown can finish.
			}
		}
	};
}

async function safeListRooms(source: CliSessionSource): Promise<readonly unknown[]> {
	try {
		return await source.listRooms();
	} catch {
		return [];
	}
}

function emptySessionRecoveryMessage(status: CliRuntimeStatus, rooms: readonly unknown[]): string {
	if (status.rooms === "unsupported") return "No sessions found and this source cannot list rooms. Use /new to create a local CLI session.";
	if (rooms.length === 0) return "No sessions or rooms found. Use /new to create a local CLI session.";
	return "No sessions found. Use /new to create a local CLI session.";
}

export function formatCliSessionError(error: unknown): string {
	const message = redactCliSessionStatusText(errorMessage(error));
	if (isCliSourceError(error)) {
		if (error.code === "source_closed") return `${message}. Recovery: restart pibo tui:sessions.`;
		if (error.code === "session_not_found") return `${message}. Recovery: use /session to select another session or /new to create one.`;
		if (error.code === "agent_not_found") return `${message}. Recovery: use /agent to pick an available existing profile.`;
		if (error.code === "empty_message") return `${message}. Type a message or use /help.`;
		return `${message}. Recovery: check local Pibo state, then use /status, /session, or /new.`;
	}
	return `${message}. Recovery: use /status for source state or restart the CLI if the problem persists.`;
}

function redactCliSessionStatusText(text: string): string {
	return text
		.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(?:sk|pk|pibo|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g, "[redacted]");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
