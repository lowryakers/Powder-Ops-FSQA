// The three things the Artwork-Proofing service asked ReadyDoc for, executed:
// a fill weight on master.csv, a snapshot stored on ingest, and a snapshot
// endpoint to compare against. Caller sets PORT + DBPATH and
// PRODUCT_MASTER_TOKEN=proof-token on the server.
const PORT = process.env.PORT || 4934;
const B = `http://localhost:${PORT}/api`;
const TOKEN = 'proof-token';
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('aw-admin','Artwork Admin','Artwork Admin','admin','qa',1,'SC-AW',datetime('now','+7 day'))`).run();
  db.close(); }
await post('/users/login', { name: 'Artwork Admin' });
await post('/users/set-password', { user_id: 'aw-admin', password: 'Art2026!', setup_code: 'SC-AW' });
token = (await J(await post('/users/login', { name: 'Artwork Admin', password: 'Art2026!' })))?.token;
t('signed in', !!token);
const product = (() => { const db = new Database(process.env.DBPATH, { readonly: true }); const p = db.prepare("SELECT sku, gtin, flavor FROM products WHERE gtin IS NOT NULL AND gtin != '' ORDER BY sku LIMIT 1").get(); db.close(); return p; })();
t('a seeded product with a GTIN to work on', !!product?.gtin, JSON.stringify(product));

console.log('\nmaster.csv carries a fill weight column, and the sixteen contract headers are untouched');
let csv = await (await fetch(`${B}/products/master.csv?token=${TOKEN}`)).text();
const header = csv.split('\n')[0].split(',');
const SIXTEEN = ['sku', 'gtin', 'flavor', 'packaging type', 'material', 'zipper', 'print', 'trim length', 'trim width', 'gusset dimension', 'front panel dimension', 'wind direction', 'pms spot colors', 'hex spot colors', 'eye mark color', 'die line required'];
t('THE SIXTEEN HEADERS THE PROOFER MATCHES ON ARE STILL THERE, in order', SIXTEEN.every((h, i) => header[i] === h), header.join('|'));
t('and "fill weight (g)" is the seventeenth', header[16] === 'fill weight (g)', header[16]);
const rowOf = (text) => text.split('\n').find(l => l.startsWith(`${product.sku},`));
t('a product with no fill weight has a BLANK cell, never a guess', rowOf(csv)?.split(',')[16] === '', rowOf(csv));
let r = await put(`/products/${encodeURIComponent(product.sku)}`, { fill_weight_g: 'thirty' });
t('a fill weight that is not a number is refused', r.status === 400, String(r.status));
r = await put(`/products/${encodeURIComponent(product.sku)}`, { fill_weight_g: '30' });
t('a fill weight is stored as a number of grams', r.status === 200 && (await J(r))?.fill_weight_g === 30, String(r.status));
csv = await (await fetch(`${B}/products/master.csv?token=${TOKEN}`)).text();
t('and reaches master.csv', rowOf(csv)?.split(',')[16] === '30', rowOf(csv));
r = await put(`/products/${encodeURIComponent(product.sku)}`, { fill_weight_g: '0' });
t('ZERO IS REFUSED, so an empty cell can never mean a stored 0', r.status === 400, String(r.status));
// The proofer rejects an HTML or JSON body outright and fails the run loudly,
// so the content type is part of the contract, not a nicety.
const head = await fetch(`${B}/products/master.csv?token=${TOKEN}`);
t('the feed is still served as text/csv', /^text\/csv/.test(head.headers.get('content-type') || ''), head.headers.get('content-type'));

console.log('\nThe ten weighed ProDough SKUs carry their fill weight, transcribed and not derived');
const { FILL_WEIGHTS, seedFillWeights } = await import('../server/fill-weight-seed.js');
const cellFor = (sku) => csv.split('\n').find(l => l.startsWith(`${sku},`))?.split(',')[16];
t('all ten are in the catalogue and carry a value',
  FILL_WEIGHTS.every(f => cellFor(f.sku) === String(f.grams)),
  FILL_WEIGHTS.map(f => `${f.sku}=${cellFor(f.sku)}`).join(' '));
t('the cupcakes read 380 — the measured fill — NOT the 720 the artwork declares',
  cellFor('PCCM-V-04') === '380' && cellFor('PCCM-CH-01') === '380', cellFor('PCCM-V-04'));
t('and the pancakes and crepes read 454', cellFor('PPM-BM') === '454' && cellFor('PCM-OR') === '454');

// A measurement already on the row wins, including one that disagrees with the
// table — so the seeder is run again with its marker removed, the hardest case.
await put('/products/PPM-BM', { fill_weight_g: '460' });
{ const db = new Database(process.env.DBPATH);
  db.prepare("DELETE FROM app_settings WHERE key = 'product_fill_weights_seeded'").run();
  seedFillWeights(db);
  // Clearing a fill weight is how somebody says "that was wrong, we do not
  // know it yet". The marker is what stops the next deploy putting a number
  // back over that, so the run below must change nothing.
  db.prepare("UPDATE products SET fill_weight_g = NULL WHERE sku = 'PCM-CH'").run();
  seedFillWeights(db);
  db.close(); }
csv = await (await fetch(`${B}/products/master.csv?token=${TOKEN}`)).text();
t('A TYPED VALUE IS NEVER OVERWRITTEN by the seeder', cellFor('PPM-BM') === '460', cellFor('PPM-BM'));
t('a CLEARED value stays cleared — the seeder does not refill it', cellFor('PCM-CH') === '', cellFor('PCM-CH'));
t('and the untouched nine still read as seeded', cellFor('PPM-CS') === '454' && cellFor('PCCM-PS-03') === '380');

console.log('\nIngest stores the snapshot with the version, in one transaction');
const SNAP = { ingredients: 'Whey protein isolate, cocoa, natural flavour', claims: ['25g protein', 'gluten free'], serving_size: '30 g', net_weight: '900 g' };
r = await post(`/artwork/ingest?token=${TOKEN}`, { job_id: 'job-1', sku: product.sku, gtin: product.gtin, component: 'primary',
  checks: [{ name: 'netwt', result: 'pass' }, { name: 'ingredients', result: 'warn', detail: 'no prior version' }], snapshot: SNAP });
let body = await J(r);
t('ingested', r.status === 201 && body?.snapshot_stored === true, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
const v1 = body?.version_id;
r = await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${token}` } });
body = await J(r);
t('GET /artwork/snapshot?gtin= returns what the run saw', r.status === 200 && body?.snapshot?.ingredients === SNAP.ingredients && body.version_id === v1, `${r.status} ${JSON.stringify(body).slice(0, 140)}`);
r = await fetch(`${B}/artwork/snapshot?sku=${encodeURIComponent(product.sku)}`, { headers: { Authorization: `Bearer ${token}` } });
t('...and by SKU', r.status === 200 && (await J(r))?.snapshot?.net_weight === '900 g');
r = await fetch(`${B}/artwork/snapshot?sku=NO-SUCH-SKU`, { headers: { Authorization: `Bearer ${token}` } });
t('an unknown product is a 404, not a SKU called "snapshot"', r.status === 404);

console.log('\nThe snapshot is FROZEN');
await put(`/products/${encodeURIComponent(product.sku)}`, { flavor: `${product.flavor} (renamed)` });
body = await J(await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${token}` } }));
t('correcting the product does not rewrite what the run saw', body?.snapshot?.ingredients === SNAP.ingredients);
await put(`/products/${encodeURIComponent(product.sku)}`, { flavor: product.flavor });

console.log('\nA later run is the latest; a run with no snapshot does not erase the last one');
r = await post(`/artwork/ingest?token=${TOKEN}`, { job_id: 'job-2', sku: product.sku, gtin: product.gtin, component: 'primary',
  checks: [{ name: 'ingredients', result: 'pass' }], snapshot: { ...SNAP, ingredients: 'Whey protein isolate, cocoa, natural flavour, stevia' } });
const v2 = (await J(r))?.version_id;
body = await J(await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${token}` } }));
t('the newest run answers', body?.version_id === v2 && /stevia/.test(body?.snapshot?.ingredients || ''));
r = await post(`/artwork/ingest?token=${TOKEN}`, { job_id: 'job-3', sku: product.sku, gtin: product.gtin, component: 'primary', checks: [{ name: 'gtin', result: 'pass' }] });
t('a run without a snapshot still ingests', r.status === 201 && (await J(r))?.snapshot_stored === false);
body = await J(await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${token}` } }));
t('and the last snapshot still answers', body?.version_id === v2);
r = await post(`/artwork/ingest?token=${TOKEN}`, { job_id: 'job-2', sku: product.sku, gtin: product.gtin, component: 'primary', checks: [{ name: 'ingredients', result: 'pass' }], snapshot: { ...SNAP, ingredients: 'retry wording' } });
t('a RETRY of the same job replaces its snapshot rather than adding a second', (await J(r))?.replaced === true
  && /retry wording/.test((await J(await fetch(`${B}/artwork/snapshot?gtin=${product.gtin}`, { headers: { Authorization: `Bearer ${token}` } })))?.snapshot?.ingredients || ''));
{ const db = new Database(process.env.DBPATH, { readonly: true }); let n = -1; try { n = db.prepare('SELECT COUNT(*) c FROM artwork_snapshots WHERE sku = ?').get(product.sku).c; } catch { /* no table on old code — a failure, not a crash */ } db.close();
  t('two snapshots on file for three runs', n === 2, String(n)); }

console.log('\nThe version carries its snapshot in the artwork history');
const detail = await J(await req(`/artwork/versions/${v2}`));
t('GET /artwork/versions/:id includes the snapshot', /retry wording/.test(detail?.snapshot?.ingredients || ''));
const board = await J(await req(`/artwork/sku/${encodeURIComponent(product.sku)}`));
t('the SKU history flags which versions have one', Array.isArray(board?.versions) && board.versions.filter(v => v.has_snapshot).length === 2 && board.versions.some(v => v.has_snapshot === false));

console.log('\nONE NUMBER, ONE SPELLING — a GTIN typed in its padded GTIN-14 form');
// `00` + a UPC-A is that UPC's GTIN-14 form and carries the SAME check digit,
// so it passed validation and was stored as typed. That left the catalogue
// holding one number two ways, and three readers disagreed about it.
const PADDED = `00${product.gtin}`;
const readinessOf = async () => {
  const rows = await J(await req('/products?limit=500'));
  const row = (rows?.products || rows || []).find(x => x.sku === product.sku);
  return row || {};
};
// A step signed off AGAINST the GTIN, so the staleness assertion below has
// something real to be about rather than passing on an empty list.
await post(`/products/${encodeURIComponent(product.sku)}/confirm/shopify`, { on: true });
const before = await readinessOf();
const stepState = (row, key) => (row.readiness?.steps || []).find(s => s.key === key)?.state;
t('the Shopify step is signed off against the GTIN', stepState(before, 'shopify') === 'done', stepState(before, 'shopify'));
r = await put(`/products/${encodeURIComponent(product.sku)}`, { gtin: PADDED });
body = await J(r);
t('a padded GTIN is accepted — it is a legitimate way to write the number', r.status === 200, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
t('…and STORED as the UPC-A, un-padded at the door', body?.gtin === product.gtin, String(body?.gtin));
t('…still valid', body?.gtin_valid === 1 || body?.gtin_valid === true, String(body?.gtin_valid));

// The NUMBER did not change, only its spelling — so a step signed off against
// it must not come back onto the punch list saying "the GTIN moved".
const after = await readinessOf();
t('a step signed off against the GTIN does NOT go stale on a change of spelling',
  stepState(after, 'shopify') === 'done', `${stepState(after, 'shopify')} — ${JSON.stringify((after.readiness?.steps || []).find(s => s.key === 'shopify')?.changed_labels)}`);

csv = await (await fetch(`${B}/products/master.csv?token=${TOKEN}`)).text();
t('master.csv ships the twelve digits the proofer expects', rowOf(csv)?.split(',')[1] === product.gtin, rowOf(csv)?.split(',').slice(0, 2).join(','));

// From here the row is FORCED to the bare UPC-A in the database, so what is
// being tested is whether the padded spelling arriving from OUTSIDE resolves —
// not whether it happens to match a row that is padded too.
{ const db = new Database(process.env.DBPATH);
  db.prepare('UPDATE products SET gtin = ? WHERE sku = ?').run(product.gtin, product.sku);
  db.close(); }

// The proofing service reads whatever is on the label, and a decoder routinely
// hands a UPC-A back in its padded form. Both spellings must find the product.
r = await fetch(`${B}/artwork/snapshot?gtin=${PADDED}`, { headers: { Authorization: `Bearer ${token}` } });
t('a padded GTIN finds the product on the snapshot endpoint', r.status === 200, String(r.status));
r = await post(`/artwork/ingest?token=${TOKEN}`, { job_id: 'job-padded', gtin: PADDED, component: 'primary', checks: [{ name: 'gtin', result: 'pass' }] });
body = await J(r);
t('…and on ingest, resolving to the same SKU rather than 404', r.status === 201 && body?.sku === product.sku, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);

// The red warning Lowry was looking at: an image made for the number the
// product still carries, reported as being for a different one.
{ const db = new Database(process.env.DBPATH);
  db.prepare("UPDATE products SET barcode_key = 'barcodes/test.png', barcode_gtin = ? WHERE sku = ?").run(PADDED, product.sku);
  db.close(); }
const withBarcode = await readinessOf();
t('a barcode image recorded under the padded spelling is NOT stale', withBarcode.barcode_stale === false, JSON.stringify({ stale: withBarcode.barcode_stale, img: withBarcode.barcode_gtin, gtin: withBarcode.gtin }));
{ const db = new Database(process.env.DBPATH);
  db.prepare("UPDATE products SET barcode_gtin = '850046726019' WHERE sku = ?").run(product.sku);
  db.close(); }
t('…while an image for a genuinely different number still is', (await readinessOf()).barcode_stale === true);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
