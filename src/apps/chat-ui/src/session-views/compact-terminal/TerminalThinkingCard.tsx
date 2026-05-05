import { Brain, Check, X } from "lucide-react";
import type { CompactTerminalRow } from "./terminalRows";

type ThinkingData = {
	level?: string;
	availableLevels: string[];
	supported?: boolean;
};

function parseThinkingData(output: unknown): ThinkingData | undefined {
	let obj: Record<string, unknown> | undefined;
	if (typeof output === "string") {
		try {
			obj = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return undefined;
		}
	} else if (output && typeof output === "object" && !Array.isArray(output)) {
		obj = output as Record<string, unknown>;
	}
	if (!obj) return undefined;
	return {
		level: typeof obj.level === "string" ? obj.level : undefined,
		availableLevels: Array.isArray(obj.availableLevels)
			? obj.availableLevels.filter((level): level is string => typeof level === "string")
			: [],
		supported: typeof obj.supported === "boolean" ? obj.supported : undefined,
	};
}

export function TerminalThinkingCard({ row }: { row: CompactTerminalRow }) {
	const data = parseThinkingData(row.output);

	if (!data) {
		return (
			<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
				<div className="text-[#737373]">Thinking (unparseable)</div>
			</div>
		);
	}

	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
			<div className="mb-2 flex items-center gap-2">
				<Brain size={14} className="text-[#f59e0b]" />
				<span className="font-semibold text-[#d4d4d4]">Thinking</span>
				{data.supported === false ? (
					<span className="ml-auto inline-flex items-center gap-1 border border-[#5f2222] px-1.5 py-0.5 text-[11px] text-[#ef4444]">
						<X size={10} /> Unsupported
					</span>
				) : (
					<span className="ml-auto inline-flex items-center gap-1 border border-[#1f4960] px-1.5 py-0.5 text-[11px] text-[#38bdf8]">
						<Check size={10} /> Supported
					</span>
				)}
			</div>
			<div className="grid gap-1.5 text-[11px]">
				<div className="flex items-center gap-2">
					<span className="text-[#737373]">Current:</span>
					<span className="font-mono font-semibold text-[#f59e0b]">{data.level ?? "unknown"}</span>
				</div>
				{data.availableLevels.length ? (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-[#737373]">Available:</span>
						{data.availableLevels.map((level) => (
							<span
								key={level}
								className={`border px-1.5 py-0.5 ${level === data.level ? "border-[#f59e0b] text-[#f59e0b]" : "border-[#3a3a3a] text-[#d4d4d4]"}`}
							>
								{level}
							</span>
						))}
					</div>
				) : null}
				<div className="text-[#737373]">Use <span className="text-[#f59e0b]">/thinking &lt;level&gt;</span> or <span className="text-[#f59e0b]">/thinking-high</span>.</div>
			</div>
		</div>
	);
}
