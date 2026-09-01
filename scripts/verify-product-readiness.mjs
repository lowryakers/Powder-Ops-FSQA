// Product readiness — executed, not asserted. Boots against a running server
// on a fresh database (PORT/DBPATH set by the caller) and drives the real
// endpoints, so the stamping that happens inside each write path is exercised
// rather than assumed.
const PORT = process.env.PORT || 4861;
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
    VALUES ('pr-admin','Cat Admin','Cat Admin','admin','qa',1,'SC-PR', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('pr-oper','Line Operator','Line Operator','operator','production',1,'SC-PR2', datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Cat Admin' });
await post('/users/set-password', { user_id: 'pr-admin', password: 'CatSecret2026', setup_code: 'SC-PR' });
token = (await J(await post('/users/login', { name: 'Cat Admin', password: 'CatSecret2026' })))?.token;
t('admin signed in', !!token);

// Unique per run: this creates a real catalogue row and the script has to be
// re-runnable against the same database.
const SKU = `WHY-TEST-${Date.now().toString(36).toUpperCase().slice(-5)}`;
const stepOf = (p, key) => p.readiness.steps.find((s) => s.key === key);

console.log('\n── the checklist a new product arrives with ──');
let p = await J(await post('/products', {
  sku: SKU, flavor: 'Readiness Test Whey Bottle', base_flavor: 'Readiness Test',
  category: 'Whey Protein', pack: 'BTL', status: 'draft',
}));
t('the product files', !!p?.sku, JSON.stringify(p).slice(0, 120));
p = (await J(await req('/products'))).products.find((x) => x.sku === SKU);
t('it arrives carrying its own punch list', p.readiness.missing.length > 0);
t('nothing is ticked that was not done', stepOf(p, 'formula').state === 'todo' && stepOf(p, 'shopify').state === 'todo');
t('the SKU step is satisfied by a real SKU', stepOf(p, 'sku').state === 'done');

console.log('\n── the three ticks ──');
p = await J(await post(`/products/${SKU}/confirm/formula`, { on: true }));
t('the formula tick sticks', stepOf(p, 'formula').state === 'done');
t('it records WHO said so', stepOf(p, 'formula').by === 'Cat Admin', `${stepOf(p, 'formula').by}`);
t('and when', !!stepOf(p, 'formula').at);
p = await J(await post(`/products/${SKU}/confirm/formula`, { on: false }));
t('un-ticking works, which a text box could not do', stepOf(p, 'formula').state === 'todo');
await post(`/products/${SKU}/confirm/formula`, { on: true });
p = await J(await post(`/products/${SKU}/confirm/shiphero`, { on: true }));
t('ShipHero ticks the same way', stepOf(p, 'shiphero').state === 'done');
let r = await post(`/products/${SKU}/confirm/artwork`, { on: true });
t('a step that is EVIDENCE cannot be ticked', r.status === 400, `${r.status}`);
r = await post(`/products/${SKU}/confirm/nfp`, { on: true });
t('nor the NFP — that comes from approving a panel', r.status === 400);

console.log('\n── permission ──');
{
  const db = new Database(process.env.DBPATH);
  db.prepare("UPDATE users SET password_hash = NULL, setup_code = 'SC-PR2', setup_code_expires_at = datetime('now','+7 day') WHERE id = 'pr-oper'").run();
  db.close();
}
await post('/users/set-password', { user_id: 'pr-oper', password: 'LineSecret2026', setup_code: 'SC-PR2' });
const admin = token;
token = (await J(await post('/users/login', { name: 'Line Operator', password: 'LineSecret2026' })))?.token;
r = await post(`/products/${SKU}/confirm/shopify`, { on: true });
t('an operator cannot confirm a step', r.status === 403, `${r.status}`);
token = admin;

console.log('\n── a change upstream flags what depended on it ──');
const all0 = (await J(await req('/products'))).products;
// Give it a GTIN and a Shopify listing, then correct the GTIN.
// Two free, check-digit-valid GTINs on a prefix the catalogue uses, found at
// run time so a second run does not collide with the first.
const cd = (b) => { let n = 0; for (let i = 0; i < b.length; i++) n += Number(b[i]) * ((b.length - i) % 2 === 1 ? 3 : 1); return (10 - n % 10) % 10; };
const used = new Set(all0.map((x) => x.gtin).filter(Boolean));
const free = [];
for (let i = 99; i >= 0 && free.length < 2; i--) {
  const body = `850046726${String(i).padStart(2, '0')}`;
  const g = body + cd(body);
  if (!used.has(g)) free.push(g);
}
t('two spare GTINs were found to test with', free.length === 2);
await put(`/products/${SKU}`, { gtin: free[0] });
p = await J(await post(`/products/${SKU}/confirm/shopify`, { on: true }));
t('Shopify confirmed against the current GTIN', stepOf(p, 'shopify').state === 'done');
t('the GTIN step is done too', stepOf(p, 'gtin').state === 'done');

p = await J(await put(`/products/${SKU}`, { gtin: free[1] }));
t('the corrected GTIN was accepted', !!p?.readiness, JSON.stringify(p));
const shopify = stepOf(p, 'shopify');
t('correcting the GTIN makes the Shopify listing stale', shopify.state === 'stale', shopify.state);
t('it says what changed', (shopify.changed_labels || []).join() === 'the GTIN', (shopify.changed_labels || []).join());
t('A STALE STEP IS COUNTED AS OUTSTANDING', p.readiness.missing.includes('Listed in Shopify'));
t('and the ready count drops with it', p.readiness.done < p.readiness.total);
t('ShipHero went stale on the same change', stepOf(p, 'shiphero').state === 'stale');
t('the formula did not — it never depended on the GTIN', stepOf(p, 'formula').state === 'done');

console.log('\n── clearing it ──');
p = await J(await put(`/products/${SKU}`, { notes: 'unrelated edit' }));
t('AN UNRELATED EDIT DOES NOT CLEAR IT', stepOf(p, 'shopify').state === 'stale');
p = await J(await post(`/products/${SKU}/confirm/shopify`, { on: true }));
t('re-confirming clears it', stepOf(p, 'shopify').state === 'done');
t('and only it — ShipHero is still waiting', stepOf(p, 'shiphero').state === 'stale');

console.log('\n── the product name reaches the panel and the film ──');
await put(`/products/${SKU}`, { flavor: 'Renamed Whey Bottle' });
p = (await J(await req('/products'))).products.find((x) => x.sku === SKU);
t('a rename cannot make an unapproved panel stale', stepOf(p, 'nfp').state === 'todo');

console.log('\n── the catalogue and the drawer agree ──');
const list = (await J(await req('/products'))).products.find((x) => x.sku === SKU);
t('the list carries the same readiness the drawer renders',
  JSON.stringify(list.readiness.steps.map((s) => [s.key, s.state]))
  === JSON.stringify(p.readiness.steps.map((s) => [s.key, s.state])));

console.log('\n── the 118 seeded rows are not lit up by the deploy ──');
// The first-sight rule, executed: nothing already true may read as stale.
const all = (await J(await req('/products'))).products;
// Rows this script left behind on an earlier run are excluded — they are
// deliberately stale, which is the mechanism working, not a false alarm.
const litUp = all.filter((x) => !x.sku.startsWith('WHY-TEST-') && (x.readiness.stale || []).length > 0);
t('NO EXISTING PRODUCT IS FLAGGED STALE', litUp.length === 0,
  litUp.slice(0, 3).map((x) => `${x.sku}: ${x.readiness.stale.join()}`).join(' | '));
t('the catalogue is intact', all.length > 100, `${all.length}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
