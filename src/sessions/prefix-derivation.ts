import { createHash } from "node:crypto";
import { retainPrefixArtifactDependencies } from "./prefix-dependencies.js";
import { constants, createReadStream } from "node:fs";
import { open, lstat, opendir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PiboJsonObject } from "../core/events.js";
import { ensureDurableDirectory, PrefixRecoveryRequiredError, readSessionPrefixBinding, SESSION_PREFIX_METADATA_KEY, SESSION_PREFIX_TRANSITION_KEY, type SessionPrefixBinding } from "./prefix-capsule.js";
import { readPrefixTransition } from "./prefix-transition.js";

/** A native fork has already succeeded; publication uses the existing derived-session transaction. */
export function deriveSessionPrefixMetadata(metadata: PiboJsonObject | undefined, sourceId: string, targetId: string): PiboJsonObject | undefined {
	const prefix = readSessionPrefixBinding(metadata);
	if (!prefix) return metadata;
	if (!targetId || targetId === sourceId || prefix.nativeSessionId !== sourceId) throw new PrefixRecoveryRequiredError("native derivation identity is inconsistent");
	if (readPrefixTransition(metadata)?.state === "pending") throw new PrefixRecoveryRequiredError("cannot derive an unfinished prefix transition");
	const sourceFile = typeof metadata?.nativeSessionFile === "string" ? metadata.nativeSessionFile : undefined;
	const derived: PiboJsonObject = { ...retainPrefixArtifactDependencies(metadata, metadata, prefix.capsule.adapterId, sourceFile), piboSessionPrefixDerived: true };
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

/** OMP's native fork logs artifact-copy failures; publication must verify the copy. */
export async function syncDerivedOmpArtifacts(sourceFile: string | undefined, targetFile: string | undefined, copied: boolean): Promise<void> {
 if (!sourceFile?.endsWith(".jsonl") || !targetFile?.endsWith(".jsonl")) throw new PrefixRecoveryRequiredError("unsupported OMP native artifact layout");
 const inspect = async (root: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>(); let count = 0, bytes = 0;
  try { await lstat(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return files; throw error; }
  const visit = async (path: string, depth: number): Promise<void> => {
   if (++count > 100000 || depth > 64) throw new PrefixRecoveryRequiredError("native artifact tree exceeds bounds");
   const stat = await lstat(path);
   if (stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new PrefixRecoveryRequiredError("native artifact symlinks cannot be published");
   if (stat.isDirectory()) {
    for await (const entry of await opendir(path)) await visit(join(path, entry.name), depth + 1);
    const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); }
   } else if (stat.isFile()) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
     if (!(await handle.stat()).isFile()) throw new PrefixRecoveryRequiredError("native artifact changed type");
     const digest = createHash("sha256");
     for await (const chunk of createReadStream(path, {fd: handle.fd, autoClose: false})) {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) throw new PrefixRecoveryRequiredError("native artifact copy exceeds byte quota");
      digest.update(chunk);
     }
     await handle.sync(); files.set(relative(root, path), digest.digest("hex"));
    } finally { await handle.close(); }
   } else throw new PrefixRecoveryRequiredError("native artifact is not a regular file");
  };
  await visit(root, 0); return files;
 };
 const source = await inspect(sourceFile.slice(0, -6));
 const target = await inspect(targetFile.slice(0, -6));
 if (copied && [...source].some(([path, digest]) => target.get(path) !== digest)) throw new PrefixRecoveryRequiredError("native artifact copy is incomplete");
}
