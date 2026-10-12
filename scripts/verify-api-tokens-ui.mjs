// Settings → Bot API tokens in a real browser (D-164): the Write box and its
// words, the fixed "never allowed" note, minting a write token from the screen
// sending ["read","write"], and a migrated write-drafts row reading "write".
// D-165: the Write box is a real, full-size, unticked checkbox that a click on
// it OR on its words toggles (it had been squeezed to a 3px dot), and Edit
// scopes on a live token ticks Write without re-minting.
// At 1280 and 390, no sideways scroll. Caller sets PORT + DBPATH; needs a built
// client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5092;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  for (const [id, name, role, dept, code, ma] of [
    ['ui-admin', 'Token Office', 'admin', 'office', 'SC-TA', null],
    ['ui-bot', 'Catalog Bot', 'supervisor', 'office', 'SC-TB', { products: 'edit' }],
  ]) db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, ma ? JSON.stringify(ma) : null);
  // A token stored under the old name the way pack 1 wrote it, as if it had
  // been minted before the boot migration ran: the reader must still say write.
  db.prepare(`INSERT OR REPLACE INTO api_tokens (id, user_id, label, token_prefix, token_hash, scopes, created_by)
    VALUES ('ui-legacy', 'ui-bot', 'Old drafts bot', 'rdk_OLDD', ?, '["read","write-drafts"]', 'Token Office')`).run('1'.repeat(64));
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Token Office' });
await post('/users/set-password', { user_id: 'ui-admin', password: 'Tokens2026!!', setup_code: 'SC-TA' });
const auth = await (await post('/users/login', { name: 'Token Office', password: 'Tokens2026!!' })).json();
t('signed in as an admin', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/?tab=settings&section=api-tokens`);
  await page.waitForSelector('[data-api-tokens]', { timeout: 20000 });
  const box = page.locator('[data-api-token-write]');
  t(`${width}: the Write box is there and the old Drafts box is gone`, await box.count() === 1 && await page.locator('[data-api-token-drafts]').count() === 0);
  const label = await box.locator('xpath=..').innerText();
  t(`${width}: the Write box says what it covers and that it is never more than the account`, /product records, artwork and files, supply orders, AP Drop uploads, partner reconciliation documents, draft nutrition panels, messages/.test(label) && /Never more than the account itself can do/.test(label), label.slice(0, 120));
  const never = await page.locator('[data-api-token-never]').innerText();
  t(`${width}: the fixed note names everything a token can never do`, /approving, signing, verifying, releasing or settling/.test(never) && /deleting or voiding/.test(never) && /users, roles or permissions/.test(never) && /managing tokens/.test(never), never);
  const legacy = await page.locator('[data-api-token-row="ui-legacy"]').innerText();
  t(`${width}: a token stored as write-drafts reads "write" in the list`, /Scopes: read, write/.test(legacy) && !/write-drafts/.test(legacy), legacy.replace(/\s+/g, ' ').slice(0, 160));
  const shape = await box.evaluate(el => ({ type: el.type, checked: el.checked, disabled: el.disabled, cls: el.className, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  t(`${width}: Write is a real checkbox, unticked and enabled by default`, shape.type === 'checkbox' && !shape.checked && !shape.disabled, JSON.stringify(shape));
  t(`${width}: …sized and never squeezed (shrink-0, w-4, at least 14px wide)`, /\bshrink-0\b/.test(shape.cls) && /\bw-4\b/.test(shape.cls) && shape.w >= 14 && shape.h >= 14, `${shape.w}×${shape.h} ${shape.cls}`);
  await box.click();
  t(`${width}: clicking the box ticks it`, await box.isChecked());
  await page.locator('label[for="api-token-scope-write"] span').click();
  t(`${width}: clicking its words unticks it again`, !(await box.isChecked()));
  t(`${width}: the box points at the never-allowed note`, (await box.getAttribute('aria-describedby')) === 'api-token-never');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t(`${width}: no sideways scroll`, overflow <= 1, `${overflow}px`);
  if (width === 1280) {
    let sent = null;
    page.on('request', r => { if (r.url().endsWith('/api/api-tokens') && r.method() === 'POST') sent = JSON.parse(r.postData() || '{}'); });
    await page.selectOption('[data-api-token-user]', 'ui-bot');
    await page.fill('[data-api-token-label]', 'Catalog bot — write');
    await box.check();
    await page.click('[data-api-token-create]');
    await page.waitForSelector('[data-api-token-issued]', { timeout: 10000 });
    t('minting from the screen sends scopes ["read","write"]', JSON.stringify(sent?.scopes) === '["read","write"]', JSON.stringify(sent));
    const rows = await page.locator('[data-api-token-row]').allInnerTexts();
    t('…and the new token is listed with read, write', rows.some(r => /Catalog bot — write/.test(r) && /Scopes: read, write/.test(r)));
    // Edit scopes on the read-only legacy-free token: mint a read token, then tick Write on its row.
    await page.click('[data-api-token-issued] button:has-text("I have stored it")');
    await page.selectOption('[data-api-token-user]', 'ui-bot');
    await page.fill('[data-api-token-label]', 'Catalog bot — read');
    await page.click('[data-api-token-create]');
    await page.waitForSelector('[data-api-token-issued]', { timeout: 10000 });
    await page.click('[data-api-token-issued] button:has-text("I have stored it")');
    const row = page.locator('[data-api-token-row]').filter({ hasText: 'Catalog bot — read' });
    t('the read token reads "Scopes: read"', /Scopes: read(?!,)/.test(await row.innerText()));
    await row.locator('[data-api-token-edit-scopes]').click();
    const editBox = row.locator('[data-api-token-edit-write]');
    const eshape = await editBox.evaluate(el => ({ cls: el.className, w: el.getBoundingClientRect().width, checked: el.checked }));
    t('Edit scopes opens a full-size, unticked Write box', !eshape.checked && /\bshrink-0\b/.test(eshape.cls) && eshape.w >= 14, JSON.stringify(eshape));
    let edited = null;
    page.on('request', r => { if (/\/api\/api-tokens\/[^/]+\/scopes$/.test(r.url())) edited = JSON.parse(r.postData() || '{}'); });
    await editBox.check();
    await row.locator('[data-api-token-save-scopes]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-api-token-row]')].some(r => /Catalog bot — read/.test(r.innerText) && /Scopes: read, write/.test(r.innerText)), null, { timeout: 10000 }).catch(() => {});
    t('Save sends scopes ["read","write"]', JSON.stringify(edited?.scopes) === '["read","write"]', JSON.stringify(edited));
    t('…and the row now reads "Scopes: read, write", same prefix, no new token shown', /Scopes: read, write/.test(await row.innerText()) && await page.locator('[data-api-token-issued]').count() === 0);
  }
  await page.close();
}
await browser.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
