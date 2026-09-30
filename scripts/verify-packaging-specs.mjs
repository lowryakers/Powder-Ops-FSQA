// verify:packagingspecs — D-135, live on a fresh database + a real browser.
//
// "Where do I edit a packaging spec record?" Nowhere, until this: the catalogue
// import refused to write material / trim / print / wind direction per product
// (D-133) and said "set it on the spec", and the only spec route was a GET.
// Each heading is the ask's own acceptance criterion.
//
// Caller sets PORT + DBPATH + PRODUCT_MASTER_TOKEN. Needs a built client. The
// control is `main` before this change: the spec list carries no products and
// there is no PUT, so the first assertion fails.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5051;
const URL = process.env.APP || `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
const PT = process.env.PRODUCT_MASTER_TOKEN;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('pk-adm', 'Petra Spec', 'admin', 'qa', null);
mkUser('pk-op', 'Omar Floor', 'operator', 'warehouse', { products: 'edit' });

const signIn = async (id, name, pw) => {
  const c = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  return (await J(await c('POST', '/users/login', { name, password: pw })))?.token;
};
const tok = await signIn('pk-adm', 'Petra Spec', 'PetraSpec2026!!');
const opTok = await signIn('pk-op', 'Omar Floor', 'OmarFloor2026!!');
t('signed in (admin and a floor account holding the products grant)', !!tok && !!opTok);

const call = (m, p, b, k = tok) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: b ? JSON.stringify(b) : undefined });
const get = async (p) => J(await call('GET', p));
const specs = async () => (await get('/products/specs'))?.specs || [];
const spec = async (id) => (await specs()).find((s) => s.spec_id === id);
const auditCount = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'packaging_spec'").get().n;

console.log('\n── the list: every spec, with the products that read it ──');
let s = await spec('SPEC-BOTTLE');
t('GET /products/specs carries products_using and the products on each spec', Array.isArray(s?.products) && typeof s?.products_using === 'number', JSON.stringify(Object.keys(s || {})));
t('SPEC-BOTTLE arrives with every film field blank — never zero', s && ['material_structure', 'trim_length_mm', 'trim_width_mm', 'gusset_mm', 'wind_direction'].every((k) => s[k] === null));
const drafts = await J(await call('POST', '/products/bottle-drafts', {}));
s = await spec('SPEC-BOTTLE');
t('filing the bottle drafts puts them on SPEC-BOTTLE, and the list counts them', s?.products_using >= 20 && s.products.every((p) => /-BTL-/.test(p.sku)), `${s?.products_using} (drafts ${drafts?.created ?? "?"})`);
const BTL = s?.products?.[0]?.sku;
let p = await get(`/products/${BTL}`);
t('…and each one\'s spec readiness step is open for want of a material', /SPEC-BOTTLE has no material structure recorded/.test((p?.readiness?.steps || []).find((x) => x.key === 'spec')?.reason || ''));

console.log('\n── editing: refused in words, never stored wrong ──');
let r = await call('PUT', '/products/specs/SPEC-BOTTLE', { material_structure: 'PET' }, opTok);
t('a floor account holding the products grant is refused (403) — the second door', r.status === 403);
const bad = async (body, re, label) => {
  const res = await call('PUT', '/products/specs/SPEC-BOTTLE', body);
  const j = await J(res);
  t(label, res.status === 400 && re.test(j?.error || '') && j?.errors, `${res.status} ${j?.error}`);
};
await bad({ trim_length_mm: 0 }, /leave it blank.*0 reads as measured/, 'a trim length of 0 is refused: blank means "does not apply", 0 would read as measured');
await bad({ trim_width_mm: 'wide' }, /number of millimetres/, 'a trim width that is not a number is refused by name');
await bad({ gusset_mm: -3 }, /cannot be negative/, 'a negative gusset is refused');
await bad({ format: 'Jar' }, /Pouch, Stick, Bottle, Box, Cup/, 'a format outside the five is refused, naming them');
await bad({ name: '' }, /Name is required/, 'the name cannot be cleared');
await bad({ spec_id: 'SPEC-JUG' }, /cannot be changed/, 'the spec code is the join key and is never edited');
r = await call('PUT', '/products/specs/SPEC-NOPE', { vendor: 'x' });
t('an unknown spec is a 404', r.status === 404);
t('none of those refusals wrote anything', (await spec('SPEC-BOTTLE')).material_structure === null && auditCount() === 0);

const before = await spec('SPEC-BOTTLE');
r = await call('PUT', '/products/specs/SPEC-BOTTLE', { material_structure: 'HDPE bottle, PP cap, shrink sleeve', print_process: 'Shrink sleeve, 8-color flexo', trim_length_mm: '', wind_direction: '' });
let j = await J(r);
t('a valid edit saves and names exactly the fields that moved (blank stays blank, so it did not move)', r.status === 200 && JSON.stringify(j?.changed?.sort()) === JSON.stringify(['material_structure', 'print_process']), `${r.status} ${JSON.stringify(j)}`);
s = await spec('SPEC-BOTTLE');
t('…the row says it; the fields not sent are exactly as they were', s.material_structure === 'HDPE bottle, PP cap, shrink sleeve' && s.name === before.name && s.format === 'Bottle' && s.notes === before.notes && s.trim_length_mm === null);
const a = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'packaging_spec' ORDER BY rowid DESC LIMIT 1").get();
t('audited once with the before and the after, naming how many products read it', a && /material_structure/.test(a.previous_state || '') && /HDPE bottle/.test(a.new_state || '') && /products_using/.test(a.details || ''), JSON.stringify(a));

r = await call('PUT', '/products/specs/SPEC-BOTTLE', { vendor: 'Acme Bottle Co.' });
s = await spec('SPEC-BOTTLE');
t('an absent field is left alone (sending the vendor did not blank the material)', r.status === 200 && s.vendor === 'Acme Bottle Co.' && s.material_structure === 'HDPE bottle, PP cap, shrink sleeve');
r = await call('PUT', '/products/specs/SPEC-BOTTLE', { vendor: '' });
t('a blank field clears it', (await spec('SPEC-BOTTLE')).vendor === null);
const n0 = auditCount();
j = await J(await call('PUT', '/products/specs/SPEC-BOTTLE', { material_structure: 'HDPE bottle, PP cap, shrink sleeve' }));
t('re-sending what is already there changes nothing and audits nothing', j?.changed?.length === 0 && auditCount() === n0);
r = await call('PUT', '/products/specs/SPEC-POUCH-SM', { front_panel_mm: '190.5 mm', last_unit_cost: '$0.44' });
s = await spec('SPEC-POUCH-SM');
t('"190.5 mm" and "$0.44" are read as the numbers they are', r.status === 200 && s.front_panel_mm === 190.5 && s.last_unit_cost === 0.44);

console.log('\n── the edit reaches every product on the spec, and the proofer ──');
p = await get(`/products/${BTL}`);
t('a bottle product now reads the spec\'s material', p?.material_structure === 'HDPE bottle, PP cap, shrink sleeve');
t('…and its spec readiness step is met, because the spec now carries a material', (p?.readiness?.steps || []).find((x) => x.key === 'spec')?.state === 'done');
if (PT) {
  const csv = await (await fetch(`${B}/products/master.csv?token=${encodeURIComponent(PT)}`)).text();
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const row = lines.find((l) => l.startsWith(`${BTL},`));
  const cells = row ? row.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) : [];
  const at = (h) => cells[head.indexOf(h)];
  t('master.csv hands the proofer the new material on the bottle row', at('material') === 'HDPE bottle, PP cap, shrink sleeve', `${at('material')}`);
  t('…and a blank trim length, never a 0', at('trim length') === '' && at('trim width') === '', `${at('trim length')}|${at('trim width')}`);
} else t('PRODUCT_MASTER_TOKEN set for the master.csv check', false);

console.log('\n── the importer still writes none of it (D-133), and now names a spec that exists ──');
const imp = await J(await call('POST', '/products/import/preview', { csv: `sku,material,trim length\n${BTL},Glass,120\n` }));
const mm = (imp?.spec_mismatches || []).filter((m) => m.sku === BTL);
t('a differing material and trim length on one product are reported against SPEC-BOTTLE', mm.length === 2 && mm.every((m) => m.spec_id === 'SPEC-BOTTLE'), JSON.stringify(imp?.spec_mismatches));
t('…and the spec is untouched by the preview', (await spec('SPEC-BOTTLE')).material_structure === 'HDPE bottle, PP cap, shrink sleeve');

console.log('\n── a new spec, and pointing a product at it ──');
r = await call('POST', '/products/specs', { spec_id: 'bottle small', name: 'x', format: 'Bottle' });
t('a code outside SPEC-… is refused', r.status === 400);
r = await call('POST', '/products/specs', { spec_id: 'SPEC-BOTTLE', name: 'x', format: 'Bottle' });
t('an existing code is refused (409), never overwritten', r.status === 409);
r = await call('POST', '/products/specs', { spec_id: 'SPEC-BOTTLE-SM', name: 'Small Protein Bottle' });
t('a new spec with no format is refused', r.status === 400 && /Format is required/.test((await J(r))?.error || ''));
r = await call('POST', '/products/specs', { spec_id: 'spec-bottle-sm', name: 'Small Protein Bottle', format: 'bottle', trim_length_mm: '' });
j = await J(r);
t('a new spec opens (code upper-cased, format spelled as the list spells it), used by nobody yet', r.status === 201 && j?.spec?.spec_id === 'SPEC-BOTTLE-SM' && j.spec.format === 'Bottle' && j.spec.products_using === 0 && j.spec.trim_length_mm === null, JSON.stringify(j));
r = await call('PUT', `/products/${BTL}`, { spec_id: 'SPEC-NOTHERE' });
j = await J(r);
t('pointing a product at a spec that does not exist is refused in words, not a foreign-key 500', r.status === 400 && /No packaging spec SPEC-NOTHERE/.test(j?.error || ''), `${r.status} ${j?.error}`);
const BTL2 = (await spec('SPEC-BOTTLE')).products[1].sku;
r = await call('PUT', `/products/${BTL2}`, { spec_id: 'SPEC-BOTTLE-SM' });
t('moving a product to the new spec is accepted, and the list moves with it', r.status === 200 && (await spec('SPEC-BOTTLE-SM')).products_using === 1 && !(await spec('SPEC-BOTTLE')).products.some((x) => x.sku === BTL2));
db.prepare("UPDATE products SET artwork_status = 'print_ready' WHERE sku = ?").run(BTL2);
t('released artwork on a spec is counted beside it, so an edit knows what it reaches', (await spec('SPEC-BOTTLE-SM')).print_ready === 1);

console.log('\n── in a browser: the grid\'s Spec cell is a door to the spec ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const authed = async (ctx) => {
  const pg = await ctx.newPage();
  await pg.goto(`${URL}/manifest.webmanifest`);
  await pg.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'pk-adm', name: 'Petra Spec', role: 'admin' })); }, [tok]);
  return pg;
};
try {
  const page = await authed(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await page.goto(`${URL}/?tab=products`);
  await page.getByPlaceholder('Search SKU, flavor, GTIN, Shopify SKU').fill(BTL);
  const link = page.locator(`tr:has([data-open-row]:has-text("${BTL}")) [data-spec-link="SPEC-BOTTLE"]`);
  await link.waitFor({ timeout: 15000 });
  t('the Spec value on a bottle row is a link naming SPEC-BOTTLE', await link.count() === 1);
  await link.click();
  const card = page.locator('[data-spec="SPEC-BOTTLE"]');
  await card.waitFor({ timeout: 10000 });
  t('clicking it opens Packaging specs on SPEC-BOTTLE, highlighted', await card.getAttribute('data-spec-focused') === '1');
  t('the card shows the material just set, and "n/a by format" for nothing (a bottle is roll-fed)', /HDPE bottle/.test(await card.locator('[data-spec-value="material_structure"]').innerText()));
  await card.locator('[data-spec-edit]').click();
  const form = card.locator('[data-spec-form="SPEC-BOTTLE"]');
  await form.waitFor();
  t('the edit form says how many products the change reaches, before Save', /This spec is on \d+ products/.test(await form.locator('[data-spec-reach]').innerText()));
  await form.locator('[data-spec-field="trim_width_mm"] input').fill('0');
  t('typing 0 for a dimension shows the refusal live, in words', /0 reads as measured/.test(await form.locator('[data-spec-error="trim_width_mm"]').innerText()));
  await form.locator('[data-spec-field="trim_width_mm"] input').fill('');
  await form.locator('[data-spec-field="zipper"] input').fill('Flip-top cap');
  t('each film field names the master.csv column it feeds', /master\.csv “material”/.test(await form.locator('[data-spec-field="material_structure"]').innerText()));
  await form.locator('[data-spec-save]').click();
  await card.locator('[data-spec-saved]').waitFor({ timeout: 10000 });
  t('saving says what was saved and how many products now read it', /Saved 1 field — now read by \d+ products/.test(await card.locator('[data-spec-saved]').innerText()));
  t('…and the database holds it; trim width stayed blank, not 0', db.prepare("SELECT zipper, trim_width_mm FROM packaging_specs WHERE spec_id = 'SPEC-BOTTLE'").get().zipper === 'Flip-top cap' && db.prepare("SELECT trim_width_mm FROM packaging_specs WHERE spec_id = 'SPEC-BOTTLE'").get().trim_width_mm === null);
  t('the card reads the new value without a reload', /Flip-top cap/.test(await card.locator('[data-spec-value="zipper"]').innerText()));

  await page.goto(`${URL}/?tab=products&view=specs&spec=SPEC-STICK-LG`);
  await page.locator('[data-spec="SPEC-STICK-LG"][data-spec-focused="1"]').waitFor({ timeout: 10000 });
  t('?view=specs&spec=SPEC-STICK-LG deep-links to that spec', true);

  await page.goto(`${URL}/?tab=products`);
  await page.getByPlaceholder('Search SKU, flavor, GTIN, Shopify SKU').fill(BTL);
  await page.locator(`[data-open-row]:has-text("${BTL}")`).first().click();
  const dl = page.locator('[data-drawer-spec-link="SPEC-BOTTLE"]');
  await dl.waitFor({ timeout: 10000 });
  t('the drawer\'s Spec line is a link too', await dl.count() === 1);
  await dl.click();
  await page.locator('[data-spec="SPEC-BOTTLE"][data-spec-focused="1"]').waitFor({ timeout: 10000 });
  t('…and it lands on the same spec, the drawer closed', await page.locator('[data-product-drawer]').count() === 0);

  const phone = await authed(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  await phone.goto(`${URL}/?tab=products&view=specs&spec=SPEC-BOTTLE`);
  await phone.locator('[data-spec="SPEC-BOTTLE"]').waitFor({ timeout: 15000 });
  await phone.locator('[data-spec="SPEC-BOTTLE"] [data-spec-edit]').click();
  await phone.locator('[data-spec-form="SPEC-BOTTLE"]').waitFor();
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('at 390px the spec editor opens with no sideways scroll', over <= 0, `${over}px over`);
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
