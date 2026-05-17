import type { PiboJsonObject } from '../core/events.js';

export type PiboRalphTarget =
	| { kind: 'room'; roomId: string }
	| { kind: 'personal'; principalId: string };

export type PiboRalphJobState = {
	runningAt?: string;
	lastRunAt?: string;
	lastStatus?: 'ok' | 'error' | 'cancelled';
	lastError?: string;
	lastRunId?: string;
	lastPiboSessionId?: string;
	consecutiveErrors?: number;
	stopRequestedAt?: string;
	cancelRequestedAt?: string;
	completedIterations?: number;
};

export type PiboRalphJob = {
	id: string;
	ownerScope: string;
	name: string;
	description?: string;
	enabled: boolean;
	target: PiboRalphTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	storyStopPaths?: string[];
	state: PiboRalphJobState;
	createdAt: string;
	updatedAt: string;
};

export type PiboRalphRunStatus = 'running' | 'ok' | 'error' | 'cancelled';

export type PiboRalphRun = {
	id: string;
	jobId: string;
	ownerScope: string;
	piboSessionId?: string;
	status: PiboRalphRunStatus;
	reason?: string;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type PiboRalphJobCreateInput = {
	ownerScope: string;
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboRalphTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	storyStopPaths?: string[];
};

export type PiboRalphJobPatchInput = Partial<Pick<PiboRalphJobCreateInput, 'name' | 'description' | 'enabled' | 'target' | 'profile' | 'prompt' | 'maxIterations' | 'storyStopPaths'>>;

export type PiboRalphStatus = {
	enabled: boolean;
	jobs: number;
	running: number;
};

export type PiboRalphResolvedTarget = {
	roomId: string;
	workspace?: string;
	metadata?: PiboJsonObject;
};
