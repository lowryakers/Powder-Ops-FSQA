// verify:productstage — D-134, live on a fresh database.
//
// The new-product flow as a DERIVED stage on every product, the Pipeline, and
// the New Product Creation reference tab. Each heading is the ask's own
// acceptance criterion.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main`
// before this change: no product carries a stage, and the first assertion fails.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5050;
const URL = process.env.APP || `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('ps-adm','Stella Stage','Stella Stage','admin','qa',1,'SC-ps',datetime('now','+7 day'))`).run();
let tok = null;
const call = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const get = async (p) => J(await call('GET', p));
await call('POST', '/users/login', { name: 'Stella Stage' });
await call('POST', '/users/set-password', { user_id: 'ps-adm', password: 'StellaStage2026!!', setup_code: 'SC-ps' });
tok = (await J(await call('POST', '/users/login', { name: 'Stella Stage', password: 'StellaStage2026!!' })))?.token;
t('signed in', !!tok);

const product = async (sku) => get(`/products/${encodeURIComponent(sku)}`);
const list = async () => (await get('/products'))?.products || [];

console.log('\n── (1)(2) every product reports a derived stage and names its first unmet gate in words ──');
let all = await list();
t('every product carries a stage, an integer 0–9', all.length > 100 && all.every(p => Number.isInteger(p.stage?.stage) && p.stage.stage >= 0 && p.stage.stage <= 9), `${all.filter(p => !Number.isInteger(p.stage?.stage)).length} without`);
t('every product below 9 names its next gate by label and reason, not by number', all.filter(p => p.stage?.stage < 9).every(p => p.stage.next?.label && p.stage.next.why && /next: [a-z]/.test(p.stage.summary)), all.find(p => !p.stage?.next)?.sku);
t('nine gates on every product, each with a state and a sentence', all.every(p => p.stage?.gates?.length === 9 && p.stage.gates.every(g => ['done', 'next', 'todo', 'held'].includes(g.state) && g.why)));
t('the stage is never stored: no stage column on products', db.prepare('PRAGMA table_info(products)').all().every(c => !/^stage/.test(c.name)));

console.log('\n── the three incidents, as the gates see them ──');
const numeric = db.prepare("SELECT sku FROM products WHERE sku GLOB '[0-9]*' ORDER BY sku").all().map(r => r.sku);
t('the four numeric SKUs are on the seeded catalog', numeric.length === 4, JSON.stringify(numeric));
let r = await call('PUT', `/products/${numeric[0]}`, { mrp_formula_id: 'F-00321', formula_rev: 'v1.0', fill_weight_g: 454 });
t('(7) filling the formula and fill weight on a stage-0 product is accepted — no gate refuses an edit', r.status === 200, `${r.status}`);
let p = await product(numeric[0]);
t('the numeric SKU stops at stage 2, its next gate the SKU, named as another system\'s number', p?.stage?.stage === 2 && p.stage.next.key === 'sku' && /number from another system/.test(p.stage.next.why), p?.stage?.summary);
db.prepare("UPDATE products SET mrp_formula_id = 'Yes', formula_rev = NULL WHERE sku = 'DR-20'").run();
p = await product('DR-20');
t('"Yes" in formula ref reads stage 0, and the reason quotes it', p?.stage?.stage === 0 && p.stage.next.key === 'formula' && /"Yes" is not a formula reference/.test(p.stage.next.why), p?.stage?.summary);
p = await product('DR-SP');
t('DR-SP, carrying almost nothing, reads stage 0 — Not started', p?.stage?.stage === 0 && p.stage.label === 'Not started');

console.log('\n── a product walked through all nine gates ──');
// A LEGACY code (the old PP-/PSP- shape, not the new standard), so the SKU gate's legacy rule is what carries it.
const W = db.prepare("SELECT sku FROM products WHERE status = 'active' AND spec_id = 'SPEC-STICK-LG' AND gtin_valid = 1 AND sku NOT GLOB '[0-9]*' ORDER BY sku").all()
  .map(r => r.sku).find(k => !/^[A-Z]{3}-[A-Z]{3}(?:-[A-Z0-9]{1,4})?$/.test(k));
t('a legacy-coded stick with a valid GTIN to walk', !!W, W);
p = await product(W);
t('before anything, it is stage 0', p?.stage?.stage === 0, p?.stage?.summary);
r = await call('PUT', `/products/${W}`, { mrp_formula_id: 'F-00123', formula_rev: 'v2.0', fill_weight_g: 34.86 });
p = await product(W);
t('formula and fill weight set: the legacy SKU and valid GTIN carry it to stage 4, next the panel', r.status === 200 && p?.stage?.stage === 4 && p.stage.next.key === 'panel', p?.stage?.summary);
t('…the SKU gate says the legacy code is accepted and why', /legacy code already on film/.test(p?.stage?.gates?.[2]?.why || ''));
const PANEL = {
  serving_size_desc: '1 stick', serving_size_g: 34.86, servings_per_container: 1, calories: 130,
  total_fat_g: 1.5, total_fat_dv: 2, saturated_fat_g: 1, saturated_fat_dv: 5, trans_fat_g: 0,
  cholesterol_mg: 45, cholesterol_dv: 15, sodium_mg: 115, sodium_dv: 5,
  total_carbohydrate_g: 5, total_carbohydrate_dv: 2, dietary_fiber_g: 0, dietary_fiber_dv: 0,
  total_sugars_g: 2, added_sugars_g: 1, added_sugars_dv: 2, protein_g: 24,
  vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 130, calcium_dv: 10, iron_mg: 0.3, iron_dv: 0,
  potassium_mg: 160, potassium_dv: 4,
  ingredients: 'Whey protein isolate, natural flavors, guar gum, MCT oil', allergen_statement: 'Contains milk.',
  net_weight_g: 34.86, net_weight_oz: 1.23,
};
const v = await J(await call('POST', '/nfp', { sku: W, version: 'V3', drive_url: 'https://drive.example/panel', provenance: { formula_ref: 'F-00123', formula_version: 'v2.0', bom_fill_weight_g: 34.86, source_system: 'Genesis R&D' } }));
await call('PUT', `/nfp/${v.id}/panel`, { panel: PANEL, front_callouts: { protein_g: 24, calories: 130, added_sugar_g: null } });
r = await call('POST', `/nfp/${v.id}/decide`, { decision: 'approved' });
p = await product(W);
t('an approved panel from F-00123 v2.0 at 34.86 g: stage 5', r.ok && p?.stage?.stage === 5 && p.stage.next.key === 'shopify', `${r.status} ${p?.stage?.summary}`);
r = await call('POST', `/products/${W}/confirm/shopify`, {});
p = await product(W);
t('Shopify confirmed under the same SKU: stage 6', r.ok && p?.stage?.stage === 6, p?.stage?.summary);
r = await call('POST', `/products/${W}/confirm/shiphero`, {});
p = await product(W);
t('ShipHero confirmed: stage 7, next the artwork', r.ok && p?.stage?.stage === 7 && p.stage.next.key === 'artwork', p?.stage?.summary);
db.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status, source, nfp_version) VALUES ('ps-art1', ?, 'primary', 1, 'print_ready', 'upload', 'V2')`).run(W);
p = await product(W);
t('artwork released against an OLDER panel does not count — named', p?.stage?.stage === 7 && /drawn against panel V2; the approved panel is V3/.test(p.stage.next.why), p?.stage?.summary);
db.prepare("UPDATE artwork_versions SET nfp_version = 'V3' WHERE id = 'ps-art1'").run();
p = await product(W);
t('artwork released against the approved panel: stage 8, next the PO', p?.stage?.stage === 8 && p.stage.next.key === 'po', p?.stage?.summary);
r = await call('POST', `/products/${W}/packaging-po`, { po_number: 'PO-7781', vendor: 'Film Co', placed_on: '2026-09-30' });
let body = await J(r);
p = await product(W);
t('a packaging PO recorded against the current artwork: stage 9, nothing next', r.status === 201 && body?.against_artwork && p?.stage?.stage === 9 && p.stage.next === null && p.stage.needs_work === false, JSON.stringify(body)?.slice(0, 160));
t('…and the drawer payload lists the PO against artwork V1', p?.packaging_pos?.[0]?.po_number === 'PO-7781' && p.packaging_pos[0].artwork_version === 1);

console.log('\n── (3) the formula moves past the panel: back to stage 4, artwork amber ──');
r = await call('PUT', `/products/${W}`, { formula_rev: 'v2.1' });
p = await product(W);
t('formula v2.1 over a panel from v2.0: the product drops from 9 to 4 by itself', r.status === 200 && p?.stage?.stage === 4, p?.stage?.summary);
t('…naming both versions', /generated against formula v2\.0 and the formula is now v2\.1/.test(p?.stage?.next?.why || ''), p?.stage?.next?.why);
t('…and the artwork step goes AMBER — met, held — as do the steps after the panel', p?.stage?.gates?.find(g => g.key === 'artwork')?.state === 'held' && p.stage.held.includes('artwork'), JSON.stringify(p?.stage?.held));
r = await call('PUT', `/products/${W}`, { formula_rev: 'v2.0' });
p = await product(W);
t('putting the formula back puts the stage back — derived both ways', p?.stage?.stage === 9);
r = await call('PUT', `/products/${W}`, { fill_weight_g: 33.32 });
p = await product(W);
t('the 33.32 vs 34.86 case: a fill weight 4% off the panel\'s BOM drops it to stage 4, naming both weights', p?.stage?.stage === 4 && /34\.86 g; the catalog's fill is 33\.32 g/.test(p.stage.next.why), p?.stage?.next?.why);
await call('PUT', `/products/${W}`, { fill_weight_g: 34.86 });

console.log('\n── the flow is a loop: new artwork leaves the old PO behind ──');
db.prepare("UPDATE artwork_versions SET status = 'superseded' WHERE id = 'ps-art1'").run();
db.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status, source, nfp_version) VALUES ('ps-art2', ?, 'primary', 2, 'print_ready', 'upload', 'V3')`).run(W);
p = await product(W);
t('artwork V2 released: the PO placed against V1 no longer counts — back to stage 8', p?.stage?.stage === 8 && /artwork V2/.test(p.stage.next.why), p?.stage?.summary);
await call('POST', `/products/${W}/packaging-po`, { po_number: 'PO-7790' });
p = await product(W);
t('a PO against V2 brings it back to 9', p?.stage?.stage === 9);

console.log('\n── (4) blocked, with a reason and an owner ──');
const bottle = db.prepare("SELECT sku FROM products WHERE status = 'active' AND sku NOT GLOB '[0-9]*' AND sku != ? AND sku NOT LIKE 'DR-%' ORDER BY sku DESC LIMIT 1").get(W).sku;
r = await call('POST', `/products/${bottle}/completeness-block`, { reason: 'formula not final', owner: 'Danny' });
p = await product(bottle);
t('a blocked product carries the reason and the owner, and does not need work', r.ok && p?.stage?.blocked?.reason === 'formula not final' && p.stage.blocked.owner === 'Danny' && p.stage.needs_work === false, JSON.stringify(p?.stage?.blocked));
all = await list();
t('…and is still in the catalog', all.some(x => x.sku === bottle));
const needsWork = all.filter(x => x.stage.needs_work).length;
t('needs-work excludes blocked products and products at 9', needsWork === all.filter(x => !x.stage.blocked && x.stage.stage < 9).length && !all.find(x => x.sku === bottle).stage.needs_work);

console.log('\n── (7) no gate refuses an edit ──');
r = await call('POST', '/products/DR-SP/confirm/shopify', {});
t('confirming Shopify on a stage-0 product is accepted', r.ok, `${r.status}`);
r = await call('POST', '/products/DR-SP/packaging-po', { po_number: 'PO-EARLY' });
body = await J(r);
t('recording a PO with no released artwork is accepted, and says it counts against nothing', r.status === 201 && body?.against_artwork === false && body?.stage?.stage === 0, JSON.stringify(body)?.slice(0, 160));

console.log('\n── (5)(6) in a browser ──');
all = await list();
const perStage = (n) => all.filter(x => !x.stage.blocked && x.stage.stage === n).length;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'ps-adm', name: 'Stella Stage', role: 'admin' })); }, [tok]);
  await page.goto(`${URL}/?tab=products&view=pipeline`);
  await page.waitForSelector('[data-pipeline-stage="9"]', { timeout: 20000 }).catch(() => {});
  t('the Pipeline draws no columns until the catalog has loaded', await page.locator('[data-pipeline-stage="0"]').getAttribute('data-count') === String(perStage(0)), await page.locator('[data-pipeline-stage="0"]').getAttribute('data-count'));
  const cols = await page.locator('[data-pipeline-stage]').evaluateAll(els => els.map(e => [Number(e.getAttribute('data-pipeline-stage')), Number(e.getAttribute('data-count'))]));
  t('(5) the Pipeline has a column for every stage, 0 through 9', cols.map(c => c[0]).join() === '0,1,2,3,4,5,6,7,8,9', JSON.stringify(cols));
  t('…each counting exactly the unblocked products the API puts there', cols.every(([n, c]) => c === perStage(n)), JSON.stringify(cols.map(([n, c]) => `${n}:${c}/${perStage(n)}`)));
  t('the needs-work count is the API\'s', Number(await page.locator('[data-pipeline-needs-work]').getAttribute('data-pipeline-needs-work')) === all.filter(x => x.stage.needs_work).length);
  t('the blocked product is listed apart, with its reason and owner', /formula not final — Danny/.test(await page.locator(`[data-pipeline-blocked-product="${bottle}"]`).innerText().catch(() => '')));
  await page.locator('[data-pipeline-owner]').selectOption('Formulator');
  await page.waitForTimeout(200);
  const formulator = all.filter(x => !x.stage.blocked && x.stage.next?.owner === 'Formulator').length;
  t('filtering by owner shows only what waits on the Formulator', await page.locator('[data-pipeline-product]').count() === formulator, `${await page.locator('[data-pipeline-product]').count()} vs ${formulator}`);
  await page.locator('[data-pipeline-owner]').selectOption('');
  // Put the walked product back at stage 4 (the Apple Pie case) and open it from the Pipeline.
  await call('PUT', `/products/${W}`, { formula_rev: 'v2.1' });
  await page.goto(`${URL}/?tab=products&view=pipeline`);
  await page.waitForSelector(`[data-pipeline-product="${W}"]`, { timeout: 20000 }).catch(() => {});
  t('the walked product sits in the stage-4 column', await page.locator(`[data-pipeline-stage="4"] [data-pipeline-product="${W}"]`).count() === 1);
  await page.locator(`[data-pipeline-product="${W}"]`).click();
  await page.waitForSelector('[data-gate-focus]', { timeout: 8000 }).catch(() => {});
  t('clicking it opens the product AT its first unmet gate — the panel', await page.locator('[data-product-drawer] [data-gate-focus="panel"]').count() === 1);
  t('the drawer names stage 4 and the next gate', await page.locator('[data-stage-panel][data-stage="4"] [data-stage-next="panel"]').count() === 1);
  t('…and the artwork step reads held (amber)', await page.locator('[data-stage-gate="artwork"][data-gate-state="held"]').count() === 1);
  await page.keyboard.press('Escape');
  await page.goto(`${URL}/?tab=products`);
  await page.waitForSelector(`[data-grid-row="${W}"] [data-grid-stage]`, { timeout: 20000 }).catch(() => {});
  t('(e) the grid shows the stage and the next gate where the gap count was', await page.locator(`[data-grid-row="${W}"] [data-grid-stage="4"]`).count() === 1 && await page.locator(`[data-grid-row="${W}"] [data-grid-next="panel"]`).count() === 1);
  t('…and no raw gap count', await page.locator('[data-comp-gaps]').count() === 0);

  await page.goto(`${URL}/?tab=products&view=new-product`);
  await page.waitForSelector('[data-new-product-flow]', { timeout: 20000 }).catch(() => {});
  t('(6) the New Product Creation tab lists the nine stages with owner and consequence', await page.locator('[data-flow-stage]').count() === 9);
  t('…and the three real incidents', await page.locator('[data-flow-incident]').count() === 3);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  t('…in one screen: no more than one scroll at 1280×900', h <= 900 * 2, `${h}px`);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${URL}/manifest.webmanifest`);
  await phone.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'ps-adm', name: 'Stella Stage', role: 'admin' })); }, [tok]);
  await phone.goto(`${URL}/?tab=products&view=pipeline`);
  await phone.waitForSelector('[data-pipeline]', { timeout: 20000 }).catch(() => {});
  t('at 390px the pipeline scrolls inside itself, not the page', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await phone.goto(`${URL}/?tab=products&view=new-product`);
  await phone.waitForSelector('[data-new-product-flow]', { timeout: 20000 }).catch(() => {});
  t('…and so does the reference table', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
