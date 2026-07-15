import { useMemo } from "react";
import { resolveSessionActivity, type SessionActivity } from "../../../../session-ui/sessionActivity.js";
import type { PiboSessionSignalSnapshot, PiboWebSessionStatus } from "../types";

export function useSessionActivity({
	signal,
	fallbackStatus,
	fallbackTurnStartedAt,
}: {
	signal?: PiboSessionSignalSnapshot;
	fallbackStatus?: PiboWebSessionStatus;
	fallbackTurnStartedAt?: string;
}): SessionActivity {
	return useMemo(
		() => resolveSessionActivity(signal, { status: fallbackStatus, turnStartedAt: fallbackTurnStartedAt }),
		[fallbackStatus, fallbackTurnStartedAt, signal],
	);
}
