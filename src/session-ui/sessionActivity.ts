export type SessionActivityStatus = "idle" | "running" | "error";
export type SessionTurnState = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type SessionTurnActivity = {
	nodeId: string;
	eventId: string;
	state: SessionTurnState;
	startedAt: string;
	updatedAt: string;
	completedAt?: string;
};

export type SessionActivitySignal = {
	isTreeActive: boolean;
	hasError: boolean;
	hasErrorDescendant: boolean;
	aggregateStatus: string;
	latestTurn?: SessionTurnActivity;
};

export type SessionActivityFallback = {
	status?: SessionActivityStatus;
	turnStartedAt?: string;
};

export type SessionActivity = {
	status: SessionActivityStatus;
	isTreeActive: boolean;
	isTurnActive: boolean;
	activeTurnId?: string;
	activeTurnStartedAt?: string;
	latestTurn?: SessionTurnActivity;
	source: "signals" | "fallback";
};

export function resolveSessionActivity(
	signal: SessionActivitySignal | undefined,
	fallback: SessionActivityFallback = {},
): SessionActivity {
	if (!signal) return fallbackSessionActivity(fallback);
	const latestTurn = signal.latestTurn;
	const isTurnActive = latestTurn?.state === "running";
	const isTreeActive = signal.isTreeActive || isTurnActive;
	const hasError = signal.hasError || signal.hasErrorDescendant || signal.aggregateStatus === "error";
	return {
		status: hasError ? "error" : isTreeActive ? "running" : "idle",
		isTreeActive,
		isTurnActive,
		activeTurnId: isTurnActive ? latestTurn.eventId : undefined,
		activeTurnStartedAt: isTurnActive ? latestTurn.startedAt : undefined,
		latestTurn,
		source: "signals",
	};
}

function fallbackSessionActivity(fallback: SessionActivityFallback): SessionActivity {
	const isTurnActive = fallback.status === "running" && validTimestamp(fallback.turnStartedAt);
	return {
		status: fallback.status ?? "idle",
		isTreeActive: fallback.status === "running",
		isTurnActive,
		activeTurnStartedAt: isTurnActive ? fallback.turnStartedAt : undefined,
		source: "fallback",
	};
}

function validTimestamp(value: string | undefined): value is string {
	return Boolean(value && Number.isFinite(Date.parse(value)));
}
