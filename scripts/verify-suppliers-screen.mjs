// The Supplier Qualification SCREEN, in a real browser, WITH DATA IN IT.
//
// scripts/verify-suppliers.mjs drives the API over HTTP and passes completely
// while the screen fails to render at all — which is exactly what happened.
// This is the other half, and the ordering below is the point: the register is
// checked AFTER a real import, because an empty table renders none of the
// row markup and an empty-register check is vacuous. The first version of this
// file made that mistake and passed while `expand.isOpen is not a function`
// was crashing the register for anyone with suppliers in it.
//
// Usage: boot a server on a fresh DB with an admin seeded, then
//   APP=http://localhost:4841 node scripts/verify-suppliers-screen.mjs
import { chromium } from 'playwright-core';

const APP = process.env.APP || 'http://localhost:4841';
const TRACKER = process.env.TRACKER;   // the .xlsx to import
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="name"], input[placeholder*="ame" i]', 'Sup Admin').catch(() => {});
await page.fill('input[type="password"]', 'SupSecret2026');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
await page.goto(APP + '/?tab=suppliers', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

console.log('\n── the tab strip ──');
const tabs = await page.locator('[role="tab"]').allTextContents();
t('the three tabs render', tabs.length >= 3, JSON.stringify(tabs));
t('exactly one tab reads as selected', await page.locator('[role="tab"][aria-selected="true"]').count() === 1);
const body0 = await page.locator('body').innerText();
t('the register pane is mounted',
  /Awaiting a disposition/i.test(body0) && /No questionnaire document on file/i.test(body0));

console.log('\n── the importer ──');
const importTab = page.locator('[role="tab"]', { hasText: /^Import$/ });
t('an Import tab is offered to an admin', await importTab.count() === 1);
await importTab.click();
await page.waitForTimeout(800);
t('clicking Import selects it', await importTab.getAttribute('aria-selected') === 'true');
// Two inputs now: the tracker importer and the archive step below it.
t('both file inputs are on screen', await page.locator('input[type="file"]').count() === 2,
  `${await page.locator('input[type="file"]').count()}`);

// Scoped to the import card — an unscoped /Review/ matches the QA Review nav
// entry and passes with the pane entirely absent, which it did once.
const trackerInput = page.locator('input[type="file"]').first();
const card = trackerInput.locator('xpath=ancestor::div[1]');
const review = card.locator('button', { hasText: /Review/ });
t('a Review button is rendered in the import pane', await review.count() === 1);
t('Review is disabled until a file is attached', await review.first().isDisabled());

if (TRACKER) {
  await trackerInput.setInputFiles([TRACKER]);
  await page.waitForTimeout(400);
  t('attaching a file enables Review', !(await review.first().isDisabled()));

  await review.first().click();
  await page.waitForTimeout(6000);
  t('Review returns a plan', /Nothing is imported as qualified/i.test(await page.locator('body').innerText()));
  const commit = card.locator('button', { hasText: /Import \d+ suppliers/ });
  t('a commit button naming the count is offered', await commit.count() === 1);
  t('the count is a real number of suppliers',
    /Import ([6-9]\d|\d{3}) suppliers/.test(await commit.first().innerText().catch(() => '')));

  await commit.first().click();
  await page.waitForTimeout(8000);
  t('the import reports it committed', /Imported/i.test(await page.locator('body').innerText()));

  // ── and NOW the register, with rows in it ──────────────────────────────
  console.log('\n── the register, with real suppliers in it ──');
  await page.locator('[role="tab"]', { hasText: /^Register$/ }).click();
  await page.waitForTimeout(2500);
  const rows = page.locator('table tbody tr');
  const n = await rows.count();
  t('the register renders supplier rows', n > 20, `${n} rows`);
  t('the register did not crash', !/This screen didn.t load/i.test(await page.locator('body').innerText()));

  // Expanding a row is the code path that was throwing.
  await rows.first().click();
  await page.waitForTimeout(1500);
  t('clicking a row expands it', await page.locator('tr[aria-expanded="true"]').count() === 1);
  t('the detail panel has content', (await page.locator('body').innerText()).length > 1500);
  t('expanding did not throw', !errors.some(e => /is not a function/i.test(e)),
    errors.find(e => /is not a function/i.test(e)) || '');

  // Sorting a column — the header wiring that was passing the wrong props.
  const header = page.locator('th button', { hasText: /^Supplier$/ });
  if (await header.count()) {
    await header.first().click();
    await page.waitForTimeout(800);
    t('a column header sorts', await page.locator('th[aria-sort="descending"], th[aria-sort="ascending"]').count() >= 1);
  }

  console.log('\n── the archive step ──');
  await importTab.click();
  await page.waitForTimeout(1200);
  const arch = await page.locator('body').innerText();
  t('the archive step explains itself', /Attach the documents/i.test(arch));
  t('it reports how much of the catalogue has a document behind it',
    /catalogued\s+documents are stored/i.test(arch), arch.slice(-200));
  const zipInput = page.locator('input[type="file"][accept=".zip"]');
  t('a .zip input is offered', await zipInput.count() === 1);
  const zipCard = zipInput.locator('xpath=ancestor::div[1]');
  const zipReview = zipCard.locator('button', { hasText: /Review the zip/ });
  t('its Review is disabled until a zip is attached', await zipReview.first().isDisabled());
}

console.log('');
t('no render errors anywhere in the run', !errors.some(e => /is not a function|render failed|Cannot read/i.test(e)),
  errors.find(e => /is not a function|render failed|Cannot read/i.test(e))?.slice(0, 160) || '');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
