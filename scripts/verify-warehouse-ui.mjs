// The two new screens in a real browser: People (a tag picked and filtered, a
// résumé attached) and the Shipping tab of the Receiving Log (start, tap
// answers, attach a photo of the load, release). Caller sets PORT + DBPATH and
// the R2 stand-in; needs a built client.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const PORT = process.env.PORT || 4968;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('ui-office','Office Admin','Office Admin','admin','office',1,'SC-UI',datetime('now','+7 day'))`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Office Admin' });
await post('/users/set-password', { user_id: 'ui-office', password: 'Office2026!', setup_code: 'SC-UI' });
const auth = await (await post('/users/login', { name: 'Office Admin', password: 'Office2026!' })).json();
t('signed in', !!auth?.token);

const resume = join(tmpdir(), 'ui-resume.pdf');
writeFileSync(resume, '%PDF-1.4 resume');
const photo = join(tmpdir(), 'ui-load.png');
writeFileSync(photo, Buffer.from('89504e470d0a1a0a', 'hex'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);

console.log('\n── People ──');
await page.goto(`${URL}/?tab=candidates`);
await page.waitForTimeout(3000);
t('the tag filter row offers the teams and Temp / 1099', await page.locator('[data-tag-filters] button').count() >= 10
  && /Temp \/ 1099/.test(await page.locator('[data-tag-filters]').innerText()));
await page.getByRole('button', { name: /Add someone/ }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="First name is enough"]').fill('Browser Tester');
await page.locator('[data-tag-picker] button', { hasText: 'Kitting' }).click();
await page.locator('[data-tag-picker] button', { hasText: 'Temp / 1099' }).click();
t('two tags picked read as pressed', await page.locator('[data-tag-picker] button[aria-pressed="true"]').count() === 2);
await page.getByRole('button', { name: /Add to the list/ }).click();
await page.waitForTimeout(1500);
// The seeded board has other people on it, each with their own attach control —
// scope to the card just created.
const card = page.locator('div.rounded-xl.border', { hasText: 'Browser Tester' }).first();
t('the card shows both tag chips', await card.locator('[data-tag="Kitting"]').count() === 1 && await card.locator('[data-tag="Temp / 1099"]').count() === 1);
t('the card offers to attach a résumé', await card.locator('[data-candidate-files] input[type=file]').count() === 1);
await card.locator('[data-candidate-files] input[type=file]').setInputFiles(resume);
await page.waitForTimeout(2000);
t('the file appears on the card', /ui-resume\.pdf/.test(await card.locator('[data-candidate-files]').innerText()));
await page.locator('[data-tag-filters] button', { hasText: 'Temp / 1099' }).click();
await page.waitForTimeout(1200);
t('filtering by Temp / 1099 keeps the person', /Browser Tester/.test(await page.locator('body').innerText()));
await page.locator('[data-tag-filters] button', { hasText: 'Maintenance' }).click();
await page.waitForTimeout(1200);
t('filtering by a tag they lack hides them', !/Browser Tester/.test(await page.locator('body').innerText()) && /Nobody matches/.test(await page.locator('body').innerText()));

console.log('\n── Shipping ──');
await page.goto(`${URL}/?tab=receiving-log&view=shipping`);
await page.waitForTimeout(3000);
t('the Receiving module has a Shipping tab', await page.getByRole('button', { name: /^Shipping$/ }).count() === 1);
t('the Shipping tab opens on start-an-inspection', await page.locator('[data-start-shipment]').count() === 1);
await page.locator('[data-start-shipment]').click();
await page.waitForTimeout(1500);
const drawer = page.locator('[data-shipping-checklist]');
t('the inspection drawer opens', await drawer.count() === 1);
t('it says the form is a draft with no number yet', await drawer.locator('[data-draft-note]').count() === 1 && /no form number yet/.test(await drawer.innerText()));
const yesButtons = drawer.getByRole('button', { name: /^Yes$/ });
const n = await yesButtons.count();
t('eighteen answer rows', n === 18, `${n}`);
// Tap through: Yes on everything except the three hazard questions and the
// two N/A ones, so nothing escalates and nothing is left blank.
const items = await drawer.locator('p.text-sm.text-gray-900').allInnerTexts();
for (let i = 0; i < items.length; i++) {
  const text = items[i];
  const row = drawer.locator('p.text-sm.text-gray-900', { hasText: text }).first().locator('xpath=ancestor::div[contains(@class,"px-3")][1]');
  const pick = /pests|Residue|Visible damage/.test(text) ? 'No' : /Refrigeration|Allergen-containing/.test(text) ? 'N/A' : 'Yes';
  await row.getByRole('button', { name: new RegExp(`^${pick.replace('/', '\\/')}$`) }).click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(1200);
t('all questions answered', /All questions answered/.test(await drawer.innerText()));
t('the photo claim is flagged while no photo is attached', await drawer.locator('[data-photo-claim]').count() === 1);
// Two doors: the camera (capture) and the camera roll (no capture) — one input
// with capture hides the roll on iOS.
t('the load photo control offers the camera AND the camera roll', await drawer.locator('[data-photos] input[data-photo-take][capture]').count() === 1
  && await drawer.locator('[data-photos] input[data-photo-choose]:not([capture])').count() === 1);
await drawer.locator('[data-photos] input[data-photo-choose]').setInputFiles(photo);
await page.waitForTimeout(2000);
t('the photo lands under the load section', /ui-load\.png/.test(await drawer.locator('[data-photos]').innerText()) && await drawer.locator('[data-photo-claim]').count() === 0);
await drawer.getByRole('button', { name: /release shipment/ }).click();
await page.waitForTimeout(1500);
t('released, with the signer named', /Released by Office Admin/.test(await drawer.innerText()));
await page.keyboard.press('Escape');
await drawer.locator('button:has(svg.lucide-x)').first().click();
await page.waitForTimeout(800);
t('the list shows the released inspection with its photo', /Released/.test(await page.locator('[data-shipment]').first().innerText()) && /1 photo/.test(await page.locator('[data-shipment]').first().innerText()));

// A phone: the drawer must not pan the page sideways.
const m = await browser.newPage({ viewport: { width: 360, height: 740 } });
await m.goto(`${URL}/manifest.webmanifest`);
await m.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await m.goto(`${URL}/?tab=receiving-log&view=shipping&shipment=S-100-0001`);
await m.waitForTimeout(3000);
t('the drawer opens from the deep link on a phone', await m.locator('[data-shipping-checklist]').count() === 1);
t('nothing sticks out sideways at 360px', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
