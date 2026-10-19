// verify:threads — D-190. Threads behave like Slack's: followers are told about
// replies, a thread can be followed and unfollowed, the reply chip says "N new",
// a long thread opens at its first unread reply, and a reply can also go to
// the channel.
//
// Caller sets PORT + DBPATH (+ DB_PATH for the in-process recipients check).
// Needs a built client. The control is `main` before the change: a reply goes to
// the channel notifier (every member, gated on CHANNEL unread), there is no
// follow endpoint, no chip count, the drawer opens at the end, no also-to-channel.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5115;
const URL = `http://localhost:${PORT}`;
process.env.DB_PATH = process.env.DB_PATH || process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name, role) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'qa',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, JSON.stringify({ sanitation: 'view' }));
mk('th-a', 'Ana Follower', 'operator');
mk('th-b', 'Ben Starter', 'admin');
mk('th-c', 'Cal Bystander', 'operator');
mk('th-d', 'Dee Named', 'operator');

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Threads2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Threads2026!!' })).json();
};
const A = await signIn('Ana Follower', 'th-a');
const B = await signIn('Ben Starter', 'th-b');
const C = await signIn('Cal Bystander', 'th-c');
const Dd = await signIn('Dee Named', 'th-d');
t('signed in', !!A?.token && !!B?.token && !!C?.token && !!Dd?.token);
const call = async (method, p, body, who) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${who.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const nowTs = () => db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') t").get().t;
const ch = (await call('POST', '/comms/channels', { name: 'th-floor', kind: 'public', member_ids: ['th-a', 'th-c', 'th-d'] }, B)).body;
const chId = ch?.id || ch?.channel?.id;
db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ?').run(nowTs(), chId);
const post = async (who, body, extra = {}) => (await call('POST', `/comms/channels/${chId}/messages`, { body, ...extra }, who)).body;
const unreadOf = async (who) => (await call('GET', '/comms/channels', null, who)).body.find((c) => c.id === chId)?.unread;
const threadsBadge = async (who) => (await call('GET', '/comms/threads/unread', null, who)).body;

console.log('\n── who a reply notifies ──');
const parent = await post(B, 'Blender 2 is leaking from the seal — who has seen this before?');
await post(A, 'I have, it is the gasket', { parent_id: parent.id });
// Before D-190 there is no such rule to ask; the control reads it as nobody.
const threadReplyRecipients = (await import('../server/api/comms.js')).threadReplyRecipients || (() => []);
const { getDb } = await import('../server/db.js');
const rdb = getDb();
const chan = rdb.prepare('SELECT * FROM chat_channels WHERE id = ?').get(chId);
let rec = threadReplyRecipients(rdb, chan, parent.id, 'th-b', []);
t('B REPLIES: the follower (A) is notified, the author is not', rec.includes('th-a') && !rec.includes('th-b'), JSON.stringify(rec));
t('…and a channel member who never touched the thread (C) is NOT', !rec.includes('th-c'));
rec = threadReplyRecipients(rdb, chan, parent.id, 'th-a', []);
t('A replies: the starter (B) is notified', rec.includes('th-b') && !rec.includes('th-a'));
t('someone @mentioned in the reply is left to the mention push (excluded here)', !threadReplyRecipients(rdb, chan, parent.id, 'th-b', ['th-a']).includes('th-a'));

console.log('\n── unread lives in the thread, not the channel ──');
const beforeUnread = await unreadOf(A);
await post(B, 'Ordered a new one, here Thursday', { parent_id: parent.id });
t('a reply does not touch the channel\'s unread', await unreadOf(A) === beforeUnread);
let badge = await threadsBadge(A);
t('it is on the follower\'s Threads badge', badge.total >= 1, JSON.stringify(badge));
let page = (await call('GET', `/comms/channels/${chId}/messages`, null, A)).body;
let p = page.find((m) => m.id === parent.id);
t('THE REPLY CHIP CARRIES "N new" for the follower', p?.thread_following === true && p?.thread_unread === 1, JSON.stringify({ f: p?.thread_following, u: p?.thread_unread }));
const pc = (await call('GET', `/comms/channels/${chId}/messages`, null, C)).body.find((m) => m.id === parent.id);
t('…and nothing for a non-follower', pc?.thread_following === false && pc?.thread_unread === 0);

console.log('\n── follow / unfollow ──');
const mute = await call('POST', `/comms/threads/${parent.id}/follow`, { state: 'muted' }, A);
t('A unfollows', mute.status === 200 && mute.body.following === false);
t('…no reply notification for her', !threadReplyRecipients(rdb, chan, parent.id, 'th-b', []).includes('th-a'));
t('…off her Threads list and badge', !(await call('GET', '/comms/threads', null, A)).body.some((x) => x.parent.id === parent.id) && (await threadsBadge(A)).total === 0);
t('…still readable', (await call('GET', `/comms/messages/${parent.id}/thread`, null, A)).status === 200);
await post(B, '@Ana Follower can you check the spare is the right size?', { parent_id: parent.id });
t('BEING @MENTIONED AGAIN FOLLOWS IT AGAIN', (await call('GET', `/comms/messages/${parent.id}/thread`, null, A)).body.following === true);
const follow = await call('POST', `/comms/threads/${parent.id}/follow`, { state: 'following' }, C);
t('C follows a thread he never touched', follow.body.following === true && threadReplyRecipients(rdb, chan, parent.id, 'th-b', []).includes('th-c'));
t('…and it is on his Threads list', (await call('GET', '/comms/threads', null, C)).body.some((x) => x.parent.id === parent.id));
t('a bad state is refused', (await call('POST', `/comms/threads/${parent.id}/follow`, { state: 'loud' }, C)).status === 400);
const other = (await call('POST', '/comms/channels', { name: 'th-private', kind: 'private' }, B)).body;
const priv = (await call('POST', `/comms/channels/${other.id || other.channel?.id}/messages`, { body: 'private parent' }, B)).body;
t('a thread in a channel you cannot see cannot be followed (404)', (await call('POST', `/comms/threads/${priv.id}/follow`, { state: 'following' }, C)).status === 404);

console.log('\n── also send to the channel ──');
const before2 = await unreadOf(C);
const also = await post(B, 'Seal replaced — Blender 2 is back in service', { parent_id: parent.id, also_to_channel: true });
t('the reply is ONE row, flagged also_in_channel', also.also_in_channel === true && also.parent_id === parent.id);
t('it counts as channel unread for the others', await unreadOf(C) === before2 + 1, `${before2} → ${await unreadOf(C)}`);
page = (await call('GET', `/comms/channels/${chId}/messages`, null, C)).body;
const inFeed = page.find((m) => m.id === also.id);
t('it shows in the channel feed, naming the thread it answers', !!inFeed && /leaking/.test(inFeed.parent_preview?.body || ''));
t('…and still in the thread', (await call('GET', `/comms/messages/${parent.id}/thread`, null, C)).body.replies.some((r) => r.id === also.id));
await call('DELETE', `/comms/messages/${also.id}`, null, B);
const after = (await call('GET', `/comms/channels/${chId}/messages`, null, C)).body.find((m) => m.id === also.id);
t('deleting it removes it in both places (one row)', after?.deleted === true && (await call('GET', `/comms/messages/${parent.id}/thread`, null, C)).body.replies.find((r) => r.id === also.id)?.deleted === true);
t('a plain reply is not in the channel feed', !page.some((m) => m.body === 'Ordered a new one, here Thursday'));

console.log('\n── a mention in a thread ──');
const mParent = await post(B, 'Who is on the night clean?');
await post(B, '@Dee Named you are on Room 4 tonight', { parent_id: mParent.id });
await call('POST', `/comms/channels/${chId}/read`, {}, Dd);
t('reading the channel does NOT clear a mention made in a thread', (await threadsBadge(Dd)).total >= 1);
await call('POST', `/comms/threads/${mParent.id}/read`, {}, Dd);
t('reading the thread does', (await threadsBadge(Dd)).total === 0);

console.log('\n── the screen ──');
const longParent = await post(B, 'Shift handover for Room 6 — read before you start');
db.prepare('INSERT OR REPLACE INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)').run('th-a', longParent.id, nowTs());
await post(A, 'noted', { parent_id: longParent.id });
for (let i = 0; i < 14; i++) await post(B, `handover note ${i} — ` + 'checked the sifter screen, the gaskets and the hopper before signing off the line. '.repeat(3), { parent_id: longParent.id });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
pg.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await pg.goto(`${URL}/manifest.webmanifest`);
await pg.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
await pg.goto(`${URL}/chat`);
await pg.getByText('th-floor', { exact: true }).first().click({ timeout: 15000 });
await pg.waitForSelector('[data-thread-new]', { timeout: 10000 }).catch(() => {});
const chipVals = await pg.$$eval('[data-thread-new]', (e) => e.map((x) => x.getAttribute('data-thread-new')));
t('the reply chip shows "14 new" in the channel', chipVals.includes('14'), JSON.stringify(chipVals));
await pg.locator('[data-thread-new="14"]').first().click();
await pg.waitForSelector('[data-thread-scroll] [data-reply-id]', { timeout: 10000 }).catch(() => {});
await pg.waitForTimeout(1200);
const land = await pg.evaluate(() => {
  const el = document.querySelector('[data-thread-scroll]');
  const node = [...el.querySelectorAll('[data-reply-id]')].find((n) => n.textContent.includes('handover note 0'));
  return { top: node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null, jump: !!document.querySelector('[data-thread-jump]'),
    divider: !!el.querySelector('[data-new-divider]') };
});
t('A LONG THREAD OPENS AT ITS FIRST UNREAD REPLY, with the New line', land.top !== null && land.top >= -5 && land.top < 200 && land.divider, JSON.stringify(land));
t('…and Jump to latest', land.jump);
const marker = () => db.prepare('SELECT last_read_at FROM chat_thread_reads WHERE user_id = ? AND parent_id = ?').get('th-a', longParent.id)?.last_read_at;
const newestReply = db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE parent_id = ?').get(longParent.id).t;
t('opening it reads only the replies on screen', marker() < newestReply);
await pg.click('[data-thread-jump]');
await pg.waitForTimeout(1200);
t('Jump to latest reads it to the end', marker() === newestReply && !(await pg.$('[data-thread-jump]')));
await pg.waitForTimeout(600);
t('…and the chip in the channel clears', (await pg.$('[data-thread-new="14"]')) === null);
t('the drawer offers Following', await pg.getAttribute('[data-thread-follow]', 'data-thread-follow') === 'following');
await pg.check('[data-also-to-channel]');
await pg.fill('[data-thread-scroll] ~ * textarea, textarea[placeholder="Reply…"]', 'Handover read, starting Room 6');
await pg.keyboard.press('Control+Enter');
await pg.waitForTimeout(1500);
t('"Also send to" posts the reply into the channel feed too', await pg.locator('[data-msg-scroll] [data-also-label]').count() >= 1);
await pg.click('[data-thread-follow]');
await pg.waitForTimeout(800);
t('Unfollow from the drawer', await pg.getAttribute('[data-thread-follow]', 'data-thread-follow') === 'not'
  && !(await call('GET', '/comms/threads', null, A)).body.some((x) => x.parent.id === longParent.id));
const pan = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
t('nothing pans sideways', !pan);

console.log('\n── the thread panel on a phone (390px) ──');
const phoneParent = await post(B, 'Room 4 changeover notes — phone check');
db.prepare('INSERT OR REPLACE INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)').run('th-d', phoneParent.id, nowTs());
await post(Dd, 'on it', { parent_id: phoneParent.id });
for (let i = 0; i < 12; i++) await post(B, `phone note ${i} — ` + 'swapped the auger, cleaned the hopper and checked the seal before the next run. '.repeat(3), { parent_id: phoneParent.id });
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
phone.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Dd.token, Dd.user]);
await phone.goto(`${URL}/chat`);
await phone.getByText('th-floor', { exact: true }).first().click({ timeout: 15000 });
await phone.waitForSelector('[data-thread-new="12"]', { timeout: 10000 }).catch(() => {});
t('390px: the reply chip says "12 new"', await phone.locator('[data-thread-new="12"]').count() === 1);
await phone.locator('[data-thread-new="12"]').first().click();
await phone.waitForSelector('[data-thread-scroll] [data-reply-id]', { timeout: 10000 }).catch(() => {});
await phone.waitForTimeout(1200);
const pland = await phone.evaluate(() => {
  const el = document.querySelector('[data-thread-scroll]');
  const node = [...el.querySelectorAll('[data-reply-id]')].find((n) => n.textContent.includes('phone note 0'));
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  return { top: node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null, jump: !!document.querySelector('[data-thread-jump]'),
    divider: !!el.querySelector('[data-new-divider]'), follow: r('[data-thread-follow]'), reply: r('textarea[placeholder="Reply…"]'),
    also: r('[data-also-to-channel]'), vw: window.innerWidth, vh: window.innerHeight,
    pan: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
t('390px: a long thread opens at its first unread reply, with the New line', pland.top !== null && pland.top >= -5 && pland.top < 200 && pland.divider, JSON.stringify(pland));
t('390px: Jump to latest is offered', pland.jump);
t('390px: Following is in the header, on screen', !!pland.follow && pland.follow.right <= pland.vw && pland.follow.top >= 0, JSON.stringify(pland.follow));
t('390px: the reply box and "Also send to" are on screen', !!pland.reply && pland.reply.bottom <= pland.vh && pland.reply.right <= pland.vw && !!pland.also && pland.also.left >= 0, JSON.stringify({ r: pland.reply, a: pland.also }));
t('390px: nothing pans sideways', !pland.pan);
const dMarker = () => db.prepare('SELECT last_read_at FROM chat_thread_reads WHERE user_id = ? AND parent_id = ?').get('th-d', phoneParent.id)?.last_read_at;
const dNewest = db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE parent_id = ?').get(phoneParent.id).t;
t('390px: opening reads only what is on screen', dMarker() < dNewest);
await phone.tap('[data-thread-jump]');
await phone.waitForTimeout(1200);
t('390px: Jump to latest reads it to the end and goes away', dMarker() === dNewest && !(await phone.$('[data-thread-jump]')));
await phone.close();
await browser.close();
db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
