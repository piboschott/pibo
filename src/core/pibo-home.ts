import { homedir } from "node:os";
import { join } from "node:path";

export function getPiboHome(): string {
	return process.env.PIBO_HOME || join(homedir(), ".pibo");
}

export function piboHomePath(...segments: string[]): string {
	return join(getPiboHome(), ...segments);
}
