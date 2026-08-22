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
	const openAppResources = new Set();
	process.env.PIBO_HOME = home;
	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local" });
		apps.push(...registry.getWebApps());
		for (const app of apps) {
			if (app.dispose) openAppResources.add(app.name);
		}

		assert.ok(apps.some((app) => app.name === "web-annotations"), "expected the competing auxiliary web app");
		assert.ok(openAppResources.size > 0, "expected registered web apps with disposable resources");
		assert.equal(apps[0].name, "pibo.chat-web");
		assert.equal(apps[0].mountPath, "/apps/chat");
	} finally {
		try {
			for (const app of apps) {
				await app.dispose?.();
				openAppResources.delete(app.name);
			}
			assert.equal(openAppResources.size, 0, "expected all registered web app resources to be disposed");
			await rm(home, { recursive: true });
			await assert.rejects(() => stat(home), { code: "ENOENT" });
		} finally {
			if (previousHome === undefined) delete process.env.PIBO_HOME;
			else process.env.PIBO_HOME = previousHome;
		}
	}
});
