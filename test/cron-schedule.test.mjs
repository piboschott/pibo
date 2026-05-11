import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeNextRunAt, parseFriendlySchedule } from '../dist/cron/schedule.js';

test('cron expression schedules the next quarter-hour tick', () => {
  const next = computeNextRunAt(
    { kind: 'cron', expr: '*/15 * * * *' },
    new Date('2026-05-09T08:01:30.000Z'),
  );

  assert.equal(next?.toISOString(), '2026-05-09T08:15:00.000Z');
});

test('cron expression treats weekday 7 as Sunday', () => {
  const next = computeNextRunAt(
    { kind: 'cron', expr: '0 8 * * 7' },
    new Date('2026-05-09T08:01:00.000Z'),
  );

  assert.equal(next?.toISOString(), '2026-05-10T08:00:00.000Z');
});

test('cron expression supports ranges with steps', () => {
  const next = computeNextRunAt(
    { kind: 'cron', expr: '10-20/5 8 * * 1-5' },
    new Date('2026-05-11T08:09:00.000Z'),
  );

  assert.equal(next?.toISOString(), '2026-05-11T08:10:00.000Z');
});

test('cron expression honors the configured timezone', () => {
  const next = computeNextRunAt(
    { kind: 'cron', expr: '30 8 * * *', tz: 'Europe/Berlin' },
    new Date('2026-05-09T05:00:00.000Z'),
  );

  assert.equal(next?.toISOString(), '2026-05-09T06:30:00.000Z');
});

test('friendly schedule validation rejects invalid times and durations', () => {
  assert.throws(
    () => parseFriendlySchedule({ kind: 'daily', time: '24:00' }),
    /Time is out of range/,
  );
  assert.throws(
    () => parseFriendlySchedule({ kind: 'every', value: '0m' }),
    /Duration must be at least one minute/,
  );
});

test('cron validation rejects invalid steps and timezones', () => {
  assert.throws(
    () => computeNextRunAt({ kind: 'cron', expr: '*/0 * * * *' }),
    /Invalid minute step/,
  );
  assert.throws(
    () => computeNextRunAt({ kind: 'cron', expr: '0 8 * * *', tz: 'Nope\/Zone' }),
    /Invalid timezone: Nope\/Zone/,
  );
});
