// verify:moduleusage — D-216. The module-usage report, run from Settings on the live database.
//
// "Operation was rejected by my operating system." The report ran only as `npm run report:usage`
// on a copy of the database, which meant a Terminal and a download. The same report now runs from
// Settings → Data & backup. It must stay READ-ONLY (it runs on production), admin-only, show the
// two demo leftovers, never print a PIN, and say the same thing as the command line.
//
// Caller sets PORT + DBPATH (the runner boots the server). Needs a built client.
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5128);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma, pin = null) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access,pin)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?,?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null, pin);
mk('mu-admin', 'Ana Admin', 'admin', 'admin', null);
mk('mu-sup', 'Sam Supervisor', 'supervisor', 'office', { 'ap-drop': 'edit' });
mk('mu-pin', 'Pina Demo', 'operator', 'cleaning', null, '7391');
const eq = db.prepare('SELECT id FROM equipment LIMIT 1').get()?.id || 'mu-eq';
// The demo backfill's fingerprint: completed under a demo name, no audit entry by an account.
db.prepare(`INSERT OR REPLACE INTO work_orders (id, equipment_id, title, status, due_date, completed_at, completed_by)
  VALUES ('mu-fake', ?, 'Weekly PM — dehumidifier', 'completed', '2026-03-03', '2026-03-03 10:12:00', 'Ricardo A.')`).run(eq);
db.close();

const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: JSON.stringify(b) });
const signIn = async (name, id) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Usage2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Usage2026!!' })).json();
};
const get = (p, tok) => fetch(`${URL}/api${p}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });

// Everything that could move if the report wrote anything.
const snapshot = () => {
  const d = new Database(DBP, { readonly: true });
  try {
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all().map(r => r.name);
    return Object.fromEntries(tables.map(tb => [tb, d.prepare(`SELECT COUNT(*) c FROM "${tb}"`).get().c]));
  } finally { d.close(); }
};

console.log('\n── who may run it ──');
const admin = await signIn('Ana Admin', 'mu-admin');
const sup = await signIn('Sam Supervisor', 'mu-sup');
t('signed in', !!admin.token && !!sup.token);
t('a supervisor is refused', (await get('/compliance/module-usage', sup.token)).status === 403);
t('nobody signed in is refused', [401, 403].includes((await get('/compliance/module-usage')).status));

console.log('\n── it reads and writes nothing ──');
// Settle the sign-ins (sessions, audit) before the snapshot.
await new Promise(r => setTimeout(r, 500));
const before = snapshot();
const res = await get('/compliance/module-usage', admin.token);
t('an admin gets the report', res.status === 200, String(res.status));
const r = await res.json();
await new Promise(r => setTimeout(r, 300));
const after = snapshot();
const moved = Object.keys(after).filter(k => after[k] !== before[k] && k !== 'api_token_calls');
t('no table changed row count (not even the audit log)', moved.length === 0, moved.map(k => `${k} ${before[k]}→${after[k]}`).join(', '));
t('every module has a verdict', Array.isArray(r.modules) && r.modules.length > 50 && r.modules.every(m => m.verdict));
t('the invented maintenance record is found', r.fake?.work_orders === 1 && /FOUND 1 completed work orders/.test(r.text), JSON.stringify(r.fake));
t('the PIN-only account is named', r.pin_accounts.some(u => u.name === 'Pina Demo') && /Pina Demo/.test(r.text));
t('the PIN itself is never sent', !JSON.stringify(r).includes('7391'));
t('retired modules stay labelled as retired', /Danny's List \(retired/.test(r.text));

console.log('\n── it says what the command line says ──');
const copy = `${DBP}.usage-copy`;
for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) if (existsSync(f)) unlinkSync(f);
{ const d = new Database(DBP, { readonly: true }); await d.backup(copy); d.close(); }
const cli = execFileSync(process.execPath, ['scripts/report-module-usage.mjs', copy], { encoding: 'utf8' });
const body = (s) => s.split('\n').slice(1).join('\n').trim();
t('the screen and `npm run report:usage` give the same report', body(cli) === body(r.text),
  body(cli).split('\n').find((l, i) => l !== body(r.text).split('\n')[i]));
const csv = execFileSync(process.execPath, ['scripts/report-module-usage.mjs', copy, '--csv'], { encoding: 'utf8' });
t('--csv still gives one row per module', csv.trim().split('\n').length === r.modules.length + 1);
for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) if (existsSync(f)) unlinkSync(f);

console.log('\n── on screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
  await page.goto(`${URL}/?tab=settings&section=backup`);
  const run = page.locator('[data-module-usage-run]');
  await run.waitFor({ timeout: 20000 }).catch(() => {});
  t(`${width}px: the Module usage card is on Data & backup`, await run.count() === 1);
  t(`${width}px: nothing runs until asked`, await page.locator('[data-module-usage-text]').count() === 0);
  await run.click().catch(() => {});
  await page.locator('[data-module-usage-text]').waitFor({ timeout: 20000 }).catch(() => {});
  const summary = await page.locator('[data-module-usage-summary]').textContent().catch(() => '');
  t(`${width}px: the summary names the invented record and the PIN account`, /\b1 invented maintenance record found/.test(summary) && /\d+ accounts? still on a PIN/.test(summary), summary);
  t(`${width}px: a Copy button is offered`, await page.getByRole('button', { name: /Copy report/ }).count() === 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t(`${width}px: the page does not pan sideways`, !overflow);
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
