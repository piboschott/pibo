import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { handleChatRalphApiRequest } from "../dist/apps/chat/ralph-api.js";
import { PiboRalphStore } from "../dist/ralph/store.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function createApiOptions({ request, store, ownerScope = "user:a" }) {
	return {
		request,
		ralphStore: store,
		webSession: { ownerScope },
		defaultProfile: "codex",
		context: { channelContext: { getProfiles: () => [{ name: "codex", aliases: [] }] } },
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoomAccess: () => { throw new Error("unused"); },
			ensureDefaultRoom: () => ({ id: "room", ownerScope, name: "room", members: [] }),
			ensureMember: () => ({ roomId: "room", principalId: ownerScope, role: "owner" }),
		},
	};
}

async function responseJson(response) {
	assert.ok(response);
	return response.json();
}

test("Ralph CLI text and JSON expose concise retained and dirty resource state", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-resource-visibility-"));
	const dbPath = join(dir, "ralph.sqlite");
	const store = new PiboRalphStore({ path: dbPath });
	try {
		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const retained = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "retained work",
			enabled: false,
			resources: { workerId: "worker-retained", cleanupState: "retained", retainedUntil },
		});
		const dirty = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "dirty work",
			enabled: true,
			resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "active" },
		});
		const reserved = store.reserveRun("user:a", dirty.id);
		store.updateRunResources({ ownerScope: "user:a", runId: reserved.run.id, resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "dirty", dirtyReason: "CDP cleanup failed after release" } });
		store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "legacy no resource", enabled: false });
		store.createJob({ ownerScope: "user:b", target: { kind: "personal", principalId: "user:b" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });
	} finally { store.close(); }

	try {
		const env = { ...process.env, PIBO_OWNER_SCOPE: "user:a" };
		const list = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "--owner-scope", "user:a", "list", "--all"], { env });
		assert.match(list.stdout, /worker=worker-retained/);
		assert.match(list.stdout, /state=retained/);
		assert.match(list.stdout, /retainedUntil=2026-05-18T00:00:00\.000Z/);
		assert.match(list.stdout, /next=pibo compute reap --dry-run --include-dev/);
		assert.match(list.stdout, /resources=-\tlegacy no resource/);
		assert.doesNotMatch(list.stdout, /worker-other/);

		const runs = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "--owner-scope", "user:a", "runs"], { env });
		assert.match(runs.stdout, /worker=worker-dirty/);
		assert.match(runs.stdout, /state=dirty/);
		assert.match(runs.stdout, /dirty=CDP cleanup failed after release/);
		assert.match(runs.stdout, /next=pibo tools browser-use pool reap --worker-id worker-dirty --json/);

		const json = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "--owner-scope", "user:a", "list", "--all", "--json"], { env });
		const jobs = JSON.parse(json.stdout);
		assert.equal(jobs.some((job) => job.resources?.cleanupState === "retained" && job.resources.workerId === "worker-retained"), true);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("Chat Ralph API returns resource metadata only through owner-scoped endpoints", async () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "api work",
			enabled: false,
			resources: { workerId: "worker-api", cleanupState: "dirty", dirtyReason: "manual cleanup required" },
		});
		store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "api legacy", enabled: false });
		store.createJob({ ownerScope: "user:b", target: { kind: "personal", principalId: "user:b" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });

		const listResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store, ownerScope: "user:a" }));
		const listPayload = await responseJson(listResponse);
		assert.equal(listPayload.jobs.length, 2);
		assert.equal(listPayload.jobs.some((item) => item.resources === undefined), true);
		assert.equal(listPayload.jobs.some((item) => item.resources?.workerId === "worker-api" && item.resources.cleanupState === "dirty"), true);

		const getResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store, ownerScope: "user:a" }));
		const getPayload = await responseJson(getResponse);
		assert.equal(getPayload.job.resources.workerId, "worker-api");

		const crossOwnerList = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store, ownerScope: "user:b" }));
		const crossOwnerPayload = await responseJson(crossOwnerList);
		assert.deepEqual(crossOwnerPayload.jobs.map((item) => item.resources?.workerId), ["worker-other"]);
		await assert.rejects(
			handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store, ownerScope: "user:b" })),
			(error) => error?.statusCode === 404,
		);
	} finally { store.close(); }
});
