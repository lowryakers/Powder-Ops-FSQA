// verify:dmthreadbadge — D-294. A reply in a thread you follow moves the Threads
// badge on screens that are NOT looking at that conversation — a group DM you
// are not in right now, or the channel list on a phone. message:new only
// reaches the room of the channel a screen has open, so before this the badge
// sat still until something else made it refetch.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// the change: the badge never appears without a reload.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5172;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,'supervisor','qa',1,?,datetime('now','+7 day'),'{}')`).run(id, name, name, `SC-${id}`);
mk('db-l', 'Lou Badge'); mk('db-m', 'Mia Badge'); mk('db-d', 'Dee Badge'); mk('db-c', 'Cal Badge');
const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/set-password', { user_id: id, password: 'Badge2026!!x', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Badge2026!!x' })).json();
};
const L = await signIn('Lou Badge', 'db-l'); const M = await signIn('Mia Badge', 'db-m');
const D = await signIn('Dee Badge', 'db-d'); const C = await signIn('Cal Badge', 'db-c');
t('signed in', !!L?.token && !!M?.token && !!D?.token && !!C?.token);
const call = async (method, p, body, who) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${who.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const dm = (await call('POST', '/comms/dm', { user_ids: ['db-l', 'db-m', 'db-c'] }, D)).body;
t('a four-person group DM', dm?.kind === 'dm');
const say = async (who, body, extra = {}) => (await call('POST', `/comms/channels/${dm.id}/messages`, { body, ...extra }, who)).body;
const parent = await say(D, 'Can someone check the label run?');
await say(L, 'I will look', { parent_id: parent.id });          // Lou follows by replying
await call('POST', `/comms/threads/${parent.id}/read`, {}, L);
t('Lou starts with nothing unread in Threads', (await call('GET', '/comms/threads/unread', null, L)).body?.total === 0);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [label, vp, mobile] of [['1280', { width: 1280, height: 800 }, false], ['390px', { width: 390, height: 844 }, true]]) {
  console.log(`\n── ${label} ──`);
  const pg = await browser.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  pg.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await pg.goto(`${URL}/manifest.webmanifest`);
  await pg.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('comms_last_view'); localStorage.removeItem('comms_last_channel'); }, [L.token, L.user]);
  await pg.goto(`${URL}/chat`);
  await pg.waitForSelector('[data-nav-threads]', { timeout: 15000 });
  await pg.waitForTimeout(1500);
  t(`${label}: no Threads badge yet`, (await pg.$$('[data-threads-badge]')).length === 0);
  // Mia replies in the DM thread while Lou is NOT looking at the DM.
  await say(M, `Mia's reply ${label}`, { parent_id: parent.id });
  await pg.waitForSelector('[data-threads-badge]', { timeout: 6000 }).catch(() => {});
  const badge = await pg.$eval('[data-threads-badge]', (e) => e.textContent).catch(() => null);
  t(`${label}: the Threads badge appears without a reload`, badge === '1', String(badge));
  // A reply that @mentions him in the thread, from someone else, adds to it.
  await say(C, `@Lou Badge please confirm ${label}`, { parent_id: parent.id });
  await pg.waitForFunction(() => document.querySelector('[data-threads-badge]')?.textContent === '2', null, { timeout: 6000 }).catch(() => {});
  t(`${label}: a second reply moves it to 2`, await pg.$eval('[data-threads-badge]', (e) => e.textContent).catch(() => null) === '2');
  await call('POST', `/comms/threads/${parent.id}/read`, {}, L);
  await pg.close();
}
// Somebody who does not follow the thread is not nudged into a badge.
t('Cal is told nothing he does not follow — he replied, so he follows; Dee (starter) counts the replies', (await call('GET', '/comms/threads/unread', null, D)).body?.total > 0);
const notIn = await signIn('Lou Badge', 'db-l');
t('session still fine', !!notIn?.token);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
