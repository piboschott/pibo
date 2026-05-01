import { Wrench } from "lucide-react";
import { MarkdownRenderer } from "../tracing/MarkdownRenderer";
import type { AgentCatalog } from "../types";

export function PiboToolsView({ tools }: { tools: AgentCatalog["piboTools"] }) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-[#101d22]">
			<div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4">
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Context</div>
					<h2 className="truncate text-base font-semibold text-slate-100">Pibo Tools</h2>
					<div className="truncate font-mono text-[11px] text-slate-500">Installed tool hints injected into agent context</div>
				</div>
				<span className="inline-flex h-8 items-center gap-1.5 border border-slate-700 bg-[#101d22] px-2.5 text-xs text-slate-300">
					<Wrench size={14} className="text-[#11a4d4]" />
					{tools.length} installed
				</span>
			</div>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{tools.length === 0 ? (
					<div className="border border-dashed border-slate-700 bg-[#151f24] px-4 py-5 text-sm text-slate-500">
						No curated Pibo Tools are currently installed.
					</div>
				) : (
					<div className="grid gap-3">
						<div className="border border-slate-800 bg-[#151f24] px-4 py-3 text-sm text-slate-400">
							These are the short hints injected into agent context for installed curated CLI tools. The CLI remains the source of truth for the full workflow.
						</div>
						{tools.map((tool) => (
							<section key={tool.name} className="border border-slate-800 bg-[#151f24]">
								<div className="border-b border-slate-800 px-4 py-3">
									<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Installed Tool</div>
									<h3 className="truncate text-sm font-semibold text-slate-100">{tool.name}</h3>
									<p className="mt-1 text-xs text-slate-500">{tool.description}</p>
								</div>
								<div className="px-4 py-4">
									<div className="model-response-markdown text-sm">
										<MarkdownRenderer>{tool.snippet}</MarkdownRenderer>
									</div>
								</div>
							</section>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
