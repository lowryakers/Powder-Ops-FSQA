// verify:onboardingbank — the new hire is asked for their bank's name and their
// ZIP, whether or not the server stores bank numbers (D-177).
//
// Without ONBOARDING_ENC_KEY the direct-deposit step used to ask only for a
// voided-check photo, so there was no box for the bank's name — which is not a
// secret and the office keys into payroll. Run WITHOUT the key, on a phone.
// Caller sets PORT + DBPATH; needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5103;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH || process.env.DB_PATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('obb-admin','Bank Lead','Bank Lead','admin','office',1,'SC-OB',datetime('now','+7 day'))`).run();
const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
await post('/users/login', { name: 'Bank Lead' });
await post('/users/set-password', { user_id: 'obb-admin', password: 'Lead2026!', setup_code: 'SC-OB' });
const auth = await (await post('/users/login', { name: 'Bank Lead', password: 'Lead2026!' })).json();
const created = await (await post('/onboarding', { first_name: 'Rosa', last_name: 'Lima', position: 'Kitting', start_date: '2026-11-02' }, auth.token)).json();
const token = String(created.link).split('/').pop();
t('an onboarding exists with a link', !!token && !!created.id, JSON.stringify(created).slice(0, 120));
t('this server is NOT storing bank numbers (no key) — the case that hid the box', created.sensitive_collection === false || !process.env.ONBOARDING_ENC_KEY);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await m.goto(`${URL}/welcome/${token}`);
await m.waitForTimeout(2000);
await m.getByRole('button', { name: /Let[’']s go/ }).click();
await m.waitForTimeout(800);
const zip = m.locator('input[name="zip"]');
t('"About you" has a ZIP box', await zip.count() === 1 && /ZIP \*/.test(await m.locator('body').innerText()));
const box = await zip.boundingBox();
t('…fully on screen at 390px', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
await m.locator('input[name="phone"]').fill('8015550123');
await m.locator('input[type="date"]').first().fill('1990-04-12');
await m.locator('select[name="gender"]').selectOption('F');
await m.locator('input[name="address1"]').fill('12 Main St');
await m.locator('input[name="city"]').fill('Ogden');
await m.locator('select[name="state"]').selectOption('UT');
await zip.fill('84401');
await m.getByRole('button', { name: /Save & continue/ }).click();
await m.waitForTimeout(900);
// Emergency contact — straight on.
await m.getByRole('button', { name: /Save & continue/ }).click();
await m.waitForTimeout(900);
const bank = m.locator('[data-bank-name]');
t('THE DIRECT-DEPOSIT STEP HAS A BANK NAME BOX, with no encryption key set', await bank.count() === 1, (await m.locator('body').innerText()).slice(0, 300));
t('…and an account type', await m.locator('[data-account-type]').count() === 1);
t('…beside the voided-check photo it still asks for', /voided check/i.test(await m.locator('body').innerText()));
if (await bank.count()) {
  await bank.fill('Zions Bank');
  await m.locator('[data-account-type]').selectOption('checking');
  await m.getByRole('button', { name: /Save & continue/ }).click();
  await m.waitForTimeout(900);
}
const row = db.prepare('SELECT zip, dd_bank_name, dd_account_type FROM onboarding_records WHERE id = ?').get(created.id);
t('the ZIP is saved', row?.zip === '84401', JSON.stringify(row));
t('THE BANK NAME IS SAVED on the packet', row?.dd_bank_name === 'Zions Bank', JSON.stringify(row));
t('…and the account type', row?.dd_account_type === 'checking');
t('nothing sticks out sideways', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// The office sees it on the row.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=onboarding`);
await page.waitForTimeout(2500);
await page.getByText('Rosa Lima').first().click();
await page.waitForTimeout(800);
const body = await page.locator('body').innerText();
t('the office sees the ZIP in the address', /12 Main St, Ogden, UT 84401/.test(body), (body.match(/Address:[^\n]*/) || [''])[0]);
t('THE OFFICE SEES THE BANK on the packet row', /Zions Bank \(checking\) · from the voided check/.test(body), (body.match(/Direct deposit[^\n]*/) || [''])[0]);
await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
