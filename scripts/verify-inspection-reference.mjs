// verify:inspectionref — D-348, live on a fresh database with the S3 stand-in.
//
// FORM 418-01 V2 gains a BOTTLE section (the empty bottles themselves), and an
// open sheet shows the product's specification and artwork beside it, so QA no
// longer runs the inspection with Artwork in one window and Receiving in another.
//
// The control is main before this change: the served V2 has no bottle kind, and
// GET /film-inspection/:id/reference does not exist — it fails at the first
// assertion of each half.
//
// Caller sets PORT + DBPATH (fresh database), the R2_* stand-in env, and has
// built the client.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5217;
const DBP = process.env.DBPATH;
const URL = `http://localhost:${PORT}`;
const S3 = process.env.R2_ENDPOINT;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];
const w = (fn) => { const d = new Database(DBP); try { return fn(d); } finally { d.close(); } };

w(d => {
  const add = d.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`);
  add.run('ir-dc', 'Dana Docs', 'Dana Docs', 'supervisor', 'document_control', 'SC-ir-dc', null);
  add.run('ir-qa', 'Quill Bottle', 'Quill Bottle', 'supervisor', 'qa', 'SC-ir-qa', '{"qa-inspections":"edit","receiving-log":"view"}');
  add.run('ir-wh', 'Wes House', 'Wes House', 'operator', 'warehouse', 'SC-ir-wh', '{"receiving-log":"edit"}');
});
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: pw })).json?.token;
};
const DC = await signIn('ir-dc', 'Dana Docs', 'DanaDocs2026!!');
const QA = await signIn('ir-qa', 'Quill Bottle', 'QuillBottle2026!!');
const WH = await signIn('ir-wh', 'Wes House', 'WesHouse2026!!');
t('signed in (Document Control, QA, warehouse)', !!DC && !!QA && !!WH);

console.log('\n── the bottle section ──');
const def = one("SELECT * FROM controlled_definitions WHERE key = 'film:FORM 418-01'");
t('V2 (with the bottle section) waits for Document Control; V1 stays in force',
  def?.status === 'pending' && JSON.parse(def.pending_snapshot).sections.some(s => s.key === 'bottle')
  && !JSON.parse(def.approved_snapshot).sections.some(s => s.key === 'bottle'));
let r = await call('POST', `/controlled/${def.id}/approve`, {}, DC);
t('Document Control approves V2', r.status === 200, `${r.status} ${r.json?.error || ''}`);
r = await call('GET', '/film-inspection/form', null, QA);
const form = r.json;
const bottle = form?.sections?.find(s => s.key === 'bottle');
t('the served form offers "Bottles" as what a sheet inspects', form?.kinds?.some(k => k.key === 'bottle' && k.label === 'Bottles'));
t('…with a BOTTLE section that checks size, neck, closure and what is inside',
  ['bottle_height_correct', 'bottle_diameter_correct', 'bottle_capacity_correct', 'bottle_neck_correct', 'bottle_closure_fit', 'bottle_foreign_inside', 'bottle_cracks']
    .every(k => bottle?.items?.some(i => i.key === k)), JSON.stringify(bottle?.items?.map(i => i.key)));
t('…and four bottle measurements in the header, bottles only',
  ['bottle_height', 'bottle_diameter', 'bottle_capacity', 'bottle_neck'].every(k => form.header.find(h => h.key === k)?.kinds?.join() === 'bottle'));

r = await call('POST', '/film-inspection', { inspection_no: 'A-100-0950', flavor: 'Blueberry Muffin' }, QA);
const sheet = r.json;
t('a sheet is started (stamped V2)', r.status === 201 && sheet?.checklist_revision === 'V2');
r = await call('POST', '/film-inspection', { id: sheet.id, material_kind: 'bottle', bottle_height: '190', bottle_diameter: '70', bottle_capacity: '500', bottle_neck: '38-400' }, QA);
t('marked as bottles, with the measurements kept as values', r.status === 200 && r.json?.material_kind === 'bottle' && r.json?.bottle_neck === '38-400' && r.json?.bottle_capacity === '500');
t('…it asks the bottle lines only', r.json?.total === bottle.items.length && r.json?.unanswered?.every(u => u.section === 'BOTTLE Inspection'), `${r.json?.total} vs ${bottle.items.length}`);

console.log('\n── the product a sheet is for ──');
// A bottle product with a spec, colours, released artwork (preview + print PDF in
// the stand-in) and an approved panel — and a stick product to rank below it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const put = (key, body, type) => fetch(`${S3}/test/${key}`, { method: 'PUT', headers: { 'Content-Type': type }, body });
t('the stand-in holds the artwork files', S3 && (await put('artwork/ir/preview.png', PNG, 'image/png')).ok && (await put('artwork/ir/print.pdf', PDF, 'application/pdf')).ok);
w(d => {
  d.prepare(`INSERT OR REPLACE INTO packaging_specs (spec_id, name, format, material_structure, vendor, notes)
    VALUES ('SPEC-IR-BTL', 'Test bottle 500 mL', 'bottle', 'HDPE', 'Bottle Co', 'Height 190 mm, OD 70 mm, 38-400 neck')`).run();
  d.prepare(`INSERT OR REPLACE INTO products (sku, gtin, gtin_valid, category, pack, flavor, base_flavor, status, spec_id, fill_weight_g)
    VALUES ('WHY-BTL-IRT', '850046726991', 0, 'Whey Protein', 'BTL', 'Blueberry Muffin', 'Blueberry Muffin', 'active', 'SPEC-IR-BTL', 30)`).run();
  d.prepare(`INSERT OR REPLACE INTO products (sku, category, pack, flavor, base_flavor, status)
    VALUES ('WHY-STK-IRT', 'Whey Protein', 'STK', 'Blueberry Muffin', 'Blueberry Muffin', 'active')`).run();
  d.prepare("INSERT OR REPLACE INTO product_colors (id, sku, slot, pms, hex, pms_valid, hex_valid) VALUES ('irc1','WHY-BTL-IRT',1,'PMS 2728 C','HEX 0047BB',1,1)").run();
  d.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status, nfp_version, effective_date, approved_by)
    VALUES ('ir-av1','WHY-BTL-IRT','primary',1,'superseded','V1','2026-10-01','Q')`).run();
  d.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status, nfp_version, effective_date, approved_by)
    VALUES ('ir-av2','WHY-BTL-IRT','primary',2,'print_ready','V2','2026-11-01','Q')`).run();
  d.prepare(`INSERT INTO artwork_versions (id, sku, component, version, status) VALUES ('ir-av3','WHY-BTL-IRT','primary',3,'draft')`).run();
  d.prepare("INSERT INTO artwork_files (id, version_id, kind, filename, content_type, storage_key) VALUES ('ir-f1','ir-av2','preview','preview.png','image/png','artwork/ir/preview.png')").run();
  d.prepare("INSERT INTO artwork_files (id, version_id, kind, filename, content_type, storage_key) VALUES ('ir-f2','ir-av2','print_pdf','print.pdf','application/pdf','artwork/ir/print.pdf')").run();
  d.prepare(`INSERT INTO nfp_versions (id, sku, version, status, source, serving_size, approved_at)
    VALUES ('ir-n1','WHY-BTL-IRT','V2','approved','paper','1 scoop (30g)','2026-10-20')`).run();
});

r = await call('GET', '/film-inspection/products?q=Blueberry&kind=bottle', null, QA);
t('the product search ranks the bottle above the stick for a bottle sheet',
  r.status === 200 && r.json?.[0]?.sku === 'WHY-BTL-IRT' && r.json.some(p => p.sku === 'WHY-STK-IRT' && p.fits_kind === false), JSON.stringify(r.json?.slice(0, 3)));
r = await call('POST', '/film-inspection', { id: sheet.id, sku: 'NOPE-123' }, QA);
t('a SKU that is not in the catalog is refused by name', r.status === 400 && r.json?.code === 'UNKNOWN_SKU');
r = await call('POST', '/film-inspection', { id: sheet.id, sku: 'WHY-BTL-IRT' }, QA);
t('the sheet points at the product', r.status === 200 && r.json?.sku === 'WHY-BTL-IRT');

const before = {
  audit: one('SELECT COUNT(*) n FROM audit_log').n,
  prod: JSON.stringify(q("SELECT * FROM products WHERE sku = 'WHY-BTL-IRT'")),
  sheet: JSON.stringify(q('SELECT * FROM film_pouch_inspections WHERE id = ?', sheet.id)),
};
r = await call('GET', `/film-inspection/${sheet.id}/reference`, null, QA);
const ref = r.json;
t('the reference names the product', r.status === 200 && ref?.product?.sku === 'WHY-BTL-IRT' && /Blueberry Muffin/.test(ref.product.label));
t('…its packaging spec', ref?.spec?.spec_id === 'SPEC-IR-BTL' && ref.spec.material_structure === 'HDPE' && /38-400/.test(ref.spec.notes));
t('…its colors', ref?.colors?.[0]?.pms === 'PMS 2728 C');
t('…the RELEASED artwork, not the newer draft or the superseded one',
  ref?.artwork?.length === 1 && ref.artwork[0].version === 2 && ref.artwork[0].released === true, JSON.stringify(ref?.artwork?.map(a => [a.version, a.status])));
t('…with its preview and print file as links', !!ref?.artwork?.[0]?.preview?.url && ref.artwork[0].files.some(f => f.kind === 'print_pdf' && f.url));
const pdfBytes = ref?.artwork?.[0]?.files?.[0]?.url ? await (await fetch(ref.artwork[0].files[0].url)).arrayBuffer().catch(() => null) : null;
t('…and the link returns the print file that was stored', pdfBytes && Buffer.from(pdfBytes).toString().startsWith('%PDF'));
t('…and the approved Nutrition Facts panel', ref?.nfp?.version === 'V2' && ref.nfp.serving_size === '1 scoop (30g)');
t('…and says when the GTIN fails its check digit', ref?.product?.gtin_valid === false);
t('reading the reference writes nothing (no audit row, product and sheet unchanged)',
  one('SELECT COUNT(*) n FROM audit_log').n === before.audit
  && JSON.stringify(q("SELECT * FROM products WHERE sku = 'WHY-BTL-IRT'")) === before.prod
  && JSON.stringify(q('SELECT * FROM film_pouch_inspections WHERE id = ?', sheet.id)) === before.sheet);
t('nothing was copied onto the inspection — only the SKU', !Object.keys(one('SELECT * FROM film_pouch_inspections WHERE id = ?', sheet.id)).some(c => /^(spec|artwork|color|gtin|nfp|barcode|fill)/i.test(c)));
r = await call('GET', `/film-inspection/${sheet.id}/reference`, null, WH);
const r2 = await call('GET', '/film-inspection/products?q=Blue', null, WH);
t('a warehouse account cannot read it (QA\'s door, not a widening of Artwork)', r.status === 403 && r2.status === 403);

console.log('\n── on the screen ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const me = (await call('GET', '/users/me', null, QA)).json;
  // Desktop: the checklist and the reference side by side.
  let page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [QA, me]);
  await page.goto(`${URL}/?tab=receiving-log&view=film&film=${sheet.id}`);
  const panel = page.locator('[data-inspection-reference="WHY-BTL-IRT"]');
  await panel.waitFor({ timeout: 20000 }).catch(() => {});
  t('1280px: the drawer opens wide with the specs and artwork beside the checklist',
    await panel.isVisible() && await page.locator('[data-inspection-drawer="wide"]').isVisible() && await page.locator('[data-film-item="bottle_foreign_inside"]').isVisible());
  t('1280px: the released artwork preview is shown', await page.locator('[data-ref-artwork="print_ready"] img').isVisible());
  await page.locator('[data-film-item="bottle_foreign_inside"] button', { hasText: 'No' }).click();
  await page.waitForTimeout(800);
  t('1280px: a question is answered with the reference still open',
    await page.locator('[data-film-item="bottle_foreign_inside"][data-answer="no"]').isVisible() && await panel.isVisible());
  await page.click('[data-ref-file="print_pdf"]');
  const viewer = page.locator('[data-file-preview]');
  await viewer.waitFor({ timeout: 8000 }).catch(() => {});
  t('1280px: the print file opens in the app, over the sheet', await viewer.isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  t('1280px: closing it lands back on the sheet with the answer still there',
    !(await viewer.isVisible().catch(() => false)) && await page.locator('[data-film-item="bottle_foreign_inside"][data-answer="no"]').isVisible());
  await page.click('[data-ref-toggle]');
  t('1280px: the reference can be hidden', !(await panel.isVisible().catch(() => false)) && await page.locator('[data-inspection-drawer="narrow"]').isVisible());
  await page.close();

  // Phone: one pane at a time, the checklist kept underneath.
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [QA, me]);
  await page.goto(`${URL}/?tab=receiving-log&view=film&film=${sheet.id}`);
  await page.locator('[data-ref-tabs]').waitFor({ timeout: 20000 }).catch(() => {});
  t('390px: Checklist and Specs & artwork are two tabs', await page.locator('[data-ref-tab="reference"]').isVisible());
  await page.click('[data-ref-tab="reference"]');
  await page.locator('[data-inspection-reference="WHY-BTL-IRT"]').waitFor({ timeout: 10000 }).catch(() => {});
  t('390px: the specs and artwork fill the screen', await page.locator('[data-inspection-reference="WHY-BTL-IRT"]').isVisible());
  await page.click('[data-ref-tab="checklist"]');
  t('390px: back on the checklist, the earlier answer is still there', await page.locator('[data-film-item="bottle_foreign_inside"][data-answer="no"]').isVisible());
  t('390px: no sideways pan', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await page.close();
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
