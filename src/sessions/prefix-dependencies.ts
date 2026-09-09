import { isAbsolute } from "node:path";
import type { PiboJsonObject } from "../core/events.js";
import { PrefixRecoveryRequiredError, readSessionPrefixResourceReference, validatePrefixReference, type PrefixCapsuleReference } from "./prefix-capsule.js";
import { PREFIX_RESOURCES_CODEC } from "./prefix-resources.js";

export const PREFIX_RESOURCE_DEPENDENCIES_KEY = "piboSessionPrefixResourceDependencies";
const MAX_DEPENDENCIES = 128;

/** Old native messages may still name paths from earlier resource epochs. */
export function readPrefixResourceDependencies(metadata: PiboJsonObject | undefined): PrefixCapsuleReference[] {
	const value = metadata?.[PREFIX_RESOURCE_DEPENDENCIES_KEY];
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) throw new PrefixRecoveryRequiredError("invalid historical resource references");
	const seen = new Set<string>();
	for (const reference of value) {
		validatePrefixReference(reference);
		if (reference.codec !== PREFIX_RESOURCES_CODEC || seen.has(reference.digest)) throw new PrefixRecoveryRequiredError("invalid historical resource codec or duplicate reference");
		seen.add(reference.digest);
	}
	return structuredClone(value) as unknown as PrefixCapsuleReference[];
}

export function retainPrefixResourceDependencies(target: PiboJsonObject | undefined, source: PiboJsonObject | undefined): PiboJsonObject {
	const references = new Map([...readPrefixResourceDependencies(target), ...readPrefixResourceDependencies(source)]
		.map(reference => [reference.digest, reference]));
	const original = readSessionPrefixResourceReference(source);
	if (original) references.set(original.digest, original);
	if (references.size > MAX_DEPENDENCIES) throw new PrefixRecoveryRequiredError("historical resource limit reached; a fresh session is required to discard old resource paths");
	return { ...target, ...(references.size ? { [PREFIX_RESOURCE_DEPENDENCIES_KEY]: [...references.values()] as unknown as PiboJsonObject[] } : {}) };
}

export const PREFIX_ARTIFACT_DEPENDENCIES_KEY = "piboSessionPrefixArtifactDependencies";

/** Opaque native-owned directories, retained while inherited messages can name them. */
export function readPrefixArtifactDependencies(metadata: PiboJsonObject | undefined): string[] {
 const value = metadata?.[PREFIX_ARTIFACT_DEPENDENCIES_KEY];
 if (value === undefined) return [];
 if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES || new Set(value).size !== value.length
  || value.some(path => typeof path !== "string" || path.length > 4096 || !isAbsolute(path))) {
  throw new PrefixRecoveryRequiredError("invalid historical native artifact references");
 }
 return value as string[];
}

/** Pinned OMP SessionManager layout: foo.jsonl owns the sibling directory foo. */
export function nativeArtifactDirectories(adapterId: string, nativeFile: string | undefined, metadata: PiboJsonObject | undefined): string[] {
 const directories = new Set(readPrefixArtifactDependencies(metadata));
 if (adapterId === "orp" && nativeFile?.endsWith(".jsonl")) directories.add(nativeFile.slice(0, -6));
 if (directories.size > MAX_DEPENDENCIES) throw new PrefixRecoveryRequiredError("historical native artifact limit reached");
 return [...directories];
}

export function retainPrefixArtifactDependencies(target: PiboJsonObject | undefined, source: PiboJsonObject | undefined,
 adapterId: string, nativeFile: string | undefined): PiboJsonObject {
 const directories = new Set([...readPrefixArtifactDependencies(target), ...nativeArtifactDirectories(adapterId, nativeFile, source)]);
 const metadata = { ...target, ...(directories.size ? { [PREFIX_ARTIFACT_DEPENDENCIES_KEY]: [...directories] } : {}) };
 readPrefixArtifactDependencies(metadata);
 return metadata;
}
