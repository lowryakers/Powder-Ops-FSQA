// FORM 602-01 V2 in a real browser: the form is five taps for a pass, the
// first test asks for the specification in words, and the QA lead's approval
// strip appears on the log. Caller sets PORT + DBPATH; needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4933;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('su-lead','Sensory Lead','Sensory Lead','supervisor','qa',1,'SC-SU',datetime('now','+7 day'))`).run();
  db.prepare(`UPDATE users SET module_access = '{"organoleptic":"edit","flavor-approvals":"edit"}' WHERE id = 'su-lead'`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Sensory Lead' });
await post('/users/set-password', { user_id: 'su-lead', password: 'Lead2026!', setup_code: 'SC-SU' });
const auth = await (await post('/users/login', { name: 'Sensory Lead', password: 'Lead2026!' })).json();
t('signed in', !!auth?.token);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=organoleptic`);
await page.waitForTimeout(3500);
await page.getByRole('button', { name: /^New Organoleptic/ }).first().click();
await page.waitForTimeout(600);
const form = page.locator('form').last();
t('the form opens with the sensory block', await form.locator('[data-sensory-block]').count() === 1);
t('with five attribute rows: appearance, odor, taste, color, texture', await form.locator('[data-sensory-row]').count() === 5
  && (await form.locator('[data-sensory-row]').evaluateAll(els => els.map(e => e.dataset.sensoryRow).join(','))) === 'appearance,odor,taste,color,texture');
t('and nothing that says 1–5', !/1–5|1-5/.test(await form.innerText()));
await form.locator('label:text-is("Product") + input').fill('Plant Vanilla Cream');
await page.waitForTimeout(900);
t('a product with no spec asks for one in words', /No specification on file/.test(await form.innerText()) && await form.locator('[data-spec-draft]').count() === 5);
for (const [k, text] of [['appearance', 'Off-white, free-flowing'], ['odor', 'Vanilla, no off notes'], ['taste', 'Vanilla cream, mildly sweet'], ['color', 'Off-white'], ['texture', 'Fine powder']]) {
  await form.locator(`[data-spec-draft="${k}"]`).fill(text);
  await form.locator(`[data-sensory-pass="${k}"]`).click();
}
t('five taps say Matches', await form.locator('[data-sensory-pass][aria-pressed="true"]').count() === 5);
await form.locator('[data-sensory-fail="taste"]').click();
t('a Doesn\'t match opens the result cell', await form.locator('[data-sensory-note="taste"]').isVisible());
await form.locator('[data-sensory-note="taste"]').fill('thin, artificial');
await form.locator('[data-sensory-pass="taste"]').click();
await form.getByRole('button', { name: /^(Save|Create|File)/i }).last().click();
await page.waitForTimeout(1500);
const text = await page.locator('body').innerText();
t('the record is in the log with a Pass', /Plant Vanilla Cream/.test(text) && /Pass/.test(text));
t('THE DRAFT SPEC IS OFFERED TO THE QA LEAD ON THE LOG', await page.locator('[data-spec-strip]').count() === 1 && await page.locator('[data-approve-spec="Plant Vanilla Cream"]').count() === 1);
await page.locator('[data-approve-spec="Plant Vanilla Cream"]').click();
await page.waitForTimeout(1200);
t('approving clears the strip', await page.locator('[data-spec-strip]').count() === 0);
await page.locator('text=Plant Vanilla Cream >> visible=true').first().click();
await page.waitForTimeout(700);
t('the record view shows the result beside the words it was checked against', await page.locator('[data-sensory-results="v2"]').count() === 1 && /DRAFT at the time of this test/.test(await page.locator('[data-sensory-results="v2"]').innerText()));
await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
