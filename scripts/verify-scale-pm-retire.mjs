// verify:scalepmretire — D-139, live on a fresh database, three boots, the scheduler, and a real browser.
//
// "I paused the Daily Scale PMs in Settings and the cards are still on the
// Operator View." Three causes, each asserted here:
//  1. pausing cascaded nothing (D-012), so the cards a schedule had raised kept
//     their open/missed status, and the Operator View lists by status;
//  2. one asset carried several daily programs — the original per-scale PM,
//     one re-created by "Create schedules from these tasks" (which read a
//     paused schedule as no schedule), and the July room checklists — so
//     pausing one left the others raising;
//  3. nothing retired the daily scale programs once Scale Verification (D-117)
//     took the check over.
//
// Caller sets PORT + DBPATH + DB_PATH. Needs a built client. The control is
// `main` before this change: after the reboot every scale card is still there.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { randomUUID as uuid } from 'crypto';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5055);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('sr-adm', 'Lowry Scales', 'admin', 'executive', null);

// ── THE PLANT'S STATE ON 1 OCTOBER ─────────────────────────────────────────
const eqA = (a) => db.prepare('SELECT * FROM equipment WHERE asset_id = ?').get(a);
const V148 = eqA('148'), U81 = eqA('81'), C114 = eqA('114'), K151 = eqA('151'), FAN = eqA('94');
const sched = (eq, title, { active = 1, desc = null, steps = ['Check zero'], freq = 'daily', group = 'warehouse' } = {}) => {
  const id = uuid();
  db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group, is_active)
    VALUES (?,?,?,?,?,1,?,?,?)`).run(id, eq.id, title, desc, freq, JSON.stringify(steps), group, active);
  return id;
};
const card = (sid, eq, title, status, due) => {
  const id = uuid();
  db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?,?,?,?,?,'["Check zero"]','warehouse',?)`).run(id, sid, eq.id, title, due, status);
  return id;
};
db.prepare("DELETE FROM app_settings WHERE key = 'daily_scale_pm_retired_v2'").run();
db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('daily_scale_pm_retired_v1', '{}', datetime('now'))").run();
// #148: the original Daily PM, paused on 24 Aug in Settings, its card left missed.
const old148 = db.prepare("SELECT id, title FROM pm_schedules WHERE equipment_id = ? AND frequency_type = 'daily' AND description IS NULL").get(V148.id);
db.prepare('UPDATE pm_schedules SET is_active = 0 WHERE id = ?').run(old148.id);
const W148 = card(old148.id, V148, old148.title, 'missed', '2026-08-24');
// #81: the original still active and missed since 24 Aug, AND a second one made
// by "Create schedules from these tasks", missed since 25 Aug.
const old81 = db.prepare("SELECT id, title FROM pm_schedules WHERE equipment_id = ? AND frequency_type = 'daily' AND description IS NULL").get(U81.id);
db.prepare('UPDATE pm_schedules SET is_active = 1 WHERE id = ?').run(old81.id);
const W81a = card(old81.id, U81, old81.title, 'missed', '2026-08-24');
const new81 = sched(U81, 'Uline Scale — Daily PM', { desc: 'Created from the maintenance tasks written on Uline Scale.' });
const W81b = card(new81, U81, 'Uline Scale — Daily PM', 'missed', '2026-08-25');
// ── LIVE-SHAPED (D-141) ──
// The register has been renumbered since the July consolidation wrote its
// lines: the counting scales written #114/#115 are #87/#88 on the floor, the
// warehouse scale written #124 is #85. The live titles carry "(Warehouse)"
// because more than one team shares each place. One scale is typed
// "Floor Scale", not "Scale". And the v1 marker is ALREADY written — the
// state of the live database, where the first pass ran on 1 October and
// matched none of these lines.
const renumber = db.prepare('UPDATE equipment SET asset_id = ? WHERE id = ?');
renumber.run('87', C114.id); renumber.run('88', eqA('115').id); renumber.run('85', eqA('124').id);
db.prepare("UPDATE equipment SET type = 'Floor Scale' WHERE id = ?").run(eqA('125').id);
const C085 = eqA('85'), K152 = eqA('152');
const CONS = (n, place) => `Consolidated daily checks for ${n} equipment items in ${place}. One line per machine; replaces the individual daily PM tasks.`;
// Kitting (Warehouse), hung on Counting Scale #87, both lines written under the old numbers.
const KIT = sched(C114, 'Daily PM Checklist — Kitting (Warehouse)', { desc: CONS(2, 'Kitting'),
  steps: ['Counting Scale #114 — Power, display, zero/tare check', 'Counting Scale #115 — Power, display, zero/tare check'] });
const WKIT = card(KIT, C114, 'Daily PM Checklist — Kitting (Warehouse)', 'missed', day(1));
// Production (Warehouse), hung on the warehouse scale (#85 now): every line a
// scale, in every form a July label can take — a renumbered asset, a name that
// still carried its number, odd case and spacing, the Floor Scale.
const PROD = sched(C085, 'Daily PM Checklist — Production (Warehouse)', { desc: CONS(6, 'Production'),
  steps: ['C051746402 Scale warehouse #124 — Power, display, zero/tare check', 'Scale #75 — Power, display, zero/tare check',
    '123 Uline82 Scale — Power, display, zero/tare check', 'MAQ2202IN0801 Scale Floor #125 — Level, zero',
    'vevor  scale #149 — Power, display', 'Kitchen Tour Scale #153 — Power, display'] });
const WPROD = card(PROD, C085, 'Daily PM Checklist — Production (Warehouse)', 'open', day(0));
// A mixed checklist HUNG ON A SCALE: the scale line goes, the fan stays, and a
// line naming a machine the register no longer has is kept and REPORTED.
const MIX = sched(K152, 'Daily PM Checklist — Mixed room (Warehouse)', { desc: CONS(3, 'Mixed'),
  steps: ['Kitchen Tour Scale #152 — Check zero', 'DeWalt Fan #94 — Check blades', 'Old Labeler #999 — Check ink'] });
const WMIX = card(MIX, K152, 'Daily PM Checklist — Mixed room (Warehouse)', 'open', day(0));
// What must NOT move: a weekly scale PM, a started daily scale card, and the paused Pre-Op.
const WEEK = sched(K151, 'Weekly PM — 151 Kitchen Tour Scale', { freq: 'weekly' });
const START = card(new81, U81, 'Uline Scale — Daily PM', 'in_progress', day(1));
const preop = db.prepare("SELECT id, is_active FROM pm_schedules WHERE title LIKE 'Production Line Pre-Op%'").all();
db.close();
t('the plant\'s state is built: #148 paused with a missed card, #81 twice, two live-shaped room checklists, a mixed one hung on a scale',
  !!old148 && !!old81 && preop.length > 0 && preop.every((p) => p.is_active === 0));

async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, base: `http://localhost:${port}/api`, url: `http://localhost:${port}`, ready, log: () => log };
}
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const st = (id) => q('SELECT status FROM work_orders WHERE id = ?', id)[0]?.status;
const act = (id) => q('SELECT is_active FROM pm_schedules WHERE id = ?', id)[0]?.is_active;
const SCALE_DAILY = `SELECT COUNT(*) n FROM work_orders wo JOIN pm_schedules ps ON ps.id = wo.pm_schedule_id
  JOIN equipment e ON e.id = ps.equipment_id
  WHERE wo.status IN ('open','overdue','missed') AND ps.frequency_type = 'daily' AND LOWER(e.type) LIKE '%scale%'`;

console.log('\n── the deploy: the Daily Scale PMs are retired, once ──');
const one = await boot(BOOT2);
t('the application booted again', one.ready);
t('the boot log says what it retired, and what it scanned', /Daily Scale PMs retired: \d+ schedule\(s\) paused, 9 scale line\(s\) off 3 room checklist\(s\), \d+ open\/missed card\(s\) cancelled, 1 started card\(s\) left — \d+ scale\(s\) in the register, \d+ room checklist\(s\) scanned, 1 checklist\(s\) re-hung off a scale/.test(one.log()),
  one.log().split('\n').filter((l) => /Scale PMs/.test(l)).join(' | ') || 'no line');
t('a line naming no equipment is REPORTED in the boot log, not dropped', /WARNING 1 room-checklist line\(s\) resolve to no equipment: "Old Labeler #999"/.test(one.log()),
  one.log().split('\n').filter((l) => /WARNING/.test(l)).join(' | ') || 'no warning');
t('#81: both daily programs are paused', act(old81.id) === 0 && act(new81) === 0);
t('#148: the paused program\'s 38-day-old missed card is cancelled', st(W148) === 'cancelled');
t('#81: both missed cards are cancelled', st(W81a) === 'cancelled' && st(W81b) === 'cancelled');
t('the reason is on the card, naming Scale Verification', /Scale Verification \(FORM 417-01/.test(q('SELECT notes FROM work_orders WHERE id = ?', W81a)[0]?.notes || ''));
t('Kitting (Warehouse), its lines written under the old asset numbers, is paused and its missed card cancelled', act(KIT) === 0 && st(WKIT) === 'cancelled');
t('Production (Warehouse) — six scale lines in six label forms — is paused and today\'s card cancelled', act(PROD) === 0 && st(WPROD) === 'cancelled');
const mix = q('SELECT is_active, procedure_steps, equipment_id FROM pm_schedules WHERE id = ?', MIX)[0];
t('a mixed room checklist loses its scale line and keeps the fan and the unknown line', mix.is_active === 1
  && JSON.parse(mix.procedure_steps).join('|') === 'DeWalt Fan #94 — Check blades|Old Labeler #999 — Check ink'
  && JSON.parse(q('SELECT procedure_steps FROM work_orders WHERE id = ?', WMIX)[0].procedure_steps).length === 2 && st(WMIX) === 'open');
t('…and is re-hung on the fan, card included, so nothing reads "on Kitchen Tour Scale"', mix.equipment_id === FAN.id
  && q('SELECT equipment_id FROM work_orders WHERE id = ?', WMIX)[0].equipment_id === FAN.id);
t('the weekly scale PM is untouched', act(WEEK) === 1);
t('a card somebody had STARTED is left open, and counted', st(START) === 'in_progress');
t('the Pre-Op dailies stay paused (OBL-22)', q("SELECT is_active FROM pm_schedules WHERE title LIKE 'Production Line Pre-Op%'").every((p) => p.is_active === 0));
t('nothing was deleted', q('SELECT COUNT(*) n FROM work_orders WHERE id IN (?,?,?,?,?)', W148, W81a, W81b, WKIT, WMIX)[0].n === 5);
t('no daily scale card is left open, overdue or missed anywhere', q(SCALE_DAILY)[0].n === 0, String(q(SCALE_DAILY)[0].n));

const B = one.base;
const c = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/login', { name: 'Lowry Scales' });
await c('POST', '/users/set-password', { user_id: 'sr-adm', password: 'Passw0rd!!', setup_code: 'SC-sr-adm' });
const adm = await J(await c('POST', '/users/login', { name: 'Lowry Scales', password: 'Passw0rd!!' }));
const A = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adm.token}` }, body: b ? JSON.stringify(b) : undefined });

console.log('\n── the scheduler runs, and a boot runs ──');
await A('POST', '/pm/generate');
await A('GET', '/pm/operator-tasks');
t('after the generator and the housekeeping the boot ran, no daily scale card exists', q(SCALE_DAILY)[0].n === 0, String(q(SCALE_DAILY)[0].n));
const ops = await J(await A('GET', '/pm/operator-tasks'));
const opsRows = (Array.isArray(ops) ? ops : []).filter((x) => x.status !== 'in_progress');
const titles = opsRows.map((x) => x.title);
t('the admin\'s unfiltered Operator View list is not empty (so the next check is not vacuous)', titles.length > 0, String(titles.length));
t('the Operator View carries none of the daily scale programs (a card somebody started aside)', !titles.some((x) => /Daily PM — (148|81|114|151) |Uline Scale — Daily PM|Daily PM Checklist — (Kitting|Production) \(Warehouse\)/.test(x)),
  titles.filter((x) => /Scale|Kitting/.test(x)).join(', '));
t('no daily card on the Operator View is hung on a scale (the searches for Counting, Scale, Kitting and Warehouse)',
  !opsRows.some((x) => x.status !== 'in_progress' && /daily/i.test(x.frequency_type || x.title) && /scale/i.test(`${x.equipment_name || ''} ${x.equipment_type || ''}`)),
  opsRows.filter((x) => /scale/i.test(`${x.equipment_name || ''}`)).map((x) => `${x.title} on ${x.equipment_name}`).join(', '));
const checks = await J(await A('GET', '/pm/operator-checks'));
t('Scale Verification is still what asks for the daily check (the strip has scales due)', (checks?.scale_checks || []).length > 0, JSON.stringify(checks).slice(0, 120));
const prev = await J(await A('GET', '/equipment/schedules-from-tasks/preview'));
const u81 = (prev?.machines || []).find((m) => m.id === U81.id);
t('"Create schedules from these tasks" no longer offers #81 a new Daily PM — a paused one is a decision',
  !u81 || !u81.create.some((x) => x.frequency === 'Daily'), JSON.stringify(u81?.create));

console.log('\n── a person resumes one; the next boot leaves it resumed ──');
let r = await J(await A('PUT', `/pm/schedules/${old81.id}`, { is_active: true }));
t('Resume works', r?.is_active === 1);
one.proc.kill('SIGKILL');
const two = await boot(BOOT2);
t('a second boot retires nothing (once per database) and the resumed schedule stays resumed', two.ready && !/Daily Scale PMs retired/.test(two.log()) && act(old81.id) === 1);
two.proc.kill('SIGKILL');

console.log('\n── pausing in Settings closes the cards and holds across the scheduler and a boot ──');
const d0 = new Database(DBP);
const card2 = (status, due) => {
  const id = uuid();
  d0.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?,?,?,?,?,'["Check zero"]','warehouse',?)`).run(id, old81.id, U81.id, old81.title, due, status);
  return id;
};
const W81c = card2('open', day(3));
const W81d = card2('missed', day(2));
d0.close();
const three = await boot(BOOT2);
const A3 = (m, p, b) => fetch(three.base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adm.token}` }, body: b ? JSON.stringify(b) : undefined });
const outstanding = q("SELECT COUNT(*) n FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','overdue','missed')", old81.id)[0].n;
r = await J(await A3('PUT', `/pm/schedules/${old81.id}`, { is_active: false }));
t('the pause response says it closed every open and missed card', r?.is_active === 0 && outstanding >= 2 && r?.closed_work === outstanding, JSON.stringify({ a: r?.is_active, c: r?.closed_work, o: r?.open_work, outstanding }));
t('both cards are cancelled, naming who paused it', st(W81c) === 'cancelled' && st(W81d) === 'cancelled'
  && /paused by Lowry Scales/.test(q('SELECT notes FROM work_orders WHERE id = ?', W81c)[0]?.notes || ''));
const aud = q("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id = ? AND details LIKE '%paused%' ORDER BY rowid DESC LIMIT 1", old81.id)[0];
t('the audit entry records the pause and what it closed', new RegExp(`"closed_work":${outstanding}`).test(aud?.details || ''), aud?.details);
await A3('POST', '/pm/generate');
three.proc.kill('SIGKILL');
const four = await boot(BOOT2);
t('after the scheduler and another boot it is still paused, with no new card', act(old81.id) === 0
  && q("SELECT COUNT(*) n FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','overdue','missed')", old81.id)[0].n === 0);

console.log('\n── in the browser: the Operator View as Lowry ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${four.url}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [adm.token, adm.user]);
  await page.goto(`${four.url}/?tab=operator`);
  await page.locator('[data-scale-due]').waitFor({ timeout: 15000 });
  const body = await page.locator('body').innerText();
  t('the Scale Verification strip is there', await page.locator('[data-scale-due-card]').count() > 0);
  const hits = body.match(/Daily PM — (148|81|114|151) [^\n]*|Uline Scale — Daily PM|Daily PM Checklist — (Kitting|Production) \(Warehouse\)/g) || [];
  // The one daily scale card left is the one somebody had STARTED before the
  // retirement — left open on purpose, and on screen because it is theirs.
  t('and the only Daily Scale PM card on it is the one somebody had started', hits.length === 1 && hits[0] === 'Uline Scale — Daily PM', JSON.stringify(hits));
} catch (e) { t('the Operator View rendered', false, e.message); }
finally { await browser.close(); four.proc.kill('SIGKILL'); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
