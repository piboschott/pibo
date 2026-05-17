import React from "react";
import { Box, Text } from "ink";
import { buildTerminalCardDescriptor, progressBarText, redactTerminalSecret, type CompactTerminalDetailItem, type CompactTerminalLine, type CompactTerminalRow, type TerminalCardDescriptor, type TerminalCardTone } from "../../session-ui/index.js";
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
	const detailLines = rowDetailLines(row, maxLineChars);
	if (card) return React.createElement(Box, { flexDirection: "column" }, React.createElement(InkTerminalCard, { card, maxLineChars }), ...detailLines);
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
		...detailLines,
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
		const bar = inkProgressBarText(progress, progress.state === "available" ? 18 : 12);
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

function inkProgressBarText(progress: Parameters<typeof progressBarText>[0], width: number): string {
	const text = progressBarText(progress, width);
	if (progress.state !== "available" || progress.percent === undefined) return text;
	if (!shouldUseAsciiProgress()) return text;
	const boundedWidth = Math.max(4, Math.min(80, Math.floor(width)));
	const filled = Math.round((Math.max(0, Math.min(100, progress.percent)) / 100) * boundedWidth);
	return `${"#".repeat(filled)}${"-".repeat(boundedWidth - filled)} ${progress.percent.toFixed(1)}%`;
}

function shouldUseAsciiProgress(): boolean {
	return Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb" || process.env.PIBO_ASCII_PROGRESS === "1";
}

function rowDetailLines(row: CompactTerminalRow, maxLineChars: number): React.ReactElement[] {
	const details: CompactTerminalDetailItem[] = [...(row.detailItems ?? [])];
	if (row.linkedPiboSessionId && !details.some((item) => item.linkedPiboSessionId === row.linkedPiboSessionId)) {
		details.push({ id: `${row.id}:linked-session`, label: "Linked session", status: "done", linkedPiboSessionId: row.linkedPiboSessionId });
	}
	if (!details.length) return [];
	return details.flatMap((detail, index) => detailTextLines(detail, maxLineChars).map((text, lineIndex) => React.createElement(Text, {
		color: detail.status === "error" ? "red" : "gray",
		key: `${row.id}:detail:${detail.id}:${index}:${lineIndex}`,
	}, truncateCardLine(lineIndex === 0 ? `  ↳ ${text}` : `    ${text}`, maxLineChars))));
}

function detailTextLines(detail: CompactTerminalDetailItem, maxLineChars: number): string[] {
	const label = detail.status === "error" && !/error/i.test(detail.label) ? `${detail.label} error` : detail.label;
	const parts: string[] = [];
	if (detail.linkedPiboSessionId) parts.push(redactTerminalSecret(detail.linkedPiboSessionId));
	if (detail.input !== undefined) parts.push(`Input ${detailValueText(detail.input, maxLineChars)}`);
	if (detail.output !== undefined) parts.push(`Output ${detailValueText(detail.output, maxLineChars)}`);
	if (detail.error) parts.push(`Error ${redactTerminalSecret(detail.error)}`);
	if (parts.length === 0) parts.push(detail.status);
	return [`${label}: ${parts.join(" · ")}`];
}

function detailValueText(value: unknown, maxLineChars: number): string {
	const text = typeof value === "string"
		? value
		: formatInkJson(value, { maxChars: Math.min(420, Math.max(120, maxLineChars * 3)), maxDepth: 3, maxArrayItems: 4, maxObjectKeys: 8 });
	const redacted = redactTerminalSecret(text).replace(/\s+/g, " ").trim();
	return truncateCardLine(redacted, Math.min(220, Math.max(80, maxLineChars - 12)));
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
