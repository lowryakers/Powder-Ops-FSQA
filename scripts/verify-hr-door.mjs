// verify:hrdoor — the HR front door (D-356). Every employee has "HR" in
// Messages; what they send there is read by the HR team and nobody else.
// Caller sets PORT + DBPATH. Control: main before this — /comms/hr-door is 404.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5226);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'HrDoor2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ext = 0) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access,is_external)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?,?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ operator: 'view' }), ext);
mk('hd-boss', 'Lola Boss', 'admin', 'admin');
mk('hd-marn', 'Mari Office', 'supervisor', 'office');
mk('hd-sup', 'Sam Floorsup', 'supervisor', 'filling');
mk('hd-emp', 'Ema Worker', 'operator', 'filling');
mk('hd-emp2', 'Eli Worker', 'operator', 'filling');
mk('hd-ext', 'Cli Ent', 'operator', 'production', 1);
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const T = {};
for (const [id, n] of [['hd-boss', 'Lola Boss'], ['hd-marn', 'Mari Office'], ['hd-sup', 'Sam Floorsup'], ['hd-emp', 'Ema Worker'], ['hd-emp2', 'Eli Worker'], ['hd-ext', 'Cli Ent']]) T[id] = await login(id, n);
t('everyone signs in', Object.values(T).every(Boolean));

let r = await call('PUT', '/comms/hr-door/readers', { user_ids: ['hd-boss', 'hd-marn'] }, T['hd-marn']);
t('only an admin sets the HR team', r.status === 403);
r = await call('PUT', '/comms/hr-door/readers', { user_ids: ['hd-boss', 'hd-marn'] }, T['hd-boss']);
t('the admin sets the HR team to two people', r.status === 200 && r.json?.readers?.length === 2);

r = await call('GET', '/comms/hr-door', null, T['hd-emp']);
const door = r.json?.channel_id;
t('the employee opens HR', r.status === 200 && !!door && r.json?.is_reader === false);
t('…and it is in their list, called "HR"', ((await call('GET', '/comms/channels', null, T['hd-emp'])).json || []).some(c => c.id === door && c.name === 'HR' && c.hr_door?.mine));
const members = q('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', door).map(x => x.user_id).sort().join();
t('ITS MEMBERS ARE THE EMPLOYEE AND THE HR TEAM, nobody else', members === ['hd-boss', 'hd-emp', 'hd-marn'].sort().join(), members);
r = await call('POST', `/comms/channels/${door}/messages`, { body: 'My lead keeps yelling at me in the warehouse zebraword' }, T['hd-emp']);
t('they send something', r.status === 201);
t('…it is an open item for HR', r.json?.tracked?.state === 'open');
await new Promise(res => setTimeout(res, 400));
const msgs = (await call('GET', `/comms/channels/${door}/messages`, null, T['hd-emp'])).json || [];
t('…and ReadyBot tells them it went to HR', msgs.some(m => m.user_name === 'ReadyBot' && /Sent to HR/.test(m.body || '')));
await call('POST', `/comms/channels/${door}/messages`, { body: 'and again today' }, T['hd-emp']);
await new Promise(res => setTimeout(res, 300));
t('…once, not after every line', ((await call('GET', `/comms/channels/${door}/messages`, null, T['hd-emp'])).json || []).filter(m => m.user_name === 'ReadyBot').length === 1);

console.log('\n── nobody else ──');
for (const [who, label] of [['hd-emp2', 'a coworker'], ['hd-sup', 'their supervisor'], ['hd-ext', 'a client']]) {
  r = await call('GET', `/comms/channels/${door}/messages`, null, T[who]);
  t(`${label} cannot read it`, r.status === 404 || r.status === 403, `${r.status}`);
  const list = (await call('GET', '/comms/channels', null, T[who])).json || [];
  t(`…nor see it in their list`, !list.some(c => c.id === door));
  const s = (await call('GET', '/comms/search?q=zebraword', null, T[who])).json;
  t(`…nor find it in search`, !JSON.stringify(s || {}).includes('zebraword'));
}
r = await call('GET', '/comms/hr-door', null, T['hd-ext']);
t('a client has no HR door', r.status === 404);
r = await call('POST', `/comms/channels/${door}/members`, { user_ids: ['hd-emp2'] }, T['hd-emp']);
t('nobody adds people to an HR conversation by hand', r.status === 409);
r = await call('POST', `/comms/channels/${door}/members`, { user_ids: ['hd-emp2'] }, T['hd-boss']);
t('…not even an admin', r.status === 409);
r = await call('POST', '/comms/channels', { name: 'hr--fake', kind: 'public' }, T['hd-boss']);
t('an hr-- channel cannot be made by hand', r.status === 400);

console.log('\n── the HR team ──');
const mlist = (await call('GET', '/comms/channels', null, T['hd-marn'])).json || [];
const inbox = mlist.find(c => c.id === door);
t('Marnee sees it, named for the employee', inbox?.hr_door?.owner_name === 'Ema Worker' && inbox?.name === 'HR · Ema Worker');
t('…with the unread waiting', inbox?.unread >= 2);
r = await call('POST', `/comms/channels/${door}/messages`, { body: 'Thanks Ema — can you come by the office at 2?' }, T['hd-marn']);
t('HR answers in the same conversation', r.status === 201);
const dm = (await call('POST', '/comms/dm', { user_ids: ['hd-marn'] }, T['hd-emp2'])).json;
const dmId = dm?.id || dm?.channel?.id;
const sent = (await call('POST', `/comms/channels/${dmId}/messages`, { body: 'I need to talk about my schedule, personal reasons' }, T['hd-emp2'])).json;
r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'hr' }, T['hd-marn']);
t('A DM SENT TO MARNEE IS MOVED INTO THAT PERSON\'S HR CONVERSATION', r.status === 201 && /^hr--/.test(q('SELECT name FROM chat_channels WHERE id = ?', r.json?.message?.channel_id)[0]?.name || ''), JSON.stringify(r.json).slice(0, 160));
t('…which now exists for Eli, with Eli in it', q("SELECT COUNT(*) n FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id WHERE c.name = 'hr--hd-emp2' AND m.user_id = 'hd-emp2'")[0].n === 1);
t('…and the DM reads "Moved to HR"', ((await call('GET', `/comms/channels/${dmId}/messages`, null, T['hd-emp2'])).json || []).find(x => x.id === sent.id)?.moved_to?.channel_name === 'HR');
r = await call('POST', `/comms/messages/${sent.id}/move`, { channel_id: 'hr' }, T['hd-sup']);
t('someone outside the HR team cannot move to HR', r.status === 403);
r = await call('PUT', '/comms/hr-door/readers', { user_ids: ['hd-marn'] }, T['hd-boss']);
const after = q('SELECT user_id FROM chat_channel_members WHERE channel_id = ?', door).map(x => x.user_id).sort().join();
t('CHANGING THE HR TEAM CHANGES EVERY CONVERSATION', after === ['hd-emp', 'hd-marn'].sort().join(), after);
r = await call('GET', `/comms/channels/${door}/messages`, null, T['hd-boss']);
t('AN ADMIN OFF THE HR TEAM CANNOT READ IT EITHER', r.status === 404, `${r.status}`);
await call('PUT', '/comms/hr-door/readers', { user_ids: ['hd-boss', 'hd-marn'] }, T['hd-boss']);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = (await call('GET', '/users/me', null, T['hd-emp2'])).json;
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('comms_last_channel'); }, [T['hd-emp2'], me]);
await page.goto(`${URL}/chat`);
await page.waitForTimeout(3500);
t('every employee sees "HR" in Messages', await page.locator('[data-hr-door-open]').count() === 1);
await page.locator('[data-hr-door-open]').click();
await page.waitForTimeout(2000);
t('…which says only the HR team can read it', await page.locator('[data-hr-door-banner]').count() === 1);
t('nothing pans sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const p2 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const me2 = (await call('GET', '/users/me', null, T['hd-marn'])).json;
await p2.goto(`${URL}/manifest.webmanifest`);
await p2.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['hd-marn'], me2]);
await p2.goto(`${URL}/chat`);
await p2.waitForTimeout(3500);
t('the HR team has an HR inbox with each employee', await p2.locator('[data-hr-inbox]').count() === 1 && (await p2.locator('[data-hr-inbox]').innerText()).includes('Ema Worker'));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
