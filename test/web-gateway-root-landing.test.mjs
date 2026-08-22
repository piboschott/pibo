import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";

test("web gateway registers the chat web app first so the root URL lands on sessions", async () => {
	const home = await mkdtemp(join(tmpdir(), "pibo-root-landing-"));
	const previousHome = process.env.PIBO_HOME;
	const apps = [];
	const pendingAppDisposals = new Set();
	process.env.PIBO_HOME = home;
	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local" });
		apps.push(...registry.getWebApps());
		for (const app of apps) {
			if (app.dispose) pendingAppDisposals.add(app.name);
		}

		assert.ok(apps.some((app) => app.name === "web-annotations"), "expected the competing auxiliary web app");
		assert.ok(pendingAppDisposals.size > 0, "expected registered web apps with disposable resources");
		assert.equal(apps[0].name, "pibo.chat-web");
		assert.equal(apps[0].mountPath, "/apps/chat");
	} finally {
		try {
			const failures = [];
			const disposalResults = await Promise.allSettled(apps.map(async (app) => {
				if (!app.dispose) return;
				try {
					await app.dispose();
				} finally {
					pendingAppDisposals.delete(app.name);
				}
			}));
			failures.push(...disposalResults.flatMap((result) => result.status === "rejected" ? [result.reason] : []));
			try {
				assert.equal(pendingAppDisposals.size, 0, "expected every registered web app disposer to be attempted");
			} catch (error) {
				failures.push(error);
			}
			try {
				await rm(home, { recursive: true });
				await assert.rejects(() => stat(home), { code: "ENOENT" });
			} catch (error) {
				failures.push(error);
			}
			if (failures.length > 0) throw new AggregateError(failures, "Failed to clean up registered web apps");
		} finally {
			if (previousHome === undefined) delete process.env.PIBO_HOME;
			else process.env.PIBO_HOME = previousHome;
		}
	}
});
