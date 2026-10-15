// verify:scaleschedule — a daily scale check is owed only by a team that is on
// today (D-181).
//
// SOP 417: "Perform daily when operating in a production room." The cards, the
// Operator View strip and the bell asked every team every weekday, so a day a
// team was not in read as a missed check. Asserted live:
//   1. nothing on today's schedule → no check is owed, and the screen says the
//      schedule is blank rather than looking like a quiet day;
//   2. a team with a production cell today owes its scales; the others do not;
//   3. a cleaning-only cell is not a run;
//   4. a run started, or a report filed, for a team NOT on the schedule makes
//      its check owed — the team is on the floor;
//   5. a check filed is done whatever the schedule says;
//   6. in a browser: due cards amber, a team not on today grey and saying so.
// THE CONTROL is the code before D-181: every form is due on a blank day.
const PORT = process.env.PORT || 5108;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { scheduleToday } = await import('./lib/schedule-today.mjs');
const { plantDateOf } = await import('../server/plant-clock.js');
const { SCALE_FORMS } = await import('../server/scale-forms.js');
const DBP = process.env.DBPATH;
const withDb = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };

withDb((db) => {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('ss-adm','Sched Scale','Sched Scale','admin','qa',1,'SC-SS',datetime('now','+7 day'))`).run();
  db.prepare('DELETE FROM scale_verifications').run();
  db.prepare('DELETE FROM production_schedule').run();
  db.prepare('DELETE FROM production_entries WHERE date = ?').run(plantDateOf());
});
const post0 = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
await post0('/users/login', { name: 'Sched Scale' });
await post0('/users/set-password', { user_id: 'ss-adm', password: 'SchedScale2026!', setup_code: 'SC-SS' });
const auth = await J(await post0('/users/login', { name: 'Sched Scale', password: 'SchedScale2026!' }));
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.token}` } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
t('signed in', !!auth?.token);
const status = async () => J(await req('/scale-verification/status'));
const dueCodes = async () => ((await J(await req('/pm/operator-checks')))?.scale_checks || []).map((c) => c.code).sort();
const form = (st, code) => st?.forms?.find((f) => f.code === code);
const TEAM = Object.fromEntries(SCALE_FORMS.map((f) => [f.code, f.area]));
const codesOf = (...areas) => SCALE_FORMS.filter((f) => areas.includes(f.area)).map((f) => f.code).sort();

console.log('\n── a blank schedule ──');
let st = await status();
t('NOTHING ON TODAY\'S SCHEDULE OWES NO CHECK', st?.forms?.every((f) => f.due === false), JSON.stringify(st?.forms?.map((f) => [f.code, f.due])));
t('…and the status says the schedule is blank', st?.schedule_blank === true);
t('…so the Operator View is handed nothing', (await dueCodes()).length === 0);

console.log('\n── Batching on the schedule ──');
withDb((db) => { scheduleToday(db, 'Batching 1', 'Batching'); scheduleToday(db, '15', 'Kitting', { roomType: 'cleaning' }); });
st = await status();
t('BATCHING\'S SCALES ARE OWED', JSON.stringify(await dueCodes()) === JSON.stringify(codesOf('Batching')), JSON.stringify(await dueCodes()));
t('…because it is on today\'s schedule', form(st, codesOf('Batching')[0])?.operating === 'schedule');
t('Filling and Kitting are not', codesOf('Filling', 'Kitting').every((c) => form(st, c)?.due === false));
t('A CLEANING-ONLY CELL IS NOT A RUN (Kitting stays not owed)', codesOf('Kitting').every((c) => !form(st, c)?.operating));
t('the schedule is no longer blank', st?.schedule_blank === false);

console.log('\n── on the floor without being on the schedule ──');
const run = await post('/production/runs', { room: '4', team: 'Filling' });
t('a Filling run is started', run.status === 200 || run.status === 201, String(run.status));
withDb((db) => db.prepare(`INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, people_count, quantity_completed, start_time, end_time, submitted_by)
  VALUES ('ss-entry', ?, 'Kitting', '15', 'Test', 'MO-SS', 'LOT-SS', 1, 1, '06:00', '14:00', 'fixture')`).run(plantDateOf()));
st = await status();
t('A RUN STARTED MAKES FILLING\'S SCALES OWED', codesOf('Filling').every((c) => form(st, c)?.due && form(st, c)?.operating === 'run'));
t('A REPORT FILED MAKES KITTING\'S OWED', codesOf('Kitting').every((c) => form(st, c)?.due && form(st, c)?.operating === 'entry'));
t('the Operator View now has all five', (await dueCodes()).length === SCALE_FORMS.length);

console.log('\n── a check filed is done ──');
const f1 = SCALE_FORMS.find((f) => f.area === 'Batching');
const r = await post('/scale-verification', { form_code: f1.code, readings: f1.points.map((p) => String(p.nominal)), performed_by: 'Sched Scale', room: 'Batching 1' });
t('a Batching check is filed', r.status === 200 || r.status === 201, String(r.status));
st = await status();
t('…and it is no longer owed', form(st, f1.code)?.due === false && !!form(st, f1.code)?.today);

console.log('\n── in a browser ──');
withDb((db) => { db.prepare("DELETE FROM production_runs").run(); db.prepare("DELETE FROM production_entries WHERE id = 'ss-entry'").run(); });
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=calibration&view=scale-verification`);
await page.locator('[data-scale-card]').first().waitFor({ timeout: 20000 }).catch(() => {});
const state = async (c) => page.locator(`[data-scale-card="${c}"]`).getAttribute('data-scale-state').catch(() => null);
const batch2 = codesOf('Batching').find((c) => c !== f1.code);
t('the unfiled Batching scale reads DUE', await state(batch2) === 'due');
t('the filed one reads done', await state(f1.code) === 'done');
const fill = codesOf('Filling')[0];
t('A TEAM NOT ON TODAY READS NOT DUE', await state(fill) === 'not_due');
t('…and says so in words', /Filling not on today — no check owed/.test(await page.locator(`[data-scale-card="${fill}"]`).innerText().catch(() => '')));
await browser.close();

void TEAM;
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
