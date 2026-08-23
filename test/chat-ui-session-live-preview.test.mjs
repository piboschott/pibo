import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("live preview panel keeps the iframe isolated and exposes trusted lifecycle controls", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { PreviewFullscreenTopBar, SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		globalThis.React = React;
		const external = {
			id: "pv-ui", piboSessionId: "ps_ui", label: "Website", targetHost: "127.0.0.1", targetPort: 5173,
			managementMode: "external", managed: false, createdAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-23T00:00:00.000Z",
			state: "active", health: "online", publicUrl: "https://pv-ui.preview.test/", openUrl: "/api/previews/pv-ui/open",
		};
		const noop = () => {};
		const props = { onSelect: noop, onReload: noop, onRefresh: noop, onStart: noop, onStop: noop, onRemove: noop };
		const panel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [external], selectedPreview: external, loading: false, reloadKey: 1, onEnterFullscreen: noop,
		}));
		assert.match(panel, /data-pibo-debug="session-live-preview"/);
		assert.match(panel, /data-pibo-debug="session-live-preview-frame"/);
		assert.match(panel, /sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock"/);
		assert.match(panel, /referrerPolicy="no-referrer"/);
		assert.match(panel, /aria-label="Enter Preview fullscreen"/);
		assert.match(panel, /aria-label="Remove live preview"/);
		assert.doesNotMatch(panel, /Start Preview server|Stop Preview server/);

		const stopped = { ...external, id: "pv-managed", managementMode: "managed", managed: true, serverState: "stopped", health: "stopped" };
		const stoppedPanel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [stopped], selectedPreview: stopped, loading: false, reloadKey: 0,
		}));
		assert.doesNotMatch(stoppedPanel, /data-pibo-debug="session-live-preview-frame"/);
		assert.match(stoppedPanel, /aria-label="Start Preview server"/);
		assert.match(stoppedPanel, /Start server/);
		assert.doesNotMatch(stoppedPanel, /startCommand|workspace|node .*server/);

		const running = { ...stopped, serverState: "running", health: "online", serverStopAt: "2026-08-23T00:10:00.000Z" };
		const runningPanel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [running], selectedPreview: running, loading: false, reloadKey: 0,
		}));
		assert.match(runningPanel, /aria-label="Stop Preview server"/);
		assert.match(runningPanel, /data-pibo-debug="session-live-preview-frame"/);

		const topBar = renderToStaticMarkup(React.createElement(PreviewFullscreenTopBar, {
			preview: running, onReload: noop, onStart: noop, onStop: noop, onExit: noop,
		}));
		assert.match(topBar, /data-pibo-debug="preview-fullscreen-top-bar"/);
		assert.match(topBar, /aria-label="Stop Preview server"/);
		assert.match(topBar, /aria-label="Exit Preview fullscreen"/);
		assert.match(topBar, />Website</);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("session trace integrates Preview as a session and Project view with trusted fullscreen content", () => {
	const pane = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	const layout = readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
	assert.match(pane, /getSessionLivePreviews/);
	assert.match(pane, /startSessionLivePreview/);
	assert.match(pane, /stopSessionLivePreview/);
	assert.match(pane, /removeSessionLivePreview/);
	assert.match(pane, /id: "preview"/);
	assert.match(pane, /<SessionLivePreviewPanel/);
	assert.match(pane, /<PreviewFullscreenTopBar/);
	assert.match(layout, /fullscreenTopBar/);
	assert.match(layout, /fullscreenContent/);
	assert.match(layout, /hideComposer \? null : <Composer/);
});
