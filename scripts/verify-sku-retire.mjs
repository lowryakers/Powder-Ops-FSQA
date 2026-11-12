// verify:skuretire — D-324, live on a fresh database (+ a browser at 1280).
//
// A SKU that will not go live: "Won't launch" hides it with a reason (the
// catalog, the proofer feed and Completeness drop it; Bring it back restores
// the status it had), and Delete removes only a SKU that has never been
// anywhere, refusing by name one with a GTIN, artwork or a panel. The grid
// copies a SKU and a GTIN without opening the drawer.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main`
// before this change: the not-launching route does not exist.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5206;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  for (const [id, name, role, dept] of [['sr-admin', 'Ada Retire', 'admin', 'office'], ['sr-qa', 'Quinn Retire', 'supervisor', 'qa']]) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ products: 'edit' }));
  }
  db.close();
}
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Retire2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Retire2026!!' })).json;
};
const adminLogin = await signIn('sr-admin', 'Ada Retire');
const A = adminLogin?.token;
const Q = (await signIn('sr-qa', 'Quinn Retire'))?.token;
t('signed in (admin and a QA supervisor)', !!A && !!Q);

// A draft that has never been anywhere, and a real catalog row with a GTIN.
const DRAFT = 'WHY-PLG-ZQX';
let r = await call('POST', '/products', { sku: DRAFT, flavor: 'Test Draft Flavor', base_flavor: 'Test Draft Flavor', category: 'Whey Protein', pack: 'PLG', status: 'concept' }, A);
t('a concept SKU is filed', r.status === 201, `${r.status} ${r.json?.error}`);
const live = q("SELECT sku, gtin, status FROM products WHERE gtin IS NOT NULL AND gtin != '' AND status = 'active' ORDER BY sku LIMIT 1")[0];

console.log("\n── Won't launch ──");
r = await call('PUT', `/products/${DRAFT}`, { status: 'not_launching' }, Q);
t("typing Won't launch into the status is refused", r.status === 400 && r.json?.code === 'NOT_LAUNCHING_OWNED', `${r.status}`);
r = await call('POST', `/products/${DRAFT}/not-launching`, { reason: '' }, Q);
t('it needs a reason', r.status === 400);
r = await call('POST', `/products/${DRAFT}/not-launching`, { reason: 'Flavor dropped after tasting' }, Q);
t("QA marks it Won't launch, with the reason and who", r.status === 200 && r.json?.status === 'not_launching' && r.json?.not_launching_reason === 'Flavor dropped after tasting' && r.json?.not_launching_by === 'Quinn Retire', JSON.stringify(r.json?.status));
r = await call('PUT', `/products/${DRAFT}`, { status: 'active' }, Q);
t('an ordinary edit cannot move it back', r.status === 400 && r.json?.code === 'NOT_LAUNCHING_OWNED');
r = await call('PUT', `/products/${DRAFT}`, { notes: 'still a note' }, Q);
t('…but other fields still edit', r.status === 200);
const comp = (await call('GET', '/products/completeness', null, A)).json;
const compRows = JSON.stringify(comp || {});
t('it leaves Completeness', !compRows.includes(DRAFT));
r = await call('GET', '/products', null, A);
t('the catalog still returns it (the screen hides it)', (r.json?.products || []).some((p) => p.sku === DRAFT));
r = await call('POST', `/products/${DRAFT}/not-launching`, { undo: true }, Q);
t('Bring it back restores the status it had (ready)', r.status === 200 && r.json?.status === 'ready' && !r.json?.not_launching_reason);
r = await call('POST', `/products/${DRAFT}/not-launching`, { reason: 'Dropped for good' }, Q);
t('hidden again', r.json?.status === 'not_launching');
const audits = q("SELECT action FROM audit_log WHERE entity_type = 'product' AND entity_id = ? ORDER BY rowid", DRAFT).map((a) => a.action);
t('each act is audited', audits.includes('not_launching') && audits.includes('not_launching_undone'), audits.join(','));

console.log('\n── Delete ──');
r = await call('DELETE', `/products/${DRAFT}`, { reason: 'Never launched' }, Q);
t('a QA supervisor cannot delete', r.status === 403);
r = await call('DELETE', `/products/${live.sku}`, { reason: 'test' }, A);
t(`a live SKU with a GTIN (${live.sku}) is refused by name`, r.status === 409 && r.json?.refusals?.some((x) => x.includes('Active')) && r.json.refusals.some((x) => x.includes(live.gtin)), JSON.stringify(r.json?.refusals));
t('…and is still there', q('SELECT 1 FROM products WHERE sku = ?', live.sku).length === 1);
r = await call('GET', `/products/${DRAFT}/delete-check`, null, A);
t('the delete check says the draft can go', r.status === 200 && r.json?.refusals?.length === 0 && r.json?.can_delete === true, JSON.stringify(r.json));
r = await call('DELETE', `/products/${DRAFT}`, {}, A);
t('delete needs a reason', r.status === 400);
r = await call('DELETE', `/products/${DRAFT}`, { reason: 'Never launched, no GTIN' }, A);
t('an admin deletes a SKU that was never anywhere', r.status === 200 && !q('SELECT 1 FROM products WHERE sku = ?', DRAFT).length);
const del = q("SELECT previous_state, details FROM audit_log WHERE entity_type = 'product' AND entity_id = ? AND action = 'delete'", DRAFT)[0];
t('the audit entry keeps the whole row and the reason', del && JSON.parse(del.previous_state).flavor === 'Test Draft Flavor' && del.details.includes('Never launched'));

console.log('\n── the screen ──');
const SHOWN = 'WHY-PLG-ZQY';
await call('POST', '/products', { sku: SHOWN, flavor: 'Shown Then Hidden', base_flavor: 'Shown Then Hidden', category: 'Whey Protein', pack: 'PLG', status: 'concept' }, A);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, adminLogin.user]);
  await page.goto(`${URL}/?tab=products`);
  await page.waitForSelector(`[data-grid-row="${live.sku}"]`, { timeout: 30000 });
  await page.locator(`[data-grid-row="${live.sku}"] [data-copy="SKU"]`).click();
  t('the SKU copies from the grid', await page.evaluate(() => navigator.clipboard.readText()) === live.sku);
  t('…without opening the drawer', await page.locator('[data-product-drawer]').count() === 0);
  await page.locator(`[data-grid-row="${live.sku}"] [data-copy="GTIN"]`).click();
  t('the GTIN copies from the grid', await page.evaluate(() => navigator.clipboard.readText()) === live.gtin);
  t('…without starting an edit', await page.locator('[data-editing]').count() === 0);

  await page.locator(`[data-grid-row="${SHOWN}"] [data-open-row]`).click();
  await page.locator('[data-not-launching-open]').click();
  await page.locator('[data-launch-reason]').fill('Client cancelled the line');
  await page.locator('[data-not-launching-save]').click();
  await page.waitForSelector('[data-not-launching]', { timeout: 10000 }).catch(() => {});
  t("Won't launch from the drawer shows the reason", await page.locator('[data-not-launching]').filter({ hasText: 'Client cancelled the line' }).count() === 1);
  await page.locator('[data-product-drawer] button[aria-label="Close"]').click();
  await page.waitForTimeout(500);
  t('…and the row leaves the catalog', await page.locator(`[data-grid-row="${SHOWN}"]`).count() === 0);
  await page.locator('[data-show-hidden]').click();
  t('"Show 1 won\'t launch" brings it into view', await page.locator(`[data-grid-row="${SHOWN}"]`).count() === 1);
  await page.locator(`[data-grid-row="${SHOWN}"] [data-open-row]`).click();
  await page.locator('[data-delete-open]').click();
  await page.waitForSelector('[data-launch-reason]');
  await page.locator('[data-launch-reason]').fill('Never launched');
  await page.locator('[data-delete-save]').click();
  await page.waitForTimeout(1000);
  t('Delete from the drawer removes it', !q('SELECT 1 FROM products WHERE sku = ?', SHOWN).length && await page.locator('[data-product-drawer]').count() === 0);
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
