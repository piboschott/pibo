import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BookOpenText, Brain, CheckCheck, Code2, CopyPlus, Layers, Loader2, RefreshCw } from "lucide-react";
import {
	getWorkflowDraft,
	getWorkflowHandlerPicker,
	getWorkflowProfilePicker,
	postWorkflowDuplicateDraft,
	type WorkflowDraftRecord,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
} from "./api";

const DEFAULT_AGENT_PROMPT_TEMPLATE = "Use the workflow input to produce a concise answer.\n\n{{input}}";
const STARTER_DRAFT_ID = "v2-starter-draft";
const PUBLISHED_WORKFLOW_ROWS = [
	{
		id: "standard-project",
		version: "1.0.0",
		title: "Standard Project",
		description: "Code-registered workflow available for duplicate-to-draft authoring.",
	},
	{
		id: "simple-chat",
		version: "1.0.0",
		title: "Simple Chat",
		description: "Baseline chat workflow available for draft loading checks.",
	},
];

export function WorkflowsArea({ draftId }: { draftId?: string }) {
	return (
		<main className="h-full min-h-0 overflow-auto bg-[#101d22]">
			<section className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 max-[720px]:p-4" aria-labelledby="workflows-title">
				<div className="rounded-sm border border-slate-800 bg-[#151f24] p-5 shadow-lg shadow-black/20">
					<div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#11a4d4]">Workflow UI Authoring V2</div>
					<h1 id="workflows-title" className="mt-2 text-2xl font-extrabold tracking-tight text-slate-100">Workflows</h1>
					<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
						Browse workflow definitions, duplicate published workflows into UI drafts, and open draft wrappers that edit Pibo Workflow IR from the authenticated Chat Web surface.
					</p>
				</div>

				<div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
					<WorkflowSurfaceCard
						icon={BookOpenText}
						eyebrow="Global catalog"
						title="Workflow Library"
						description="Open UI drafts or duplicate published workflow versions into a draft before editing."
					>
						<WorkflowLibraryPanel activeDraftId={draftId} />
					</WorkflowSurfaceCard>

					<WorkflowSurfaceCard
						icon={Layers}
						eyebrow="Visual authoring"
						title="Workflow Builder"
						description="Load a UI draft wrapper and keep Pibo Workflow IR as the editable source of truth."
					>
						{draftId ? <WorkflowBuilderDraftLoader draftId={draftId} /> : <WorkflowBuilderLanding />}
					</WorkflowSurfaceCard>
				</div>

				<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24] p-4 text-xs text-slate-400 md:grid-cols-3">
					<WorkflowPrinciple icon={CheckCheck} label="Pibo Workflow IR remains the source of truth" />
					<WorkflowPrinciple icon={CopyPlus} label="Code workflows can be duplicated into UI drafts" />
					<WorkflowPrinciple icon={Layers} label="XState stays a read-only visualization projection" />
				</div>
			</section>
		</main>
	);
}

function WorkflowLibraryPanel({ activeDraftId }: { activeDraftId?: string }) {
	const [duplicatingKey, setDuplicatingKey] = useState<string | undefined>();
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	const duplicateWorkflow = async (workflowId: string, version: string) => {
		const key = `${workflowId}@${version}`;
		setDuplicatingKey(key);
		setErrorMessage(undefined);
		try {
			const result = await postWorkflowDuplicateDraft(workflowId, { version });
			openBuilderPath(result.builderPath);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Failed to duplicate workflow into a draft");
			setDuplicatingKey(undefined);
		}
	};

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
				<div className="flex items-start justify-between gap-3">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">UI draft</div>
						<h3 className="mt-1 text-sm font-bold text-slate-100">Starter UI draft</h3>
						<p className="mt-2 text-xs leading-5 text-slate-500">
							A draft row opens the builder route and loads a partial Pibo Workflow IR wrapper with diagnostics.
						</p>
					</div>
					<a
						className="shrink-0 rounded-sm border border-[#11a4d4]/50 px-3 py-1.5 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100"
						href={workflowBuilderDraftPath(STARTER_DRAFT_ID)}
					>
						Open draft
					</a>
				</div>
				{activeDraftId === STARTER_DRAFT_ID ? <div className="mt-3 text-[11px] font-semibold text-emerald-300">Currently open in the builder.</div> : null}
			</div>

			<div className="grid gap-3">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Published workflows</div>
				{PUBLISHED_WORKFLOW_ROWS.map((workflow) => {
					const key = `${workflow.id}@${workflow.version}`;
					return (
						<div key={key} className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="font-semibold text-slate-100">{workflow.title}</div>
									<div className="mt-1 font-mono text-[11px] text-slate-500">{workflow.id}@{workflow.version}</div>
									<p className="mt-2 text-xs leading-5 text-slate-500">{workflow.description}</p>
								</div>
								<button
									type="button"
									className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => void duplicateWorkflow(workflow.id, workflow.version)}
									disabled={Boolean(duplicatingKey)}
								>
									{duplicatingKey === key ? <Loader2 size={13} className="animate-spin" /> : <CopyPlus size={13} />}
									Duplicate to draft
								</button>
							</div>
						</div>
					);
				})}
			</div>

			{errorMessage ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage}
				</div>
			) : null}
		</div>
	);
}

function WorkflowBuilderLanding() {
	return (
		<div className="flex w-full flex-col gap-4">
			<WorkflowEmptyState
				title="Open a draft to start authoring"
				description="Use the Workflow Library draft row or Duplicate to draft action. The builder route will load a draft wrapper around Pibo Workflow IR, not raw XState source."
			/>
			<WorkflowBuilderAgentNodeEditor />
			<WorkflowBuilderCodeNodeEditor />
		</div>
	);
}

function WorkflowBuilderDraftLoader({ draftId }: { draftId: string }) {
	const [draft, setDraft] = useState<WorkflowDraftRecord | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowDraft(draftId)
			.then((response) => {
				if (cancelled) return;
				setDraft(response.draft);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow draft");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [draftId]);

	if (loadState === "loading") {
		return (
			<div className="flex w-full items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4 text-sm text-slate-300" aria-live="polite">
				<Loader2 size={16} className="animate-spin text-[#11a4d4]" />
				Loading workflow draft {draftId}…
			</div>
		);
	}

	if (loadState === "error" || !draft) {
		return (
			<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-4 text-sm leading-6 text-red-200" role="alert">
				<div className="font-bold">Could not load workflow draft</div>
				<div className="mt-1 text-xs">{errorMessage ?? `Draft '${draftId}' was not found.`}</div>
			</div>
		);
	}

	return <WorkflowDraftEditorShell draft={draft} />;
}

function WorkflowDraftEditorShell({ draft }: { draft: WorkflowDraftRecord }) {
	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Loaded UI draft</div>
					<h3 className="mt-1 text-lg font-bold text-slate-100">{String(draft.definition.title ?? draft.workflowId)}</h3>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						Builder route <code className="rounded bg-slate-900 px-1 text-slate-300">/workflows/drafts/{draft.draftId}</code> loaded a draft wrapper around partial Pibo Workflow IR.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${draft.source} source`} />
					<WorkflowPill label={draft.status} />
					<WorkflowPill label={draft.validationState} />
					<WorkflowPill label={`rev ${draft.revision}`} />
				</div>
			</div>

			<div className="grid gap-3 text-xs md:grid-cols-2" aria-label="Workflow draft metadata">
				<WorkflowFact label="Draft id" value={draft.draftId} />
				<WorkflowFact label="Workflow id" value={draft.workflowId} />
				<WorkflowFact label="Base workflow" value={draft.baseWorkflowId && draft.baseWorkflowVersion ? `${draft.baseWorkflowId}@${draft.baseWorkflowVersion}` : "new UI draft"} />
				<WorkflowFact label="Version intent" value={draft.versionIntent} />
			</div>

			{draft.diagnostics.length ? <WorkflowDraftDiagnostics draft={draft} /> : (
				<div className="rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-200">No draft diagnostics returned by the loader.</div>
			)}

			<div>
				<div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Pibo Workflow IR draft</div>
				<pre aria-label="Pibo Workflow IR draft" className="max-h-80 overflow-auto rounded-sm border border-slate-800 bg-[#151f24] p-3 text-[11px] leading-5 text-slate-200">
					{JSON.stringify(draft.definition, null, 2)}
				</pre>
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Raw XState source is not opened as an editable document. XState remains projection-only; the editable source is the Pibo Workflow IR shown above.
			</div>
		</div>
	);
}

function WorkflowDraftDiagnostics({ draft }: { draft: WorkflowDraftRecord }) {
	return (
		<div className="grid gap-2" aria-label="Workflow draft diagnostics">
			{draft.diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? "workflow"}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					{diagnostic.path ? <div className="mt-1 font-mono text-[11px] text-amber-200/80">{diagnostic.path}</div> : null}
					{diagnostic.hint ? <div className="mt-1 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
	);
}

function WorkflowBuilderAgentNodeEditor() {
	const [selectedProfileId, setSelectedProfileId] = useState(readInitialProfileRef);
	const [promptTemplate, setPromptTemplate] = useState(DEFAULT_AGENT_PROMPT_TEMPLATE);
	const [picker, setPicker] = useState<WorkflowProfilePickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowProfilePicker(selectedProfileId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedProfileId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedProfileId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Brain size={13} />
						Agent node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a non-archived Agent Designer profile and edit the direct prompt template stored on the Pibo Workflow IR node.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshProfilePicker(selectedProfileId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Agent Designer profile</span>
				<select
					aria-label="Agent Designer profile"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedProfileId ?? ""}
					onChange={(event) => setSelectedProfileId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a non-archived profile</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{profileOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow profile picker."}
				</div>
			) : null}

			{selectedOption ? <ProfileSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Agent profile diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Prompt template</span>
				<textarea
					aria-label="Agent prompt template"
					className="min-h-28 resize-y rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-[#11a4d4]"
					value={promptTemplate}
					onChange={(event) => setPromptTemplate(event.target.value)}
				/>
				<span className="text-[11px] font-normal leading-5 text-slate-500">
					This editor is enabled for Agent nodes with a direct <code className="rounded bg-slate-900 px-1 text-slate-300">promptTemplate</code>. Nodes backed by registered prompt builders remain registry-controlled.
				</span>
			</label>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Archived profiles are intentionally omitted from the picker. If a loaded draft already references one, the API returns a structured diagnostic and keeps the selection empty.
			</div>
		</div>
	);
}

function WorkflowBuilderCodeNodeEditor() {
	const [selectedHandlerId, setSelectedHandlerId] = useState(readInitialHandlerRef);
	const [picker, setPicker] = useState<WorkflowHandlerPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowHandlerPicker(selectedHandlerId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedHandlerId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedHandlerId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Code2 size={13} />
						Code node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered Workflow Registry handler ref. The UI stores only the handler id on the Pibo Workflow IR node and never opens inline TypeScript, JavaScript, shell, or eval code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshHandlerPicker(selectedHandlerId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered code handler</span>
				<select
					aria-label="Registered code handler"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedHandlerId ?? ""}
					onChange={(event) => setSelectedHandlerId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered handler ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{handlerOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow handler picker."}
				</div>
			) : null}

			{selectedOption ? <HandlerSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Code handler diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<div className="grid gap-3" aria-label="Registered handler picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered handler refs</div>
				{picker?.options.map((option) => <HandlerOptionCard key={option.id} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Missing handler refs return structured <code className="rounded bg-slate-900 px-1 text-slate-300">WorkflowGraphError.unknownHandlerRef</code> diagnostics and block publish/run paths once executable validation is invoked.
			</div>
		</div>
	);
}

function readInitialProfileRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("profileRef") ?? "";
}

function readInitialHandlerRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("handlerRef") ?? "";
}

async function refreshProfilePicker(
	selectedProfileId: string,
	setPicker: (picker: WorkflowProfilePickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowProfilePicker(selectedProfileId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
		setLoadState("error");
	}
}

async function refreshHandlerPicker(
	selectedHandlerId: string,
	setPicker: (picker: WorkflowHandlerPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowHandlerPicker(selectedHandlerId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
		setLoadState("error");
	}
}

function profileOptionLabel(option: WorkflowProfilePickerOption): string {
	return option.source === "custom" ? `${option.displayName} (custom)` : `${option.displayName} (global)`;
}

function ProfileSelectionSummary({ option }: { option: WorkflowProfilePickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected profile: {option.displayName}</div>
			{option.description ? <div className="mt-1 text-slate-500">{option.description}</div> : null}
			<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={option.source === "custom" ? "Custom Agent" : "Global profile"} />
				<WorkflowPill label={`${option.nativeTools.length} native tools`} />
				<WorkflowPill label={`${option.skills.length} skills`} />
				<WorkflowPill label={`${option.contextFiles.length} context files`} />
			</div>
		</div>
	);
}

function handlerOptionLabel(option: WorkflowHandlerPickerOption): string {
	return `${option.displayName} (${option.id})`;
}

function HandlerSelectionSummary({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected handler: {option.displayName}</div>
			<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}

function HandlerOptionCard({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.displayName}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
				</div>
				<WorkflowPill label="registered handler" />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}

function HandlerSchemaPreview({ label, schema }: { label: string; schema: Record<string, unknown> | null }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-300">{formatNullableSchema(schema)}</pre>
		</div>
	);
}

function formatNullableSchema(schema: Record<string, unknown> | null): string {
	return schema ? JSON.stringify(schema, null, 2) : "null";
}

function WorkflowPill({ label }: { label: string }) {
	return <span className="rounded-full border border-slate-700 bg-[#101d22] px-2 py-0.5 text-slate-400">{label}</span>;
}

function WorkflowFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3">
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<div className="mt-1 break-all font-mono text-[11px] text-slate-200">{value}</div>
		</div>
	);
}

function WorkflowSurfaceCard({ icon: Icon, eyebrow, title, description, children }: { icon: LucideIcon; eyebrow: string; title: string; description: string; children: ReactNode }) {
	return (
		<section className="flex min-h-72 flex-col rounded-sm border border-slate-800 bg-[#151f24] p-5 shadow-lg shadow-black/20">
			<div className="flex items-start gap-3">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#11a4d4]/35 bg-[#11a4d4]/10 text-[#11a4d4]">
					<Icon size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div>
					<h2 className="mt-1 text-lg font-bold text-slate-100">{title}</h2>
					<p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
				</div>
			</div>
			<div className="mt-5 flex flex-1">{children}</div>
		</section>
	);
}

function WorkflowEmptyState({ title, description }: { title: string; description: string }) {
	return (
		<div className="flex w-full flex-col justify-center rounded-sm border border-dashed border-slate-700 bg-[#101d22]/70 p-4 text-center">
			<div className="text-sm font-semibold text-slate-200">{title}</div>
			<p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
		</div>
	);
}

function WorkflowPrinciple({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
	return (
		<div className="flex items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/60 px-3 py-2">
			<Icon size={14} className="shrink-0 text-[#11a4d4]" />
			<span>{label}</span>
		</div>
	);
}

function workflowBuilderDraftPath(draftId: string): string {
	return `/apps/chat/workflows/drafts/${encodeURIComponent(draftId)}`;
}

function openBuilderPath(path: string): void {
	if (typeof window === "undefined") return;
	window.location.assign(path);
}
