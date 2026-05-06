import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { piboHomePath } from "../core/pibo-home.js";

function gatewayPidPath(): string {
	return piboHomePath("gateway.pid");
}

function fallbackGatewayPidPath(): string {
	return piboHomePath("gateway-fallback.pid");
}

export function readPidFile(): number | undefined {
	try {
		const path = gatewayPidPath();
		if (!existsSync(path)) return undefined;
		const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
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
		const path = gatewayPidPath();
		if (existsSync(path)) {
			unlinkSync(path);
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
	writeFileSync(gatewayPidPath(), String(process.pid), "utf-8");
}

export function readFallbackPidFile(): number | undefined {
	try {
		const path = fallbackGatewayPidPath();
		if (!existsSync(path)) return undefined;
		const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
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

export function clearFallbackPidFile(): void {
	try {
		const path = fallbackGatewayPidPath();
		if (existsSync(path)) {
			unlinkSync(path);
		}
	} catch {
		// ignore
	}
}

export function writeFallbackGatewayPid(): void {
	const existingPid = readFallbackPidFile();
	if (existingPid !== undefined && existingPid !== process.pid) {
		throw new Error(`Fallback gateway already running (PID ${existingPid})`);
	}
	writeFileSync(fallbackGatewayPidPath(), String(process.pid), "utf-8");
}
