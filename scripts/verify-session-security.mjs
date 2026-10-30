// Executed, not asserted: the session and backup controls (D-290 – D-293).
//   1. the daily database backup — stored off the server (the S3 stand-in),
//      30 daily + 12 monthly retention, a restore test that downloads the copy
//      and opens it, and the bell line while no backup has succeeded;
//   2. idle sign-out — 15 minutes on a shared device, 8 hours otherwise, and
//      only a person's input moves the clock;
//   3. an admin reset gives a temporary password that opens one door (choose
//      your own) and expires;
//   4. the first signature of a session needs the sign-in name as well as the
//      password, later ones the password alone;
//   5. a printed record carries each signature's meaning in words.
// Runs with SIGNATURE_NAME_OPTIONAL=0. Needs a built client and the S3 stand-in.
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

const PORT = process.env.PORT || 5171;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const req = (p, tok, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 5000');
const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
mk('sec-admin', 'Ada Admin', 'admin', 'admin', null);
mk('sec-qa', 'Quinn Signer', 'supervisor', 'qa', '{"sanitation":"edit","qa-inspections":"edit"}');
mk('sec-op', 'Otto Floor', 'operator', 'warehouse', '{"sanitation":"edit"}');
mk('sec-none', 'Nell Nomodule', 'operator', 'warehouse', '{"training":"view"}');

const setPw = (id, pw) => req('/users/set-password', null, { method: 'POST', body: JSON.stringify({ user_id: id, password: pw, setup_code: 'SEED-CODE' }) });
const login = async (name, password, extra = {}) => J(await req('/users/login', null, { method: 'POST', body: JSON.stringify({ name, password, ...extra }) }));
await setPw('sec-admin', 'AdaSecret2026'); await setPw('sec-qa', 'QuinnSecret2026'); await setPw('sec-op', 'OttoSecret2026'); await setPw('sec-none', 'NellSecret2026');
const admin = (await login('Ada Admin', 'AdaSecret2026')).token;
const ACT = { 'X-User-Activity': '1' };

// ── 1. backups ─────────────────────────────────────────────────────────────
console.log('\n── daily database backup ──');
let h = await J(await req('/compliance/db-backups', admin));
t('off-server storage is on (S3 stand-in)', h?.storage_on === true);
t('before any backup: stale, none kept', h?.stale === true && h.daily === 0);
let bell = await J(await req('/compliance/notifications', admin));
const items = (b) => (b?.items || b?.notifications || []);
t('the bell tells an admin no backup has left the server', JSON.stringify(bell).includes('db-backup'));
let r = await req('/compliance/db-backups/run', admin, { method: 'POST', body: '{}' });
let run = await J(r);
t('Back up now stores the database', r.status === 200 && run.ok && /^backups\/db\/daily\/compliance-\d{4}-\d{2}-\d{2}\.db$/.test(run.key), JSON.stringify(run).slice(0, 200));
t('the first backup of the month is also kept as the monthly copy', run.monthly === true);
t('its fingerprint is recorded', /^[0-9a-f]{64}$/.test(run.sha256 || ''));
r = await req('/compliance/db-backups/run', admin, { method: 'POST', body: '{}' });
h = await J(await req('/compliance/db-backups', admin));
t('a second run the same day keeps one daily and one monthly', h.daily === 1 && h.monthly === 1, `${h.daily}/${h.monthly}`);
t('no longer stale', h.stale === false);
r = await req('/compliance/db-backups/restore-test', admin, { method: 'POST', body: '{}' });
const rt = await J(r);
t('the restore test downloads the copy and it passes the integrity check', r.status === 200 && rt.ok && rt.integrity === 'ok', JSON.stringify(rt).slice(0, 200));
t('the downloaded copy matches its recorded fingerprint', rt.sha256_matches === true);
t('the restored copy holds the tables and the users', rt.tables > 50 && rt.users >= 3, `${rt.tables} tables, ${rt.users} users`);
t('no table is missing from the backup', (rt.missing_tables || []).length === 0);
h = await J(await req('/compliance/db-backups', admin));
t('a restore test on file: not due', h.restore_due === false && h.restore_test?.ok === true);
r = await req('/compliance/db-backups/run', (await login('Otto Floor', 'OttoSecret2026')).token, { method: 'POST', body: '{}' });
t('a non-admin cannot run a backup', r.status === 403, `${r.status}`);
t('both acts are in the audit log', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'database' AND action IN ('backup','restore_test')").get().n >= 3);
{
  const { planRetention } = await import('../server/db-backup.js');
  const list = [];
  for (let i = 1; i <= 40; i++) list.push({ kind: 'daily', period: `2026-0${1 + Math.floor((i - 1) / 28)}-${String(((i - 1) % 28) + 1).padStart(2, '0')}`, key: `d${i}` });
  for (let m = 1; m <= 14; m++) list.push({ kind: 'monthly', period: `20${25 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`, key: `m${m}` });
  const { keep, drop } = planRetention(list);
  t('retention keeps the newest 30 daily and 12 monthly copies', keep.filter(b => b.kind === 'daily').length === 30 && keep.filter(b => b.kind === 'monthly').length === 12 && drop.length === 12);
  t('the oldest are the ones dropped', drop.some(b => b.key === 'd1') && drop.some(b => b.key === 'm1') && !drop.some(b => b.key === 'd40'));
}

// ── 2. idle sign-out ───────────────────────────────────────────────────────
console.log('\n── idle sign-out ──');
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const setLast = (tok, iso) => db.prepare('UPDATE sessions SET last_active_at = ? WHERE token = ?').run(iso, tok);
let s = await login('Otto Floor', 'OttoSecret2026', { shared_device: true });
t('a shared-device sign-in is told 15 minutes', s.user?.idle_minutes === 15 && s.user.shared_device === true);
setLast(s.token, ago(14));
t('14 minutes unused: still signed in', (await req('/users/me', s.token)).status === 200);
setLast(s.token, ago(16));
r = await req('/users/me', s.token); let body = await J(r);
t('16 minutes unused on a shared device: signed out', r.status === 401 && body.idle_timeout === true && body.idle_minutes === 15, `${r.status}`);
t('the session is gone', !db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(s.token));
t('the idle sign-out is in the audit log', !!db.prepare("SELECT 1 FROM audit_log WHERE action = 'logout' AND details LIKE '%idle%' AND entity_id = 'sec-op'").get());
s = await login('Otto Floor', 'OttoSecret2026');
t('a personal sign-in is told 8 hours', s.user?.idle_minutes === 480);
setLast(s.token, ago(7 * 60));
t('7 hours unused on a personal device: still signed in', (await req('/users/me', s.token)).status === 200);
setLast(s.token, ago(5));
await req('/users/me', s.token);
let last = db.prepare('SELECT last_active_at FROM sessions WHERE token = ?').get(s.token).last_active_at;
t('a request with no input behind it does not move the clock (a badge poll)', Date.parse(last) < Date.now() - 4 * 60000);
await req('/users/me', s.token, { headers: ACT });
last = db.prepare('SELECT last_active_at FROM sessions WHERE token = ?').get(s.token).last_active_at;
t('a request after a person touched the screen moves it', Date.parse(last) > Date.now() - 60000);
setLast(s.token, ago(9 * 60));
t('9 hours unused on a personal device: signed out', (await req('/users/me', s.token)).status === 401);

// ── 3. reset gives a temporary password ────────────────────────────────────
console.log('\n── admin reset: a temporary password ──');
const before = (await login('Otto Floor', 'OttoSecret2026')).token;
r = await req('/users/sec-op/reset-password', admin, { method: 'POST', body: '{}' });
const reset = await J(r);
t('the reset hands back a temporary password, once', r.status === 200 && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(reset.temporary_password || '') && reset.expires_in_days === 3);
t('it signed out every device the person was on', (await req('/users/me', before)).status === 401);
t('the old password no longer works', !(await login('Otto Floor', 'OttoSecret2026')).token);
const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'password_reset' AND entity_id = 'sec-op' ORDER BY timestamp DESC LIMIT 1").get();
t('the reset is logged, as a temporary password', /temporary_password/.test(audit?.details || ''));
t('the temporary password itself is in no audit row', !db.prepare('SELECT 1 FROM audit_log WHERE details LIKE ?').get(`%${reset.temporary_password}%`));
s = await login('Otto Floor', reset.temporary_password);
t('it signs the person in, marked temporary and to be changed', !!s.token && s.user.temporary_password === true && s.user.password_expired === true);
r = await req('/sanitation', s.token);
t('with it, nothing else opens', r.status === 403 && (await J(r)).temporary_password === true, `${r.status}`);
r = await req('/users/me/password', s.token, { method: 'POST', body: JSON.stringify({ current_password: reset.temporary_password, new_password: reset.temporary_password }) });
t('the temporary password cannot be kept as the new one', r.status === 400);
r = await req('/users/me/password', s.token, { method: 'POST', body: JSON.stringify({ current_password: reset.temporary_password, new_password: 'OttoNewSecret2026' }) });
t('choosing their own password works', r.status === 200);
t('and the account is no longer temporary', db.prepare("SELECT must_change_password m FROM users WHERE id = 'sec-op'").get().m === 0);
t('the same session now opens the app', (await req('/sanitation', s.token)).status === 200);
const reset2 = await J(await req('/users/sec-op/reset-password', admin, { method: 'POST', body: '{}' }));
db.prepare("UPDATE users SET temp_password_expires_at = ? WHERE id = 'sec-op'").run(ago(60));
r = await req('/users/login', null, { method: 'POST', body: JSON.stringify({ name: 'Otto Floor', password: reset2.temporary_password }) });
t('a temporary password past its three days is refused', r.status === 401 && /expired/.test((await J(r)).error || ''));

// ── 4. first signature of a session ────────────────────────────────────────
console.log('\n── the first signature of a session ──');
let qa = (await login('Quinn Signer', 'QuinnSecret2026')).token;
const newClean = async (area) => J(await req('/sanitation', qa, { method: 'POST', body: JSON.stringify({ area, type: 'pre_op', result: 'pass', performed_by: 'Otto Floor' }) }));
const c1 = await newClean('3'); const c2 = await newClean('4'); const c3 = await newClean('5');
const verify = (id, body, tok = qa) => req(`/sanitation/${id}/verify`, tok, { method: 'PUT', body: JSON.stringify(body) });
r = await verify(c1.id, { signature_password: 'QuinnSecret2026' }); body = await J(r);
t('the first signature with the password alone asks for the name too', r.status === 403 && body.signature_required && body.signature_name_required, `${r.status}`);
r = await verify(c1.id, { signature_password: 'QuinnSecret2026', signature_name: 'Somebody Else' }); body = await J(r);
t('a name that is not theirs is refused', r.status === 403 && body.signature_name_required && /not the one/.test(body.error));
r = await verify(c1.id, { signature_password: 'WrongPass', signature_name: 'Quinn Signer' });
t('the right name with the wrong password is refused', r.status === 403);
r = await verify(c1.id, { signature_password: 'QuinnSecret2026', signature_name: ' quinn signer ' });
t('their sign-in name (any case, spaces trimmed) and password sign it', r.status === 200, `${r.status}`);
t('the session records its first signature', !!db.prepare('SELECT first_signed_at f FROM sessions WHERE token = ?').get(qa).f);
r = await verify(c2.id, { signature_password: 'QuinnSecret2026' });
t('the next signature in the same session takes the password alone', r.status === 200, `${r.status}`);
qa = (await login('Quinn Signer', 'QuinnSecret2026')).token;
r = await verify(c3.id, { signature_password: 'QuinnSecret2026' });
t('a new session asks for the name again', r.status === 403 && (await J(r)).signature_name_required === true);
await verify(c3.id, { signature_password: 'QuinnSecret2026', signature_name: 'Quinn Signer' });

// ── 5. printouts carry the meaning ─────────────────────────────────────────
console.log('\n── a printed record names what each signature means ──');
r = await req(`/records/sanitation/${c1.id}/pdf`, qa);
t('the signed record prints as a PDF', r.status === 200 && /pdf/.test(r.headers.get('content-type') || ''));
const dir = mkdtempSync(path.join(os.tmpdir(), 'secpdf-'));
const file = path.join(dir, 'r.pdf');
writeFileSync(file, Buffer.from(await r.arrayBuffer()));
const text = execFileSync('pdftotext', [file, '-']).toString();
t('it names the signer', text.includes('Quinn Signer'));
t('it prints the meaning in words', text.includes('Meaning: Reviewed and verified by QA'));
t('it prints when, in plant time', /Signed: [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M M[SD]T/.test(text), text.slice(0, 300));
r = await req(`/records/sanitation/${c1.id}/pdf`, (await login('Nell Nomodule', 'NellSecret2026')).token);
t('the same read rule as the record: someone without the module gets 404', r.status === 404, `${r.status}`);
{
  const { printedSignatures } = await import('../server/signed-record-pdf.js');
  const q = printedSignatures({ type: 'qms', signatures: [{ name: 'Maria S', at: '2026-10-30T20:00:00Z', label: 'QA Approval' }] });
  t('a QMS approval prints "Approved as <role>"', q[0]?.meaning === 'Approved as QA Approval');
  const sc = printedSignatures({ type: 'scale', signed_by: 'Quinn', signed_at: '2026-10-30T20:00:00Z' });
  t('a scale check prints its own meaning', /daily scale check/.test(sc[0]?.meaning || ''));
}
const idledToken = (await login('Quinn Signer', 'QuinnSecret2026', { shared_device: true })).token;
setLast(idledToken, ago(20));
db.close();

// ── the screen ─────────────────────────────────────────────────────────────
console.log('\n── on screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate((tok) => { localStorage.setItem('auth_token', tok); localStorage.removeItem('auth_user'); }, idledToken);
  await page.goto(URL);
  await page.waitForSelector('[data-shared-device]', { timeout: 15000 });
  t('a session idled out opens on the login screen', true);
  t('which says why', (await page.locator('[data-idle-notice]').textContent().catch(() => ''))?.includes('15 minutes'));
  await page.locator('[data-shared-device] input').check();
  t('the shared-device choice is remembered on the device', await page.evaluate(() => localStorage.getItem('shared_device')) === '1');
  t('and the screen says what it does', /15 minutes/.test(await page.locator('[data-shared-device]').textContent()));
  const ada = (await login('Ada Admin', 'AdaSecret2026')).token;
  await page.evaluate((tok) => localStorage.setItem('auth_token', tok), ada);
  await page.goto(`${URL}/?tab=settings&section=backup`);
  await page.waitForSelector('[data-db-backups]', { timeout: 15000 });
  t('Settings → Data backup shows the daily backup card', /1 daily · 1 monthly/.test(await page.locator('[data-db-backup-kept]').textContent()));
  t('and the last restore test, passed', /passed/.test(await page.locator('[data-restore-test-last]').textContent()));
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
