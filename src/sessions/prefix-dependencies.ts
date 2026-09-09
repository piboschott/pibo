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
