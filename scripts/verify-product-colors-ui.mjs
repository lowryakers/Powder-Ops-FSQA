// The colours editor in a real browser: the value the plant reported, corrected
// on the screen it is read on. Caller sets PORT + DBPATH; needs a built client.
//
// THE CONTROL: take `data-edit-colors` out of ProductsPanel and the whole run
// stops at the first assertion — which is the state the module was in, a value
// on screen with no door to correct it through.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5020;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('col-ui','Colour QA','Colour QA','admin','qa',1,NULL,'SC-COLUI',datetime('now','+7 day'))`).run();
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Colour QA' });
await post('/users/set-password', { user_id: 'col-ui', password: 'Colour2026!', setup_code: 'SC-COLUI' });
const auth = await (await post('/users/login', { name: 'Colour QA', password: 'Colour2026!' })).json();
t('signed in', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=products`);
await page.waitForTimeout(3500);

await page.locator('tr:has(code:text-is("PPM-PS"))').locator('visible=true').first().click();
await page.waitForTimeout(2000);
t('the product drawer opens on the pancake Pumpkin Spice',
  /Pumpkin Spice/.test(await page.locator('body').innerText()));
const block = page.locator('[data-colors-block]').first();
t('the brand colours are on it', await block.count() === 1);
const shown = await block.innerText();
t('SLOT 2 READS PMS 7580 C on the screen somebody looks at', /PMS 7580 C/.test(shown), shown.replace(/\n/g, ' '));
t('and PMS 285 C is gone from it', !/285/.test(shown), shown.replace(/\n/g, ' '));

console.log('\nCorrecting one, on the screen it is read on');
t('THERE IS A DOOR — the value is no longer read-only', await page.locator('[data-edit-colors]').count() === 1);
await page.locator('[data-edit-colors]').first().click();
await page.waitForTimeout(400);
t('the editor opens with the three colours filled in',
  await page.locator('[data-color-pms]').count() === 3);
t('and it says the value goes to the proofer, so the edit is not a private note',
  /proof/i.test(await page.locator('[data-colors-block]').first().innerText()));

// Live validity, from the same function the server stores it with.
await page.locator('[data-color-pms="1"]').fill('PNS 7580 C');
await page.waitForTimeout(250);
t('a typo is flagged as you type, before the save', await page.locator('[data-color-problems]').count() === 1,
  await page.locator('[data-colors-block]').first().innerText());
t('and Save is unavailable while it stands', await page.locator('[data-save-colors]').isDisabled());
await page.locator('[data-color-pms="1"]').fill('PMS 7580 C');
await page.locator('[data-color-hex="1"]').fill('HEX ZZZZZZ');
await page.waitForTimeout(250);
t('a hex that is not six hex digits is flagged the same way',
  await page.locator('[data-save-colors]').isDisabled());
await page.locator('[data-color-hex="1"]').fill('HEX C25131');
await page.waitForTimeout(250);
t('fixing it makes Save available again', !(await page.locator('[data-save-colors]').isDisabled()));

await page.locator('[data-add-color]').click();
await page.waitForTimeout(200);
await page.locator('[data-color-pms="3"]').fill('PMS Black C');
await page.locator('[data-color-hex="3"]').fill('HEX 000000');
await page.waitForTimeout(200);
await page.locator('[data-save-colors]').click();
await page.waitForTimeout(1800);
const after = await page.locator('[data-colors-block]').first().innerText();
t('the fourth colour is on the record', /PMS Black C/.test(after), after.replace(/\n/g, ' '));
const api = await (await fetch(`${URL}/api/products/PPM-PS`,
  { headers: { Authorization: `Bearer ${auth.token}` } })).json();
t('and the server has it, with its validity recomputed',
  (api.colors || []).length === 4 && api.colors.every((c) => c.pms_valid === 1),
  JSON.stringify((api.colors || []).map((c) => c.pms)));

console.log('\nAt 390px');
const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
phone.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);
await phone.goto(`${URL}/?tab=products`);
await phone.waitForTimeout(3500);
await phone.locator('button:has(code:text-is("PPM-PS")), tr:has(code:text-is("PPM-PS"))')
  .locator('visible=true').first().click();
await phone.waitForTimeout(1800);
await phone.locator('[data-edit-colors]').first().click();
await phone.waitForTimeout(500);
t('the editor opens on a phone', await phone.locator('[data-color-pms="0"]').isVisible());
t('and the page does not scroll sideways',
  await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  String(await phone.evaluate(() => document.documentElement.scrollWidth)));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
