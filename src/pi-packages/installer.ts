import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { ParsedPiPackageSource, PiPackageInstallResult } from "./types.js";

const execFileAsync = promisify(execFile);

export async function installOrResolvePiPackage(
	parsed: ParsedPiPackageSource,
	cwd = process.cwd(),
): Promise<PiPackageInstallResult> {
	if (parsed.kind === "local") {
		if (!parsed.path || !existsSync(parsed.path)) {
			return {
				installStatus: "missing",
				diagnostics: [{ type: "error", message: `Local Pi package path does not exist: ${parsed.path ?? parsed.source}` }],
			};
		}
		return {
			installStatus: "installed",
			installPath: parsed.path,
			diagnostics: [{ type: "info", message: `Resolved local Pi package path: ${parsed.path}` }],
		};
	}

	const packageName = parsed.packageName ?? parsed.name;
	const installRoot = npmPackageInstallRoot(cwd, packageName);
	const installPath = resolve(installRoot, "node_modules", ...packageName.split("/"));

	try {
		ensureNpmInstallProject(installRoot);
		await execFileAsync("npm", ["install", packageName, "--prefix", installRoot, "--omit=dev"], {
			cwd: installRoot,
			timeout: 120000,
			maxBuffer: 1024 * 1024,
		});
		if (!existsSync(installPath)) {
			return {
				installStatus: "missing",
				installPath,
				diagnostics: [{ type: "error", message: `npm install completed but package path is missing: ${installPath}` }],
			};
		}
		return {
			installStatus: "installed",
			installPath,
			diagnostics: [{ type: "info", message: `Installed npm Pi package ${packageName} into ${installRoot}` }],
		};
	} catch (error) {
		return {
			installStatus: "error",
			installPath: existsSync(installPath) ? installPath : undefined,
			diagnostics: [{
				type: "error",
				message: `Could not install npm Pi package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
			}],
		};
	}
}

export function npmPackageInstallRoot(cwd: string, packageName: string): string {
	return resolve(cwd, ".pibo/pi-packages/npm", encodePackageName(packageName));
}

function ensureNpmInstallProject(installRoot: string): void {
	mkdirSync(installRoot, { recursive: true });
	const packageJsonPath = resolve(installRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		writeFileSync(packageJsonPath, `${JSON.stringify({ name: "pibo-pi-package", private: true }, null, 2)}\n`, "utf-8");
	}
	const gitIgnorePath = resolve(dirname(packageJsonPath), ".gitignore");
	if (!existsSync(gitIgnorePath)) {
		writeFileSync(gitIgnorePath, "*\n!.gitignore\n", "utf-8");
	}
}

function encodePackageName(packageName: string): string {
	return encodeURIComponent(packageName).replace(/%/g, "_");
}
