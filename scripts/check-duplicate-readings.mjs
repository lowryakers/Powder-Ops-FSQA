// Maria recorded yesterday's temperature and humidity against today's task.
// Nothing caught it: today held a record with yesterday's numbers, yesterday
// held none, and the only way back was to reopen the task and re-date the
// record by hand.
//
// The pure half is asserted here. The rule is deliberately a QUESTION — a
// stable room really does read the same two mornings running — so the tests
// that matter most are the ones proving it does NOT fire.
import assert from 'node:assert/strict';
import { normalizeReadings, sameReadings, duplicateReadings } from '../server/duplicate-readings.js';

let n = 0, bad = 0;
const ok = (label, fn) => {
  n++;
  try { fn(); } catch (e) { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); return; }
  console.log(`  ok    ${label}`);
};
const prior = (readings, when = '2026-09-01') =>
  ({ id: 'wo-prior', readings, completed_at: `${when} 09:14:00`, completed_by: 'Maria' });

console.log('\nThe case this exists for');
ok('yesterday\'s readings filed against today are caught', () => {
  const d = duplicateReadings(prior({ temperature: '68', humidity: '35' }), { temperature: '68', humidity: '35' });
  assert.ok(d);
  assert.equal(d.prior_date, '2026-09-01');
  assert.match(d.message, /2026-09-01/);
});
ok('the prior record is NAMED, not just flagged', () => {
  const d = duplicateReadings(prior({ temperature: '68' }), { temperature: '68' });
  assert.equal(d.prior_work_order_id, 'wo-prior');
  assert.equal(d.prior_by, 'Maria');
});
ok('readings stored as a JSON string are read back', () => {
  assert.ok(duplicateReadings(prior('{"temperature":"68","humidity":"35"}'), { temperature: '68', humidity: '35' }));
});

console.log('\nWhat must NOT fire — this is a question, not a limit');
ok('one different value is not a duplicate', () => {
  assert.equal(duplicateReadings(prior({ temperature: '68', humidity: '35' }), { temperature: '68', humidity: '36' }), null);
});
ok('an extra reading is not a duplicate', () => {
  assert.equal(duplicateReadings(prior({ temperature: '68' }), { temperature: '68', humidity: '35' }), null);
});
ok('a missing reading is not a duplicate', () => {
  assert.equal(duplicateReadings(prior({ temperature: '68', humidity: '35' }), { temperature: '68' }), null);
});
ok('BLANK READINGS NEVER MATCH — a gap is not a repeat', () => {
  // Most tasks record no readings at all. Two empty sets matching would fire
  // on every one of them, which is how a warning becomes wallpaper.
  assert.equal(duplicateReadings(prior({}), {}), null);
  assert.equal(duplicateReadings(prior({ temperature: '' }), { temperature: '' }), null);
  assert.equal(duplicateReadings(prior({ temperature: '68' }), {}), null);
});
ok('no prior check means nothing to compare against', () => {
  assert.equal(duplicateReadings(null, { temperature: '68' }), null);
});
ok('unparseable stored readings are ignored rather than thrown on', () => {
  assert.equal(duplicateReadings(prior('not json'), { temperature: '68' }), null);
});

console.log('\nThe same number typed three ways is the same number');
ok('"68 F" and "68F" and "68" all match', () => {
  assert.deepEqual(normalizeReadings({ t: '68 F' }), { t: '68' });
  assert.ok(sameReadings({ t: '68 F' }, { t: '68' }));
  assert.ok(sameReadings({ t: ' 68F ' }, { t: '68.0' }));
});
ok('a decimal is compared as a number, not as text', () => {
  assert.ok(sameReadings({ h: '35.0' }, { h: '35' }));
  assert.equal(sameReadings({ h: '35.5' }, { h: '35' }), false);
});
ok('non-numeric text falls back to a case-insensitive compare', () => {
  assert.ok(sameReadings({ note: 'Pass' }, { note: 'pass' }));
  assert.equal(sameReadings({ note: 'Pass' }, { note: 'fail' }), false);
});
ok('a negative reading keeps its sign', () => {
  assert.deepEqual(normalizeReadings({ t: '-4 C' }), { t: '-4' });
  assert.equal(sameReadings({ t: '-4' }, { t: '4' }), false);
});

console.log('\nWording');
ok('with no date it asks a question that still makes sense', () => {
  const d = duplicateReadings({ id: 'x', readings: { t: '68' } }, { t: '68' });
  assert.ok(d);
  assert.equal(d.prior_date, null);
  assert.match(d.message, /previous check/);
  assert.doesNotMatch(d.message, /null|undefined/);
});
ok('performed_on wins over completed_at — the day it was DONE', () => {
  const d = duplicateReadings(
    { id: 'x', readings: { t: '68' }, completed_at: '2026-09-02 10:00:00', performed_on: '2026-08-30' },
    { t: '68' });
  assert.equal(d.prior_date, '2026-08-30');
});

console.log(`\n${n - bad}/${n} assertions passed`);
process.exit(bad ? 1 : 0);
