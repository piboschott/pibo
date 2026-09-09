import { isAbsolute } from "node:path";
import type { PiboJsonObject } from "../core/events.js";
import { PrefixRecoveryRequiredError, readSessionPrefixBinding, type SessionPrefixBinding } from "./prefix-capsule.js";
import { readPrefixTransition, type PrefixTransition } from "./prefix-transition.js";

export const PREFIX_NATIVE_CHILDREN_KEY = "piboSessionPrefixNativeChildren";
export type NativePrefixChild = { nativeSessionId: string; nativeSessionFile: string; prefix: SessionPrefixBinding; sourceNativeSessionId?: string; transition?: PrefixTransition };

/** Opaque child histories stay native-owned; only their sealed operating references live here. */
export function readNativePrefixChildren(metadata: PiboJsonObject | undefined): NativePrefixChild[] {
 const value = metadata?.[PREFIX_NATIVE_CHILDREN_KEY];
 if (value === undefined) return [];
 if (!Array.isArray(value) || value.length > 64) throw new PrefixRecoveryRequiredError("invalid native child inventory");
 const ids = new Set<string>();
 return value.map(item => {
  if (!item || typeof item !== "object" || Array.isArray(item)
   || typeof item.nativeSessionId !== "string" || !item.nativeSessionId || item.nativeSessionId.length > 1024 || ids.has(item.nativeSessionId)
   || typeof item.nativeSessionFile !== "string" || item.nativeSessionFile.length > 4096 || !isAbsolute(item.nativeSessionFile)) throw new PrefixRecoveryRequiredError("invalid native child identity or locator");
  if (item.sourceNativeSessionId !== undefined && (typeof item.sourceNativeSessionId !== "string" || !item.sourceNativeSessionId || item.sourceNativeSessionId.length > 1024 || item.sourceNativeSessionId === item.nativeSessionId)) throw new PrefixRecoveryRequiredError("invalid native child origin");
  ids.add(item.nativeSessionId);
  const prefix = readSessionPrefixBinding({ piboSessionPrefix: item.prefix });
  const transition = item.transition === undefined ? undefined : readPrefixTransition({ piboSessionPrefixTransition: item.transition });
  if (!prefix || prefix.nativeSessionId !== item.nativeSessionId
   || transition && transition.nativeSessionId !== item.nativeSessionId) throw new PrefixRecoveryRequiredError("native child prefix identity changed");
  return {nativeSessionId:item.nativeSessionId,nativeSessionFile:item.nativeSessionFile,prefix,...(typeof item.sourceNativeSessionId === "string" ? {sourceNativeSessionId:item.sourceNativeSessionId} : {}),...(transition ? {transition} : {})};
 });
}
export function withNativePrefixChild(metadata: PiboJsonObject | undefined, child: NativePrefixChild): PiboJsonObject {
 const children = readNativePrefixChildren(metadata).filter(item => item.nativeSessionId !== child.nativeSessionId);
 const result = {...metadata,[PREFIX_NATIVE_CHILDREN_KEY]:[...children,child].sort((a,b)=>a.nativeSessionId.localeCompare(b.nativeSessionId)) as unknown as PiboJsonObject[]};
 readNativePrefixChildren(result);return result;
}
