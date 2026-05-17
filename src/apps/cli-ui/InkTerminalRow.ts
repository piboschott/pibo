import React from "react";
import { Box, Text } from "ink";
import { buildTerminalCardDescriptor, progressBarText, type CompactTerminalLine, type CompactTerminalRow, type TerminalCardDescriptor, type TerminalCardTone } from "../../session-ui/index.js";
import { colorForRowKind, colorForStatus, colorForTone, markerForStatus, type InkTerminalColor } from "./inkColors.js";
import { formatInkJson } from "./inkJson.js";
import { renderInkMarkdownLines } from "./inkMarkdown.js";
import { InkTerminalLine } from "./InkTerminalLine.js";

export type InkTerminalRowProps = {
	row: CompactTerminalRow;
	maxLineChars?: number;
	maxMarkdownLines?: number;
};

export function InkTerminalRow({ row, maxLineChars = 220, maxMarkdownLines = 80 }: InkTerminalRowProps): React.ReactElement {
	const card = buildTerminalCardDescriptor(row);
	if (card) return React.createElement(InkTerminalCard, { card, maxLineChars });
	const lines = rowLines(row, maxMarkdownLines);
	const statusColor = colorForStatus(row.status);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		...lines.map((line, index) => React.createElement(InkTerminalLine, {
			key: `${row.id}-${index}`,
			leadingColor: index === 0 ? rowMarkerColor(row) ?? statusColor : undefined,
			leadingMarker: index === 0 ? rowMarker(row) : " ",
			line,
			maxChars: maxLineChars,
		})),
	);
}

export function InkTerminalCard({ card, maxLineChars = 220 }: { card: TerminalCardDescriptor; maxLineChars?: number }): React.ReactElement {
	const marker = markerForStatus(card.status);
	const color = colorForCardTone(card.tone) ?? colorForStatus(card.status);
	const statusLabel = card.status === "neutral" ? card.kind : `${card.kind} · ${card.status}`;
	const lines: React.ReactElement[] = [
		React.createElement(Text, { color, key: "header", bold: true }, truncateCardLine(`${marker} ▣ ${card.title} — ${statusLabel}`, maxLineChars)),
	];
	for (const [index, row] of card.rows.entries()) {
		const text = row.label ? `  ↳ ${row.label}: ${row.value}` : `  ↳ ${row.value}`;
		lines.push(React.createElement(Text, { color: colorForCardTone(row.tone) ?? "white", key: `row-${index}` }, truncateCardLine(text, maxLineChars)));
	}
	for (const progress of card.statusView?.progress ?? []) {
		const bar = progressBarText(progress, progress.state === "available" ? 18 : 12);
		lines.push(React.createElement(Text, { color: progress.tone === "neutral" ? "gray" : colorForTone(progress.tone), key: `progress-${progress.id}` }, truncateCardLine(`  ↳ ${progress.label}: ${bar} — ${progress.text}`, maxLineChars)));
	}
	for (const [index, warning] of (card.statusView?.warnings ?? []).entries()) {
		lines.push(React.createElement(Text, { color: "yellow", key: `warning-${index}` }, truncateCardLine(`  ⚠ ${warning}`, maxLineChars)));
	}
	for (const [index, error] of (card.statusView?.errors ?? []).entries()) {
		lines.push(React.createElement(Text, { color: "red", key: `error-${index}` }, truncateCardLine(`  ✕ ${error}`, maxLineChars)));
	}
	if (card.actions?.length) {
		const actions = card.actions.map((action) => `${action.disabled ? "-" : "•"} ${action.label}`).join("  ");
		lines.push(React.createElement(Text, { color: "gray", key: "actions" }, truncateCardLine(`  Actions: ${actions}`, maxLineChars)));
	}
	if (lines.length === 1) lines.push(React.createElement(Text, { color: "gray", key: "empty" }, "  ↳ No details"));
	return React.createElement(Box, { flexDirection: "column" }, ...lines);
}

export function rowMarker(row: CompactTerminalRow): string {
	if (row.kind === "message.user") return "›";
	if (row.kind === "message.assistant") return row.status === "running" ? "…" : " ";
	if (row.kind === "error") return "✕";
	return markerForStatus(row.status);
}

function rowMarkerColor(row: CompactTerminalRow): ReturnType<typeof colorForRowKind> {
	return row.status === "error" ? colorForStatus("error") : colorForRowKind(row.kind);
}

function colorForCardTone(tone: TerminalCardTone | undefined): InkTerminalColor | undefined {
	if (tone === "neutral") return "gray";
	return colorForTone(tone as Parameters<typeof colorForTone>[0]);
}

function truncateCardLine(value: string, maxChars: number): string {
	const normalized = value.replace(/\s+/g, " ");
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 12))}… truncated`;
}

function rowLines(row: CompactTerminalRow, maxMarkdownLines: number): CompactTerminalLine[] {
	if (row.lines.length > 0) return row.lines;
	if (row.markdown || typeof row.output === "string") {
		const markdown = row.markdown ?? String(row.output ?? "");
		return renderInkMarkdownLines(markdown, { maxLines: maxMarkdownLines }).map((text) => ({
			prefix: "none",
			tokens: [{ text, tone: row.kind === "reasoning" ? "amber" : undefined }],
		}));
	}
	if (row.error) return [{ prefix: "none", tokens: [{ text: row.error, tone: "red", weight: "semibold" }] }];
	if (row.output !== undefined) return jsonLines(row.output);
	if (row.input !== undefined) return jsonLines(row.input);
	return [{ prefix: "none", tokens: [{ text: fallbackLabel(row), tone: "dim" }] }];
}

function jsonLines(value: unknown): CompactTerminalLine[] {
	return formatInkJson(value).split("\n").map((text) => ({ prefix: "none", tokens: [{ text, tone: "dim" }] }));
}

function fallbackLabel(row: CompactTerminalRow): string {
	return `${row.kind} ${row.status}`.trim();
}
