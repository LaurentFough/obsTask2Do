const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { toCalendarValue, fromCalendarValue, formatTaskDate } = require('../task-core.cjs');
test('UTC calendar fields preserve hours minutes and seconds', () => {
  const instant = '2026-10-14T16:30:45.123Z';
  assert.equal(toCalendarValue(instant, 'utc'), '2026-10-14T16:30:45');
  assert.equal(fromCalendarValue('2026-10-14T16:30:45', 'utc'), '2026-10-14T16:30:45.000Z');
  assert.equal(fromCalendarValue('2026-10-14T16:30', 'utc'), '2026-10-14T16:30:00.000Z');
});
test('calendar validation rejects overflow and incomplete dates', () => {
  for (const value of ['2026-02-30T12:00', '2026-13-01T12:00', '2026-10-14T25:00', '', 'tomorrow', '2026-10-14T12:00:61']) assert.throws(() => fromCalendarValue(value, 'utc'));
});
test('task display removes timestamp syntax and handles unknown Graph timezone fallback', () => {
  assert.match(formatTaskDate('2026-10-14T16:30:45.123Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatTaskDate(undefined, '2026-10-14T09:30:45.123 (Unknown Zone)'), '2026-10-14 09:30');
  assert.equal(formatTaskDate(undefined), 'unspecified');
});
test('local calendar conversion uses selected-date timezone and rejects DST gaps', () => {
  const modulePath = path.join(__dirname, '../task-core.cjs');
  const result = execFileSync(process.execPath, ['-e', `const { toCalendarValue, fromCalendarValue, calendarZoneLabel } = require(${JSON.stringify(modulePath)}); let gapRejected=false; try { fromCalendarValue('2026-03-08T02:30:00'); } catch { gapRejected=true; } process.stdout.write(JSON.stringify({ local:toCalendarValue('2026-10-14T16:30:45Z'), utc:fromCalendarValue('2026-10-14T09:30:45'), winter:fromCalendarValue('2026-12-14T09:30:45'), label:calendarZoneLabel('local','2026-10-14T09:30:45'), gapRejected }));`], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  const parsed = JSON.parse(result);
  assert.equal(parsed.local, '2026-10-14T09:30:45'); assert.equal(parsed.utc, '2026-10-14T16:30:45.000Z');
  assert.equal(parsed.winter, '2026-12-14T17:30:45.000Z'); assert.equal(parsed.gapRejected, true);
  assert.equal(parsed.label, 'America/Los_Angeles (UTC-07:00)');
});
