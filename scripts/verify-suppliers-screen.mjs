// The supplier tab strip, in a real browser.
// Reported as "the button isn't clickable". Every pane is gated on
// `tab === '…'`, so a strip that resolves to no tab renders a header, three
// dead buttons and nothing under them — which is what a tab defined with
// `value:` instead of `id:` produces.
import { chromium } from 'playwright-core';

const APP = process.env.APP || 'http://localhost:4841';
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="name"], input[placeholder*="ame" i]', 'Sup Admin').catch(() => {});
await page.fill('input[type="password"]', 'SupSecret2026');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto(APP + '/?tab=suppliers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// The three tabs exist.
const tabs = await page.locator('[role="tab"]').allTextContents();
t('the three tabs render', tabs.length >= 3, JSON.stringify(tabs));

// One of them is actually selected. This is the whole bug: with no `id`,
// aria-selected is false on all of them and no pane is mounted.
const selected = await page.locator('[role="tab"][aria-selected="true"]').count();
t('exactly one tab reads as selected', selected === 1, `${selected} selected`);

// And the register pane is actually under the strip. Checking body length is
// vacuous — the shell alone is long enough to pass it — so look for the stat
// cards only the register renders.
const bodyText = await page.locator('body').innerText();
t('the register pane is mounted',
  /Awaiting a disposition/i.test(bodyText) && /No questionnaire document on file/i.test(bodyText),
  `${bodyText.length} chars`);

// Clicking Import must actually change the pane.
const importTab = page.locator('[role="tab"]', { hasText: /^Import$/ });
t('an Import tab is offered to an admin', await importTab.count() === 1);
if (await importTab.count()) {
  await importTab.click();
  await page.waitForTimeout(800);
  t('clicking Import selects it', await importTab.getAttribute('aria-selected') === 'true');
  t('the file input is on screen', await page.locator('input[type="file"]').count() === 1);
  // Scoped to the import card. An unscoped /Review/ matches the QA Review nav
  // entry and passes with the pane entirely absent — which it did, once.
  const card = page.locator('input[type="file"]').locator('xpath=ancestor::div[1]');
  const review = card.locator('button', { hasText: /Review/ });
  t('a Review button is rendered in the import pane', await review.count() === 1,
    `${await review.count()} found`);
  // Before a file is attached the Review button is DELIBERATELY disabled —
  // assert that, so a future change that leaves it live is caught.
  t('Review is disabled until a file is attached', await review.first().isDisabled());

  // Attach the real tracker and the button must come alive.
  await page.locator('input[type="file"]').setInputFiles([
    '/root/.claude/uploads/af00ada3-a0aa-542a-9170-4983495b696f/64517a7d-Current_Suppliers__Updated_8_6_2026.xlsx',
  ]);
  await page.waitForTimeout(500);
  t('attaching a file enables Review', !(await review.first().isDisabled()));

  // And the import actually runs from the screen, not just over HTTP.
  await review.first().click();
  await page.waitForFunction(
    () => /suppliers|Nothing is imported as qualified/i.test(document.body.innerText),
    null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await page.locator('body').innerText();
  t('Review returns a plan', /Nothing is imported as qualified/i.test(after), after.slice(-260));
  const commit = card.locator('button', { hasText: /Import \d+ suppliers/ });
  t('a commit button naming the count is offered', await commit.count() === 1);
  const label = await commit.first().innerText().catch(() => '');
  t('the count is a real number of suppliers', /Import ([6-9]\d|\d{3}) suppliers/.test(label), label);
}

t('no React key/console errors on the strip', !errors.some(e => /unique "key"|Each child/i.test(e)),
  errors.filter(e => /key/i.test(e))[0] || '');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
