// check:plantclock — the scheduler's day/hour/week gates read the PLANT's wall
// clock, not the container's (D-124). Drives the real runDue at chosen instants
// with recording stubs; nothing is sent anywhere.
import Database from 'better-sqlite3';
import { plantWallClock, PLANT_TZ } from '../server/plant-clock.js';
import { runDue } from '../server/scheduled-jobs.js';

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

if (PLANT_TZ !== 'America/Denver') console.log(`  (PLANT_TZ is ${PLANT_TZ}; the instants below assume America/Denver)`);

console.log('The wall clock');
const lateSunday = plantWallClock(new Date('2026-09-28T05:30:00Z'));   // Sun 23:30 MDT
t('05:30 UTC on a Monday is still SUNDAY 23:30 at the plant', lateSunday.getDay() === 0 && lateSunday.getHours() === 23,
  `${lateSunday.getDay()} ${lateSunday.getHours()}`);
const earlyMonday = plantWallClock(new Date('2026-09-28T06:10:00Z')); // Mon 00:10 MDT
t('06:10 UTC is ten past MIDNIGHT Monday, not ten past six', earlyMonday.getDay() === 1 && earlyMonday.getHours() === 0);
const winter = plantWallClock(new Date('2026-12-07T13:30:00Z'));      // Mon 06:30 MST
t('and it follows the winter offset — 13:30 UTC in December is 06:30', winter.getHours() === 6 && winter.getDay() === 1);

console.log('\nThe real gates, at chosen instants');
function freshDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  return db;
}
function stubs(calls) {
  const record = (name) => async () => { calls.push(name); return { sent: 0, total: 1 }; };
  return {
    storageEnabled: () => false,
    getChannelByName: () => null, postMessageAs: async () => {}, getBotUser: () => null,
    sendCleanupDigest: record('cleanup'),
    cleanupDigest: () => ({ tasks: 30 }),
    sendEodMissedDigest: record('eod'),
    eodMissedDigest: () => ({ total: 3 }),
    sendFlashReport: record('flash'),
    computeCritical: () => ({ readiness: { score: 100 }, categories: {} }),
  };
}
const quiet = console.log; const warn = console.warn;
async function at(iso) {
  const db = freshDb(); const calls = [];
  console.log = () => {}; console.warn = () => {};
  try { await runDue(db, stubs(calls), new Date(iso)); } finally { console.log = quiet; console.warn = warn; }
  calls.flags = Object.fromEntries(db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value]));
  return calls;
}

const midnight = await at('2026-09-29T06:10:00Z');   // Tue 00:10 MDT — the container reads 06:10
t('AT TEN PAST MIDNIGHT NOTHING GOES OUT — the container calls it 06:10, the plant is asleep',
  !midnight.includes('flash') && !midnight.includes('cleanup') && !midnight.includes('eod'), JSON.stringify(midnight));
const morning = await at('2026-09-29T12:10:00Z');    // Tue 06:10 MDT
t('at 06:10 at the plant the morning flash report and both digests go out',
  ['flash', 'cleanup', 'eod'].every(k => morning.includes(k)), JSON.stringify(morning));
const sundayNight = await at('2026-09-28T02:00:00Z'); // Sun 20:00 MDT — the container reads Monday 02:00
t('SUNDAY EVENING IS NOT MONDAY — no weekday report goes out on it', !sundayNight.includes('flash'), JSON.stringify(sundayNight));
t('…and the MONDAY jobs, which have no hour gate, do not run on Sunday evening',
  !sundayNight.flags.last_expiry_digest_week, JSON.stringify(sundayNight.flags));
const mondayMorning = await at('2026-09-28T14:00:00Z'); // Mon 08:00 MDT
t('they run on Monday at the plant', !!mondayMorning.flags.last_expiry_digest_week, JSON.stringify(mondayMorning.flags));
const todayFlag = (await at('2026-09-29T05:00:00Z')).flags.last_critical_alert_check; // Mon 23:00 MDT
t('"today" is the plant\'s date — 05:00 UTC on the 29th is still the 28th', todayFlag === '2026-09-28', String(todayFlag));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
