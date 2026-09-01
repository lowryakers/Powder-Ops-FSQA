// The GTIN barcode board and the product shelf — executed against a live
// server. Caller sets PORT + DBPATH.
//
// NEEDS A GENUINELY FRESH DATABASE: it asserts the shelf's opening state
// ("nothing filed yet") and then files into it, so a second run against the
// same database is measuring its own leftovers. Boot a new DB_PATH first.
const PORT = process.env.PORT || 4881;
const B = `http://localhost:${PORT}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('pt-admin','Tab Admin','Tab Admin','admin','qa',1,'SC-PT', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('pt-oper','Tab Operator','Tab Operator','operator','production',1,'SC-PT2', datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Tab Admin' });
await post('/users/set-password', { user_id: 'pt-admin', password: 'TabSecret2026', setup_code: 'SC-PT' });
token = (await J(await post('/users/login', { name: 'Tab Admin', password: 'TabSecret2026' })))?.token;
t('admin signed in', !!token);

console.log('\n── the barcode board ──');
let bc = await J(await req('/products/barcodes'));
t('the board answers', Array.isArray(bc?.products), JSON.stringify(bc).slice(0, 100));
t('it covers the whole catalogue', bc.products.length > 100, `${bc.products.length}`);
// THE HEADLINE AND THE LIST COME FROM THE SAME WALK.
const recount = (st) => bc.products.filter((p) => p.state === st).length;
for (const st of ['ok', 'stale', 'no_image', 'no_gtin', 'bad_gtin']) {
  t(`the ${st} count reconciles with its rows`, bc.counts[st] === recount(st), `${bc.counts[st]} vs ${recount(st)}`);
}
t('the states partition the catalogue',
  ['ok', 'stale', 'no_image', 'no_gtin', 'bad_gtin'].reduce((s, k) => s + bc.counts[k], 0) === bc.counts.total);
t('a seeded product with a GTIN and no image reads no_image',
  bc.products.some((p) => p.state === 'no_image'));
t('nothing is stale on a fresh catalogue', bc.counts.stale === 0);

console.log('\n── GS1 prefix capacity ──');
t('prefixes are counted', bc.prefixes.length > 0, JSON.stringify(bc.prefixes).slice(0, 120));
const p1 = bc.prefixes[0];
t('each reports used + free = 100', p1.used + p1.free === 100, JSON.stringify(p1));
t('the count matches the catalogue',
  p1.used === new Set(bc.products.filter((p) => (p.gtin || '').startsWith(p1.prefix) && /^\d{12}$/.test(p.gtin || '')).map((p) => p.gtin.slice(9, 11))).size,
  `${p1.used}`);
t('the fullest prefix sorts first', bc.prefixes.every((x, i, a) => i === 0 || a[i - 1].free <= x.free));
t('"running low" is derived, not stored', typeof p1.low === 'boolean');

console.log('\n── the shelf ──');
let sh = await J(await req('/products/shelf'));
t('the slots are seeded', sh.slots.length >= 7, `${sh.slots.length}`);
t('nothing is filed yet, and it says so', sh.missing.length === sh.slots.length);
t('nothing is "due" when nothing was ever filed — that is a different problem',
  sh.due.length === 0, JSON.stringify(sh.due));
const shopify = sh.slots.find((s) => s.key === 'shopify_export');
t('the Shopify export has a monthly cadence', shopify.cadence_days === 31, `${shopify.cadence_days}`);
t('the brand guide has none — it is current until replaced',
  sh.slots.find((s) => s.key === 'brand_guide').cadence_days === null);

console.log('\n── filing something ──');
// A LINK IS A REAL ANSWER for a document that lives elsewhere; a row with
// neither a file nor an address is a note, and is refused.
let r = await post('/products/shelf/brand_guide', { title: 'Nothing attached' });
t('a slot with neither a file nor a link is refused', r.status === 400, `${r.status}`);
sh = await J(await post('/products/shelf/brand_guide', { title: 'Brand Guide v4', link_url: 'https://drive.example.com/bg' }));
const bg = sh.slots.find((s) => s.key === 'brand_guide');
t('a link files', bg.state === 'current', bg.state);
t('and is the latest', bg.latest?.title === 'Brand Guide v4');
t('the missing list shrinks', !sh.missing.includes('Brand guide'));
r = await post('/products/shelf/not_a_slot', { link_url: 'https://x.com' });
t('an unknown slot is refused', r.status === 404, `${r.status}`);

console.log('\n── out of date is measured from the DOCUMENT date ──');
// An export pulled on the 1st and filed on the 4th is a 1st export.
const old = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
sh = await J(await post('/products/shelf/shopify_export', { title: 'Products export', link_url: 'https://x/1', effective_date: old }));
const sx = sh.slots.find((s) => s.key === 'shopify_export');
t('a two-month-old monthly export reads out of date', sx.state === 'due', sx.state);
t('and the age is from the document, not the upload', sx.days_old >= 59, `${sx.days_old}`);
t('it is named in the due list', sh.due.includes('Shopify product export'));
// Filing a fresh one clears it — nothing stored, so nothing to go stale.
sh = await J(await post('/products/shelf/shopify_export', { title: 'Products export', link_url: 'https://x/2' }));
t('filing a fresh copy clears it', sh.slots.find((s) => s.key === 'shopify_export').state === 'current');
t('the history keeps both', sh.slots.find((s) => s.key === 'shopify_export').count === 2);

console.log('\n── the cadence is the plant\'s to set ──');
sh = await J(await put('/products/shelf/gs1_licence', { cadence_days: 730 }));
t('the cadence can be changed', sh.slots.find((s) => s.key === 'gs1_licence').cadence_days === 730);
sh = await J(await put('/products/shelf/gs1_licence', { cadence_days: null }));
t('and cleared to "until replaced"', sh.slots.find((s) => s.key === 'gs1_licence').cadence_days === null);

console.log('\n── history and permission ──');
const docs = await J(await req('/products/shelf/shopify_export/documents'));
t('the history lists both, newest first', docs.documents.length === 2);
t('THE INDEXED TEXT IS NEVER SHIPPED', docs.documents.every((d) => d.extracted_text === undefined));
t('a link entry says it has no file', docs.documents.every((d) => d.has_file === false));

{
  const db = new Database(process.env.DBPATH);
  // GRANTED THE MODULE, deliberately. An account with no module map is refused
  // at the mount whatever it asks for, which would prove nothing about this
  // router; the rule worth testing is the one INSIDE it — reading is open to
  // the module, filing is canManage.
  db.prepare(`UPDATE users SET password_hash = NULL, setup_code = 'SC-PT2',
    setup_code_expires_at = datetime('now','+7 day'), module_access = ?
    WHERE id = 'pt-oper'`).run(JSON.stringify({ products: 'view' }));
  db.close();
}
await post('/users/set-password', { user_id: 'pt-oper', password: 'TabOper2026', setup_code: 'SC-PT2' });
const admin = token;
token = (await J(await post('/users/login', { name: 'Tab Operator', password: 'TabOper2026' })))?.token;
t('reading the shelf is open — anyone proofing artwork needs the brand guide',
  (await req('/products/shelf')).status === 200);
r = await post('/products/shelf/brand_guide', { link_url: 'https://x.com' });
t('but an operator cannot file into it', r.status === 403, `${r.status}`);
r = await put('/products/shelf/brand_guide', { cadence_days: 1 });
t('nor change a cadence', r.status === 403, `${r.status}`);
token = admin;

console.log('\n── a stale barcode image surfaces on the board ──');
const all = (await J(await req('/products'))).products;
const withGtin = all.find((p) => p.gtin && p.gtin_valid);
{
  // The state the board exists to catch: an image on file that encodes a
  // number the product no longer carries. Written directly, because uploading
  // needs R2 and the board's job is to READ this.
  const db = new Database(process.env.DBPATH);
  db.prepare(`UPDATE products SET barcode_key = 'x/y.png', barcode_filename = 'old.png',
    barcode_gtin = '000000000000', barcode_uploaded_at = datetime('now') WHERE sku = ?`).run(withGtin.sku);
  db.close();
}
bc = await J(await req('/products/barcodes'));
const row = bc.products.find((p) => p.sku === withGtin.sku);
t('it reads as stale', row.state === 'stale', row.state);
t('and names BOTH numbers, so it can be acted on',
  row.barcode_gtin === '000000000000' && row.gtin === withGtin.gtin);
t('the headline count moved with it', bc.counts.stale === 1, `${bc.counts.stale}`);
t('and still reconciles', bc.counts.stale === bc.products.filter((p) => p.state === 'stale').length);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
