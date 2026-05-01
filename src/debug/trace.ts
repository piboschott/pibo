import { DatabaseSync } from "node:sqlite";
import { buildTraceView, type PiboTraceNode, type PiboSessionTraceView } from "../apps/chat/trace.js";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatWebStoredEvent } from "../apps/chat/read-model.js";
import type { ResolvedPiboDebugStore } from "./stores.js";

type SessionRow = {
	id: string;
	pi_session_id: string;
	channel: string;
	kind: string;
	profile: string;
	owner_scope: string | null;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	metadata_json: string | null;
	created_at: string;
	updated_at: string;
};

type ChatSessionRow = {
	status: string;
};

type EventRow = {
	id: string;
	pibo_session_id: string;
	event_id: string | null;
	type: string;
	created_at: string;
	payload_json: string;
};

export type DebugTraceResult = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	status: string;
	nodes: DebugTraceNodeRow[];
	rawNodeCount: number;
};

export type DebugTraceNodeRow = {
	status: string;
	type: string;
	title: string;
	id: string;
	runId?: string;
	toolCallId?: string;
	linkedPiboSessionId?: string;
	startedAt?: string;
	completedAt?: string;
	depth: number;
};

export async function inspectDebugTrace(
	piboSessionId: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	options: { runningOnly?: boolean } = {},
): Promise<DebugTraceResult> {
	if (!stores.sessions.exists) throw new Error(`Debug store "sessions" not found at ${stores.sessions.defaultPath}`);
	if (!stores.chat.exists) throw new Error(`Debug store "chat" not found at ${stores.chat.defaultPath}`);

	const sessionsDb = new DatabaseSync(stores.sessions.path, { readOnly: true });
	const chatDb = new DatabaseSync(stores.chat.path, { readOnly: true });
	try {
		const sessionRow = sessionsDb.prepare("SELECT * FROM pibo_sessions WHERE id = ?").get(piboSessionId) as
			| SessionRow
			| undefined;
		if (!sessionRow) throw new Error(`Pibo session "${piboSessionId}" not found`);

		const session = sessionFromRow(sessionRow);
		const sessions = (sessionsDb.prepare("SELECT * FROM pibo_sessions").all() as SessionRow[]).map(sessionFromRow);
		const chatRow = tableExists(chatDb, "web_chat_sessions")
			? (chatDb.prepare("SELECT status FROM web_chat_sessions WHERE pibo_session_id = ?").get(piboSessionId) as
					| ChatSessionRow
					| undefined)
			: undefined;
		const events = tableExists(chatDb, "web_chat_events")
			? (chatDb
					.prepare("SELECT * FROM web_chat_events WHERE pibo_session_id = ? ORDER BY rowid ASC")
					.all(piboSessionId) as EventRow[]).map(eventFromRow)
			: [];
		const view = await buildTraceView({
			session,
			sessions,
			events,
			status: chatRow?.status === "running" || chatRow?.status === "error" ? chatRow.status : "idle",
		});
		const rows = flattenTraceNodes(view.nodes);
		const filtered = options.runningOnly ? rows.filter((node) => node.status === "running") : rows;
		return {
			piboSessionId: view.piboSessionId,
			piSessionId: view.piSessionId,
			title: view.title,
			status: traceStatus(view),
			nodes: filtered,
			rawNodeCount: rows.length,
		};
	} finally {
		sessionsDb.close();
		chatDb.close();
	}
}

export function formatDebugTrace(result: DebugTraceResult): string {
	const lines = [
		`piboSessionId: ${result.piboSessionId}`,
		`piSessionId: ${result.piSessionId}`,
		`title: ${result.title}`,
		`status: ${result.status}`,
		"",
	];
	if (result.nodes.length === 0) {
		lines.push("nodes: 0");
		return lines.join("\n");
	}
	lines.push("status\ttype\ttitle\tid\trunId\tlinkedPiboSessionId");
	for (const node of result.nodes) {
		const title = `${"  ".repeat(node.depth)}${node.title}`;
		lines.push(
			[
				node.status,
				node.type,
				title,
				node.id,
				node.runId ?? "",
				node.linkedPiboSessionId ?? "",
			].join("\t"),
		);
	}
	lines.push(`nodes: ${result.nodes.length}${result.nodes.length !== result.rawNodeCount ? ` of ${result.rawNodeCount}` : ""}`);
	return lines.join("\n");
}

function flattenTraceNodes(nodes: PiboTraceNode[], depth = 0): DebugTraceNodeRow[] {
	return nodes.flatMap((node) => [
		{
			status: node.status,
			type: node.type,
			title: node.title,
			id: node.id,
			runId: node.runId,
			toolCallId: node.toolCallId,
			linkedPiboSessionId: node.linkedPiboSessionId,
			startedAt: node.startedAt,
			completedAt: node.completedAt,
			depth,
		},
		...flattenTraceNodes(node.children, depth + 1),
	]);
}

function traceStatus(view: PiboSessionTraceView): string {
	const rows = flattenTraceNodes(view.nodes);
	if (rows.some((node) => node.status === "error")) return "error";
	if (rows.some((node) => node.status === "running")) return "running";
	return "done";
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id,
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		ownerScope: row.owner_scope ?? undefined,
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		workspace: row.workspace ?? undefined,
		title: row.title ?? undefined,
		metadata: parseObject(row.metadata_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function eventFromRow(row: EventRow): ChatWebStoredEvent {
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		eventId: row.event_id ?? undefined,
		type: row.type,
		createdAt: row.created_at,
		payload: JSON.parse(row.payload_json) as PiboOutputEvent,
	};
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

function parseObject(value: string | null): PiboJsonObject {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as PiboJsonObject;
	} catch {
		return {};
	}
}
