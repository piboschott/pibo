import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	BrowserPoolLockTimeoutError,
	BrowserPoolStateError,
	acquireBrowserPoolLease,
	browserPoolPaths,
	checkBrowserPoolCdpHealth,
	createEmptyBrowserPoolState,
	loadBrowserPoolState,
	mutateBrowserPoolState,
	saveBrowserPoolState,
	withBrowserPoolLock,
} from "../dist/tools/browser-pool.js";

async function withTempDir(run) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-browser-pool-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const identity = { workerId: "worker-a", poolId: "default", maxBrowserProcesses: 1 };

test("browser pool state writes and reads a complete round trip", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		const state = {
			...createEmptyBrowserPoolState(identity),
			pid: 1234,
			processGroupId: 1234,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			activeLeaseId: "lease-1",
			owner: "user:test",
			lastUsedAt: "2026-05-17T00:00:00.000Z",
			idleExpiresAt: "2026-05-17T00:05:00.000Z",
			state: "leased",
		};

		await saveBrowserPoolState(paths.statePath, state);
		assert.deepEqual(await loadBrowserPoolState(paths.statePath, identity), state);
	});
});

test("browser pool state initializes an empty pool for missing state", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		assert.deepEqual(await loadBrowserPoolState(paths.statePath, identity), createEmptyBrowserPoolState(identity));
		await assert.rejects(
			loadBrowserPoolState(paths.statePath, { ...identity, onMissing: "throw" }),
			(error) => error && error.code === "ENOENT",
		);
	});
});

test("browser pool state fails safely or throws for malformed state by context", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await mkdir(join(dir, "browser-pools", identity.workerId, identity.poolId), { recursive: true });
		await writeFile(paths.statePath, "{not-json", "utf8");

		await assert.rejects(loadBrowserPoolState(paths.statePath, identity), BrowserPoolStateError);
		const dirty = await loadBrowserPoolState(paths.statePath, { ...identity, onMalformed: "empty" });
		assert.equal(dirty.state, "dirty");
		assert.match(dirty.lastError, /JSON|Expected|property name/i);
	});
});

test("browser pool lock serializes a successful mutation", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		const result = await mutateBrowserPoolState(paths, identity, "acquire", async (state) => ({
			state: { ...state, state: "ready", pid: 42, cdpPort: 4831, cdpUrl: "http://127.0.0.1:4831" },
			result: "ok",
		}), { timeoutMs: 200 });

		assert.equal(result, "ok");
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "ready");
		assert.equal(saved.pid, 42);
		await assert.rejects(readFile(paths.lockPath, "utf8"), (error) => error && error.code === "ENOENT");
	});
});

test("browser pool lock times out when another mutation holds it", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		const releaseHeldLock = withBrowserPoolLock(paths.lockPath, { timeoutMs: 200, owner: "holder" }, async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});

		await assert.rejects(
			withBrowserPoolLock(paths.lockPath, { timeoutMs: 25, pollIntervalMs: 5, staleMs: 0, owner: "waiter" }, async () => undefined),
			BrowserPoolLockTimeoutError,
		);
		await releaseHeldLock;
	});
});

test("browser pool lock supports release and reap mutation kinds", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await mutateBrowserPoolState(paths, identity, "release", async (state) => ({ state: { ...state, state: "empty" }, result: undefined }));
		await mutateBrowserPoolState(paths, identity, "reap", async (state) => ({ state: { ...state, state: "dirty", lastError: "manual reap failed" }, result: undefined }));
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "dirty");
		assert.equal(saved.lastError, "manual reap failed");
	});
});

test("browser pool CDP health accepts /json/version and rejects malformed responses", async () => {
	const server = createServer((request, response) => {
		if (request.url === "/healthy/json/version") {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ Browser: "Chrome/124.0.0.0" }));
			return;
		}
		if (request.url === "/malformed/json/version") {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ ProtocolVersion: "1.3" }));
			return;
		}
		response.statusCode = 404;
		response.end("not found");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		assert.equal(typeof address, "object");
		const base = `http://127.0.0.1:${address.port}`;
		assert.deepEqual(await checkBrowserPoolCdpHealth(`${base}/healthy`, { timeoutMs: 200 }), { ok: true, browser: "Chrome/124.0.0.0" });
		const malformed = await checkBrowserPoolCdpHealth(`${base}/malformed`, { timeoutMs: 200 });
		assert.equal(malformed.ok, false);
		assert.match(malformed.reason, /missing Browser/i);
	} finally {
		await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
});

test("browser pool acquire reuses a healthy recorded CDP browser", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			state: "ready",
		});

		const result = await acquireBrowserPoolLease(paths, identity, {
			leaseId: "lease-reuse",
			owner: "user:test",
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/124.0.0.0" }),
			startBrowser: async () => { throw new Error("must not start replacement"); },
		});

		assert.equal(result.acquired, true);
		assert.equal(result.reused, true);
		assert.equal(result.cdpUrl, "http://127.0.0.1:4831");
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "leased");
		assert.equal(saved.activeLeaseId, "lease-reuse");
		assert.equal(saved.owner, "user:test");
	});
});

test("browser pool acquire marks a dead recorded pid stale when replacement is unavailable", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			state: "ready",
		});

		const result = await acquireBrowserPoolLease(paths, identity, {
			isPidAlive: () => false,
			checkCdpHealth: async () => { throw new Error("must not check dead pid CDP"); },
		});

		assert.equal(result.acquired, false);
		assert.match(result.staleReason, /pid 4321 is not alive/);
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "stale");
		assert.equal(saved.activeLeaseId, undefined);
		assert.match(saved.lastError, /pid 4321 is not alive/);
	});
});

test("browser pool acquire marks unreachable CDP stale when replacement is unavailable", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			state: "ready",
		});

		const result = await acquireBrowserPoolLease(paths, identity, {
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: false, reason: "connection refused" }),
		});

		assert.equal(result.acquired, false);
		assert.equal(result.staleReason, "connection refused");
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "stale");
		assert.equal(saved.lastError, "connection refused");
	});
});

test("browser pool acquire starts at most one replacement under lock for one-lane pools", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 1111,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "old-profile"),
			state: "ready",
		});
		let startCount = 0;

		const makeAcquire = (leaseId) => acquireBrowserPoolLease(paths, identity, {
			leaseId,
			lockOptions: { timeoutMs: 1_000, pollIntervalMs: 5 },
			isPidAlive: (pid) => pid === 2222,
			checkCdpHealth: async (cdpUrl) => cdpUrl === "http://127.0.0.1:4832" ? { ok: true, browser: "Chrome/124.0.0.0" } : { ok: false, reason: "old CDP down" },
			startBrowser: async () => {
				startCount += 1;
				await new Promise((resolve) => setTimeout(resolve, 50));
				return { pid: 2222, processGroupId: 2222, cdpPort: 4832, cdpUrl: "http://127.0.0.1:4832", userDataDir: join(dir, "new-profile") };
			},
		});

		const results = await Promise.all([makeAcquire("lease-a"), makeAcquire("lease-b")]);
		assert.equal(startCount, 1);
		assert.equal(results.filter((result) => result.acquired && result.replaced).length, 1);
		const exhausted = results.find((result) => !result.acquired);
		assert.ok(exhausted);
		assert.match(exhausted.staleReason, /pool-exhausted/);
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.pid, 2222);
		assert.equal(saved.cdpUrl, "http://127.0.0.1:4832");
		assert.equal(saved.state, "leased");
	});
});


test("browser pool acquire fails clearly when a one-lane pool is busy", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			activeLeaseId: "lease-a",
			owner: "owner-a",
			idleExpiresAt: "2026-05-17T00:10:00.000Z",
			state: "leased",
		});
		let startCount = 0;

		const result = await acquireBrowserPoolLease(paths, identity, {
			leaseId: "lease-b",
			now: () => new Date("2026-05-17T00:00:00.000Z"),
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/124.0.0.0" }),
			startBrowser: async () => {
				startCount += 1;
				throw new Error("must not start while busy");
			},
		});

		assert.equal(result.acquired, false);
		assert.match(result.staleReason, /pool-exhausted/);
		assert.match(result.staleReason, /lease-a/);
		assert.equal(startCount, 0);
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "leased");
		assert.equal(saved.activeLeaseId, "lease-a");
		assert.match(saved.lastError, /pool-exhausted/);
	});
});


test("browser pool acquire permits same-lease reuse and expired lease takeover", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(dir, "profile"),
			activeLeaseId: "lease-a",
			idleExpiresAt: "2026-05-17T00:01:00.000Z",
			state: "leased",
		});

		const sameLease = await acquireBrowserPoolLease(paths, identity, {
			leaseId: "lease-a",
			now: () => new Date("2026-05-17T00:00:00.000Z"),
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/124.0.0.0" }),
			startBrowser: async () => { throw new Error("must not start same lease"); },
		});
		assert.equal(sameLease.acquired, true);
		assert.equal(sameLease.reused, true);

		const takeover = await acquireBrowserPoolLease(paths, identity, {
			leaseId: "lease-b",
			now: () => new Date("2026-05-17T00:20:00.000Z"),
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/124.0.0.0" }),
			startBrowser: async () => { throw new Error("must not start expired healthy lease takeover"); },
		});
		assert.equal(takeover.acquired, true);
		assert.equal(takeover.reused, true);
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.activeLeaseId, "lease-b");
	});
});

test("browser pool acquire treats state identity mismatches as dirty invalid state", async () => {
	await withTempDir(async (dir) => {
		const paths = browserPoolPaths(dir, identity);
		await mkdir(join(dir, "browser-pools", identity.workerId, identity.poolId), { recursive: true });
		await writeFile(paths.statePath, JSON.stringify({
			workerId: "other-worker",
			poolId: identity.poolId,
			maxBrowserProcesses: 1,
			pid: 4321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			state: "ready",
		}), "utf8");

		const result = await acquireBrowserPoolLease(paths, identity, {
			isPidAlive: () => true,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/124.0.0.0" }),
		});

		assert.equal(result.acquired, false);
		assert.equal(result.state.state, "dirty");
		assert.match(result.staleReason, /worker id mismatch/i);
		const saved = await loadBrowserPoolState(paths.statePath, identity);
		assert.equal(saved.state, "dirty");
		assert.match(saved.lastError, /worker id mismatch/i);
	});
});
