// verify:unreadlanding — D-189. Where a channel opens, when Jump to latest
// shows, and what "read" means.
//
// Lowry: "If I have missed a long thread/series of messages it's supposed to
// start me at the first message … with a 'jump to latest' button. But it's
// ONLY supposed to work like that when I have missed several messages … it
// should just take me directly to the most recent message and I shouldn't see
// any 'jump to latest' button because I'm already at the latest."
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// the change: five one-liners anchor and leave the button stuck, a revisited
// channel opens at the bottom, opening marks everything read, a thread reply
// reads the channel, and nothing reaches the reader's other sessions.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import { io } from 'socket.io-client';

const PORT = process.env.PORT || 5114;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new Database(process.env.DBPATH);
const mk = (id, name, role, ma) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'qa',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ul-a', 'Rita Reader', 'operator', { sanitation: 'view' });
mk('ul-b', 'Pat Poster', 'admin', null);

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Unread2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Unread2026!!' })).json();
};
const A = await signIn('Rita Reader', 'ul-a');
const B = await signIn('Pat Poster', 'ul-b');
t('signed in', !!A?.token && !!B?.token);
const call = async (method, p, body, who) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${who.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const nowTs = () => db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') t").get().t;
const marker = (ch) => db.prepare('SELECT last_read_at FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(ch, 'ul-a')?.last_read_at;
const newest = (ch) => db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE channel_id = ? AND parent_id IS NULL').get(ch).t;
const unreadOf = async (ch) => (await call('GET', '/comms/channels', null, A)).body.find((c) => c.id === ch)?.unread;
const LONG = (k) => `${k} ` + 'The mixer was stripped, the gaskets inspected and the sifter screen replaced before the next run started. '.repeat(14);

async function channel(name) {
  const c = await call('POST', '/comms/channels', { name, kind: 'public', member_ids: ['ul-a'] }, B);
  const id = c.body?.id || c.body?.channel?.id;
  await call('POST', `/comms/channels/${id}/messages`, { body: `${name} history` }, B);
  db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(nowTs(), id, 'ul-a');
  return id;
}
const say = async (id, n, body = (i) => `${i}`) => { const out = []; for (let i = 0; i < n; i++) out.push((await call('POST', `/comms/channels/${id}/messages`, { body: body(i) }, B)).body); return out; };

console.log('\n── the server: read only as far as seen, forward only ──');
const api = await channel('ul-api');
const apiMsgs = await say(api, 6, (i) => `api ${i}`);
const r1 = await call('POST', `/comms/channels/${api}/read`, { up_to: apiMsgs[2].created_at }, A);
t('up_to marks read up to that message, not now', marker(api) === apiMsgs[2].created_at && await unreadOf(api) === 3, `${marker(api)} unread ${await unreadOf(api)}`);
await call('POST', `/comms/channels/${api}/read`, { up_to: apiMsgs[0].created_at }, A);
t('an older up_to never moves the marker back', marker(api) === apiMsgs[2].created_at);
t('…and the answer says it has not caught up', r1.body?.caught_up === false);
await call('POST', `/comms/channels/${api}/read`, {}, A);
t('no up_to: everything read, as before', await unreadOf(api) === 0);

console.log('\n── a thread reply reads the thread, not the channel ──');
const thr = await channel('ul-thread');
const parent = (await say(thr, 1, () => 'the parent'))[0];
db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(nowTs(), thr, 'ul-a');
await say(thr, 12, (i) => `top ${i}`);
await call('POST', `/comms/channels/${thr}/messages`, { body: 'my reply', parent_id: parent.id }, A);
t('REPLYING IN AN OLD THREAD LEAVES THE 12 UNREAD', await unreadOf(thr) === 12, `unread ${await unreadOf(thr)}`);
t('…and stamps the thread read for the replier', !!db.prepare('SELECT 1 FROM chat_thread_reads WHERE user_id = ? AND parent_id = ?').get('ul-a', parent.id));
await call('POST', `/comms/channels/${thr}/messages`, { body: 'a top-level post' }, A);
t('a top-level post still reads the channel', await unreadOf(thr) === 0);

console.log('\n── a read reaches the reader\'s other sessions ──');
const sock = io(URL, { path: '/socket.io', auth: { token: A.token }, transports: ['websocket'] });
const heard = [];
sock.on('read:changed', (p) => heard.push(p));
await new Promise((r) => { sock.on('connect', r); setTimeout(r, 3000); });
await say(api, 2);
await call('POST', `/comms/channels/${api}/read`, {}, A);
await call('POST', `/comms/threads/${parent.id}/read`, {}, A);
await wait(800);
t('READ ON ONE DEVICE IS HEARD ON ANOTHER (channel)', heard.some((p) => p.channel_id === api && p.caught_up === true), JSON.stringify(heard));
t('…and for a thread', heard.some((p) => p.parent_id === parent.id));
sock.close();

console.log('\n── more unread than the newest page ──');
const big = await channel('ul-big');
await say(big, 80, (i) => `big-${i}`);
const after = await call('GET', `/comms/channels/${big}/messages?after=${encodeURIComponent(marker(big))}`, null, A);
t('?after= starts the window at the reader\'s marker', after.status === 200 && after.body.some((m) => m.body === 'big-0') && after.body.some((m) => m.body === 'big-79'));

// ── channels the browser opens ──
const one = await channel('ul-one'); await say(one, 1, () => 'just the one');
const four = await channel('ul-four'); await say(four, 4, (i) => `four ${i}`);
const five = await channel('ul-five'); await say(five, 5, (i) => `five ${i}`);
const tall = await channel('ul-tall'); await say(tall, 4, (i) => LONG(`tall-${i}`));
const twenty = await channel('ul-twenty'); await say(twenty, 20, (i) => LONG(`twenty-${i}`).slice(0, 360));
const back = await channel('ul-revisit'); await say(back, 2, (i) => `revisit old ${i}`);
const hide = await channel('ul-hidden');

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
await page.goto(`${URL}/chat`);
await page.waitForSelector('[data-msg-scroll]', { timeout: 20000 }).catch(() => {});
const open = async (name, expectText) => {
  await page.getByText(name, { exact: true }).first().click({ timeout: 10000 });
  if (expectText) await page.waitForSelector(`[data-msg-scroll] >> text=${expectText}`, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1400);
};
const view = () => page.evaluate(() => {
  const el = document.querySelector('[data-msg-scroll]');
  return { fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight, jump: !!document.querySelector('[data-jump-latest]'),
    divider: !!document.querySelector('[data-new-divider]') };
});
const topOf = (text) => page.evaluate((txt) => {
  const el = document.querySelector('[data-msg-scroll]');
  const node = [...el.querySelectorAll('[data-mid]')].find((n) => n.textContent.includes(txt));
  return node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
}, text);

await open('ul-one', 'just the one');
let v = await view();
t('1 unread: opens at the latest, no Jump to latest, divider shown', v.fromBottom <= 120 && !v.jump && v.divider, JSON.stringify(v));
await open('ul-four', 'four 3');
v = await view();
t('4 short unread: at the latest, no button', v.fromBottom <= 120 && !v.jump, JSON.stringify(v));
await open('ul-five', 'five 4');
v = await view();
t('5 ONE-LINE UNREAD THAT FIT: at the latest, NO STUCK BUTTON', v.fromBottom <= 120 && !v.jump, JSON.stringify(v));
await open('ul-tall', 'tall-3');
v = await view();
const tallTop = await topOf('tall-0');
t('4 TALL UNREAD THAT DO NOT FIT: opens at the first of them', tallTop !== null && tallTop >= -5 && tallTop < 160, `top ${tallTop}`);
t('…with Jump to latest', v.jump, JSON.stringify(v));
await page.click('[data-jump-latest]');
await page.waitForTimeout(800);
v = await view();
t('Jump to latest goes to the latest and goes away', v.fromBottom <= 120 && !v.jump, JSON.stringify(v));

await open('ul-twenty', 'twenty-19');
v = await view();
t('20 unread: the first unread is at the top, button shown', (await topOf('twenty-0')) < 160 && v.jump);
await page.waitForTimeout(1200);
const mid = marker(twenty);
t('OPENING DOES NOT MARK ALL TWENTY READ — only what is on screen', mid < newest(twenty) && await unreadOf(twenty) > 0, `unread ${await unreadOf(twenty)}`);
await page.evaluate(() => { const el = document.querySelector('[data-msg-scroll]'); el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(1500);
t('scrolled to the bottom: read to the newest, badge 0', marker(twenty) === newest(twenty) && await unreadOf(twenty) === 0, `${marker(twenty)} vs ${newest(twenty)}`);

await open('ul-revisit', 'revisit old 1');
await open('ul-one', 'just the one');
await say(back, 30, (i) => LONG(`revisit new ${i}`).slice(0, 360));
await page.waitForTimeout(800);
await open('ul-revisit', 'revisit new 29');
v = await view();
const rtop = await topOf('revisit new 0');
t('A CHANNEL VISITED EARLIER THIS SESSION OPENS AT ITS FIRST UNREAD', rtop !== null && rtop >= -5 && rtop < 160 && v.jump, `top ${rtop} ${JSON.stringify(v)}`);

await open('ul-big', 'big-');
const btop = await topOf('big-0');
t('80 UNREAD (more than a page): opens at the real first unread, not the bottom', btop !== null && btop < 400, `top ${btop}`);
await page.click('[data-jump-latest]').catch(() => {});
await page.waitForTimeout(1500);
t('…and Jump to latest reaches big-79', (await topOf('big-79')) !== null && (await view()).fromBottom <= 120);

await open('ul-hidden', 'ul-hidden history');
await page.waitForTimeout(800);
const before = marker(hide);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
await say(hide, 3, (i) => `while away ${i}`);
await page.waitForTimeout(2000);
t('A HIDDEN TAB MARKS NOTHING READ', marker(hide) === before && await unreadOf(hide) === 3, `unread ${await unreadOf(hide)}`);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(1500);
t('…and coming back marks what is on screen', await unreadOf(hide) === 0);

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
const tall2 = await channel('ul-phone'); await say(tall2, 6, (i) => LONG(`phone-${i}`).slice(0, 500));
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
await phone.goto(`${URL}/chat`);
await phone.getByText("ul-phone", { exact: true }).first().click({ timeout: 15000 });
await phone.waitForTimeout(1800);
const pv = await phone.evaluate(() => {
  const el = document.querySelector('[data-msg-scroll]');
  const node = [...el.querySelectorAll('[data-mid]')].find((n) => n.textContent.includes('phone-0'));
  return { top: node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null, jump: !!document.querySelector('[data-jump-latest]'),
    pan: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
t('390px: a long backlog opens at the first unread with the button', pv.top !== null && pv.top < 160 && pv.jump && !pv.pan, JSON.stringify(pv));
await browser.close();
db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
