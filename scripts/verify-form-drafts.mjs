// Executed, not asserted: a click beside a form no longer throws it away, and
// what was typed is kept as a draft (D-299). In a real browser on Flavor
// Approvals: type into a new card, click the dim area — still open; reload —
// the card offers the typing back; Cancel asks first and then forgets it. The
// rule itself on bare elements: a backdrop with a field holds, one without
// closes. Needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5176;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('fd-adm','Ada Admin','Ada Admin','admin','qa',1,'SEED-CODE',datetime('now','+7 day'),NULL)`).run();
  db.close();
}
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'fd-adm', password: 'AdaSecret2026', setup_code: 'SEED-CODE' }) });
const tok = (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Ada Admin', password: 'AdaSecret2026' }) })))?.token;
t('signed in', !!tok);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'fd-adm', name: 'Ada Admin', role: 'admin', department: 'qa' }]);

console.log('\n── the rule ──');
await page.goto(`${URL}/?tab=flavor-approvals`);
await page.waitForTimeout(1500);
const rule = await page.evaluate(() => {
  const make = (withField) => {
    const bd = document.createElement('div');
    bd.className = 'fixed inset-0 bg-black/30 z-50';
    const card = document.createElement('div'); card.style.cssText = 'width:200px;height:100px;background:#fff';
    if (withField) card.appendChild(document.createElement('textarea'));
    bd.appendChild(card); document.body.appendChild(bd);
    let closed = false; bd.addEventListener('click', () => { closed = true; });
    bd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    bd.remove(); return closed;
  };
  return { withField: make(true), withoutField: make(false) };
});
t('a backdrop around a form field does not take the click', rule.withField === false);
t('a backdrop around something only to read still closes', rule.withoutField === true);

console.log('\n── the flavor approval card ──');
const openNew = async () => { await page.locator('button:has-text("New ")').filter({ hasText: /New .*[Ff]lavor/ }).first().click(); await page.waitForSelector('form textarea, form input', { timeout: 5000 }); };
await openNew();
const field = page.locator('form input[type="text"], form input:not([type])').nth(2);
await field.fill('Adam typed a lot of detail here');
await page.mouse.click(8, 8);
await page.waitForTimeout(300);
t('clicking the dim area beside the card leaves it open', await page.locator('form').filter({ hasText: /Save/ }).count() > 0);
t('…with what was typed still in it', await field.inputValue() === 'Adam typed a lot of detail here');
await page.waitForTimeout(300);
await page.reload();
await page.waitForTimeout(1500);
await openNew();
t('reopening after a reload offers the draft back', await page.locator('[data-draft-restored]').count() === 1);
t('…with the typing in place', await page.locator('form input[type="text"], form input:not([type])').nth(2).inputValue() === 'Adam typed a lot of detail here');
let asked = '';
page.once('dialog', async (d) => { asked = d.message(); await d.accept(); });
await page.locator('[data-record-close]').click();
await page.waitForTimeout(300);
t('closing with something typed asks first', /Close without saving/.test(asked), asked);
await openNew();
t('after discarding, the card starts empty', await page.locator('[data-draft-restored]').count() === 0
  && await page.locator('form input[type="text"], form input:not([type])').nth(2).inputValue() === '');
asked = '';
page.once('dialog', async (d) => { asked = d.message(); await d.accept(); });
await page.locator('[data-record-close]').click();
await page.waitForTimeout(200);
t('closing an untouched card asks nothing', asked === '', asked);
await browser.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
