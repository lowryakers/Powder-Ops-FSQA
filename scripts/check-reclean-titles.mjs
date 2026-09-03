// Three conditions raise a re-clean and only one of them is the 72-hour rule.
// The task has to say which, and — the coupling that is easy to break — the
// title it says it with must still resolve back to the room, or completing the
// task files no cleaning record.
//
// Runs the real generator against a real (temporary) database.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(process.env.SCRATCH || tmpdir(), 'reclean-'));
process.env.DB_PATH = join(dir, 'reclean.db');

const { getDb } = await import('../server/db.js');
const { generateRecleanTasks, recleanRooms } = await import('../server/api/sanitation.js');
const { recleanTaskText } = await import('../shared/reclean-reasons.js');
const { areaLabel } = await import('../shared/rooms.js');
const { recordAreaForTask } = await import('../server/qa-records.js');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const db = getDb();   // creates the schema on first call

const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
const stamp = (hoursBack) => new Date(Date.now() - hoursBack * 3600000).toISOString().slice(0, 19).replace('T', ' ');

// The generator only ever acts on rooms it can see, so build each state out of
// the records the plant actually files.
const entry = db.prepare(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, people_count, quantity_completed, start_time, end_time, submitted_by)
  VALUES (?, ?, 'Batching', ?, 'Test', 'MO-FIX', 'LOT-FIX', 1, 1, '06:00', '14:00', 'fixture')`);
const clean = db.prepare(`INSERT INTO sanitation_records (id, area, type, result, performed_by, performed_at)
  VALUES (?, ?, 'pre_op', 'pass', 'fixture', ?)`);

// 1 — idle past 72 hours: cleaned four days ago, not run since.
clean.run('c-idle', '5', stamp(96));
// 2 — dirty: cleaned, then run the next day.
clean.run('c-dirty', '6', stamp(72 + 48));
entry.run('e-dirty', day(1), '6');
// 3 — used with no passing clean at all.
entry.run('e-nocl', day(1), '7');

const rooms = Object.fromEntries(recleanRooms(db).map(r => [r.room, r]));
t('room 5 is the 72-hour case', rooms['5']?.status === 'expired_72h', rooms['5']?.status);
t('room 6 is dirty, not a 72-hour lapse', rooms['6']?.status === 'dirty', rooms['6']?.status);
t('room 7 has no clean on record', rooms['7']?.status === 'no_clean_on_record', rooms['7']?.status);

const created = generateRecleanTasks(db);
t('all three raise a task', created >= 3, `${created}`);

const wos = db.prepare("SELECT title, description FROM work_orders WHERE title LIKE '%Re-clean%'").all();
const titleFor = (room) => wos.find(w => w.title.includes(room))?.title;

console.log('\n── each reason names itself ──');
const idle = titleFor('Room 5'), dirty = titleFor('Room 6'), nocl = titleFor('Room 7');
t('the 72-hour case keeps the name the plant knows', idle === '72h Re-clean — Room 5', idle);
t('a room used since its clean says SO', dirty === 'Re-clean — Room 6 (used since last clean)', dirty);
t('a room with no clean says SO', nocl === 'Re-clean — Room 7 (no clean on record)', nocl);
// The defect this fixes: a task raised because the room ran yesterday used to
// be titled as a 72-hour lapse, and the floor read the rule as misfiring.
t('NEITHER of the other two claims to be the 72-hour rule',
  !/72h/.test(dirty || '') && !/72h/.test(nocl || ''), `${dirty} / ${nocl}`);

console.log('\n── the title still resolves back to the room ──');
// Completing one of these files its cleaning record, and that is the only route
// back from a task to an area. A title the map cannot read files nothing.
for (const [room, title] of [['5', idle], ['6', dirty], ['7', nocl]]) {
  t(`"${title}" → ${room}`, recordAreaForTask(title) === room, `${recordAreaForTask(title)}`);
}
t('a maintenance PM that merely says Cleaning still maps to nothing',
  recordAreaForTask('Daily PM Checklist — Production (Cleaning)') === null);

console.log('\n── the description agrees with the title ──');
t('the dirty description names the real reason',
  /used in production after its last passed clean/.test(wos.find(w => w.title === dirty)?.description || ''));
{
  const noclWo = wos.find(w => w.title === nocl);
  t('the no-clean task was raised and carries a description', !!noclWo?.description, nocl);
  t('a room with no clean never reads "idle nullh"', !!noclWo?.description && !/null/.test(noclWo.description), noclWo?.description);
}
t('the 72-hour description carries the real hour count',
  /idle \d+h since last clean/.test(wos.find(w => w.title === idle)?.description || ''));

console.log('\n── one task per flag ──');
t('running again creates nothing', generateRecleanTasks(db) === 0);

// Both doors say the same words: the manual Assign button had its own copy,
// which titled the task with the raw room token and printed "idle nullh".
console.log('\n── the manual Assign button uses the same words ──');
t('recleanTaskText is what both call', recleanTaskText(rooms['6'], areaLabel('6')).title === dirty);
t('and it labels the room rather than printing its token',
  !/— 6$/.test(recleanTaskText(rooms['6'], areaLabel('6')).title));

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
