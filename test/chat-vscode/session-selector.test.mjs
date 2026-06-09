import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..", "..");

describe("chat-vscode/SessionSelector", () => {
	const script = `
		import assert from "node:assert/strict";
		import * as React from "react";
		globalThis.React = React;
		import { createElement } from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { SessionSelector } from "./src/apps/chat-vscode/extension/webview/SessionSelector.tsx";

		const noop = async () => undefined;
		const sessions = [
			{ piboSessionId: "ps_1", title: "One", status: "running" },
			{ piboSessionId: "ps_2", title: "Two", status: "idle" },
		];

		// Mode "rooms" → renders the Room Picker, not the Session List.
		{
			const html = renderToStaticMarkup(createElement(SessionSelector, {
				mode: {
					kind: "rooms",
					workspace: "/tmp/picker-test",
					candidates: [
						{ id: "room_a", name: "A", workspace: "/tmp/picker-test", type: "chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", metadata: {} },
						{ id: "room_b", name: "B", workspace: "/tmp/picker-test", type: "chat", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z", metadata: {} },
					],
				},
				onSelectSession: () => undefined,
				onNewSession: noop,
				onDeleteSession: noop,
				onRenameSession: noop,
				onSelectRoom: () => undefined,
			}));
			assert.ok(html.includes('data-testid="room-picker"'), "Room Picker mode should render the room-picker testid, got: " + html.slice(0, 200));
			assert.ok(!html.includes('data-testid="session-list"'), "Room Picker mode should NOT render the session-list testid");
			assert.ok(html.includes("/tmp/picker-test"), "Room Picker should display the workspace path");
			assert.ok(html.includes("A") && html.includes("B"), "Room Picker should list candidates A and B");
		}

		// Mode "sessions" → renders the Session List, not the Room Picker.
		{
			const html = renderToStaticMarkup(createElement(SessionSelector, {
				mode: {
					kind: "sessions",
					roomId: "room_x",
					sessions,
					selectedPiboSessionId: "ps_1",
				},
				onSelectSession: () => undefined,
				onNewSession: noop,
				onDeleteSession: noop,
				onRenameSession: noop,
				onSelectRoom: () => undefined,
			}));
			assert.ok(html.includes('data-testid="session-list"'), "Sessions mode should render the session-list testid");
			assert.ok(!html.includes('data-testid="room-picker"'), "Sessions mode should NOT render the room-picker testid");
			assert.ok(html.includes("One") && html.includes("Two"), "Sessions mode should list session titles");
		}
	`;

	test("renders the right view for the mode prop", async () => {
		await execFileAsync(
			process.execPath,
			["--import", "tsx", "--input-type=module", "--eval", script],
			{ cwd: root },
		);
	});
});
