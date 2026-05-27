import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BookOpenText, Brain, CheckCheck, Code2, CopyPlus, ExternalLink, Layers, Link2, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowDraft,
	getWorkflowHandlerPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	postWorkflowDraftPublish,
	postWorkflowDraftValidate,
	type WorkflowDraftRecord,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowVersionPickerResponse,
} from "./api-workflows";
import { DEFAULT_AGENT_PROMPT_TEMPLATE } from "./workflows/workflow-node-defaults";
import { WorkflowGraphCanvas } from "./workflows/WorkflowGraphCanvas";
import { WorkflowInspectorsPanel } from "./workflows/WorkflowInspectorsPanel";
import { WorkflowLibraryPanel } from "./workflows/WorkflowLibraryPanel";
import { WorkflowRawIrEditor } from "./workflows/WorkflowRawIrEditor";
import { WorkflowVersionDiagnostics, WorkflowVersionOptionCard, WorkflowVersionSelectionSummary, WorkflowVersionViewer } from "./workflows/WorkflowVersionViewer";
import { HandlerSchemaPreview, RegisteredRefOptionCard, WorkflowInspectorPickerDiagnostics } from "./workflows/workflow-registry-cards";
import { WorkflowPill } from "./workflows/workflow-shared-ui";
import { handlerOptionLabel, profileOptionLabel, registeredRefOptionLabel, workflowVersionOptionKey, workflowVersionOptionLabel } from "./workflows/workflow-picker-labels";
import { parseWorkflowVersionKey, workflowVersionViewerPath, type WorkflowVersionSelection } from "./workflows/workflow-routes";
export function WorkflowsArea({ draftId, viewWorkflowId, viewWorkflowVersion }: { draftId?: string; viewWorkflowId?: string; viewWorkflowVersion?: string }) {
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
						{draftId ? (
							<WorkflowBuilderDraftLoader draftId={draftId} />
						) : viewWorkflowId && viewWorkflowVersion ? (
							<WorkflowVersionViewer workflowId={viewWorkflowId} workflowVersion={viewWorkflowVersion} />
						) : (
							<WorkflowBuilderLanding />
						)}
					</WorkflowSurfaceCard>
				</div>

				<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24] p-4 text-xs text-slate-400 md:grid-cols-4">
					<WorkflowPrinciple icon={CheckCheck} label="Pibo Workflow IR remains the source of truth" />
					<WorkflowPrinciple icon={CopyPlus} label="Code workflows can be duplicated into UI drafts" />
					<WorkflowPrinciple icon={ShieldCheck} label="Workflow capabilities are registered refs only" />
					<WorkflowPrinciple icon={Layers} label="XState stays a read-only visualization projection" />
				</div>

				<WorkflowExplicitNonGoalsPanel />
			</section>
		</main>
	);
}


function WorkflowBuilderLanding() {
	return (
		<div className="flex w-full flex-col gap-4">
			<WorkflowEmptyState
				title="Open a draft to start authoring"
				description="Use the Workflow Library draft row or Duplicate to draft action. The builder route will load a draft wrapper around Pibo Workflow IR, not raw XState source."
			/>
			<WorkflowSecurityBoundaryPanel />
			<WorkflowBuilderAgentNodeEditor />
			<WorkflowBuilderCodeNodeEditor />
			<WorkflowBuilderAdapterNodeEditor />
			<WorkflowBuilderWorkflowNodeEditor />
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

function WorkflowExplicitNonGoalsPanel() {
	return (
		<div className="rounded-sm border border-amber-700/60 bg-amber-950/15 p-4 text-xs leading-5 text-amber-100" aria-label="Workflow V2 explicit non-goals">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
				<ShieldCheck size={13} />
				V2 scope boundary
			</div>
			<p className="mt-2 text-amber-100/90">
				Workflows V2 is an authoring surface for Pibo Workflow IR and registered capability references, not a code or product import/export surface.
			</p>
			<ul className="mt-3 grid gap-1 text-[11px] text-amber-100/75 md:grid-cols-2">
				<li>No inline TypeScript, JavaScript, shell, eval, arbitrary executable code, or raw handler body authoring.</li>
				<li>No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents.</li>
				<li>No YAML/JSON product import/export or TypeScript export path from UI-authored workflows.</li>
				<li>No Zod schema authoring; schema edits remain constrained to Pibo Workflow IR and registered metadata.</li>
			</ul>
		</div>
	);
}

function WorkflowSecurityBoundaryPanel() {
	return (
		<div className="rounded-sm border border-emerald-900/60 bg-emerald-950/15 p-4 text-xs leading-5 text-emerald-100" aria-label="Registered capability security boundary">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
				<ShieldCheck size={13} />
				Registered capability security boundary
			</div>
			<p className="mt-2 text-emerald-100/90">
				V2 authoring composes registered refs only: non-archived Agent profiles, code handlers, adapters, guards, nested workflows, human actions, and prompt assets.
			</p>
			<ul className="mt-3 grid gap-1 text-[11px] text-emerald-100/75">
				<li>Existing Chat Web auth plus Project and Pibo Session visibility rules still gate workflow catalog, Project workflow sessions, snapshots, lifecycle events, prompt assets, and human actions.</li>
				<li>Agent nodes select profile refs only; the UI does not grant extra tools, skills, context files, native tools, MCP servers, or compute-worker access beyond the selected runtime profile.</li>
				<li>No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies are created by the UI.</li>
				<li>Incompatible schemas must use a visible registered adapter node or edge adapter; hidden LLM coercion is not used.</li>
				<li>XState remains projection-only; Pibo Workflow IR is the persisted source of truth.</li>
				<li>Workflow inputs, outputs, prompts, prompt assets, state, edge payloads, snapshots, and human action payloads remain sensitive workflow data; normal diagnostics expose only sanitized metadata.</li>
			</ul>
		</div>
	);
}

function WorkflowDraftEditorShell({ draft }: { draft: WorkflowDraftRecord }) {
	const [currentDraft, setCurrentDraft] = useState(draft);
	const [versionIntent, setVersionIntent] = useState<"patch" | "minor" | "major">(draft.versionIntent);
	const [publishState, setPublishState] = useState<"idle" | "validating" | "validated" | "publishing" | "published" | "error">("idle");
	const [publishMessage, setPublishMessage] = useState<string | undefined>();
	const publishActionBusy = publishState === "validating" || publishState === "publishing";
	const publishErrorCount = currentDraft.validation?.errorCount ?? currentDraft.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const publishWarningCount = currentDraft.validation?.warningCount ?? currentDraft.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const publishBlocked = currentDraft.validation?.blocksPublish === true || publishErrorCount > 0;

	useEffect(() => {
		setCurrentDraft(draft);
		setVersionIntent(draft.versionIntent);
		setPublishState("idle");
		setPublishMessage(undefined);
	}, [draft]);

	const validateDraft = async () => {
		setPublishState("validating");
		setPublishMessage(undefined);
		try {
			const response = await postWorkflowDraftValidate(currentDraft.draftId);
			setCurrentDraft(response.draft);
			setVersionIntent(response.draft.versionIntent);
			setPublishState("validated");
			setPublishMessage(`Draft validation ${response.validation.ok ? "passed" : "returned diagnostics"}. Publish remains a separate action.`);
		} catch (error) {
			setPublishState("error");
			setPublishMessage(error instanceof Error ? error.message : "Failed to validate workflow draft");
		}
	};

	const publishDraft = async () => {
		setPublishState("publishing");
		setPublishMessage(undefined);
		try {
			const response = await postWorkflowDraftPublish(currentDraft.draftId, { versionIntent });
			setCurrentDraft(response.draft);
			setVersionIntent(response.draft.versionIntent);
			setPublishState("published");
			setPublishMessage(response.publishedVersion
				? `${response.message ?? "Published workflow draft."} Definition hash ${response.publishedVersion.definitionHash}.`
				: response.message ?? "Publish validation passed.");
		} catch (error) {
			setPublishState("error");
			setPublishMessage(error instanceof Error ? error.message : "Failed to publish workflow draft");
		}
	};

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Loaded UI draft</div>
					<h3 className="mt-1 text-lg font-bold text-slate-100">{String(currentDraft.definition.title ?? currentDraft.workflowId)}</h3>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						Builder route <code className="rounded bg-slate-900 px-1 text-slate-300">/workflows/drafts/{currentDraft.draftId}</code> loaded a draft wrapper around partial Pibo Workflow IR.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${currentDraft.source} source`} />
					<WorkflowPill label={currentDraft.status} />
					<WorkflowPill label={currentDraft.validationState} />
					<WorkflowPill label={`rev ${currentDraft.revision}`} />
				</div>
			</div>

			<div className="grid gap-3 text-xs md:grid-cols-2" aria-label="Workflow draft metadata">
				<WorkflowFact label="Draft id" value={currentDraft.draftId} />
				<WorkflowFact label="Workflow id" value={currentDraft.workflowId} />
				<WorkflowFact label="Base workflow" value={currentDraft.baseWorkflowId && currentDraft.baseWorkflowVersion ? `${currentDraft.baseWorkflowId}@${currentDraft.baseWorkflowVersion}` : "new UI draft"} />
				<WorkflowFact label="Next version path" value={currentDraft.targetWorkflowVersion ?? "not assigned yet"} />
				<WorkflowFact label="Version intent" value={currentDraft.versionIntent} />
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Workflow publish version panel">
				<div id="workflow-publish-gate" className={`mb-3 rounded-sm border p-3 text-xs leading-5 ${publishBlocked ? "border-amber-700/70 bg-amber-950/30 text-amber-100" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} aria-label="Workflow publish gate" role="status">
					<div className="font-semibold">{publishBlocked ? "Publish blocked by draft diagnostics" : "Publish gate ready"}</div>
					<p className="mt-1">
						{publishBlocked
							? `Publish is disabled because ${publishErrorCount} error diagnostic${publishErrorCount === 1 ? "" : "s"} ${publishErrorCount === 1 ? "remains" : "remain"}. Draft save remains allowed while you fix errors; before-publish validation also requires workflow input/output ports and at least one node.`
							: publishWarningCount > 0
								? `Warnings do not block publishing. Before-publish validation still runs and will block if workflow input/output ports, graph nodes, or registered refs are invalid.`
								: "No blocking diagnostics are present. Before-publish validation will run again before creating an immutable workflow version."}
					</p>
				</div>
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Publish version intent</div>
						<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
							Default publish increments the patch version. Choose minor or major when the release scope needs a larger semantic version bump.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
							<span>Version bump intent</span>
							<select
								className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-[#11a4d4]"
								value={versionIntent}
								onChange={(event) => setVersionIntent(event.target.value as "patch" | "minor" | "major")}
								disabled={publishActionBusy}
								aria-label="Version bump intent"
							>
								<option value="patch">Patch version bump (default)</option>
								<option value="minor">Minor version bump</option>
								<option value="major">Major version bump</option>
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-[#11a4d4] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void validateDraft()}
							disabled={publishActionBusy}
						>
							{publishState === "validating" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
							Validate draft
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-600/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void publishDraft()}
							disabled={publishActionBusy || publishBlocked}
							aria-describedby="workflow-publish-gate"
						>
							{publishState === "publishing" ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
							Publish draft
						</button>
					</div>
				</div>
				{publishMessage ? (
					<div className={`mt-3 rounded-sm border p-3 text-xs leading-5 ${publishState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role={publishState === "error" ? "alert" : "status"}>
						{publishMessage}
					</div>
				) : null}
			</div>

			<WorkflowSecurityBoundaryPanel />

			<WorkflowGraphCanvas
				draft={currentDraft}
				onDraftChange={setCurrentDraft}
				renderInspectors={(props) => <WorkflowInspectorsPanel {...props} />}
			/>

			<WorkflowValidationPanel draft={currentDraft} />

			<WorkflowRawIrEditor draft={currentDraft} onDraftChange={setCurrentDraft} />

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Raw XState source is not opened as an editable document. XState remains projection-only; the editable source is the Pibo Workflow IR shown above and in the raw Pibo Workflow IR editor.
			</div>
		</div>
	);
}

function WorkflowValidationPanel({ draft }: { draft: WorkflowDraftRecord }) {
	const validation = draft.validation;
	const errorCount = validation?.errorCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = validation?.warningCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const infoCount = validation?.infoCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "info").length;
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Workflow validation panel">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Validation panel</div>
					<h4 className="mt-1 text-sm font-bold text-slate-100">Structured draft diagnostics</h4>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
						Draft validation reports sanitized diagnostic fields from the Workflow IR pipeline. Publish remains gated by blocking error diagnostics and the backend before-publish route.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${errorCount} errors`} />
					<WorkflowPill label={`${warningCount} warnings`} />
					<WorkflowPill label={`${infoCount} info`} />
				</div>
			</div>
			<div className="mt-3 grid gap-3 text-xs md:grid-cols-3" aria-label="Workflow validation summary">
				<WorkflowFact label="Validation state" value={draft.validationState} />
				<WorkflowFact label="Last trigger" value={validation?.trigger ?? "not checked"} />
				<WorkflowFact label="Checked at" value={validation?.checkedAt ?? "not checked"} />
				<WorkflowFact label="Publish gate" value={validation?.blocksPublish ? "blocked" : "not blocked"} />
				<WorkflowFact label="Run gate" value={validation?.blocksRun ? "blocked" : "not blocked"} />
				<WorkflowFact label="Diagnostic count" value={String(draft.diagnostics.length)} />
			</div>
			{draft.diagnostics.length ? <WorkflowDraftDiagnostics draft={draft} /> : (
				<div className="mt-3 rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-200">No validation diagnostics returned by the draft pipeline.</div>
			)}
		</div>
	);
}

function WorkflowDraftDiagnostics({ draft }: { draft: WorkflowDraftRecord }) {
	return (
		<div className="mt-3 grid gap-2" aria-label="Workflow structured diagnostics">
			{draft.diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? diagnostic.registryRef ?? "workflow"}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
						<WorkflowDiagnosticMeta label="Severity" value={diagnostic.severity} />
						<WorkflowDiagnosticMeta label="Path" value={diagnostic.path} />
						<WorkflowDiagnosticMeta label="Node" value={diagnostic.nodeId} />
						<WorkflowDiagnosticMeta label="Edge" value={diagnostic.edgeId} />
						<WorkflowDiagnosticMeta label="Registry ref" value={diagnostic.registryRef} />
					</div>
					{diagnostic.hint ? <div className="mt-2 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
	);
}

function WorkflowDiagnosticMeta({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<span className="rounded-sm border border-amber-700/50 bg-amber-950/40 px-2 py-0.5">
			<span className="font-semibold text-amber-200/80">{label}:</span> <code>{value}</code>
		</span>
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

function WorkflowBuilderAdapterNodeEditor() {
	const [selectedAdapterRef, setSelectedAdapterRef] = useState(readInitialAdapterRef);
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowAdapterPicker(selectedAdapterRef || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdapterRef]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedRefId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Link2 size={13} />
						Adapter node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered deterministic adapter ref for visible adapter nodes. The UI stores only the registry ref and never opens inline transformation code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshAdapterPicker(selectedAdapterRef, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered adapter</span>
				<select
					aria-label="Registered adapter"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedRefId ?? ""}
					onChange={(event) => setSelectedAdapterRef(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered adapter ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow adapter picker."}
				</div>
			) : null}

			{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge="registered adapter" /> : null}
			<WorkflowInspectorPickerDiagnostics diagnostics={diagnostics} />

			<div className="grid gap-3" aria-label="Registered adapter picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered adapter refs</div>
				{picker?.options.map((option) => <RegisteredRefOptionCard key={option.id} option={option} badge="registered adapter" />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Adapter nodes are visible graph nodes for schema transformation. Incompatible edges can alternatively use the compatible edge adapter dialog to keep the adapter on the edge.
			</div>
		</div>
	);
}

function WorkflowBuilderWorkflowNodeEditor() {
	const [selection, setSelection] = useState<WorkflowVersionSelection>(readInitialWorkflowSelection);
	const [picker, setPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		})
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selection.workflowId, selection.workflowVersion]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion),
		[picker],
	);
	const selectedKey = selectedOption ? workflowVersionOptionKey(selectedOption) : "";
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Layers size={13} />
						Workflow node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a published workflow id/version from registry metadata. The parent graph stores only this reference and opens the child workflow separately.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshWorkflowVersionPicker(selection, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Nested workflow version</span>
				<select
					aria-label="Nested workflow picker"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={selectedKey}
					onChange={(event) => setSelection(parseWorkflowVersionKey(event.target.value) ?? { workflowId: "", workflowVersion: "" })}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a published workflow version</option>
					{picker?.options.map((option) => (
						<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow version picker."}
				</div>
			) : null}

			{selectedOption ? <WorkflowVersionSelectionSummary option={selectedOption} /> : null}

			<WorkflowVersionDiagnostics diagnostics={diagnostics} ariaLabel="Nested workflow diagnostics" />

			<a
				className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold transition ${selectedOption ? "border-[#11a4d4]/50 text-[#8bdcf4] hover:border-[#11a4d4] hover:text-slate-100" : "pointer-events-none border-slate-800 text-slate-600"}`}
				href={selectedOption ? workflowVersionViewerPath(selectedOption.id, selectedOption.version) : "#"}
				aria-disabled={!selectedOption}
			>
				<ExternalLink size={13} />
				Open workflow
			</a>

			<div className="grid gap-3" aria-label="Nested workflow picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Published workflow refs</div>
				{picker?.options.map((option) => <WorkflowVersionOptionCard key={workflowVersionOptionKey(option)} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Nested workflow internals stay collapsed in the parent graph for V2. Use <span className="font-semibold text-slate-300">Open workflow</span> to navigate to the child workflow viewer instead of inline-expanding its graph.
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

function readInitialAdapterRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("adapterRef") ?? "";
}

function readInitialWorkflowSelection(): WorkflowVersionSelection {
	if (typeof window === "undefined") return { workflowId: "", workflowVersion: "" };
	const searchParams = new URL(window.location.href).searchParams;
	const workflowRef = searchParams.get("workflowRef");
	if (workflowRef) return parseWorkflowVersionKey(workflowRef) ?? { workflowId: workflowRef, workflowVersion: "" };
	return {
		workflowId: searchParams.get("workflowId") ?? "",
		workflowVersion: searchParams.get("workflowVersion") ?? "",
	};
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

async function refreshAdapterPicker(
	selectedRefId: string,
	setPicker: (picker: WorkflowRegisteredRefPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowAdapterPicker(selectedRefId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
		setLoadState("error");
	}
}

async function refreshWorkflowVersionPicker(
	selection: WorkflowVersionSelection,
	setPicker: (picker: WorkflowVersionPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		}));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
		setLoadState("error");
	}
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
