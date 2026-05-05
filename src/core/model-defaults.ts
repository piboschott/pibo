import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "./pibo-home.js";
import type { InitialSessionContext, ModelProfile } from "./profiles.js";

export const DEFAULT_PIBO_MODEL_DEFAULTS_PATH = "model-defaults.json";

export type PiboModelDefaults = {
	main?: ModelProfile;
	subagent?: ModelProfile;
};

export function selectRequestedModelProfile(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): ModelProfile | undefined {
	if (profile.model) return cloneModelProfile(profile.model);
	if (profile.parentSessionId) return cloneModelProfile(profile.subagentModel ?? defaults.subagent);
	return cloneModelProfile(profile.mainModel ?? defaults.main);
}

export function loadPiboModelDefaults(
	cwd = process.cwd(),
	path?: string,
): PiboModelDefaults {
	const resolvedPath = path ? resolve(cwd, path) : piboHomePath(DEFAULT_PIBO_MODEL_DEFAULTS_PATH);
	if (!existsSync(resolvedPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
		return sanitizePiboModelDefaults(parsed);
	} catch {
		return {};
	}
}

export function savePiboModelDefaults(
	defaults: PiboModelDefaults,
	cwd = process.cwd(),
	path?: string,
): PiboModelDefaults {
	const sanitized = sanitizePiboModelDefaults(defaults);
	const resolvedPath = path ? resolve(cwd, path) : piboHomePath(DEFAULT_PIBO_MODEL_DEFAULTS_PATH);
	mkdirSync(dirname(resolvedPath), { recursive: true });
	writeFileSync(resolvedPath, `${JSON.stringify(sanitized, null, 2)}\n`);
	return sanitized;
}

export function sanitizePiboModelDefaults(value: unknown): PiboModelDefaults {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		main: sanitizeModelProfile(raw.main),
		subagent: sanitizeModelProfile(raw.subagent),
	};
}

export function sanitizeModelProfile(value: unknown): ModelProfile | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.provider !== "string" || typeof raw.id !== "string") return undefined;
	const provider = raw.provider.trim();
	const id = raw.id.trim();
	if (!provider || !id) return undefined;
	return { provider, id };
}

function cloneModelProfile(model: ModelProfile | undefined): ModelProfile | undefined {
	return model ? { ...model } : undefined;
}
