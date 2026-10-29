// verify:useractivity — the activity log against a real server (D-261).
// Sign-ins, sign-outs, timeouts and revoked sessions; page views (batched),
// record views (once per five minutes), edits with their field-level change,
// writes no audit entry covers, downloads and file opens; the admin-only screen,
// the read-only bot door, the CSV, and that no password ever reaches the log.
//
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: remove `app.use('/api', activityMiddleware)` and `startUserActivity()`
// from server.js — the first sign-in assertion fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5156);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

const PW = 'Activity2026!!';
const NEW_PW = 'Changed-Secret-77!';
const db = new Database(DBP);
const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ua-admin', 'Ada Admin', 'admin', 'admin');
mk('ua-op', 'Otto Operator', 'operator', 'warehouse', { equipment: 'edit', operator: 'view' });
mk('ua-sup', 'Sue Supervisor', 'supervisor', 'qa', { equipment: 'view', 'user-activity': 'view' });
mk('ua-bot', 'Log Reader Bot', 'supervisor', 'office', { 'user-activity': 'view' });
mk('ua-bot2', 'Other Bot', 'supervisor', 'office', { equipment: 'view' });
db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, room, asset_id, status, task_group, asset_kind)
  VALUES ('ua-eq-1', 'Activity Test Mixer', 'Mixer', 'Production', 'UA-1', 'active', 'maintenance', 'machine')`).run();
const auditBefore = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
db.close();

const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
};
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json;
};
const acts = (userId, action) => q('SELECT * FROM user_activity WHERE user_id = ? AND action = ? ORDER BY id', userId, action);
const flush = (tok) => call('GET', '/user-activity?limit=1', null, tok); // a read flushes the queue first

console.log('\n── signing in and out ──');
const admin = await signIn('Ada Admin', 'ua-admin');
const op = await signIn('Otto Operator', 'ua-op');
const sup = await signIn('Sue Supervisor', 'ua-sup');
t('sessions', !!admin?.token && !!op?.token && !!sup?.token);
t('signing in is recorded', acts('ua-op', 'login').length >= 1, JSON.stringify(acts('ua-op', 'login')));
t('…in UTC', /Z$/.test(acts('ua-op', 'login')[0]?.occurred_at || ''));

console.log('\n── page views, batched ──');
let r = await call('POST', '/user-activity/events', { events: [
  { type: 'page_view', page: 'equipment', at: new Date().toISOString() },
  { type: 'page_view', page: 'equipment', at: new Date().toISOString() },
  { type: 'page_view', page: 'sanitation?token=secret-in-a-link', view: 'log' },
  { type: 'file_open', page: '/uploads/abc.pdf', name: 'Gown SOP.pdf' },
  { type: 'edit', page: 'not allowed from a screen' },
] }, op.token);
t('the screen sends a batch and is told how many were taken', r.status === 200 && r.json?.accepted === 3, `${r.status} ${r.text}`);
t('…the batch is not written until the queue flushes (no row yet)', acts('ua-op', 'page_view').length === 0);
await flush(admin.token);
const pv = acts('ua-op', 'page_view');
t('…then it is: the same page twice in a row is one view', pv.filter(x => x.page === 'equipment').length === 1, JSON.stringify(pv.map(x => x.page)));
t('…a query string never reaches the log', pv.some(x => x.page === 'sanitation') && !q("SELECT 1 FROM user_activity WHERE page LIKE '%secret-in-a-link%'").length);
t('a file opened from a stored link is recorded by name', acts('ua-op', 'file_open').some(x => /Gown SOP\.pdf/.test(x.details || '')));
t('a screen cannot claim an edit through the event door', !acts('ua-op', 'edit').some(x => /not allowed/.test(x.page || '')));
r = await call('POST', '/user-activity/events', { events: Array.from({ length: 51 }, () => ({ type: 'page_view', page: 'x' })) }, op.token);
t('more than 50 events at once is refused', r.status === 400);

console.log('\n── record views ──');
await call('GET', '/equipment/ua-eq-1', null, op.token);
await call('GET', '/equipment/ua-eq-1', null, op.token);
await call('GET', '/equipment', null, op.token);
await flush(admin.token);
const rv = acts('ua-op', 'record_view');
t('opening a record is recorded once in five minutes', rv.filter(x => x.record_id === 'ua-eq-1').length === 1, JSON.stringify(rv.map(x => x.page)));
t('a list is not a record view', !rv.some(x => x.page === '/api/equipment'));

console.log('\n── edits, field by field ──');
r = await call('PUT', '/equipment/ua-eq-1', { notes: 'belt replaced', manufacturer: 'Hobart' }, op.token);
t('an edit saves', r.status === 200, String(r.status));
const ed = acts('ua-op', 'edit').find(x => x.record_id === 'ua-eq-1');
const det = ed ? JSON.parse(ed.details) : {};
t('the edit is recorded against the record', !!ed && ed.record_type === 'equipment' && ed.audit_id != null);
t('…with each changed field, its old value and its new one', det.changes?.some(c => c.field === 'notes' && c.from === null && c.to === 'belt replaced')
  && det.changes?.some(c => c.field === 'manufacturer' && c.to === 'Hobart'), JSON.stringify(det.changes));
t('…and only the fields that changed', !det.changes?.some(c => c.field === 'name'));
t('one edit is one row (the audit entry and the request are not both counted)', acts('ua-op', 'edit').filter(x => x.record_id === 'ua-eq-1').length === 1);

const chan = (await call('POST', '/comms/channels', { name: 'activity-test', kind: 'public' }, admin.token)).json;
r = await call('POST', `/comms/channels/${chan?.id}/messages`, { body: 'this message text is private' }, admin.token);
t('a write that keeps no audit entry still leaves a row', r.status < 300 && acts('ua-admin', 'edit').some(x => /\/messages$/.test(x.page || '')), `${r.status}`);
t('…naming the fields, never the words of a message', !q("SELECT 1 FROM user_activity WHERE details LIKE '%this message text is private%'").length);
const fb = acts('ua-admin', 'edit').find(x => /\/messages$/.test(x.page || ''));
t('…and saying there is no "before" for it', /not recorded/.test(fb?.details || ''));

console.log('\n── passwords, downloads, sign-out, timeouts ──');
const op2 = (await call('POST', '/users/login', { name: 'Otto Operator', password: PW })).json;
r = await call('POST', '/users/me/password', { current_password: PW, new_password: NEW_PW }, op.token);
t('changing a password works and signs the other sessions out', r.status === 200 && r.json?.other_sessions_signed_out >= 1, r.text);
t('each other session ending is recorded', acts('ua-op', 'session_revoked').length === r.json?.other_sessions_signed_out);
t('no password, old or new, is anywhere in the activity log', !q('SELECT 1 FROM user_activity WHERE details LIKE ? OR details LIKE ? OR page LIKE ?', `%${PW}%`, `%${NEW_PW}%`, `%${PW}%`).length);
t('no session token is anywhere in the activity log', !q('SELECT 1 FROM user_activity WHERE details LIKE ? OR details LIKE ?', `%${op.token}%`, `%${op2?.token}%`).length);
r = await fetch(`${URL}/api/audit/export`, { headers: { Authorization: `Bearer ${admin.token}` } });
await r.text();
await flush(admin.token);
t('a download is recorded', acts('ua-admin', 'download').some(x => x.page === '/api/audit/export'), String(r.status));
await call('POST', '/users/logout', null, op.token);
t('signing out is recorded', acts('ua-op', 'logout').length === 1);
const raw = new Database(DBP);
raw.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES ('ua-old', 'ua-sup', 'ua-old-tok', ?)`).run(new Date(Date.now() - 600e3).toISOString());
raw.close();
await flush(admin.token);
const tmo = acts('ua-sup', 'session_timeout');
t('a session that ran out is a timeout, dated when it expired', tmo.length === 1 && Date.now() - Date.parse(tmo[0].occurred_at) >= 590e3, JSON.stringify(tmo));
r = await call('GET', '/equipment', null, 'ua-old-tok');
t('…and that session no longer works', r.status === 401);

console.log('\n── who may read it ──');
r = await call('GET', '/user-activity', null, admin.token);
t('an admin reads it', r.status === 200 && r.json?.total > 0 && Number(r.headers.get('x-total-count')) === r.json.total);
r = await call('GET', '/user-activity', null, sup.token);
t('a supervisor is refused, even with the grant (the screen is admins only)', r.status === 403);
const mint = async (user_id, label) => (await call('POST', '/api-tokens', { user_id, label, scopes: ['read'] }, admin.token)).json?.plaintext;
const botTok = await mint('ua-bot', 'Activity reader (test)');
const bot2Tok = await mint('ua-bot2', 'No grant (test)');
t('test bot tokens minted on the test database', !!botTok && !!bot2Tok);
r = await call('GET', '/user-activity?limit=5', null, botTok);
t('a read token whose account holds the grant reads it, paged', r.status === 200 && r.json?.rows?.length === 5 && Number(r.headers.get('x-limit')) === 5, `${r.status}`);
r = await call('GET', '/user-activity?limit=900', null, botTok);
t('…at most 200 rows a page', r.status === 200 && Number(r.headers.get('x-limit')) === 200);
r = await call('GET', '/user-activity', null, bot2Tok);
t('a token without the grant is refused', r.status === 403);
r = await call('POST', '/user-activity/events', { events: [{ type: 'page_view', page: 'x' }] }, botTok);
t('a token cannot write to it', r.status === 403);
r = await call('GET', '/user-activity/export.csv', null, botTok);
t('the bot can pull the CSV too', r.status === 200 && r.text.startsWith('occurred_at_utc,user,'));

console.log('\n── filters and the CSV ──');
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
r = await call('GET', `/user-activity?user_id=ua-op&from=${today}&to=${today}`, null, admin.token);
t('filter by person and day', r.json?.total > 0 && r.json.rows.every(x => x.user_id === 'ua-op'));
r = await call('GET', `/user-activity?user_id=ua-op&to=${yesterday}`, null, admin.token);
t('…nothing before today', r.json?.total === 0);
r = await call('GET', '/user-activity?action=logout&user_id=ua-op', null, admin.token);
t('filter by kind', r.json?.total === 1 && r.json.rows[0].action === 'logout');
r = await call('GET', '/user-activity?from=not-a-date', null, admin.token);
t('a bad date is refused by name', r.status === 400 && /from/.test(r.json?.error || ''));
r = await call('GET', `/user-activity/export.csv?user_id=ua-op`, null, admin.token);
const lines = r.text.trim().split('\n');
t('the CSV downloads as a file', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment/.test(r.headers.get('content-disposition')));
t('…one header line and one line per entry, oldest first', lines[0].startsWith('occurred_at_utc') && lines.length - 1 === (await call('GET', '/user-activity?user_id=ua-op', null, admin.token)).json.total
  && lines.some(l => /,ua-op,login,/.test(l)) && lines[1].slice(0, 24) <= lines[lines.length - 1].slice(0, 24), lines.slice(0, 2).join(' | '));
t('…and no password in it', !r.text.includes(PW) && !r.text.includes(NEW_PW));

console.log('\n── it cannot be changed ──');
const rw = new Database(DBP);
let threw = '';
try { rw.prepare("UPDATE user_activity SET user_name = 'x' WHERE id = 1").run(); } catch (e) { threw = e.message; }
t('an UPDATE is refused', /append-only/.test(threw));
threw = '';
try { rw.prepare('DELETE FROM user_activity WHERE id = 1').run(); } catch (e) { threw = e.message; }
t('a DELETE is refused', /append-only/.test(threw));
const auditNow = rw.prepare('SELECT * FROM audit_log ORDER BY id').all();
rw.close();
t('every audit entry that was there before is unchanged', JSON.stringify(auditNow.slice(0, auditBefore.length)) === JSON.stringify(auditBefore));

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('active_tab'); }, [admin.token, admin.user]);
await page.goto(`${URL}/?tab=equipment`);
await page.waitForTimeout(2500);
t('a page view waits in the screen\'s batch, unsent', !q("SELECT 1 FROM user_activity WHERE user_id = 'ua-admin' AND action = 'page_view' AND page = 'equipment'").length);
// The tab is hidden (the phone locks, another app opens): the batch goes as a beacon.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(800);
await flush(admin.token);
t('hiding the page sends the batch (a beacon, so it survives the page closing)',
  q("SELECT 1 FROM user_activity WHERE user_id = 'ua-admin' AND action = 'page_view' AND page = 'equipment'").length === 1);
await page.goto(`${URL}/?tab=user-activity`);
await page.locator('[data-user-activity]').waitFor({ timeout: 20000 }).catch(() => {});
t('an admin opens User Activity', await page.locator('[data-user-activity]').count() === 1);
await page.waitForTimeout(800);
await page.locator('[data-activity-user]').selectOption('ua-op');
await page.waitForTimeout(1200);
const shown = await page.locator('[data-activity-row]').evaluateAll(els => els.map(e => e.getAttribute('data-activity-row')));
t('filtering by a person shows only their rows', shown.length > 0 && shown.includes('login') && shown.includes('edit'), shown.join(','));
await page.locator('[data-activity-row="edit"]', { hasText: 'ua-eq-1' }).first().click();
await page.locator('[data-activity-changes]').first().waitFor({ timeout: 5000 }).catch(() => {});
t('opening an edit shows what changed', /belt replaced/.test(await page.locator('[data-activity-changes]').first().innerText().catch(() => '')));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('[data-activity-export]').click()]);
t('Export CSV downloads a file', !!dl && /readydoc-activity-.*\.csv$/.test(dl.suggestedFilename()));
const opPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await opPage.goto(`${URL}/manifest.webmanifest`);
await opPage.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [sup.token, sup.user]);
await opPage.goto(`${URL}/?tab=user-activity`);
await opPage.waitForTimeout(2500);
t('a supervisor is not offered the screen', await opPage.locator('[data-user-activity]').count() === 0);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
