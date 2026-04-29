import { existsSync, readFileSync } from "node:fs";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PiboOutputEvent, PiboSessionListItem } from "../../core/events.js";
import type { PiboSessionBinding } from "../../sessions/bindings.js";
import type { ChatWebSessionIndexItem, ChatWebStoredEvent } from "./read-model.js";

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboWebSessionNode = {
	sessionKey: string;
	sessionId: string;
	parentSessionKey?: string;
	profile: string;
	title: string;
	subtitle?: string;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
	children: PiboWebSessionNode[];
};

export type PiboTraceNodeType =
	| "user.message"
	| "assistant.message"
	| "agent.turn"
	| "model.reasoning"
	| "tool.call"
	| "tool.result"
	| "agent.delegation"
	| "execution.command"
	| "yielded.run"
	| "error";

export type PiboTraceNodeStatus = "running" | "done" | "error";

export type PiboTraceNode = {
	id: string;
	parentId?: string;
	entryId?: string;
	sessionKey: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	type: PiboTraceNodeType;
	title: string;
	status: PiboTraceNodeStatus;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedSessionKey?: string;
	children: PiboTraceNode[];
};

export type PiboSessionTraceView = {
	sessionKey: string;
	sessionId: string;
	title: string;
	nodes: PiboTraceNode[];
	rawEvents: ChatWebStoredEvent[];
};

type SessionMetadata = {
	sessionPath?: string;
	name?: string;
	firstMessage?: string;
	modified?: string;
};

type TraceBuildInput = {
	binding: PiboSessionBinding;
	bindings: PiboSessionBinding[];
	events: ChatWebStoredEvent[];
	cwd?: string;
};

type MessageSessionEntry = Extract<SessionEntry, { type: "message" }>;

type MessagePart = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	result?: unknown;
	isError?: unknown;
};

export async function loadPiSessionMetadata(
	binding: PiboSessionBinding,
	cwd = process.cwd(),
): Promise<SessionMetadata> {
	const session = await findPiSession(binding, cwd);
	if (!session) return {};
	return {
		sessionPath: session.path,
		name: session.name,
		firstMessage: session.firstMessage,
		modified: session.modified,
	};
}

export async function buildSessionNodes(
	bindings: PiboSessionBinding[],
	indexItems: ChatWebSessionIndexItem[],
	cwd = process.cwd(),
): Promise<PiboWebSessionNode[]> {
	const indexByKey = new Map(indexItems.map((item) => [item.sessionKey, item]));
	const nodes = new Map<string, PiboWebSessionNode>();

	for (const binding of bindings) {
		const metadata = await loadPiSessionMetadata(binding, binding.workspace ?? cwd);
		const indexed = indexByKey.get(binding.sessionKey);
		nodes.set(binding.sessionKey, {
			sessionKey: binding.sessionKey,
			sessionId: binding.sessionId ?? binding.sessionKey,
			parentSessionKey: binding.parentSessionKey,
			profile: binding.currentProfile ?? binding.originalProfile,
			title: createSessionTitle(binding, metadata),
			subtitle: binding.sessionKey,
			status: indexed?.status ?? "idle",
			lastActivityAt: indexed?.lastActivityAt ?? metadata.modified,
			children: [],
		});
	}

	const roots: PiboWebSessionNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentSessionKey ? nodes.get(node.parentSessionKey) : undefined;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sortNodes = (items: PiboWebSessionNode[]): void => {
		items.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
		for (const item of items) sortNodes(item.children);
	};
	sortNodes(roots);
	return roots;
}

export async function buildTraceView(input: TraceBuildInput): Promise<PiboSessionTraceView> {
	const metadata = await loadPiSessionMetadata(input.binding, input.binding.workspace ?? input.cwd);
	const entries = metadata.sessionPath ? readEntries(metadata.sessionPath) : [];
	const nodes = traceNodesFromEntries(input.binding.sessionKey, entries);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const childByParent = mapChildren(input.bindings);
	const hasPersistedTranscript = entries.some((entry) => entry.type === "message");
	const openTranscriptEventIds = findOpenTranscriptEventIds(input.events);

	for (const storedEvent of input.events) {
		if (
			hasPersistedTranscript &&
			isTranscriptEchoEvent(storedEvent.payload) &&
			!shouldKeepTranscriptEchoEvent(storedEvent.payload, openTranscriptEventIds)
		) {
			continue;
		}
		const node = traceNodeFromEvent(input.binding.sessionKey, storedEvent.payload, childByParent, storedEvent.createdAt);
		if (!node) continue;
		if (node.type === "agent.turn" && node.eventId) {
			const existingTurn = [...byId.values()].find(
				(candidate) => candidate.type === "agent.turn" && candidate.eventId === node.eventId,
			);
			if (existingTurn) {
				existingTurn.status = node.status;
				existingTurn.completedAt = node.completedAt ?? existingTurn.completedAt;
				continue;
			}
		}
		if (node.toolCallId) {
			const existing = [...byId.values()].find(
				(candidate) =>
					candidate.toolCallId === node.toolCallId &&
					(candidate.type === "tool.call" || candidate.type === "agent.delegation"),
			);
			if (existing) {
				mergeToolEvent(existing, node);
				continue;
			}
		}
		if (node.eventId && byId.has(node.id)) continue;
		nodes.push(node);
		byId.set(node.id, node);
	}

	return {
		sessionKey: input.binding.sessionKey,
		sessionId: input.binding.sessionId ?? input.binding.sessionKey,
		title: createSessionTitle(input.binding, metadata),
		nodes: nestTraceNodes(nodes),
		rawEvents: input.events,
	};
}

export async function listPiSessions(cwd = process.cwd()): Promise<PiboSessionListItem[]> {
	const sessions = await SessionManager.list(cwd);
	return sessions.map((session) => ({
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	}));
}

function createSessionTitle(binding: PiboSessionBinding, metadata: SessionMetadata): string {
	const candidate = metadata.name || metadata.firstMessage || binding.sessionKey;
	return truncateTitle(candidate);
}

function truncateTitle(title: string, maxLength = 56): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized || "Untitled Session";
	return `${normalized.slice(0, maxLength - 1)}…`;
}

async function findPiSession(binding: PiboSessionBinding, cwd: string): Promise<PiboSessionListItem | undefined> {
	const sessions = await listPiSessions(cwd);
	return sessions.find((session) => session.id === binding.sessionId);
}

function readEntries(path: string): SessionEntry[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	return parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
}

export function traceNodesFromEntries(sessionKey: string, entries: SessionEntry[]): PiboTraceNode[] {
	const nodes: PiboTraceNode[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			nodes.push(...traceNodesFromMessageEntry(sessionKey, entry));
		} else if (entry.type === "session_info" && entry.name) {
			nodes.push({
				id: `entry:${entry.id}`,
				entryId: entry.id,
				sessionKey,
				type: "execution.command",
				title: "Session Info",
				status: "done",
				startedAt: entry.timestamp,
				output: { name: entry.name },
				children: [],
			});
		}
	}
	return nodes;
}

function traceNodesFromMessageEntry(sessionKey: string, entry: MessageSessionEntry): PiboTraceNode[] {
	const role = (entry.message as { role?: unknown }).role;
	const content = (entry.message as { content?: unknown }).content;
	if (role === "user") return [createUserMessageNode(sessionKey, entry, content)];
	if (role === "assistant") return createAssistantPartNodes(sessionKey, entry, content);
	return [];
}

function createUserMessageNode(sessionKey: string, entry: MessageSessionEntry, content: unknown): PiboTraceNode {
	const text = extractText(content);
	return {
		id: `entry:${entry.id}`,
		entryId: entry.id,
		sessionKey,
		type: "user.message",
		title: "User Message",
		status: "done",
		startedAt: entry.timestamp,
		summary: text,
		output: text,
		children: [],
	};
}

function createAssistantPartNodes(sessionKey: string, entry: MessageSessionEntry, content: unknown): PiboTraceNode[] {
	const status = messageStatus(entry.message);
	const error = messageError(entry.message);
	if (typeof content === "string") {
		return [
			createAssistantMessageNode({
				id: `entry:${entry.id}`,
				sessionKey,
				entry,
				status,
				text: content,
				error,
			}),
		];
	}
	if (!Array.isArray(content)) return [];

	const nodes: PiboTraceNode[] = [];
	let errorAssigned = false;
	for (const [index, part] of content.entries()) {
		const node = createAssistantPartNode({
			sessionKey,
			entry,
			index,
			part: part as MessagePart,
			status,
			error: errorAssigned ? undefined : error,
		});
		if (!node) continue;
		nodes.push(node);
		if (node.type === "assistant.message") {
			errorAssigned = true;
		}
	}
	if (!nodes.some((node) => node.type === "assistant.message") && (extractText(content) || error)) {
		const text = extractText(content);
		nodes.push(createAssistantMessageNode({
			id: `entry:${entry.id}:text`,
			sessionKey,
			entry,
			status,
			text,
			error,
		}));
	}
	return nodes;
}

function createAssistantPartNode(input: {
	sessionKey: string;
	entry: MessageSessionEntry;
	index: number;
	part: MessagePart;
	status: PiboTraceNodeStatus;
	error?: string;
}): PiboTraceNode | undefined {
	const { sessionKey, entry, index, part, status, error } = input;
	if (part.type === "thinking" && typeof part.thinking === "string") {
		return {
			id: `entry:${entry.id}:thinking:${index}`,
			entryId: entry.id,
			sessionKey,
			type: "model.reasoning",
			title: "Thinking",
			status: "done",
			startedAt: entry.timestamp,
			summary: part.thinking,
			output: part.thinking,
			children: [],
		};
	}
	if (part.type === "text" && typeof part.text === "string" && part.text !== "") {
		return createAssistantMessageNode({
			id: `entry:${entry.id}:text:${index}`,
			sessionKey,
			entry,
			status,
			text: part.text,
			error,
		});
	}
	if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
		return {
			id: `entry:${entry.id}:tool:${part.id}`,
			entryId: entry.id,
			sessionKey,
			toolCallId: part.id,
			type: isSubagentToolName(part.name) ? "agent.delegation" : "tool.call",
			title: part.name,
			status: "done",
			startedAt: entry.timestamp,
			input: part.arguments ?? {},
			children: [],
		};
	}
	if (part.type === "toolResult") {
		const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : undefined;
		return {
			id: `entry:${entry.id}:tool-result:${toolCallId ?? index}`,
			entryId: entry.id,
			sessionKey,
			toolCallId,
			type: "tool.result",
			title: typeof part.toolName === "string" ? part.toolName : "Tool Result",
			status: part.isError === true ? "error" : "done",
			startedAt: entry.timestamp,
			output: part.result,
			error: part.isError === true ? stringifyPreview(part.result) : undefined,
			children: [],
		};
	}
	return undefined;
}

function createAssistantMessageNode(input: {
	id: string;
	sessionKey: string;
	entry: MessageSessionEntry;
	status: PiboTraceNodeStatus;
	text: string;
	error?: string;
}): PiboTraceNode {
	return {
		id: input.id,
		entryId: input.entry.id,
		sessionKey: input.sessionKey,
		type: "assistant.message",
		title: "Agent Message",
		status: input.status,
		startedAt: input.entry.timestamp,
		summary: input.text,
		output: input.text,
		error: input.error,
		children: [],
	};
}

function traceNodeFromEvent(
	sessionKey: string,
	event: PiboOutputEvent,
	childByParent: Map<string, PiboSessionBinding[]>,
	createdAt?: string,
): PiboTraceNode | undefined {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const id = `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
	const turnParentId = eventId ? messageTurnNodeId(eventId) : undefined;
	const base = { id, sessionKey, eventId, startedAt: createdAt, children: [] as PiboTraceNode[] };

	switch (event.type) {
		case "message_queued":
			return {
				...base,
				type: "user.message",
				title: "User Message",
				status: "done",
				summary: event.text,
				output: event.text,
			};
		case "message_started":
		case "message_finished":
			return {
				...base,
				id: eventId ? messageTurnNodeId(eventId) : id,
				type: "agent.turn",
				title: "Agent Turn",
				status: event.type === "message_finished" ? "done" : "running",
				completedAt: event.type === "message_finished" ? createdAt : undefined,
				summary: event.type === "message_started" ? event.text : undefined,
				input: event.type === "message_started" ? { text: event.text, source: event.source } : undefined,
			};
		case "thinking_finished":
			return {
				...base,
				parentId: turnParentId,
				type: "model.reasoning",
				title: "Thinking",
				status: "done",
				summary: event.text,
				output: event.text,
			};
		case "assistant_message":
			return {
				...base,
				parentId: turnParentId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				summary: event.text,
				output: event.text,
			};
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished": {
			const linkedSessionKey = findLikelyChildSession(sessionKey, event.toolName, childByParent);
			return {
				...base,
				id: `tool:${event.toolCallId}`,
				parentId: turnParentId,
				toolCallId: event.toolCallId,
				type: linkedSessionKey || isSubagentToolName(event.toolName) ? "agent.delegation" : "tool.call",
				title: event.toolName,
				status:
					event.type === "tool_execution_finished"
						? event.isError
							? "error"
							: "done"
						: event.type === "tool_execution_started" || event.type === "tool_execution_updated"
							? "running"
							: "done",
				completedAt: event.type === "tool_execution_finished" ? createdAt : undefined,
				input: "args" in event ? event.args : undefined,
				output:
					event.type === "tool_execution_finished"
						? event.result
						: event.type === "tool_execution_updated"
							? event.partialResult
							: undefined,
				error:
					event.type === "tool_execution_finished" && event.isError ? stringifyPreview(event.result) : undefined,
				linkedSessionKey,
				children: [],
			};
		}
		case "execution_result":
			return {
				...base,
				type: "execution.command",
				title: event.action,
				status: "done",
				input: { action: event.action },
				output: event.result,
			};
		case "session_error":
			return {
				...base,
				type: "error",
				title: "Error",
				status: "error",
				error: event.error,
				output: event.error,
			};
		default:
			return undefined;
	}
}

function isTranscriptEchoEvent(event: PiboOutputEvent): boolean {
	return (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "message_finished" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	);
}

function shouldKeepTranscriptEchoEvent(event: PiboOutputEvent, openTranscriptEventIds: ReadonlySet<string>): boolean {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	return Boolean(eventId && openTranscriptEventIds.has(eventId));
}

function findOpenTranscriptEventIds(events: ChatWebStoredEvent[]): Set<string> {
	const open = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload;
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId) continue;
		if (event.type === "message_queued" || event.type === "message_started") {
			open.add(eventId);
		} else if (event.type === "message_finished" || event.type === "session_error") {
			open.delete(eventId);
		}
	}
	return open;
}

function messageTurnNodeId(eventId: string): string {
	return `event:message:${eventId}`;
}

function nestTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const byId = new Map<string, PiboTraceNode>();
	for (const node of nodes) {
		byId.set(node.id, { ...node, children: [...node.children] });
	}

	const nestedChildIds = new Set<string>();
	for (const node of byId.values()) {
		if (!node.parentId) continue;
		const parent = byId.get(node.parentId);
		if (!parent) continue;
		parent.children.push(node);
		nestedChildIds.add(node.id);
	}

	return [...byId.values()].filter((node) => !nestedChildIds.has(node.id));
}

function mergeToolEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.linkedSessionKey = update.linkedSessionKey ?? target.linkedSessionKey;
}

function mapChildren(bindings: PiboSessionBinding[]): Map<string, PiboSessionBinding[]> {
	const result = new Map<string, PiboSessionBinding[]>();
	for (const binding of bindings) {
		if (!binding.parentSessionKey) continue;
		const children = result.get(binding.parentSessionKey) ?? [];
		children.push(binding);
		result.set(binding.parentSessionKey, children);
	}
	return result;
}

function findLikelyChildSession(
	sessionKey: string,
	toolName: string,
	childByParent: Map<string, PiboSessionBinding[]>,
): string | undefined {
	if (!isSubagentToolName(toolName)) return undefined;
	const subagentName = toolName.replace(/^pibo_subagent_/, "");
	return childByParent
		.get(sessionKey)
		?.find((binding) => binding.sessionKey.includes(`::sub::${subagentName}::`))?.sessionKey;
}

function isSubagentToolName(name: string): boolean {
	return name.startsWith("pibo_subagent_");
}

function messageStatus(message: unknown): PiboTraceNodeStatus {
	if (message && typeof message === "object") {
		const stopReason = (message as { stopReason?: unknown }).stopReason;
		const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
		if (stopReason === "error" || typeof errorMessage === "string") return "error";
	}
	return "done";
}

function messageError(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
	return typeof errorMessage === "string" ? errorMessage : undefined;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const typed = part as MessagePart;
			if (typed.type === "text" && typeof typed.text === "string") return typed.text;
			return "";
		})
		.join("");
}

function stringifyPreview(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function cryptoSafeId(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url").slice(0, 48);
}
