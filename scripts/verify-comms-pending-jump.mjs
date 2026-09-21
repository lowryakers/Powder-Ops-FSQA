// A deep-link to a specific message that gets abandoned mid-flight must not
// come back to life on some later, unrelated visit to the same channel.
//
// Clicking a search result for an old message calls queueMessage(id), which
// sets pendingMsgRef and fetches the message to find out which day it's on.
// If the reader switches to a DIFFERENT channel before that fetch resolves,
// the effect's own race guard used to compare `m.channel_id` against
// `activeId` — the value this effect CLOSED OVER when it started, which
// never moves again. That only ever catches a mismatch that already existed
// before the fetch began; a reader who navigates away WHILE it's in flight
// changes the real active channel without changing that stale snapshot, so
// the guard passes anyway. pendingMsgRef is a plain useRef, so an abandoned
// target then sits there indefinitely: the NEXT time that original channel
// becomes active again — for any reason, no matter how much later — the
// effect re-fires with the same stale target, the (still-stale) guard
// passes again, and it silently re-asks for that old day and jumps the
// reader back into history they'd already read. Same race `loadMessages()`
// already guards against with `activeIdRef` (a ref kept live on every
// activeId change, not a closure) — this path just never got it.
//
// Verified against the network call itself, not the rendered banner: a plain
// reopen also fires its own fast, un-delayed messages fetch, and racing that
// against the (fixed or buggy) resolver to see which `setMessages` wins is
// not a reliable signal either way. Whether the abandoned target's
// day-window fetch goes out again at all is.
//
// Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4999;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

const uid = 'pj-user';
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,'admin','qa',1,'SC-PJ',datetime('now','+7 day'),NULL)`).run(uid, 'Pending Jump', 'Pending Jump');

const req = (p, o = {}, tok) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b, tok) => req(p, { method: 'POST', body: JSON.stringify(b) }, tok);
const J = async r => { try { return await r.json(); } catch { return null; } };

await post('/users/login', { name: 'Pending Jump' });
await post('/users/set-password', { user_id: uid, password: 'PendingJump2026!', setup_code: 'SC-PJ' });
const token = (await J(await post('/users/login', { name: 'Pending Jump', password: 'PendingJump2026!' })))?.token;
t('signed in', !!token);

const target = await J(await post('/comms/channels', { name: 'old-target', kind: 'public' }, token));
const targetId = target?.id || target?.channel?.id;
const elsewhere = await J(await post('/comms/channels', { name: 'elsewhere', kind: 'public' }, token));
const elsewhereId = elsewhere?.id || elsewhere?.channel?.id;
t('both channels exist', !!targetId && !!elsewhereId);

// One distinctively-worded message, then enough recent ones after it that it
// falls outside the default 50-message window — the condition that sends the
// deep-link resolver down the async, fetch-then-check-channel path at all.
const found = await J(await post(`/comms/channels/${targetId}/messages`, { body: 'PENDINGBUGTARGET the mixer needs a belt' }, token));
t('the target message posts', !!found?.id);
// Backdated for real — the reported bug is a message from weeks earlier read
// as current. Posting everything "now" would put the day-window fetch on
// the SAME calendar day as the live view, which renders identically and
// proves nothing.
db.prepare("UPDATE chat_messages SET created_at = '2026-09-04 09:54:00.000' WHERE id = ?").run(found.id);
for (let i = 0; i < 55; i++) {
  await post(`/comms/channels/${targetId}/messages`, { body: `filler message ${i}` }, token);
}
await post(`/comms/channels/${elsewhereId}/messages`, { body: 'nothing to do with any of this' }, token);

console.log('\n── reproducing the race in a real browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });

// Delay the single-message lookup just long enough to switch channels while
// it's in flight — this is the fetch the fixed code checks `activeId`
// against.
let delayLookup = false;
const reqLog = [];
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/comms/')) reqLog.push(u.replace(URL, '')); });
await page.route('**/api/comms/messages/*', async (route) => {
  if (delayLookup && !route.request().url().includes('/messages/channels')) {
    await new Promise(r => setTimeout(r, 2500));
  }
  await route.continue();
});

await page.goto(URL);
await page.fill('input[placeholder*="name" i], input[name=name]', 'Pending Jump').catch(() => {});
await page.fill('input[type=password]', 'PendingJump2026!');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

const openMsgs = page.locator('button:has-text("Open Messages"), button:has-text("Messages")').first();
if (await openMsgs.count()) await openMsgs.click().catch(() => {});
await page.waitForTimeout(1000);

await page.locator('text=old-target').first().click({ timeout: 10000 });
await page.waitForTimeout(1000);
t('the target channel opens', await page.locator('text=filler message 54').count() > 0);

await page.fill('input[placeholder="Search messages…"]', 'PENDINGBUGTARGET');
await page.waitForSelector('text=PENDINGBUGTARGET', { timeout: 10000 });
t('the search finds the old message', true);

delayLookup = true;
await page.locator('button:has-text("PENDINGBUGTARGET")').first().click();
// Switch away WHILE the delayed lookup is still in flight — the abandoned
// half of the race.
await page.waitForTimeout(400);
await page.locator('text=elsewhere').first().click({ timeout: 10000 });
await page.waitForTimeout(700);
const switched = await page.locator('text=nothing to do with any of this').count() > 0;
if (!switched) await page.screenshot({ path: '/tmp/claude-0/-home-user-Powder-Ops-FSQA/af00ada3-a0aa-542a-9170-4983495b696f/scratchpad/pj-debug.png', fullPage: true }).catch(() => {});
t('switched to the other channel before the lookup resolved', switched);
// Let the delayed fetch actually land.
await page.waitForTimeout(2600);
delayLookup = false;

// Now reopen the original channel NORMALLY — no search, no deep link. If the
// abandoned target is still armed, this is exactly the moment it fires — or,
// since the first (not the second) queued invocation's stale closure still
// names the RIGHT channel regardless of where the reader has since gone, it
// may already have fired the moment its own delayed lookup resolved, while
// "elsewhere" was still on screen. Either way it must never happen.
await page.locator('text=old-target').first().click({ timeout: 10000 });
await page.waitForTimeout(1500);

// THE DECISIVE CHECK: whether the abandoned target's day-window fetch goes
// out AT ALL, at any point after it was abandoned. Checking the rendered
// banner instead is racy on its own — a plain reopen also fires its own
// fast, un-delayed messages fetch, and which of two competing `setMessages`
// calls lands last depends on network timing neither this test nor the real
// app controls. The network call itself does not: a fixed reader never
// re-asks for that old day once the search that targeted it has been
// abandoned, no matter what happens afterward.
const leaked = reqLog.some(u => u.includes('messages?date=2026-09-04'));
t('THE ABANDONED SEARCH TARGET NEVER RESOLVES — no request for that old day is ever made once it is abandoned',
  !leaked, JSON.stringify(reqLog.filter(u => u.includes('date='))));

console.log('\n── comms requests seen ──');
for (const u of reqLog) console.log('  ' + u);

await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
