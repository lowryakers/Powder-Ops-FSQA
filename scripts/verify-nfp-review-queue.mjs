#!/usr/bin/env node
// verify:nfpqueue — the nutrition-panel review queue and what it rests on (D-173).
//
// Live against a fresh server (verify-all sets PORT and DBPATH). Asserts:
// the serving size is two facts and grams are required; the formula/BOM
// fields on a product carry their source; the fill check uses the formula's
// per-serving fill when there is one (Apple Pie: no warning) and the pack
// standard for a pouch with no fill; one open draft per SKU; a bot marks a
// draft ready and keeps writing to it but cannot approve or send back; the
// queue groups by family, shows only changed fields, flags what blocks; bulk
// approve takes only unflagged rows and supersedes the prior panel; send back
// needs a note; the serving migration splits what it can read and leaves the
// rest flagged. Then the queue in a real browser at 1280.
//
// Control: `main` before D-173 — the first assertion (grams refused) fails,
// and the queue route is a 404.
import Database from 'better-sqlite3';
import { migrateServingSizes } from '../server/nfp-serving-migrate.js';

const PORT = process.env.PORT || 5099;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('rq-admin', 'Queue Admin', 'admin', 'qa', null);
mk('rq-pm', 'Product Manager Bot', 'supervisor', 'qa', { products: 'edit' });

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'QueueCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'QueueCheck!!1' })).body?.token;
};
const admin = await signIn('Queue Admin', 'rq-admin');
t('admin session', !!admin);
const pm = (await json('POST', '/api-tokens', { user_id: 'rq-pm', label: 'PM bot', scopes: ['read', 'write'] }, admin)).body;
await json('POST', `/api-tokens/${pm.token.id}/grants`, { grants: ['nfp-panel'] }, admin);
const PM = pm.plaintext;
t('a PM token with the nfp-panel grant', !!PM);

// Fixtures: a stick and a pouch of ONE flavor (the family), plus a pouch with no fill.
const stick = db.prepare("SELECT sku FROM products WHERE status = 'active' AND pack = 'STK' ORDER BY sku LIMIT 1").get()?.sku;
const pouch = db.prepare("SELECT sku FROM products WHERE status = 'active' AND pack = 'PLG' ORDER BY sku LIMIT 1").get()?.sku;
const pouch2 = db.prepare("SELECT sku FROM products WHERE status = 'active' AND pack = 'PLG' AND sku != ? ORDER BY sku LIMIT 1").get(pouch)?.sku;
db.prepare("UPDATE products SET family = 'ProDough Apple Pie Whey', fill_weight_g = 34.8 WHERE sku = ?").run(stick);
db.prepare("UPDATE products SET family = 'ProDough Apple Pie Whey', fill_weight_g = 660 WHERE sku = ?").run(pouch);
db.prepare("UPDATE products SET family = NULL, fill_weight_g = NULL WHERE sku = ?").run(pouch2);
t('fixtures: a stick and a pouch in one family, and a pouch with no fill', !!stick && !!pouch && !!pouch2, `${stick} ${pouch} ${pouch2}`);

const FULL = { servings_per_container: 1, calories: 130, total_fat: 1.5, saturated_fat: 1, trans_fat: 0, cholesterol: 45,
  sodium: 115, total_carbohydrate: 5, dietary_fiber: 0, total_sugars: 2, added_sugars: 1, protein: 24,
  ingredients: 'Whey protein isolate, natural flavors', allergen_statement: 'Contains milk.' };
const PROV = { formula_ref: 'F-00123', formula_version: 'v2.0', bom_fill_weight_g: 34.86, source_system: 'mrpeasy' };

console.log('\n── the serving size is two facts; grams are required ──');
let r = await json('POST', '/nfp', { sku: stick, version: 'RQ-V1' }, PM);
const s1 = r.body?.id;
t('PM token files a draft on the stick', r.status === 201 && r.body?.status === 'draft', String(r.status));
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_size: '1 Scoop' }, source_ref: 'rq.pdf' }, PM);
t('A SERVING SAVED WITHOUT GRAMS IS REJECTED (400 serving_size_grams)', r.status === 400 && r.body?.error === 'serving_size_grams', `${r.status} ${JSON.stringify(r.body)}`);
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_household: '1 Scoop' }, source_ref: 'rq.pdf' }, PM);
t('…a household measure alone is rejected the same way', r.status === 400 && r.body?.error === 'serving_size_grams', String(r.status));
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_household: '1 Scoop', serving_grams: '35', ...FULL }, source_ref: 'rq.pdf' }, PM);
t('household + grams write, and the printed label is GENERATED: "1 Scoop (35g)"', r.status === 200 && r.body?.values?.serving_size === '1 Scoop (35g)'
  && r.body?.values?.serving_household === '1 Scoop' && r.body?.values?.serving_grams === '35', JSON.stringify(r.body?.values).slice(0, 200));
t('…and mirrored onto the summary', db.prepare('SELECT serving_size FROM nfp_versions WHERE id = ?').get(s1)?.serving_size === '1 Scoop (35g)');
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_grams: '34 – 37 g' }, source_ref: 'rq.pdf' }, PM);
t('a range "34 – 37 g" normalises to "34-37" and the label reads "1 Scoop (34-37g)"', r.body?.values?.serving_grams === '34-37' && r.body?.values?.serving_size === '1 Scoop (34-37g)', JSON.stringify(r.body?.values).slice(0, 120));
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_size: '1 bottle (35g)' }, source_ref: 'rq.pdf' }, PM);
t('writing the label alone is parsed back into the two halves', r.body?.values?.serving_household === '1 bottle' && r.body?.values?.serving_grams === '35', JSON.stringify(r.body?.values).slice(0, 120));
r = await json('PUT', `/nfp/${s1}/panel-values`, { values: { serving_grams: 'lots' }, source_ref: 'rq.pdf' }, PM);
t('grams that are not a number are refused', r.status === 400 && r.body?.error === 'serving_size_grams');
r = await json('PUT', `/nfp/${s1}/panel`, { panel: { serving_size_desc: '1 Scoop' } }, admin);
t('the panel editor refuses a serving with no grams too (both doors)', r.status === 400 && r.body?.error === 'serving_size_grams', `${r.status} ${JSON.stringify(r.body)}`);
r = await json('PUT', `/nfp/${s1}/panel`, { panel: { serving_household: '1 Scoop', serving_grams: '35' } }, admin);
t('…and writes the pair', r.status === 200 && r.body?.panel?.serving_size_desc === '1 Scoop (35g)', String(r.status));

console.log('\n── formula / BOM fields on the SKU carry their source ──');
r = await json('PUT', `/products/${encodeURIComponent(stick)}`, { mrp_formula_id: 'F-00123', formula_rev: 'v2.0', formula_source_system: 'mrpeasy', formula_fill_per_unit_g: 34.86, formula_synced_at: '2026-10-13' }, PM);
t('PM token records the formula pointer with its source on the product (200)', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await json('GET', `/products/${encodeURIComponent(stick)}`, null, admin);
t('…stored: source mrpeasy, 34.86 g per unit, synced 2026-10-13', r.body?.formula_source_system === 'mrpeasy' && r.body?.formula_fill_per_unit_g === 34.86 && String(r.body?.formula_synced_at).startsWith('2026-10-13'), JSON.stringify([r.body?.formula_source_system, r.body?.formula_fill_per_unit_g, r.body?.formula_synced_at]));
r = await json('PUT', `/products/${encodeURIComponent(stick)}`, { formula_source_system: 'spreadsheet' }, admin);
t('an unknown source system is refused by name', r.status === 400 && /mrpeasy, keychain/.test(r.body?.error || ''), JSON.stringify(r.body));
r = await json('PUT', `/products/${encodeURIComponent(stick)}`, { formula_fill_per_unit_g: -1 }, admin);
t('a non-positive per-unit fill is refused', r.status === 400);
r = await json('PUT', `/products/${encodeURIComponent(stick)}`, { family: 'ProDough Apple Pie Whey' }, admin);
t('family is a product field a person (or bot) can set', r.status === 200 && r.body?.family === 'ProDough Apple Pie Whey');

console.log('\n── the fill check uses the formula per-serving fill, not the rounded label ──');
r = await json('PUT', `/nfp/${s1}/provenance`, { ...PROV, fill_per_serving_g: 34.86 }, PM);
t('PM token records provenance with the formula per-serving fill (200)', r.status === 200 && r.body?.provenance?.fill_per_serving_g === 34.86, `${r.status} ${JSON.stringify(r.body?.provenance)}`);
r = await json('GET', `/nfp/${s1}/panel-values`, null, PM);
let fw = r.body?.reconcile?.find((c) => c.key === 'fill_weight');
t('APPLE PIE: 34.86 g formula fill × 1 against 34.8 g fill is OK, basis "formula" — no warning', fw?.status === 'ok' && fw?.serving_basis === 'formula' && /formula per-serving fill 34.86 g/.test(fw?.message || ''), JSON.stringify(fw));
r = await json('PUT', `/nfp/${s1}/provenance`, { fill_per_serving_g: '' }, PM);
r = await json('GET', `/nfp/${s1}/panel-values`, null, PM);
fw = r.body?.reconcile?.find((c) => c.key === 'fill_weight');
t('with no formula figure the label grams stand in and the message says so', fw?.serving_basis === 'label' && /label serving 35 g/.test(fw?.message || ''), JSON.stringify(fw));
await json('PUT', `/nfp/${s1}/provenance`, { fill_per_serving_g: 34.86 }, PM);
// A pouch with no fill recorded: the standard pouch fill stands in.
r = await json('POST', '/nfp', { sku: pouch2, version: 'RQ-P2' }, PM);
const p2 = r.body?.id;
r = await json('PUT', `/nfp/${p2}/panel-values`, { values: { serving_household: '1 scoop', serving_grams: '33', ...FULL, servings_per_container: 20 }, source_ref: 'p2.pdf' }, PM);
fw = r.body?.reconcile?.find((c) => c.key === 'fill_weight');
t('a pouch with no fill is checked against the standard 660 g, and 33 × 20 = 660 is OK', fw?.status === 'ok' && fw?.fill_basis === 'pack_standard' && fw?.fill_weight_g === 660, JSON.stringify(fw));
r = await json('PUT', `/nfp/${p2}/panel-values`, { values: { servings_per_container: 30 }, source_ref: 'p2.pdf' }, PM);
fw = r.body?.reconcile?.find((c) => c.key === 'fill_weight');
t('…and 33 × 30 = 990 is a WARNING, never a block on the write', r.status === 200 && fw?.status === 'warn', JSON.stringify(fw));
await json('PUT', `/nfp/${p2}/panel-values`, { values: { servings_per_container: 20 }, source_ref: 'p2.pdf' }, PM);

console.log('\n── one open draft per SKU ──');
r = await json('POST', '/nfp', { sku: stick, version: 'RQ-V1B' }, PM);
t('a second draft on the stick is 409 open_draft_exists naming RQ-V1', r.status === 409 && r.body?.error === 'open_draft_exists' && r.body?.open_draft?.version === 'RQ-V1', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await json('POST', '/nfp', { sku: stick, version: 'RQ-V1C' }, admin);
t('…for a person too', r.status === 409 && r.body?.error === 'open_draft_exists');
t('…and nothing was created', db.prepare("SELECT COUNT(*) n FROM nfp_versions WHERE sku = ? AND status != 'approved'").get(stick).n === 1);

console.log('\n── ready for review: a bot marks it, keeps writing, cannot approve ──');
r = await json('POST', `/nfp/${s1}/decide`, { decision: 'approved' }, admin);
t('a person approving a draft with values and provenance works as before (not yet marked ready is fine)', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…RQ-V1 is approved', db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(s1)?.status === 'approved');
// Now the next version of the stick, as the bot would file it: a change of sodium only.
r = await json('POST', '/nfp', { sku: stick, version: 'RQ-V2' }, PM);
const s2 = r.body?.id;
t('after the approval a new draft can be filed', r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
await json('PUT', `/nfp/${s2}/panel-values`, { values: { serving_household: '1 Scoop', serving_grams: '35', ...FULL, sodium: 120 }, source_ref: 'RQ-V2.pdf' }, PM);
await json('PUT', `/nfp/${s2}/provenance`, { ...PROV, fill_per_serving_g: 34.86 }, PM);
r = await json('POST', `/nfp/${s2}/ready`, {}, PM);
t('PM token marks the draft READY FOR REVIEW (200, status ready_for_review)', r.status === 200 && r.body?.status === 'ready_for_review' && r.body?.ready_by === 'Product Manager Bot', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…with no flags: values complete, provenance in, checks ok, a file would be nice', JSON.stringify((r.body?.flags || []).map((f) => f.key)) === '["no_file"]' && r.body?.review_ready === false, JSON.stringify(r.body?.flags));
await json('PUT', `/nfp/${s2}`, { drive_url: 'https://drive.example/rq-v2' }, PM);
r = await json('GET', `/nfp/sku/${encodeURIComponent(stick)}`, null, admin);
const s2h = r.body?.versions?.find((v) => v.id === s2);
t('with a Drive link the row has ZERO flags and is review_ready', s2h?.flags?.length === 0 && s2h?.review_ready === true, JSON.stringify(s2h?.flags));
r = await json('PUT', `/nfp/${s2}/panel-values`, { values: { sodium: 125 }, source_ref: 'RQ-V2b.pdf' }, PM);
t('the bot can still correct a panel that is ready for review (200)', r.status === 200 && r.body?.values?.sodium === 125, `${r.status}`);
r = await json('POST', `/nfp/${s2}/ready`, {}, PM);
t('marking it ready twice is 409 not_a_draft', r.status === 409 && r.body?.error === 'not_a_draft');
r = await json('POST', `/nfp/${s2}/decide`, { decision: 'approved' }, PM);
t('PM token: approve → 403 approve_requires_human_session', r.status === 403 && r.body?.error === 'approve_requires_human_session', JSON.stringify(r.body));
r = await json('POST', `/nfp/${s2}/send-back`, { note: 'bot tries' }, PM);
t('PM token: send back → 403', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
r = await json('POST', '/nfp/review-queue/approve', { ids: [s2] }, PM);
t('PM token: bulk approve → 403', r.status === 403, String(r.status));
t('…and the panel is still ready for review', db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(s2)?.status === 'ready_for_review');

// The pouch of the same family, ready but incomplete — a flagged row.
r = await json('POST', '/nfp', { sku: pouch, version: 'RQ-P1' }, PM);
const pp = r.body?.id;
await json('PUT', `/nfp/${pp}/panel-values`, { values: { serving_household: '1 scoop', serving_grams: '33', servings_per_container: 20, calories: 130 }, source_ref: 'RQ-P1.pdf' }, PM);
await json('PUT', `/nfp/${pp}`, { drive_url: 'https://drive.example/rq-p1' }, PM);
r = await json('POST', `/nfp/${pp}/ready`, {}, PM);
t('the pouch is marked ready with MISSING VALUES flagged', r.status === 200 && r.body?.flags?.some((f) => f.key === 'missing_values' && f.blocking) && r.body?.flags?.some((f) => f.key === 'provenance_missing'), JSON.stringify(r.body?.flags));
r = await json('POST', `/nfp/${pp}/decide`, { decision: 'approved' }, admin);
t('A VERSION CANNOT BE APPROVED WITH A REQUIRED VALUE EMPTY (409 needs_values naming them)', r.status === 409 && Array.isArray(r.body?.needs_values) && r.body.needs_values.includes('protein'), `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

console.log('\n── the queue ──');
r = await json('GET', '/nfp/review-queue', null, admin);
const q = r.body;
t('GET /nfp/review-queue answers', r.status === 200 && Array.isArray(q?.groups), String(r.status));
const fam = q?.groups?.find((g) => g.family === 'ProDough Apple Pie Whey');
t('the stick and the pouch sit together under their FAMILY', !!fam && fam.rows.length === 2 && fam.rows.map((x) => x.sku).sort().join() === [stick, pouch].sort().join(), JSON.stringify(q?.groups?.map((g) => [g.family, g.rows.length])));
const rowS = fam?.rows.find((x) => x.sku === stick);
t('the stick row shows ONLY the changed field: sodium 115 → 125 against RQ-V1', rowS?.approved_version === 'RQ-V1' && rowS?.changes?.length === 1 && rowS.changes[0].field === 'sodium' && rowS.changes[0].approved === 115 && rowS.changes[0].draft === 125, JSON.stringify(rowS?.changes));
t('…with the source of its values and the formula with its source', rowS?.source_ref === 'RQ-V2b.pdf' && rowS?.provenance?.formula_ref === 'F-00123' && rowS?.provenance?.source_system === 'mrpeasy' && rowS?.provenance?.fill_per_serving_g === 34.86, JSON.stringify([rowS?.source_ref, rowS?.provenance]));
t('…and is review_ready', rowS?.review_ready === true);
const rowP = fam?.rows.find((x) => x.sku === pouch);
t('the pouch row is flagged and not review_ready', rowP?.review_ready === false && rowP?.flags?.some((f) => f.key === 'missing_values'), JSON.stringify(rowP?.flags));
t('counts: 2 ready, 1 unflagged, 1 flagged — each .length of the rows', q?.counts?.ready === 2 && q?.counts?.unflagged === 1 && q?.counts?.flagged === 1, JSON.stringify(q?.counts));
t('open drafts counts the pouch-2 draft still being worked (not in the queue)', q?.counts?.open_drafts === q?.open_drafts?.length && q?.open_drafts?.some((d) => d.id === p2), JSON.stringify(q?.counts));
t('the MISSING PANEL bucket names products with no approved panel, pouch-2 among them, and not the stick', q?.counts?.missing_panel === q?.missing_panel?.length && q?.missing_panel?.some((p) => p.sku === pouch2 && p.open_status === 'draft') && !q?.missing_panel?.some((p) => p.sku === stick), String(q?.counts?.missing_panel));
t('a product with no family falls into "line · base flavor"', (q?.missing_panel?.find((p) => p.sku === pouch2)?.family_key || '').includes(' · '));

console.log('\n── bulk approve: unflagged rows only; approval supersedes ──');
r = await json('POST', '/nfp/review-queue/approve', { ids: [s2, pp] }, admin);
t('bulk approve approves the unflagged stick and SKIPS the flagged pouch, saying why', r.status === 200 && r.body?.approved?.length === 1 && r.body.approved[0].id === s2
  && r.body?.skipped?.length === 1 && r.body.skipped[0].id === pp && r.body.skipped[0].reason === 'has flags', JSON.stringify(r.body).slice(0, 300));
t('RQ-V2 is approved and RQ-V1 superseded by it', db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(s2)?.status === 'approved'
  && db.prepare('SELECT status, superseded_by FROM nfp_versions WHERE id = ?').get(s1)?.superseded_by === s2);
t('…the product mirror moved to RQ-V2', db.prepare('SELECT nfp_version FROM products WHERE sku = ?').get(stick)?.nfp_version === 'RQ-V2');
t('…and the pouch is still ready for review', db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(pp)?.status === 'ready_for_review');
// `_approved` is canonicalised to the verb `approve`; the bulk row is keyed on entity 'queue'.
const bulkAudit = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'nfp' AND entity_id = 'queue'").get();
t('the bulk act is audited with what was approved and what was skipped', !!bulkAudit && JSON.parse(bulkAudit.details).approved?.includes(s2) && JSON.parse(bulkAudit.details).skipped?.[0]?.id === pp, bulkAudit?.details?.slice(0, 160));
t('…and each approval has its own audit row', db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'nfp' AND entity_id = ? AND details LIKE '%"bulk":true%'`).get(s2).n === 1);

console.log('\n── send back ──');
r = await json('POST', `/nfp/${pp}/send-back`, {}, admin);
t('send back without a note is refused (400 note_required)', r.status === 400 && r.body?.error === 'note_required');
r = await json('POST', `/nfp/${pp}/send-back`, { note: 'Fill in the rest of the panel and the formula.' }, admin);
t('send back with a note returns the panel to DRAFT carrying the note', r.status === 200 && r.body?.status === 'draft' && r.body?.sent_back_note === 'Fill in the rest of the panel and the formula.' && r.body?.sent_back_by === 'Queue Admin', `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await json('GET', '/nfp/review-queue', null, admin);
t('…and it leaves the queue', r.body?.counts?.ready === 0 && !r.body?.groups?.length, JSON.stringify(r.body?.counts));
t('the send-back is audited with the note', !!db.prepare("SELECT 1 FROM audit_log WHERE action = 'nfp_sent_back' AND entity_id = ? AND details LIKE '%Fill in the rest%'").get(pp));
r = await json('POST', `/nfp/${pp}/ready`, {}, PM);
t('a sent-back draft can be marked ready again', r.status === 200 && r.body?.status === 'ready_for_review');

console.log('\n── the serving migration ──');
const ms = db.prepare("SELECT sku FROM products WHERE status = 'active' AND sku NOT IN (?, ?, ?) ORDER BY sku LIMIT 2").all(stick, pouch, pouch2).map((x) => x.sku);
db.prepare(`INSERT INTO nfp_versions (id, sku, version, status, panel_json) VALUES ('rq-m1', ?, 'M1', 'approved', ?)`).run(ms[0], JSON.stringify({ serving_size_desc: '1 Scoop (30g)', calories: 100 }));
db.prepare(`INSERT INTO nfp_versions (id, sku, version, status, panel_json) VALUES ('rq-m2', ?, 'M2', 'draft', ?)`).run(ms[1], JSON.stringify({ serving_size_desc: '1 bottle', calories: 100 }));
const mig = migrateServingSizes(db);
const m1 = JSON.parse(db.prepare("SELECT panel_json FROM nfp_versions WHERE id = 'rq-m1'").get().panel_json);
const m2 = JSON.parse(db.prepare("SELECT panel_json FROM nfp_versions WHERE id = 'rq-m2'").get().panel_json);
t('a readable serving is split into household + grams; the label is untouched', mig.split === 1 && m1.serving_household === '1 Scoop' && m1.serving_grams === '30' && m1.serving_size_desc === '1 Scoop (30g)', JSON.stringify(m1));
t('one with no grams is LEFT AS FILED and counted for a person', mig.unparsed === 1 && m2.serving_grams === undefined && m2.serving_size_desc === '1 bottle', JSON.stringify(m2));
r = await json('GET', `/nfp/sku/${encodeURIComponent(ms[1])}`, null, admin);
t('…and reads serving_grams_missing on the draft', r.body?.versions?.[0]?.flags?.some((f) => f.key === 'serving_grams_missing' && f.blocking), JSON.stringify(r.body?.versions?.[0]?.flags));
const again = migrateServingSizes(db);
t('running the migration again changes nothing (idempotent by construction)', again.split === 0);

console.log('\n── in a browser at 1280 ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${BASE}/manifest.webmanifest`);
await page.evaluate(([tok]) => {
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('auth_user', JSON.stringify({ id: 'rq-admin', name: 'Queue Admin', role: 'admin', department: 'qa' }));
}, [admin]);
await page.goto(`${BASE}/?tab=products&view=review`);
await page.waitForSelector('[data-nfp-queue]', { timeout: 20000 }).catch(() => {});
t('the Review queue tab opens', await page.locator('[data-nfp-queue]').count() === 1);
const grp = page.locator('[data-queue-group="ProDough Apple Pie Whey"]');
t('the family group is on screen with the pouch row flagged', await grp.count() === 1 && await grp.locator(`[data-queue-row][data-queue-sku="${pouch}"][data-queue-ready="0"]`).count() === 1);
t('…its flags are printed', await grp.locator('[data-queue-flag="missing_values"]').count() === 1);
t('…and its checkbox cannot be ticked (flagged rows are not bulk-approvable)', await grp.locator(`[data-queue-select="${pp}"]`).isDisabled());
t('the Approve button on a flagged row is disabled', await grp.locator(`[data-queue-approve="${pp}"]`).isDisabled());
t('the counts strip reads 1 ready', /1 ready for review/.test(await page.locator('[data-queue-count="ready"]').innerText()));
t('the missing-panel bucket lists pouch-2', await page.locator(`[data-queue-missing-row="${pouch2}"]`).count() === 1);
// Send it back from the queue.
await grp.locator(`[data-queue-sendback-open="${pp}"]`).click();
await grp.locator('[data-queue-sendback-note]').fill('Needs the rest of the panel');
await grp.locator('[data-queue-sendback-go]').click();
await page.waitForTimeout(1500);
t('sending back from the queue removes the row and the queue reads empty', await page.locator('[data-queue-empty]').count() === 1 && await page.locator('[data-queue-row]').count() === 0);
t('…and the draft carries the note', db.prepare('SELECT status, sent_back_note FROM nfp_versions WHERE id = ?').get(pp)?.sent_back_note === 'Needs the rest of the panel');
// Complete the pouch, mark it ready, and bulk-approve it from the screen.
await json('PUT', `/nfp/${pp}/panel-values`, { values: { serving_household: '1 scoop', serving_grams: '33', ...FULL, servings_per_container: 20 }, source_ref: 'RQ-P1b.pdf' }, PM);
await json('PUT', `/nfp/${pp}/provenance`, { ...PROV, bom_fill_weight_g: 660, fill_per_serving_g: 33 }, PM);
r = await json('POST', `/nfp/${pp}/ready`, {}, PM);
t('the completed pouch is marked ready with no flags', r.status === 200 && r.body?.review_ready === true, `${r.status} ${JSON.stringify(r.body?.flags || r.body).slice(0, 300)}`);
await page.goto(`${BASE}/?tab=products&view=review`);
await page.waitForSelector('[data-queue-bulk]', { timeout: 20000 }).catch(() => {});
t('with the pouch completed the bulk bar appears', await page.locator('[data-queue-bulk]').count() === 1);
t('…the row shows "first panel" and every value as new', await page.locator(`[data-queue-row][data-queue-sku="${pouch}"][data-queue-ready="1"]`).count() === 1 && await page.locator('[data-queue-change="sodium"]').count() === 1);
await page.locator('[data-queue-select-all]').click();
await page.locator('[data-queue-bulk-approve]').click();
await page.waitForSelector('[data-queue-bulk-result]', { timeout: 10000 }).catch(() => {});
t('bulk approve from the screen approves it', /Approved 1/.test(await page.locator('[data-queue-bulk-result]').innerText().catch(() => ''))
  && db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(pp)?.status === 'approved');
// The product drawer shows the formula source beside the numbers.
await page.goto(`${BASE}/?tab=products`);
await page.waitForTimeout(3000);
await page.locator(`[data-grid-row="${stick}"] button, [data-grid-row="${stick}"] code`).first().click().catch(() => {});
await page.waitForTimeout(1500);
const src = page.locator('[data-value="formula_source"]').first();
t('the product drawer prints the formula source beside the numbers (MRPEasy, 34.86 g per unit, synced)', await src.count() === 1 && /MRPEasy/.test(await src.innerText()) && /34\.86 g/.test(await src.innerText()), await src.innerText().catch(() => 'no source line'));
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
