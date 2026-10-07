// A reminder's "Open the message" opens in the app it is read in (D-156).
//
// Reported as: the ReadyBot reminder arrives on time, and tapping "Open the
// message" opens a browser instead of jumping inside the installed app. The
// link names the branded origin; an app installed on the Railway domain is the
// same server on a different address, and the renderer compared the link to
// `window.location.origin` only — so it drew an outside link.
//
// Reproduced here by running the server with READYDOC_ORIGIN on 127.0.0.1 and
// reading Messages on localhost: same server, two addresses, exactly the shape.
//
// Caller sets PORT + DBPATH and READYDOC_ORIGIN=http://127.0.0.1:<PORT>.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5075;
const URL_ = `http://localhost:${PORT}`;
const B = `${URL_}/api`;
const OTHER = `http://127.0.0.1:${PORT}`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'a') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('rl-a','Remind Reader','Remind Reader','admin','qa',1,'SC-RL',datetime('now','+7 day'),NULL)`).run();
await post('/users/login', { name: 'Remind Reader' });
await post('/users/set-password', { user_id: 'rl-a', password: 'RemindRead2026!', setup_code: 'SC-RL' });
const auth = await J(await post('/users/login', { name: 'Remind Reader', password: 'RemindRead2026!' }));
tok.a = auth?.token;
t('signed in', !!tok.a);

// ── The server names every address it answers on ────────────────────────────
const status = await J(await req('/comms/status'));
t('/comms/status lists the app\'s addresses', Array.isArray(status?.app_origins), JSON.stringify(status || {}).slice(0, 160));
t('…including the one READYDOC_ORIGIN points at', status?.app_origins?.includes(OTHER), JSON.stringify(status?.app_origins));
t('…and Railway\'s own domain, where the pre-D-140 installs live', status?.app_origins?.includes('https://powderops-fsqa.up.railway.app'));
t('…and never a shared-hosting pattern', !status?.app_origins?.some(o => o.includes('*')));

// ── A real reminder, delivered by the real loop ─────────────────────────────
const ch = await J(await post('/comms/channels', { name: 'remind-test', kind: 'public' }));
const channelId = ch?.id || ch?.channel?.id;
// Something to scroll past, so landing on the target is a real jump.
for (let i = 0; i < 25; i++) await post(`/comms/channels/${channelId}/messages`, { body: `filler line ${i}` });
const target = await J(await post(`/comms/channels/${channelId}/messages`, { body: 'check the sifter screen before the next run' }));
for (let i = 0; i < 25; i++) await post(`/comms/channels/${channelId}/messages`, { body: `later line ${i}` });
const rem = await post(`/comms/messages/${target.id}/remind`, { at: new Date(Date.now() + 1500).toISOString() });
t('a reminder is set on the message', rem.status === 201, `got ${rem.status}`);

let delivered = null;
for (let i = 0; i < 90 && !delivered; i++) {
  await new Promise(r => setTimeout(r, 1000));
  delivered = db.prepare(`SELECT m.* FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id
    WHERE c.kind = 'dm' AND m.body LIKE '%Reminder%' AND m.body LIKE ?`).get(`%${target.id}%`);
}
t('ReadyBot delivers it', !!delivered);
const dmId = delivered?.channel_id;
t('the link names the OTHER address (READYDOC_ORIGIN), not the one the reader is on',
  delivered?.body?.includes(`${OTHER}/?c=${channelId}&m=${target.id}`), delivered?.body);

// ── The click, in a real browser on the other address ───────────────────────
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function openDm(page) {
  await page.goto(`${URL_}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL_}/chat`, { waitUntil: 'domcontentloaded' });
  await page.getByText('ReadyBot', { exact: false }).first().click({ timeout: 20000 });
  await page.getByText('check the sifter screen', { exact: false }).first().waitFor({ timeout: 15000 });
}
async function clickAndWatch(ctx, page, locator) {
  let popup = null;
  ctx.on('page', p => { popup = p; });
  await locator.click();
  await page.waitForTimeout(2500);
  return popup;
}
// The phone layout slides the conversation pane in before it scrolls, so the
// landing is polled for, not sampled once.
const targetOnScreen = async (page) => {
  let last = { found: false };
  for (let i = 0; i < 12; i++) {
    last = await onScreenOnce(page);
    if (last.found && last.visible) return last;
    await page.waitForTimeout(500);
  }
  return last;
};
const onScreenOnce = (page) => page.evaluate((id) => {
  // Visible means inside the conversation's own scroller, not merely inside
  // the window — a message scrolled out of the list is still "on the page".
  const els = [...document.querySelectorAll(`[data-mid="${id}"]`)].filter(e => e.getClientRects().length);
  if (!els.length) return { found: false };
  const out = els.map(el => {
    const r = el.getBoundingClientRect();
    let sc = el.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom), st: sc?.scrollTop,
      visible: r.bottom > box.top && r.top < box.bottom && r.top < window.innerHeight && r.bottom > 0 };
  });
  return { found: true, visible: out.some(o => o.visible), detail: out };
}, target.id);

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await openDm(page);
  const link = page.getByText('Open the message').last();
  const tag = await link.evaluate(el => el.tagName).catch(() => null);
  t('in the app, "Open the message" is an in-app control, not an outside link', tag === 'BUTTON', `rendered as ${tag}`);
  const popup = await clickAndWatch(ctx, page, link);
  t('tapping it opens NO browser tab', !popup, popup ? `opened ${popup.url()}` : '');
  t('the app stays on the address it is running on', page.url().startsWith(URL_), page.url());
  t('…and lands in the channel the reminder was about', await page.getByText('later line 24').count() > 0);
  const seen = await targetOnScreen(page);
  t('…on the message itself', seen.found && seen.visible, JSON.stringify(seen));
  await ctx.close();
}

// ── A cold start: the list of addresses arrives AFTER the message renders ───
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/api/comms/status', async (route) => {
    await new Promise(r => setTimeout(r, 6000));
    await route.continue();
  });
  await openDm(page);
  const link = page.getByText('Open the message').last();
  const tag = await link.evaluate(el => el.tagName).catch(() => null);
  t('(cold start) before the list arrives the link draws as a plain link', tag === 'A', `rendered as ${tag}`);
  await page.waitForTimeout(6500);
  const popup = await clickAndWatch(ctx, page, link);
  t('(cold start) clicked once the list is in, it still opens in the app, not a tab', !popup, popup ? `opened ${popup.url()}` : '');
  const seen = await targetOnScreen(page);
  t('(cold start) …on the message', seen.found && seen.visible, JSON.stringify(seen));
  const remembered = await page.evaluate(() => localStorage.getItem('app_origins'));
  t('the addresses are remembered for the next cold start', !!remembered && remembered.includes(OTHER), remembered);
  await ctx.close();
}

// ── An outside link is still an outside link ────────────────────────────────
{
  await post(`/comms/channels/${dmId}/messages`, { body: 'see https://example.com/?c=abc&m=def for details' }).catch(() => {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await openDm(page);
  const ext = page.locator('a[href^="https://example.com"]').last();
  t('a link to somebody else\'s site with the same ?c= shape stays an outside link',
    await ext.count() > 0 && (await ext.getAttribute('target')) === '_blank');
  await ctx.close();
}

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
