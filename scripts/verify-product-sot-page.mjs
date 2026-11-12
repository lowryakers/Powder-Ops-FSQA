// verify:productsotpage — R-0645 PR B, live on a fresh database + a real browser.
//
// The product page as the source of truth, part B (pack tests 15–19):
//   15. the drawer shows the eight sections; a merch product hides Label and the
//       BOM reference; a section with no values is hidden (Pricing with no price,
//       Pack and shipping on merch with nothing recorded);
//   16. every checklist line is on the page once, in the section that owns it;
//   17. the Label section reads allergen_statement and the callouts from the
//       current APPROVED panel — a draft's values never show there;
//   18. brand, line, pack, channel and status filter (alone and combined); a
//       saved view reopens to the same filter and column set; a shared view is
//       read by the team and deleted only by its owner;
//   19. the Barcodes section has no suggest control and fills no inner/case code
//       when only the unit is present.
// Plus: prices are stripped for a reader who is not canManage; a token cannot
// save a view or upload a level barcode image.
//
// Caller sets PORT + DBPATH; needs a built client and the S3 stand-in for the
// image upload. The control is `main` before PR B: GET /products/views is the
// product route for a SKU called "views" and the first assertion fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import { matchesFilters, channelsOf, cleanFilters } from '../shared/product-filters.js';

const PORT = process.env.PORT || 5023;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const write = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

const PEOPLE = [
  ['pg-admin', 'Paige Admin', 'admin', 'admin', { products: 'edit' }],
  ['pg-qa', 'Quentin Page', 'supervisor', 'qa', { products: 'edit' }],
  ['pg-viewer', 'Vera Viewer', 'operator', 'warehouse', { products: 'view' }],
  ['pg-bot', 'Page Bot', 'operator', 'office', { products: 'edit' }],
];
write((db) => {
  for (const [id, name, role, dept, map] of PEOPLE) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(map));
  }
});
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Products2026!!', setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: 'Products2026!!' });
  return r.json;
};
const A = await signIn('pg-admin', 'Paige Admin');
const Q = await signIn('pg-qa', 'Quentin Page');
const V = await signIn('pg-viewer', 'Vera Viewer');
await signIn('pg-bot', 'Page Bot');
t('signed in (admin, QA supervisor, a view-only reader)', !!A?.token && !!Q?.token && !!V?.token);

// ── 18 (server): saved views ─────────────────────────────────────────────────
let r = await call('GET', '/products/views', null, Q.token);
t('GET /products/views answers with a list (not a product called "views")', r.status === 200 && Array.isArray(r.json?.views), `${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);

// A fixture set to filter: three products with brands, statuses and channels.
const mk = async (sku, body) => call('POST', '/products', { sku, category: 'Whey Protein', pack: 'STK', ...body }, A.token);
await mk('WHY-STK-PGA', { flavor: 'Page Alpha', base_flavor: 'Page Alpha', brand: 'ProDough' });
await mk('WHY-PLG-PGB', { flavor: 'Page Bravo', base_flavor: 'Page Bravo', pack: 'PLG', brand: 'Fixture Brand' });
await mk('WHY-STK-PGC', { flavor: 'Page Charlie', base_flavor: 'Page Charlie', brand: 'Fixture Brand' });
await call('PUT', '/products/WHY-STK-PGC', { amazon_channel: 'listed', status: 'ready' }, A.token);
write((db) => db.prepare("UPDATE products SET distributor_item_no = 'D-100' WHERE sku = 'WHY-PLG-PGB'").run());

r = await call('GET', '/products', null, Q.token);
const list = r.json?.products || [];
const pick = (f) => list.filter((p) => matchesFilters(p, f)).map((p) => p.sku).filter((s) => /-PG[ABC]$/.test(s)).sort();
t('brand filter', pick({ brand: 'Fixture Brand' }).join() === 'WHY-PLG-PGB,WHY-STK-PGC', pick({ brand: 'Fixture Brand' }).join());
t('line filter', pick({ category: 'Whey Protein', q: 'Page' }).length === 3);
t('pack filter', pick({ pack: 'PLG' }).join() === 'WHY-PLG-PGB');
t('channel filter: Amazon', pick({ channel: 'amazon' }).join() === 'WHY-STK-PGC');
t('channel filter: Distributor (an item number on file)', pick({ channel: 'distributor' }).join() === 'WHY-PLG-PGB');
t('channel filter: no channel yet', pick({ channel: 'none' }).join() === 'WHY-STK-PGA');
t('status filter: Ready', pick({ status: 'ready' }).join() === 'WHY-STK-PGC');
t('COMBINED: Fixture Brand + Stick + Amazon + Ready', pick({ brand: 'Fixture Brand', pack: 'STK', channel: 'amazon', status: 'ready' }).join() === 'WHY-STK-PGC');
t('combined filters that match nothing match nothing', pick({ brand: 'ProDough', channel: 'amazon' }).length === 0);
t('channelsOf reads a confirmation, never a guess', channelsOf({ readiness: { steps: [{ key: 'shopify', state: 'todo' }] } }).length === 0);
t('cleanFilters drops a key a view may not carry', !('evil' in cleanFilters({ evil: 1, brand: 'X' })) && cleanFilters({ brand: 'X' }).brand === 'X');

r = await call('POST', '/products/views', { name: 'Fixture amazon sticks', filters: { brand: 'Fixture Brand', channel: 'amazon', pack: 'STK', evil: 'x' }, columns: ['identity', 'channels'], shared: true }, Q.token);
const vid = r.json?.view?.id;
t('a view saves with its filters and column set', r.status === 201 && !!vid && r.json.view.filters.channel === 'amazon' && r.json.view.columns.join() === 'identity,channels', `${r.status} ${JSON.stringify(r.json)}`);
t('…and an unknown filter key was not stored', !('evil' in (r.json?.view?.filters || {})));
r = await call('POST', '/products/views', { name: 'fixture AMAZON sticks', filters: {} }, Q.token);
t('a second view with the same name (any case) is refused', r.status === 409);
r = await call('POST', '/products/views', { name: 'x', filters: {} }, Q.token);
t('a view needs a name', r.status === 400);
r = await call('GET', '/products/views', null, V.token);
t('a SHARED view is listed for the team', (r.json?.views || []).some((v) => v.id === vid && v.shared && !v.mine));
r = await call('DELETE', `/products/views/${vid}`, null, V.token);
t('…and only its owner can delete it', r.status === 403);

// ── Prices: canManage readers only ───────────────────────────────────────────
write((db) => db.prepare("UPDATE products SET price_fob_case = 120.24, price_srp = 3.99 WHERE sku = 'WHY-STK-PGA'").run());
const asQa = (await call('GET', '/products/WHY-STK-PGA', null, Q.token)).json;
const asViewer = (await call('GET', '/products/WHY-STK-PGA', null, V.token)).json;
t('a canManage reader gets the prices', asQa?.price_fob_case === 120.24 && asQa?.can_see_prices === true);
t('a reader who is not canManage gets no price field at all', asViewer && !('price_fob_case' in asViewer) && !('price_srp' in asViewer) && asViewer.prices_hidden === true);
const listV = (await call('GET', '/products', null, V.token)).json?.products || [];
t('…on the catalogue list too', listV.length > 0 && listV.every((p) => !('price_fob_case' in p)));

// ── 17 (server): the Label reads the APPROVED panel ──────────────────────────
const SKU = 'WHY-STK-PGA';
write((db) => {
  db.prepare(`INSERT INTO nfp_versions (id, sku, version, status, source, approved_by, approved_at, panel_json, front_callouts, updated_at)
    VALUES ('pg-nfp-1', ?, 'V1', 'approved', 'paper', 'Maria Servin', '2026-10-01', ?, ?, '2026-10-01')`)
    .run(SKU, JSON.stringify({ serving_household: '1 stick', serving_grams: 33, calories: 120, protein_g: 20, allergen_statement: 'Contains: Milk.' }),
      JSON.stringify({ protein_g: 20, calories: 120, added_sugar_g: null }));
  // A later DRAFT with different values — must never be what the Label shows.
  db.prepare(`INSERT INTO nfp_versions (id, sku, version, status, source, panel_json, front_callouts, updated_at)
    VALUES ('pg-nfp-2', ?, 'V2', 'draft', 'upload', ?, ?, '2026-11-01')`)
    .run(SKU, JSON.stringify({ calories: 999, protein_g: 99, allergen_statement: 'DRAFT ONLY' }), JSON.stringify({ protein_g: 99 }));
});
const pr = (await call('GET', `/products/${SKU}`, null, Q.token)).json;
t('the label is V1, the approved panel', pr?.label?.approved?.version === 'V1' && pr.label.approved.allergen_statement === 'Contains: Milk.');
t('…its callouts are three-state (claimed / not claimed / not answered)',
  pr?.label?.approved?.callouts.find((c) => c.key === 'protein_g')?.value === 20
  && pr.label.approved.callouts.find((c) => c.key === 'added_sugar_g')?.state === 'not_claimed'
  && pr.label.approved.callouts.find((c) => c.key === 'net_carbs_g')?.state === 'unanswered');
t('…and the open draft is named, not shown as the label', pr?.label?.pending?.version === 'V2' && !JSON.stringify(pr.label.approved).includes('DRAFT ONLY'));

// ── 19 (server): an inner/case image needs a pasted code; a token is refused ──
const fd = new FormData();
fd.append('files', new Blob([Buffer.from('PNG')], { type: 'image/png' }), 'case.png');
r = await fetch(`${URL}/api/products/${SKU}/barcode/case`, { method: 'POST', headers: { Authorization: `Bearer ${Q.token}` }, body: fd });
t('a case image is refused while no case GTIN is pasted', r.status === 400 && /no case GTIN/.test((await r.json()).error || ''));
t('…and nothing filled a case or inner code from the unit', !one('SELECT gtin_inner, gtin_case FROM products WHERE sku = ?', SKU)?.gtin_case);
const mint = (await call('POST', '/api-tokens', { user_id: 'pg-bot', label: 'fixture page bot', scopes: ['read', 'write'] }, A.token)).json?.plaintext;
r = await call('POST', '/products/views', { name: 'bot view', filters: {} }, mint);
t('a token cannot save a view (not on WRITE_AREAS)', r.status === 403, `${r.status}`);

// A merch variant with no pack facts, for the browser half.
write((db) => db.prepare(`INSERT INTO products (sku, flavor, base_flavor, category, pack, status, product_type, color_code, size_code)
  VALUES ('MCH-HBDC-BLK-M', 'Fixture Hoodie', 'Birthday Cake', 'Merch', 'BOX', 'draft', 'merch', 'BLK', 'M')`).run());

// ── The browser: 15, 16, 17, 18, 19 on screen ────────────────────────────────
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
const openDrawer = async (sku, kind = 'food') => {
  await page.goto(`${URL}/?tab=products${kind === 'all' ? '&type=all' : ''}`);
  await page.locator('[data-filter="brand"]').waitFor({ timeout: 20000 });
  await page.locator('input[placeholder^="Search SKU"]').fill(sku);
  await page.locator(`[data-grid-row="${sku}"] [data-open-row]`).click({ timeout: 20000 });
  await page.locator('[data-product-drawer] [data-section="channels"]').waitFor({ timeout: 15000 });
};
await openDrawer(SKU);
const D = page.locator('[data-product-drawer]');
const sections = await D.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
const eight = ['identity', 'barcodes', 'shipping', 'pricing', 'panel', 'packaging', 'formula', 'channels'];
t('15. a food product with a price shows the eight sections, in order',
  JSON.stringify(sections.filter((s) => eight.includes(s))) === JSON.stringify(eight), sections.join(','));
const titles = await D.locator('[data-section-toggle] span.font-semibold').allInnerTexts();
t('…titled Basics, Barcodes, Pack and shipping, Pricing, Label, Artwork, MRPEasy BOM reference, Channels',
  ['Basics', 'Barcodes', 'Pack and shipping', 'Pricing', 'Label', 'Artwork', 'MRPEasy BOM reference', 'Channels'].every((x) => titles.includes(x)), titles.join(' | '));

const steps = (await call('GET', `/products/${SKU}`, null, Q.token)).json.readiness.steps;
const counts = await Promise.all(steps.map((s) => D.locator(`[data-step-line="${s.key}"]`).count()));
t('16. every readiness line is on the page exactly once', counts.every((n) => n === 1), steps.map((s, i) => `${s.key}:${counts[i]}`).join(' '));
const owner = { gtin: 'barcodes', gtin_inner: 'barcodes', gtin_case: 'barcodes', nfp: 'panel', formula: 'formula', distributor: 'channels', sku: 'identity', artwork: 'packaging' };
const inOwner = await Promise.all(Object.entries(owner).filter(([k]) => steps.some((s) => s.key === k))
  .map(async ([k, sec]) => [k, await D.locator(`[data-section="${sec}"] [data-step-line="${k}"]`).count()]));
t('…each in the section that owns it', inOwner.every(([, n]) => n === 1), JSON.stringify(inOwner));

const label = D.locator('[data-section="panel"]');
if (await label.getAttribute('data-open') === '0') await label.locator('[data-section-toggle]').click();
if (process.env.SHOTS) await D.screenshot({ path: `${process.env.SHOTS}/sot-drawer.png` });
t('17. Label shows the approved allergen statement', /Contains: Milk\./.test(await label.locator('[data-label-allergens]').innerText()));
t('…and the approved callout (Protein 20)', /Protein \(g\): 20/.test(await label.locator('[data-label-callout="protein_g"]').innerText()));
t('…never the draft\'s values', !/DRAFT ONLY|: 99\b/.test(await label.locator('[data-label-facts]').innerText()));

const bc = D.locator('[data-section="barcodes"]');
if (await bc.getAttribute('data-open') === '0') await bc.locator('[data-section-toggle]').click();
t('19. Barcodes shows unit, inner and case', await bc.locator('[data-barcode-level]').count() === 3);
t('…with no suggest button anywhere in the section', !/suggest/i.test(await bc.innerText()) && await bc.locator('button:has-text("Suggest")').count() === 0);
t('…and inner/case read "none pasted" with only the unit present', await bc.locator('[data-gtin14-missing="inner"]').count() === 1 && await bc.locator('[data-gtin14-missing="case"]').count() === 1);
await D.locator('[data-drawer-edit]').click();
await page.waitForTimeout(300);
t('…the edit form\'s inner and case boxes start EMPTY', (await page.locator('[data-gtin-paste="inner"] input').inputValue()) === '' && (await page.locator('[data-gtin-paste="case"] input').inputValue()) === '');
await page.locator('[data-gtin-paste="case"] input').fill('10850046726821');
t('…a pasted code is checked as you type (check digit)', await page.locator('[data-gtin-paste-error="case"]').count() === 1);
await page.locator('[data-gtin-paste="case"] input').fill('');
await page.locator('button:has-text("Cancel")').last().click();

// A product with no price: Pricing is hidden.
await openDrawer('WHY-STK-PGC');
t('15. a section with no values is hidden (no price → no Pricing)', await D.locator('[data-section="pricing"]').count() === 0);
// Merch: no Label, no BOM reference, no empty Pack and shipping.
await openDrawer('MCH-HBDC-BLK-M', 'all');
const ms = await D.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
t('15. a merch product hides Label and the MRPEasy BOM reference', !ms.includes('panel') && !ms.includes('formula'), ms.join(','));
t('…and an empty Pack and shipping', !ms.includes('shipping'), ms.join(','));

// 18 on screen: filters and a saved view round trip.
await page.goto(`${URL}/?tab=products`);
await page.locator('[data-filter="brand"]').waitFor({ timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('[data-grid-row]').length > 0, null, { timeout: 15000 });
await page.locator('[data-filter="brand"]').selectOption('Fixture Brand');
await page.locator('[data-filter="channel"]').selectOption('amazon');
await page.locator('[data-filter="status"]').selectOption('ready');
await page.waitForTimeout(300);
const rows = await page.locator('[data-grid-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-grid-row')));
t('18. brand + channel + status on screen leave one row', rows.join() === 'WHY-STK-PGC', rows.join());
await page.locator('[data-group-toggle="formula"]').click();
await page.locator('[data-saved-view-new]').click();
await page.locator('[data-saved-view-name]').fill('Screen view');
await page.locator('[data-saved-view-save]').click();
await page.waitForTimeout(500);
await page.goto(`${URL}/?tab=products`);
await page.locator('[data-saved-view-select]').waitFor({ timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('[data-grid-row]').length > 1, null, { timeout: 15000 });
t('…after a reload the filters are back to all', (await page.locator('[data-grid-row]').count()) > 1);
const optVal = await page.locator('[data-saved-view-select] option', { hasText: 'Screen view' }).getAttribute('value');
await page.locator('[data-saved-view-select]').selectOption(optVal);
await page.waitForTimeout(400);
const rows2 = await page.locator('[data-grid-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-grid-row')));
t('…reopening the saved view restores the filters (one row again)', rows2.join() === 'WHY-STK-PGC', rows2.join());
t('…and the column set (the formula group folded)', await page.locator('[data-group-toggle="formula"]').getAttribute('data-group-open') === '0');
t('…the filter boxes say what is applied', await page.locator('[data-filter="channel"]').inputValue() === 'amazon');
await page.locator('[data-saved-view-delete]').click({ trial: true }).then(() => t('…its owner is offered Delete', true)).catch(() => t('…its owner is offered Delete', false));

// The phone: no sideways pan with the new filters.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
await phone.goto(`${URL}/?tab=products`);
await phone.locator('[data-filter="status"]').waitFor({ timeout: 15000 });
t('390px: the catalog toolbar does not pan the page', !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
