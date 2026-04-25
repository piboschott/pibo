import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import {
	createDefaultPiboProfile,
	InitialSessionContext,
	type InitialSessionContextOptions,
} from "./profiles.js";
import { createPiboRuntime, type PiboRuntimeOptions } from "./runtime.js";
import type {
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./events.js";

export type {
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./events.js";

export type PiboSessionRouterOptions = Omit<PiboRuntimeOptions, "profile"> & {
	profile?: InitialSessionContext;
	forwardPiEvents?: boolean;
};

function profileForSession(baseProfile: InitialSessionContext, sessionKey: string): InitialSessionContext {
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		sessionId: sessionKey,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		contextFiles: baseProfile.contextFiles,
		builtinTools: baseProfile.builtinTools,
	};

	return new InitialSessionContext(options);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function promptSource(source: PiboEventSource | undefined): "interactive" | "rpc" {
	return source === "user" || source === "ui" ? "interactive" : "rpc";
}

function textFromMessage(message: unknown): string {
	if (!message || typeof message !== "object") return "";

	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
		})
		.join("");
}

function normalizePiEvent(sessionKey: string, event: unknown): PiboOutputEvent | undefined {
	if (!event || typeof event !== "object") return undefined;

	const candidate = event as {
		type?: unknown;
		message?: unknown;
		assistantMessageEvent?: { type?: unknown; delta?: unknown };
	};

	if (
		candidate.type === "message_update" &&
		candidate.assistantMessageEvent?.type === "text_delta" &&
		typeof candidate.assistantMessageEvent.delta === "string"
	) {
		return { type: "assistant_delta", sessionKey, text: candidate.assistantMessageEvent.delta };
	}

	if (candidate.type === "message_end") {
		const role = (candidate.message as { role?: unknown } | undefined)?.role;
		if (role === "assistant") {
			const text = textFromMessage(candidate.message);
			if (text) {
				return { type: "assistant_message", sessionKey, text };
			}
		}
	}

	return undefined;
}

class RoutedSession {
	private readonly queue: PiboMessageEvent[] = [];
	private processing = false;
	private disposed = false;
	private activeMessage?: PiboMessageEvent;
	private unsubscribe?: () => void;

	constructor(
		private readonly sessionKey: string,
		private readonly runtime: AgentSessionRuntime,
		private readonly emit: PiboEventListener,
		forwardPiEvents: boolean,
	) {
		this.unsubscribe = this.runtime.session.subscribe((event) => {
			const normalized = normalizePiEvent(this.sessionKey, event);
			if (normalized) {
				this.emit(this.withActiveMessage(normalized));
			}
			if (forwardPiEvents) {
				this.emit({ type: "pi_event", sessionKey: this.sessionKey, event });
			}
		});
	}

	enqueueMessage(event: PiboMessageEvent): PiboOutputEvent {
		this.assertActive();
		this.queue.push(event);

		const output: PiboOutputEvent = {
			type: "message_queued",
			sessionKey: this.sessionKey,
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

		const result = await this.runAction(event.action);
		const output: PiboOutputEvent = {
			type: "execution_result",
			sessionKey: this.sessionKey,
			eventId: event.id,
			action: event.action,
			result,
		};
		this.emit(output);
		return output;
	}

	getStatus(): PiboSessionStatus {
		return {
			sessionKey: this.sessionKey,
			queuedMessages: this.queue.length,
			processing: this.processing,
			streaming: this.runtime.session.isStreaming,
			activeTools: this.runtime.session.getActiveToolNames(),
			cwd: this.runtime.cwd,
			disposed: this.disposed,
		};
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;

		this.queue.length = 0;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.disposed = true;
		await this.runtime.dispose();
	}

	private async drain(): Promise<void> {
		if (this.processing || this.disposed) return;

		this.processing = true;
		try {
			while (this.queue.length > 0 && !this.disposed) {
				const event = this.queue.shift()!;
				this.emit({
					type: "message_started",
					sessionKey: this.sessionKey,
					eventId: event.id,
					text: event.text,
					source: event.source,
				});

				try {
					this.activeMessage = event;
					await this.runtime.session.prompt(event.text, { source: promptSource(event.source) });
					this.emit({ type: "message_finished", sessionKey: this.sessionKey, eventId: event.id });
				} catch (error) {
					this.emit({
						type: "session_error",
						sessionKey: this.sessionKey,
						eventId: event.id,
						error: errorMessage(error),
					});
				} finally {
					this.activeMessage = undefined;
				}
			}
		} finally {
			this.processing = false;
		}
	}

	private async runAction(action: PiboExecutionAction): Promise<unknown> {
		switch (action) {
			case "status":
				return this.getStatus();
			case "session_id":
				return { sessionKey: this.sessionKey };
			case "clear_queue": {
				const cleared = this.queue.length;
				this.queue.length = 0;
				return { cleared };
			}
			case "abort":
				await this.runtime.session.abort();
				return { aborted: true };
			case "dispose":
				await this.dispose();
				return { disposed: true };
		}
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error(`Session "${this.sessionKey}" has been disposed`);
		}
	}

	private withActiveMessage(event: PiboOutputEvent): PiboOutputEvent {
		if (
			this.activeMessage?.id &&
			(event.type === "assistant_delta" || event.type === "assistant_message")
		) {
			return { ...event, eventId: this.activeMessage.id };
		}

		return event;
	}
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly baseProfile: InitialSessionContext;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.baseProfile = options.profile ?? createDefaultPiboProfile();
	}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		const session = await this.getOrCreateSession(event.sessionKey);

		if (event.type === "message") {
			return session.enqueueMessage(event);
		}

		const output = await session.executeAction(event);
		if (event.action === "dispose") {
			this.sessions.delete(event.sessionKey);
		}
		return output;
	}

	getSessionKeys(): string[] {
		return [...this.sessions.keys()];
	}

	async disposeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(sessions.map((session) => session.dispose()));
	}

	private async getOrCreateSession(sessionKey: string): Promise<RoutedSession> {
		const existing = this.sessions.get(sessionKey);
		if (existing) return existing;

		const pending = this.pendingSessions.get(sessionKey);
		if (pending) return pending;

		const created = this.createRoutedSession(sessionKey);
		this.pendingSessions.set(sessionKey, created);
		try {
			return await created;
		} finally {
			this.pendingSessions.delete(sessionKey);
		}
	}

	private async createRoutedSession(sessionKey: string): Promise<RoutedSession> {
		const runtime = await createPiboRuntime({
			cwd: this.options.cwd,
			persistSession: this.options.persistSession,
			profile: profileForSession(this.baseProfile, sessionKey),
		});
		const session = new RoutedSession(sessionKey, runtime, this.emitOutput, this.options.forwardPiEvents ?? false);
		this.sessions.set(sessionKey, session);
		return session;
	}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		for (const listener of this.listeners) {
			listener(event);
		}
	};
}
