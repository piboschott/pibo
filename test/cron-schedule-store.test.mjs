import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeNextRunAt, parseFriendlySchedule } from '../dist/cron/schedule.js';
import { PiboCronStore } from '../dist/cron/store.js';

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
