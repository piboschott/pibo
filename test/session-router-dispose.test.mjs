import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";

async function withPiboHome(root, action) {
	const previous = process.env.PIBO_HOME;
	process.env.PIBO_HOME = root;
	try {
		return await action();
	} finally {
		if (previous === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previous;
	}
}

test("session router attempts every finalizer, preserves causes, and retries only failed cleanup", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-session-router-dispose-"));
	const sessionFailure = new Error("injected routed session disposal failure");
	const runtimeFailure = new Error("injected runtime registry disposal failure");
	const authFailure = new Error("injected runtime auth disposal failure");
	const webAppFailure = new Error("injected web app disposal failure");
	const portableToolFailure = new Error("injected portable tool service disposal failure");
	const runtimeResourceFailure = new Error("injected runtime resource service disposal failure");
	const telemetryFailure = new Error("injected telemetry writer disposal failure");
	const calls = {
		session: 0,
		runtime: 0,
		auth: 0,
		failingWebApp: 0,
		successfulWebApp: 0,
		portableTool: 0,
		runtimeResource: 0,
		telemetry: 0,
	};
	let fail = true;
	let router;

	try {
		await withPiboHome(root, async () => {
			router = new PiboSessionRouter({ persistSession: false, routedSessionDisposeTimeoutMs: 100 });
			router.sessions.set("ps_dispose_fault", {
				dispose() {
					calls.session += 1;
					if (fail) throw sessionFailure;
				},
				forceDispose() {},
			});
			router.runtimeRegistry.closeAll = async () => {
				calls.runtime += 1;
				if (fail) throw runtimeFailure;
			};
			router.pluginRegistry.disposeAgentRuntimeAuth = () => {
				calls.auth += 1;
				if (fail) throw authFailure;
				return Promise.resolve();
			};
			router.pluginRegistry.registerWebApp({
				name: "test.router-failing-web-app",
				mountPath: "/apps/router-failing",
				apiPrefix: "/api/router-failing",
				async dispose() {
					calls.failingWebApp += 1;
					if (fail) throw webAppFailure;
				},
				handleRequest() {
					return new Response("failing");
				},
			});
			router.pluginRegistry.registerWebApp({
				name: "test.router-successful-web-app",
				mountPath: "/apps/router-successful",
				apiPrefix: "/api/router-successful",
				dispose() {
					calls.successfulWebApp += 1;
				},
				handleRequest() {
					return new Response("successful");
				},
			});
			router.portableToolService = {
				dispose() {
					calls.portableTool += 1;
					if (fail) throw portableToolFailure;
				},
			};
			router.runtimeResourceService = {
				async dispose() {
					calls.runtimeResource += 1;
					if (fail) throw runtimeResourceFailure;
				},
			};
			router.telemetryWriter = {
				dispose() {
					calls.telemetry += 1;
					if (fail) throw telemetryFailure;
				},
			};

			await assert.rejects(
				() => router.disposeAll(),
				(error) => {
					assert.ok(error instanceof AggregateError);
					for (const cause of [
						sessionFailure,
						runtimeFailure,
						authFailure,
						webAppFailure,
						portableToolFailure,
						runtimeResourceFailure,
						telemetryFailure,
					]) {
						assert.ok(error.errors.includes(cause), `missing original cause: ${cause.message}`);
					}
					return true;
				},
			);
			assert.deepEqual(calls, {
				session: 1,
				runtime: 1,
				auth: 1,
				failingWebApp: 1,
				successfulWebApp: 1,
				portableTool: 1,
				runtimeResource: 1,
				telemetry: 1,
			});

			fail = false;
			await router.disposeAll();
			assert.deepEqual(calls, {
				session: 2,
				runtime: 2,
				auth: 2,
				failingWebApp: 2,
				successfulWebApp: 1,
				portableTool: 2,
				runtimeResource: 2,
				telemetry: 2,
			});
			await router.disposeAll();
			assert.deepEqual(calls, {
				session: 2,
				runtime: 2,
				auth: 2,
				failingWebApp: 2,
				successfulWebApp: 1,
				portableTool: 2,
				runtimeResource: 2,
				telemetry: 2,
			});
			router = undefined;
		});

		await rm(root, { recursive: true });
		await assert.rejects(() => stat(root), { code: "ENOENT" });
	} finally {
		fail = false;
		await router?.disposeAll().catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	}
});
