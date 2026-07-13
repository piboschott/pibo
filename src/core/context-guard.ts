import {
	DEFAULT_COMPACTION_SETTINGS,
	buildSessionContext,
	estimateTokens,
	type ExtensionContext,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const PIBO_CONTEXT_GUARD_NOTICE = "Context safety interrupted this response before adding it to long-term context. Pibo is compacting the session before continuing.";
export const PIBO_CONTEXT_GUARD_RESUME_MESSAGE_TYPE = "pibo-context-guard-resume";
export const PIBO_CONTEXT_GUARD_RESUME_PROMPT = "Continue the interrupted task autonomously from the compacted context. Do not wait for additional user input and do not repeat the context-safety notice.";
const DEFAULT_MIN_COMPACTION_RESERVE_TOKENS = 1024;
const FALLBACK_CONTEXT_WINDOW = 0;
const MAX_CONTEXT_GUARD_RECOVERY_ATTEMPTS = 3;

type RecoveryOutcome = { ok: true } | { ok: false; error: Error };

type PendingRecovery = {
	promise: Promise<RecoveryOutcome>;
	resolve: (outcome: RecoveryOutcome) => void;
	settled: boolean;
};

export type PiboAssistantContextGuardRecovery = {
	begin(): void;
	complete(): void;
	fail(error: Error): void;
	cancel(error: Error): void;
	claim(): void;
	isClaimed(): boolean;
	isPending(): boolean;
	onCancel(handler: () => void): void;
	wait(): Promise<boolean>;
};

const contextGuardRecoveries = new WeakMap<object, PiboAssistantContextGuardRecovery>();

export function createPiboAssistantContextGuardRecovery(): PiboAssistantContextGuardRecovery {
	let pending: PendingRecovery | undefined;
	let claimed = false;
	let cancelError: Error | undefined;
	let cancelHandler: (() => void) | undefined;

	return {
		begin() {
			if (pending && !pending.settled) return;
			cancelError = undefined;
			let resolve!: (outcome: RecoveryOutcome) => void;
			const promise = new Promise<RecoveryOutcome>((done) => {
				resolve = done;
			});
			pending = { promise, resolve, settled: false };
		},
		complete() {
			if (!pending || pending.settled) return;
			pending.settled = true;
			pending.resolve({ ok: true });
		},
		fail(error) {
			if (!pending || pending.settled) return;
			pending.settled = true;
			pending.resolve({ ok: false, error });
		},
		cancel(error) {
			cancelError = error;
			if (pending && !pending.settled) {
				pending.settled = true;
				pending.resolve({ ok: false, error });
			}
			cancelHandler?.();
		},
		claim() {
			claimed = true;
		},
		isClaimed() {
			return claimed;
		},
		isPending() {
			return pending !== undefined && !pending.settled;
		},
		onCancel(handler) {
			cancelHandler = handler;
		},
		async wait() {
			const current = pending;
			if (!current) return false;
			const outcome = await current.promise;
			const cancelled = cancelError;
			if (pending === current) {
				pending = undefined;
				cancelError = undefined;
			}
			if (cancelled) throw cancelled;
			if (!outcome.ok) throw outcome.error;
			return true;
		},
	};
}

export function registerPiboAssistantContextGuardRecovery(
	session: object,
	recovery: PiboAssistantContextGuardRecovery,
): void {
	contextGuardRecoveries.set(session, recovery);
}

export function claimPiboAssistantContextGuardRecovery(session: object): void {
	contextGuardRecoveries.get(session)?.claim();
}

export function cancelPiboAssistantContextGuardRecovery(session: object, error: Error): void {
	contextGuardRecoveries.get(session)?.cancel(error);
}

export function isPiboAssistantContextGuardRecoveryPending(session: object): boolean {
	return contextGuardRecoveries.get(session)?.isPending() ?? false;
}

export async function waitForPiboAssistantContextGuardRecovery(session: object): Promise<boolean> {
	return await contextGuardRecoveries.get(session)?.wait() ?? false;
}

type ContextGuardOptions = {
	reserveTokens?: number;
	minReserveTokens?: number;
};

type GuardState = {
	deltaChars: number;
	tripped: boolean;
	compactQueued: boolean;
	resumeRequested: boolean;
	resumeInProgress: boolean;
	resumeSettling: boolean;
	resumeStartTimer?: ReturnType<typeof setTimeout>;
	recoveryAttempts: number;
	lastProjection?: ContextGuardProjection;
};

type AssistantMessageUpdateEvent = {
	message: AgentMessage;
	assistantMessageEvent: unknown;
};

export type ContextGuardProjection = {
	contextTokens: number;
	assistantTokens: number;
	reserveTokens: number;
	contextWindow: number;
	projectedTokens: number;
	exceedsLimit: boolean;
};

function textTokensByLength(length: number): number {
	return Math.ceil(length / 4);
}

function finitePositive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function guardReserveTokens(contextWindow: number, options: ContextGuardOptions): number {
	const configured = finitePositive(options.reserveTokens);
	if (configured !== undefined) return configured;

	const minReserve = finitePositive(options.minReserveTokens) ?? DEFAULT_MIN_COMPACTION_RESERVE_TOKENS;
	const requestedReserve = Math.max(minReserve, Math.floor(contextWindow * 0.2));
	return Math.min(DEFAULT_COMPACTION_SETTINGS.reserveTokens ?? 16384, requestedReserve, Math.floor(contextWindow * 0.5));
}

function estimateMessageTokens(message: AgentMessage): number {
	return estimateTokens(message as Parameters<typeof estimateTokens>[0]);
}

function estimateBranchContextTokens(ctx: ExtensionContext): number {
	const leafId = ctx.sessionManager.getLeafId();
	const branch = ctx.sessionManager.getBranch(leafId ?? undefined);
	const sessionContext = buildSessionContext(branch, leafId);
	return sessionContext.messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), 0);
}

function contextWindowFrom(ctx: ExtensionContext): number {
	const usageWindow = finitePositive(ctx.getContextUsage()?.contextWindow);
	if (usageWindow !== undefined) return usageWindow;
	return finitePositive((ctx.model as { contextWindow?: unknown } | undefined)?.contextWindow) ?? FALLBACK_CONTEXT_WINDOW;
}

function baselineContextTokens(ctx: ExtensionContext): number {
	const usageTokens = finitePositive(ctx.getContextUsage()?.tokens);
	const estimatedTokens = estimateBranchContextTokens(ctx);
	return usageTokens === undefined ? estimatedTokens : Math.max(usageTokens, estimatedTokens);
}

export function projectAssistantContextGuard(
	ctx: ExtensionContext,
	assistantTokens: number,
	options: ContextGuardOptions = {},
): ContextGuardProjection | undefined {
	const contextWindow = contextWindowFrom(ctx);
	if (contextWindow <= 0) return undefined;

	const contextTokens = baselineContextTokens(ctx);
	const reserveTokens = guardReserveTokens(contextWindow, options);
	const projectedTokens = contextTokens + assistantTokens + reserveTokens;
	return {
		contextTokens,
		assistantTokens,
		reserveTokens,
		contextWindow,
		projectedTokens,
		exceedsLimit: projectedTokens > contextWindow,
	};
}

function assistantDeltaChars(event: AssistantMessageUpdateEvent): number {
	if (!event.assistantMessageEvent || typeof event.assistantMessageEvent !== "object") return 0;
	const assistantEvent = event.assistantMessageEvent as { delta?: unknown; content?: unknown; toolCall?: { name?: unknown; arguments?: unknown } };
	if (typeof assistantEvent.delta === "string") return assistantEvent.delta.length;
	if (typeof assistantEvent.content === "string") return assistantEvent.content.length;
	if (assistantEvent.toolCall) {
		return String(assistantEvent.toolCall.name ?? "").length + JSON.stringify(assistantEvent.toolCall.arguments ?? {}).length;
	}
	return 0;
}

function replacementAssistantMessage(message: AgentMessage): AgentMessage {
	return {
		...message,
		content: [{ type: "text", text: PIBO_CONTEXT_GUARD_NOTICE }],
		stopReason: "aborted",
		errorMessage: undefined,
	} as AgentMessage;
}

function compactionInstructions(projection: ContextGuardProjection | undefined): string {
	const usage = projection
		? ` Projected context was ${projection.projectedTokens} / ${projection.contextWindow} tokens, including ${projection.assistantTokens} tokens from the interrupted assistant response and ${projection.reserveTokens} reserved tokens for compaction.`
		: "";
	return `Pibo interrupted the previous assistant response before persisting the full output because it would exceed the safe context budget.${usage} Summarize the durable conversation up to the guard notice, preserve the user's current task and important recent facts, and leave enough context budget for the next response.`;
}

export function createPiboAssistantContextGuardExtension(
	options: ContextGuardOptions = {},
	recovery: PiboAssistantContextGuardRecovery = createPiboAssistantContextGuardRecovery(),
): ExtensionFactory {
	return (pi) => {
		const state: GuardState = {
			deltaChars: 0,
			tripped: false,
			compactQueued: false,
			resumeRequested: false,
			resumeInProgress: false,
			resumeSettling: false,
			recoveryAttempts: 0,
		};

		function resetAssistantState(): void {
			state.deltaChars = 0;
			state.tripped = false;
			state.compactQueued = false;
			state.lastProjection = undefined;
		}

		function clearResumeStartTimer(): void {
			if (state.resumeStartTimer === undefined) return;
			clearTimeout(state.resumeStartTimer);
			state.resumeStartTimer = undefined;
		}

		function resetRecoveryState(): void {
			clearResumeStartTimer();
			state.tripped = false;
			state.compactQueued = false;
			state.resumeRequested = false;
			state.resumeInProgress = false;
			state.resumeSettling = false;
			state.recoveryAttempts = 0;
		}

		function failRecovery(error: Error): void {
			resetRecoveryState();
			recovery.fail(error);
		}

		recovery.onCancel(resetRecoveryState);

		function tripIfNeeded(ctx: ExtensionContext, assistantTokens: number): boolean {
			const projection = projectAssistantContextGuard(ctx, assistantTokens, options);
			state.lastProjection = projection;
			if (!projection?.exceedsLimit) return false;
			state.tripped = true;
			return true;
		}

		pi.on("agent_start", () => {
			if (!state.resumeRequested) return;
			clearResumeStartTimer();
			state.resumeRequested = false;
			state.resumeInProgress = true;
		});

		pi.on("agent_settled", () => {
			if (!state.resumeSettling) return;
			state.resumeSettling = false;
			state.recoveryAttempts = 0;
			recovery.complete();
		});

		pi.on("message_start", (event) => {
			if (event.message.role === "assistant") resetAssistantState();
		});

		pi.on("message_update", (event, ctx) => {
			if (event.message.role !== "assistant") return;
			state.deltaChars += assistantDeltaChars(event);
			const assistantTokens = Math.max(estimateMessageTokens(event.message), textTokensByLength(state.deltaChars));
			if (tripIfNeeded(ctx, assistantTokens)) ctx.abort();
		});

		pi.on("message_end", (event, ctx) => {
			if (event.message.role !== "assistant") return;
			const assistantTokens = Math.max(estimateMessageTokens(event.message), textTokensByLength(state.deltaChars));
			if (!state.tripped && !tripIfNeeded(ctx, assistantTokens)) return;
			return { message: replacementAssistantMessage(event.message) };
		});

		pi.on("agent_end", (_event, ctx) => {
			if (state.tripped && !state.compactQueued) {
				if (state.recoveryAttempts >= MAX_CONTEXT_GUARD_RECOVERY_ATTEMPTS) {
					failRecovery(new Error(
						`Context guard recovery exceeded ${MAX_CONTEXT_GUARD_RECOVERY_ATTEMPTS} compaction attempts`,
					));
					return;
				}

				state.compactQueued = true;
				state.recoveryAttempts++;
				recovery.begin();
				let callbackHandled = false;
				ctx.compact({
					customInstructions: compactionInstructions(state.lastProjection),
					onComplete: () => {
						if (callbackHandled || !recovery.isPending()) return;
						callbackHandled = true;
						state.tripped = false;
						state.compactQueued = false;
						state.resumeRequested = true;
						if (recovery.isClaimed()) {
							recovery.complete();
							return;
						}
						state.resumeStartTimer = setTimeout(() => {
							failRecovery(new Error("Context guard continuation did not start"));
						}, 5000);
						pi.sendMessage({
							customType: PIBO_CONTEXT_GUARD_RESUME_MESSAGE_TYPE,
							content: [{ type: "text", text: PIBO_CONTEXT_GUARD_RESUME_PROMPT }],
							display: false,
						}, { triggerTurn: true });
					},
					onError: (error) => {
						if (callbackHandled || !recovery.isPending()) return;
						callbackHandled = true;
						failRecovery(error);
					},
				});
				return;
			}

			if (!state.resumeInProgress) return;
			state.resumeInProgress = false;
			state.resumeSettling = true;
		});
	};
}
