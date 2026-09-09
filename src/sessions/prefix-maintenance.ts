import { DatabaseSync } from "node:sqlite";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import { ensureDurableDirectory, PrefixRecoveryRequiredError } from "./prefix-capsule.js";

/** Cold publication/collection gate. Shared publishers span artifact write and binding CAS. */
export class PrefixMaintenanceLease {
 private constructor(private database?: DatabaseSync) {}
 static async acquire(root: string, exclusive = false): Promise<PrefixMaintenanceLease> {
  const directory = join(root, "ownership");
  await ensureDurableDirectory(directory);
  const path = join(directory, "maintenance.sqlite");
  try { const file = await open(path, "wx", 0o600); await file.close(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!(await lstat(path)).isFile()) throw new PrefixRecoveryRequiredError("maintenance lock file changed");
  const database = new DatabaseSync(path);
  try {
   database.exec("PRAGMA busy_timeout=0");
   if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gate'").get()) {
    database.exec("BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS gate(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO gate VALUES(1); COMMIT");
   }
   database.exec(exclusive ? "BEGIN EXCLUSIVE; SELECT id FROM gate" : "BEGIN; SELECT id FROM gate");
   return new PrefixMaintenanceLease(database);
  } catch {
   database.close();
   throw new PrefixRecoveryRequiredError("prefix maintenance is busy; retry after current publication or collection");
  }
 }
 release(): void { this.database?.close(); this.database = undefined; }
}
export async function withPrefixPublication<T>(root: string, operation: () => Promise<T>): Promise<T> {
 const lease = await PrefixMaintenanceLease.acquire(root);
 try { return await operation(); } finally { lease.release(); }
}
