// verify:merch — D-302, live on a fresh database (+ a browser at 1280 and 390).
//
// Merch in Products: the ProDough Birthday Cake Hoodie (MCH-HBDC), four colours
// still being confirmed, three sizes, twelve Draft variants and no GTINs. And
// the food catalogue reads EXACTLY as it did before the hoodie existed.
//
// Caller sets PORT + DBPATH (+ PRODUCT_MASTER_TOKEN for the master.csv half).
// Needs a built client. The control is `main` before this change: there is no
// /products/merch route and the first style refuses with a 404.
import Database from 'better-sqlite3';
import { productSnapshot } from './lib/product-snapshot.mjs';

const PORT = process.env.PORT || 5182;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
const PROOF = process.env.PRODUCT_MASTER_TOKEN || null;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('mx-admin', 'Mia Merch', 'admin', 'office');
  mk('mx-bot', 'Merch Bot', 'supervisor', 'office', { products: 'edit' });
  db.close();
}
const call = async (m, p, b, tok) => {
  const headers = { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const PW = 'MerchMia2026!';
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const A = await signIn('mx-admin', 'Mia Merch');
const botSession = await signIn('mx-bot', 'Merch Bot');
t('an admin and the bot account signed in', !!A && !!botSession);
const AH = { 'Content-Type': 'application/json', Authorization: `Bearer ${A}` };

// The bottle drafts make the food catalogue look like the plant's (Drafts with no GTIN).
await call('POST', '/products/bottle-drafts', {}, A);
const before = await productSnapshot(URL, AH, { proofToken: PROOF });
t('a food baseline was taken before any merch exists', before.products > 100, `${before.products}`);

console.log('\n── the colour register: four colours, every one CONFIRMING ──');
const COLORS = [['BLU', 'Blue'], ['BLK', 'Black'], ['PNK', 'Pink'], ['BRN', 'Brown']];
for (const [code, name] of COLORS) {
  const r = await call('POST', '/products/merch/colors', { code, name, note: 'Lowry is confirming this colour.' }, A);
  t(`${code} ${name} added, confirming`, r.status === 201 && r.json?.confirming === true, `${r.status} ${JSON.stringify(r.json)}`);
}
let r = await call('POST', '/products/merch/colors', { code: 'BL', name: 'Bad' }, A);
t('a colour code that is not three letters is refused', r.status === 400);

console.log('\n── the style: its flavour must be an active register code ──');
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor_code: 'ZZQ', name: 'Nope' }, A);
t('a flavour part not in the register is refused, and nothing is minted', r.status === 400 && r.json?.code === 'FLAVOR_NOT_REGISTERED' && q("SELECT 1 FROM flavor_codes WHERE code='ZZQ'").length === 0, `${r.status} ${r.json?.error}`);
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor: 'Not A Real Flavor' }, A);
t('a flavour name not in the register is refused', r.status === 400 && /flavor register/.test(r.json?.error || ''));
const codesBefore = q('SELECT COUNT(*) n FROM flavor_codes')[0].n;
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor: 'Birthday Cake', style_code: 'MCH-HBDC', name: 'ProDough Birthday Cake Hoodie' }, A);
t('MCH-HBDC "ProDough Birthday Cake Hoodie" created from Birthday Cake (BDC)', r.status === 201 && r.json?.style_code === 'MCH-HBDC' && r.json?.flavor === 'Birthday Cake' && r.json?.flavor_code === 'BDC', `${r.status} ${JSON.stringify(r.json)}`);
t('…supplier, decorator and the rest left blank', r.json && ['supplier', 'decorator', 'fabric', 'unit_cost', 'msrp', 'blank_brand'].every((k) => r.json[k] === null));
t('…and the flavour register is untouched', q('SELECT COUNT(*) n FROM flavor_codes')[0].n === codesBefore);
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor: 'Birthday Cake', style_code: 'MCH-HXYZ' }, A);
t('a typed style code that disagrees with the flavour is refused', r.status === 400);
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor: 'Mint Chocolate' }, A);
t('a two-letter register code makes a three-character style segment (MCH-HMC)', r.status === 201 && r.json?.style_code === 'MCH-HMC', `${r.status} ${r.json?.style_code}`);

console.log('\n── the twelve variants ──');
r = await call('POST', '/products/merch/styles/MCH-HBDC/variants', { colors: ['BLU', 'BLK', 'PNK', 'BRN'], sizes: ['S', 'M', 'L'] }, A);
const WANT = ['BLU', 'BLK', 'PNK', 'BRN'].flatMap((c) => ['S', 'M', 'L'].map((s) => `MCH-HBDC-${c}-${s}`));
t('12 variants created, each with its final SKU', r.status === 201 && r.json?.created?.length === 12 && WANT.every((s) => r.json.created.includes(s)), JSON.stringify(r.json));
r = await call('POST', '/products/merch/styles/MCH-HBDC/variants', { colors: ['BLU', 'BLK', 'PNK', 'BRN'], sizes: ['S', 'M', 'L'] }, A);
t('…a second run creates nothing (idempotent)', r.status === 200 && r.json?.created?.length === 0 && r.json?.existing?.length === 12);
const rows = q("SELECT * FROM products WHERE style_code = 'MCH-HBDC' ORDER BY sku");
t('12 rows in products, all Draft, all product_type merch', rows.length === 12 && rows.every((x) => x.status === 'Draft' && x.product_type === 'merch'));
t('NO GTIN on any variant', rows.every((x) => !x.gtin));
t('base_flavor is the real flavour, flavor is the variant title', rows.every((x) => x.base_flavor === 'Birthday Cake') && rows.some((x) => x.flavor === 'Birthday Cake Hoodie - Blue / S'), rows[0]?.flavor);
t('family is the style name', rows.every((x) => x.family === 'ProDough Birthday Cake Hoodie'));
t('the four colours are flagged confirming in the register', q('SELECT * FROM merch_colors').every((c) => c.confirming === 1));
r = await call('POST', '/products/merch/styles/MCH-HBDC/variants', { colors: ['RED'], sizes: ['S'] }, A);
t('a colour not in the register is refused', r.status === 400);

console.log('\n── merch never reaches the food flows ──');
const merchSkus = new Set(WANT);
const nfpQ = (await call('GET', '/nfp/review-queue', null, A)).json;
t('not in the review queue\'s "missing panel" bucket', !(nfpQ?.missing_panel || []).some((x) => merchSkus.has(x.sku)));
const nfpL = (await call('GET', '/nfp', null, A)).json;
t('not in the panels list\'s "missing"', !(nfpL?.missing || []).some((x) => merchSkus.has(x.sku)));
const comp = (await call('GET', '/products/completeness', null, A)).json;
const compRows = comp?.rows || comp?.products || [];
const compMerch = compRows.filter((x) => merchSkus.has(x.sku));
const flat = (row) => JSON.stringify(row).toLowerCase();
t('completeness lists merch with no formula, panel, fill weight, die line or spec gap', compMerch.length === 12 && compMerch.every((x) => !/formula|fill weight|die ?line|nutrition|panel|packaging spec|eye ?mark/.test(flat(x.missing || x.gaps || x.groups || []))), JSON.stringify(compMerch[0]).slice(0, 300));
t('…and names the merch gaps instead: supplier, decorator, the colour still being confirmed', compMerch.every((x) => /supplier/i.test(flat(x)) && /decorator/i.test(flat(x)) && /confirm/i.test(flat(x))));
const hood = (await call('GET', '/products/MCH-HBDC-BLU-S', null, A)).json;
const steps = (hood?.readiness?.steps || []).map((s) => s.key);
t('merch readiness: SKU, GTIN, supplier/decorator, Shopify, ShipHero, Amazon only when listed', ['sku', 'gtin', 'supplier', 'shopify', 'shiphero'].every((k) => steps.includes(k)) && !['nfp', 'formula', 'spec', 'artwork', 'colors'].some((k) => steps.includes(k)), JSON.stringify(steps));
const gates = Object.fromEntries((hood?.stage?.gates || []).map((g) => [g.key, g.state]));
t('the formula, fill, panel, artwork and PO gates read "not applicable", never "not started"', ['formula', 'fill', 'panel', 'artwork', 'po'].every((k) => gates[k] === 'na') && hood?.stage?.stage > 0, JSON.stringify(gates));
t('the SKU gate holds on the merch rule', gates.sku === 'done');
t('the variant carries its style, colour (confirming) and size', hood?.style?.style_code === 'MCH-HBDC' && hood?.color?.confirming === true && hood?.size?.code === 'S');
t('its siblings are the other merch rows, never the Birthday Cake food products', (hood?.siblings || []).length === 11 && hood.siblings.every((s) => s.sku.startsWith('MCH-')), JSON.stringify(hood?.siblings?.slice(0, 2)));
const fc = (await call('GET', '/products/flavor-codes', null, A)).json;
t('the flavour register reports no merch collision', (fc?.needs_decision || []).length === before.flavor_codes.needs_decision);
if (PROOF) {
  const csv = await (await fetch(`${URL}/api/products/master.csv?token=${PROOF}`)).text();
  t('master.csv carries no merch row', !/MCH-/.test(csv));
}
const dh = (await call('GET', '/products/data-health', null, A)).json;
t('data health reports nothing on merch', !JSON.stringify(dh?.issues || []).includes('MCH-'));
r = await fetch(`${URL}/api/artwork/ingest?token=${PROOF || 'x'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: 'mx1', sku: 'MCH-HBDC-BLU-S', checks: [] }) });
t('artwork ingest refuses a merch SKU (or the token), never files it', r.status === 409 || r.status === 401, `${r.status}`);

console.log('\n── SKUs are built, never typed ──');
r = await call('POST', '/products', { sku: 'MCH-HBDC-BLU-XL', flavor: 'x', category: 'Merch', pack: 'Apparel' }, A);
t('POST /products refuses an MCH code', r.status === 400 && r.json?.code === 'MERCH_SKU');
r = await call('POST', '/products', { sku: 'WHY-BTL-BLM-S', flavor: 'x', category: 'Whey Protein', pack: 'BTL' }, A);
t('a four-part SKU on a food line is refused', r.status === 400);
r = await call('POST', '/products/MCH-HBDC-BLU-S/rename', { sku: 'MCH-HBDC-NVY-S' }, A);
t('the ordinary rename refuses a merch variant', r.status === 400 && r.json?.code === 'MERCH_SKU');
const food = q("SELECT sku FROM products WHERE COALESCE(product_type,'food')='food' ORDER BY sku LIMIT 1")[0].sku;
r = await call('POST', `/products/${food}/rename`, { sku: 'MCH-HBDC-RED-S' }, A);
t('a food product cannot be renamed into the MCH line', r.status === 400 && r.json?.code === 'MERCH_SKU');
r = await call('PUT', '/products/MCH-HBDC-BLU-S', { gtin: '850030869992' }, A);
t('a GTIN typed onto a merch variant is refused (it goes through assignment)', r.status === 400 && r.json?.code === 'MERCH_OWNED', `${r.status} ${r.json?.code}`);
r = await call('PUT', '/products/MCH-HBDC-BLU-S', { base_flavor: 'Vanilla' }, A);
t('…and so is its flavour', r.status === 400 && r.json?.code === 'MERCH_OWNED');

console.log('\n── recolouring rebuilds the SKU through the row move ──');
await call('POST', '/products/merch/colors', { code: 'NVY', name: 'Navy' }, A);
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLU-S/recolor', { color: 'NVY' }, A);
t('BLU-S → NVY-S, the title follows', r.status === 200 && r.json?.sku === 'MCH-HBDC-NVY-S' && r.json?.flavor === 'Birthday Cake Hoodie - Navy / S' && r.json?.color_code === 'NVY', `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t('…no legacy code recorded for a draft that never shipped', !r.json?.legacy_sku);
r = await call('POST', '/products/merch/variants/MCH-HBDC-NVY-S/recolor', { color: 'BLU' }, A);
t('and back again: the hoodie still has its twelve', r.status === 200 && q("SELECT COUNT(*) n FROM products WHERE style_code='MCH-HBDC'")[0].n === 12 && q("SELECT 1 FROM products WHERE sku='MCH-HBDC-BLU-S'").length === 1);

console.log('\n── GTINs: suggested, reserved, assigned by a person ──');
r = await call('GET', '/products/merch/gtin/suggest?prefix=123456789', null, A);
t('a prefix the catalogue does not carry is refused', r.status === 400 && r.json?.code === 'PREFIX_NOT_CARRIED');
const PREFIX = '850030869';
const takenBefore = new Set(q("SELECT gtin FROM products WHERE gtin LIKE '850030869%' OR gtin LIKE '00850030869%'").map((x) => x.gtin.replace(/^0+(?=\d{12}$)/, '')));
r = await call('GET', `/products/merch/gtin/suggest?prefix=${PREFIX}`, null, A);
const s1 = r.json?.suggestion;
t('the suggestion is a valid 12-digit number on 850030869, not on any product', r.status === 200 && /^850030869\d{3}$/.test(s1 || '') && !takenBefore.has(s1), `${r.status} ${s1}`);
// The lowest free number, compared in normalised form: pad the first one to GTIN-14 on a food row and it must move on.
{
  const db = new Database(DBP);
  const victim = db.prepare("SELECT sku FROM products WHERE (gtin IS NULL OR gtin='') AND COALESCE(product_type,'food')='food' LIMIT 1").get().sku;
  db.prepare('UPDATE products SET gtin = ? WHERE sku = ?').run(`00${s1}`, victim);
  db.close();
  const s2 = (await call('GET', `/products/merch/gtin/suggest?prefix=${PREFIX}`, null, A)).json?.suggestion;
  t('a number written padded (GTIN-14) on another row is never suggested', s2 && s2 !== s1, `${s1} → ${s2}`);
  const db2 = new Database(DBP); db2.prepare('UPDATE products SET gtin = NULL WHERE sku = ?').run(victim); db2.close();
}
r = await call('POST', '/products/merch/gtin/reserve', { gtin: s1, reserved_for: 'MCH-HBDC-BLK-S', note: 'held in the GS1 portal' }, A);
t('a person reserves the suggested number for BLK-S', r.status === 201 && r.json?.gtin === s1);
const s3 = (await call('GET', `/products/merch/gtin/suggest?prefix=${PREFIX}`, null, A)).json?.suggestion;
t('a reserved number is never suggested', s3 && s3 !== s1);
const bc = (await call('GET', '/products/barcodes', null, A)).json;
const pref = (bc?.prefixes || []).find((p) => p.prefix === PREFIX);
const prefBefore = before.prefixes.find((x) => x.startsWith(PREFIX));
t('the reservation counts against the prefix\'s capacity', pref && `${PREFIX} ${pref.used - 1}/${pref.free + 1}${''}` === prefBefore.replace(' low', ''), `${prefBefore} vs ${pref?.used}/${pref?.free}`);
r = await call('PUT', `/products/${food}`, { gtin: s1 }, A);
t('a reserved number cannot be typed onto a food product', r.status === 409 && r.json?.code === 'GTIN_RESERVED', `${r.status}`);

r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-S/gtin', { gtin: s1 }, A);
t('assignment is refused while the colour is still being confirmed', r.status === 409 && /being confirmed/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
{
  const db = new Database(DBP);
  db.prepare("INSERT INTO products (sku, category, pack, flavor, base_flavor, status, product_type, style_code) VALUES ('MCH-HBDC-BLK-XL','Merch','Apparel','x','Birthday Cake','Draft','merch','MCH-HBDC')").run();
  db.close();
}
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-XL/gtin', { gtin: s3 }, A);
t('assignment is refused with no colour or size', r.status === 409 && /no color/i.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);

r = await call('POST', '/products/merch/colors/BLK/confirm', {}, A);
t('a person confirms Black', r.status === 200 && r.json?.confirming === false && r.json?.confirmed_by === 'Mia Merch');
r = await call('PUT', '/products/merch/colors/BLK', { name: 'Jet' }, A);
t('a confirmed colour no longer changes its name', r.status === 409);

// A bot: a test token on a non-admin account (this database only).
r = await call('POST', '/api-tokens', { user_id: 'mx-bot', label: 'Merch bot', scopes: ['read', 'write'] }, A);
const bot = r.json?.plaintext;
t('the bot holds a write token (test database)', !!bot);
r = await call('GET', `/products/merch/gtin/suggest?prefix=${PREFIX}`, null, bot);
t('a bot may ask for a suggestion', r.status === 200 && !!r.json?.suggestion);
const botNum = r.json?.suggestion;
r = await call('POST', '/products/merch/gtin/reserve', { gtin: botNum, reserved_for: 'MCH-HBDC-BLK-M' }, bot);
t('a bot may reserve a number', r.status === 201, `${r.status} ${r.json?.error}`);
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-M/gtin', { gtin: botNum }, bot);
t('a bot token may NOT assign', r.status === 403, `${r.status} ${r.json?.error}`);
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-M/gtin', { gtin: botNum }, botSession);
t('…nor may the bot account signed in with a password', r.status === 403, `${r.status} ${r.json?.error}`);
r = await call('POST', '/products/merch/colors/PNK/confirm', {}, bot);
t('…nor confirm a colour', r.status === 403);
t('nothing was assigned by the bot', !q("SELECT gtin FROM products WHERE sku='MCH-HBDC-BLK-M'")[0].gtin);

// Two people confirm the same number at once: exactly one wins.
const [c1, c2] = await Promise.all([
  call('POST', '/products/merch/variants/MCH-HBDC-BLK-S/gtin', { gtin: s1 }, A),
  call('POST', '/products/merch/variants/MCH-HBDC-BLK-L/gtin', { gtin: s1 }, A),
]);
t('two concurrent confirms of one number: exactly one succeeds', [c1.status, c2.status].sort().join(',') === '200,409', `${c1.status} ${c2.status} ${c2.json?.error || c1.json?.error}`);
t('…BLK-S holds it (its own reservation was consumed)', q("SELECT gtin FROM products WHERE sku='MCH-HBDC-BLK-S'")[0].gtin === s1 && !q('SELECT 1 FROM gtin_reservations WHERE gtin = ?', s1).length);
t('…the number is on exactly one product', q('SELECT COUNT(*) n FROM products WHERE gtin = ?', s1)[0].n === 1);
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-L/gtin', { gtin: botNum }, A);
t('a number reserved for another variant cannot be assigned here', r.status === 409 && r.json?.code === 'GTIN_RESERVED');
r = await call('POST', '/products/merch/variants/MCH-HBDC-BLK-S/recolor', { color: 'BRN' }, A);
t('a variant with a GTIN keeps its colour', r.status === 409 && r.json?.code === 'HAS_GTIN');
r = await call('DELETE', `/products/merch/gtin/reservations/${q('SELECT id FROM gtin_reservations WHERE gtin = ?', botNum)[0].id}`, { reason: 'test' }, bot);
t('a bot cannot release a reservation', r.status === 403);
const held = q('SELECT id FROM gtin_reservations WHERE gtin = ?', botNum)[0].id;
r = await call('DELETE', `/products/merch/gtin/reservations/${held}`, {}, A);
t('releasing a reservation needs a reason', r.status === 400);
r = await call('DELETE', `/products/merch/gtin/reservations/${held}`, { reason: 'the bot held it for the test' }, A);
t('…and is audited when given one', r.status === 200 && q("SELECT 1 FROM audit_log WHERE action LIKE '%gtin_reservation_released%' OR entity_type='gtin_reservation'").length > 0);
{ const db = new Database(DBP); db.prepare("DELETE FROM products WHERE sku = 'MCH-HBDC-BLK-XL'").run(); db.close(); }

console.log('\n── the food catalogue reads exactly as before ──');
const after = await productSnapshot(URL, AH, { proofToken: PROOF });
// One food GTIN-14 spelling was planted and removed; the reservations moved the prefix. Compare everything else.
const strip = (s) => ({ ...s, prefixes: undefined });
for (const k of Object.keys(before)) {
  if (k === 'prefixes') continue;
  t(`food ${k} identical`, JSON.stringify(before[k]) === JSON.stringify(after[k]), `${JSON.stringify(before[k]).slice(0, 120)} → ${JSON.stringify(after[k]).slice(0, 120)}`);
}
const prefMoved = after.prefixes.filter((x, i) => x !== before.prefixes[i]);
t('the only prefix that moved is 850030869, by the one number assigned', prefMoved.length === 1 && prefMoved[0].startsWith(PREFIX), JSON.stringify(prefMoved));
void strip;

// ── Browser ────────────────────────────────────────────────────────────────
if (process.env.SKIP_BROWSER !== '1') {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const width of [1280, 390]) {
    console.log(`\n── the Products screen at ${width}px ──`);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${URL}/manifest.webmanifest`);
    page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
    await page.evaluate((tok) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify({ id: 'mx-admin', name: 'Mia Merch', role: 'admin' })); }, A);
    await page.goto(`${URL}/?tab=products&type=merch`);
    const ok = await page.waitForSelector('[data-merch-style="MCH-HBDC"]', { timeout: 20000 }).then(() => true).catch(() => false);
    t('the Merch view shows the hoodie as one style row', ok);
    if (ok) {
      const head = await page.locator('[data-merch-style="MCH-HBDC"]').first().innerText();
      t('…named, with 12 variants and the colours still being confirmed (counted as colours)', /Birthday Cake Hoodie/.test(head) && /12 variants/.test(head) && /3 colors still confirming/.test(head), head.slice(0, 200));
      await page.locator('[data-merch-toggle="MCH-HBDC"]').first().click();
      const n = await page.locator('[data-merch-variant]').count();
      t('expanding it lists the variants', n >= 12, `${n}`);
      await page.locator('[data-merch-variant="MCH-HBDC-BLU-S"]').first().click();
      const drawer = await page.waitForSelector('[data-merch-drawer]', { timeout: 10000 }).then(() => true).catch(() => false);
      t('a variant opens the merch block in the drawer', drawer);
      if (drawer) {
        const txt = await page.locator('[data-merch-drawer]').innerText();
        t('…which names the style, the colour still being confirmed and that a GTIN waits for it', /MCH-HBDC/.test(txt) && /confirm/i.test(txt) && /GTIN/.test(txt), txt.slice(0, 200));
        const food = await page.locator('[data-block="formula"], [data-block="packaging"]').count();
        t('…and no formula or packaging-spec block', food === 0, `${food}`);
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      t('no sideways scroll', !wide);
    }

    // The Merch tab: its own Pipeline and Colors views, read off /products/merch.
    const api = await page.evaluate(async (tok) => (await fetch('/api/products/merch', { headers: { Authorization: `Bearer ${tok}` } })).json(), A);
    const total = api.styles.reduce((n, s2) => n + s2.variants.length, 0);
    await page.goto(`${URL}/?tab=products&view=merch&merch=pipeline`);
    const pipe = await page.waitForSelector('[data-merch-pipeline]', { timeout: 20000 }).then(() => true).catch(() => false);
    t('the Merch tab opens its Pipeline', pipe);
    if (pipe) {
      const counts = await page.$$eval('[data-merch-step]', (els) => els.map((e) => Number(e.dataset.count)));
      t('…seven columns (six steps and "every step holds")', counts.length === 7, JSON.stringify(counts));
      t('…holding every variant exactly once', counts.reduce((a, b) => a + b, 0) === total, `${counts} vs ${total}`);
      const colorCol = await page.locator('[data-merch-step="2"]').innerText();
      t('…with variants on a confirming color waiting under "Color confirmed", saying why', /still being confirmed/.test(colorCol) || counts[0] + counts[1] > 0, colorCol.slice(0, 160));
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      t('…and no sideways scroll', !wide);
    }
    await page.locator('[data-merch-subtab="colors"]').click();
    const colors = await page.waitForSelector('[data-merch-colors-view] [data-color]', { timeout: 10000 }).then(() => true).catch(() => false);
    t('the Colors view lists the register', colors && (await page.locator('[data-merch-colors-view] [data-color]').count()) === api.colors.length);
    await page.locator('[data-merch-subtab="styles"]').click();
    const stylesNoReg = await page.waitForSelector('[data-merch-style="MCH-HBDC"]', { timeout: 10000 }).then(() => true).catch(() => false);
    t('the Styles view shows the styles without a second copy of the register', stylesNoReg && (await page.locator('[data-merch-colors]').count()) === 0);
    await page.close();
  }
  await browser.close();
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
