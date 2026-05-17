import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { piboHomePath } from '../core/pibo-home.js';
import type { PiboRalphJob, PiboRalphJobCreateInput, PiboRalphJobPatchInput, PiboRalphJobState, PiboRalphRun, PiboRalphRunStatus } from './types.js';

export type PiboRalphStoreOptions = { path?: string };

type RalphJobRow = { id: string; owner_scope: string; name: string; description: string | null; enabled: number; target_json: string; profile: string; prompt: string; max_iterations: number | null; story_stop_paths_json: string | null; state_json: string; created_at: string; updated_at: string };
type RalphRunRow = { id: string; job_id: string; owner_scope: string; pibo_session_id: string | null; status: PiboRalphRunStatus; reason: string | null; error: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string };

function nowIso(now = new Date()): string { return now.toISOString(); }
function parseJson<T>(json: string): T { return JSON.parse(json) as T; }
function defaultName(prompt: string): string { const normalized = prompt.replace(/\s+/g, ' ').trim(); return normalized ? normalized.slice(0, 80) : 'Ralph job'; }

function jobFromRow(row: RalphJobRow): PiboRalphJob {
	return { id: row.id, ownerScope: row.owner_scope, name: row.name, description: row.description ?? undefined, enabled: row.enabled === 1, target: parseJson(row.target_json), profile: row.profile, prompt: row.prompt, maxIterations: row.max_iterations ?? undefined, storyStopPaths: row.story_stop_paths_json ? parseJson(row.story_stop_paths_json) : undefined, state: parseJson(row.state_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function runFromRow(row: RalphRunRow): PiboRalphRun {
	return { id: row.id, jobId: row.job_id, ownerScope: row.owner_scope, piboSessionId: row.pibo_session_id ?? undefined, status: row.status, reason: row.reason ?? undefined, error: row.error ?? undefined, startedAt: row.started_at ?? undefined, completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}
function normalizeMaxIterations(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new Error('maxIterations must be a positive integer');
	return value;
}

function normalizeStoryStopPaths(value: string[] | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error('storyStopPaths must be an array of paths');
	const paths = Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
	if (paths.length === 0) return undefined;
	for (const path of paths) validateStoryStopFile(path);
	return paths;
}
function requireString(value: unknown, field: string): void { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`); }
function validateStringArray(value: unknown, field: string): void { if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${field} must be a non-empty string array`); }
function validateStoryStopFile(path: string): void {
	let parsed: unknown;
	try { parsed = JSON.parse(readFileSync(resolve(path), 'utf8')); } catch (error) { throw new Error(`Invalid Ralph story stop file ${path}: ${error instanceof Error ? error.message : String(error)}`); }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid Ralph story stop file ${path}: root must be an object`);
	const root = parsed as Record<string, unknown>;
	requireString(root.project, `${path}.project`); requireString(root.branchName, `${path}.branchName`); requireString(root.description, `${path}.description`);
	if (!Array.isArray(root.userStories) || root.userStories.length === 0) throw new Error(`${path}.userStories must be a non-empty array`);
	root.userStories.forEach((story, index) => {
		if (!story || typeof story !== 'object' || Array.isArray(story)) throw new Error(`${path}.userStories[${index}] must be an object`);
		const item = story as Record<string, unknown>;
		requireString(item.id, `${path}.userStories[${index}].id`); requireString(item.title, `${path}.userStories[${index}].title`); requireString(item.description, `${path}.userStories[${index}].description`);
		validateStringArray(item.acceptanceCriteria, `${path}.userStories[${index}].acceptanceCriteria`);
		if (typeof item.priority !== 'number' || !Number.isInteger(item.priority)) throw new Error(`${path}.userStories[${index}].priority must be an integer`);
		if (typeof item.passes !== 'boolean') throw new Error(`${path}.userStories[${index}].passes must be a boolean`);
		if (typeof item.notes !== 'string') throw new Error(`${path}.userStories[${index}].notes must be a string`);
	});
}
function storyStopFilesPass(paths: string[] | undefined): boolean {
	if (!paths?.length) return false;
	for (const path of paths) {
		validateStoryStopFile(path);
		const root = JSON.parse(readFileSync(resolve(path), 'utf8')) as { userStories: Array<{ passes: boolean }> };
		if (root.userStories.some((story) => story.passes !== true)) return false;
	}
	return true;
}
function validateJobInput(input: Pick<PiboRalphJobCreateInput, 'ownerScope' | 'target' | 'profile' | 'prompt' | 'maxIterations' | 'storyStopPaths'>): void {
	if (!input.ownerScope.trim()) throw new Error('ownerScope is required');
	if (!input.profile.trim()) throw new Error('profile is required');
	if (!input.prompt.trim()) throw new Error('prompt is required');
	if (input.target.kind === 'room' && !input.target.roomId.trim()) throw new Error('target.roomId is required');
	if (input.target.kind === 'personal' && !input.target.principalId.trim()) throw new Error('target.principalId is required');
	normalizeMaxIterations(input.maxIterations);
	normalizeStoryStopPaths(input.storyStopPaths);
}

export class PiboRalphStore {
	private readonly db: DatabaseSync;
	constructor(options: PiboRalphStoreOptions = {}) {
		const dbPath = options.path ?? piboHomePath('pibo-ralph.sqlite');
		const resolved = dbPath === ':memory:' ? dbPath : resolve(dbPath);
		if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true });
		this.db = new DatabaseSync(resolved);
		this.db.exec('PRAGMA busy_timeout = 5000');
		this.db.exec('PRAGMA foreign_keys = ON');
		if (resolved !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
		this.applySchema();
	}
	close(): void { this.db.close(); }
	createJob(input: PiboRalphJobCreateInput, now = new Date()): PiboRalphJob {
		validateJobInput(input);
		const timestamp = nowIso(now);
		const job: PiboRalphJob = { id: `ralph_${randomUUID()}`, ownerScope: input.ownerScope, name: (input.name ?? defaultName(input.prompt)).trim(), description: input.description?.trim() || undefined, enabled: input.enabled === true, target: input.target, profile: input.profile, prompt: input.prompt, maxIterations: normalizeMaxIterations(input.maxIterations), storyStopPaths: normalizeStoryStopPaths(input.storyStopPaths), state: { completedIterations: 0 }, createdAt: timestamp, updatedAt: timestamp };
		this.insertJob(job);
		return this.getJob(job.id)!;
	}
	getJob(id: string): PiboRalphJob | undefined { const row = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE id = ?').get(id) as RalphJobRow | undefined; return row ? jobFromRow(row) : undefined; }
	getOwnedJob(ownerScope: string, id: string): PiboRalphJob | undefined { const row = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE id = ? AND owner_scope = ?').get(id, ownerScope) as RalphJobRow | undefined; return row ? jobFromRow(row) : undefined; }
	listJobs(input: { ownerScope?: string; includeDisabled?: boolean } = {}): PiboRalphJob[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.ownerScope) { clauses.push('owner_scope = ?'); values.push(input.ownerScope); }
		if (!input.includeDisabled) clauses.push('enabled = 1');
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_jobs ${where} ORDER BY updated_at DESC, id ASC`).all(...values) as RalphJobRow[]).map(jobFromRow);
	}
	updateJob(ownerScope: string, id: string, patch: PiboRalphJobPatchInput, now = new Date()): PiboRalphJob | undefined {
		const existing = this.getOwnedJob(ownerScope, id); if (!existing) return undefined;
		const next: PiboRalphJob = { ...existing, ...patch, name: patch.name !== undefined ? patch.name.trim() : existing.name, description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description, enabled: patch.enabled ?? existing.enabled, target: patch.target ?? existing.target, profile: patch.profile ?? existing.profile, prompt: patch.prompt ?? existing.prompt, maxIterations: patch.maxIterations === undefined ? existing.maxIterations : normalizeMaxIterations(patch.maxIterations), storyStopPaths: patch.storyStopPaths === undefined ? existing.storyStopPaths : normalizeStoryStopPaths(patch.storyStopPaths), updatedAt: nowIso(now) };
		validateJobInput(next); this.writeJob(next); return this.getJob(id);
	}
	removeJob(ownerScope: string, id: string): boolean { const result = this.db.prepare('DELETE FROM pibo_ralph_jobs WHERE id = ? AND owner_scope = ?').run(id, ownerScope); return Number(result.changes ?? 0) > 0; }
	listRuns(input: { ownerScope?: string; jobId?: string; limit?: number } = {}): PiboRalphRun[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.ownerScope) { clauses.push('owner_scope = ?'); values.push(input.ownerScope); }
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as RalphRunRow[]).map(runFromRow);
	}
	reserveRun(ownerScope: string, id: string, now = new Date()): { job: PiboRalphJob; run: PiboRalphRun } | undefined { this.updateJob(ownerScope, id, { enabled: true }, now); return this.reserveJob(id, now); }
	reserveDueRuns(limit: number, now = new Date()): Array<{ job: PiboRalphJob; run: PiboRalphRun }> {
		const rows = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE enabled = 1 ORDER BY updated_at ASC').all() as RalphJobRow[];
		const result: Array<{ job: PiboRalphJob; run: PiboRalphRun }> = [];
		for (const row of rows) { if (result.length >= limit) break; const reserved = this.reserveJob(row.id, now); if (reserved) result.push(reserved); }
		return result;
	}
	attachRunSession(jobId: string, runId: string, piboSessionId: string, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(jobId); if (!job) return;
		this.db.prepare('UPDATE pibo_ralph_runs SET pibo_session_id = ?, updated_at = ? WHERE id = ?').run(piboSessionId, timestamp, runId);
		this.updateJobStateLocked(jobId, { ...job.state, lastPiboSessionId: piboSessionId }, timestamp);
	}
	requestStop(ownerScope: string, id: string, now = new Date()): PiboRalphJob | undefined {
		const job = this.getOwnedJob(ownerScope, id); if (!job) return undefined;
		const state = { ...job.state, stopRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	requestCancel(ownerScope: string, id: string, now = new Date()): PiboRalphJob | undefined {
		const job = this.getOwnedJob(ownerScope, id); if (!job) return undefined;
		const state = { ...job.state, stopRequestedAt: nowIso(now), cancelRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	completeRun(input: { jobId: string; runId: string; status: PiboRalphRunStatus; piboSessionId?: string; error?: string; reason?: string }, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(input.jobId); if (!job) return;
		const completedIterations = (job.state.completedIterations ?? 0) + (input.status === 'ok' ? 1 : 0);
		const reachedMaxIterations = job.maxIterations !== undefined && completedIterations >= job.maxIterations;
		const reachedStoryStop = input.status === 'ok' && storyStopFilesPass(job.storyStopPaths);
		const state: PiboRalphJobState = { ...job.state, runningAt: undefined, completedIterations, lastRunAt: timestamp, lastRunId: input.runId, lastStatus: input.status === 'error' ? 'error' : input.status === 'cancelled' ? 'cancelled' : 'ok', lastError: input.error, lastPiboSessionId: input.piboSessionId ?? job.state.lastPiboSessionId, consecutiveErrors: input.status === 'error' ? (job.state.consecutiveErrors ?? 0) + 1 : 0 };
		this.db.prepare('UPDATE pibo_ralph_runs SET status = ?, pibo_session_id = ?, reason = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(input.status, input.piboSessionId ?? null, input.reason ?? null, input.error ?? null, timestamp, timestamp, input.runId);
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(reachedMaxIterations || reachedStoryStop ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
	}
	recoverInterruptedRuns(cutoff = new Date(Date.now() - 5 * 60_000)): number { const cutoffIso = nowIso(cutoff); const rows = this.db.prepare("SELECT * FROM pibo_ralph_jobs WHERE json_extract(state_json, '$.runningAt') IS NOT NULL").all() as RalphJobRow[]; let recovered = 0; for (const row of rows) { const job = jobFromRow(row); if (!job.state.runningAt || job.state.runningAt > cutoffIso) continue; if (job.state.lastRunId) this.completeRun({ jobId: job.id, runId: job.state.lastRunId, status: 'error', error: 'Ralph run was interrupted by gateway restart', reason: 'interrupted' }); recovered += 1; } return recovered; }
	status(): { jobs: number; running: number } { const jobs = this.listJobs({ includeDisabled: false }); return { jobs: jobs.length, running: jobs.filter((job) => job.state.runningAt).length }; }
	private reserveJob(id: string, now = new Date()): { job: PiboRalphJob; run: PiboRalphRun } | undefined {
		const timestamp = nowIso(now); this.db.exec('BEGIN IMMEDIATE');
		try { const job = this.getJob(id); if (!job || !job.enabled || job.state.runningAt || (job.maxIterations !== undefined && (job.state.completedIterations ?? 0) >= job.maxIterations)) { this.db.exec('COMMIT'); return undefined; } const run = this.createRunLocked(job, timestamp); const state = { ...job.state, runningAt: timestamp, lastRunAt: timestamp, lastRunId: run.id }; this.updateJobStateLocked(job.id, state, timestamp); this.db.exec('COMMIT'); return { job: { ...job, state, updatedAt: timestamp }, run }; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}
	private applySchema(): void {
		this.db.exec(`CREATE TABLE IF NOT EXISTS pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, story_stop_paths_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_jobs_owner ON pibo_ralph_jobs(owner_scope, updated_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_jobs_enabled ON pibo_ralph_jobs(enabled, updated_at DESC); CREATE TABLE IF NOT EXISTS pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_scope TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_runs_job_created ON pibo_ralph_runs(job_id, created_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_runs_owner_created ON pibo_ralph_runs(owner_scope, created_at DESC);`);
		try { this.db.exec('ALTER TABLE pibo_ralph_jobs ADD COLUMN max_iterations INTEGER'); } catch (error) { if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error; }
		try { this.db.exec('ALTER TABLE pibo_ralph_jobs ADD COLUMN story_stop_paths_json TEXT'); } catch (error) { if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error; }
	}
	private insertJob(job: PiboRalphJob): void { this.db.prepare('INSERT INTO pibo_ralph_jobs (id, owner_scope, name, description, enabled, target_json, profile, prompt, max_iterations, story_stop_paths_json, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, job.ownerScope, job.name, job.description ?? null, job.enabled ? 1 : 0, JSON.stringify(job.target), job.profile, job.prompt, job.maxIterations ?? null, job.storyStopPaths?.length ? JSON.stringify(job.storyStopPaths) : null, JSON.stringify(job.state), job.createdAt, job.updatedAt); }
	private writeJob(job: PiboRalphJob): void { this.db.prepare('UPDATE pibo_ralph_jobs SET name = ?, description = ?, enabled = ?, target_json = ?, profile = ?, prompt = ?, max_iterations = ?, story_stop_paths_json = ?, state_json = ?, updated_at = ? WHERE id = ? AND owner_scope = ?').run(job.name, job.description ?? null, job.enabled ? 1 : 0, JSON.stringify(job.target), job.profile, job.prompt, job.maxIterations ?? null, job.storyStopPaths?.length ? JSON.stringify(job.storyStopPaths) : null, JSON.stringify(job.state), job.updatedAt, job.id, job.ownerScope); }
	private updateJobStateLocked(id: string, state: PiboRalphJobState, updatedAt: string): void { this.db.prepare('UPDATE pibo_ralph_jobs SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), updatedAt, id); }
	private createRunLocked(job: PiboRalphJob, timestamp: string): PiboRalphRun { const run: PiboRalphRun = { id: `rrun_${randomUUID()}`, jobId: job.id, ownerScope: job.ownerScope, status: 'running', startedAt: timestamp, createdAt: timestamp, updatedAt: timestamp }; this.db.prepare('INSERT INTO pibo_ralph_runs (id, job_id, owner_scope, pibo_session_id, status, reason, error, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?)').run(run.id, run.jobId, run.ownerScope, run.status, run.startedAt ?? null, run.createdAt, run.updatedAt); return run; }
}
export function createDefaultPiboRalphStore(options: PiboRalphStoreOptions = {}): PiboRalphStore { return new PiboRalphStore(options); }
