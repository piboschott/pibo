import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const GATEWAY_PID_PATH = join(homedir(), ".pibo", "gateway.pid");

export function readPidFile(): number | undefined {
	try {
		if (!existsSync(GATEWAY_PID_PATH)) return undefined;
		const pid = parseInt(readFileSync(GATEWAY_PID_PATH, "utf-8").trim(), 10);
		if (Number.isNaN(pid)) return undefined;
		try {
			process.kill(pid, 0);
			return pid;
		} catch {
			return undefined;
		}
	} catch {
		return undefined;
	}
}

export function clearPidFile(): void {
	try {
		if (existsSync(GATEWAY_PID_PATH)) {
			unlinkSync(GATEWAY_PID_PATH);
		}
	} catch {
		// ignore
	}
}

export function writeGatewayPid(): void {
	const existingPid = readPidFile();
	if (existingPid !== undefined && existingPid !== process.pid) {
		throw new Error(`Gateway already running (PID ${existingPid})`);
	}
	writeFileSync(GATEWAY_PID_PATH, String(process.pid), "utf-8");
}
