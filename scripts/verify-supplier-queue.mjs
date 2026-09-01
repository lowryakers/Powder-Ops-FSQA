// Working the disposition queue, in a real browser.
//
// The point of this check is as much what it REFUSES as what it does: there is
// no way to approve a supplier without answering all seven criteria, and no
// batch approve at all. A queue that made 44 compliance decisions in one click
// would be the worst thing this module could ship.
import { chromium } from 'playwright-core';
const APP = process.env.APP || 'http://localhost:4870';
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
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

await page.locator('[role="tab"]', { hasText: /Needs attention/ }).click();
await page.waitForTimeout(2000);
const body = await page.locator('body').innerText();
t('the pile is split, not one number',
  /can be decided now/.test(body) && /no questionnaire to decide against/.test(body), body.slice(0, 200));

const work = page.locator('button', { hasText: /Work through the \d+ with evidence/ });
t('a queue button is offered', await work.count() === 1);
await work.click();
await page.waitForTimeout(2500);

const modal = page.locator('div', { hasText: /Disposition —/ }).last();
t('the queue opens on the first supplier', /Disposition —/.test(await page.locator('body').innerText()));
const m = await page.locator('body').innerText();
// Case-insensitive: the heading is CSS-uppercased, so innerText returns caps.
t('THE EVIDENCE IS IN THE SAME WINDOW', /what is on file/i.test(m));
t('...and it says whether a questionnaire is among it',
  /completed questionnaire|no completed questionnaire/.test(m));
t('all seven criteria are asked', /of 7 criteria unanswered/.test(m), m.match(/\d+ of 7[^\n]*/)?.[0] || '');

// The refusals.
const next = page.locator('button', { hasText: /Record & next/ });
t('Record & next is offered with the queue length', await next.count() === 1,
  await next.first().innerText().catch(() => ''));
t('IT IS DISABLED BEFORE THE CRITERIA ARE ANSWERED', await next.first().isDisabled());

// Answer all seven "yes" and pick approved — only then does it enable.
const yes = page.locator('button', { hasText: /^YES$/i });
const n = await yes.count();
for (let i = 0; i < n; i++) await yes.nth(i).click();
await page.waitForTimeout(300);
t('answering the criteria alone is still not enough', await next.first().isDisabled());
await page.locator('input[name="disposition"]').first().check();
await page.waitForTimeout(300);
t('a disposition plus all seven enables it', !(await next.first().isDisabled()));

const before = await page.locator('body').innerText();
const firstName = before.match(/Disposition — ([^\n]+)/)?.[1];
await next.first().click();
await page.waitForTimeout(2500);
const after = await page.locator('body').innerText();
const secondName = after.match(/Disposition — ([^\n]+)/)?.[1];
t('recording advances to the NEXT supplier', !!secondName && secondName !== firstName,
  `${firstName} → ${secondName}`);
t('the next supplier starts UNANSWERED', /of 7 criteria unanswered/.test(after));
t('the queue count went down',
  Number(after.match(/Record & next \((\d+) left\)/)?.[1]) < Number(before.match(/Record & next \((\d+) left\)/)?.[1]),
  `${before.match(/\((\d+) left\)/)?.[1]} → ${after.match(/\((\d+) left\)/)?.[1]}`);
t('there is NO batch-approve control anywhere', !/approve all|approve the \d+|bulk approve/i.test(after));
t('no render errors', !errors.some(e => /is not a function|render failed|Cannot read/i.test(e)),
  errors.find(e => /is not a function|render failed|Cannot read/i.test(e))?.slice(0, 140) || '');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
