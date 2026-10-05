// verify:pmgeneration — D-142, live on a fresh database, a reboot and a real browser.
//
// "Daily forklift tasks are good, weekly are not generating" (Adam, 2 Oct).
// The generator raises a card for every active schedule with nothing
// outstanding, and skips three kinds without a word: a machine out of service,
// an equipment row that no longer exists, and a title another schedule on the
// same machine already has a card for. This proves every cadence generates for
// a truck shaped like the live ones, and that NO active schedule is left
// raising nothing without a named reason.
//
// Caller sets PORT + DBPATH + DB_PATH. Needs a built client. The control is
// `main` before this change: there is no sweep to ask.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { randomUUID as uuid } from 'crypto';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5056);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('pg-adm','Adam Generation','Adam Generation','admin','production',1,'SC-pg-adm',datetime('now','+7 day'))`).run();
const eqA = (a) => db.prepare('SELECT * FROM equipment WHERE asset_id = ?').get(a);
const REACH = eqA('0009'), SIT = eqA('0147'), FAN = eqA('94');
const sched = (eq, title, freq, { group = 'warehouse', steps = ['Inspect'] } = {}) => {
  const id = uuid();
  db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, frequency_type, frequency_value, procedure_steps, task_group, is_active)
    VALUES (?,?,?,?,1,?,?,1)`).run(id, eq.id, title, freq, JSON.stringify(steps), group);
  return id;
};
// THE LIVE SHAPE: a forklift carrying every cadence, titled the way
// migrate_pm_titles_v1 titles them, with no card out on any non-daily one.
const FREQ = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
const truck = {};
for (const [f, label] of Object.entries(FREQ)) {
  truck[f] = sched(REACH, `${label} PM — 0009 ForkLift Reach`, f,
    { steps: f === 'daily' ? ['Horn|check|Inspection', 'Brakes|check|Inspection'] : ['Clean battery compartment, inspect cables'] });
}
const sitWeekly = sched(SIT, 'Weekly PM — 0147 ForkLift Sit down', 'weekly');
// The three skips, each built as it happens on a real floor:
const outEq = db.prepare("SELECT * FROM equipment WHERE type = 'Fan' AND id != ? LIMIT 1").get(FAN.id);
db.prepare("UPDATE equipment SET status = 'out_of_service' WHERE id = ?").run(outEq.id);
const OUT = sched(outEq, `Weekly PM — ${outEq.asset_id} ${outEq.name}`, 'weekly', { group: 'maintenance' });
const goneId = uuid();
db.prepare(`INSERT INTO equipment (id, name, type, asset_id, status) VALUES (?, 'Retired Labeler', 'Coder', 'X-GONE', 'active')`).run(goneId);
const GONE = sched({ id: goneId }, 'Monthly PM — X-GONE Retired Labeler', 'monthly', { group: 'maintenance' });
db.pragma('foreign_keys = OFF');
db.prepare('DELETE FROM equipment WHERE id = ?').run(goneId);
const TWIN_A = sched(FAN, 'Monthly PM — 94 DeWalt Fan (sweep)', 'monthly', { group: 'maintenance' });
const TWIN_B = sched(FAN, 'Monthly PM — 94 DeWalt Fan (sweep)', 'monthly', { group: 'maintenance' });
db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
  VALUES (?,?,?,?,?,'[]','maintenance','open')`).run(uuid(), TWIN_A, FAN.id, 'Monthly PM — 94 DeWalt Fan (sweep)', today);
db.close();
t('the plant\'s state is built: a forklift carrying five cadences, and the three silent skips', !!REACH && !!SIT && !!outEq);

async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, base: `http://localhost:${port}/api`, url: `http://localhost:${port}`, ready, log: () => log };
}
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const srv = await boot(BOOT2);
t('the application booted on the plant\'s state', srv.ready);
const c = (m, p, b, tk) => fetch(srv.base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/login', { name: 'Adam Generation' });
await c('POST', '/users/set-password', { user_id: 'pg-adm', password: 'Passw0rd!!', setup_code: 'SC-pg-adm' });
const adm = await J(await c('POST', '/users/login', { name: 'Adam Generation', password: 'Passw0rd!!' }));
const A = (m, p, b) => c(m, p, b, adm?.token);

console.log('\n── the sweep: every active schedule, raising or named ──');
const sw = await J(await A('GET', '/pm/schedules/generation'));
t('the sweep answers', Array.isArray(sw?.schedules) && sw.total > 0, JSON.stringify(sw).slice(0, 120));
const by = Object.fromEntries((sw?.schedules || []).map((s) => [s.id, s]));
for (const f of Object.keys(FREQ)) {
  const s = by[truck[f]];
  t(`the forklift's ${f} schedule has a card out, due today or later`, s?.state === 'raising' && s.card && s.card.due_date >= today, JSON.stringify(s?.card || s?.state));
}
t('the second forklift\'s weekly schedule has a card out too', by[sitWeekly]?.state === 'raising');
t('the out-of-service machine\'s schedule is NAMED, not silent', by[OUT]?.state === 'equipment_inactive' && /not in service/.test(by[OUT]?.reason || ''));
t('a schedule whose equipment row is gone is NAMED — the generator\'s join cannot see it', by[GONE]?.state === 'equipment_missing');
t('the twin whose title already has a card is NAMED, pointing at that card', by[TWIN_B]?.state === 'same_job' && !!by[TWIN_B]?.blocking?.card_id);
const silentUnnamed = (sw?.schedules || []).filter((s) => s.state === 'pending');
t('NO active schedule is left raising nothing without a reason after housekeeping — every cadence, every machine', silentUnnamed.length === 0,
  silentUnnamed.slice(0, 5).map((s) => `${s.frequency_type}: ${s.title}`).join(', '));
const nonDailyBad = (sw?.schedules || []).filter((s) => s.frequency_type !== 'daily' && s.state !== 'raising'
  && !['equipment_inactive', 'equipment_missing', 'same_job'].includes(s.state));
t('…stated for the non-daily cadences on their own', nonDailyBad.length === 0, String(nonDailyBad.length));
const counted = Object.values(sw?.by_frequency || {}).reduce((n, f) => n + f.active, 0);
const rolled = Object.values(sw?.by_frequency || {}).every((f) => f.raising + f.not_raising === f.active);
t('the per-cadence roll-up is the rows under it (and partitions them)', counted === sw?.total && rolled && sw.not_raising_count === sw.not_raising.length);
const dbRaising = q(`SELECT COUNT(*) n FROM pm_schedules ps WHERE ps.is_active = 1 AND EXISTS (SELECT 1 FROM work_orders wo
  WHERE wo.pm_schedule_id = ps.id AND wo.status IN ('open','in_progress','overdue','missed'))`)[0].n;
t('"raising" agrees with the table', dbRaising === (sw?.schedules || []).filter((s) => s.state === 'raising').length);

console.log('\n── the floor sees the weekly card ──');
const ops = await J(await A('GET', '/pm/operator-tasks?group=warehouse'));
const titles = (Array.isArray(ops) ? ops : []).map((x) => x.title);
t('the warehouse Operator View carries the forklift\'s weekly card', titles.includes('Weekly PM — 0009 ForkLift Reach'), titles.filter((x) => /ForkLift/.test(x)).join(', '));
const tc = await J(await A('GET', '/pm/by-frequency?frequency=weekly'));
t('the Task Center\'s Weekly tab carries it too', (tc?.weekly || []).some((x) => x.title === 'Weekly PM — 0009 ForkLift Reach'));

console.log('\n── in the browser: Recurring Schedules ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${srv.url}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [adm.token, adm.user]);
  await page.goto(`${srv.url}/?tab=pm-schedules`);
  await page.locator('[data-generation-sweep]').waitFor({ timeout: 15000 });
  const weekly = await page.locator('[data-sweep-freq="weekly"]').innerText();
  t('the strip states the weekly cadence as raising N of M', /Weekly: \d+ of \d+/.test(weekly), weekly);
  await page.locator('[data-sweep-toggle]').click();
  const states = await page.locator('[data-sweep-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sweep-state')));
  t('opening it lists the three skips with their reasons', ['equipment_inactive', 'equipment_missing', 'same_job'].every((s) => states.includes(s)), JSON.stringify(states));
  const txt = await page.locator('[data-sweep-list]').innerText();
  t('each row says why in words', /not in service/.test(txt) && /no longer exists/.test(txt) && /already has a card out/.test(txt));
} catch (e) { t('Recurring Schedules rendered', false, e.message); }
finally { await browser.close(); srv.proc.kill('SIGKILL'); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
