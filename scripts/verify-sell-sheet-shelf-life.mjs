// verify:sellsheetshelflife — D-384, live on a fresh database (+ a browser at 1280).
//
// The sell-sheet shelf life is READ FROM THE STABILITY JUSTIFICATION:
//   - a SKU with a justification reads its months; nothing typed is used;
//   - a SKU with none reads "No stability basis" and nothing can be entered;
//   - the only manual entry is an override SHORTER than the basis, with a reason,
//     logged with who and why; removing it needs a reason too;
//   - a value typed before the rule is left exactly as filed, and a typed value
//     LONGER than its justification is flagged on Completeness.
//
// Caller sets PORT + DBPATH. The control is `main` before this change: a typed
// 30 is accepted and the first refusal assertion fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5244;
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const write = (fn) => { const d = new Database(DBP); d.pragma('busy_timeout = 10000'); try { return fn(d); } finally { d.close(); } };

const PEOPLE = [
  ['ss-qa', 'Quinn Shelf', 'supervisor', 'qa', { products: 'edit' }],
  ['ss-op', 'Olly Floor', 'operator', 'warehouse', { products: 'view' }],
];
write((db) => {
  for (const [id, name, role, dept, ma] of PEOPLE) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
  }
});
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'ShelfLife2026!!', setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: 'ShelfLife2026!!' });
  return { token: r.json?.token, user: r.json?.user };
};
const Q = await signIn('ss-qa', 'Quinn Shelf');
const O = await signIn('ss-op', 'Olly Floor');
t('signed in (a catalog manager and an operator)', !!Q.token && !!O.token);

const SKUS = all("SELECT sku FROM products WHERE status = 'active' AND COALESCE(product_type,'food') != 'merch' ORDER BY sku LIMIT 2").map((r) => r.sku);
const [A, B] = SKUS;
t('two active food SKUs to work on', SKUS.length === 2, JSON.stringify(SKUS));

// A carries a justification of 18 months and a value TYPED before the rule (24).
write((db) => {
  db.prepare(`INSERT INTO stability_justifications (id, product_family, product_skus, shelf_life_months, basis, basis_kind, decided_by, decided_on)
    VALUES ('ss-just', 'Fixture family', ?, 18, 'Client stability data on file.', 'client_data', 'Fixture', date('now'))`).run(JSON.stringify([A]));
  db.prepare('UPDATE products SET shelf_life_months_commercial = 24 WHERE sku = ?').run(A);
  db.prepare('UPDATE products SET shelf_life_months_commercial = 12 WHERE sku = ?').run(B);
});
const get = async (sku) => (await call('GET', `/products/${sku}`, null, Q.token)).json;

console.log('\n── read from the justification ──');
let p = await get(A);
t('A reads 18 months, from the stability justification', p?.shelf_life_months_commercial === 18 && p?.sell_sheet_shelf_life?.source === 'stability' && p.sell_sheet_shelf_life.basis_months === 18, JSON.stringify(p?.sell_sheet_shelf_life));
t('…the 24 typed before the rule is reported as longer, not used', p?.sell_sheet_shelf_life?.typed_months === 24 && p.sell_sheet_shelf_life.typed_longer === true);
t('…and left exactly as filed in the row', one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', A).v === 24);
p = await get(B);
t('B has no justification: no figure, "no stability basis"', p?.shelf_life_months_commercial === null && p?.sell_sheet_shelf_life?.no_basis === true && p.sell_sheet_shelf_life.source === null, JSON.stringify(p?.sell_sheet_shelf_life));
t('…its typed 12 is kept, not used, and not flagged (nothing to be longer than)', p?.sell_sheet_shelf_life?.typed_months === 12 && p.sell_sheet_shelf_life.typed_longer === false
  && one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', B).v === 12);

console.log('\n── nothing typed on the product ──');
let r = await call('PUT', `/products/${A}`, { shelf_life_months_commercial: 30 }, Q.token);
t('typing a different figure on A is refused (400 SHELF_LIFE_FROM_STABILITY), naming the basis', r.status === 400 && r.json?.code === 'SHELF_LIFE_FROM_STABILITY' && /\(18 months\)/.test(r.json?.error || ''), JSON.stringify(r.json));
r = await call('PUT', `/products/${A}`, { shelf_life_months_commercial: 18, unit_size: '1.2 OZ' }, Q.token);
t('a form sending back the figure it was shown saves its other fields', r.status === 200 && r.json?.unit_size === '1.2 OZ', `${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
t('…and writes nothing to the typed column', one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', A).v === 24);
r = await call('PUT', `/products/${B}`, { shelf_life_months_commercial: 12 }, Q.token);
t('on B (no basis) any figure is refused with "No stability basis"', r.status === 400 && r.json?.code === 'SHELF_LIFE_FROM_STABILITY' && /No stability basis/.test(r.json?.error || ''), JSON.stringify(r.json));
r = await call('POST', '/products/bulk-edit', { skus: [A], field: 'shelf_life_months_commercial', value: 30 }, Q.token);
t('fill-down cannot write it either', r.status >= 400 && one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', A).v === 24, `${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
r = await call('PUT', `/products/${A}`, { shelf_life_override_months: 6 }, Q.token);
t('the override columns cannot be written through the product save', r.status === 400 && r.json?.code === 'SHELF_LIFE_OVERRIDE_ROUTE');

console.log('\n── a shorter override, with who and why ──');
const OV = (sku) => `/products/${sku}/shelf-life-override`;
r = await call('POST', OV(B), { months: 6, reason: 'Customer wants a short date' }, Q.token);
t('no basis ⇒ no override (409 NO_STABILITY_BASIS)', r.status === 409 && r.json?.code === 'NO_STABILITY_BASIS');
r = await call('POST', OV(A), { months: 18, reason: 'Same as the basis' }, Q.token);
t('an override equal to the basis is refused (400 OVERRIDE_NOT_SHORTER)', r.status === 400 && r.json?.code === 'OVERRIDE_NOT_SHORTER');
r = await call('POST', OV(A), { months: 20, reason: 'Longer than the basis' }, Q.token);
t('…and one longer than the basis', r.status === 400 && r.json?.code === 'OVERRIDE_NOT_SHORTER');
r = await call('POST', OV(A), { months: 12 }, Q.token);
t('a shorter one with no reason is refused', r.status === 400 && r.json?.code === 'REASON_REQUIRED');
r = await call('POST', OV(A), { months: 12, reason: 'Retailer asks for 12 months on the sell sheet' }, O.token);
t('an operator cannot set one (403)', r.status === 403);
r = await call('POST', OV(A), { months: 12, reason: 'Retailer asks for 12 months on the sell sheet' }, Q.token);
t('a catalog manager sets 12 months with a reason', r.status === 200 && r.json?.shelf_life_months_commercial === 12 && r.json?.sell_sheet_shelf_life?.source === 'override', JSON.stringify(r.json?.sell_sheet_shelf_life));
const row = one('SELECT shelf_life_override_months m, shelf_life_override_reason why, shelf_life_override_by who, shelf_life_override_at at FROM products WHERE sku = ?', A);
t('…stored with who and why', row.m === 12 && /Retailer/.test(row.why) && row.who === 'Quinn Shelf' && !!row.at, JSON.stringify(row));
const aud = one("SELECT details, actor FROM audit_log WHERE action LIKE 'shelf_life_override_set%' AND entity_id = ? ORDER BY rowid DESC", A);
t('…and logged: who, why, the basis it was shorter than', !!aud && /Retailer/.test(aud.details) && /"basis_months":18/.test(aud.details) && aud.actor === 'Quinn Shelf', JSON.stringify(aud));

console.log('\n── Completeness flags, never changes ──');
const comp = (await call('GET', '/products/completeness', null, Q.token)).json;
const ra = comp?.rows?.find((x) => x.sku === A);
t('A is flagged: typed 24, basis 18', ra?.shelf_life_longer?.typed_months === 24 && ra.shelf_life_longer.basis_months === 18, JSON.stringify(ra?.shelf_life_longer));
t('B (no basis) is not flagged as longer', !comp?.rows?.find((x) => x.sku === B)?.shelf_life_longer);
t('the count is the rows flagged', comp?.counts?.sell_sheet_longer === comp.rows.filter((x) => x.shelf_life_longer).length && comp.counts.sell_sheet_longer >= 1);
t('reading it changed nothing', one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', A).v === 24);

console.log('\n── the product page ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
const openDrawer = async (sku) => {
  await page.goto(`${URL}/?tab=products`);
  await page.locator('[data-filter="brand"]').waitFor({ timeout: 20000 });
  await page.locator('input[placeholder^="Search SKU"]').fill(sku);
  await page.locator(`[data-grid-row="${sku}"] [data-open-row]`).click({ timeout: 20000 });
  await page.locator('[data-product-drawer] [data-section="channels"]').waitFor({ timeout: 15000 });
  const sh = page.locator('[data-product-drawer] [data-section="shipping"]');
  if (await sh.getAttribute('data-open') === '0') await sh.locator('[data-section-toggle]').click();
  return sh;
};
let sh = await openDrawer(B);
t('B\'s drawer says "No stability basis" and offers no override', await sh.locator('[data-no-stability-basis]').count() === 1 && await sh.locator('[data-override-open]').count() === 0);
sh = await openDrawer(A);
const ssA = sh.locator('[data-sell-sheet-shelf-life]');
t('A\'s drawer shows the override: 12 months, why, who', await ssA.getAttribute('data-source') === 'override' && /12 months/.test(await ssA.innerText()) && /Retailer/.test(await ssA.innerText()) && /Quinn Shelf/.test(await ssA.innerText()));
t('…and says the typed 24 is no longer used', await ssA.locator('[data-typed-longer]').count() === 1);
await page.locator('[data-product-drawer] [data-drawer-edit]').click();
t('the edit form has no box for the shelf life', await page.locator('[data-product-drawer] [data-field="shelf_life_months_commercial"]').count() === 0
  && await page.locator('[data-product-drawer] [data-field="pallet_qty"]').count() === 1);
await browser.close();

console.log('\n── removing the override ──');
r = await call('POST', OV(A), { months: null }, Q.token);
t('removing needs a reason', r.status === 400 && r.json?.code === 'REASON_REQUIRED');
r = await call('POST', OV(A), { months: null, reason: 'Retailer accepted the full shelf life' }, Q.token);
t('removed with a reason: back to the basis, 18', r.status === 200 && r.json?.shelf_life_months_commercial === 18 && r.json?.sell_sheet_shelf_life?.source === 'stability');
t('…and logged', !!one("SELECT 1 FROM audit_log WHERE action LIKE 'shelf_life_override_removed%' AND entity_id = ?", A));
t('the typed 24 is still exactly as filed at the end', one('SELECT shelf_life_months_commercial v FROM products WHERE sku = ?', A).v === 24);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
