import { PrefixRecoveryRequiredError } from "./prefix-capsule.js";

export const PREFIX_SETTINGS_KEY = "piboSessionPrefixSettings";
export type PrefixRuntimeSettings = { reasoning: string | null; fastMode: boolean };

/** Only user-facing controls; never provider credentials or arbitrary request options. */
export function readPrefixRuntimeSettings(value: unknown): PrefixRuntimeSettings | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrefixRecoveryRequiredError("invalid protected runtime settings");
	const settings = value as Record<string, unknown>;
	if (Object.keys(settings).length !== 2 || typeof settings.fastMode !== "boolean"
		|| settings.reasoning !== null && (typeof settings.reasoning !== "string" || !settings.reasoning || settings.reasoning.length > 64 || /[\x00-\x1f\x7f]/.test(settings.reasoning))) {
		throw new PrefixRecoveryRequiredError("invalid protected runtime settings");
	}
	return { reasoning: settings.reasoning as string | null, fastMode: settings.fastMode };
}
