import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import test from "node:test";

import {
	createGatewayClientRequestFrame,
	createGatewayClientSubscriptionFrame,
	parseGatewayClientMessage,
} from "../dist/gateway/client.js";
import { isGatewayRequestFrame } from "../dist/gateway/protocol.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

async function runCliFailure(args) {
	try {
		await execFileAsync(process.execPath, [cliPath, ...args]);
		assert.fail(`Expected CLI failure for: ${args.join(" ")}`);
	} catch (error) {
		assert.equal(error.code, 1);
		return error;
	}
}

async function closeServer(server) {
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withMockGateway(handler) {
	const frames = [];
	const sockets = new Set();
	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					const frame = JSON.parse(line);
					frames.push(frame);
					handler(frame, socket);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
		socket.once("close", () => sockets.delete(socket));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		port: server.address().port,
		frames,
		async close() {
			for (const socket of sockets) socket.destroy();
			await closeServer(server);
		},
	};
}

async function runPipedClient(port, lines) {
	const child = spawn(process.execPath, [cliPath, "client", "ps_pipe", "--host", "127.0.0.1", "--port", String(port)], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(lines);
	const code = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`piped client did not exit\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, 5_000);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (exitCode) => {
			clearTimeout(timeout);
			resolve(exitCode);
		});
	});
	return { code, stdout, stderr };
}

test("root discovery and client help expose queue and steering delivery", async () => {
	const root = await execFileAsync(process.execPath, [cliPath]);
	assert.match(root.stdout, /client\s+Send queued or steering messages to one Pibo Session/);

	const help = await execFileAsync(process.execPath, [cliPath, "client", "--help"]);
	assert.match(help.stdout, /Start a console client for one Pibo Session/);
	assert.match(help.stdout, /\/steer <message>/);
	assert.match(help.stdout, /\/queue <message>/);
	assert.match(help.stdout, /--host <host>\s+Gateway host/);
	assert.match(help.stdout, /--port <port>/);
	assert.match(help.stdout, /Prompts are shown only in a TTY/);
	assert.doesNotMatch(help.stdout, /Loopback gateway host|Requires an interactive TTY/);
});

test("client arguments reject empty sessions, hosts, and invalid ports", async () => {
	assert.match((await runCliFailure(["client", ""])).stderr, /Pibo Session ID must not be empty/);
	assert.match((await runCliFailure(["client", "ps_test", "--host", ""])).stderr, /Gateway host must not be empty/);
	assert.match((await runCliFailure(["client", "ps_test", "--port", "0"])).stderr, /Port must be an integer between 1 and 65535/);
});

test("gateway client messages queue by default", () => {
	assert.deepEqual(parseGatewayClientMessage("  continue normally  "), {
		ok: true,
		text: "continue normally",
	});
	assert.deepEqual(parseGatewayClientMessage("/steering is ordinary text"), {
		ok: true,
		text: "/steering is ordinary text",
	});
});

test("gateway client supports explicit queue and steering delivery with whitespace separators", () => {
	assert.deepEqual(parseGatewayClientMessage("/queue run this after the current turn"), {
		ok: true,
		text: "run this after the current turn",
		delivery: "queue",
	});
	assert.deepEqual(parseGatewayClientMessage("/steer\tchange the current approach"), {
		ok: true,
		text: "change the current approach",
		delivery: "steer",
	});
});

test("gateway client rejects empty delivery commands locally", () => {
	assert.deepEqual(parseGatewayClientMessage("/queue"), {
		ok: false,
		error: "Usage: /queue <message>",
	});
	assert.deepEqual(parseGatewayClientMessage("/steer\t  "), {
		ok: false,
		error: "Usage: /steer <message>",
	});
});

test("gateway client frames preserve Pibo Session and event identity", () => {
	const request = createGatewayClientRequestFrame({
		type: "message",
		piboSessionId: "ps_running",
		text: "change course",
		source: "user",
		delivery: "steer",
	});
	assert.equal(request.type, "req");
	assert.equal(request.event.piboSessionId, "ps_running");
	assert.equal(request.event.id, request.id);
	assert.equal(request.event.delivery, "steer");

	const preserved = createGatewayClientRequestFrame({
		type: "execution",
		id: "event-from-caller",
		piboSessionId: "ps_running",
		action: "status",
	});
	assert.equal(preserved.event.id, "event-from-caller");
	assert.notEqual(preserved.id, preserved.event.id);

	const subscription = createGatewayClientSubscriptionFrame("ps_running");
	assert.equal(subscription.type, "subscribe");
	assert.deepEqual(subscription.subscription, { type: "session", piboSessionId: "ps_running" });
	assert.ok(subscription.id.length > 0);
});

test("piped client sends every line after a session subscription and exits after delayed responses", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			socket.write(`${JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { subscription: frame.subscription } })}\n`);
			return;
		}
		const payload = frame.event.delivery === "steer"
			? { type: "message_steered", piboSessionId: frame.event.piboSessionId, eventId: frame.event.id, activeEventId: "active-turn-1", text: frame.event.text, source: frame.event.source }
			: { type: "message_queued", piboSessionId: frame.event.piboSessionId, eventId: frame.event.id, queuedMessages: 1, text: frame.event.text, source: frame.event.source };
		const delay = frame.event.delivery === "steer" ? 40 : 70;
		setTimeout(() => socket.write(`${JSON.stringify({ type: "res", id: frame.id, ok: true, payload })}\n`), delay);
	});

	try {
		const result = await runPipedClient(gateway.port, "/steer\tchange the active approach\n/queue follow up afterward\nplain default queue\n");
		assert.equal(result.code, 0, result.stderr);
		assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /you> /);
		assert.match(result.stderr, /steer: delivered to active turn active-turn-1/);
		assert.equal(gateway.frames.length, 4);
		assert.deepEqual(gateway.frames[0].subscription, { type: "session", piboSessionId: "ps_pipe" });
		assert.deepEqual(gateway.frames.slice(1).map((frame) => ({
			piboSessionId: frame.event.piboSessionId,
			requestMatchesEvent: frame.id === frame.event.id,
			text: frame.event.text,
			delivery: frame.event.delivery,
		})), [
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "change the active approach", delivery: "steer" },
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "follow up afterward", delivery: "queue" },
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "plain default queue", delivery: undefined },
		]);
	} finally {
		await gateway.close();
	}
});

test("piped client reports rejected requests with a nonzero exit code", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			socket.write(`${JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { subscription: frame.subscription } })}\n`);
			return;
		}
		setTimeout(() => socket.write(`${JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: "session is not accepting steering" } })}\n`), 30);
	});

	try {
		const result = await runPipedClient(gateway.port, "/steer too late\n");
		assert.equal(result.code, 1);
		assert.match(result.stderr, /error: session is not accepting steering/);
		assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /you> /);
		assert.equal(gateway.frames.length, 2);
	} finally {
		await gateway.close();
	}
});

test("gateway protocol validates message identity, text, and optional delivery", () => {
	for (const delivery of [undefined, "queue", "steer"]) {
		assert.equal(isGatewayRequestFrame({
			type: "req",
			id: `req-${delivery ?? "default"}`,
			event: {
				type: "message",
				id: `event-${delivery ?? "default"}`,
				piboSessionId: "ps_running",
				text: "hello",
				...(delivery ? { delivery } : {}),
			},
		}), true);
	}

	for (const invalid of [
		{ type: "req", id: " ", event: { type: "message", piboSessionId: "ps_running", text: "hello" } },
		{ type: "req", id: "req", event: { type: "message", id: " ", piboSessionId: "ps_running", text: "hello" } },
		{ type: "req", id: "req", event: { type: "message", piboSessionId: " ", text: "hello" } },
		{ type: "req", id: "req", event: { type: "message", piboSessionId: "ps_running", text: " \t" } },
		{ type: "req", id: "req", event: { type: "message", piboSessionId: "ps_running", text: "hello", delivery: "later" } },
	]) {
		assert.equal(isGatewayRequestFrame(invalid), false);
	}
});
