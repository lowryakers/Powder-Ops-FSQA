// The anniversary rule, asserted — because "next due" is where the ratchet was.
import { isoDay, addInterval, nextReviewDue } from '../server/review-cadence.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── reading a day ──');
t('a bare date', isoDay('2026-09-03') === '2026-09-03');
t('a SQLite datetime keeps its day', isoDay('2026-09-03 12:00:00') === '2026-09-03');
t('a Date is read in UTC', isoDay(new Date(Date.UTC(2026, 8, 3, 23, 30))) === '2026-09-03');
t('garbage is null, not today', isoDay('not a date') === null && isoDay('') === null && isoDay(null) === null);

console.log('\n── the arithmetic ──');
t('a year', addInterval('2026-09-03', { months: 12 }) === '2027-09-03');
t('a quarter across a year end', addInterval('2026-11-15', { months: 3 }) === '2027-02-15');
t('month-end clamps rather than overflowing', addInterval('2026-01-31', { months: 1 }) === '2026-02-28');
t('leap year clamps to the 29th', addInterval('2027-01-31', { months: 13 }) === '2028-02-29');
t('days', addInterval('2026-12-30', { days: 3 }) === '2027-01-02');
t('an unreadable anchor yields null', addInterval('nope', { months: 1 }) === null);

console.log('\n── the rule ──');
// Reviewed 20 days EARLY, on the day the 30-day-lead task appeared: the
// anniversary must not move. This is the ratchet.
t('early: the next is measured from the DUE date',
  nextReviewDue({ due: '2026-10-01', doneOn: '2026-09-11', months: 12 }) === '2027-10-01');
t('early, and it stays put over three cycles',
  (() => {
    let due = '2026-10-01';
    for (let i = 0; i < 3; i++) due = nextReviewDue({ due, doneOn: addInterval(due, { days: -20 }), months: 12 });
    return due === '2029-10-01';
  })());
t('on the day: same answer either way',
  nextReviewDue({ due: '2026-10-01', doneOn: '2026-10-01', months: 12 }) === '2027-10-01');
// Reviewed 14 months LATE: measuring from the old due date would produce a
// next-due already two months in the past and a second task the same morning.
t('late: the next is measured from the day it was DONE',
  nextReviewDue({ due: '2025-07-01', doneOn: '2026-09-03', months: 12 }) === '2027-09-03');
t('never scheduled: from the day it was done',
  nextReviewDue({ due: null, doneOn: '2026-09-03', months: 12 }) === '2027-09-03');
t('no done day means today',
  nextReviewDue({ due: null, months: 12 }) === addInterval(new Date().toISOString().slice(0, 10), { months: 12 }));
t('a daily checklist advances one day from the instance that was due',
  nextReviewDue({ due: '2026-08-29', doneOn: '2026-08-29', days: 1 }) === '2026-08-30');

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
