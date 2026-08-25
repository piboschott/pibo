import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");
const {
	getConfigHash,
	getPidPath,
	getSocketDir,
	getSocketPath,
	usesFilesystemSocket,
} = await import("../dist/mcp/config.js");
const {
	isProcessRunning,
	readPidFile,
	removePidFile,
	removeSocketFile,
} = await import("../dist/mcp/daemon.js");

const statefulFixtureServerSource = String.raw`
import { appendFileSync } from "node:fs";

if (process.env.FIXTURE_START_LOG) {
  appendFileSync(process.env.FIXTURE_START_LOG, process.pid + "\n");
}

const tools = [
  {
    name: "process_id",
    description: "Return the fixture process id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "take_snapshot",
    description: "Create state that a later call must reuse.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Use a uid from the current snapshot.",
    inputSchema: {
      type: "object",
      properties: { uid: { type: "string" } },
      required: ["uid"],
    },
  },
];

let snapshotUid;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newlineIndex = buffer.indexOf("\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleMessage(JSON.parse(line));
  }
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleMessage(message) {
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    const delayMs = Number(process.env.FIXTURE_INIT_DELAY_MS ?? 0);
    setTimeout(() => {
      result(message.id, {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "stateful-fixture", version: "1.0.0" },
      });
    }, delayMs);
    return;
  }

  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params ?? {};
    if (name === "process_id") {
      result(message.id, {
        content: [{ type: "text", text: String(process.pid) }],
      });
      return;
    }
    if (name === "take_snapshot") {
      snapshotUid = "uid-" + process.pid + "-1";
      result(message.id, {
        content: [{ type: "text", text: snapshotUid }],
      });
      return;
    }
    if (name === "click") {
      if (!snapshotUid || args.uid !== snapshotUid) {
        error(message.id, -32602, "No matching snapshot found");
        return;
      }
      result(message.id, {
        content: [{ type: "text", text: "clicked:" + args.uid }],
      });
      return;
    }
  }

  error(message.id, -32601, "method not found: " + message.method);
}
`;

async function waitFor(predicate, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return true;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	return false;
}

async function callMcp(cwd, env, serverName, toolName, args = {}) {
	const result = await execFileAsync(
		process.execPath,
		[cliPath, "mcp", "call", serverName, toolName, JSON.stringify(args)],
		{ cwd, env },
	);
	return result.stdout.trim();
}

test("MCP daemon constructs deterministic per-user Windows named pipes", () => {
	const firstPipe = getSocketPath("chrome-devtools", "win32");
	const repeatedPipe = getSocketPath("chrome-devtools", "win32");
	const secondPipe = getSocketPath("unity", "win32");
	assert.match(
		firstPipe,
		/^\\\\\.\\pipe\\pibo-mcp-[a-f0-9]{12}-[a-f0-9]{16}$/,
	);
	assert.equal(repeatedPipe, firstPipe);
	assert.notEqual(firstPipe, secondPipe);
	assert.equal(usesFilesystemSocket("win32"), false);
	assert.equal(usesFilesystemSocket("darwin"), true);
	assert.equal(usesFilesystemSocket("linux"), true);
	assert.equal(usesFilesystemSocket("aix"), true);
	assert.equal(firstPipe.startsWith(getSocketDir("win32")), false);
});

test("MCP daemon hashes Windows PID names and encodes POSIX socket names", () => {
	const pidPath = getPidPath("../chrome/devtools", "win32");
	assert.equal(dirname(pidPath), getSocketDir("win32"));
	assert.match(basename(pidPath), /^[a-f0-9]{16}\.pid$/);
	assert.notEqual(
		getPidPath("CON", "win32").toLowerCase(),
		getPidPath("con", "win32").toLowerCase(),
	);

	const posixSocket = getSocketPath("../chrome/devtools", "linux");
	assert.equal(dirname(posixSocket), getSocketDir("linux"));
	assert.equal(basename(posixSocket), "..%2Fchrome%2Fdevtools.sock");
	assert.equal(
		getSocketPath("../chrome/devtools", "linux"),
		posixSocket,
	);
});

test("MCP daemon Windows IPC abstraction handles escaping, errors, and cleanup", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-win32-sim-"));
	const configModuleUrl = pathToFileURL(
		resolve("dist/mcp/config.js"),
	).href;
	const daemonModuleUrl = pathToFileURL(
		resolve("dist/mcp/daemon.js"),
	).href;
	const simulationServerName = '..\\\\CON/quote"/space /unicode-雪';
	const simulation = String.raw`
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";

Object.defineProperty(process, "platform", {
  configurable: true,
  value: "win32",
});

const {
  getPidPath,
  getSocketDir,
  getSocketPath,
  usesFilesystemSocket,
} = await import(${JSON.stringify(configModuleUrl)});
const {
  readPidFile,
  removePidFile,
  removeSocketFile,
  writePidFile,
} = await import(${JSON.stringify(daemonModuleUrl)});

const serverName = ${JSON.stringify(simulationServerName)};
const endpoint = getSocketPath(serverName);
assert.match(endpoint, /^\\\\\.\\pipe\\pibo-mcp-[a-f0-9]{12}-[a-f0-9]{16}$/);
assert.equal(usesFilesystemSocket(), false);
assert.equal(endpoint.startsWith(getSocketDir()), false);
assert.match(getPidPath(serverName), /[\\/][a-f0-9]{16}\.pid$/);

const connectError = await new Promise((resolveError) => {
  const socket = createConnection(endpoint);
  socket.once("connect", () => resolveError(null));
  socket.once("error", resolveError);
});
assert.ok(connectError instanceof Error);

const server = createServer((socket) => {
  socket.once("data", (data) => socket.end("reply:" + data.toString()));
});
await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(endpoint, resolveListen);
});
const reply = await new Promise((resolveReply, rejectReply) => {
  const socket = createConnection(endpoint, () => socket.write("ping"));
  let text = "";
  socket.on("data", (data) => { text += data.toString(); });
  socket.once("end", () => resolveReply(text));
  socket.once("error", rejectReply);
});
assert.equal(reply, "reply:ping");
await new Promise((resolveClose, rejectClose) => {
  server.close((error) => error ? rejectClose(error) : resolveClose());
});

writePidFile(serverName, "config-hash");
assert.equal(readPidFile(serverName)?.serverName, serverName);
removePidFile(serverName);
assert.equal(readPidFile(serverName), null);

await rm(endpoint, { force: true });
await writeFile(endpoint, "filesystem sentinel");
removeSocketFile(serverName);
assert.equal(await readFile(endpoint, "utf8"), "filesystem sentinel");
await rm(endpoint, { force: true });

process.stdout.write("win32-ipc-simulation-ok");
`;

	try {
		const result = await execFileAsync(
			process.execPath,
			["--input-type=module", "--eval", simulation],
			{ cwd },
		);
		assert.equal(result.stdout, "win32-ipc-simulation-ok");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("MCP daemon config hashes include nested values independent of key order", () => {
	const first = {
		command: "node",
		args: ["server.mjs"],
		env: { B: "two", A: "one" },
		pibo: { descriptionSource: "user", description: "Fixture" },
	};
	const reordered = {
		pibo: { description: "Fixture", descriptionSource: "user" },
		env: { A: "one", B: "two" },
		args: ["server.mjs"],
		command: "node",
	};
	const changedNestedValue = {
		...reordered,
		env: { A: "changed", B: "two" },
	};

	assert.equal(getConfigHash(first), getConfigHash(reordered));
	assert.notEqual(getConfigHash(first), getConfigHash(changedNestedValue));
});

test("sequential MCP CLI calls reuse one daemon and preserve server state", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-daemon-state-"));
	const serverName = `stateful-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const configPath = join(cwd, "mcp_servers.json");
	const startLogPath = join(cwd, "starts.log");
	const observedServerPids = new Set();
	const writeFixtureConfig = (initDelayMs) =>
		writeFile(
			configPath,
			JSON.stringify({
				mcpServers: {
					[serverName]: {
						command: process.execPath,
						args: [serverPath],
						env: {
							FIXTURE_START_LOG: startLogPath,
							FIXTURE_INIT_DELAY_MS: initDelayMs,
						},
					},
				},
			}),
		);

	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		await writeFixtureConfig("5500");

		const env = {
			...process.env,
			MCP_CONFIG_PATH: configPath,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "5",
			MCP_DEBUG: "1",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete env.MCP_NO_DAEMON;

		const firstServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(firstServerPid);
		assert.ok(Number.isInteger(firstServerPid) && firstServerPid > 0);

		const firstDaemon = readPidFile(serverName);
		assert.ok(firstDaemon);
		assert.ok(isProcessRunning(firstDaemon.pid));

		const secondServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(secondServerPid);
		assert.equal(secondServerPid, firstServerPid);
		assert.equal(readPidFile(serverName)?.pid, firstDaemon.pid);

		const snapshotUid = await callMcp(
			cwd,
			env,
			serverName,
			"take_snapshot",
		);
		assert.equal(snapshotUid, `uid-${firstServerPid}-1`);
		assert.equal(
			await callMcp(cwd, env, serverName, "click", { uid: snapshotUid }),
			`clicked:${snapshotUid}`,
		);

		const starts = (await readFile(startLogPath, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean);
		assert.deepEqual(starts, [String(firstServerPid)]);

		await writeFixtureConfig("0");
		const restartedServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(restartedServerPid);
		assert.notEqual(restartedServerPid, firstServerPid);
		const restartedDaemon = readPidFile(serverName);
		assert.ok(restartedDaemon);
		assert.notEqual(restartedDaemon.pid, firstDaemon.pid);
		assert.equal(isProcessRunning(firstDaemon.pid), false);
		assert.equal(isProcessRunning(firstServerPid), false);
		assert.deepEqual(
			(await readFile(startLogPath, "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean),
			[String(firstServerPid), String(restartedServerPid)],
		);

		assert.equal(
			await waitFor(() => !isProcessRunning(restartedDaemon.pid)),
			true,
			"daemon should stop after its idle timeout",
		);
		assert.equal(
			await waitFor(() => !isProcessRunning(restartedServerPid)),
			true,
			"stdio MCP server should stop with the daemon",
		);
		assert.equal(
			await waitFor(() => readPidFile(serverName) === null),
			true,
			"daemon PID metadata should be removed after shutdown",
		);
	} finally {
		try {
			const startedPids = (await readFile(startLogPath, "utf8"))
				.trim()
				.split("\n")
				.map(Number)
				.filter((pid) => Number.isInteger(pid) && pid > 0);
			for (const pid of startedPids) observedServerPids.add(pid);
		} catch {
			// The fixture may have failed before starting.
		}

		const daemon = readPidFile(serverName);
		if (daemon && isProcessRunning(daemon.pid)) {
			try {
				process.kill(daemon.pid, "SIGTERM");
			} catch {
				// Already stopped.
			}
			await waitFor(() => !isProcessRunning(daemon.pid), 3000);
		}
		for (const pid of observedServerPids) {
			if (!isProcessRunning(pid)) continue;
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Already stopped.
			}
		}
		removeSocketFile(serverName);
		removePidFile(serverName);
		await rm(cwd, { recursive: true, force: true });
	}
});
