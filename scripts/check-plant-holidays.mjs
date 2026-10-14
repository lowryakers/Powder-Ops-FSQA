// check:holidays — the plant's paid holidays, derived from rules (D-175). PURE.
import {
  holidayInstances, holidaysBetween, weekCalendar, weekSummaryLines, noticeDateFor, HOLIDAY_HOURS,
} from '../shared/plant-holidays.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const on = (y, key, ov = []) => holidayInstances(y, y, ov).find(h => h.key === key);

console.log('── the seven paid holidays and the two Monday ones, 2026 ──');
const y26 = holidayInstances(2026, 2026);
t('nine holidays a year: seven named + Memorial and Labor Day', y26.length === 9, String(y26.length));
t('Thanksgiving 2026 is the fourth Thursday: Nov 26', on(2026, 'thanksgiving').date === '2026-11-26');
t('the Friday after follows it: Nov 27', on(2026, 'day_after_thanksgiving').date === '2026-11-27');
t('Christmas Eve 2026 is Thursday Dec 24, Christmas Friday Dec 25', on(2026, 'christmas_eve').date === '2026-12-24' && on(2026, 'christmas_day').date === '2026-12-25');
t('Memorial Day 2026 is the last Monday of May (May 25) and shifts the week', on(2026, 'memorial_day').date === '2026-05-25' && on(2026, 'memorial_day').shift_week);
t('Labor Day 2026 is the first Monday of September (Sep 7) and shifts the week', on(2026, 'labor_day').date === '2026-09-07' && on(2026, 'labor_day').shift_week);
t('a paid holiday counts 8 hours', HOLIDAY_HOURS === 8);

console.log('\n── a weekend holiday is observed on the Friday before ──');
t('Independence Day 2027 is a Sunday → observed Friday Jul 2', on(2027, 'independence_day').date === '2027-07-02' && on(2027, 'independence_day').moved);
t('…NOT the federal Monday — no shift week', !on(2027, 'independence_day').shift_week);
t('Independence Day 2026 is a Saturday → Friday Jul 3', on(2026, 'independence_day').date === '2026-07-03');
t('Christmas 2027 (Saturday): Eve Thu Dec 23, Christmas Fri Dec 24 — an eve never after its day',
  on(2027, 'christmas_eve').date === '2027-12-23' && on(2027, 'christmas_day').date === '2027-12-24');
t('New Year\'s Day 2028 (Saturday) is observed Friday 31 Dec 2027, NYE Thursday 30',
  on(2028, 'new_years_day').date === '2027-12-31' && on(2027, 'new_years_eve').date === '2027-12-30');
t('…and a December range finds it although its rule-year is 2028',
  holidaysBetween('2027-12-27', '2027-12-31').map(h => h.key).join() === 'new_years_eve,new_years_day');
const days = new Set(holidayInstances(2026, 2035).filter(h => !h.cancelled).map(h => h.date));
t('no two holidays ever share a day, 2026–2035', days.size === holidayInstances(2026, 2035).length);
t('no holiday is ever observed on a weekend, 2026–2035', holidayInstances(2026, 2035).every(h => ![0, 6].includes(new Date(h.date + 'T00:00:00Z').getUTCDay())));

console.log('\n── a Monday holiday moves production to Tuesday–Friday ──');
t('Christmas Day 2028 falls on a Monday and shifts that week by the same rule', on(2028, 'christmas_day').date === '2028-12-25' && on(2028, 'christmas_day').shift_week);
const mem = weekCalendar('2027-05-31');
t('Memorial Day week: Monday closed, Tuesday–Friday production',
  mem.shift_week && mem.days[0].closed && !mem.days[0].production && [1, 2, 3, 4].every(i => mem.days[i].production));
t('…and says so in words', weekSummaryLines(mem).at(-1) === 'Production runs Tuesday–Friday this week.');
t('…in Spanish too', weekSummaryLines(mem, 'es').at(-1) === 'Esta semana la producción es de martes a viernes.');
const tg = weekCalendar('2026-11-23');
t('Thanksgiving week: Thursday and Friday closed, production Monday–Wednesday',
  !tg.shift_week && tg.days[3].closed && tg.days[4].closed && [0, 1, 2].every(i => tg.days[i].production) && tg.lost_days.join() === '3');
t('…"Production days this week: Monday, Tuesday, Wednesday."', weekSummaryLines(tg).at(-1) === 'Production days this week: Monday, Tuesday, Wednesday.');
const plain = weekCalendar('2026-10-12');
t('an ordinary week changes nothing: production Monday–Thursday, Friday off production',
  !plain.changed && [0, 1, 2, 3].every(i => plain.days[i].production) && !plain.days[4].production && weekSummaryLines(plain).length === 0);
const fri = weekCalendar('2026-12-28');
t('a FRIDAY holiday (New Year\'s Day 2027) still shows; only New Year\'s Eve (Thursday) costs a production day', fri.days[4].closed && fri.lost_days.length === 1 && fri.lost_days[0] === 3,
  JSON.stringify(fri.lost_days));

console.log('\n── one year corrected, never the rule ──');
const ov = [{ holiday_key: 'memorial_day', year: 2027, shift_week: 0, reason: 'order' }];
t('an override can keep Memorial Day 2027 Monday–Thursday', !weekCalendar('2027-05-31', ov).shift_week);
t('…and leaves 2028 on the rule', weekCalendar('2028-05-29', ov).shift_week);
const ce = [{ holiday_key: 'christmas_eve', year: 2026, cancelled: 1, reason: 'x' }];
t('not observing Christmas Eve 2026 reopens Thursday', weekCalendar('2026-12-21', ce).days[3].production && !weekCalendar('2026-12-21', ce).days[3].closed);
const mv = [{ holiday_key: 'independence_day', year: 2027, observed_on: '2027-07-05', reason: 'x' }];
t('moving a holiday onto a Monday makes that week a shift week', weekCalendar('2027-07-05', mv).shift_week && weekCalendar('2027-06-28', mv).holidays.length === 0);

console.log('\n── one notice, the Monday of the week before ──');
t('Thanksgiving week 2026 (Nov 23) is announced Monday Nov 16', noticeDateFor('2026-11-23') === '2026-11-16');
t('Memorial Day week 2027 (May 31) is announced Monday May 24 — seven days ahead', noticeDateFor('2027-05-31') === '2027-05-24');

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
