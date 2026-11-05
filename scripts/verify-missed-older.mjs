// verify:missedolder — the banner names the runs before the dates on screen, and a
// supervisor can dismiss them all at once with one reason (D-315).
//
// Reported: ReadyBot said "60 scheduled runs with no end-of-day report" while the
// Production Log banner said 4. The banner reads the dates on screen (last 30 days);
// the chase reads every unfiled run since July.
//
// Boots its own server on a fresh database (MISSOLD_PORT) and drives a browser at 1280.
// Control: main before D-315 — no dismiss-older route, and the banner says nothing of
// the older runs.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MISSOLD_PORT || 5193);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-missold-'));
const dbPath = path.join(dir, 'missold.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const write = (fn) => { const d = new Database(dbPath); try { return fn(d); } finally { d.close(); } };

let child = null; const out = [];
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set MISSOLD_PORT.`); process.exit(1); } catch { /* free */ }
child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const mondayOf = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
write(db => {
  db.prepare('DELETE FROM production_schedule').run();
  db.prepare('DELETE FROM production_entries').run();
  db.prepare('DELETE FROM production_missed_dismissals').run();
  const user = (id, name, role, map) => db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES (?, ?, ?, ?, 'filling', 1, ?, datetime('now'), ?)`).run(id, name, name, role, hashOf('Pass-word-2026'), map);
  user('mo-sup', 'Mo Supervisor', 'supervisor', '{"production-log":"edit"}');
  user('mo-op', 'Mo Operator', 'operator', '{"production-log":"view"}');
  // A run on a weekday n days ago (skipping the weekend keeps it a plain Mon–Fri cell).
  const slot = (id, n, mo) => {
    let d = day(n); const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) d = day(n + (wd === 0 ? 2 : 1));
    const ws = mondayOf(d); const dow = Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${ws}T00:00:00Z`)) / 86400000);
    db.prepare(`INSERT INTO production_schedule (id, week_start, day_of_week, room, room_type, team, mo_number, product_name, slot)
      VALUES (?, ?, ?, '5', 'production', 'Filling', ?, 'Stick', 0)`).run(id, ws, dow, mo);
  };
  slot('mo-new1', 5, 'MO90001'); slot('mo-new2', 9, 'MO90002');                      // in the last 30 days
  slot('mo-old1', 60, 'MO80001'); slot('mo-old2', 75, 'MO80002'); slot('mo-old3', 110, 'MO80003'); // older
});
const login = async (name) => (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'Pass-word-2026' }) })).json()).token;
const SUP = await login('Mo Supervisor'); const OP = await login('Mo Operator');
const call = async (tok, m, p, b) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* none */ } return { status: r.status, json: j }; };
t('two accounts signed in', !!SUP && !!OP);

const from = day(30);
console.log('\n── the API ──');
let r = await call(SUP, 'GET', '/production/missed-reports');
t('all five runs are outstanding (what the chase counts)', r.json?.length === 5, String(r.json?.length));
r = await call(SUP, 'POST', '/production/missed-reports/dismiss-older', { before: from, preview: true });
t('a preview names the three older runs and writes nothing', r.status === 200 && r.json?.count === 3
  && one('SELECT COUNT(*) c FROM production_missed_dismissals').c === 0, JSON.stringify(r.json).slice(0, 160));
r = await call(OP, 'POST', '/production/missed-reports/dismiss-older', { before: from, reason: 'old runs' });
t('an operator is refused', r.status === 403, String(r.status));
r = await call(SUP, 'POST', '/production/missed-reports/dismiss-older', { before: from, reason: '' });
t('no reason is refused', r.status === 400);
r = await call(SUP, 'POST', '/production/missed-reports/dismiss-older', { before: 'last month', reason: 'old runs' });
t('a date that is not a date is refused', r.status === 400);

console.log('\n── the screen ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${ORIGIN}/manifest.webmanifest`);
const me = (await call(SUP, 'GET', '/users/me')).json;
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [SUP, me?.user || me]);
await page.goto(`${ORIGIN}/?tab=production-log`);
const older = page.locator('[data-missed-older]');
await older.waitFor({ timeout: 20000 }).catch(() => {});
t('the banner counts the two in the dates shown', await page.getByText('2 scheduled production runs have no end-of-day report').count() === 1);
const olderText = (await older.textContent().catch(() => '')) || '';
t('…and names the three before them', /3 more from before/.test(olderText), olderText.slice(0, 120));
await page.locator('[data-missed-clear]').click();
await page.locator('[data-missed-clear-reason]').fill('Runs before the plant filed EOD reports in ReadyDoc');
await page.locator('[data-missed-clear-confirm]').click();
await older.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
t('after dismissing, the older line is gone', await older.count() === 0);
t('…and the two recent runs are still listed', await page.getByText('2 scheduled production runs have no end-of-day report').count() === 1);
await browser.close();

console.log('\n── what was written ──');
t('three dismissals, each with the reason and the supervisor', one(`SELECT COUNT(*) c FROM production_missed_dismissals
  WHERE reason = 'Runs before the plant filed EOD reports in ReadyDoc' AND dismissed_by = 'Mo Supervisor'`).c === 3);
t('one audit row per run plus one summary', one(`SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'production_missed_report' AND details LIKE '%"bulk":true%'`).c === 4);
r = await call(SUP, 'GET', '/production/missed-reports');
t('the chase now counts the same two the banner does', r.json?.length === 2, String(r.json?.length));
r = await call(SUP, 'GET', `/production/missed-reports?to=${day(31)}&include_dismissed=1`);
t('the dismissed runs are still there to restore', r.json?.filter(m => m.dismissed).length === 3);
r = await call(SUP, 'POST', '/production/missed-reports/dismiss-older', { before: from, reason: 'again' });
t('a second run dismisses nothing more', r.json?.dismissed === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
