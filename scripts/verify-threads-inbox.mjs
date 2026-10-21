// verify:threadsinbox — D-192. The Threads inbox is a list to choose from: every
// thread is one collapsed card (channel, who started it, the latest reply, "N
// new"), unread first, so three unread threads fit on one screen whatever their
// length. Clicking a card opens that thread in the drawer at its first unread
// reply; a card scrolling past marks nothing read.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// the change: unread cards render expanded with every reply, so the second
// unread thread starts screens below the first, and a click opens nothing.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5116;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name, role) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'qa',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, JSON.stringify({ sanitation: 'view' }));
mk('ti-a', 'Ana Inbox', 'operator');
mk('ti-b', 'Ben Poster', 'admin');
const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Inbox2026!!x', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Inbox2026!!x' })).json();
};
const A = await signIn('Ana Inbox', 'ti-a');
const B = await signIn('Ben Poster', 'ti-b');
t('signed in', !!A?.token && !!B?.token);
const call = async (method, p, body, who) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${who.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const nowTs = () => db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') t").get().t;
const ch = (await call('POST', '/comms/channels', { name: 'ti-floor', kind: 'public', member_ids: ['ti-a'] }, B)).body;
const chId = ch?.id || ch?.channel?.id;
const post = async (who, body, extra = {}) => (await call('POST', `/comms/channels/${chId}/messages`, { body, ...extra }, who)).body;
const LONG = ' — checked the sifter screen, the gaskets and the hopper before signing off the line.'.repeat(3);

// One read thread (oldest), then three unread threads of ten long replies each.
const readP = await post(B, 'Old question about the label printer');
await post(A, 'answered', { parent_id: readP.id });
await call('POST', `/comms/threads/${readP.id}/read`, {}, A);
const unreadP = [];
for (const [k, title] of [['1', 'Room 2 changeover'], ['2', 'Blender 1 seal'], ['3', 'Night clean roster']]) {
  const p = await post(B, `${title} — please read`);
  db.prepare('INSERT OR REPLACE INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)').run('ti-a', p.id, nowTs());
  await post(A, 'following', { parent_id: p.id });
  for (let i = 0; i < 10; i++) await post(B, `thread ${k} note ${i}${LONG}`, { parent_id: p.id });
  unreadP.push(p);
}
const marker = (pid) => db.prepare('SELECT last_read_at FROM chat_thread_reads WHERE user_id = ? AND parent_id = ?').get('ti-a', pid)?.last_read_at;
const newest = (pid) => db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE parent_id = ?').get(pid).t;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [label, vp, mobile] of [['1280', { width: 1280, height: 800 }, false], ['390px', { width: 390, height: 844 }, true]]) {
  console.log(`\n── the inbox at ${label} ──`);
  // Reset: all three unread again.
  for (const p of unreadP) db.prepare('UPDATE chat_thread_reads SET last_read_at = (SELECT created_at FROM chat_messages WHERE parent_id = ? AND user_id = ? ORDER BY created_at LIMIT 1) WHERE user_id = ? AND parent_id = ?').run(p.id, 'ti-a', 'ti-a', p.id);
  const pg = await browser.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  pg.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await pg.goto(`${URL}/manifest.webmanifest`);
  await pg.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('comms_last_view'); localStorage.removeItem('comms_last_channel'); }, [A.token, A.user]);
  await pg.goto(`${URL}/chat`);
  await pg.click('[data-nav-threads]', { timeout: 15000 });
  await pg.waitForSelector('[data-inbox-card]', { timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(800);
  const cards = await pg.evaluate(() => [...document.querySelectorAll('[data-inbox-card]')].map((c) => {
    const r = c.getBoundingClientRect();
    return { id: c.getAttribute('data-inbox-card'), unread: Number(c.getAttribute('data-inbox-unread')), top: r.top, bottom: r.bottom, h: r.height, text: c.textContent };
  }));
  const ids = unreadP.map((p) => p.id);
  const unreadCards = cards.filter((c) => ids.includes(c.id));
  t(`${label}: all three unread threads are cards, first`, unreadCards.length === 3 && cards.slice(0, 3).every((c) => c.unread > 0), JSON.stringify(cards.map((c) => [c.unread, Math.round(c.h)])));
  t(`${label}: each card is collapsed (under 170px tall)`, unreadCards.every((c) => c.h < 170), JSON.stringify(unreadCards.map((c) => Math.round(c.h))));
  t(`${label}: all three fit on the first screen`, unreadCards.every((c) => c.bottom <= vp.height), JSON.stringify(unreadCards.map((c) => Math.round(c.bottom))));
  t(`${label}: a card names "N new", the starter's words and the latest reply`, unreadCards.every((c) => /\d+ new/.test(c.text) && /please read/.test(c.text) && /note 9/.test(c.text)) && !unreadCards.some((c) => /note 3/.test(c.text)));
  t(`${label}: no reply is rendered in the list`, (await pg.$$('[data-inbox-card] textarea')).length === 0);
  await pg.waitForTimeout(4500);
  t(`${label}: a card sitting on screen marks nothing read`, unreadP.every((p) => marker(p.id) < newest(p.id)));
  const target = unreadP[1];
  await pg.locator(`[data-inbox-card="${target.id}"] [data-inbox-open]`).click();
  await pg.waitForSelector('[data-thread-scroll] [data-reply-id]', { timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(1200);
  const land = await pg.evaluate(() => {
    const el = document.querySelector('[data-thread-scroll]');
    if (!el) return null;
    const node = [...el.querySelectorAll('[data-reply-id]')].find((n) => n.textContent.includes('note 0'));
    const reply = document.querySelector('textarea[placeholder="Reply…"]')?.getBoundingClientRect();
    return { top: node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null, which: el.textContent.includes('thread 2 note 0'),
      divider: !!el.querySelector('[data-new-divider]'), jump: !!document.querySelector('[data-thread-jump]'), reply: reply && { bottom: reply.bottom, right: reply.right },
      vw: window.innerWidth, vh: window.innerHeight, pan: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  t(`${label}: clicking a card opens THAT thread in the drawer`, !!land && land.which, JSON.stringify(land));
  t(`${label}: …at its first unread reply, with the New line and Jump to latest`, !!land && land.top !== null && land.top >= -5 && land.top < 200 && land.divider && land.jump, JSON.stringify(land));
  t(`${label}: …with the reply box on screen`, !!land?.reply && land.reply.bottom <= land.vh && land.reply.right <= land.vw);
  t(`${label}: nothing pans sideways`, land && !land.pan);
  t(`${label}: the other unread threads are untouched`, marker(unreadP[0].id) < newest(unreadP[0].id) && marker(unreadP[2].id) < newest(unreadP[2].id));
  // Close the drawer: the list is still there.
  await pg.click('[aria-label="Close thread"]');
  await pg.waitForTimeout(1000);
  t(`${label}: closing the drawer returns to the list`, !(await pg.$('[data-thread-scroll]')) && (await pg.$$('[data-inbox-card]')).length >= 3);
  // Mark read from a card.
  await pg.locator(`[data-inbox-card="${unreadP[0].id}"] [data-inbox-markread]`).click();
  await pg.waitForTimeout(1000);
  t(`${label}: Mark read on a card reads that thread to the end`, marker(unreadP[0].id) >= newest(unreadP[0].id) && marker(unreadP[2].id) < newest(unreadP[2].id));
  t(`${label}: …and the card loses its badge`, await pg.getAttribute(`[data-inbox-card="${unreadP[0].id}"]`, 'data-inbox-unread') === '0');
  await pg.close();
}
await browser.close();
db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
