import type { TraceOrderKey, TraceSource } from "./trace-order.js";

export type PiboTraceNodeType =
	| "user.message"
	| "assistant.message"
	| "agent.turn"
	| "model.reasoning"
	| "tool.call"
	| "tool.result"
	| "agent.delegation"
	| "agent.async"
	| "execution.command"
	| "execution.compaction"
	| "yielded.run"
	| "error";

export type PiboTraceNodeStatus = "running" | "done" | "error";

export type PiboTraceSource = TraceSource;

export type PiboTraceOrderKey = TraceOrderKey;

export type PiboTraceNode = {
	id: string;
	parentId?: string;
	entryId?: string;
	piboSessionId: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	type: PiboTraceNodeType;
	title: string;
	status: PiboTraceNodeStatus;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedPiboSessionId?: string;
	source?: PiboTraceSource;
	stableKey?: string;
	orderKey?: PiboTraceOrderKey;
	children: PiboTraceNode[];
};

export type ChatWebStoredEvent<T = unknown> = {
	id: string;
	piboSessionId?: string;
	eventSequence?: number;
	eventId?: string;
	streamId?: number;
	streamFrameIndex?: number;
	type: string;
	createdAt: string;
	payload: T;
};

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboSessionTraceSummary = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	latestStreamId?: number;
	eventCount: number;
	status?: PiboWebSessionStatus;
};

export type PiboSessionTraceView = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	latestStreamId?: number;
	eventCount?: number;
	eventLimit?: number;
	hasOlderEvents?: boolean;
	nodes: PiboTraceNode[];
	rawEvents: ChatWebStoredEvent[];
};
