// verify:commshistory — D-199. Scrolling up loads a channel's earlier messages.
//
// Marnee: she could not see older messages in a DM. Nothing limited history —
// the server keeps every message — but the channel screen loaded only the
// newest 50 and nothing ever asked for the page before them. The calendar's
// jump-to-date was the only way back, and nobody finds it.
//
// Caller sets PORT + DBPATH on a fresh database. Needs a built client. The
// control is `main` before the change: the server ignores `through`, and the
// screen offers no way past the newest 50.
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5119;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name, role) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'office',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, JSON.stringify({ operator: 'view' }));
mk('ch-a', 'Marnee Office', 'supervisor');
mk('ch-b', 'Paula Partner', 'operator');

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'History2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'History2026!!' })).json();
};
const A = await signIn('Marnee Office', 'ch-a');
t('signed in', !!A?.token);
const get = async (p) => (await fetch(`${URL}/api${p}`, { headers: { Authorization: `Bearer ${A.token}` } })).json();

// A DM with 130 messages over the last few weeks, three of them sharing ONE
// timestamp exactly where a page boundary falls (an imported Slack second).
const dm = await (await fetch(`${URL}/api/comms/dm/ch-b`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${A.token}` } })).json();
t('the DM exists', !!dm?.id, JSON.stringify(dm));
const TOTAL = 130;
const ins = db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)');
const base = Date.parse('2026-09-01T12:00:00Z');
const stamps = [];
for (let i = 0; i < TOTAL; i++) {
  // Messages 78, 79 and 80 share a timestamp, and the newest page (81–129 plus
  // one of the three) ends inside that second — so the cursor lands on it.
  const k = (i >= 78 && i <= 80) ? 78 : i;
  const ts = new Date(base + k * 3600_000).toISOString().replace('T', ' ').replace('Z', '');
  stamps.push(ts);
  ins.run(crypto.randomUUID(), dm.id, i % 2 ? 'ch-b' : 'ch-a', `history message ${String(i).padStart(3, '0')}`, ts);
}
db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ?').run('2099-01-01 00:00:00.000', dm.id);

console.log('\n── the server: every page reachable, nothing skipped ──');
const first = await get(`/comms/channels/${dm.id}/messages`);
t('a channel opens on its newest 50', first.length === 50 && first.at(-1).body === 'history message 129', `${first.length} ${first.at(-1)?.body}`);
const seen = new Map(first.map(m => [m.id, m]));
let oldest = first[0];
let pages = 0;
while (pages < 10) {
  pages++;
  const page = await get(`/comms/channels/${dm.id}/messages?through=${encodeURIComponent(oldest.created_at)}&limit=50`);
  const fresh = page.filter(m => !seen.has(m.id));
  for (const m of fresh) seen.set(m.id, m);
  if (page.length < 50 || !fresh.length) break;
  oldest = page[0];
}
t('PAGING BACK REACHES EVERY MESSAGE IN THE DM', seen.size === TOTAL, `${seen.size} of ${TOTAL} after ${pages} pages`);
t('…the three sharing one second are all there', [78, 79, 80].every(i => [...seen.values()].some(m => m.body === `history message ${String(i).padStart(3, '0')}`)));
t('…down to the very first', [...seen.values()].some(m => m.body === 'history message 000'));
const through = await get(`/comms/channels/${dm.id}/messages?through=${encodeURIComponent(first[0].created_at)}&limit=5`);
t('`through` is inclusive of the cursor message', through.some(m => m.id === first[0].id));
const before = await get(`/comms/channels/${dm.id}/messages?before=${encodeURIComponent(first[0].created_at)}&limit=5`);
t('`before` is unchanged (exclusive)', !before.some(m => m.id === first[0].id) && before.length === 5);

console.log('\n── the screen: scroll up and the history comes ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tok, u, id]) => {
      localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
      localStorage.setItem('comms_last_channel', id); localStorage.setItem('comms_last_view', 'channel');
    }, [A.token, A.user, dm.id]);
    await page.goto(`${URL}/chat`);
    await page.waitForSelector('[data-msg-scroll] >> text=history message 129', { timeout: 8000 }).catch(() => {});
    if (await page.locator('[data-msg-scroll] >> text=history message 129').count() === 0) {
      // A phone opens on the channel list; tap the DM like a person would.
      await page.getByText('Paula Partner', { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForSelector('[data-msg-scroll] >> text=history message 129', { timeout: 10000 }).catch(() => {});
    }
    await page.waitForTimeout(1200);
    const count = () => page.locator('[data-msg-scroll] [data-mid]').count();
    t(`${w}px: opens on the newest 50`, await count() === 50, String(await count()));
    t(`${w}px: the top of the list says there is more`, await page.locator('[data-history="more"]').count() === 1);

    // Scroll to the top once; the message that was on top must stay in view.
    const topId = await page.evaluate(() => document.querySelector('[data-msg-scroll] [data-mid]').getAttribute('data-mid'));
    await page.evaluate(() => { document.querySelector('[data-msg-scroll]').scrollTop = 0; });
    await page.waitForSelector('[data-msg-scroll] >> text=history message 050', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    t(`${w}px: SCROLLING TO THE TOP LOADS THE PAGE BEFORE`, await count() === 99, String(await count()));
    const kept = await page.evaluate((id) => {
      const el = document.querySelector('[data-msg-scroll]');
      const node = el.querySelector(`[data-mid="${id}"]`);
      return node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
    }, topId);
    const scrolled = await page.evaluate(() => document.querySelector('[data-msg-scroll]').scrollTop);
    t(`${w}px: …and keeps the reader's place (the message that was on top stays where it was, the new page sits above it)`,
      kept !== null && kept >= 0 && kept < 200 && scrolled > 500, `top at ${kept}, scrollTop ${scrolled}`);

    // Keep going until the beginning.
    for (let i = 0; i < 6 && await page.locator('[data-history="start"]').count() === 0; i++) {
      await page.evaluate(() => { document.querySelector('[data-msg-scroll]').scrollTop = 0; });
      await page.waitForTimeout(800);
    }
    t(`${w}px: the whole DM is on screen`, await count() === TOTAL, String(await count()));
    t(`${w}px: the first message is there`, await page.locator('[data-msg-scroll] >> text=history message 000').count() === 1);
    t(`${w}px: the top says it is the beginning`, await page.locator('[data-history="start"]').count() === 1);
    t(`${w}px: the page does not pan sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.close();
  }

  // A short channel says it is the beginning straight away and offers no button.
  const short = await (await fetch(`${URL}/api/comms/channels`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${A.token}` }, body: JSON.stringify({ name: 'ch-short', kind: 'public' }) })).json();
  const sid = short.id || short.channel?.id;
  for (let i = 0; i < 3; i++) await fetch(`${URL}/api/comms/channels/${sid}/messages`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${A.token}` }, body: JSON.stringify({ body: `short ${i}` }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u, id]) => {
    localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
    localStorage.setItem('comms_last_channel', id); localStorage.setItem('comms_last_view', 'channel');
  }, [A.token, A.user, sid]);
  await page.goto(`${URL}/chat`);
  await page.waitForSelector('[data-msg-scroll] >> text=short 2', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  t('a three-message channel reads "Beginning of the conversation", no button', await page.locator('[data-history="start"]').count() === 1 && await page.locator('[data-load-older]').count() === 0);
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
