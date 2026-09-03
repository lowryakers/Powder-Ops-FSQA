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
{ const db = new Database(process.env.DBPATH, { readonly: true }); const n = db.prepare('SELECT COUNT(*) c FROM artwork_snapshots WHERE sku = ?').get(product.sku).c; db.close();
  t('two snapshots on file for three runs', n === 2, String(n)); }

console.log('\nThe version carries its snapshot in the artwork history');
const detail = await J(await req(`/artwork/versions/${v2}`));
t('GET /artwork/versions/:id includes the snapshot', /retry wording/.test(detail?.snapshot?.ingredients || ''));
const board = await J(await req(`/artwork/sku/${encodeURIComponent(product.sku)}`));
t('the SKU history flags which versions have one', Array.isArray(board?.versions) && board.versions.filter(v => v.has_snapshot).length === 2 && board.versions.some(v => v.has_snapshot === false));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
