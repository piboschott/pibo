import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import { CliSourceError, createDefaultFakeCliSessionSource, FakeCliSessionSource } from "../dist/cli-session/index.js";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import {
	cliSessionsHelpText,
	cliSessionSlashHelpText,
	createCliSessionCleanup,
	formatCliSessionError,
	formatCliSessionStatus,
	handleCliSessionSubmittedInput,
	InkSessionAppView,
	parseCliSessionInput,
	reduceInkSessionInputState,
	runCliSessionsUi,
	terminalLineLimitFromColumns,
} from "../dist/apps/cli-ui/index.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

function traceView() {
	return {
		piboSessionId: "ps_cli_app_shell",
		piSessionId: "pi_cli_app_shell",
		title: "CLI app shell fixture",
		version: "test",
		rawEvents: [],
		nodes: [
			{
				id: "node-user",
				piboSessionId: "ps_cli_app_shell",
				type: "user.message",
				title: "User Message",
				status: "done",
				startedAt: "2026-05-16T13:00:00.000Z",
				output: "Show me status",
				children: [],
			},
			{
				id: "node-assistant",
				piboSessionId: "ps_cli_app_shell",
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				startedAt: "2026-05-16T13:00:01.000Z",
				output: "Status looks healthy.",
				children: [],
			},
		],
	};
}

function baseState() {
	const rows = buildCompactTerminalRows(traceView(), { showThinking: false });
	return {
		loading: false,
		status: {
			source: "fake",
			mode: "fake",
			connected: true,
			rooms: "supported",
			sessions: "supported",
			agents: "supported",
			activeSessionId: "ps_cli_app_shell",
			activeAgentId: "pibo-agent",
			updatedAt: "2026-05-16T13:00:02.000Z",
		},
		session: {
			id: "ps_cli_app_shell",
			title: "CLI app shell fixture",
			profile: "pibo-agent",
			agentId: "pibo-agent",
			status: "idle",
		},
		rows,
		input: "/status",
		mode: "transcript",
	};
}

function stateHarness(initialState) {
	let state = initialState;
	const setState = (value) => {
		state = typeof value === "function" ? value(state) : value;
	};
	return {
		get state() {
			return state;
		},
		setState,
	};
}

function streamWithTty(isTTY, columns = 80) {
	const stream = new PassThrough();
	stream.isTTY = isTTY;
	stream.columns = columns;
	return stream;
}

async function openFakeSessionInto(source, harness, sessionId, message) {
	const opened = await source.openSession(sessionId);
	harness.setState((current) => ({
		...current,
		session: opened.session,
		status: opened.status,
		rows: buildCompactTerminalRows(opened.traceView, { showThinking: false }),
		mode: "transcript",
		picker: undefined,
		message,
		error: undefined,
	}));
	opened.subscribe((update) => {
		harness.setState((current) => ({
			...current,
			session: update.session ?? current.session,
			status: update.status ?? current.status,
			rows: update.traceView === undefined ? current.rows : buildCompactTerminalRows(update.traceView, { showThinking: false }),
			error: update.error?.message ?? current.error,
		}));
	});
}

test("InkSessionAppView renders status bar transcript viewport and input line", () => {
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: baseState(),
		maxRows: 20,
	}));

	assert.match(output, /Pibo CLI Sessions \| fake \| CLI app shell fixture \| pibo-agent/);
	assert.match(output, /Commands: \/help \/new \/session \/agent \/status \/clear \/exit \/quit/);
	assert.match(output, /› Show me status/);
	assert.match(output, /Status looks healthy\./);
	assert.match(output, /› \/status/);
});

test("Ink session input reducer captures text, enter, navigation, and escape", () => {
	const base = { loading: false, rows: [], input: "", mode: "session-picker", picker: { kind: "session", title: "Pick", items: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], selectedIndex: 0, emptyMessage: "None" } };
	const typed = reduceInkSessionInputState(base, { type: "text", value: "hi" });
	assert.equal(typed.input, "hi");
	assert.equal(reduceInkSessionInputState(typed, { type: "backspace" }).input, "h");
	assert.equal(reduceInkSessionInputState(typed, { type: "down" }).picker.selectedIndex, 1);
	const entered = reduceInkSessionInputState(typed, { type: "enter" });
	assert.equal(entered.input, "");
	assert.equal(entered.message, undefined);
	const escaped = reduceInkSessionInputState(typed, { type: "escape" });
	assert.equal(escaped.input, "");
	assert.equal(escaped.mode, "transcript");
	assert.equal(escaped.picker, undefined);
	assert.equal(escaped.message, "Canceled.");
});

test("Slash parser distinguishes messages, commands, and empty input", () => {
	assert.deepEqual(parseCliSessionInput("  hello agent  "), { type: "message", text: "hello agent" });
	assert.deepEqual(parseCliSessionInput(" /STATUS now "), { type: "command", command: { name: "status", args: "now", raw: "/STATUS now" } });
	assert.deepEqual(parseCliSessionInput("   "), { type: "empty" });
	assert.match(cliSessionSlashHelpText(), /\/help, \/new, \/session, \/agent, \/status, \/clear, \/exit, \/quit/);
	assert.match(cliSessionSlashHelpText(), /Web-only in V1/);
});

test("exit cleanup closes open session subscriptions and source idempotently", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");
	const unsubscribe = opened.subscribe(() => {});
	assert.equal(source.listenerCount("ps_fake_existing"), 1);

	let closeSessionCalls = 0;
	const cleanup = createCliSessionCleanup(() => {
		closeSessionCalls += 1;
		unsubscribe();
		void opened.close();
	}, () => source.close());

	cleanup();
	cleanup();
	assert.equal(closeSessionCalls, 1);
	assert.equal(source.listenerCount("ps_fake_existing"), 0);
	assert.throws(() => source.setStatus({ message: "after-close" }), /source is closed/);
});

test("Slash commands handle help status clear pickers unknown exit and normal sends", async () => {
	const source = createDefaultFakeCliSessionSource();
	source.setStatus({ message: "TOKEN=secret-value" });
	const harness = stateHarness({ ...baseState(), session: { id: "ps_fake_existing", title: "Existing fake session", profile: "pibo-agent", agentId: "pibo-agent", status: "idle" } });
	let exited = false;
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => { exited = true; });

	await submit("/help");
	assert.match(harness.state.message, /\/new/);
	assert.match(harness.state.message, /\/details/);

	await submit("/status");
	assert.match(harness.state.message, /source=fake/);
	assert.match(harness.state.message, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(harness.state.message, /secret-value/);
	assert.match(formatCliSessionStatus(harness.state.status, harness.state.session), /connected=yes/);

	await submit("/clear");
	assert.equal(harness.state.rows.length, 0);
	assert.match(harness.state.message, /Session data was not deleted/);

	await submit("/session");
	assert.equal(harness.state.mode, "session-picker");
	assert.equal(harness.state.picker.kind, "session");
	assert.ok(harness.state.picker.items.length >= 1);

	await submit("/agent");
	assert.equal(harness.state.mode, "agent-picker");
	assert.equal(harness.state.picker.kind, "agent");
	assert.match(harness.state.picker.items[0].label, /Pibo Agent|pibo-agent/);

	await submit("/new");
	assert.match(harness.state.session.id, /^ps_fake_created_/);
	assert.match(harness.state.message, /Created session/);

	await submit("hello from test");
	assert.equal(harness.state.error, undefined);
	assert.equal(harness.state.message, "Message sent.");
	assert.ok(harness.state.rows.some((row) => String(row.output ?? "").includes("hello from test")));

	await submit("/unknown");
	assert.match(harness.state.error, /Unknown command \/unknown/);

	await submit("/quit");
	assert.equal(exited, true);
});

test("empty picker states and recovery errors are actionable and redacted", async () => {
	const source = new FakeCliSessionSource({ sessions: [], agents: [], status: { rooms: "unsupported", message: "TOKEN=secret-value" } });
	const harness = stateHarness({ ...baseState(), session: undefined, rows: [] });
	const openSession = (sessionId, message) => openFakeSessionInto(source, harness, sessionId, message);
	const submit = (input) => handleCliSessionSubmittedInput(input, source, harness.state, harness.setState, openSession, () => {});

	await submit("/session");
	assert.equal(harness.state.mode, "session-picker");
	assert.equal(harness.state.picker.items.length, 0);
	assert.match(harness.state.picker.emptyMessage, /Use \/new/);
	assert.match(harness.state.picker.emptyMessage, /cannot list rooms/);

	await submit("/agent");
	assert.equal(harness.state.mode, "agent-picker");
	assert.equal(harness.state.picker.items.length, 0);
	assert.match(harness.state.picker.emptyMessage, /No existing agents\/profiles/);

	const formatted = formatCliSessionError(new CliSourceError("session_not_found", "missing TOKEN=secret-value"));
	assert.match(formatted, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(formatted, /secret-value/);
	assert.match(formatted, /Recovery: use \/session/);
});

test("default app viewport bounds large sessions and narrow terminal lines", () => {
	const rows = Array.from({ length: 30 }, (_, index) => ({
		id: `row-${index}`,
		kind: "message.user",
		status: "done",
		lines: [{ prefix: "prompt", tokens: [{ text: `message ${index} ${"x".repeat(80)}` }] }],
		sourceNodeIds: [`node-${index}`],
	}));
	const output = renderToString(React.createElement(InkSessionAppView, {
		state: { ...baseState(), rows, input: "x".repeat(120) },
		maxLineChars: 32,
	}));

	assert.match(output, /… 10 earlier rows omitted/);
	assert.doesNotMatch(output, /message 0/);
	assert.match(output, /message 29/);
	assert.match(output, /truncated/);
	assert.equal(terminalLineLimitFromColumns(36), 32);
	assert.equal(terminalLineLimitFromColumns(10), 20);
});

test("runCliSessionsUi rejects non-interactive stdin or stdout before rendering", async () => {
	const previousExitCode = process.exitCode;
	const stderr = streamWithTty(false);
	let stderrText = "";
	stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
	process.exitCode = undefined;
	await runCliSessionsUi({ stdin: streamWithTty(false), stdout: streamWithTty(true), stderr, source: createDefaultFakeCliSessionSource() });
	assert.equal(process.exitCode, 1);
	assert.match(stderrText, /interactive stdin and stdout TTYs/);
	process.exitCode = previousExitCode;
});

test("pibo tui:sessions command help and root discovery describe the new UI without hiding existing TUI commands", async () => {
	const help = cliSessionsHelpText();
	assert.match(help, /reduced Web Chat-derived session UI/);
	assert.match(help, /\/help \/new \/session \/agent \/status \/clear \/exit \/quit/);
	assert.match(help, /pibo tui\n/);
	assert.match(help, /pibo tui:routed/);

	const commandHelp = await execFileAsync("node", [cliPath, "tui:sessions", "--help"]);
	assert.match(commandHelp.stdout, /pibo tui:sessions/);
	assert.match(commandHelp.stdout, /--demo/);

	const rootHelp = await execFileAsync("node", [cliPath, "--help"]);
	assert.match(rootHelp.stdout, /tui\s+Start the direct Pi TUI/);
	assert.match(rootHelp.stdout, /tui:routed\s+Start the local routed Pibo TUI/);
	assert.match(rootHelp.stdout, /tui:sessions\s+Start the reduced Web Chat-derived session UI/);
});

test("pibo tui:sessions startup has a non-TTY smoke-test seam", async () => {
	await assert.rejects(
		() => execFileAsync("node", [cliPath, "tui:sessions", "--demo"]),
		(error) => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /requires interactive stdin and stdout TTYs/);
			return true;
		},
	);
});
