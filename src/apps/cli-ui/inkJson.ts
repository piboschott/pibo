import { redactTerminalSecret, type TerminalInlineToken } from "../../session-ui/index.js";

export type InkJsonOptions = {
	maxChars?: number;
	maxDepth?: number;
	maxArrayItems?: number;
	maxObjectKeys?: number;
	maxStringChars?: number;
};

const DEFAULT_MAX_CHARS = 1600;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ARRAY_ITEMS = 20;
const DEFAULT_MAX_OBJECT_KEYS = 40;
const DEFAULT_INLINE_MAX_DEPTH = 3;
const DEFAULT_INLINE_EXPANDED_DEPTH = 1;
const DEFAULT_INLINE_MAX_ITEMS = 6;
const DEFAULT_INLINE_MAX_KEYS = 8;
const DEFAULT_INLINE_STRING_CHARS = 140;
const DEFAULT_DETAIL_DEPTH = 2;
const DEFAULT_DETAIL_ITEMS = 10;
const DEFAULT_DETAIL_KEYS = 16;
const DEFAULT_DETAIL_STRING_CHARS = 240;

export function formatInkJson(value: unknown, options: InkJsonOptions = {}): string {
	const prepared = prepareJsonValue(value, {
		maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
		maxObjectKeys: options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS,
		maxStringChars: options.maxStringChars ?? Number.POSITIVE_INFINITY,
		seen: new WeakSet<object>(),
		depth: 0,
	});
	return sanitizeTerminalText(JSON.stringify(prepared, null, 2) ?? String(prepared));
}

export function formatInlineJson(value: unknown, maxChars = 180): string {
	return formatInlineJsonTokens(value, { maxChars }).map((token) => token.text).join("");
}

export function formatInlineJsonTokens(value: unknown, options: InkJsonOptions = {}): TerminalInlineToken[] {
	const prepared = prepareJsonValue(value, {
		maxDepth: options.maxDepth ?? DEFAULT_INLINE_MAX_DEPTH,
		maxArrayItems: options.maxArrayItems ?? DEFAULT_INLINE_MAX_ITEMS,
		maxObjectKeys: options.maxObjectKeys ?? DEFAULT_INLINE_MAX_KEYS,
		maxStringChars: options.maxStringChars ?? DEFAULT_INLINE_STRING_CHARS,
		seen: new WeakSet<object>(),
		depth: 0,
	});
	return inlineJsonValueTokens(prepared, 0, options.maxDepth ?? DEFAULT_INLINE_EXPANDED_DEPTH);
}

export function formatFunctionCallTokens(name: string, input: unknown): TerminalInlineToken[] {
	return [
		{ text: name, tone: "yellow", weight: "semibold" },
		{ text: "(", tone: "default" },
		...formatInlineJsonTokens(input),
		{ text: ")", tone: "default" },
	];
}

export function formatDetailJsonWellLines(value: unknown, options: InkJsonOptions = {}): string[] | undefined {
	const parsed = parseJsonDetailValue(value);
	if (!parsed) return undefined;
	const prepared = prepareJsonValue(parsed.value, {
		maxDepth: options.maxDepth ?? DEFAULT_DETAIL_DEPTH,
		maxArrayItems: options.maxArrayItems ?? DEFAULT_DETAIL_ITEMS,
		maxObjectKeys: options.maxObjectKeys ?? DEFAULT_DETAIL_KEYS,
		maxStringChars: options.maxStringChars ?? DEFAULT_DETAIL_STRING_CHARS,
		seen: new WeakSet<object>(),
		depth: 0,
	});
	const lines: string[] = [];
	if (parsed.metadata) lines.push(...parsed.metadata.split("\n").map((line) => `Meta: ${line}`));
	lines.push("┌ JSON");
	lines.push(...jsonPrettyLines(prepared, 0, options.maxDepth ?? DEFAULT_DETAIL_DEPTH));
	lines.push("└ JSON");
	return lines.map(sanitizeTerminalText);
}

export function tokenizeJsonTextLine(line: string): TerminalInlineToken[] {
	const tokens: TerminalInlineToken[] = [];
	const pattern = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]|\s+|[^{}\[\]:,"\s]+/g;
	const matches = sanitizeTerminalText(line).match(pattern) ?? [line];
	for (let index = 0; index < matches.length; index += 1) {
		const text = matches[index] ?? "";
		if (!text) continue;
		if (/^\s+$/.test(text)) tokens.push({ text });
		else if (/^[{}\[\]:,]$/.test(text)) tokens.push({ text, tone: "dim" });
		else if (/^(?:true|false|null|-?\d)/.test(text)) tokens.push({ text, tone: "blue" });
		else if (text.startsWith('"')) {
			const nextNonSpace = matches.slice(index + 1).find((item) => !/^\s+$/.test(item));
			tokens.push({ text: redactTerminalSecret(text), tone: nextNonSpace === ":" ? "default" : "yellow" });
		} else tokens.push({ text: redactTerminalSecret(text) });
	}
	return tokens;
}

export function truncateTerminalText(text: string, _maxChars: number): string {
	return sanitizeTerminalText(text);
}

export function sanitizeTerminalText(text: string): string {
	return redactTerminalSecret(stripControlText(text));
}

type PrepareOptions = Required<Omit<InkJsonOptions, "maxChars">> & {
	seen: WeakSet<object>;
	depth: number;
};

function prepareJsonValue(value: unknown, options: PrepareOptions): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return shortenString(sanitizeTerminalText(value), options.maxStringChars);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return `${value.toString()}n`;
	if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol";
	if (typeof value === "function") return "[Function]";
	if (options.depth >= options.maxDepth) return Array.isArray(value) ? `▸[...] ${value.length} items` : "▸{...}";
	if (typeof value !== "object") return String(value);
	if (options.seen.has(value)) return "[Circular]";
	options.seen.add(value);
	try {
		if (Array.isArray(value)) {
			const items = value.slice(0, options.maxArrayItems).map((item) => prepareJsonValue(item, { ...options, depth: options.depth + 1 }));
			if (value.length > options.maxArrayItems) items.push(`… ${value.length - options.maxArrayItems} more items`);
			return items;
		}
		const entries = Object.entries(value as Record<string, unknown>);
		const result: Record<string, unknown> = {};
		for (const [key, item] of entries.slice(0, options.maxObjectKeys)) {
			result[sanitizeTerminalText(key)] = prepareJsonValue(item, { ...options, depth: options.depth + 1 });
		}
		if (entries.length > options.maxObjectKeys) result["…"] = `${entries.length - options.maxObjectKeys} more keys`;
		return result;
	} finally {
		options.seen.delete(value);
	}
}

function inlineJsonValueTokens(value: unknown, depth: number, expandedDepth: number): TerminalInlineToken[] {
	if (value === null) return [{ text: "null", tone: "blue" }];
	if (typeof value === "number" || typeof value === "boolean") return [{ text: String(value), tone: "blue" }];
	if (typeof value === "string") return [{ text: JSON.stringify(value), tone: "yellow" }];
	if (Array.isArray(value)) {
		if (depth >= expandedDepth) return [{ text: "▸[...]", tone: "dim" }];
		const tokens: TerminalInlineToken[] = [{ text: "▾[", tone: "dim" }];
		value.forEach((item, index) => {
			if (index > 0) tokens.push({ text: ", ", tone: "dim" });
			tokens.push(...inlineJsonValueTokens(item, depth + 1, expandedDepth));
		});
		tokens.push({ text: "]", tone: "dim" });
		return tokens;
	}
	if (typeof value === "object" && value) {
		if (depth >= expandedDepth) return [{ text: "▸{...}", tone: "dim" }];
		const tokens: TerminalInlineToken[] = [{ text: "▾{", tone: "dim" }];
		Object.entries(value as Record<string, unknown>).forEach(([key, item], index) => {
			if (index > 0) tokens.push({ text: ", ", tone: "dim" });
			tokens.push({ text: JSON.stringify(key), tone: "default" }, { text: ": ", tone: "dim" }, ...inlineJsonValueTokens(item, depth + 1, expandedDepth));
		});
		tokens.push({ text: "}", tone: "dim" });
		return tokens;
	}
	return [{ text: JSON.stringify(String(value)), tone: "yellow" }];
}

function parseJsonDetailValue(value: unknown): { metadata?: string; value: unknown } | undefined {
	if (value && typeof value === "object") return { value };
	if (typeof value !== "string") return undefined;
	const text = stripControlText(value).trim();
	if (!text) return undefined;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char !== "{" && char !== "[") continue;
		try {
			const parsed = JSON.parse(text.slice(index).trim());
			const metadata = text.slice(0, index).trim();
			return { metadata: metadata || undefined, value: parsed };
		} catch {
			// Keep looking for the first valid JSON payload after leading status text.
		}
	}
	return undefined;
}

function jsonPrettyLines(value: unknown, depth: number, maxDepth: number): string[] {
	const indent = "  ".repeat(depth);
	if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") return [`${indent}${primitiveText(value)}`];
	if (Array.isArray(value)) {
		if (depth >= maxDepth) return [`${indent}▸[...]`];
		if (value.length === 0) return [`${indent}[]`];
		const lines = [`${indent}▾[`];
		for (const item of value) lines.push(...jsonPrettyLines(item, depth + 1, maxDepth));
		lines.push(`${indent}]`);
		return lines;
	}
	if (typeof value === "object" && value) {
		if (depth >= maxDepth) return [`${indent}▸{...}`];
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return [`${indent}{}`];
		const lines = [`${indent}▾{`];
		for (const [key, item] of entries) {
			const child = jsonPrettyLines(item, depth + 1, maxDepth);
			if (child.length === 1) lines.push(`${"  ".repeat(depth + 1)}${JSON.stringify(key)}: ${child[0]?.trimStart() ?? ""}`);
			else {
				lines.push(`${"  ".repeat(depth + 1)}${JSON.stringify(key)}:`);
				lines.push(...child);
			}
		}
		lines.push(`${indent}}`);
		return lines;
	}
	return [`${indent}${primitiveText(String(value))}`];
}

function stripControlText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function primitiveText(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	return String(value);
}

function shortenString(value: string, maxStringChars: number): string {
	if (!Number.isFinite(maxStringChars) || value.length <= maxStringChars) return value;
	const omitted = value.length - maxStringChars;
	return `${value.slice(0, maxStringChars)}... (+${omitted} chars)`;
}
