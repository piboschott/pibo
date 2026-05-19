import React from "react";
import { Box, Text } from "ink";
import type { CompactTerminalRow } from "../../session-ui/index.js";
import { InkTerminalRow } from "./InkTerminalRow.js";

export type InkTerminalViewProps = {
	rows: readonly CompactTerminalRow[];
	maxRows?: number;
	maxLineChars?: number;
	showOmittedCount?: boolean;
	selectedRowId?: string;
	expandedRowIds?: readonly string[];
};

const DEFAULT_MAX_ROWS = 200;

export function InkTerminalView({ rows, maxRows = DEFAULT_MAX_ROWS, maxLineChars, showOmittedCount = true, selectedRowId, expandedRowIds = [] }: InkTerminalViewProps): React.ReactElement {
	const windowedRows = rowWindow(rows, maxRows);
	const omitted = Math.max(0, rows.length - windowedRows.length);
	const expanded = new Set(expandedRowIds);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		...(showOmittedCount && omitted > 0
			? [React.createElement(Text, { color: "gray", key: "omitted" }, `… ${omitted} earlier rows omitted`)]
			: []),
		...windowedRows.map((row) => React.createElement(InkTerminalRow, {
			key: row.id,
			maxLineChars,
			row,
			isExpanded: expanded.has(row.id),
			isSelected: row.id === selectedRowId,
		})),
	);
}

export function rowWindow<T>(rows: readonly T[], maxRows = DEFAULT_MAX_ROWS): readonly T[] {
	if (!Number.isFinite(maxRows) || maxRows <= 0) return [];
	if (rows.length <= maxRows) return rows;
	return rows.slice(rows.length - maxRows);
}
