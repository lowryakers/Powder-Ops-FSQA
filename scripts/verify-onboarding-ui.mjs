// The new-hire wizard in a real browser at phone width: the SSN field is
// required, the pay-method choice, the W-4 signed by typing the legal name,
// the I-9 signed with a photo attached, and Finish refused until then. Then
// the office side: the packet shows both signatures and Section 2 opens.
// Caller sets PORT + DBPATH + ONBOARDING_ENC_KEY + the R2 stand-in; needs a
// built client.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const PORT = process.env.PORT || 4902;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('obui-admin','Office Lead','Office Lead','admin','office',1,'SC-OU',datetime('now','+7 day'))`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
await post('/users/login', { name: 'Office Lead' });
await post('/users/set-password', { user_id: 'obui-admin', password: 'Lead2026!', setup_code: 'SC-OU' });
const auth = await (await post('/users/login', { name: 'Office Lead', password: 'Lead2026!' })).json();
t('signed in', !!auth?.token);
const created = await (await post('/onboarding', { first_name: 'Maria', last_name: 'Ortega', position: 'Kitting', start_date: '2026-09-21' }, auth.token)).json();
const token = String(created.link).split('/').pop();
t('an onboarding exists with a link', !!token);

const photo = join(tmpdir(), 'ui-id.png');
writeFileSync(photo, Buffer.from('89504e470d0a1a0a', 'hex'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });

console.log('\n── the new hire, on a phone ──');
await m.goto(`${URL}/welcome/${token}`);
await m.waitForTimeout(2500);
t('the welcome page names them', /Welcome to Powder Ops, Maria/.test(await m.locator('body').innerText()));
await m.getByRole('button', { name: /Let's go/ }).click();
await m.waitForTimeout(800);
t('the SSN field is on the page and marked required', await m.locator('[data-ssn]').count() === 1 && /Social Security number \*/.test(await m.locator('body').innerText()));
t('nothing sticks out sideways at 390px', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const fill = async (labelText, value) => {
  await m.locator(`span:text-is("${labelText}") + input, span:text-is("${labelText}") + select`).first().fill(value);
};
await fill('Phone *', '8015550100');
await fill('Date of birth *', '1998-03-09');
await m.locator('[data-ssn]').fill('321-54-9876');
await fill('Home address *', '12 Center St');
await fill('City *', 'Provo'); await fill('State *', 'UT'); await fill('ZIP *', '84601');
await m.getByRole('button', { name: /Save & continue/ }).click();
await m.waitForTimeout(1200);
t('saved and moved to the emergency contact', /Emergency contact/.test(await m.locator('body').innerText()), (await m.locator('body').innerText()).slice(0, 200));
await m.getByRole('button', { name: /Save & continue/ }).click();
await m.waitForTimeout(1000);
t('the pay step offers direct deposit or a check', await m.getByRole('button', { name: /Direct deposit/ }).count() === 1 && await m.getByRole('button', { name: /Paper check/ }).count() === 1);
await m.getByRole('button', { name: /Direct deposit/ }).click();
await m.waitForTimeout(300);
await fill('Bank name', 'Zions');
await m.locator('input[placeholder="9 digits"]').fill('124000054');
await m.locator('span:text-is("Account number *") + input').fill('44556677');
await m.locator('span:text-is("Account type *") + select').selectOption('checking');
t('the voided-check photo control opens the camera', await m.locator('[data-photos="voided_check"] input[type=file]').getAttribute('capture') === 'environment');
await m.getByRole('button', { name: /Save & continue/ }).click();
await m.waitForTimeout(1200);
t('on to the W-4', /Form W-4/.test(await m.locator('body').innerText()));
await m.locator('span:text-is("Step 1(c) Filing status *") + select').selectOption('single');
await m.locator('[data-signature="w4"] input[type=text], [data-signature="w4"] input:not([type=checkbox])').first().fill('Maria Ortega');
await m.getByRole('button', { name: /Sign & continue/ }).click();
await m.waitForTimeout(1000);
t('signing without ticking the attestation is refused, in words', /tick the box/.test(await m.locator('body').innerText()));
await m.locator('[data-signature="w4"] input[type=checkbox]').check();
await m.getByRole('button', { name: /Sign & continue/ }).click();
await m.waitForTimeout(1200);
t('the W-4 is signed and the I-9 opens', /Form I-9/.test(await m.locator('body').innerText()));
t('there is no Finish button before the I-9 is signed', await m.locator('[data-finish]').count() === 0 && await m.locator('[data-sign-i9]').count() === 1);
await m.getByRole('radio').first().check();
await m.locator('[data-photos="id_document"] input[type=file]').setInputFiles(photo);
await m.waitForTimeout(1800);
t('the ID photo appears', /ui-id\.png/.test(await m.locator('[data-photos="id_document"]').innerText()));
await m.locator('[data-signature="i9"] input:not([type=checkbox])').first().fill('Maria Ortega');
await m.locator('[data-signature="i9"] input[type=checkbox]').check();
await m.locator('[data-sign-i9]').click();
await m.waitForTimeout(1200);
t('the I-9 is signed and Finish appears', await m.locator('[data-signed="i9"]').count() === 1 && await m.locator('[data-finish]').count() === 1);
await m.locator('[data-finish]').click();
await m.waitForTimeout(1500);
t("finished — 'You're all set'", /all set, Maria/.test(await m.locator('body').innerText()));

console.log('\n── the office ──');
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=onboarding`);
await page.waitForTimeout(3000);
const row = page.locator(`[data-onboarding="${created.id}"]`);
t('the packet row reads Ready for review', /Ready for review/.test(await row.innerText()));
await row.locator('button').first().click();
await page.waitForTimeout(600);
t('the W-4 card shows the signature', /Step 5: signed Maria Ortega/.test(await row.locator('[data-w4]').innerText()));
t('the I-9 card shows the signature', /Signature: signed Maria Ortega/.test(await row.locator('[data-i9]').innerText()));
t('the ID photo is on the packet', /ui-id\.png/.test(await row.locator('[data-onboarding-files]').innerText()));
t('Section 2 is open for the employer', await row.locator('[data-section2]').count() === 1);
t('the SSN shows only as last four', /••••9876/.test(await row.innerText()) && !/321-54-9876|321549876/.test(await row.innerText()));
await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
