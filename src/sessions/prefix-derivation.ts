import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { PiboJsonObject } from "../core/events.js";
import { ensureDurableDirectory, PrefixRecoveryRequiredError, readSessionPrefixBinding, SESSION_PREFIX_METADATA_KEY, SESSION_PREFIX_TRANSITION_KEY, type SessionPrefixBinding } from "./prefix-capsule.js";
import { readPrefixTransition } from "./prefix-transition.js";

/** A native fork has already succeeded; publication uses the existing derived-session transaction. */
export function deriveSessionPrefixMetadata(metadata: PiboJsonObject | undefined, sourceId: string, targetId: string): PiboJsonObject | undefined {
	const prefix = readSessionPrefixBinding(metadata);
	if (!prefix) return metadata;
	if (!targetId || targetId === sourceId || prefix.nativeSessionId !== sourceId) throw new PrefixRecoveryRequiredError("native derivation identity is inconsistent");
	if (readPrefixTransition(metadata)?.state === "pending") throw new PrefixRecoveryRequiredError("cannot derive an unfinished prefix transition");
	const derived = { ...metadata };
	delete derived[SESSION_PREFIX_TRANSITION_KEY];
	derived[SESSION_PREFIX_METADATA_KEY] = { ...prefix, nativeSessionId: targetId,
		capsuleNativeSessionId: prefix.capsuleNativeSessionId ?? prefix.nativeSessionId,
		epoch: prefix.epoch + 1, reason: "fork" };
	return derived;
}

/** Codec-owned cold restore: identity/affinity vary by fork; original model instructions do not. */
export function restoreDerivedOmpPrefix(payload: string, prefix: SessionPrefixBinding | undefined): string {
	if (!prefix?.capsuleNativeSessionId) return payload;
	const snapshot = JSON.parse(payload);
	if (snapshot.nativeSessionId !== prefix.capsuleNativeSessionId) throw new PrefixRecoveryRequiredError("shared capsule belongs to an unexpected native source");
	const configuration = snapshot.providerStatic;
	const key = "prompt_cache_key";
	if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new PrefixRecoveryRequiredError("derived native prefix configuration is missing");
	if (configuration[key] !== undefined && configuration[key] !== null) {
		if (configuration[key] !== prefix.capsuleNativeSessionId) throw new PrefixRecoveryRequiredError("derived native affinity format is unsupported");
		configuration[key] = prefix.nativeSessionId;
	}
	snapshot.nativeSessionId = prefix.nativeSessionId;
	return JSON.stringify(snapshot);
}

/** Appended to new input, never substituted into inherited system instructions or history. */
export function derivedSessionIdentityText(piboSessionId: string): string {
	return `\n\n<pibo_session_identity>\nThe current Pibo Session ID is ${piboSessionId}. This conversation is a derived session. Earlier session identities in inherited instructions or messages refer to its source; use the current ID for operations on this conversation.\n</pibo_session_identity>`;
}

/** Native writers flush first; the new file must survive before publishing its Pibo identity. */
export async function syncDerivedNativeFile(path: string | undefined): Promise<void> {
	if (!path || !isAbsolute(path)) throw new PrefixRecoveryRequiredError("derived native history has no durable file");
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try { if (!(await file.stat()).isFile()) throw new PrefixRecoveryRequiredError("derived native history is not a regular file"); await file.sync(); }
	finally { await file.close(); }
	await ensureDurableDirectory(dirname(path));
}
