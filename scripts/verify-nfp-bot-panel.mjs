#!/usr/bin/env node
// verify:nfpbotpanel — the Product Manager bot's panel work (D-171).
//
// Live against a fresh server with the S3 stand-in (verify-all sets PORT,
// DBPATH and R2_*). A token holding the `nfp-panel` grant files a draft,
// uploads and replaces the panel PDF, writes values with a source reference,
// reads them back, and every write is in the audit log with its source. It is
// refused (403) on an approved panel and on approval itself; a token without
// the grant keeps exactly the scope it had. The fill-weight (±5%) and calorie
// (4/4/9, ±20%) checks warn on the draft, and a warning blocks approval until a
// person acknowledges it — each one, individually, logged with who and when.
// The review diff names only the fields that changed from the approved panel.
// Then the same in a real browser at 1280.
//
// Control: take the two `nfp-panel` entries off WRITE_AREAS — the state before
// D-171 — and the first PDF upload is 403 not_open_to_tokens.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5098;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('nb-admin', 'Panel Admin', 'admin', 'qa', null);
mk('nb-pm', 'Product Manager Bot', 'supervisor', 'qa', { products: 'edit' });
mk('nb-other', 'Other Catalog Bot', 'supervisor', 'qa', { products: 'edit' });

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const pdfUpload = async (id, name, type, bytes, auth) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/nfp/${id}/panel-file`, { method: 'PUT', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'PanelCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'PanelCheck!!1' })).body?.token;
};
const PDF = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

const admin = await signIn('Panel Admin', 'nb-admin');
t('admin session', !!admin);

// A product with a known fill weight and an APPROVED panel to diff against.
const sku = db.prepare("SELECT sku FROM products WHERE status != 'discontinued' ORDER BY sku LIMIT 1").get()?.sku;
db.prepare('UPDATE products SET fill_weight_g = 710 WHERE sku = ?').run(sku);
const APPROVED = { serving_size_desc: '1 bottle (34-37g)', servings_per_container: 20, calories: 130,
  total_fat_g: 2, saturated_fat_g: 0.5, trans_fat_g: 0, cholesterol_mg: 10, dietary_fiber_g: 0, total_sugars_g: 1, added_sugars_g: 0,
  total_carbohydrate_g: 3, protein_g: 25, sodium_mg: 200, ingredients: 'Whey protein isolate, cocoa.',
  allergen_statement: 'Contains milk.' };
let r = await json('POST', '/nfp', { sku, version: 'NB-V1', source: 'paper', approved_by: 'Maria Servin', approved_at: '2026-09-01' }, admin);
const v1 = r.body?.id;
db.prepare('UPDATE nfp_versions SET panel_json = ? WHERE id = ?').run(JSON.stringify(APPROVED), v1);
t('fixture: a product at 710 g fill with an approved panel', r.status === 201 && r.body?.status === 'approved', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

const mint = async (uid, label, scopes) => (await json('POST', '/api-tokens', { user_id: uid, label, scopes }, admin)).body;
const pm = await mint('nb-pm', 'Product Manager bot', ['read', 'write']);
const other = await mint('nb-other', 'Catalog writer', ['read', 'write']);
r = await json('POST', `/api-tokens/${pm.token.id}/grants`, { grants: ['nfp-panel'] }, admin);
t('the PM token holds the nfp-panel grant', r.status === 200 && r.body?.grants?.includes('nfp-panel'), JSON.stringify(r.body).slice(0, 160));
t('the other token holds no grant', !(other.token.grants || []).length);
r = await json('POST', `/api-tokens/${other.token.id}/grants`, { grants: ['approve'] }, admin);
t('an unknown grant is refused by name', r.status === 400 && /not a grant/.test(r.body?.error || ''), JSON.stringify(r.body));
const PM = pm.plaintext, OTHER = other.plaintext;

console.log('\n── the PM token: draft, PDF, values with source ──');
r = await json('POST', '/nfp', { sku, version: 'NB-V2' }, PM);
const v2 = r.body?.id;
t('PM token creates a draft (201, draft)', r.status === 201 && r.body?.status === 'draft', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await pdfUpload(v2, 'panel-a.pdf', 'application/pdf', PDF('a'), PM);
t('PM token uploads the panel PDF (200)', r.status === 200 && r.body?.files?.some(f => f.filename === 'panel-a.pdf' && f.kind === 'panel'), `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await pdfUpload(v2, 'panel-b.pdf', 'application/pdf', PDF('b'), PM);
const panelFiles = (r.body?.files || []).filter(f => f.kind === 'panel');
t('…and REPLACES it: one panel file, the new one', r.status === 200 && panelFiles.length === 1 && panelFiles[0].filename === 'panel-b.pdf', JSON.stringify(panelFiles));
r = await pdfUpload(v2, 'panel.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex'), PM);
t('a non-PDF is refused (415)', r.status === 415, `${r.status} ${JSON.stringify(r.body)}`);
r = await pdfUpload(v2, 'fake.pdf', 'application/pdf', Buffer.from('<html>not a pdf</html>'), PM);
t('a .pdf whose bytes are not a PDF is refused (415)', r.status === 415, String(r.status));
r = await pdfUpload(v2, 'huge.pdf', 'application/pdf', Buffer.concat([PDF('big'), Buffer.alloc(25 * 1024 * 1024 + 10)]), PM);
t('over 25 MB is refused (413)', r.status === 413, `${r.status} ${JSON.stringify(r.body)}`);

// Every required value (D-173): approval is refused on a panel missing one.
const VALUES = { serving_size: '1 bottle (34-37g)', servings_per_container: 20, calories: 130, total_fat: 2,
  saturated_fat: 0.5, trans_fat: 0, cholesterol: 10, dietary_fiber: 0, total_sugars: 1, added_sugars: 0,
  total_carbohydrate: 3, protein: 25, sodium: 210, ingredients: 'Whey protein isolate, cocoa.', allergen_statement: 'Contains milk.' };
const sku2 = db.prepare("SELECT sku FROM products WHERE status != 'discontinued' AND sku != ? ORDER BY sku LIMIT 1").get(sku)?.sku;
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: VALUES }, PM);
t('a values write with no source is refused (400 source_ref_required)', r.status === 400 && r.body?.error === 'source_ref_required', JSON.stringify(r.body));
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: { colour: 'red' }, source_ref: 'x.pdf' }, PM);
t('an unknown field is refused by name (400)', r.status === 400 && /colour/.test(r.body?.message || ''), JSON.stringify(r.body));
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: VALUES, source_ref: 'WHY-BTL-BLM_NFP_v2.pdf' }, PM);
t('PM token writes values with a source (200)', r.status === 200 && r.body?.source_ref === 'WHY-BTL-BLM_NFP_v2.pdf', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
r = await json('GET', `/nfp/${v2}/panel-values`, null, PM);
t('GET returns the values as written', r.status === 200 && r.body?.values?.serving_size === '1 bottle (34-37g)'
  && r.body?.values?.servings_per_container === 20 && r.body?.values?.sodium === 210 && r.body?.values?.protein === 25, JSON.stringify(r.body?.values));
t('…with the source reference stored on the version', r.body?.source_ref === 'WHY-BTL-BLM_NFP_v2.pdf'
  && db.prepare('SELECT panel_source_ref FROM nfp_versions WHERE id = ?').get(v2)?.panel_source_ref === 'WHY-BTL-BLM_NFP_v2.pdf');
t('…and both checks pass on a consistent panel', r.body?.reconcile?.every(c => c.status === 'ok'), JSON.stringify(r.body?.reconcile));
t('the diff names ONLY the changed field (sodium 200 → 210)', r.body?.diff_vs_approved?.approved_version === 'NB-V1'
  && JSON.stringify(r.body.diff_vs_approved.changes.map(c => c.field)) === '["sodium"]'
  && r.body.diff_vs_approved.changes[0].approved === 200 && r.body.diff_vs_approved.changes[0].draft === 210, JSON.stringify(r.body?.diff_vs_approved));

// nfp_panel_values_updated is stored under the canonical verb `update`.
const audits = db.prepare(`SELECT actor, details, previous_state, new_state FROM audit_log
  WHERE entity_type = 'nfp' AND entity_id = ? AND details LIKE '%"via":"panel-values"%'`).all(v2);
const a = audits.map(x => JSON.parse(x.details || '{}'));
t('the audit log has the write, as the bot, via its token', audits.length === 1 && audits[0].actor === 'Product Manager Bot' && a[0].via_token?.id === pm.token.id, String(JSON.stringify(audits[0])).slice(0, 200));
t('…with the source reference, the fields changed and old/new values', a[0].source_ref === 'WHY-BTL-BLM_NFP_v2.pdf'
  && a[0].changes?.some(c => c.field === 'sodium' && c.from === null && c.to === 210));
const fileAudit = db.prepare("SELECT details FROM audit_log WHERE action = 'nfp_panel_file_replaced' AND entity_id = ?").get(v2);
t('…and the PDF replacement, naming the file it replaced', !!fileAudit && JSON.parse(fileAudit.details).replaced?.includes('panel-a.pdf'));

r = await json('PUT', `/nfp/${v2}/panel-values`, { values: { serving_size: '1 bottle' }, source_ref: 'x.pdf' }, PM);
t('a serving size that drops its grams is refused (400 serving_size_grams)', r.status === 400 && r.body?.error === 'serving_size_grams' && /34-37g/.test(r.body?.message || ''), JSON.stringify(r.body));

console.log('\n── other tokens unchanged ──');
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: { sodium: 1 }, source_ref: 'x' }, OTHER);
t('a token without the grant cannot write values (403 token_denied)', r.status === 403 && r.body?.error === 'token_denied', JSON.stringify(r.body));
r = await pdfUpload(v2, 'x.pdf', 'application/pdf', PDF('x'), OTHER);
t('…nor upload the PDF (403)', r.status === 403, String(r.status));
r = await json('PUT', `/nfp/${v2}/panel`, { panel: { net_weight_g: 710 } }, OTHER);
t('…and keeps exactly the scope it had: PUT /nfp/:id/panel on a draft still works', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
r = await json('POST', '/nfp', { sku, version: 'NB-OTHER' }, OTHER);
t('ONE OPEN DRAFT PER SKU: a second draft on a SKU with one open is 409 open_draft_exists, naming it (D-173)',
  r.status === 409 && r.body?.error === 'open_draft_exists' && r.body?.open_draft?.version === 'NB-V2', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await json('POST', '/nfp', { sku: sku2, version: 'NB-OTHER' }, OTHER);
t('…and POST /nfp still works on a SKU with nothing open', r.status === 201, String(r.status));

console.log('\n── the fill-weight warning blocks approval until a person acknowledges it ──');
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: { servings_per_container: 30 }, source_ref: 'WHY-BTL-BLM_NFP_v2b.pdf' }, PM);
const fw = r.body?.reconcile?.find(c => c.key === 'fill_weight');
t('35.5 g × 30 = 1065 g against 710 g is a WARNING on the draft', fw?.status === 'warn' && /1065 g/.test(fw?.message || ''), JSON.stringify(fw));
t('…listed as unresolved', r.body?.reconcile_unresolved?.some(c => c.key === 'fill_weight'));
await json('PUT', `/nfp/${v2}/provenance`, { formula_ref: 'F-1', formula_version: 'v1', bom_fill_weight_g: 710 }, admin);
r = await json('POST', `/nfp/${v2}/decide`, { decision: 'approved' }, admin);
t('a person cannot approve it while the warning is unacknowledged (409)', r.status === 409 && r.body?.needs_reconcile_ack?.[0]?.key === 'fill_weight', JSON.stringify(r.body).slice(0, 200));
r = await json('POST', `/nfp/${v2}/send`, { sent_to: 'Matt' }, admin);
t('…nor send it out on a link (409)', r.status === 409 && !!r.body?.needs_reconcile_ack, String(r.status));
r = await json('POST', `/nfp/${v2}/decide`, { decision: 'approved' }, PM);
t('PM token: approve → 403', r.status === 403 && r.body?.error === 'approve_requires_human_session', JSON.stringify(r.body));
r = await json('POST', `/nfp/${v2}/warnings/fill_weight/acknowledge`, {}, PM);
t('PM token: acknowledge → 403 (a person only)', r.status === 403, JSON.stringify(r.body));
r = await json('POST', `/nfp/${v2}/warnings/fill_weight/acknowledge`, {}, admin);
t('a person acknowledges the warning (201)', r.status === 201 && r.body?.acknowledgement?.acknowledged_by === 'Panel Admin', JSON.stringify(r.body).slice(0, 160));
const ackAudit = db.prepare("SELECT actor, details FROM audit_log WHERE action = 'nfp_warning_acknowledged' AND entity_id = ?").get(v2);
t('…logged with the user and the time', ackAudit?.actor === 'Panel Admin' && !!JSON.parse(ackAudit.details).at && JSON.parse(ackAudit.details).check === 'fill_weight');
r = await json('POST', `/nfp/${v2}/decide`, { decision: 'approved' }, admin);
t('now it can be approved', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

console.log('\n── the approved version is closed to the bot ──');
r = await json('PUT', `/nfp/${v2}/panel-values`, { values: { sodium: 5 }, source_ref: 'x.pdf' }, PM);
t('PM token: write values to an APPROVED version → 403', r.status === 403 && r.body?.error === 'not_draft', JSON.stringify(r.body));
r = await pdfUpload(v2, 'late.pdf', 'application/pdf', PDF('late'), PM);
t('PM token: upload a PDF to an APPROVED version → 403', r.status === 403 && r.body?.error === 'not_draft', JSON.stringify(r.body));
t('…and nothing on it moved', JSON.parse(db.prepare('SELECT panel_json FROM nfp_versions WHERE id = ?').get(v2).panel_json).sodium_mg === 210);

console.log('\n── the calorie check, one warning at a time ──');
r = await json('POST', '/nfp', { sku, version: 'NB-V3' }, PM);
const v3 = r.body?.id;
r = await json('PUT', `/nfp/${v3}/panel-values`, { values: { ...VALUES, servings_per_container: 30, calories: 300 }, source_ref: 'NB-V3.pdf' }, PM);
const cal = r.body?.reconcile?.find(c => c.key === 'calories');
t('4×3 + 4×25 + 9×2 = 130 against 300 declared is a WARNING', cal?.status === 'warn' && /130 kcal/.test(cal?.message || ''), JSON.stringify(cal));
t('…and the fill-weight warning is there too (two unresolved)', r.body?.reconcile_unresolved?.length === 2);
t('the diff against the approved NB-V2 names only calories', JSON.stringify(r.body?.diff_vs_approved?.changes?.map(c => c.field)) === '["calories"]'
  && r.body?.diff_vs_approved?.approved_version === 'NB-V2', JSON.stringify(r.body?.diff_vs_approved));
await json('PUT', `/nfp/${v3}/provenance`, { formula_ref: 'F-1', formula_version: 'v1', bom_fill_weight_g: 710 }, admin);
await json('POST', `/nfp/${v3}/warnings/calories/acknowledge`, {}, admin);
r = await json('POST', `/nfp/${v3}/decide`, { decision: 'approved' }, admin);
t('acknowledging ONE warning does not clear the other (still 409, fill weight named)', r.status === 409
  && r.body?.needs_reconcile_ack?.length === 1 && r.body.needs_reconcile_ack[0].key === 'fill_weight', JSON.stringify(r.body).slice(0, 200));
r = await json('PUT', `/nfp/${v3}/panel-values`, { values: { calories: 320 }, source_ref: 'NB-V3b.pdf' }, PM);
t('changing the calories raises the calorie warning again (the acknowledgement was of 300)', r.body?.reconcile_unresolved?.some(c => c.key === 'calories'), JSON.stringify(r.body?.reconcile_unresolved?.map(c => c.key)));

console.log('\n── in a browser at 1280 ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${BASE}/manifest.webmanifest`);
await page.evaluate(([tok]) => {
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('auth_user', JSON.stringify({ id: 'nb-admin', name: 'Panel Admin', role: 'admin', department: 'qa' }));
}, [admin]);
await page.goto(`${BASE}/?tab=products`);
await page.waitForTimeout(3000);
await page.getByRole('tab', { name: /Nutrition panels/ }).first().click();
await page.waitForTimeout(1200);
const row = page.locator(`button:has(code:text-is("${sku}"))`).first();
await row.scrollIntoViewIfNeeded().catch(() => {});
await row.click().catch(() => {});
await page.waitForTimeout(2000);
const card = page.locator('[data-nfp-version="NB-V3"]').first();
const review = card.locator('[data-nfp-review]').first();
const shown = await review.count() > 0;
t('the draft card shows the review block', shown);
if (shown) {
  const text = await review.innerText();
  t('…naming the source of the values', /NB-V3b\.pdf/.test(text), text.slice(0, 200));
  t('…the two warnings, each with its own Acknowledge', await card.locator('[data-nfp-ack="calories"]').count() > 0 && await card.locator('[data-nfp-ack="fill_weight"]').count() > 0);
  t('…an acknowledgement of the old calorie figure does not count for the new one', await card.locator('[data-nfp-acked="calories"]').count() === 0
    && /cannot be approved/.test(text));
  t('…and a diff that lists only calories', await card.locator('[data-nfp-diff-row]').count() === 1 && await card.locator('[data-nfp-diff-row="calories"]').count() === 1);
  await card.locator('[data-nfp-ack="fill_weight"]').first().click();
  await page.waitForTimeout(1500);
  t('clicking Acknowledge records it on the card', await card.locator('[data-nfp-acked="fill_weight"]').count() > 0
    && /Acknowledged by Panel Admin/.test(await card.locator('[data-nfp-check="fill_weight"]').first().innerText()));
  t('…and the calorie warning still waits for its own', await card.locator('[data-nfp-ack="calories"]').count() > 0);
}
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
