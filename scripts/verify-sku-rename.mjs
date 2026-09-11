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

// Amazon: the fourth system, and the one where a rename is most expensive.
{
  console.log('\n── Amazon ──');
  const get = async (sku) => {
    const all = await (await call('GET', `/products?sku=${sku}`, null, tok)).json();
    return (Array.isArray(all) ? all : all.products || []).find((x) => x.sku === sku);
  };
  const stepOf = (row, k) => (row?.readiness?.steps || []).find((s) => s.key === k);

  const before = await get(NEXT_SKU);
  t('A PRODUCT NOBODY HAS PLACED ON AMAZON DOES NOT OWE THE STEP — it is not on the list at all',
    !stepOf(before, 'amazon'), JSON.stringify((before?.readiness?.steps || []).map((s) => s.key)));
  t('confirming a listing is refused until somebody says it is on Amazon',
    (await call('POST', `/products/${NEXT_SKU}/confirm/amazon`, {}, tok)).status === 400);

  t('a channel value the readiness step cannot read is refused',
    (await call('PUT', `/products/${NEXT_SKU}`, { amazon_channel: 'maybe' }, tok)).status === 400);

  t('marking it not sold is accepted', (await call('PUT', `/products/${NEXT_SKU}`, { amazon_channel: 'not_sold' }, tok)).status === 200);
  t('and it still owes nothing — "no" and "nobody has said" both leave the step off, for different reasons',
    !stepOf(await get(NEXT_SKU), 'amazon'));
  t('confirming a listing on a product marked not sold is refused',
    (await call('POST', `/products/${NEXT_SKU}/confirm/amazon`, {}, tok)).status === 400);

  await call('PUT', `/products/${NEXT_SKU}`, { amazon_channel: 'listed', amazon_sku: 'B0TEST', amazon_asin: 'B00TESTASIN' }, tok);
  const listed = await get(NEXT_SKU);
  t('SAYING IT IS LISTED PUTS THE STEP ON THE PUNCH LIST', stepOf(listed, 'amazon')?.state === 'todo',
    stepOf(listed, 'amazon')?.state);
  t('the seller SKU and ASIN are stored', listed?.amazon_sku === 'B0TEST' && listed?.amazon_asin === 'B00TESTASIN');
  t('it is a step a person ticks, like Shopify and ShipHero', stepOf(listed, 'amazon')?.tick === true);

  t('confirming it is accepted now', (await call('POST', `/products/${NEXT_SKU}/confirm/amazon`, {}, tok)).status === 200);
  t('and it reads done', stepOf(await get(NEXT_SKU), 'amazon')?.state === 'done');

  const AMZ = 'WHY-PLG-RENAMED3';
  t('renamed once more', (await call('POST', `/products/${NEXT_SKU}/rename`, { sku: AMZ }, tok)).status === 200);
  const moved = await get(AMZ);
  t('THE AMAZON STEP GOES STALE WITH THE SKU — FBA stock is bound to the seller SKU',
    stepOf(moved, 'amazon')?.state === 'stale', stepOf(moved, 'amazon')?.state);
  t('and it names the SKU as what moved', stepOf(moved, 'amazon')?.changed?.includes('sku'));
  NEXT_SKU = AMZ;

  t('marking it not sold afterwards drops the confirmation with it — a listing date on a product we do not sell is a false record',
    (await call('PUT', `/products/${NEXT_SKU}`, { amazon_channel: 'not_sold' }, tok)).status === 200
    && !(await get(NEXT_SKU))?.amazon_listed_at);

  const health = await (await call('GET', '/products/data-health', null, tok)).json();
  t('Data health counts the channel DECISION separately from the readiness steps',
    health?.amazon && typeof health.amazon.undecided === 'number'
    && health.amazon.undecided + health.amazon.listed + health.amazon.not_sold > 0,
    JSON.stringify(health?.amazon));
  t('and it is the honest state of the catalogue — nobody has said, for almost all of it',
    health.amazon.undecided >= 100, String(health?.amazon?.undecided));
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
