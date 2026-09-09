import {PREFIX_SETTINGS_KEY,readPrefixRuntimeSettings} from "./prefix-settings.js";
import { readNativePrefixChildren } from "./prefix-children.js";
import { DatabaseSync } from "node:sqlite";
import { lstat, opendir, realpath, unlink, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrefixMaintenanceLease } from "./prefix-maintenance.js";
import { readSessionPrefixBinding, readSessionPrefixResourceReference, PrefixRecoveryRequiredError } from "./prefix-capsule.js";
import { readPrefixResourceDependencies } from "./prefix-dependencies.js";
import { readPrefixRebaseline } from "./prefix-rebaseline.js";
import type { PiboJsonObject } from "../core/events.js";

/** Caller supplies the complete store inventory for this root; never infer it from one session. */
export async function collectUnreferencedPrefixes(input: { root: string; databases: string[]; apply?: boolean }): Promise<{ candidates: number; bytes: number; deleted: number; referenced: number }> {
 if (!input.databases.length || input.databases.length > 128) throw new PrefixRecoveryRequiredError("collection requires a complete bounded database inventory");
 const lease = await PrefixMaintenanceLease.acquire(input.root, true);
 try {
  const references = new Set<string>(); let rows = 0;
  const collect = (metadata: PiboJsonObject) => {
   if(!metadata || typeof metadata!=="object" || Array.isArray(metadata)) throw new PrefixRecoveryRequiredError("collection encountered invalid binding metadata");
   readPrefixRuntimeSettings(metadata?.[PREFIX_SETTINGS_KEY]);
   for (const ref of [readSessionPrefixBinding(metadata)?.capsule, readSessionPrefixResourceReference(metadata), ...readPrefixResourceDependencies(metadata)]) if (ref) references.add(ref.digest);
   for (const child of readNativePrefixChildren(metadata)) references.add(child.prefix.capsule.digest);
   const pending = readPrefixRebaseline(metadata);
   if (pending) collect(pending.sourceBinding.metadata!);
  };
  for (const path of [...new Set(input.databases.map(path => resolve(path)))]) {
   if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new PrefixRecoveryRequiredError("collection database is missing or a symlink");
   const db = new DatabaseSync(path, {readOnly: true});
   try {
    let recognized = false;
    for (const table of ["session_runtime_bindings", "pibo_session_runtime_bindings"]) {
     if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
     recognized = true;
     for (const row of db.prepare(`SELECT metadata_json FROM ${table}`).iterate()) {
      if (++rows > 1000000) throw new PrefixRecoveryRequiredError("collection inventory exceeds bounds");
      collect(JSON.parse(String(row.metadata_json ?? "{}")));
     }
    }
    if (!recognized) throw new PrefixRecoveryRequiredError("collection database has no recognized session inventory");
   } finally { db.close(); }
  }
  const candidates: {path: string; bytes: number; ino: number; dev: number}[] = []; let entries = 0;
  // Materialized resource directories and OS ownership inodes are deliberately
  // outside this collector. Historical messages can still refer to those paths.
  for await (const entry of await opendir(input.root)) {
   if (++entries > 100000) throw new PrefixRecoveryRequiredError("collection directory exceeds bounds");
   if (!/^[a-f0-9]{64}\.capsule$/.test(entry.name) || references.has(entry.name.slice(0,64))) continue;
   const path = join(input.root, entry.name), stat = await lstat(path);
   if (!stat.isFile() || await realpath(path) !== resolve(path)) throw new PrefixRecoveryRequiredError("collection capsule is not a regular file");
   candidates.push({path,bytes:stat.size,ino:stat.ino,dev:stat.dev});
  }
  let deleted = 0;
  if (input.apply) {
   for (const candidate of candidates) {
    const stat = await lstat(candidate.path);
    if (!stat.isFile() || stat.ino !== candidate.ino || stat.dev !== candidate.dev || stat.size !== candidate.bytes) throw new PrefixRecoveryRequiredError("collection candidate changed");
    await unlink(candidate.path); deleted++;
   }
   const directory = await open(input.root,"r"); try { await directory.sync(); } finally { await directory.close(); }
  }
  return {candidates:candidates.length,bytes:candidates.reduce((sum,item)=>sum+item.bytes,0),deleted,referenced:references.size};
 } finally { lease.release(); }
}
