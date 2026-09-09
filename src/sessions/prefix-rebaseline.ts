import type { PiboJsonObject } from "../core/events.js";
import { randomUUID } from "node:crypto";
import type { RuntimeSessionBinding } from "./runtime-binding.js";
import { PrefixRecoveryRequiredError, readSessionPrefixBinding } from "./prefix-capsule.js";

export const SESSION_PREFIX_REBASELINE_KEY = "piboSessionPrefixRebaseline";
export type PrefixModelSelection = { provider: string; id: string };
export type PrefixRebaseline = {
	format: 1;
	id: string;
	reason: "model-change" | "runtime-change" | "explicit-refresh";
	targetAdapterId: string;
	/** One pending transition only; completed transitions remain in the binding audit. */
	sourceBinding: RuntimeSessionBinding;
	previousModel?: PrefixModelSelection;
	targetModel?: PrefixModelSelection;
};

/** Explicit runtime replacement retains the complete rollback reference. */
export function preparePrefixRuntimeTransition(source: RuntimeSessionBinding, target: RuntimeSessionBinding,
	previousModel?: PrefixModelSelection, reason: "runtime-change" | "explicit-refresh" = "runtime-change"): RuntimeSessionBinding {
	if (!readSessionPrefixBinding(source.metadata)) return target;
	if (readPrefixRebaseline(source.metadata)) throw new PrefixRecoveryRequiredError("another explicit prefix transition is pending");
	const policy: PrefixRebaseline = { format: 1, id: randomUUID(), reason,
		targetAdapterId: target.adapterId, sourceBinding: structuredClone(source), ...(previousModel ? { previousModel } : {}) };
	const metadata = { ...target.metadata, [SESSION_PREFIX_REBASELINE_KEY]: policy as unknown as PiboJsonObject };
	readPrefixRebaseline(metadata);
	return { ...target, metadata };
}
function model(value: unknown): value is PrefixModelSelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	return [v.provider, v.id].every(item => typeof item === "string" && item.length > 0 && item.length <= 256)
		&& Object.keys(v).every(key => key === "provider" || key === "id");
}
export function readPrefixRebaseline(metadata: PiboJsonObject | undefined): PrefixRebaseline | undefined {
	if (!metadata || !Object.hasOwn(metadata, SESSION_PREFIX_REBASELINE_KEY)) return undefined;
	const value = metadata[SESSION_PREFIX_REBASELINE_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== 1
		|| typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id)
		|| !["model-change", "runtime-change", "explicit-refresh"].includes(String(value.reason))
		|| typeof value.targetAdapterId !== "string" || !value.targetAdapterId || value.targetAdapterId.length > 256
		|| !value.sourceBinding || typeof value.sourceBinding !== "object" || Array.isArray(value.sourceBinding)
		|| value.previousModel !== undefined && !model(value.previousModel)
		|| value.targetModel !== undefined && !model(value.targetModel)) throw new PrefixRecoveryRequiredError("invalid explicit prefix transition");
	const source = value.sourceBinding as unknown as RuntimeSessionBinding;
	if (typeof source.piboSessionId !== "string" || !source.piboSessionId || source.piboSessionId.length > 1024
		|| typeof source.adapterId !== "string" || !source.adapterId || source.adapterId.length > 256
		|| typeof source.runtimeInstanceId !== "string" || !source.runtimeInstanceId || source.runtimeInstanceId.length > 256
		|| !Number.isSafeInteger(source.revision) || source.revision! < 1
		|| source.metadata?.[SESSION_PREFIX_REBASELINE_KEY] !== undefined
		|| !readSessionPrefixBinding(source.metadata)
		|| readSessionPrefixBinding(source.metadata)?.nativeSessionId !== source.nativeSessionId) {
		throw new PrefixRecoveryRequiredError("explicit prefix transition lost its source binding");
	}
	if (value.reason === "model-change" && (!value.previousModel || !value.targetModel)) throw new PrefixRecoveryRequiredError("model transition lost its explicit selection");
	// This is cold operational state, never an inference observation or history copy.
	if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new PrefixRecoveryRequiredError("explicit prefix transition exceeds its metadata budget");
	return structuredClone(value) as unknown as PrefixRebaseline;
}
