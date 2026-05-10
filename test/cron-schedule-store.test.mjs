import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { computeNextRunAt, parseFriendlySchedule } from '../dist/cron/schedule.js';
import { PiboCronStore } from '../dist/cron/store.js';

const execFileAsync = promisify(execFile);
const cliPath = new URL('../dist/bin/pibo.js', import.meta.url).pathname;

test('cron at schedule returns future date once', () => {
  const now = new Date('2026-05-09T08:00:00.000Z');
  const next = computeNextRunAt({ kind: 'at', at: '2026-05-09T08:20:00.000Z' }, now);
  assert.equal(next?.toISOString(), '2026-05-09T08:20:00.000Z');
  assert.equal(computeNextRunAt({ kind: 'at', at: '2026-05-09T07:59:00.000Z' }, now), undefined);
});

test('cron every schedule computes next anchored tick', () => {
  const next = computeNextRunAt({ kind: 'every', everyMs: 2 * 60 * 60 * 1000, anchorMs: Date.parse('2026-05-09T00:00:00.000Z') }, new Date('2026-05-09T03:01:00.000Z'));
  assert.equal(next?.toISOString(), '2026-05-09T04:00:00.000Z');
});

test('friendly daily schedule becomes cron expression', () => {
  const { schedule } = parseFriendlySchedule({ kind: 'daily', time: '08:30', tz: 'UTC' }, new Date('2026-05-09T00:00:00.000Z'));
  assert.deepEqual(schedule, { kind: 'cron', expr: '30 8 * * *', tz: 'UTC' });
});

test('cron store persists, filters owner scope, and reserves a due run once', () => {
  const store = new PiboCronStore({ path: ':memory:' });
  const now = new Date('2026-05-09T08:00:00.000Z');
  const job = store.createJob({
    ownerScope: 'user:a',
    target: { kind: 'personal', principalId: 'user:a' },
    profile: 'default',
    prompt: 'do it',
    schedule: { kind: 'at', at: '2026-05-09T08:01:00.000Z' },
  }, now);
  assert.equal(store.listJobs({ ownerScope: 'user:b', includeDisabled: true }).length, 0);
  assert.equal(store.reserveDueRuns(10, now).length, 0);
  const due = store.reserveDueRuns(10, new Date('2026-05-09T08:02:00.000Z'));
  assert.equal(due.length, 1);
  assert.equal(due[0].job.id, job.id);
  assert.equal(store.reserveDueRuns(10, new Date('2026-05-09T08:02:00.000Z')).length, 0);
  store.completeRun({ jobId: job.id, runId: due[0].run.id, status: 'ok', piboSessionId: 'ps_test' }, new Date('2026-05-09T08:03:00.000Z'));
  const updated = store.getJob(job.id);
  assert.equal(updated.enabled, false);
  assert.equal(updated.state.lastPiboSessionId, 'ps_test');
  store.close();
});

test('cron CLI requires explicit owner scope for job creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    await assert.rejects(
      execFileAsync('node', [cliPath, 'cron', '--store', storePath, 'add', '--personal', '--daily', '09:10', '--prompt', 'do it'], {
        env: { ...process.env, PIBO_OWNER_SCOPE: 'user:env-fallback' },
      }),
      /--owner-scope is required for cron operations/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cron CLI uses explicit owner scope as personal target default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    const result = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'add',
      '--personal',
      '--daily',
      '09:10',
      '--prompt',
      'do it',
      '--json',
    ]);
    const job = JSON.parse(result.stdout);
    assert.equal(job.ownerScope, 'user:test');
    assert.deepEqual(job.target, { kind: 'personal', principalId: 'user:test' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cron CLI edits prompt, target, profile, and schedule', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    const added = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'add',
      '--personal',
      '--daily',
      '09:10',
      '--prompt',
      'old prompt',
      '--json',
    ]);
    const original = JSON.parse(added.stdout);
    const edited = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'edit',
      original.id,
      '--room',
      'room_123',
      '--every',
      '2h',
      '--agent',
      'agent-x',
      '--prompt',
      'new prompt',
      '--name',
      'new name',
      '--delete-after-run',
      '--json',
    ]);
    const job = JSON.parse(edited.stdout);
    assert.equal(job.id, original.id);
    assert.equal(job.name, 'new name');
    assert.equal(job.prompt, 'new prompt');
    assert.equal(job.profile, 'agent-x');
    assert.deepEqual(job.target, { kind: 'room', roomId: 'room_123' });
    assert.equal(job.schedule.kind, 'every');
    assert.equal(job.schedule.everyMs, 2 * 60 * 60 * 1000);
    assert.equal(job.deleteAfterRun, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
