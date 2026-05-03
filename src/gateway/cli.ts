import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT } from "./protocol.js";
import { clearPidFile, readPidFile } from "./pidfile.js";

function isPortReachable(host: string, port: number, timeout = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(port, host);
		const onError = () => {
			socket.destroy();
			resolve(false);
		};
		socket.setTimeout(timeout);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", onError);
		socket.once("timeout", onError);
	});
}

async function waitForGatewayUp(maxRetries = 30, intervalMs = 1000): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		if (await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, 2000)) {
			return true;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

async function waitForGatewayDown(maxRetries = 20, intervalMs = 500): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		if (!(await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, 1000))) {
			return true;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

function resolveGatewayCommand(argv: string[]): { command: string; args: string[] } {
	// Prefer the actual script path when running via node/tsx
	if (
		argv[1] &&
		(argv[1].endsWith(".js") || argv[1].endsWith(".ts") || argv[1].endsWith(".mjs"))
	) {
		return { command: argv[0] ?? process.execPath, args: [argv[1], "gateway"] };
	}
	// Fallback to the current process invocation
	return { command: process.execPath, args: [argv[1] ?? "", "gateway"] };
}

export async function runGatewayCli(argv = process.argv): Promise<void> {
	const args = argv.slice(2);
	const subcommand = args[1];
	const hasForceFlag = args.includes("--force");

	if (subcommand === "status") {
		const reachable = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
		const pid = readPidFile();
		if (reachable) {
			console.log(
				`Gateway is running${pid ? ` (PID ${pid})` : ""} on ${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`,
			);
		} else {
			console.log(`Gateway is not running on ${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`);
			process.exitCode = 1;
		}
		return;
	}

	if (subcommand === "stop") {
		const pid = readPidFile();
		const reachable = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);

		if (!reachable && !pid) {
			console.log("Gateway is not running.");
			return;
		}

		if (pid) {
			console.error(`Stopping gateway (PID ${pid})...`);
			try {
				process.kill(pid, "SIGTERM");
			} catch (err) {
				console.error(
					`Warning: failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		console.error("Waiting for gateway to shut down...");
		const down = await waitForGatewayDown(20, 500);
		if (!down && hasForceFlag && pid) {
			console.error("Force-killing gateway...");
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
			const killed = await waitForGatewayDown(10, 500);
			if (!killed) {
				console.error("Gateway did not shut down even with SIGKILL.");
				process.exitCode = 1;
				return;
			}
		} else if (!down) {
			console.error("Gateway did not shut down gracefully. Use --force to kill.");
			process.exitCode = 1;
			return;
		}

		clearPidFile();
		console.log("Gateway stopped.");
		return;
	}

	if (subcommand === "restart") {
		console.error("Checking gateway status...");
		const wasRunning = await isPortReachable(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
		const pid = readPidFile();

		if (wasRunning) {
			if (pid) {
				console.error(`Stopping gateway (PID ${pid})...`);
				try {
					process.kill(pid, "SIGTERM");
				} catch (err) {
					console.error(
						`Warning: failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			} else {
				console.error("Gateway is running but PID file not found. Waiting for port to become free...");
			}

			console.error("Waiting for gateway to shut down...");
			const down = await waitForGatewayDown(20, 500);
			if (!down && hasForceFlag && pid) {
				console.error("Force-killing gateway...");
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
				const killed = await waitForGatewayDown(10, 500);
				if (!killed) {
					console.error("Gateway did not shut down even with SIGKILL. Aborting restart.");
					process.exitCode = 1;
					return;
				}
			} else if (!down) {
				console.error("Gateway did not shut down gracefully. Use --force to kill. Aborting restart.");
				process.exitCode = 1;
				return;
			}
		} else {
			console.error("Gateway was not running.");
		}

		clearPidFile();

		console.error("Starting gateway...");
		const { command, args: spawnArgs } = resolveGatewayCommand(argv);
		const child = spawn(command, spawnArgs, {
			detached: true,
			stdio: "ignore",
		});
		child.unref();

		console.error("Waiting for gateway to come back online...");
		const backOnline = await waitForGatewayUp(30, 1000);
		if (backOnline) {
			const newPid = readPidFile();
			console.log(`Gateway restarted successfully${newPid ? ` (PID ${newPid})` : ""}`);
		} else {
			console.error("Gateway did not come back online in time");
			process.exitCode = 1;
		}
		return;
	}

	if (subcommand === "start" || !subcommand || subcommand.startsWith("-")) {
		const { runGatewayServer } = await import("./server.js");
		await runGatewayServer();
		return;
	}

	if (subcommand === "--help" || subcommand === "-h") {
		printGatewayHelp();
		return;
	}

	console.error(`Unknown gateway subcommand: ${subcommand}`);
	printGatewayHelp();
	process.exitCode = 1;
}

function printGatewayHelp(): void {
	console.log(`pibo gateway - Gateway daemon management

Commands:
  start    Start the gateway daemon (default)
  status   Check if the gateway daemon is running
  stop     Stop the gateway daemon
  restart  Gracefully restart the gateway daemon

Options:
  --force  Force kill (SIGKILL) if graceful stop fails

Next:
  pibo gateway <command> --help
`);
}
