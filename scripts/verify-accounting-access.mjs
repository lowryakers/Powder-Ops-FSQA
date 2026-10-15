// verify:accountingaccess — D-184. Accounting follows the AP Drop grant.
//
// "Jorge shows that he has access to the Accounting module — I don't see that
// reflected in settings on his profile." The rule was "anyone with any module
// assigned sees AP Drop, and AP Drop puts Accounting in the sidebar", so every
// floor account had it and Settings could not say why. Now: the AP Drop grant
// (view or edit), an office/admin supervisor, or an admin. Whoever has
// actually filed a drop keeps it, as a grant Settings shows (once per database).
//
// Caller sets PORT + DBPATH + DB_PATH. Boots a second server on PORT+100 to run
// the migration. Needs a built client.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5110);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('aa-floor', 'Jorge Floor', 'operator', 'warehouse', { sanitation: 'view' });
mk('aa-dropper', 'Dina Dropper', 'operator', 'warehouse', { sanitation: 'view' });
mk('aa-granted', 'Gina Granted', 'operator', 'warehouse', { sanitation: 'view', 'ap-drop': 'view' });
mk('aa-office', 'Olga Office', 'supervisor', 'office', { sanitation: 'view' });
mk('aa-legacy', 'Lena Legacy', 'operator', 'warehouse', ['sanitation']);
db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, created_by_user_id, submitter)
  VALUES ('aa-drop-1', 'bill.pdf', 'ap-drop/x', 'abc', 'aa-dropper', 'Dina Dropper')`).run();
db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, created_by_user_id, submitter)
  VALUES ('aa-drop-2', 'bill2.pdf', 'ap-drop/y', 'abd', 'aa-legacy', 'Lena Legacy')`).run();
// The deploy that ships this: the marker is not there yet.
db.prepare("DELETE FROM app_settings WHERE key = 'ap_drop_grants_v1'").run();
db.close();

async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); return { proc, url: `http://localhost:${port}`, log: () => log }; } catch { /* booting */ }
  }
  return { proc, url: null, log: () => log };
}
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const mapOf = (id) => { const r = q('SELECT module_access FROM users WHERE id = ?', id)[0]; return r?.module_access ? JSON.parse(r.module_access) : null; };

console.log('\n── the deploy: whoever has dropped keeps it, as a grant ──');
const two = await boot(BOOT2);
t('second server booted', !!two.url, two.log().slice(-400));
t('somebody who filed a drop now holds AP Drop at view, shown in Settings', mapOf('aa-dropper')?.['ap-drop'] === 'view', JSON.stringify(mapOf('aa-dropper')));
t('their other modules are untouched', mapOf('aa-dropper')?.sanitation === 'view');
t('a map that started as a legacy array (converted at boot) is granted too', mapOf('aa-legacy')?.['ap-drop'] === 'view', JSON.stringify(mapOf('aa-legacy')));
t('somebody who never dropped is NOT granted', !mapOf('aa-floor')?.['ap-drop']);
t('the grant is audited', q("SELECT COUNT(*) n FROM audit_log WHERE entity_id = 'aa-dropper' AND action LIKE '%permission%'")[0].n >= 1);
t('the boot log names who was granted', /AP Drop grant \(view\) given to 2/.test(two.log()) && /Dina Dropper/.test(two.log()), two.log().match(/AP Drop grant.*/)?.[0]);
// A grant removed afterwards stays removed on the next boot.
{ const d = new Database(DBP); d.prepare('UPDATE users SET module_access = ? WHERE id = ?').run(JSON.stringify({ sanitation: 'view' }), 'aa-dropper'); d.close(); }
two.proc.kill(); await wait(800);
const three = await boot(BOOT2);
t('a grant removed in Settings stays removed after a redeploy', !mapOf('aa-dropper')?.['ap-drop']);

console.log('\n── who sees Accounting ──');
const URL = three.url;
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
const signIn = async (name, id) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Accts2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Accts2026!!' })).json();
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const look = async (name, id) => {
  const auth = await signIn(name, id);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/?tab=ap-drop`);
  await page.waitForLoadState('networkidle');
  await wait(1500);
  const zone = await page.$('[data-ap-dropzone]');
  const queue = /Outstanding/.test(await page.textContent('body'));
  const nav = await page.evaluate(() => [...document.querySelectorAll('nav button, nav a, aside button')].map((b) => b.textContent.trim()).filter((s) => /^Accounting/.test(s)).length);
  await page.close();
  return { zone: !!zone, queue, nav };
};
const floor = await look('Jorge Floor', 'aa-floor');
t('a floor account with no AP Drop grant does NOT land on AP Drop', !floor.zone && !floor.queue);
t('…and has no Accounting in the sidebar', floor.nav === 0, `found ${floor.nav}`);
const granted = await look('Gina Granted', 'aa-granted');
t('an account granted AP Drop (view) lands on the drop zone', granted.zone);
const office = await look('Olga Office', 'aa-office');
t('an office supervisor reaches it by role and lands on the queue they work', office.queue && office.nav > 0, JSON.stringify(office));
await browser.close();
three.proc.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
