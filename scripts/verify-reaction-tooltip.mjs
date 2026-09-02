// Who reacted, on hover — and specifically that it STAYS OPEN.
//
// The first cut drew this through MenuPortal, which lays a full-screen
// click-catcher behind its panel. The instant the tooltip opened, that backdrop
// covered the chip: the pointer was over the backdrop, mouseleave fired, the
// tooltip closed, the backdrop went with it, mouseenter fired again. A flicker
// loop, reported as "really glitchy". The sampling loop below is the assertion
// that matters — with the backdrop restored the tooltip cannot even be caught.
//
// Caller sets PORT + DBPATH and boots a server first, on a FRESH database:
// the last assertion toggles a reaction off, and the channel it uses is the
// default #general, so a reused database accumulates state it did not create.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4901;
const B = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('hv-a','Hover Admin','Hover Admin','admin','qa',1,'SHV', datetime('now','+7 day'))`).run();
  db.close();
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (base) => {
  const H = { 'Content-Type': 'application/json' };
  await fetch(base + '/api/users/login', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Hover Admin' }) });
  await fetch(base + '/api/users/set-password', { method: 'POST', headers: H, body: JSON.stringify({ user_id: 'hv-a', password: 'HoverSecret2026', setup_code: 'SHV' }) });
  const j = await (await fetch(base + '/api/users/login', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Hover Admin', password: 'HoverSecret2026' }) })).json();
  localStorage.setItem('auth_token', j.token); localStorage.setItem('auth_user', JSON.stringify(j.user));
  const A = { ...H, Authorization: `Bearer ${j.token}` };
  let cs = await (await fetch(base + '/api/comms/channels', { headers: A })).json();
  let list = cs.channels || cs;
  if (!Array.isArray(list) || !list.length) {
    await fetch(base + '/api/comms/channels', { method: 'POST', headers: A, body: JSON.stringify({ name: 'general', kind: 'public' }) });
    cs = await (await fetch(base + '/api/comms/channels', { headers: A })).json(); list = cs.channels || cs;
  }
  const ch = list[0];
  // Its OWN message every run: the last assertion toggles the reaction off, so
  // reusing one would leave nothing to hover on the second time.
  const m = await (await fetch(base + `/api/comms/channels/${ch.id}/messages`, { method: 'POST', headers: A,
    body: JSON.stringify({ body: `reaction target ${Date.now()}` }) })).json();
  for (const e of ['👍', '🎉']) await fetch(base + `/api/comms/messages/${m.id}/reactions`, { method: 'POST', headers: A, body: JSON.stringify({ emoji: e }) });
}, B);
await page.goto(B + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// The newest 👍 chip on the page is the one this run made — earlier runs
// toggled theirs off, and a fresh message is appended at the bottom.
// data-reaction, not the emoji text: the hover pill and the emoji picker hold
// the same characters and would be matched instead.
const chip = page.locator('button[data-reaction="👍"]').last();
const tip = () => page.locator('body > div.fixed.z-\\[70\\]');
t('the chip is there', await chip.count() > 0, `chips: ${await page.locator('button[data-reaction="👍"]').count()}`);
await chip.scrollIntoViewIfNeeded();
t('nothing shown before hovering', await tip().count() === 0);

await chip.hover();
await page.waitForTimeout(400);
t('hovering opens it', await tip().count() === 1, `${await tip().count()}`);
t('and it names the reactor', /You/.test(await tip().first().textContent() || ''), await tip().first().textContent());

// THE FLICKER TEST: with the pointer held still on the chip, the tooltip must
// stay open. The old backdrop made it open/close on a loop.
let flickers = 0;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(120);
  if (await tip().count() === 0) flickers++;
}
t('IT STAYS OPEN WHILE THE POINTER IS STILL', flickers === 0, `disappeared ${flickers}/12 samples`);

// It must not steal the pointer either — the chip is still the hover target.
const owns = await page.evaluate(() => {
  const el = document.querySelector('body > div.fixed.z-\\[70\\]');
  return el ? getComputedStyle(el).pointerEvents : 'none';
});
t('the tooltip never takes the pointer', owns === 'none', owns);

await page.mouse.move(5, 5);
await page.waitForTimeout(400);
t('moving away closes it', await tip().count() === 0);

// Brushing past must not flash it.
await chip.hover();
await page.waitForTimeout(60);
const flashed = await tip().count();
await page.mouse.move(5, 5);
t('a quick brush past does not flash it', flashed === 0, `${flashed}`);

// And the chip still toggles the reaction on a click.
await page.waitForTimeout(500);
const before = await chip.textContent();
await chip.click();
await page.waitForTimeout(1500);
const after = await page.locator('button[data-reaction="👍"]').last().textContent().catch(() => 'gone');
t('clicking still toggles the reaction', after !== before, `${before} → ${after}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
