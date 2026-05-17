import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type BrowserPoolLifecycleState = "empty" | "ready" | "leased" | "stale" | "dirty";

export type BrowserPoolMutationKind = "acquire" | "release" | "reap";

export interface BrowserPoolState {
	workerId: string;
	poolId: string;
	maxBrowserProcesses: number;
	pid?: number;
	processGroupId?: number;
	cdpPort?: number;
	cdpUrl?: string;
	userDataDir?: string;
	activeLeaseId?: string;
	owner?: string;
	lastUsedAt?: string;
	idleExpiresAt?: string;
	state: BrowserPoolLifecycleState;
	lastError?: string;
}

export interface BrowserPoolIdentity {
	workerId: string;
	poolId: string;
	maxBrowserProcesses?: number;
}

export interface BrowserPoolPaths {
	statePath: string;
	lockPath: string;
}

export interface BrowserPoolLockOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	staleMs?: number;
	owner?: string;
}

export interface BrowserPoolStateLoadOptions extends BrowserPoolIdentity {
	onMissing?: "empty" | "throw";
	onMalformed?: "empty" | "throw";
}

export interface BrowserPoolCdpHealthResult {
	ok: boolean;
	reason?: string;
	browser?: string;
}

export interface BrowserPoolCdpHealthOptions {
	timeoutMs?: number;
}

export interface BrowserPoolStartedBrowser {
	pid: number;
	processGroupId?: number;
	cdpPort: number;
	cdpUrl: string;
	userDataDir: string;
}

export interface BrowserPoolAcquireOptions {
	owner?: string;
	leaseId?: string;
	idleTimeoutMs?: number;
	cdpTimeoutMs?: number;
	lockOptions?: BrowserPoolLockOptions;
	now?: () => Date;
	isPidAlive?: (pid: number) => boolean | Promise<boolean>;
	checkCdpHealth?: (cdpUrl: string, options: BrowserPoolCdpHealthOptions) => Promise<BrowserPoolCdpHealthResult>;
	startBrowser?: (state: BrowserPoolState) => Promise<BrowserPoolStartedBrowser>;
}

export type BrowserPoolAcquireResult =
	| {
		acquired: true;
		leaseId: string;
		cdpUrl: string;
		pid: number;
		reused: boolean;
		replaced: boolean;
		staleReason?: string;
		state: BrowserPoolState;
	}
	| {
		acquired: false;
		state: BrowserPoolState;
		staleReason: string;
	};

const DEFAULT_MAX_BROWSER_PROCESSES = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 50;
const DEFAULT_LOCK_STALE_MS = 10 * 60_000;
const DEFAULT_CDP_HEALTH_TIMEOUT_MS = 2_500;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;

export class BrowserPoolLockTimeoutError extends Error {
	constructor(lockPath: string, timeoutMs: number) {
		super(`Timed out acquiring browser pool lock ${lockPath} after ${timeoutMs}ms`);
		this.name = "BrowserPoolLockTimeoutError";
	}
}

export class BrowserPoolStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BrowserPoolStateError";
	}
}

export function createEmptyBrowserPoolState(identity: BrowserPoolIdentity): BrowserPoolState {
	return {
		workerId: identity.workerId,
		poolId: identity.poolId,
		maxBrowserProcesses: identity.maxBrowserProcesses ?? DEFAULT_MAX_BROWSER_PROCESSES,
		state: "empty",
	};
}

export function browserPoolPaths(rootDir: string, identity: BrowserPoolIdentity): BrowserPoolPaths {
	const safeWorkerId = safePathSegment(identity.workerId);
	const safePoolId = safePathSegment(identity.poolId);
	const base = join(rootDir, "browser-pools", safeWorkerId, safePoolId);
	return {
		statePath: join(base, "state.json"),
		lockPath: join(base, "state.lock"),
	};
}

export async function loadBrowserPoolState(statePath: string, options: BrowserPoolStateLoadOptions): Promise<BrowserPoolState> {
	let raw: string;
	try {
		raw = await readFile(statePath, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT" && (options.onMissing ?? "empty") === "empty") {
			return createEmptyBrowserPoolState(options);
		}
		throw error;
	}

	try {
		return normalizeBrowserPoolState(JSON.parse(raw), options);
	} catch (error) {
		const stateError = toBrowserPoolStateError(error);
		if ((options.onMalformed ?? "throw") === "empty") {
			return {
				...createEmptyBrowserPoolState(options),
				state: "dirty",
				lastError: stateError.message,
			};
		}
		throw stateError;
	}
}

export async function saveBrowserPoolState(statePath: string, state: BrowserPoolState): Promise<void> {
	const normalized = normalizeBrowserPoolState(state, state);
	await mkdir(dirname(statePath), { recursive: true });
	const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	await rename(temporaryPath, statePath);
}

export async function withBrowserPoolLock<T>(lockPath: string, options: BrowserPoolLockOptions, run: () => Promise<T>): Promise<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
	const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
	const owner = options.owner ?? `${process.pid}`;
	const startedAt = Date.now();

	while (true) {
		try {
			await mkdir(dirname(lockPath), { recursive: true });
			const handle = await open(lockPath, "wx");
			try {
				await handle.writeFile(JSON.stringify({ owner, pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
			} finally {
				await handle.close();
			}
			break;
		} catch (error) {
			if (!isNodeError(error) || error.code !== "EEXIST") throw error;
			await removeStaleLock(lockPath, staleMs);
			if (Date.now() - startedAt >= timeoutMs) throw new BrowserPoolLockTimeoutError(lockPath, timeoutMs);
			await delay(Math.min(pollIntervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
		}
	}

	try {
		return await run();
	} finally {
		await rm(lockPath, { force: true });
	}
}

export async function mutateBrowserPoolState<T>(
	paths: BrowserPoolPaths,
	identity: BrowserPoolStateLoadOptions,
	kind: BrowserPoolMutationKind,
	mutation: (state: BrowserPoolState) => Promise<{ state: BrowserPoolState; result: T }>,
	lockOptions: BrowserPoolLockOptions = {},
): Promise<T> {
	return withBrowserPoolLock(paths.lockPath, { ...lockOptions, owner: lockOptions.owner ?? kind }, async () => {
		const current = await loadBrowserPoolState(paths.statePath, identity);
		const next = await mutation(current);
		await saveBrowserPoolState(paths.statePath, next.state);
		return next.result;
	});
}

export async function checkBrowserPoolCdpHealth(cdpUrl: string, options: BrowserPoolCdpHealthOptions = {}): Promise<BrowserPoolCdpHealthResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_CDP_HEALTH_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${trimTrailingSlash(cdpUrl)}/json/version`, { signal: controller.signal });
		if (!response.ok) return { ok: false, reason: `CDP /json/version returned HTTP ${response.status}` };
		const payload = await response.json() as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "CDP /json/version returned malformed JSON" };
		const browser = (payload as Record<string, unknown>).Browser;
		if (typeof browser !== "string" || browser.length === 0) return { ok: false, reason: "CDP /json/version response is missing Browser" };
		return { ok: true, browser };
	} catch (error) {
		return { ok: false, reason: `CDP health check failed: ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		clearTimeout(timer);
	}
}

export async function acquireBrowserPoolLease(
	paths: BrowserPoolPaths,
	identity: BrowserPoolIdentity,
	options: BrowserPoolAcquireOptions = {},
): Promise<BrowserPoolAcquireResult> {
	const leaseId = options.leaseId ?? randomUUID();
	const now = options.now ?? (() => new Date());
	const checkCdpHealth = options.checkCdpHealth ?? checkBrowserPoolCdpHealth;
	const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
	const cdpTimeoutMs = options.cdpTimeoutMs ?? DEFAULT_CDP_HEALTH_TIMEOUT_MS;
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

	return mutateBrowserPoolState<BrowserPoolAcquireResult>(paths, { ...identity, onMalformed: "empty" }, "acquire", async (current) => {
		const checkedAt = now();
		const lastUsedAt = checkedAt.toISOString();
		const idleExpiresAt = new Date(checkedAt.getTime() + idleTimeoutMs).toISOString();

		const reusable = await evaluateRecordedBrowser(current, isPidAlive, checkCdpHealth, cdpTimeoutMs);
		if (reusable.ok) {
			const busyReason = activeLeaseBusyReason(current, leaseId, checkedAt);
			if (busyReason) {
				const busyState = stripUndefined({ ...current, lastUsedAt, lastError: busyReason });
				return { state: busyState, result: { acquired: false, state: busyState, staleReason: busyReason } };
			}
			const nextState = stripUndefined({
				...current,
				state: "leased" as const,
				activeLeaseId: leaseId,
				owner: options.owner,
				lastUsedAt,
				idleExpiresAt,
				lastError: undefined,
			});
			return {
				state: nextState,
				result: { acquired: true, leaseId, cdpUrl: current.cdpUrl!, pid: current.pid!, reused: true, replaced: false, state: nextState },
			};
		}

		const staleState = stripUndefined({
			...current,
			state: current.state === "dirty" ? "dirty" as const : "stale" as const,
			activeLeaseId: undefined,
			owner: undefined,
			lastUsedAt,
			idleExpiresAt: undefined,
			lastError: reusable.reason,
		});

		if (!options.startBrowser) {
			return { state: staleState, result: { acquired: false, state: staleState, staleReason: reusable.reason } };
		}

		try {
			const started = await options.startBrowser(staleState);
			const nextState = stripUndefined({
				workerId: current.workerId,
				poolId: current.poolId,
				maxBrowserProcesses: current.maxBrowserProcesses,
				pid: started.pid,
				processGroupId: started.processGroupId,
				cdpPort: started.cdpPort,
				cdpUrl: started.cdpUrl,
				userDataDir: started.userDataDir,
				activeLeaseId: leaseId,
				owner: options.owner,
				lastUsedAt,
				idleExpiresAt,
				state: "leased" as const,
			});
			return {
				state: nextState,
				result: { acquired: true, leaseId, cdpUrl: started.cdpUrl, pid: started.pid, reused: false, replaced: current.state !== "empty", staleReason: reusable.reason, state: nextState },
			};
		} catch (error) {
			const dirtyState = stripUndefined({ ...staleState, state: "dirty" as const, lastError: `Browser replacement failed: ${error instanceof Error ? error.message : String(error)}` });
			return { state: dirtyState, result: { acquired: false, state: dirtyState, staleReason: dirtyState.lastError! } };
		}
	}, options.lockOptions);
}

export function normalizeBrowserPoolState(value: unknown, identity: BrowserPoolIdentity): BrowserPoolState {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new BrowserPoolStateError("Browser pool state must be a JSON object");
	const record = value as Record<string, unknown>;
	const workerId = readRequiredString(record, "workerId");
	const poolId = readRequiredString(record, "poolId");
	if (workerId !== identity.workerId) throw new BrowserPoolStateError(`Browser pool state worker id mismatch: expected ${identity.workerId}, got ${workerId}`);
	if (poolId !== identity.poolId) throw new BrowserPoolStateError(`Browser pool state pool id mismatch: expected ${identity.poolId}, got ${poolId}`);
	const state = readLifecycleState(record.state);
	const maxBrowserProcesses = readPositiveInteger(record.maxBrowserProcesses, "maxBrowserProcesses");
	return stripUndefined({
		workerId,
		poolId,
		maxBrowserProcesses,
		pid: readOptionalPositiveInteger(record.pid, "pid"),
		processGroupId: readOptionalPositiveInteger(record.processGroupId, "processGroupId"),
		cdpPort: readOptionalPositiveInteger(record.cdpPort, "cdpPort"),
		cdpUrl: readOptionalString(record.cdpUrl, "cdpUrl"),
		userDataDir: readOptionalString(record.userDataDir, "userDataDir"),
		activeLeaseId: readOptionalString(record.activeLeaseId, "activeLeaseId"),
		owner: readOptionalString(record.owner, "owner"),
		lastUsedAt: readOptionalString(record.lastUsedAt, "lastUsedAt"),
		idleExpiresAt: readOptionalString(record.idleExpiresAt, "idleExpiresAt"),
		state,
		lastError: readOptionalString(record.lastError, "lastError"),
	});
}

function activeLeaseBusyReason(state: BrowserPoolState, requestedLeaseId: string, now: Date): string | undefined {
	if (state.state !== "leased" || !state.activeLeaseId || state.activeLeaseId === requestedLeaseId) return undefined;
	if (leaseExpired(state.idleExpiresAt, now)) return undefined;
	const owner = state.owner ? ` owned by ${state.owner}` : "";
	const until = state.idleExpiresAt ? ` until ${state.idleExpiresAt}` : "";
	return `pool-exhausted: browser pool ${state.poolId} is already leased by ${state.activeLeaseId}${owner}${until}`;
}

function leaseExpired(idleExpiresAt: string | undefined, now: Date): boolean {
	if (!idleExpiresAt) return false;
	const expiresAt = Date.parse(idleExpiresAt);
	if (Number.isNaN(expiresAt)) return false;
	return expiresAt <= now.getTime();
}

async function evaluateRecordedBrowser(
	state: BrowserPoolState,
	isPidAlive: (pid: number) => boolean | Promise<boolean>,
	checkCdpHealth: (cdpUrl: string, options: BrowserPoolCdpHealthOptions) => Promise<BrowserPoolCdpHealthResult>,
	cdpTimeoutMs: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (state.state === "dirty") return { ok: false, reason: state.lastError ?? "Browser pool state is dirty" };
	if (!state.pid) return { ok: false, reason: "Browser pool has no recorded pid" };
	if (!state.cdpUrl) return { ok: false, reason: "Browser pool has no recorded CDP URL" };
	if (!(await isPidAlive(state.pid))) return { ok: false, reason: `Recorded browser pid ${state.pid} is not alive` };
	const health = await checkCdpHealth(state.cdpUrl, { timeoutMs: cdpTimeoutMs });
	if (!health.ok) return { ok: false, reason: health.reason ?? "Recorded browser CDP endpoint is unhealthy" };
	return { ok: true };
}

function defaultIsPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isNodeError(error) && error.code === "EPERM";
	}
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<void> {
	if (staleMs <= 0) return;
	try {
		const raw = await readFile(lockPath, "utf8");
		const parsed = JSON.parse(raw) as { createdAt?: unknown };
		if (typeof parsed.createdAt !== "string") return;
		const createdAt = Date.parse(parsed.createdAt);
		if (Number.isNaN(createdAt)) return;
		if (Date.now() - createdAt > staleMs) await rm(lockPath, { force: true });
	} catch {
		// A corrupt or concurrently removed lock should not make acquisition unsafe.
	}
}

function safePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new BrowserPoolStateError(`Browser pool state field ${key} must be a non-empty string`);
	return value;
}

function readOptionalString(value: unknown, key: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) throw new BrowserPoolStateError(`Browser pool state field ${key} must be a non-empty string when present`);
	return value;
}

function readPositiveInteger(value: unknown, key: string): number {
	if (!Number.isInteger(value) || typeof value !== "number" || value < 1) throw new BrowserPoolStateError(`Browser pool state field ${key} must be a positive integer`);
	return value;
}

function readOptionalPositiveInteger(value: unknown, key: string): number | undefined {
	if (value === undefined) return undefined;
	return readPositiveInteger(value, key);
}

function readLifecycleState(value: unknown): BrowserPoolLifecycleState {
	if (value === "empty" || value === "ready" || value === "leased" || value === "stale" || value === "dirty") return value;
	throw new BrowserPoolStateError("Browser pool state field state is invalid");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function toBrowserPoolStateError(error: unknown): BrowserPoolStateError {
	if (error instanceof BrowserPoolStateError) return error;
	return new BrowserPoolStateError(error instanceof Error ? error.message : String(error));
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
