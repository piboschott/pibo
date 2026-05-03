import { SessionManager, type AgentSessionRuntime, shouldCompact } from "@mariozechner/pi-coding-agent";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type {
	PiboForkCandidate,
	PiboJsonObject,
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboPiSessionSnapshot,
	PiboSessionListItem,
	PiboSessionOperationResult,
	PiboSessionStatus,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboSessionTreeNode,
	PiboSessionTreeResult,
	PiboThinkingResult,
} from "./events.js";
import type { PiboThinkingLevel } from "./thinking.js";
import type { CompactionResult } from "@mariozechner/pi-coding-agent";
import type { ContextUsage } from "@mariozechner/pi-coding-agent";

type PiSessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

type PiboSessionOperationListener = (
	result: PiboSessionOperationResult,
	event: PiboExecutionEvent,
) => void | Promise<void>;

type PiEventCandidate = {
	type?: unknown;
	message?: unknown;
	assistantMessageEvent?: {
		type?: unknown;
		contentIndex?: unknown;
		delta?: unknown;
		content?: unknown;
		toolCall?: { id?: unknown; name?: unknown; arguments?: unknown };
	};
	toolCallId?: unknown;
	toolName?: unknown;
	args?: unknown;
	partialResult?: unknown;
	result?: unknown;
	isError?: unknown;
};

type PiToolCall = { id: string; name: string; args: unknown };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function messageContentIndex(candidate: PiEventCandidate): number | undefined {
	return typeof candidate.assistantMessageEvent?.contentIndex === "number"
		? candidate.assistantMessageEvent.contentIndex
		: undefined;
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function lastTextPartFromMessage(message: unknown): { text: string; contentIndex: number } | undefined {
	if (!message || typeof message !== "object") return undefined;

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;

	for (let index = content.length - 1; index >= 0; index -= 1) {
		const part = content[index];
		if (!part || typeof part !== "object") continue;
		const candidate = part as { type?: unknown; text?: unknown };
		if (candidate.type === "text" && typeof candidate.text === "string" && candidate.text.length > 0) {
			return { text: candidate.text, contentIndex: index };
		}
	}
	return undefined;
}

function toolCallFromMessage(message: unknown, contentIndex: unknown): PiToolCall | undefined {
	if (!message || typeof message !== "object" || typeof contentIndex !== "number") return undefined;

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;

	const candidate = content[contentIndex];
	if (!candidate || typeof candidate !== "object") return undefined;
	const toolCall = candidate as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
	if (toolCall.type !== "toolCall" || typeof toolCall.id !== "string" || typeof toolCall.name !== "string") {
		return undefined;
	}

	return { id: toolCall.id, name: toolCall.name, args: toolCall.arguments ?? {} };
}

function toolCallFromAssistantEvent(candidate: PiEventCandidate): PiToolCall | undefined {
	const eventToolCall = candidate.assistantMessageEvent?.toolCall;
	if (eventToolCall && typeof eventToolCall.id === "string" && typeof eventToolCall.name === "string") {
		return { id: eventToolCall.id, name: eventToolCall.name, args: eventToolCall.arguments ?? {} };
	}

	return toolCallFromMessage(candidate.message, candidate.assistantMessageEvent?.contentIndex);
}

function normalizeToolCallEvent(piboSessionId: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (
		candidate.type === "message_update" &&
		(candidate.assistantMessageEvent?.type === "toolcall_start" ||
			candidate.assistantMessageEvent?.type === "toolcall_end")
	) {
		const toolCall = toolCallFromAssistantEvent(candidate);
		if (!toolCall) return undefined;

		return {
			type: "tool_call",
			piboSessionId,
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.args,
			argsComplete: candidate.assistantMessageEvent.type === "toolcall_end",
		};
	}

	return undefined;
}

function normalizeToolExecutionEvent(piboSessionId: string, candidate: PiEventCandidate): PiboOutputEvent | undefined {
	if (typeof candidate.toolCallId !== "string" || typeof candidate.toolName !== "string") {
		return undefined;
	}

	if (candidate.type === "tool_execution_start") {
		return {
			type: "tool_execution_started",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
		};
	}

	if (candidate.type === "tool_execution_update") {
		return {
			type: "tool_execution_updated",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			args: candidate.args,
			partialResult: candidate.partialResult,
		};
	}

	if (candidate.type === "tool_execution_end") {
		return {
			type: "tool_execution_finished",
			piboSessionId,
			toolCallId: candidate.toolCallId,
			toolName: candidate.toolName,
			result: candidate.result,
			isError: candidate.isError === true,
		};
	}

	return undefined;
}

function normalizePiEvent(piboSessionId: string, event: unknown): PiboOutputEvent | undefined {
	if (!event || typeof event !== "object") return undefined;

	const candidate = event as PiEventCandidate;

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "text_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return {
			type: "assistant_delta",
			piboSessionId,
			contentIndex: messageContentIndex(candidate),
			text: candidate.assistantMessageEvent.delta,
		};
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_start"
	) {
		return { type: "thinking_started", piboSessionId, contentIndex: messageContentIndex(candidate) };
	}

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "thinking_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return { type: "thinking_delta", piboSessionId, contentIndex: messageContentIndex(candidate), text: candidate.assistantMessageEvent.delta };
	}

	if (candidate.type === "message_update" && candidate.assistantMessageEvent?.type === "thinking_end") {
		const text =
			typeof candidate.assistantMessageEvent.content === "string" ? candidate.assistantMessageEvent.content : undefined;
		return text === undefined
			? { type: "thinking_finished", piboSessionId, contentIndex: messageContentIndex(candidate) }
			: { type: "thinking_finished", piboSessionId, contentIndex: messageContentIndex(candidate), text };
	}

	const toolCallEvent = normalizeToolCallEvent(piboSessionId, candidate);
	if (toolCallEvent) return toolCallEvent;

	const toolExecutionEvent = normalizeToolExecutionEvent(piboSessionId, candidate);
	if (toolExecutionEvent) return toolExecutionEvent;

	if (candidate.type === "message_end") {
		const message = candidate.message as
			| { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
			| undefined;
		const role = message?.role;
		if (role === "assistant") {
			if (message?.stopReason === "error" || typeof message?.errorMessage === "string") {
				return {
					type: "session_error",
					piboSessionId,
					error:
						typeof message.errorMessage === "string" && message.errorMessage.length > 0
							? message.errorMessage
							: "Assistant message failed.",
				};
			}
			const textPart = lastTextPartFromMessage(candidate.message);
			if (textPart) {
				return {
					type: "assistant_message",
					piboSessionId,
					contentIndex: textPart.contentIndex,
					text: textPart.text,
				};
			}
		}
	}

	return undefined;
}

export class RoutedSession {
	private readonly queue: PiboMessageEvent[] = [];
	private processing = false;
	private disposed = false;
	private activeMessage?: PiboMessageEvent;
	private activeAssistantIndex?: number;
	private nextAssistantIndex = 0;
	private activeThinkingIndex?: number;
	private nextThinkingIndex = 0;
	private unsubscribe?: () => void;

	constructor(
		private readonly piboSessionId: string,
		private readonly runtime: AgentSessionRuntime,
		private readonly emit: PiboEventListener,
		private readonly pluginRegistry: PiboPluginRegistry,
		private readonly forwardPiEvents: boolean,
		private readonly onSessionOperation?: PiboSessionOperationListener,
	) {
		this.bindRuntimeSession();
		this.patchAgentContinue();
		this.runtime.setRebindSession(async () => {
			this.bindRuntimeSession();
			this.patchAgentContinue();
		});
	}

	private patchAgentContinue(): void {
		const agent = this.runtime.session.agent;
		const originalContinue = agent.continue.bind(agent);
		const session = this.runtime.session;

		agent.continue = async () => {
			const model = session.model;
			if (!model) return originalContinue();

			const contextWindow = model.contextWindow ?? 0;
			const settings = session.settingsManager.getCompactionSettings();
			if (!settings.enabled) return originalContinue();

			// getContextUsage() already handles the stale-usage-after-compaction
			// check internally. If tokens is null, the last assistant usage predates
			// the latest compaction and we should skip until the next LLM response.
			const contextUsage = session.getContextUsage();
			if (!contextUsage || contextUsage.tokens === null) return originalContinue();

			if (shouldCompact(contextUsage.tokens, contextWindow, settings)) {
				await session.compact();
			}

			return originalContinue();
		};
	}

	private bindRuntimeSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.runtime.session.subscribe((event) => {
			const normalized = normalizePiEvent(this.piboSessionId, event);
			if (normalized) {
				this.emit(this.withActiveMessage(normalized));
			}
			if (this.forwardPiEvents) {
				this.emit({ type: "pi_event", piboSessionId: this.piboSessionId, event });
			}
		});
	}

	enqueueMessage(event: PiboMessageEvent): PiboOutputEvent {
		this.assertActive();
		this.queue.push(event);

		const output: PiboOutputEvent = {
			type: "message_queued",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			queuedMessages: this.queue.length,
			text: event.text,
			source: event.source,
		};
		this.emit(output);
		void this.drain();
		return output;
	}

	async executeAction(event: PiboExecutionEvent): Promise<PiboOutputEvent> {
		this.assertActive();

		const result = await this.runAction(event);
		if (isSessionOperationResult(result)) await this.onSessionOperation?.(result, event);
		const output: PiboOutputEvent = {
			type: "execution_result",
			piboSessionId: this.piboSessionId,
			eventId: event.id,
			action: event.action,
			result,
		};
		this.emit(output);
		return output;
	}

	getStatus(): PiboSessionStatus {
		return {
			piboSessionId: this.piboSessionId,
			queuedMessages: this.queue.length,
			processing: this.processing,
			streaming: this.runtime.session.isStreaming,
			activeTools: this.runtime.session.getActiveToolNames(),
			cwd: this.runtime.cwd,
			disposed: this.disposed,
		};
	}

	getContextUsage(): ContextUsage | undefined {
		return this.runtime.session.getContextUsage();
	}

	removeQueuedMessages(predicate: (event: PiboMessageEvent) => boolean): number {
		this.assertActive();

		let removed = 0;
		for (let index = this.queue.length - 1; index >= 0; index -= 1) {
			if (!predicate(this.queue[index])) continue;
			this.queue.splice(index, 1);
			removed += 1;
		}
		return removed;
	}

	getCurrentSession(): PiboPiSessionSnapshot {
		return this.createSessionSnapshot();
	}

	async listSessions(): Promise<PiboSessionListItem[]> {
		const manager = this.runtime.session.sessionManager;
		const sessions = await SessionManager.list(this.runtime.cwd, manager.getSessionDir());
		return sessions.map((session) => ({
			path: session.path,
			id: session.id,
			cwd: session.cwd,
			name: session.name,
			parentSessionPath: session.parentSessionPath,
			created: session.created.toISOString(),
			modified: session.modified.toISOString(),
			messageCount: session.messageCount,
			firstMessage: session.firstMessage,
		}));
	}

	getForkCandidates(): PiboForkCandidate[] {
		return this.runtime.session.getUserMessagesForForking();
	}

	async forkSession(entryId: string): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.fork(entryId);
		return {
			piboSessionId: this.piboSessionId,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
			selectedText: result.selectedText,
		};
	}

	async cloneSession(): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const leafId = this.runtime.session.sessionManager.getLeafId();
		if (!leafId) {
			throw new Error("Cannot clone session: no current entry selected");
		}
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.fork(leafId, { position: "at" });
		return {
			piboSessionId: this.piboSessionId,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
		};
	}

	getSessionTree(): PiboSessionTreeResult {
		this.assertActive();
		return {
			current: this.createSessionSnapshot(),
			tree: normalizeSessionTree(this.runtime.session.sessionManager.getTree()),
		};
	}

	async navigateSessionTree(params: PiboSessionTreeNavigateParams): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.session.navigateTree(params.entryId, {
			summarize: params.summarize,
			customInstructions: params.customInstructions,
			replaceInstructions: params.replaceInstructions,
			label: params.label,
		});
		return {
			piboSessionId: this.piboSessionId,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
			editorText: result.editorText,
			summaryEntryId: result.summaryEntry?.id,
		};
	}

	async switchSession(params: PiboSessionSwitchParams): Promise<PiboSessionOperationResult> {
		this.assertActive();
		const previous = this.createSessionSnapshot();
		const result = await this.runtime.switchSession(params.sessionFile, { cwdOverride: params.cwdOverride });
		return {
			piboSessionId: this.piboSessionId,
			previous,
			current: this.createSessionSnapshot(),
			cancelled: result.cancelled,
		};
	}

	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult {
		this.assertActive();
		this.runtime.session.setThinkingLevel(level);
		return this.getThinkingResult();
	}

	cycleThinkingLevel(): PiboThinkingResult {
		this.assertActive();
		this.runtime.session.cycleThinkingLevel();
		return this.getThinkingResult();
	}

	async compact(customInstructions?: string): Promise<CompactionResult> {
		this.assertActive();
		return await this.runtime.session.compact(customInstructions);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;

		this.queue.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		await this.runtime.dispose();
	}

	async cancelMessage(eventId: string): Promise<boolean> {
		this.assertActive();

		const queuedIndex = this.queue.findIndex((event) => event.id === eventId);
		if (queuedIndex >= 0) {
			this.queue.splice(queuedIndex, 1);
			return true;
		}

		if (this.activeMessage?.id === eventId) {
			await this.runtime.session.abort();
			return true;
		}

		return false;
	}

	private async drain(): Promise<void> {
		if (this.processing || this.disposed) return;

		this.processing = true;
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const event = this.queue.shift()!;
					this.emit({
						type: "message_started",
						piboSessionId: this.piboSessionId,
					eventId: event.id,
					text: event.text,
					source: event.source,
				});

				try {
					this.activeMessage = event;
					this.activeAssistantIndex = undefined;
					this.nextAssistantIndex = 0;
					this.activeThinkingIndex = undefined;
					this.nextThinkingIndex = 0;
					await this.runtime.session.prompt(event.text, { source: promptSource(event.source) });
					this.emit({
						type: "message_finished",
						piboSessionId: this.piboSessionId,
						eventId: event.id,
						source: event.source,
					});
				} catch (error) {
					this.emit({
						type: "session_error",
						piboSessionId: this.piboSessionId,
						eventId: event.id,
						error: errorMessage(error),
					});
				} finally {
					this.activeMessage = undefined;
					this.activeAssistantIndex = undefined;
					this.nextAssistantIndex = 0;
					this.activeThinkingIndex = undefined;
					this.nextThinkingIndex = 0;
				}
			}
		} finally {
			this.processing = false;
		}
	}

	private async runAction(event: PiboExecutionEvent): Promise<unknown> {
		const action = event.action;
		const gatewayAction = this.pluginRegistry.getGatewayAction(action);
		if (!gatewayAction) {
			throw new Error(`Unknown execution action "${action}"`);
		}

		return await gatewayAction.execute(
			{
				piboSessionId: this.piboSessionId,
				getStatus: () => this.getStatus(),
				getContextUsage: () => this.getContextUsage(),
				clearQueue: () => this.clearQueue(),
				abort: async () => {
					await this.runtime.session.abort();
				},
				dispose: () => this.dispose(),
				getCurrentSession: () => this.getCurrentSession(),
				listSessions: () => this.listSessions(),
				getForkCandidates: () => this.getForkCandidates(),
				forkSession: (entryId) => this.forkSession(entryId),
				cloneSession: () => this.cloneSession(),
				getSessionTree: () => this.getSessionTree(),
				navigateSessionTree: (params) => this.navigateSessionTree(params),
				switchSession: (params) => this.switchSession(params),
				setThinkingLevel: (level) => this.setThinkingLevel(level),
				cycleThinkingLevel: () => this.cycleThinkingLevel(),
				compact: (customInstructions) => this.compact(customInstructions),
			},
			event,
		);
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error(`Session "${this.piboSessionId}" has been disposed`);
		}
	}

	private getThinkingResult(): PiboThinkingResult {
		return {
			level: this.runtime.session.thinkingLevel as PiboThinkingLevel,
			availableLevels: this.runtime.session.getAvailableThinkingLevels() as PiboThinkingLevel[],
			supported: this.runtime.session.supportsThinking(),
		};
	}

	private clearQueue(): number {
		const cleared = this.queue.length;
		this.queue.length = 0;
		return cleared;
	}

	private createSessionSnapshot(): PiboPiSessionSnapshot {
		const session = this.runtime.session;
		const manager = session.sessionManager;
		return {
			piSessionId: session.sessionId,
			sessionFile: session.sessionFile,
			leafId: manager.getLeafId(),
			cwd: this.runtime.cwd,
			sessionName: session.sessionName,
			parentSessionFile: manager.getHeader()?.parentSession,
		};
	}

	private withActiveMessage(event: PiboOutputEvent): PiboOutputEvent {
		if (this.activeMessage?.id && event.type === "assistant_delta") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) {
				this.nextAssistantIndex += 1;
				this.activeAssistantIndex = assistantIndex;
			}
			return { ...event, eventId: this.activeMessage.id, assistantIndex };
		}

		if (this.activeMessage?.id && event.type === "assistant_message") {
			const assistantIndex = this.activeAssistantIndex ?? this.nextAssistantIndex;
			if (this.activeAssistantIndex === undefined) {
				this.nextAssistantIndex += 1;
			}
			this.activeAssistantIndex = undefined;
			return { ...event, eventId: this.activeMessage.id, assistantIndex };
		}

		if (this.activeMessage?.id && event.type === "thinking_started") {
			const thinkingIndex = this.nextThinkingIndex;
			this.nextThinkingIndex += 1;
			this.activeThinkingIndex = thinkingIndex;
			return { ...event, eventId: this.activeMessage.id, thinkingIndex };
		}

		if (this.activeMessage?.id && (event.type === "thinking_delta" || event.type === "thinking_finished")) {
			const thinkingIndex = this.activeThinkingIndex ?? this.nextThinkingIndex;
			if (this.activeThinkingIndex === undefined) {
				this.nextThinkingIndex += 1;
				this.activeThinkingIndex = thinkingIndex;
			}
			const output = { ...event, eventId: this.activeMessage.id, thinkingIndex };
			if (event.type === "thinking_finished") this.activeThinkingIndex = undefined;
			return output;
		}

		if (
			this.activeMessage?.id &&
			(event.type === "tool_call" ||
				event.type === "tool_execution_started" ||
				event.type === "tool_execution_updated" ||
				event.type === "tool_execution_finished" ||
				event.type === "session_error")
		) {
			return { ...event, eventId: this.activeMessage.id };
		}

		return event;
	}
}

function normalizeSessionTree(nodes: PiSessionTreeNode[]): PiboSessionTreeNode[] {
	return nodes.map((node) => ({
		entry: JSON.parse(JSON.stringify(node.entry)) as PiboJsonObject,
		children: normalizeSessionTree(node.children),
		label: node.label,
		labelTimestamp: node.labelTimestamp,
	}));
}

function isSessionOperationResult(value: unknown): value is PiboSessionOperationResult {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { piboSessionId?: unknown; current?: { piSessionId?: unknown } };
	return (
		typeof candidate.piboSessionId === "string" &&
		Boolean(candidate.current) &&
		typeof candidate.current?.piSessionId === "string"
	);
}
