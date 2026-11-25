// D-396 (Maria, 25 Nov): a scale check filed under the wrong room can be
// corrected. QA corrects the room on an UNVERIFIED check with a reason; a
// verified one is revoked first; the readings and form never change.
//
// What this proves:
//   - a verified check refuses the correction (409 VERIFIED), naming the signer;
//   - the signer revokes; then QA corrects the room with a reason (no reason → 400);
//   - the readings, form and result are unchanged; the instrument link follows the room;
//   - the correction is audited with from / to / reason;
//   - an operator and a token cannot correct it;
//   - the screen offers Revoke verification, then Correct room.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5254;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
const CAL = JSON.stringify({ calibration: 'edit' });
mkUser('sr-a', 'Room Admin', 'admin', 'admin', null);
mkUser('sr-q', 'Room QA', 'supervisor', 'qa', CAL);
mkUser('sr-o', 'Room Operator', 'operator', 'filling', JSON.stringify({ calibration: 'view' }));
mkUser('sr-bot', 'Room Bot', 'supervisor', 'qa', CAL);
db.prepare(`INSERT INTO calibration_instruments (id, name, type, room, status) VALUES ('sr-i5', 'Stick filling scale', 'scale', 'ZZ5', 'active'), ('sr-i6', 'Stick filling scale B', 'scale', 'ZZ6', 'active')`).run();
const READ = JSON.stringify([{ nominal: 5, reading: 5.001 }, { nominal: 25, reading: 25.0 }, { nominal: 65, reading: 65.002 }]);
db.prepare(`INSERT INTO scale_verifications (id, form_code, form_title, room, instrument_id, performed_by, performed_at, readings, result, source, verified_by, verified_at)
  VALUES ('sr-1', 'FORM 417-03', 'Stick Filling', 'ZZ5', 'sr-i5', 'Debora Lezama', '2026-11-02 14:48:00', ?, 'pass', 'kiosk', 'Room QA', '2026-11-02 21:41:00')`).run(READ);

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
const A = await login('sr-a', 'Room Admin', 'RoomAdmin2026!');
const Q = await login('sr-q', 'Room QA', 'RoomQa2026666!');
const O = await login('sr-o', 'Room Operator', 'RoomOper2026!');
const BT = (await call('POST', '/api-tokens', { user_id: 'sr-bot', label: 'fixture room bot', scopes: ['read', 'write'] }, A.headers)).body?.plaintext;
const TK = { ...H, Authorization: `Bearer ${BT}` };
t('signed in (QA, an operator, an admin) and a fixture token', !!Q.token && !!O.token && !!BT);
const row = () => db.prepare("SELECT * FROM scale_verifications WHERE id = 'sr-1'").get();

let r = await call('PUT', '/scale-verification/sr-1/room', { room: 'ZZ6', reason: 'Debora entered room 5; it was room 6' }, Q.headers);
t('a verified check refuses the correction (409), naming the signer', r.status === 409 && r.body?.code === 'VERIFIED' && /Room QA/.test(r.body?.error || ''));
r = await call('DELETE', '/scale-verification/sr-1/verify', undefined, Q.headers);
t('the signer revokes the verification', r.status === 200 && !row().verified_by);
r = await call('PUT', '/scale-verification/sr-1/room', { room: 'ZZ6', reason: 'x' }, Q.headers);
t('no reason → 400', r.status === 400);
r = await call('PUT', '/scale-verification/sr-1/room', { room: 'ZZ6', reason: 'Debora entered room 5; it was room 6' }, O.headers);
t('an operator cannot correct it (403)', r.status === 403);
r = await call('PUT', '/scale-verification/sr-1/room', { room: 'ZZ6', reason: 'Debora entered room 5; it was room 6' }, TK);
t('a token cannot correct it (403)', r.status === 403);
t('…the room is unchanged', row().room === 'ZZ5');
r = await call('PUT', '/scale-verification/sr-1/room', { room: 'ZZ6', reason: 'Debora entered room 5; it was room 6' }, Q.headers);
const after = row();
t('QA corrects the room (ZZ5 → ZZ6)', r.status === 200 && after.room === 'ZZ6', JSON.stringify(r.body)?.slice(0, 200));
t('…the instrument link follows the room', after.instrument_id === 'sr-i6');
t('…readings, form, result and who did it are unchanged', after.readings === READ && after.form_code === 'FORM 417-03' && after.result === 'pass' && after.performed_by === 'Debora Lezama');
t('…audited with from, to and the reason', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_id = 'sr-1' AND details LIKE '%room_corrected%' AND details LIKE '%\"from\":\"ZZ5\"%' AND details LIKE '%\"to\":\"ZZ6\"%' AND details LIKE '%it was room 6%'").get());

console.log('\n── on the screen ──');
db.prepare("UPDATE scale_verifications SET verified_by = 'Room QA', verified_at = datetime('now') WHERE id = 'sr-1'").run();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (d.message().startsWith('Why') ? 'Wrong room typed' : '7') : undefined));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
  await page.goto(`${URL}/?tab=calibration&view=scale-verification`);
  await page.waitForTimeout(3000);
  const rowEl = page.locator('tr:has-text("FORM 417-03"):visible, tr:has-text("Stick Filling"):visible').first();
  await rowEl.click({ timeout: 15000 });
  await page.locator('[data-scale-revoke="sr-1"]').click({ timeout: 10000 });
  await page.locator('[data-scale-correct-room="sr-1"]').waitFor({ timeout: 10000 });
  t('the screen offers Revoke verification, then Correct room', !row().verified_by);
  await page.locator('[data-scale-correct-room="sr-1"]').click();
  await page.waitForTimeout(1500);
  t('correcting from the screen moves the room', row().room === '7', row().room);
} catch (e) { t('the scale tab rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
