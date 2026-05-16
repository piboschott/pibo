import type { ModelProfile } from "../core/profiles.js";
import type { PiboSessionTraceView } from "../shared/trace-types.js";

export type CliSourceCapability = "supported" | "unsupported" | "unknown";

export type CliRoomSummary = {
	id: string;
	title: string;
	description?: string;
};

export type CliSessionSummary = {
	id: string;
	title: string;
	roomId?: string;
	profile: string;
	agentId?: string;
	ownerScope?: string;
	workspace?: string;
	status: "idle" | "running" | "error" | "unknown";
	model?: ModelProfile;
	createdAt?: string;
	updatedAt?: string;
};

export type CliAgentSummary = {
	id: string;
	name: string;
	description?: string;
	profileName?: string;
};

export type CliRuntimeStatus = {
	source: string;
	mode: "fake" | "local" | "gateway" | "unknown";
	connected: boolean;
	rooms: CliSourceCapability;
	sessions: CliSourceCapability;
	agents: CliSourceCapability;
	activeRoomId?: string;
	activeSessionId?: string;
	activeAgentId?: string;
	activeModel?: ModelProfile;
	message?: string;
	updatedAt: string;
};

export type CreateCliSessionInput = {
	roomId?: string;
	title?: string;
	agentId?: string;
	profile?: string;
	ownerScope?: string;
	workspace?: string;
};

export type CliSessionUpdate = {
	type: "session" | "trace" | "status" | "error";
	session?: CliSessionSummary;
	traceView?: PiboSessionTraceView | null;
	status?: CliRuntimeStatus;
	error?: CliSourceError;
};

export type CliSessionUpdateListener = (update: CliSessionUpdate) => void;

export type CliOpenSession = {
	session: CliSessionSummary;
	traceView: PiboSessionTraceView | null;
	status: CliRuntimeStatus;
	subscribe(listener: CliSessionUpdateListener): () => void;
	close(): Promise<void> | void;
};

export interface CliSessionSource {
	listRooms(): Promise<readonly CliRoomSummary[]>;
	listSessions(input?: { roomId?: string }): Promise<readonly CliSessionSummary[]>;
	createSession(input?: CreateCliSessionInput): Promise<CliSessionSummary>;
	openSession(sessionId: string): Promise<CliOpenSession>;
	sendMessage(sessionId: string, text: string): Promise<void>;
	listAgents(): Promise<readonly CliAgentSummary[]>;
	setSessionAgent(sessionId: string, agentId: string): Promise<CliSessionSummary>;
	getStatus(input?: { sessionId?: string }): Promise<CliRuntimeStatus>;
	close(): Promise<void> | void;
}

export class CliSourceError extends Error {
	readonly code: string;
	override readonly cause?: unknown;

	constructor(code: string, message: string, options: { cause?: unknown } = {}) {
		super(message);
		this.name = "CliSourceError";
		this.code = code;
		this.cause = options.cause;
	}
}

export function isCliSourceError(error: unknown): error is CliSourceError {
	return error instanceof CliSourceError;
}
