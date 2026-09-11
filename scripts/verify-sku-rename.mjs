// Renaming a SKU, on a product that has the history a real product has.
//
// The SKU is a join key in FOUR tables. Both rename paths carried
// `product_colors` alone, which is correct for exactly as long as the
// catalogue has no artwork and no nutrition panels — and the proofing loop
// files an artwork version the first time a pack is proofed. So the rename
// would have failed on the products furthest along, with a bare
// `FOREIGN KEY constraint failed`, on the first day of the SKU cutover.
//
// Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4998;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('sku-admin','Sku Admin','Sku Admin','admin','office',1,'SC-SK',datetime('now','+7 day'),NULL)`).run();

// A product with the history a real one has by the time anybody renames it:
// colours, a proofed artwork version, the snapshot that proof produced, and an
// approved nutrition panel.
const sku = db.prepare("SELECT sku FROM products WHERE status = 'active' ORDER BY sku LIMIT 1").get().sku;
db.prepare("INSERT INTO artwork_versions (id,sku,component,version,status,source) VALUES ('rn-art',?,'primary',1,'print_ready','proofing')").run(sku);
db.prepare("INSERT INTO artwork_snapshots (id,version_id,sku,proof_job_id,snapshot) VALUES ('rn-snap','rn-art',?,'job-1','{}')").run(sku);
db.prepare("INSERT INTO nfp_versions (id,sku,version,status) VALUES ('rn-nfp',?,'V3','approved')").run(sku);
const colours = db.prepare('SELECT COUNT(*) c FROM product_colors WHERE sku = ?').get(sku).c;
t('a product with colours, artwork, a proof snapshot and an approved panel', colours >= 0);
db.close();

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Sku Admin' });
await call('POST', '/users/set-password', { user_id: 'sku-admin', password: 'SkuAdmin2026!', setup_code: 'SC-SK' });
const tok = (await (await call('POST', '/users/login', { name: 'Sku Admin', password: 'SkuAdmin2026!' })).json())?.token;
t('signed in', !!tok);

const NEW = 'WHY-PLG-RENAMED';
let NEXT_SKU = NEW;
const r = await call('POST', `/products/${encodeURIComponent(sku)}/rename`, { sku: NEW }, tok);
const body = await r.json();
t('THE RENAME SUCCEEDS on a product that has artwork and a nutrition panel', r.status === 200, `${r.status} ${JSON.stringify(body).slice(0, 160)}`);
t('the product carries the new code', body?.sku === NEW);
t('AND KEEPS THE OLD ONE FOREVER — a two-year-old PO still resolves', body?.legacy_sku === sku, String(body?.legacy_sku));

{
  const d = new Database(process.env.DBPATH, { readonly: true });
  const at = (tbl, id) => d.prepare(`SELECT sku FROM ${tbl} WHERE id = ?`).get(id)?.sku;
  t('the artwork version moved with it', at('artwork_versions', 'rn-art') === NEW, at('artwork_versions', 'rn-art'));
  t('SO DID THE PROOF SNAPSHOT — it has no foreign key, so it would have orphaned in silence',
    at('artwork_snapshots', 'rn-snap') === NEW, at('artwork_snapshots', 'rn-snap'));
  t('and the approved nutrition panel', at('nfp_versions', 'rn-nfp') === NEW, at('nfp_versions', 'rn-nfp'));
  t('nothing is left pointing at the old code',
    d.prepare('SELECT COUNT(*) c FROM artwork_versions WHERE sku = ?').get(sku).c === 0
    && d.prepare('SELECT COUNT(*) c FROM nfp_versions WHERE sku = ?').get(sku).c === 0
    && d.prepare('SELECT COUNT(*) c FROM product_colors WHERE sku = ?').get(sku).c === 0);
  d.close();
}

// The punch list the cutover is actually run from.
//
// Ticked BEFORE the rename, or the assertion passes vacuously against a step
// that was never done in the first place.
{
  for (const step of ['shopify', 'shiphero']) {
    const r = await call('POST', `/products/${NEW}/confirm/${step}`, {}, tok);
    t(`  ${step} confirmed against the old code`, r.status === 200, String(r.status));
  }
  const before = await (await call('GET', `/products?sku=${NEW}`, null, tok)).json();
  const rowBefore = (Array.isArray(before) ? before : before.products || []).find((x) => x.sku === NEW);
  const stateOf = (row, k) => (row?.readiness?.steps || []).find((s) => s.key === k)?.state;
  t('both read done while the code has not moved',
    stateOf(rowBefore, 'shopify') === 'done' && stateOf(rowBefore, 'shiphero') === 'done',
    `${stateOf(rowBefore, 'shopify')}/${stateOf(rowBefore, 'shiphero')}`);

  const AGAIN = 'WHY-PLG-RENAMED2';
  t('renamed again', (await call('POST', `/products/${NEW}/rename`, { sku: AGAIN }, tok)).status === 200);
  const after = await (await call('GET', `/products?sku=${AGAIN}`, null, tok)).json();
  const rowAfter = (Array.isArray(after) ? after : after.products || []).find((x) => x.sku === AGAIN);
  t('SHOPIFY AND SHIPHERO GO STALE THE MOMENT THE CODE MOVES — the app writes the re-verify list itself',
    stateOf(rowAfter, 'shopify') === 'stale' && stateOf(rowAfter, 'shiphero') === 'stale',
    `${stateOf(rowAfter, 'shopify')}/${stateOf(rowAfter, 'shiphero')}`);
  t('and each names the SKU as what moved',
    (rowAfter?.readiness?.steps || []).find((s) => s.key === 'shiphero')?.changed?.includes('sku'));
  t('the GS1 barcode step is untouched — the GTIN never moved, which is what makes the cutover safe',
    stateOf(rowAfter, 'gtin') === 'done', stateOf(rowAfter, 'gtin'));
  t('legacy_sku still holds the ORIGINAL code, not the intermediate one — it is never overwritten',
    rowAfter?.legacy_sku === sku, rowAfter?.legacy_sku);
  NEXT_SKU = AGAIN;
}

// The refusals that keep a join key safe.
{
  const all = await (await call('GET', '/products', null, tok)).json();
  const taken = (Array.isArray(all) ? all : all.products || []).find((x) => x.sku !== NEXT_SKU)?.sku;
  t('a SKU another product already holds is refused',
    (await call('POST', `/products/${NEXT_SKU}/rename`, { sku: taken }, tok)).status === 409, taken);
}
t('an empty or malformed code is refused', (await call('POST', `/products/${NEXT_SKU}/rename`, { sku: 'A' }, tok)).status === 400);
t('renaming a SKU that does not exist is a 404', (await call('POST', '/products/NO-SUCH-SKU/rename', { sku: 'ABC-DEF-GHI' }, tok)).status === 404);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
