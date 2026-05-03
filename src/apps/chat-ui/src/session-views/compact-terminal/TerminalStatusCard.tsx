import { useState } from "react";
import { Activity, Cpu, Folder, Hash, Layers } from "lucide-react";
import type { CompactTerminalRow } from "./terminalRows";

type StatusData = {
	piboSessionId?: string;
	queuedMessages?: number;
	processing?: boolean;
	streaming?: boolean;
	activeTools?: string[];
	cwd?: string;
	disposed?: boolean;
	contextUsage?: {
		tokens?: number;
		contextWindow?: number;
		percent?: number;
	};
};

function parseStatusData(output: unknown): StatusData | undefined {
	if (!output) return undefined;
	let obj: Record<string, unknown> | undefined;
	if (typeof output === "string") {
		try {
			obj = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return undefined;
		}
	} else if (typeof output === "object" && !Array.isArray(output)) {
		obj = output as Record<string, unknown>;
	}
	if (!obj) return undefined;

	const contextUsage =
		typeof obj.contextUsage === "object" && obj.contextUsage !== null
			? (obj.contextUsage as Record<string, unknown>)
			: undefined;

	return {
		piboSessionId:
			typeof obj.piboSessionId === "string" ? obj.piboSessionId : undefined,
		queuedMessages:
			typeof obj.queuedMessages === "number" ? obj.queuedMessages : undefined,
		processing:
			typeof obj.processing === "boolean" ? obj.processing : undefined,
		streaming:
			typeof obj.streaming === "boolean" ? obj.streaming : undefined,
		activeTools: Array.isArray(obj.activeTools)
			? obj.activeTools.filter((t): t is string => typeof t === "string")
			: undefined,
		cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
		disposed:
			typeof obj.disposed === "boolean" ? obj.disposed : undefined,
		contextUsage: contextUsage
			? {
					tokens:
						typeof contextUsage.tokens === "number"
							? contextUsage.tokens
							: undefined,
					contextWindow:
						typeof contextUsage.contextWindow === "number"
							? contextUsage.contextWindow
							: undefined,
					percent:
						typeof contextUsage.percent === "number"
							? contextUsage.percent
							: undefined,
				}
			: undefined,
	};
}

export function TerminalStatusCard({ row }: { row: CompactTerminalRow }) {
	const data = parseStatusData(row.output);
	const [toolsExpanded, setToolsExpanded] = useState(false);

	if (!data) {
		return (
			<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
				<div className="text-[#737373]">Status (unparseable)</div>
			</div>
		);
	}

	const percent = data.contextUsage?.percent ?? 0;
	const percentFormatted = percent.toFixed(1);
	const barColor =
		percent >= 80
			? "bg-[#ef4444]"
			: percent >= 50
				? "bg-[#facc15]"
				: "bg-[#22c55e]";
	const tokens = data.contextUsage?.tokens ?? 0;
	const maxTokens = data.contextUsage?.contextWindow ?? 0;

	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
			{/* Header */}
			<div className="mb-2 flex items-center gap-2">
				<Activity size={14} className="text-[#22c55e]" />
				<span className="font-semibold text-[#d4d4d4]">Status</span>
			</div>

			{/* Session Info */}
			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
				{data.piboSessionId ? (
					<div className="flex items-center gap-1.5 text-[11px]">
						<Hash size={11} className="shrink-0 text-[#737373]" />
						<span className="shrink-0 text-[#737373]">Session:</span>
						<span className="truncate font-mono text-[#38bdf8]">
							{data.piboSessionId}
						</span>
					</div>
				) : null}
				{data.cwd ? (
					<div className="flex items-center gap-1.5 text-[11px]">
						<Folder size={11} className="shrink-0 text-[#737373]" />
						<span className="shrink-0 text-[#737373]">CWD:</span>
						<span className="truncate font-mono text-[#d4d4d4]">
							{data.cwd}
						</span>
					</div>
				) : null}
			</div>

			{/* State Badges */}
			<div className="mt-2 flex flex-wrap gap-1.5">
				{data.processing ? (
					<span className="inline-flex items-center gap-1 border border-[#1f4960] px-1.5 py-0.5 text-[11px] text-[#38bdf8]">
						<Cpu size={10} /> Processing
					</span>
				) : null}
				{data.streaming ? (
					<span className="inline-flex items-center gap-1 border border-[#1f4960] px-1.5 py-0.5 text-[11px] text-[#38bdf8]">
						<Activity size={10} /> Streaming
					</span>
				) : null}
				{typeof data.queuedMessages === "number" &&
				data.queuedMessages > 0 ? (
					<span className="inline-flex items-center gap-1 border border-[#3a3a3a] px-1.5 py-0.5 text-[11px] text-[#d4d4d4]">
						<Layers size={10} /> Queued: {data.queuedMessages}
					</span>
				) : null}
				{data.disposed ? (
					<span className="inline-flex items-center gap-1 border border-[#5f2222] px-1.5 py-0.5 text-[11px] text-[#ef4444]">
						Disposed
					</span>
				) : null}
			</div>

			{/* Context Usage Bar */}
			{data.contextUsage ? (
				<div className="mt-3 space-y-1">
					<div className="flex items-center justify-between text-[11px]">
						<span className="text-[#737373]">Context Usage</span>
						<span className="font-mono text-[#d4d4d4]">
							{tokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens (
							{percentFormatted}%)
						</span>
					</div>
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
						<div
							className={`h-full rounded-full ${barColor} transition-all`}
							style={{ width: `${Math.min(percent, 100)}%` }}
						/>
					</div>
				</div>
			) : null}

			{/* Foldable Tools */}
			{data.activeTools && data.activeTools.length > 0 ? (
				<div className="mt-3">
					<button
						type="button"
						onClick={() => setToolsExpanded((v) => !v)}
						className="flex items-center gap-1.5 text-[11px] text-[#737373] hover:text-[#d4d4d4]"
					>
						<span className="text-[#d4d4d4]">
							{toolsExpanded ? "▾" : "▸"}
						</span>
						<span>Tools ({data.activeTools.length})</span>
					</button>
					{toolsExpanded ? (
						<div className="mt-1.5 flex flex-wrap gap-1">
							{data.activeTools.map((tool) => (
								<span
									key={tool}
									className="inline-block rounded-sm border border-[#2a2a2a] bg-[#0b0b0b] px-1.5 py-0.5 font-mono text-[11px] text-[#a3a3a3]"
								>
									{tool}
								</span>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
