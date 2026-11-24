// D-389 (A-20261124-002): a failed X-ray or metal-detector check puts the lot on
// hold. The operation log stays in Keychain; a person logs the failure and an
// ordinary Form 424-01 On Hold record is filed.
//
// What this proves:
//   - a person logs a failed X-ray check: an on_hold record exists for that lot,
//     its reason naming the check and the machine, placed by that person;
//   - a metal-detector failure on a machine typed by hand works too;
//   - a second log is a second hold (two failures are two events);
//   - a token and a bot account cannot log one, and nothing is written;
//   - a token cannot release the hold; a person releases it on the usual path;
//   - the door is on the Operator View, and logging from it files the hold.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5247;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('fc-a', 'Check Admin', 'admin', 'admin', null);
mkUser('fc-op', 'Check Operator', 'operator', 'filling', JSON.stringify({ operator: 'view', 'on-hold': 'view' }));
mkUser('fc-q', 'Check QA', 'supervisor', 'qa', JSON.stringify({ 'on-hold': 'edit' }));
mkUser('fc-bot', 'Check Bot', 'supervisor', 'qa', JSON.stringify({ 'on-hold': 'edit' }));
db.prepare(`INSERT INTO equipment (id, name, type, asset_id, location, status) VALUES ('fc-xr', 'X-Ray Inspection System', 'X-Ray', '301', 'Room 4', 'active')`).run();
db.prepare(`INSERT INTO equipment (id, name, type, asset_id, location, status) VALUES ('fc-mixer', 'Ribbon Mixer', 'Mixer', '302', 'Batching 1', 'active')`).run();

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
const A = await login('fc-a', 'Check Admin', 'CheckAdmin2026!');
const OP = await login('fc-op', 'Check Operator', 'CheckOperator2026!');
const Q = await login('fc-q', 'Check QA', 'CheckQa202666!');
const BOT = await login('fc-bot', 'Check Bot', 'CheckBot20266!');
const BT = (await call('POST', '/api-tokens', { user_id: 'fc-bot', label: 'fixture check bot', scopes: ['read', 'write'] }, A.headers)).body?.plaintext;
const TK = { ...H, Authorization: `Bearer ${BT}` };
t('signed in (an operator, QA, an admin) and a fixture bot token', !!OP.token && !!Q.token && !!BT);

const holds = () => db.prepare("SELECT * FROM qms_records WHERE record_type = 'on_hold' ORDER BY created_at, rowid").all()
  .map(r => ({ ...r, data: JSON.parse(r.data || '{}') }));

let r = await call('GET', '/qms/on_hold/failed-check', undefined, OP.headers);
t('the machine list offers the X-ray and not the mixer', r.status === 200 && r.body?.machines?.some(m => m.id === 'fc-xr') && !r.body.machines.some(m => m.id === 'fc-mixer'), JSON.stringify(r.body));

console.log('\n── a person logs a failed check ──');
r = await call('POST', '/qms/on_hold/failed-check', { check: 'xray', equipment_id: 'fc-xr', lot: '101692', product: 'Pancake Mix', qty: '40 cases', what_happened: 'Reject on a pouch, foreign body flagged' }, OP.headers);
t('an operator logs a failed X-ray check (201)', r.status === 201 && r.body?.record_type === 'on_hold', `${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
const h1 = holds().find(h => h.id === r.body?.id);
t('…an On Hold record for lot 101692, status on_hold', h1?.data?.lot === '101692' && h1?.status === 'on_hold');
t('…its reason names the check and the machine', /^Failed X-ray check — X-Ray Inspection System #301: Reject on a pouch/.test(h1?.data?.reason || ''), h1?.data?.reason);
t('…placed by the person who logged it, at the machine\'s location', /Check Operator/.test(h1?.data?.placed_by || '') && h1?.data?.location === 'Room 4' && h1?.created_by === 'Check Operator');
t('…and the audit says a failed check was logged', !!db.prepare("SELECT 1 FROM audit_log WHERE action LIKE 'failed_check_logged%' AND entity_id = ?").get(h1?.id));
r = await call('POST', '/qms/on_hold/failed-check', { check: 'metal_detector', machine_name: 'Line 2 metal detector', lot: '101700', what_happened: 'Test wand not rejected' }, OP.headers);
t('a metal-detector failure on a machine typed by hand files too', r.status === 201 && /^Failed Metal detector check — Line 2 metal detector/.test(holds().find(h => h.id === r.body?.id)?.data?.reason || ''));
r = await call('POST', '/qms/on_hold/failed-check', { check: 'xray', equipment_id: 'fc-xr', lot: '101692', what_happened: 'Second reject an hour later' }, OP.headers);
t('a second log is a second hold — two failures are two events', r.status === 201 && holds().filter(h => h.data.lot === '101692').length === 2);
r = await call('POST', '/qms/on_hold/failed-check', { check: 'xray', equipment_id: 'fc-xr', what_happened: 'x' }, OP.headers);
t('no lot is refused', r.status === 400);
r = await call('POST', '/qms/on_hold/failed-check', { check: 'scale', equipment_id: 'fc-xr', lot: '1', what_happened: 'xxx' }, OP.headers);
t('a check that is neither X-ray nor metal detector is refused', r.status === 400);

console.log('\n── no bot files or releases a hold ──');
const n0 = holds().length;
r = await call('POST', '/qms/on_hold/failed-check', { check: 'xray', equipment_id: 'fc-xr', lot: '999', what_happened: 'bot test' }, TK);
t('a token cannot log a failed check (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', '/qms/on_hold/failed-check', { check: 'xray', equipment_id: 'fc-xr', lot: '999', what_happened: 'bot test' }, BOT.headers);
t('a bot account signing in itself cannot either (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
t('…and no hold was written', holds().length === n0);
r = await call('PUT', `/qms/on_hold/${h1.id}`, { status: 'released', released_by: 'bot' }, TK);
t('a token cannot release the hold (403), it stays on hold', r.status === 403 && holds().find(h => h.id === h1.id).status === 'on_hold', `${r.status}`);
r = await call('PUT', `/qms/on_hold/${h1.id}`, { status: 'released', released_by: `today Check QA` }, Q.headers);
t('QA releases it on the usual On Hold path', r.status === 200 && holds().find(h => h.id === h1.id).status === 'released', `${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);

console.log('\n── the door on the Operator View ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [OP.token, OP.user]);
  await page.goto(`${URL}/?tab=operator`);
  const card = page.locator('[data-failed-check-card]');
  await card.waitFor({ timeout: 20000 });
  t('the operator sees "Failed X-ray or metal detector check?"', /Failed X-ray or metal detector check\?/.test(await card.innerText()));
  await card.locator('[data-failed-check-open]').click();
  await card.locator('[data-failed-check-machine] option[value="fc-xr"]').waitFor({ state: 'attached', timeout: 10000 });
  await card.locator('[data-failed-check-machine]').selectOption('fc-xr');
  await card.locator('[data-failed-check-lot]').fill('101800');
  await card.locator('[data-failed-check-what]').fill('Reject on the test piece');
  await card.locator('[data-failed-check-save]').click();
  await card.locator('[data-failed-check-msg]').waitFor({ timeout: 10000 });
  t('logging from the phone files the hold and says QA releases it', /on hold/.test(await card.locator('[data-failed-check-msg]').innerText())
    && holds().some(h => h.data.lot === '101800' && h.status === 'on_hold'));
  t('no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
} catch (e) { t('the Operator View door rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
