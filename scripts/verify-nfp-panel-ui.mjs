// The panel values and the %DV refusal, in a real browser.
//
// Two screens and one rule. In the app, typing an amount shows what it
// computes to beside the box; on the PUBLIC approval page — the door most of
// these approvals come through, on a phone — Approve is unavailable until the
// approver has ticked to say they looked at the mismatches.
//
// Caller sets PORT + DBPATH; needs a built client.
//
// THE CONTROL: drop `canApprove` back to `canDecide` in NfpApprovePage.jsx and
// the phone assertions fail — the button is live with a defective panel on
// screen and nothing ticked.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5017;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  // NULL module_access: a map on an admin is a RESTRICTION map.
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('nfp-ui','Panel QA','Panel QA','admin','qa',1,NULL,'SC-NFPUI',datetime('now','+7 day'))`).run();
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Panel QA' });
await post('/users/set-password', { user_id: 'nfp-ui', password: 'Panel2026!', setup_code: 'SC-NFPUI' });
const auth = await (await post('/users/login', { name: 'Panel QA', password: 'Panel2026!' })).json();
t('signed in', !!auth?.token);

const sku = (() => {
  const db = new Database(process.env.DBPATH, { readonly: true });
  const p = db.prepare(`SELECT sku FROM products WHERE gtin IS NOT NULL AND gtin != ''
    AND sku NOT IN (SELECT sku FROM nfp_versions) ORDER BY sku LIMIT 1`).get();
  db.close(); return p?.sku;
})();
const api = (p, body, method = 'POST') => fetch(`${URL}/api${p}`,
  { method, headers: { ...H, Authorization: `Bearer ${auth.token}` }, body: JSON.stringify(body) });
const version = await (await api('/nfp', { sku, version: 'V1', drive_url: 'https://drive.example/v1' })).json();
t('a panel to work on', !!version?.id, sku);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

console.log('\nTyping the panel in: the computed %DV appears beside the box');
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=products`);
await page.waitForTimeout(3500);
await page.getByRole('tab', { name: /Nutrition panels/ }).first().click();
await page.waitForTimeout(1500);
// The board is the roll-up; the workflow is in the product drawer, which is
// where the row takes you.
t('the panel is waiting on someone, on the board', /Waiting on someone/.test(await page.locator('body').innerText()));
const boardRow = page.locator(`button:has(code:text-is("${sku}"))`).first();
await boardRow.scrollIntoViewIfNeeded();
await boardRow.click();
await page.waitForTimeout(2500);
const found = await page.locator('[data-panel-values]').count();
t('the panel card carries a Panel values section', found > 0, `found ${found}`);
if (found) {
  await page.locator('[data-panel-toggle]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-panel-amount="sodium_mg"]').first().fill('570');
  await page.waitForTimeout(250);
  t('Sodium 570 mg shows the 25% it computes to, as you type',
    /25%/.test(await page.locator('[data-panel-computed="sodium"]').first().innerText()),
    await page.locator('[data-panel-computed="sodium"]').first().innerText());
  await page.locator('[data-panel-dv="sodium"]').first().fill('21');
  await page.waitForTimeout(250);
  t('declaring 21% raises the mismatch immediately, not at the next save',
    await page.locator('[data-dv-warning]').count() > 0);
  // The trap this whole feature turns on.
  await page.locator('[data-panel-amount="calcium_mg"]').first().fill('150');
  await page.locator('[data-panel-dv="calcium"]').first().fill('10');
  await page.waitForTimeout(250);
  t('CALCIUM 150 mg SHOWS 10%, the mineral increment — not the 12% a whole-percent rule gives',
    /(^|\D)10%/.test(await page.locator('[data-panel-computed="calcium"]').first().innerText()),
    await page.locator('[data-panel-computed="calcium"]').first().innerText());
  t('and it raises no mismatch of its own',
    !/Calcium/.test(await page.locator('[data-dv-warning]').first().innerText()),
    await page.locator('[data-dv-warning]').first().innerText());
  // An amount box must accept "<1" — a number input would refuse the "<" with
  // a browser tooltip that reads as the app being broken.
  await page.locator('[data-panel-amount="dietary_fiber_g"]').first().fill('<1');
  await page.waitForTimeout(250);
  t('"<1" CAN BE TYPED — the amount boxes are text, not number',
    await page.locator('[data-panel-amount="dietary_fiber_g"]').first().inputValue() === '<1');
  t('and it reads as "at most 4%"',
    /at most 4%/.test(await page.locator('[data-panel-computed="dietary_fiber"]').first().innerText()),
    await page.locator('[data-panel-computed="dietary_fiber"]').first().innerText());
  await page.locator('[data-panel-save]').first().click();
  await page.waitForTimeout(1200);
  const saved = await (await fetch(`${URL}/api/nfp/sku/${encodeURIComponent(sku)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } })).json();
  const v = saved?.versions?.[0];
  t('saving files the values and moves the revision to 1',
    v?.panel_rev === 1 && v?.panel?.sodium_mg === 570 && v?.panel?.dietary_fiber_g === '<1',
    JSON.stringify([v?.panel_rev, v?.panel?.sodium_mg, v?.panel?.dietary_fiber_g]));
}
await page.close();

console.log('\nThe approval link on a phone: Approve is unavailable until the tick');
const link = (await (await api(`/nfp/${version.id}/send`, { sent_to: 'Matt Schramm' })).json())?.link;
const token = link?.split('/').pop();
const phone = await browser.newPage({ viewport: { width: 390, height: 780 } });
phone.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await phone.goto(`${URL}/nfp/${token}`);
await phone.waitForTimeout(2500);
const body = await phone.locator('body').innerText();
t('the page opens with no login at all', /Nutrition Panel Approval/.test(body));
t('THE MISMATCH IS ON THE PAGE, not behind the button',
  await phone.locator('[data-dv-warning]').count() === 1 && /Sodium/.test(body), body.slice(0, 200));
t('Approve is disabled while nothing is ticked',
  await phone.locator('[data-approve]').isDisabled());
t('and the page says why, rather than leaving a dead button',
  /Tick the box above/.test(body));
await phone.locator('[data-dv-ack]').check();
await phone.waitForTimeout(250);
t('ticking makes Approve available', !(await phone.locator('[data-approve]').isDisabled()));
t('the page does not scroll sideways at 390px',
  await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  String(await phone.evaluate(() => document.documentElement.scrollWidth)));
await phone.locator('[data-approve]').click();
await phone.waitForTimeout(300);
await phone.getByRole('button', { name: /Yes, confirm/ }).click();
await phone.waitForTimeout(1500);
t('the approval lands', /Panel Approved/.test(await phone.locator('body').innerText()));
const after = await (await fetch(`${URL}/api/nfp/sku/${encodeURIComponent(sku)}`,
  { headers: { Authorization: `Bearer ${auth.token}` } })).json();
t('and the record names who dismissed the mismatch',
  after?.versions?.[0]?.dv_ack_by === 'Matt Schramm',
  JSON.stringify(after?.versions?.[0]?.dv_ack_by));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
