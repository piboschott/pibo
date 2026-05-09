import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { normalizeLimit, openReadOnlyDebugDatabase, withStorePath } from "./sql.js";

type EventRow = {
	stream_id: number;
	event_id: string | null;
	type: string;
	created_at: string;
	preview_text: string | null;
	attributes_json: string;
};

export type DebugEventResult = {
	piboSessionId: string;
	events: Array<Record<string, unknown>>;
	limited: boolean;
};

export function inspectDebugEvents(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	options: { type?: string; fields?: string[]; limit?: string | number } = {},
): DebugEventResult {
	if (!store.exists) throw new Error(`Debug store "chat" not found at ${store.path}`);
	const limit = normalizeLimit(options.limit);
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "event_log")) return { piboSessionId, events: [], limited: false };
		const clauses = ["session_id = ?"];
		const values: Array<string | number> = [piboSessionId];
		if (options.type) {
			clauses.push("type = ?");
			values.push(options.type);
		}
		const rows = db
			.prepare(
				`
					SELECT stream_id, event_id, type, created_at, preview_text, attributes_json
					FROM event_log
					WHERE ${clauses.join(" AND ")}
					ORDER BY stream_id DESC
					LIMIT ?
				`,
			)
			.all(...values, limit + 1) as EventRow[];
		const limited = rows.length > limit;
		return {
			piboSessionId,
			events: rows.slice(0, limit).map((row) => formatEventRow(row, options.fields ?? [])),
			limited,
		};
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function formatDebugEvents(result: DebugEventResult): string {
	if (result.events.length === 0) return "events: 0";
	const columns = Object.keys(result.events[0] ?? {});
	const lines = [columns.join("\t")];
	for (const event of result.events) {
		lines.push(columns.map((column) => formatValue(event[column])).join("\t"));
	}
	lines.push(`events: ${result.events.length}${result.limited ? " (limited)" : ""}`);
	return lines.join("\n");
}

function formatEventRow(row: EventRow, fields: string[]): Record<string, unknown> {
	const payload = eventPayload(row);
	const result: Record<string, unknown> = {
		created_at: row.created_at,
		type: row.type,
		event_id: row.event_id,
		stream_id: row.stream_id,
	};
	for (const field of fields) {
		result[field] = getPath(payload, field);
	}
	return result;
}

function getPath(value: unknown, path: string): unknown {
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

function eventPayload(row: EventRow): Record<string, unknown> {
	const attributes = parseObject(row.attributes_json);
	const inlinePayload = attributes.inlinePayload;
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload)) return inlinePayload as Record<string, unknown>;
	return { ...attributes, previewText: row.preview_text };
}

function parseObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value).replaceAll("\n", "\\n");
}
