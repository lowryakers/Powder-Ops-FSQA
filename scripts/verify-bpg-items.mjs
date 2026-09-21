// The brittle plastic & glass zone inventories: who owns the numbers.
//
// Reported by Document Control: the quantities on several zones are wrong
// (Quality Area has 4 monitors and 16 windows, not 1 and 8), "I tried to
// modify the document, though I'm still unable to."
//
// Two defects, both of which make a correction look like it never saved:
//   1. THE SEEDER REWROTE ALL SEVENTEEN ZONES ON EVERY BOOT, so anything the
//      plant corrected was silently undone by the next deploy. Every other
//      seeder here is insert-only for exactly this reason.
//   2. THE ITEM CASCADE OMITTED 'missed' — and a monthly inspection past its
//      date is 'missed', which is the ordinary state of a BP&G zone. So the
//      correction reached the schedule and never the card being worked from.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5010;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('bp-qa','Dina Quality','Dina Quality','supervisor','qa',1,'SC-BP',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
await post('/users/login', { name: 'Dina Quality' });
await post('/users/set-password', { user_id: 'bp-qa', password: 'DinaPW2026!', setup_code: 'SC-BP' });
tok = (await J(await post('/users/login', { name: 'Dina Quality', password: 'DinaPW2026!' })))?.token;
t('QA signed in', !!tok);

console.log('\n── every zone on the form is a live inspection ──');
const zones = db.prepare("SELECT id, title, is_active, task_group FROM pm_schedules WHERE title LIKE 'Brittle Plastic%'").all();
t('all seventeen zones on FORM 431-01 are seeded', zones.length === 17, String(zones.length));
t('…every one of them active and routed to QA', zones.every(z => z.is_active === 1 && z.task_group === 'qa'));
const live = (id) => db.prepare("SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')").get(id).c;
t('AND EVERY ONE CARRIES A LIVE CARD — the reported symptom was five zones missing from the inspector’s screen, so the seeded state is asserted zone by zone rather than by a count',
  zones.every(z => live(z.id) === 1), zones.filter(z => live(z.id) !== 1).map(z => z.title).join(', '));

const quality = zones.find(z => /Quality Area/.test(z.title));
const CORRECTED = ['Lights|4|Plastic', 'Exit Signs|2|Plastic', 'Monitors|4|Plastic',
  'Printers|2|Plastic', 'Label Printers|2|Plastic', 'Windows|16|Glass'];

console.log('\n── the correction reaches the card, not just the schedule ──');
// A monthly check past its date is 'missed'. That is not an edge case here —
// it is what housekeeping does to every BP&G card the day after it is due.
db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ?").run(quality.id);
const saved = await put(`/pm/schedules/${quality.id}/items`, { items: CORRECTED });
t('QA can correct a zone’s inventory', saved.status === 200, String(saved.status));
const card = db.prepare("SELECT status, procedure_steps FROM work_orders WHERE pm_schedule_id = ?").get(quality.id);
t('A MISSED CARD IS STILL THE CARD SHE IS WORKING FROM — the correction has to reach it, or she counts sixteen windows, saves, and the list in front of her still says eight',
  card.status === 'missed' && /Windows\|16/.test(card.procedure_steps), `${card.status} ${card.procedure_steps}`);
t('and the schedule carries it too, so the next month’s card is right',
  /Monitors\|4/.test(db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p));

console.log('\n── and a redeploy leaves it alone ──');
const { seedGlassPlasticPMSchedules } = await import('../server/cleaning-seed.js');
const { runPmHousekeeping } = await import('../server/api/pm.js');
seedGlassPlasticPMSchedules(db);
const after = db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p;
t('THE SEED NEVER OVERWRITES A CORRECTED INVENTORY — it used to rewrite all seventeen zones on every boot, so the plant’s own counts were undone by the next deploy and the edit read as though it had never saved',
  JSON.parse(after).includes('Windows|16|Glass') && JSON.parse(after).includes('Monitors|4|Plastic'), after);
t('a zone nobody has touched still gets the code’s transcription',
  /Walkie Talkies\|12/.test(db.prepare("SELECT procedure_steps p FROM pm_schedules WHERE title LIKE '%Gown Room'").get().p));
t('and re-running it a second time changes nothing again (idempotent by construction)',
  (() => { seedGlassPlasticPMSchedules(db); return db.prepare('SELECT procedure_steps p FROM pm_schedules WHERE id = ?').get(quality.id).p === after; })());

console.log('\n── the team cascade reads the same statuses ──');
// The owner cascade (D-094) already included 'missed'; the team cascade did
// not, so moving a schedule's team routed everything EXCEPT the outstanding
// work — which is the part that most needed to move.
const gown = zones.find(z => /Gown Room/.test(z.title));
db.prepare("UPDATE work_orders SET status = 'missed' WHERE pm_schedule_id = ?").run(gown.id);
await put(`/pm/schedules/${gown.id}`, { task_group: 'cleaning' });
t('MOVING A SCHEDULE’S TEAM REACHES ITS MISSED CARD TOO, or the overdue work stays routed to the team that no longer owns it',
  db.prepare('SELECT task_group g FROM work_orders WHERE pm_schedule_id = ?').get(gown.id).g === 'cleaning',
  db.prepare('SELECT task_group g FROM work_orders WHERE pm_schedule_id = ?').get(gown.id).g);
await put(`/pm/schedules/${gown.id}`, { task_group: 'qa' });

console.log('\n── a zone disappears from the screen for exactly two reasons ──');
// Both are the answer to "those areas did not appear on her end", and both are
// recoverable by a person rather than a deploy — which is why they are
// asserted: the backfill that keeps every schedule carrying a card is joined
// to the equipment row and skips a zone whose AREA has been retired.
const office1 = zones.find(z => /Office 1/.test(z.title));
const eq = db.prepare('SELECT equipment_id FROM pm_schedules WHERE id = ?').get(office1.id).equipment_id;
db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE pm_schedule_id = ?").run(office1.id);
db.prepare("UPDATE equipment SET status = 'out_of_service' WHERE id = ?").run(eq);
runPmHousekeeping(db, { force: true });
t('A ZONE WHOSE AREA IS OUT OF SERVICE NEVER GETS ANOTHER CARD — the orphan backfill joins the equipment row, so retiring an inspection zone in the Equipment registry silently ends its inspections',
  live(office1.id) === 0, String(live(office1.id)));
db.prepare("UPDATE equipment SET status = 'active' WHERE id = ?").run(eq);
runPmHousekeeping(db, { force: true });
t('…and putting the area back brings the inspection back by itself, with no deploy', live(office1.id) === 1, String(live(office1.id)));

db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE pm_schedule_id = ?").run(office1.id);
db.prepare('UPDATE pm_schedules SET is_active = 0 WHERE id = ?').run(office1.id);
runPmHousekeeping(db, { force: true });
t('A PAUSED ZONE likewise stops appearing — the second of the two states worth checking when an area goes quiet', live(office1.id) === 0);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
