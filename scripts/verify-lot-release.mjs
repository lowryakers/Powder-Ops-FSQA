// D-388 (A-20261124-001): where a lot was released. Release is signed in
// Keychain; ReadyDoc records the reference a person types afterwards and shows
// it read-only on the lot in Look up records.
//
// What this proves:
//   - QA records a reference (ID and/or link) for a lot; it shows on that lot, with who and when;
//   - a second lot is unaffected;
//   - a correction needs a reason, keeps the old row, and never deletes;
//   - a token, a bot account and a non-QA person cannot write it;
//   - Look up records still returns its record types;
//   - the form registry still lists FORM 405-1 / 405-02 as Keychain's;
//   - the lot view shows it, read-only, in a browser.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5246;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
const READS = JSON.stringify({ 'production-log': 'view', 'receiving-log': 'view', disposals: 'view' });
mkUser('lr-a', 'Release Admin', 'admin', 'admin', null);
mkUser('lr-q', 'Release QA', 'supervisor', 'qa', READS);
mkUser('lr-w', 'Release Warehouse', 'supervisor', 'warehouse', READS);
mkUser('lr-bot', 'Release Bot', 'supervisor', 'qa', READS);
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
const A = await login('lr-a', 'Release Admin', 'ReleaseAdmin2026!');
const Q = await login('lr-q', 'Release QA', 'ReleaseQa20266!');
const W = await login('lr-w', 'Release Warehouse', 'ReleaseWh20266!');
const BOT = await login('lr-bot', 'Release Bot', 'ReleaseBot2026!');
const BT = (await call('POST', '/api-tokens', { user_id: 'lr-bot', label: 'fixture release bot', scopes: ['read', 'write'] }, A.headers)).body?.plaintext;
const TK = { ...H, Authorization: `Bearer ${BT}` };
t('signed in (QA, a warehouse supervisor, an admin), and a fixture bot token', !!Q.token && !!W.token && !!BT);

const rows = () => db.prepare('SELECT * FROM lot_release_refs ORDER BY rowid').all();
let r = await call('GET', '/records/lot-release?lot=101692', undefined, Q.headers);
t('a lot with nothing recorded reads no reference', r.status === 200 && r.body?.current === null && r.body?.can_record === true, JSON.stringify(r.body));

console.log('\n── a person records it ──');
r = await call('POST', '/records/lot-release', { lot: '101692', keychain_ref: 'KC-REL-5531', url: 'https://keychain.example/release/5531' }, Q.headers);
t('QA records the Keychain ID and link for lot 101692', r.status === 201 && r.body?.current?.keychain_ref === 'KC-REL-5531' && r.body.current.recorded_by === 'Release QA' && !!r.body.current.recorded_at, JSON.stringify(r.body));
r = await call('GET', '/records/lot-release?lot= 101692 ', undefined, W.headers);
t('it shows on that lot for anyone who can read records (spacing ignored)', r.body?.current?.keychain_ref === 'KC-REL-5531' && r.body?.can_record === false);
r = await call('GET', '/records/lot-release?lot=101693', undefined, Q.headers);
t('a second lot is unaffected', r.body?.current === null);

console.log('\n── who may not write it ──');
const n0 = rows().length;
r = await call('POST', '/records/lot-release', { lot: '101693', keychain_ref: 'KC-X' }, W.headers);
t('a warehouse supervisor cannot (403)', r.status === 403);
r = await call('POST', '/records/lot-release', { lot: '101693', keychain_ref: 'KC-X' }, TK);
t('a token cannot (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', '/records/lot-release', { lot: '101693', keychain_ref: 'KC-X' }, BOT.headers);
t('a bot account signing in itself cannot (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
t('…and nothing was written by any of them', rows().length === n0);
r = await call('POST', '/records/lot-release', { lot: '101693' }, Q.headers);
t('neither an ID nor a link is refused', r.status === 400);
r = await call('POST', '/records/lot-release', { lot: '101693', url: 'keychain.example/5531' }, Q.headers);
t('a link that is not a web address is refused', r.status === 400);

console.log('\n── a correction keeps the old one ──');
r = await call('POST', '/records/lot-release', { lot: '101692', keychain_ref: 'KC-REL-5532' }, Q.headers);
t('correcting without a reason is refused', r.status === 400 && r.body?.code === 'REASON_REQUIRED');
r = await call('POST', '/records/lot-release', { lot: '101692', keychain_ref: 'KC-REL-5532', reason: 'Typed the wrong release number' }, Q.headers);
t('with a reason the new reference is current, the old one in its history', r.status === 201 && r.body?.current?.keychain_ref === 'KC-REL-5532'
  && r.body.history.length === 1 && r.body.history[0].keychain_ref === 'KC-REL-5531' && /wrong release/.test(r.body.history[0].supersede_reason));
t('…both rows are still in the table (nothing deleted)', rows().filter(x => x.lot_key === '101692').length === 2);
t('…and both acts are audited', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'lot_release_ref_%'").get().n === 2);

console.log('\n── nothing else moved ──');
r = await call('GET', '/records/types', undefined, Q.headers);
t('Look up records still lists its record types', r.status === 200 && Array.isArray(r.body) && r.body.length > 0);
r = await call('GET', '/records?lot=101692', undefined, Q.headers);
t('…and still answers a lot lookup', r.status === 200 && typeof r.body?.total === 'number');
const { FORM_REGISTRY } = await import('../shared/form-registry.js');
t('FORM 405-1 and 405-02 are still Keychain\'s', ['FORM 405-1', 'FORM 405-02'].every(c => FORM_REGISTRY.find(f => f.code === c)?.where === 'keychain'));
const { readFileSync } = await import('fs');
t('the reference is not a signature: no gateSignature in the release module', !/gateSignature\s*\(|signature\.js/.test(readFileSync(new globalThis.URL('../server/lot-release.js', import.meta.url), 'utf8')));

console.log('\n── on the lot, in a browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [W.token, W.user]);
  await page.goto(`${URL}/?tab=records&rec_lot=101692`);
  const box = page.locator('[data-keychain-release]');
  await box.waitFor({ timeout: 20000 });
  t('lot 101692 shows "Release (signed in Keychain)" with the ID and who recorded it',
    /KC-REL-5532/.test(await box.innerText()) && /Recorded by Release QA/.test(await box.innerText()) && /signed in Keychain/.test(await box.innerText()));
  t('…read only for a warehouse supervisor (no record or correct button)', await box.locator('[data-keychain-release-edit]').count() === 0);
  await page.goto(`${URL}/?tab=records&rec_lot=101693`);
  await page.locator('[data-keychain-release]').waitFor({ timeout: 20000 });
  t('lot 101693 says no reference is recorded', await page.locator('[data-keychain-release-none]').count() === 1);
} catch (e) { t('the lot view rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
