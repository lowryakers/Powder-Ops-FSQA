// The swab shelf on the Sanitation screen, in a real browser.
// Caller sets PORT + DBPATH. Needs a database the API script has already run
// against, or at least a booted server with the seeded opening counts.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 4896;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const PW = 'SwabUi2026';
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sw-ui','Swab Ui','Swab Ui','admin','qa',1,'SC-UI', datetime('now','+7 day'))`).run();
  db.close();
}
const api = (p, body) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
await api('/users/login', { name: 'Swab Ui' });
await api('/users/set-password', { user_id: 'sw-ui', password: PW, setup_code: 'SC-UI' });
const auth = await (await api('/users/login', { name: 'Swab Ui', password: PW })).json();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('auth_user', JSON.stringify(u));
}, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=sanitation`);
await page.waitForTimeout(3500);

const card = page.locator('div').filter({ hasText: /^ATP swabs/ }).last();
t('the ATP shelf is on the Sanitation screen', await card.count() > 0);
const text = await page.locator('body').innerText();
t('it names both swab types', /ATP swabs/.test(text) && /Allergen swabs/.test(text));
t('it shows a number on hand', /on hand/i.test(text));
t('and the arithmetic behind it', /counted/i.test(text) && /used since/i.test(text));
t('and the reorder point', /Order more at \d+/.test(text), text.match(/Order more at[^\n]*/)?.[0]);

// Count.
await page.getByRole('button', { name: /^Count$/ }).first().click();
await page.waitForTimeout(300);
const qty = page.locator('input[type="number"]').first();
t('the count form asks for what is on the shelf', await qty.count() > 0);
await qty.fill('7');
await page.waitForTimeout(250);
const varianceShown = /than the log expects/.test(await page.locator('body').innerText());
t('THE VARIANCE IS SHOWN BEFORE THE COUNT IS FILED', varianceShown);
await page.getByRole('button', { name: /File the count/ }).click();
await page.waitForTimeout(1200);
const after = await page.locator('body').innerText();
t('the shelf shows the counted figure without a reload', /\b7\b/.test(after) && /7 counted/.test(after),
  after.match(/[^\n]*counted[^\n]*/)?.[0]);
t('and 7 is at or below the reorder point, so it says an order was raised',
  /a supply order has been raised/i.test(after));

// Received, in boxes.
await page.getByRole('button', { name: /^Received$/ }).first().click();
await page.waitForTimeout(300);
t('the delivery form counts BOXES, and says how many swabs that is',
  /100 swabs/.test(await page.locator('body').innerText()));
await page.getByRole('button', { name: /Add to the shelf/ }).click();
await page.waitForTimeout(1200);
const stocked = await page.locator('body').innerText();
t('a box put 107 on the shelf', /107/.test(stocked), stocked.match(/[^\n]*on hand[^\n]*/)?.[0]);
t('and the low warning has gone', !/ATP[\s\S]{0,400}a supply order has been raised/i.test(stocked));

// 360px: the two cards must stack, and nothing may pan the page.
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(600);
const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
t('no horizontal overflow at 360px', over <= 0, `${over}px`);

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
