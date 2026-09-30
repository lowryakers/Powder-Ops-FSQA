// verify:productgrid — D-131, live on a fresh database.
//
// The Products grid, validation at the field, three-state fields, the derived
// packaging block, the artwork line derived rather than typed, and the CSV
// import's diff. Each numbered heading is the ask's own acceptance criterion.
//
// Caller sets PORT + DBPATH, and PRODUCT_MASTER_TOKEN on the server.
import Database from 'better-sqlite3';
import { MASTER_CSV_SOURCES } from '../shared/product-fields.js';

const PORT = process.env.PORT || 5048;
const URL = process.env.APP || `http://localhost:${PORT}`;
const B = `${URL}/api`;
const PT = process.env.PROOF_TOKEN || 'grid-token';
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('pg-adm','Gwen Grid','Gwen Grid','admin','qa',1,'SC-pg',datetime('now','+7 day'))`).run();
let tok = null;
const call = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => call(p, { method: 'PUT', body: JSON.stringify(b) });
await post('/users/login', { name: 'Gwen Grid' });
await post('/users/set-password', { user_id: 'pg-adm', password: 'GwenGrid2026!!', setup_code: 'SC-pg' });
tok = (await J(await post('/users/login', { name: 'Gwen Grid', password: 'GwenGrid2026!!' })))?.token;
t('signed in', !!tok);

const row = (sku) => db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
// Three roll-fed rows with NO eye mark recorded, so the empty-vs-NA distinction has something to bite on.
const sticks = db.prepare("SELECT sku FROM products WHERE pack IN ('STK','PLG','PSM') AND gtin_valid = 1 AND eyemark_color IS NULL AND spec_id IS NOT NULL ORDER BY pack DESC, sku LIMIT 3").all().map(r => r.sku);
const [S1, S2, S3] = sticks;
const carton = db.prepare("SELECT sku FROM products WHERE pack = 'BOX' ORDER BY sku LIMIT 1").get()?.sku;
t('three roll-fed rows with no eye mark, and a carton, to work on', sticks.length === 3 && !!carton, JSON.stringify([...sticks, carton]));

console.log('\n── (2) validation at the field: refused on save, naming the expected format ──');
{
  let r = await put(`/products/${S1}`, { mrp_formula_id: 'Yes' });
  let b = await J(r);
  t('"Yes" in formula_ref is REFUSED (400)', r.status === 400, `${r.status}`);
  t('…naming the expected format, F- and five digits', /F-\d{5}|F- followed by five digits/.test(b?.error || ''), b?.error);
  t('…and nothing was written', row(S1).mrp_formula_id === null, String(row(S1).mrp_formula_id));
  t('the refusal carries the field and the expected format for the screen', b?.field === 'mrp_formula_id' && /five digits/.test(b?.expected || ''));
  r = await put(`/products/${S1}`, { formula_rev: 'V2' });
  t('"V2" is not a version (needs major.minor) — refused', r.status === 400 && /v<major>\.<minor>|v2\.0/.test((await J(r))?.error || ''));
  r = await put(`/products/${S1}`, { fill_weight_g: '-3' });
  t('a fill weight of -3 g is refused', r.status === 400);
  r = await put(`/products/${S1}`, { gtin: '850046726999' });
  t('a GTIN failing its check digit is refused', r.status === 400);
  r = await put(`/products/${S1}`, { mrp_formula_id: 'f-00003', formula_rev: 'V2.0', fill_weight_g: '34.86' });
  t('a valid triple saves', r.status === 200, `${r.status} ${JSON.stringify(await J(r)).slice(0, 120)}`);
  t('…normalised, not rewritten: F-00003 / v2.0 / 34.86', row(S1).mrp_formula_id === 'F-00003' && row(S1).formula_rev === 'v2.0' && row(S1).fill_weight_g === 34.86, JSON.stringify([row(S1).mrp_formula_id, row(S1).formula_rev, row(S1).fill_weight_g]));

  // Hex: the strict shape applies to a slot that CHANGED; an audited value on another slot is left alone.
  // On a row that HAS colour slots — the three working rows may not.
  const C1 = db.prepare('SELECT sku FROM product_colors GROUP BY sku HAVING COUNT(*) >= 2 ORDER BY sku LIMIT 1').get().sku;
  const colors = db.prepare('SELECT pms, hex FROM product_colors WHERE sku = ? ORDER BY slot').all(C1);
  const bad = colors.map((c, i) => (i === 0 ? { ...c, hex: 'HEX E613B24' } : c));
  r = await put(`/products/${C1}/colors`, { colors: bad });
  b = await J(r);
  t('hex E613B24 (seven digits) is REFUSED on the colours route', r.status === 400, `${r.status}`);
  t('…naming six hex digits', /six hex digits/.test(b?.error || ''), b?.error);
  r = await put(`/products/${C1}/colors`, { colors: colors.map((c, i) => (i === 0 ? { ...c, pms: 'PMS 158' } : c)) });
  t('a changed PMS slot takes the strict shape too — "PMS 158" with no C/U is refused for a NEW write', r.status === 400 && /C or U/.test((await J(r))?.error || ''), `${r.status}`);
  r = await put(`/products/${C1}/colors`, { colors: colors.map((c, i) => (i === 0 ? { ...c, pms: 'PMS Black C' } : c)) });
  t('…while a NAMED ink (PMS Black C, on real packs today) is a real ink and saves', r.status === 200, `${r.status} ${(await J(r))?.error || ''}`);
  r = await put(`/products/${C1}/colors`, { colors });
  t('the slots sent back unchanged are accepted as transcribed', r.status === 200, `${r.status} ${(await J(r))?.error || ''}`);
  const fixed = colors.map((c, i) => (i === 0 ? { ...c, hex: 'HEX E613B2' } : c));
  r = await put(`/products/${C1}/colors`, { colors: fixed });
  t('the six-digit form saves', r.status === 200 && db.prepare('SELECT hex FROM product_colors WHERE sku = ? AND slot = 1').get(C1).hex === 'HEX E613B2');
  await put(`/products/${C1}/colors`, { colors });

  r = await post('/products', { sku: 'PP-NEW-23X', flavor: 'Legacy Shape', base_flavor: 'Legacy', category: 'Whey Protein', pack: 'PLG' });
  t('a NEW SKU in the legacy shape is refused — the standard applies to what is minted', r.status === 400 && /LINE-PACK-FLAVOR/.test((await J(r))?.error || ''));
  r = await post('/products', { sku: 'gff-psm', flavor: 'Two Part', base_flavor: 'Two Part', category: 'Gluten Free Flour', pack: 'PSM', status: 'draft' });
  t('a two-part SKU (a flavourless line) is minted, upper-cased', r.status === 201 && !!row('GFF-PSM'), `${r.status}`);
  r = await post(`/products/${S1}/rename`, { sku: 'WHY-PLG-RENAMED' });
  t('a rename to a code outside the standard is refused', r.status === 400);
  t('…and the 118 legacy codes are untouched — PP- rows still exist', db.prepare("SELECT COUNT(*) n FROM products WHERE sku LIKE 'PP-%'").get().n > 0);
}

console.log('\n── (5) artwork status is owned by the release, not the form ──');
{
  const r = await put(`/products/${S1}`, { artwork_status: 'print_ready' });
  const b = await J(r);
  t('PUT artwork_status is REFUSED (400 ARTWORK_OWNED), never dropped silently', r.status === 400 && b?.code === 'ARTWORK_OWNED', `${r.status} ${JSON.stringify(b)}`);
  t('…and the product is not print-ready', row(S1).artwork_status !== 'print_ready');
  const p = await J(await call(`/products/${S1}`));
  const art = p.readiness.steps.find(s => s.key === 'artwork');
  t('the readiness line derives it with a stated reason', art?.state === 'todo' && /No artwork version has been released/.test(art?.reason || ''), art?.reason);
  t('EVERY readiness line states its reason', p.readiness.steps.every(s => typeof s.reason === 'string' && s.reason.length > 8), JSON.stringify(p.readiness.steps.map(s => [s.key, s.reason])));
  const done = p.readiness.steps.find(s => s.key === 'gtin');
  t('…a done line names the record behind it', done.state === 'done' && /passes its check digit/.test(done.reason), done.reason);
}

console.log('\n── (4) not applicable is a state set by a control, distinct from empty, and counted differently ──');
{
  const comp = async (sku) => (await J(await call('/products/completeness'))).rows.find(r => r.sku === sku);
  let c2 = await comp(S2);
  t('a roll-fed SKU with no eye mark has it as a GAP', c2.groups.packaging.missing.includes('Eye mark color'), JSON.stringify(c2.groups.packaging));
  let r = await post(`/products/${S2}/na`, { field: 'mrp_formula_id', on: true });
  t('the formula ref may NOT be marked NA (every product owes one)', r.status === 400 && /cannot be marked not applicable/.test((await J(r))?.error || ''));
  r = await post(`/products/${S2}/na`, { field: 'eyemark_color', on: true });
  const p2 = await J(r);
  t('the eye mark can be — with who and when', r.status === 200 && p2?.na?.eyemark_color?.by === 'Gwen Grid' && !!p2.na.eyemark_color.at, JSON.stringify(p2?.na));
  c2 = await comp(S2);
  t('NA is DONE, not a gap: the eye mark leaves the missing list', !c2.groups.packaging.missing.includes('Eye mark color'));
  t('…and is counted as NA, apart from the gaps', c2.na.includes('Eye mark color (marked not applicable)') && c2.na_count >= 1 && Object.keys(c2.na_fields).includes('eyemark_color'), JSON.stringify([c2.na, c2.na_fields]));
  const c3 = await comp(S3);
  t('an EMPTY eye mark on the next stick is still a gap — the two states are different facts', c3.groups.packaging.missing.includes('Eye mark color') && c3.na_count === (await comp(S3)).na.length && !c3.na_fields.eyemark_color);
  const all = await J(await call('/products/completeness'));
  t('the roll-up counts SKUs carrying an explicit NA', all.counts.na_skus >= 1 && all.counts.na_fields >= 1, JSON.stringify(all.counts));
  r = await put(`/products/${S2}`, { eyemark_color: 'black' });
  t('writing a value clears the NA — the value is the later statement', r.status === 200 && !(await J(r)).na.eyemark_color && row(S2).eyemark_color === 'black');
  await post(`/products/${S2}/na`, { field: 'legacy_sku', on: true });
  t('marking NA clears whatever the field held', row(S2).legacy_sku === null && JSON.parse(row(S2).na_fields).legacy_sku);
  await post(`/products/${S2}/na`, { field: 'legacy_sku', on: false });
  t('clearing NA leaves the field EMPTY, never restored', row(S2).legacy_sku === null && !(JSON.parse(row(S2).na_fields || '{}').legacy_sku));
  // "NA" typed into a box is reported, never converted.
  db.prepare("UPDATE products SET eyemark_color = 'N/A' WHERE sku = ?").run(S3);
  const health = await J(await call('/products/data-health'));
  t('"N/A" TYPED into a field is reported on Data health', health.counts.typed_na >= 1 && health.issues.some(i => i.kind === 'typed_na' && i.sku === S3), JSON.stringify(health.counts));
  t('…and NOT converted: the string is still there for the person to move', row(S3).eyemark_color === 'N/A');
  db.prepare("UPDATE products SET eyemark_color = NULL WHERE sku = ?").run(S3);
}

console.log('\n── (1) fill-down: one value, the selected rows, refused whole or applied whole ──');
{
  let r = await post('/products/bulk-edit', { skus: sticks, field: 'formula_rev', value: 'v1.0' });
  t('formula_rev v1.0 filled down three sticks', r.status === 200 && (await J(r)).updated === 3 && sticks.every(s => row(s).formula_rev === 'v1.0'), `${r.status}`);
  r = await post('/products/bulk-edit', { skus: sticks, field: 'formula_rev', value: 'draft' });
  t('an invalid value is refused for the whole set', r.status === 400 && sticks.every(s => row(s).formula_rev === 'v1.0'));
  r = await post('/products/bulk-edit', { skus: sticks, field: 'gtin', value: '850046726000' });
  t('a GTIN cannot be filled down — an identifier is not a fill', r.status === 400 && /cannot be filled down/.test((await J(r))?.error || ''));
  r = await post('/products/bulk-edit', { skus: [], field: 'notes', value: 'x' });
  t('no SKUs is a 400, never "all"', r.status === 400);
}

console.log('\n── (7) the CSV import shows its diff before commit, and is refused whole while a cell is invalid ──');
{
  const C1 = db.prepare('SELECT sku FROM product_colors GROUP BY sku HAVING COUNT(*) >= 2 ORDER BY sku LIMIT 1').get().sku;
  const before = { s2: row(S2).mrp_formula_id, s3: row(S3).mrp_formula_id, pms: db.prepare('SELECT pms FROM product_colors WHERE sku = ? AND slot = 1').get(C1)?.pms };
  const csvBad = ['sku,formula ref,formula version,fill weight (g),eye mark color,nonsense',
    `${S2},F-00010,v1.1,30,white,ignored`,
    `${S3},Yes,v1.2,31,,ignored`,
    'NOPE-XXX-1,F-00011,v1.0,1,,x'].join('\n');
  let r = await post('/products/import/preview', { csv: csvBad });
  let plan = await J(r);
  t('the preview answers with a plan', r.status === 200 && Array.isArray(plan?.rows), `${r.status} ${JSON.stringify(plan).slice(0, 160)}`);
  const r2 = plan.rows.find(x => x.sku === S2);
  t('…one row per SKU with each field from → to', !!r2 && r2.changes.some(c => c.field === 'mrp_formula_id' && c.from === (before.s2 || '') && c.to === 'F-00010'), JSON.stringify(r2));
  t('…the eye mark change too (the master.csv header name is understood)', r2.changes.some(c => c.field === 'eyemark_color'));
  t('…the refused cell is named with its format', plan.rows.find(x => x.sku === S3)?.changes.some(c => c.field === 'mrp_formula_id' && /five digits/.test(c.error || '')));
  t('…an unknown SKU and an unknown column are reported, not guessed', plan.unknown_skus.includes('NOPE-XXX-1') && plan.unknown_columns.includes('nonsense'));
  t('…and the preview wrote NOTHING', row(S2).mrp_formula_id === before.s2 && row(S3).mrp_formula_id === before.s3);
  r = await post('/products/import/commit', { csv: csvBad });
  t('COMMIT IS REFUSED WHILE ANY CELL IS INVALID (400)', r.status === 400 && /refused/.test((await J(r))?.error || ''), `${r.status}`);
  t('…and still nothing was written — not even the good rows', row(S2).mrp_formula_id === before.s2 && row(S3).mrp_formula_id === before.s3);
  const csvGood = csvBad.replace(`${S3},Yes`, `${S3},F-00012`);
  r = await post('/products/import/commit', { csv: csvGood });
  const done = await J(r);
  t('with the cell fixed the file commits', r.status === 200 && done.applied === 2, `${r.status} ${JSON.stringify(done).slice(0, 200)}`);
  t('…and the values are on the rows', row(S2).mrp_formula_id === 'F-00010' && row(S3).mrp_formula_id === 'F-00012' && row(S2).fill_weight_g === 30);
  r = await post('/products/import/preview', { csv: csvGood });
  t('a re-import of the same file changes nothing', (await J(r)).counts.changes === 0);
  // Colours through the file, pipe-delimited, the strict shape on a changed slot.
  const cur = db.prepare('SELECT pms, hex FROM product_colors WHERE sku = ? ORDER BY slot').all(C1);
  const pmsList = cur.map(c => c.pms); pmsList[0] = 'PMS 158 C';
  r = await post('/products/import/commit', { csv: `sku,pms spot colors\n${C1},${pmsList.join(' | ')}` });
  t('colour slots import pipe-delimited through the same writer', r.status === 200 && db.prepare('SELECT pms FROM product_colors WHERE sku = ? AND slot = 1').get(C1).pms === 'PMS 158 C', `${r.status} ${JSON.stringify(await J(r)).slice(0, 200)}`);
  pmsList[0] = 'PNS 158 C';
  r = await post('/products/import/commit', { csv: `sku,pms spot colors\n${C1},${pmsList.join(' | ')}` });
  t('…and a typo in a slot is refused', r.status === 400);
  await put(`/products/${C1}/colors`, { colors: cur });
  t('restored', db.prepare('SELECT pms FROM product_colors WHERE sku = ? AND slot = 1').get(C1).pms === before.pms);
  r = await post('/products/import/preview', { csv: 'formula ref\nF-00001' });
  t('a file with no sku column is refused', r.status === 400);
}

console.log('\n── (§5) master.csv says where every column comes from, and the sixteen names are unchanged ──');
{
  const text = await (await fetch(`${B}/products/master.csv?token=${PT}`)).text();
  const header = text.split('\n')[0];
  t('the header IS the source map\'s keys, in order', header === MASTER_CSV_SOURCES.map(([n]) => n).join(','), header);
  t('the sixteen contract names come first, verbatim', header.startsWith('sku,gtin,flavor,packaging type,material,zipper,print,trim length,trim width,gusset dimension,front panel dimension,wind direction,pms spot colors,hex spot colors,eye mark color,die line required'));
  t('every column names the table and column it populates from', MASTER_CSV_SOURCES.every(([, src]) => /^(products|packaging_specs|product_colors|stability_justifications)\./.test(src)));
}

console.log('\n── the screen: the grid at 1280, the cards at 390 ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'pg-adm', name: 'Gwen Grid', role: 'admin' })); }, [tok]);
  await page.goto(`${URL}/?tab=products`);
  await page.waitForSelector('[data-product-grid]', { timeout: 20000 }).catch(() => {});
  t('(1) the grid is the default landing on Products', await page.locator('[data-product-grid]').count() === 1);
  const comp = await J(await call('/products/completeness'));
  const n = db.prepare("SELECT COUNT(*) n FROM products").get().n;
  // The chips count what has LOADED; wait for both fetches (products, then completeness) to have landed
  // before reading them, or the read races the data — the first run printed "119 vs 119" and failed.
  await page.waitForSelector(`[data-grid-filter="all"][data-count="${n}"]`, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector(`[data-grid-filter="incomplete"][data-count="${comp.counts.incomplete}"]`, { timeout: 15000 }).catch(() => {});
  const cnt = async (k) => Number(await page.locator(`[data-grid-filter="${k}"]`).getAttribute('data-count'));
  t('the All chip counts the catalogue', await cnt('all') === n, `${await cnt('all')} vs ${n}`);
  t('the Incomplete / Blocked / Stale chips are the completeness walk\'s own counts', await cnt('incomplete') === comp.counts.incomplete && await cnt('blocked') === comp.counts.blocked && await cnt('stale') === comp.counts.stale,
    `${await cnt('incomplete')}/${comp.counts.incomplete} ${await cnt('blocked')}/${comp.counts.blocked} ${await cnt('stale')}/${comp.counts.stale}`);
  await page.locator('[data-grid-filter="incomplete"]').click();
  await page.waitForTimeout(300);
  t('clicking Incomplete narrows the rows to that count', await page.locator('[data-grid-row]').count() === comp.counts.incomplete, `${await page.locator('[data-grid-row]').count()}`);
  await page.locator('[data-grid-filter="all"]').click();
  await page.waitForTimeout(300);

  // Inline edit: a refused value stays in the cell with the format.
  const cell = (sku, f) => page.locator(`[data-grid-row="${sku}"] [data-cell="${f}"]`).first();
  await cell(S1, 'mrp_formula_id').click();
  await page.waitForTimeout(200);
  t('(1) clicking a cell opens an inline editor', await page.locator('[data-cell-input]').count() === 1);
  await page.locator('[data-cell-input]').fill('Yes');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const errText = await page.locator('[data-cell-error]').first().innerText().catch(() => '');
  t('(2) "Yes" is refused IN THE CELL, naming the format', /five digits/.test(errText), errText);
  t('…the editor stays open on the refused value', await page.locator('[data-cell-input]').count() === 1 && await page.locator('[data-cell-input]').inputValue() === 'Yes');
  t('…and the row still says F-00003', row(S1).mrp_formula_id === 'F-00003');
  await page.locator('[data-cell-input]').fill('F-00099');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  t('a valid value saves on Enter', row(S1).mrp_formula_id === 'F-00099');
  t('…and Enter moved the editor to the next row, same column', await page.locator('[data-editing][data-cell="mrp_formula_id"]').count() === 1 && await page.locator(`[data-grid-row="${S1}"] [data-editing]`).count() === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  t('Esc cancels', await page.locator('[data-cell-input]').count() === 0);
  await cell(S1, 'flavor').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  t('Tab saves and moves right (product name → base flavour)', await page.locator(`[data-grid-row="${S1}"] [data-editing][data-cell="base_flavor"]`).count() === 1);
  await page.keyboard.press('Escape');

  // Fill-down: shift-click a run in one column.
  await cell(S1, 'formula_rev').click();
  await page.waitForTimeout(200);
  await page.locator('[data-cell-input]').fill('v3.0');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await cell(S1, 'formula_rev').click();
  await page.waitForTimeout(200);
  await cell(S3, 'formula_rev').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  t('(1) shift-click selects a run of rows in one column and offers fill-down', await page.locator('[data-fill-down]').count() === 1);
  await page.locator('[data-fill-down-apply]').click();
  await page.waitForTimeout(1500);
  t('…and the top value lands on the rows below', row(S2).formula_rev === 'v3.0' && row(S3).formula_rev === 'v3.0', JSON.stringify([row(S2).formula_rev, row(S3).formula_rev]));

  // NA from the cell.
  await cell(S3, 'eyemark_color').click();
  await page.waitForTimeout(200);
  t('(4) the editor offers "Mark NA" on a field that may carry one', await page.locator('[data-na-set]').count() === 1);
  await page.locator('[data-na-set]').click();
  await page.waitForTimeout(1200);
  t('…the cell now reads NA, a chip, not a typed value', await cell(S3, 'eyemark_color').locator('[data-na]').count() === 1 && JSON.parse(row(S3).na_fields).eyemark_color);
  const naCount = await page.locator(`[data-grid-row="${S3}"] [data-comp-na]`).innerText();
  t('…and the completeness column counts it as NA, apart from the gaps', /^[1-9]\d* NA$/.test(naCount.trim()), naCount);
  await cell(S2, 'mrp_formula_id').click();
  await page.waitForTimeout(200);
  t('…while the formula ref offers no NA control', await page.locator('[data-na-set]').count() === 0);
  await page.keyboard.press('Escape');

  // Column groups collapse.
  await page.locator('[data-group-toggle="formula"]').click();
  await page.waitForTimeout(200);
  t('(1) a column group collapses', await page.locator('[data-cell="mrp_formula_id"]').count() === 0 && await page.locator('[data-group-toggle="formula"]').getAttribute('data-group-open') === '0');
  await page.locator('[data-group-toggle="formula"]').click();

  // Derived packaging cells are read-only and say where from.
  const mat = cell(S1, 'material_structure');
  t('(3) a packaging cell is derived and names its source', /packaging_specs\.material_structure/.test(await mat.getAttribute('title') || ''), await mat.getAttribute('title'));
  await mat.click();
  await page.waitForTimeout(200);
  t('…and does not open an editor', await page.locator('[data-cell-input]').count() === 0);
  t('…a carton shows wind direction as not applicable by format', /n\/a by format/.test(await cell(carton, 'wind_direction').innerText()));

  // Export builds from the screen.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-grid]').click()]);
  const text = await (await dl.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8'));
  const lines = text.trim().split('\n');
  t('(1) the CSV export has one row per visible SKU', lines.length - 1 === await page.locator('[data-grid-row]').count(), `${lines.length - 1}`);
  t('…with the grid\'s own headers', /^SKU,Product name,Base flavor/.test(lines[0]), lines[0]);

  // Import from the screen: the diff, then the commit.
  await page.locator('[data-import]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-import-text]').fill(`sku,formula ref\n${S1},F-00042\n${S2},nope`);
  await page.locator('[data-import-preview]').click();
  await page.waitForTimeout(1200);
  t('(7) the import shows its diff before commit', await page.locator('[data-import-plan]').count() === 1 && await page.locator(`[data-import-row="${S1}"]`).count() === 1);
  t('…with the refused cell marked and Commit disabled', await page.locator('[data-import-cell-error]').count() === 1 && await page.locator('[data-import-commit]').isDisabled());
  t('…and nothing written', row(S1).mrp_formula_id === 'F-00099');
  await page.locator('[data-import-text]').fill(`sku,formula ref\n${S1},F-00042`);
  await page.locator('[data-import-preview]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-import-commit]').click();
  await page.waitForTimeout(1500);
  t('…fixed, it commits from the screen', await page.locator('[data-import-applied]').count() === 1 && row(S1).mrp_formula_id === 'F-00042');
  await page.keyboard.press('Escape');
  await page.locator('[data-import-modal] button').first().click().catch(() => {});
  await page.waitForTimeout(300);

  // The drawer: four blocks in order, derived packaging with sources, no artwork dropdown.
  await page.locator(`[data-grid-row="${S1}"] [data-open-row]`).click();
  await page.waitForSelector('[data-product-drawer] [data-block="channels"]', { timeout: 8000 }).catch(() => {});
  const blocks = await page.locator('[data-product-drawer] [data-block]').evaluateAll(els => els.map(e => e.getAttribute('data-block')));
  t('(3) the record page is four blocks in order: identity, formula, packaging, channels', blocks.join(',') === 'identity,formula,packaging,channels', blocks.join(','));
  t('…the packaging block derives material from the spec and says so', await page.locator('[data-packaging-derived] [data-derived="packaging_specs.material_structure"]').count() === 1);
  t('…and the pms slots from product_colors', await page.locator('[data-packaging-derived] [data-derived^="product_colors.pms"]').count() === 1);
  const artLine = await page.locator('[data-step-line="artwork"]').innerText().catch(() => '');
  t('(5) the artwork line is derived with its reason', /No artwork version has been released/.test(artLine), artLine);
  await page.locator('[data-drawer-edit]').click();
  await page.waitForTimeout(300);
  t('(5) the edit form has NO artwork status dropdown', await page.locator('[data-product-drawer] select option[value="print_ready"]').count() === 0);
  t('…and its blocks are the same four', (await page.locator('[data-product-drawer] [data-block]').evaluateAll(els => els.map(e => e.getAttribute('data-block')))).join(',') === 'identity,formula,packaging,channels');
  // D-135 added the spec POINTER (which spec the product is on — its own fact);
  // the film facts themselves are still never typed on a product.
  const typed = await page.locator('[data-block="packaging"] [data-field]').evaluateAll(els => els.map(e => e.getAttribute('data-field')).sort());
  t('…the packaging block types only the eye mark, the die line and which spec — no film fact', typed.join(',') === 'dieline_required,eyemark_color,spec_id', typed.join(','));
  t('…the formula field shows its rule beside the box', /F-00002|five digits/.test(await page.locator('[data-field="mrp_formula_id"]').innerText()));
  await page.locator('[data-field="mrp_formula_id"] input').fill('Yes');
  await page.locator('[data-drawer-save]').click();
  await page.waitForTimeout(800);
  t('(2) the drawer refuses "Yes" on save with the format', /five digits/.test(await page.locator('[data-drawer-error]').innerText().catch(() => '')));
  t('…nothing saved', row(S1).mrp_formula_id === 'F-00042');
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${URL}/manifest.webmanifest`);
  await phone.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'pg-adm', name: 'Gwen Grid', role: 'admin' })); }, [tok]);
  await phone.goto(`${URL}/?tab=products`);
  await phone.waitForSelector('[data-record-cards]', { timeout: 20000 }).catch(() => {});
  t('390px: the catalogue is cards, not a spreadsheet', await phone.locator('[data-record-cards]').count() === 1);
  t('390px: the page does not pan sideways', !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await phone.close();
} finally { await browser.close(); }

await wait(100);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
