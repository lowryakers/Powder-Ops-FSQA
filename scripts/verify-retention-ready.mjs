// D-390 (A-20261124-005): QA logs NEW retains in ReadyDoc from now on; the history
// stays in the old system. This walks the path a QA tech takes and proves a
// retention record can no longer be deleted by anyone.
//
// What this proves:
//   - a QA tech with the module files a new retain (201), in an open box;
//   - filing into a destroyed box is refused, nothing written;
//   - the retain is found by its lot (by-lot) and in the log;
//   - a correction is in place and audited;
//   - DELETE is 403 RETENTION_DELETE_DISABLED for an admin too, the row intact;
//   - the screen offers "Log a pull" and no Delete button.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5248;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('rr-a', 'Retain Admin', 'admin', 'admin', null);
mkUser('rr-q', 'Retain QA', 'operator', 'qa', JSON.stringify({ 'retention-samples': 'edit' }));
const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, token: r.body?.token, user: r.body?.user };
};
const A = await login('rr-a', 'Retain Admin', 'RetainAdmin2026!');
const Q = await login('rr-q', 'Retain QA', 'RetainQa202666!');
t('signed in (a QA tech, an admin)', !!A.token && !!Q.token);

const sampleCount = () => db.prepare('SELECT COUNT(*) n FROM retention_samples').get().n;

console.log('\n── QA files a new retain ──');
let r = await call('POST', '/retention/boxes', { box_no: '20', destruction_date: '2028-12-31' }, A.headers);
const box = r.body;
t('an admin opens box 20', r.status === 201 && !!box?.id);
r = await call('POST', '/retention', { box_id: box.id, stage: 'finished_good', item_number: 'FG-1001', item_name: 'Pancake Mix', lot_number: '101900', retain_count: 3, lab_count: 2, batches: '1 BEG, 1 MIDDLE, 1 END' }, Q.headers);
const s1 = r.body;
t('the QA tech logs a pull: 3 retains, 2 lab (201)', r.status === 201 && s1?.retain_count === 3 && s1?.lab_count === 2 && s1?.created_by === 'Retain QA', `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
t('…collected today by the person who filed it', s1?.collected_date === new Date().toISOString().slice(0, 10) && s1?.collected_by === 'Retain QA');
r = await call('POST', '/retention', { box_id: box.id, item_name: 'Nothing', lot_number: '1', retain_count: 0, lab_count: 0 }, Q.headers);
t('a pull that kept nothing is refused', r.status === 400);

console.log('\n── a destroyed box takes nothing ──');
r = await call('POST', '/retention/boxes', { box_no: '14', destruction_date: '2020-01-31' }, A.headers);
const old = r.body;
r = await call('POST', `/retention/boxes/${old.id}/destroy`, { notes: 'Disposed of per schedule' }, A.headers);
t('box 14 recorded as destroyed', r.status === 200 && r.body?.status === 'destroyed');
const n0 = sampleCount();
r = await call('POST', '/retention', { box_id: old.id, item_name: 'Pancake Mix', lot_number: '101901', retain_count: 1 }, Q.headers);
t('filing into the destroyed box is refused, nothing written', r.status === 400 && /destroyed/.test(r.body?.error || '') && sampleCount() === n0);

console.log('\n── found again ──');
r = await call('GET', '/retention/by-lot/101900', undefined, Q.headers);
t('by lot: the retain, with its box', r.status === 200 && r.body?.length === 1 && r.body[0].box_no === '20');
r = await call('GET', '/retention?q=101900', undefined, Q.headers);
t('and in the log', r.status === 200 && (r.body?.samples || []).some(x => x.id === s1.id));
r = await call('PUT', `/retention/${s1.id}`, { ...s1, retain_count: 4 }, Q.headers);
t('a correction is in place and audited', r.status === 200 && r.body?.retain_count === 4
  && !!db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'retention_sample' AND entity_id = ? AND action = 'update'").get(s1.id), `${r.status}`);

console.log('\n── never deleted ──');
r = await call('DELETE', `/retention/${s1.id}`, undefined, A.headers);
t('an admin\'s DELETE is 403 RETENTION_DELETE_DISABLED', r.status === 403 && r.body?.code === 'RETENTION_DELETE_DISABLED', `${r.status} ${JSON.stringify(r.body)}`);
r = await call('DELETE', `/retention/${s1.id}`, undefined, Q.headers);
t('…and the QA tech\'s', r.status === 403);
t('…the row is still there, unchanged', db.prepare('SELECT retain_count FROM retention_samples WHERE id = ?').get(s1.id)?.retain_count === 4);
t('…and no delete was audited', !db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'retention_sample' AND action = 'delete'").get());

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
  await page.goto(`${URL}/?tab=retention-samples`);
  await page.getByRole('button', { name: /Log a pull/ }).waitFor({ timeout: 20000 });
  t('the screen offers "Log a pull"', true);
  await page.locator('td', { hasText: 'Pancake Mix' }).first().waitFor({ timeout: 10000 });
  t('the new retain is listed', true);
  t('no Delete button, even for an admin', await page.locator('[data-tip="Delete"]').count() === 0);
} catch (e) { t('the retention screen rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
