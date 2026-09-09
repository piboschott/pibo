import { readNativePrefixChildren } from "../sessions/prefix-children.js";
import { PrefixMaintenanceLease } from "../sessions/prefix-maintenance.js";
import { DatabaseSync, backup } from "node:sqlite";
import { constants, createReadStream } from "node:fs";
import { copyFile, open, readFile, realpath, rename, lstat, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ensureDurableDirectory, PrefixCapsuleStore, readSessionPrefixBinding, readSessionPrefixResourceReference } from "../sessions/prefix-capsule.js";
import { readPrefixTransition } from "../sessions/prefix-transition.js";
import { readPrefixRebaseline } from "../sessions/prefix-rebaseline.js";
import { readPrefixResourceDependencies, readPrefixArtifactDependencies, nativeArtifactDirectories } from "../sessions/prefix-dependencies.js";
import { PrefixSessionOwnership } from "../sessions/prefix-ownership.js";
import type { PiboJsonObject } from "../core/events.js";

type Binding = { pibo_session_id: string; runtime_adapter_id: string; native_session_id: string | null; locator_json: string | null; metadata_json: string; revision: number };
type ArchiveFile = { path: string; bytes: number; sha256: string };
export type PrefixBackup = { format: 1; home: string; files: ArchiveFile[]; bytes: number; sessions: number };
const INDEX = "runtime-prefixes.json";
const MAX_FILES = 100000;

function bindings(database: string): Binding[] {
	const db = new DatabaseSync(database, { readOnly: true });
	try {
		const rows: Binding[] = [];
		for (const table of ["session_runtime_bindings", "pibo_session_runtime_bindings"]) {
			if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
			for (const row of db.prepare(`SELECT pibo_session_id,runtime_adapter_id,native_session_id,locator_json,metadata_json,revision FROM ${table} ORDER BY pibo_session_id`).iterate() as Iterable<Binding>) {
				const metadata = JSON.parse(row.metadata_json) as PiboJsonObject;
				if (readNativePrefixChildren(metadata).length || readPrefixArtifactDependencies(metadata).length || readPrefixResourceDependencies(metadata).length || readSessionPrefixBinding(metadata) || readSessionPrefixResourceReference(metadata) || readPrefixTransition(metadata) || readPrefixRebaseline(metadata)) rows.push(row);
				if (rows.length > MAX_FILES) throw Error("Protected session backup exceeds count quota");
			}
		}
		return rows;
	} finally { db.close(); }
}
function referencedBindings(rows: Binding[]): Binding[] {
 let total = 0;
	return rows.flatMap(row => {
		const source = readPrefixRebaseline(JSON.parse(row.metadata_json))?.sourceBinding;
		const children = readNativePrefixChildren(JSON.parse(row.metadata_json)).map(child => ({
   pibo_session_id:row.pibo_session_id,runtime_adapter_id:child.prefix.capsule.adapterId,native_session_id:child.nativeSessionId,locator_json:null,
   metadata_json:JSON.stringify({piboSessionPrefix:child.prefix,nativeSessionFile:child.nativeSessionFile}),revision:row.revision
  }));
  const sourceChildren = source ? readNativePrefixChildren(source.metadata).map(child => ({
   pibo_session_id:row.pibo_session_id,runtime_adapter_id:child.prefix.capsule.adapterId,native_session_id:child.nativeSessionId,locator_json:null,
   metadata_json:JSON.stringify({piboSessionPrefix:child.prefix,nativeSessionFile:child.nativeSessionFile}),revision:row.revision
  })) : [];
		total += 1 + children.length + sourceChildren.length + Number(Boolean(source));
  if (total > MAX_FILES) throw Error("Protected native reference inventory exceeds count quota");
		return source ? [row, ...children, ...sourceChildren, { pibo_session_id: source.piboSessionId, runtime_adapter_id: source.adapterId,
			native_session_id: source.nativeSessionId ?? null, locator_json: source.locator ? JSON.stringify(source.locator) : null,
			metadata_json: JSON.stringify(source.metadata ?? {}), revision: source.revision! }] : [row,...children];
	});
}
function child(home: string, path: string): string {
	const name = relative(home, resolve(path));
	if (!name || name === ".." || name.startsWith("../") || isAbsolute(name) || name.includes("\\")) throw Error("Protected runtime file is outside the backup home");
	return name;
}
function archivePath(root: string, path: string): string {
	if (isAbsolute(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw Error("Invalid protected runtime archive path");
	return join(root, "runtime", path);
}
async function sync(path: string): Promise<void> {
	const file = await open(path, "r"); try { await file.sync(); } finally { await file.close(); }
}
async function hash(path: string, maximum: number, signal?: AbortSignal): Promise<{bytes: number; sha256: string}> {
	if (await realpath(path) !== resolve(path)) throw Error("Protected runtime archive contains a symlink");
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > maximum) throw Error("Protected runtime backup byte quota exceeded");
		const digest = createHash("sha256"); let bytes = 0;
		for await (const chunk of createReadStream(path, { fd: handle.fd, autoClose: false, signal })) {
			bytes += chunk.length; if (bytes > maximum) throw Error("Protected runtime backup byte quota exceeded"); digest.update(chunk);
		}
		if (bytes !== stat.size) throw Error("Protected runtime changed during backup");
		return { bytes, sha256: digest.digest("hex") };
	} finally { await handle.close(); }
}

/** Hold the same OS ownership as every protected runtime across the database cut. */
export async function ownPrefixBackup(source: string, home: string): Promise<{ release(): void; rows: Binding[] }> {
	const rows = bindings(source);
	if (!rows.length) return { rows, release() {} };
	const maintenance = await PrefixMaintenanceLease.acquire(join(home, "session-prefixes"));
	let owner: PrefixSessionOwnership;
	try { owner = await PrefixSessionOwnership.acquire(join(home, "session-prefixes"), referencedBindings(rows).flatMap(row => [
		JSON.stringify(["pibo", row.pibo_session_id]),
		...(row.native_session_id ? [JSON.stringify(["native", row.runtime_adapter_id, row.native_session_id])] : []),
	])); } catch (error) { maintenance.release(); throw error; }
	try {
		if (JSON.stringify(bindings(source)) !== JSON.stringify(rows)) throw Error("Protected bindings changed while acquiring backup ownership");
		return { rows, release: () => { owner.release(); maintenance.release(); } };
	} catch (error) { owner.release(); maintenance.release(); throw error; }
}

/** Called before payload copying, while the source runtime ownership remains held. */
export async function capturePrefixBackup(input: { root: string; database: string; home: string; rows: Binding[]; maximum: number; signal?: AbortSignal }): Promise<PrefixBackup | undefined> {
	const rows = bindings(input.database);
	if (JSON.stringify(rows) !== JSON.stringify(input.rows)) throw Error("Protected database cut does not match runtime ownership; create a fresh backup");
	if (!rows.length) return undefined;
	const paths = new Map<string, boolean>();
	const capsules = new PrefixCapsuleStore(join(input.home, "session-prefixes"));
	for (const row of referencedBindings(rows)) {
		const metadata = JSON.parse(row.metadata_json) as PiboJsonObject;
		const prefix = readSessionPrefixBinding(metadata);
		const resources = readSessionPrefixResourceReference(metadata);
		for (const reference of [prefix?.capsule, resources, ...readPrefixResourceDependencies(metadata)]) if (reference) {
			await capsules.read(reference, reference);
			paths.set(join(capsules.root, `${reference.digest}.capsule`), false);
		}
		const locator = row.locator_json ? JSON.parse(row.locator_json) : undefined;
		const native = typeof metadata.nativeSessionFile === "string" ? metadata.nativeSessionFile : locator?.kind === "local-file" ? locator.value : undefined;
		// A reserved replacement ID has no native file until the runtime publishes
		// its locator; the rollback transcript is retained independently above.
		if (!prefix && !(readPrefixRebaseline(metadata) && native !== undefined)) continue;
		if (prefix && prefix.nativeSessionId !== row.native_session_id) throw Error("Protected native identity is inconsistent");
		if (typeof native !== "string" || !isAbsolute(native)) throw Error("Protected native session file is missing from its binding");
		child(resolve(input.home), native);
		if (await realpath(native) !== resolve(native)) throw Error("Protected native file contains a symlink");
		const file = await open(native, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const header = Buffer.alloc(16);
		try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
		paths.set(native, header.toString() === "SQLite format 3\0");
	}

 // Traverse only native-owned artifact roots, never a runtime/authentication home.
 let artifactEntries = 0;
 for (const row of referencedBindings(rows)) {
  const metadata = JSON.parse(row.metadata_json) as PiboJsonObject;
  const locator = row.locator_json ? JSON.parse(row.locator_json) : undefined;
  const native = typeof metadata.nativeSessionFile === "string" ? metadata.nativeSessionFile : locator?.kind === "local-file" ? locator.value : undefined;
  for (const directory of nativeArtifactDirectories(row.runtime_adapter_id, native, metadata)) {
   child(resolve(input.home), directory);
   const visit = async (path: string, depth: number): Promise<void> => {
    input.signal?.throwIfAborted();
    if (++artifactEntries > MAX_FILES || depth > 64 || paths.size >= MAX_FILES) throw Error("Protected native artifacts exceed count quota");
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw Error("Protected native artifact contains a symlink");
    if (stat.isDirectory()) {
     for await (const entry of await opendir(path)) await visit(join(path, entry.name), depth + 1);
    } else if (stat.isFile()) paths.set(path, false);
    else throw Error("Protected native artifact is not a regular file");
   };
   try { await lstat(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
   }
   await visit(directory, 0);
  }
 }
	if (paths.size > MAX_FILES) throw Error("Protected runtime backup exceeds count quota");
	const result: PrefixBackup = { format: 1, home: resolve(input.home), files: [], bytes: 0, sessions: rows.length };
	for (const [source, sqlite] of [...paths].sort(([a], [b]) => a.localeCompare(b))) {
		input.signal?.throwIfAborted();
		if (await realpath(source) !== resolve(source)) throw Error("Protected runtime backup source contains a symlink");
		const path = child(result.home, source), target = archivePath(input.root, path), temporary = target + ".partial";
		await ensureDurableDirectory(dirname(target));
		if (await realpath(dirname(target)) !== resolve(dirname(target))) throw Error("Protected runtime archive contains a symlink");
		await hash(source, input.maximum - result.bytes, input.signal);
		if (sqlite) {
			const db = new DatabaseSync(source, { readOnly: true });
			try {
				const pageSize = Number(db.prepare("PRAGMA page_size").get()!.page_size);
				await backup(db, temporary, { rate: 128, progress: ({totalPages}) => {
					input.signal?.throwIfAborted();
					if (totalPages * pageSize > input.maximum - result.bytes) throw Error("Protected runtime backup byte quota exceeded");
				} });
			}
			finally { db.close(); }
		} else await copyFile(source, temporary);
		const handle = await open(temporary, "r"); try { await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
		await rename(temporary, target); await sync(dirname(target));
		const digest = await hash(target, input.maximum - result.bytes, input.signal);
		result.files.push({ path, ...digest }); result.bytes += digest.bytes;
	}
	const file = await open(join(input.root, INDEX + ".partial"), "w", 0o600);
	try { await file.writeFile(JSON.stringify(result)); await file.sync(); } finally { await file.close(); }
	await rename(join(input.root, INDEX + ".partial"), join(input.root, INDEX)); await sync(input.root);
	return result;
}

export async function verifyPrefixBackup(root: string, database: string, maximum: number, expectedHash?: string, signal?: AbortSignal): Promise<PrefixBackup | undefined> {
	const rows = bindings(database);
	if (!rows.length && expectedHash === undefined) return undefined;
	if (!expectedHash) throw Error("Backup omits protected runtime state");
	const index = join(root, INDEX);
	if ((await hash(index, 32 * 1024 * 1024, signal)).sha256 !== expectedHash) throw Error("Protected runtime catalog hash mismatch");
	const value = JSON.parse(await readFile(index, "utf8")) as PrefixBackup;
	if (value.format !== 1 || typeof value.home !== "string" || !isAbsolute(value.home) || !Array.isArray(value.files) || value.files.length > MAX_FILES || value.sessions !== rows.length) throw Error("Invalid protected runtime catalog");
	let bytes = 0; const paths = new Set<string>();
	for (const entry of value.files) {
		if (typeof entry.path !== "string" || paths.has(entry.path)) throw Error("Invalid protected runtime catalog entry");
		paths.add(entry.path);
		const digest = await hash(archivePath(root, entry.path), maximum - bytes, signal);
		if (digest.bytes !== entry.bytes || digest.sha256 !== entry.sha256) throw Error("Protected runtime archive hash mismatch");
		bytes += digest.bytes;
	}
	const store = new PrefixCapsuleStore(join(root, "runtime", "session-prefixes"));
	for (const row of referencedBindings(rows)) {
		const metadata = JSON.parse(row.metadata_json) as PiboJsonObject;
		const prefix = readSessionPrefixBinding(metadata), resources = readSessionPrefixResourceReference(metadata);
		for (const ref of [prefix?.capsule, resources, ...readPrefixResourceDependencies(metadata)]) if (ref) {
			if (!paths.has(`session-prefixes/${ref.digest}.capsule`)) throw Error("Protected capsule missing from archive catalog");
			await store.read(ref, ref);
		}
		const locator = row.locator_json ? JSON.parse(row.locator_json) : undefined;
		const native = typeof metadata.nativeSessionFile === "string" ? metadata.nativeSessionFile : locator?.kind === "local-file" ? locator.value : undefined;
		if (prefix || readPrefixRebaseline(metadata) && native !== undefined) {
			if (typeof native !== "string" || !paths.has(child(value.home, native))) throw Error("Protected native history missing from archive catalog");
		}
	}
	if (bytes !== value.bytes) throw Error("Protected runtime archive size mismatch");
	return value;
}
export async function prefixBackupCatalogHash(root: string): Promise<string> { return (await hash(join(root, INDEX), 32 * 1024 * 1024)).sha256; }

/** Immutable prompts contain absolute resource paths: relocation is never implicit. */
export async function restorePrefixBackup(root: string, destination: string, archive: PrefixBackup, signal?: AbortSignal): Promise<void> {
	if (resolve(destination) !== archive.home) throw Error("Protected runtime restore requires its original home path; use the same filesystem layout");
	for (const entry of archive.files) {
		signal?.throwIfAborted();
		const target = join(destination, entry.path);
		await ensureDurableDirectory(dirname(target));
		if (await realpath(dirname(target)) !== resolve(dirname(target))) throw Error("Protected runtime archive contains a symlink");
		await copyFile(archivePath(root, entry.path), target, constants.COPYFILE_EXCL); await sync(target); await sync(dirname(target));
	}
}
