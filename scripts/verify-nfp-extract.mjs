// The panel FILE is read, hashed, renamed and reconciled (D-174).
//
// Live against a fresh server with the S3 stand-in (verify-all sets PORT,
// DBPATH and the R2 variables). Asserts:
//  - uploading a PDF with a text layer fills the draft's BLANK fields with
//    source "extracted from file", stores the file as <SKU>_<version>_<date>.pdf
//    beside the designer's own name, and records its SHA-256;
//  - a value already typed is NEVER overwritten: it is a mismatch, blocking,
//    refused at every approval door, resolved by a person (never a token), and
//    the question comes back when either value moves;
//  - the file's standing against the approved panel: same file / file changed,
//    same name (extraction re-runs) / new file / values changed, file not updated;
//  - the backfill reads approved panels' files into proposals; confirming fills
//    only blanks, a disagreement is left alone, dismissing needs a note, and a
//    token is refused;
//  - a PNG is accepted and, with no AI configured, reads as `skipped`;
//  - in a browser: the mismatch is on the card with two buttons, and the queue
//    carries the proposals bucket.
//
// THE CONTROL: the code before this change has no extraction at all — the
// first assertion on `uploaded.extraction` fails and nothing after it holds.
import Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';

const PORT = process.env.PORT || 5100;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ex-admin', 'Extract Admin', 'admin', 'qa', null);
mk('ex-pm', 'Extract Bot', 'supervisor', 'qa', { products: 'edit' });

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const upload = async (id, name, type, bytes, auth) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/nfp/${id}/panel-file`, { method: 'PUT', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'ExtractCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'ExtractCheck!!1' })).body?.token;
};
const admin = await signIn('Extract Admin', 'ex-admin');
t('admin session', !!admin);
const pmTok = (await json('POST', '/api-tokens', { user_id: 'ex-pm', label: 'PM bot', scopes: ['read', 'write'] }, admin)).body;
await json('POST', `/api-tokens/${pmTok.token.id}/grants`, { grants: ['nfp-panel'] }, admin);
const PM = pmTok.plaintext;
t('a PM token with the nfp-panel grant', !!PM);

// A panel PDF with a real text layer — pdfkit, one printed line per line.
const PANEL = (over = {}) => {
  const L = { calories: 130, sodium: 210, ...over };
  return ['Nutrition Facts', 'Serving size 1 Scoop (35g)', 'Servings Per Container 20', `Calories ${L.calories}`,
    'Total Fat 2g 3%', 'Saturated Fat 0.5g 3%', 'Trans Fat 0g', 'Cholesterol 10mg 3%', `Sodium ${L.sodium}mg 9%`,
    'Total Carbohydrate 3g 1%', 'Dietary Fiber 0g 0%', 'Total Sugars 1g', 'Includes 0g Added Sugars 0%', 'Protein 25g',
    'Vitamin D 0mcg 0%', 'Calcium 150mg 10%', 'Iron 0.3mg 2%', 'Potassium 120mg 2%',
    'INGREDIENTS: Whey Protein Isolate, Cocoa, Natural Flavor.', 'CONTAINS: MILK.', 'Distributed by Powder Ops'];
};
const pdfOf = (lines) => new Promise((res) => {
  const d = new PDFDocument(); const c = [];
  d.on('data', (x) => c.push(x)); d.on('end', () => res(Buffer.concat(c)));
  d.fontSize(11); for (const l of lines) d.text(l); d.end();
});
const PDF_A = await pdfOf(PANEL());
const PDF_B = await pdfOf(PANEL({ calories: 140 }));
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);

const skus = db.prepare("SELECT sku FROM products WHERE status = 'active' AND pack = 'PLG' ORDER BY sku LIMIT 3").all().map((r) => r.sku);
const [sku, sku2, sku3] = skus;
for (const s of skus) db.prepare('UPDATE products SET fill_weight_g = 700 WHERE sku = ?').run(s);
t('fixtures: three pouches at 700 g', skus.length === 3, skus.join(' '));
const PROV = { formula_ref: 'F-00123', formula_version: 'v2.0', bom_fill_weight_g: 700, source_system: 'mrpeasy', fill_per_serving_g: 35 };
const ver = (id) => db.prepare('SELECT * FROM nfp_versions WHERE id = ?').get(id);
const hyd = async (id, auth = admin) => (await json('GET', `/nfp/sku/${encodeURIComponent(ver(id).sku)}`, null, auth)).body?.versions?.find((v) => v.id === id);

console.log('\n── upload: hash, rename, fill the blanks ──');
let r = await json('POST', '/nfp', { sku, version: 'V1', provenance: PROV }, admin);
const v1 = r.body?.id;
t('a draft', r.status === 201 && !!v1, `${r.status}`);
// A value typed BEFORE the file arrives — the one the reader must not touch.
r = await json('PUT', `/nfp/${v1}/panel`, { panel: { sodium_mg: 500 } }, admin);
t('sodium typed as 500 first', r.status === 200 && r.body?.panel?.sodium_mg === 500, JSON.stringify(r.body).slice(0, 200));
r = await upload(v1, 'Label Final.pdf', 'application/pdf', PDF_A, admin);
t('the PDF uploads and the reader ran (extraction ok)', r.status === 200 && r.body?.uploaded?.extraction === 'ok', `${r.status} ${JSON.stringify(r.body?.uploaded || r.body).slice(0, 300)}`);
t('…it filled calories and the serving grams, and NOT sodium', (r.body?.uploaded?.filled || []).includes('calories') && (r.body?.uploaded?.filled || []).includes('serving_grams') && !(r.body?.uploaded?.filled || []).includes('sodium'), JSON.stringify(r.body?.uploaded?.filled));
let h = await hyd(v1);
t('the stored name is <SKU>_V1_<date>.pdf and the designer\'s name is kept beside it',
  h.files[0]?.filename === `${sku}_V1_${new Date().toISOString().slice(0, 10)}.pdf` && h.files[0]?.original_filename === 'Label Final.pdf', JSON.stringify([h.files[0]?.filename, h.files[0]?.original_filename]));
t('…with its SHA-256', /^[0-9a-f]{64}$/.test(h.files[0]?.sha256 || ''));
t('calories 130 on the draft, source "extracted from file"', h.panel?.calories === 130 && h.panel_sources?.calories?.source === 'extracted from file', JSON.stringify([h.panel?.calories, h.panel_sources?.calories]));
t('the serving halves and the generated label', h.panel?.serving_grams === '35' && h.panel?.serving_household === '1 Scoop' && h.panel?.serving_size_desc === '1 Scoop (35g)', JSON.stringify([h.panel?.serving_grams, h.panel?.serving_household, h.panel?.serving_size_desc]));
t('sodium is STILL 500 — a typed value is never overwritten', h.panel?.sodium_mg === 500, String(h.panel?.sodium_mg));
t('every nutrient line was read (nothing unread)', h.extraction?.status === 'ok' && (h.extraction?.unread || []).length === 0, JSON.stringify(h.extraction?.unread));
t('the mismatch list names sodium: file 210, stored 500', h.extract_mismatches?.length === 1 && h.extract_mismatches[0].field === 'sodium' && h.extract_mismatches[0].file === 210 && h.extract_mismatches[0].stored === 500, JSON.stringify(h.extract_mismatches));
t('…as a BLOCKING flag', h.flags?.some((f) => f.key === 'extract_mismatch' && f.blocking) && h.review_ready === false, JSON.stringify(h.flags));
const audit = db.prepare("SELECT details FROM audit_log WHERE entity_id = ? AND details LIKE '%extracted from file%' ORDER BY rowid DESC LIMIT 1").get(v1);
t('the upload is audited with the hash, the stored name and what was filled', !!audit && /sha256/.test(audit.details) && /stored_as/.test(audit.details) && /calories/.test(audit.details), (audit?.details || '').slice(0, 200));

console.log('\n── the gate: every approval door refuses an unresolved mismatch ──');
r = await json('POST', `/nfp/${v1}/decide`, { signature_password: 'ExtractCheck!!1', decision: 'approved', by: 'Maria Servin' }, admin);
t('in-app approve is refused (409 needs_extract_resolution naming sodium)', r.status === 409 && r.body?.needs_extract_resolution?.[0]?.field === 'sodium', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
r = await json('POST', `/nfp/${v1}/ready`, {}, admin);
r = await json('POST', '/nfp/review-queue/approve', { signature_password: 'ExtractCheck!!1', ids: [v1] }, admin);
t('bulk approve skips it as flagged', r.status === 200 && r.body?.skipped?.[0]?.reason === 'has flags' && r.body?.approved?.length === 0, JSON.stringify(r.body?.skipped));
r = await json('POST', `/nfp/${v1}/mismatches/sodium/resolve`, { choice: 'stored' }, PM);
t('a TOKEN cannot resolve a mismatch (403, a decision)', r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
r = await json('POST', `/nfp/${v1}/mismatches/sodium/resolve`, { choice: 'maybe' }, admin);
t('a choice other than file / stored is refused (400)', r.status === 400 && r.body?.error === 'choice_required');
r = await json('POST', `/nfp/${v1}/mismatches/sodium/resolve`, { choice: 'stored' }, admin);
t('a person keeps the stored value: the mismatch reads resolved and the flag clears', r.status === 200 && r.body?.extract_mismatches?.[0]?.resolved?.choice === 'stored' && !r.body?.flags?.some((f) => f.key === 'extract_mismatch'), JSON.stringify(r.body?.extract_mismatches));
t('…and sodium is still 500', r.body?.panel?.sodium_mg === 500);
t('…so nothing blocks any more (the 9% read off the file against 500 mg is a %DV warning, which is right)', !r.body?.flags?.some((f) => f.blocking) && r.body?.flags?.some((f) => f.key === 'dv_mismatch'), JSON.stringify(r.body?.flags));
r = await json('POST', `/nfp/${v1}/mismatches/sodium/resolve`, { choice: 'stored' }, admin);
t('resolving an already-resolved field is 404 no_mismatch', r.status === 404 && r.body?.error === 'no_mismatch');
r = await json('PUT', `/nfp/${v1}/panel`, { panel: { sodium_mg: 600 } }, admin);
t('MOVING the stored value brings the question back (fingerprint)', r.body?.extract_mismatches?.[0]?.resolved === null && r.body?.flags?.some((f) => f.key === 'extract_mismatch'), JSON.stringify(r.body?.extract_mismatches));
r = await json('POST', `/nfp/${v1}/mismatches/sodium/resolve`, { choice: 'file' }, admin);
t('choosing the FILE writes 210 onto the draft, source extracted from file', r.status === 200 && r.body?.panel?.sodium_mg === 210 && r.body?.panel_sources?.sodium?.source === 'extracted from file' && r.body?.extract_mismatches?.length === 0, JSON.stringify([r.body?.panel?.sodium_mg, r.body?.panel_sources?.sodium]));
const resolvedAudit = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id = ? AND details LIKE '%\"choice\"%'").get(v1).c;
t('each resolution is audited', resolvedAudit === 2, String(resolvedAudit));
r = await json('POST', `/nfp/${v1}/decide`, { signature_password: 'ExtractCheck!!1', decision: 'approved', by: 'Maria Servin' }, admin);
t('with everything resolved the approval lands', r.status === 200 && ver(v1).status === 'approved', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);

console.log('\n── the file against the approved one ──');
r = await json('POST', '/nfp', { sku, version: 'V2', provenance: PROV }, admin);
const v2 = r.body?.id;
r = await upload(v2, 'Label Final.pdf', 'application/pdf', PDF_A, admin);
h = await hyd(v2);
t('the same bytes on the next draft read "same file"', h.file_status?.labels?.includes('same_file') && h.file_status?.sha256 === (await hyd(v1)).files[0]?.sha256, JSON.stringify(h.file_status));
t('…and no mismatch, since the draft was filled from it', (h.extract_mismatches || []).length === 0);
await new Promise((res) => setTimeout(res, 1100));
r = await json('PUT', `/nfp/${v2}/panel`, { panel: { sodium_mg: 215 } }, admin);
t('a value moved after the upload reads "values changed, file not updated" (a non-blocking flag)', r.body?.file_status?.labels?.includes('values_changed_file_not_updated') && r.body?.flags?.some((f) => f.key === 'values_changed_file_not_updated' && !f.blocking), JSON.stringify([r.body?.file_status, r.body?.flags]));
r = await upload(v2, 'Label Final.pdf', 'application/pdf', PDF_B, admin);
h = await hyd(v2);
t('different bytes under the SAME name read "file changed, same name"', h.file_status?.labels?.includes('file_changed_same_name') && !h.file_status?.labels?.includes('same_file'), JSON.stringify(h.file_status));
t('…and extraction re-ran: calories 140 on the file vs 130 stored is a mismatch; sodium 215 vs 210 too', h.extract_mismatches?.some((m) => m.field === 'calories' && m.file === 140 && m.stored === 130) && h.extract_mismatches?.some((m) => m.field === 'sodium'), JSON.stringify(h.extract_mismatches));
t('…the replaced file is gone (one panel file)', h.files.filter((f) => f.kind === 'panel').length === 1);
r = await upload(v2, 'Label v3.pdf', 'application/pdf', PDF_B, admin);
h = await hyd(v2);
t('a different name and different bytes read "new file"', h.file_status?.labels?.includes('new_file'), JSON.stringify(h.file_status));

console.log('\n── a PNG is accepted; with no AI it is "skipped", never a failure of the upload ──');
r = await json('POST', '/nfp', { sku: sku2, version: 'V1', provenance: PROV }, PM);
const v3 = r.body?.id;
r = await upload(v3, 'label.png', 'image/png', PNG, PM);
t('the PM token uploads a PNG (200)', r.status === 200 && r.body?.uploaded?.extraction === 'skipped', `${r.status} ${JSON.stringify(r.body?.uploaded || r.body).slice(0, 200)}`);
h = await hyd(v3);
t('…stored as <SKU>_V1_<date>.png with its hash, nothing filled', /\.png$/.test(h.files[0]?.filename || '') && /^[0-9a-f]{64}$/.test(h.files[0]?.sha256 || '') && !h.has_values, JSON.stringify(h.files[0]));
t('…and the card says why nothing was read', /AI is not configured/.test(h.extraction?.note || ''), h.extraction?.note);
r = await upload(v3, 'label.gif', 'image/gif', Buffer.from('GIF89a'), PM);
t('a GIF is refused (415)', r.status === 415);

console.log('\n── the backfill: approved panels read into proposals ──');
// A legacy approved panel: a file on it that was never read, with a blank
// calories and a sodium that disagrees with the file.
r = await json('POST', '/nfp', { sku: sku3, version: 'V0', provenance: PROV }, admin);
const v0 = r.body?.id;
await upload(v0, 'Old Label.pdf', 'application/pdf', PDF_A, admin);
db.prepare(`UPDATE nfp_versions SET status = 'approved', approved_at = '2026-03-01', approved_by = 'Maria Servin', panel_json = ?, panel_sources = NULL WHERE id = ?`)
  .run(JSON.stringify({ sodium_mg: 999, protein_g: 25, serving_grams: '35', serving_household: '1 Scoop' }), v0);
db.prepare("UPDATE nfp_files SET sha256 = NULL, original_filename = NULL, extracted_text = NULL, extracted_json = NULL, extract_status = NULL, extracted_at = NULL WHERE version_id = ?").run(v0);
r = await json('GET', '/nfp/review-queue', null, admin);
t('the queue counts the approved files not read yet (V0 and V1)', r.body?.counts?.backfill_remaining === 2 && r.body?.counts?.proposed === 0, JSON.stringify(r.body?.counts));
r = await json('POST', '/nfp/backfill-extract', { limit: 25 }, PM);
t('a token cannot run the backfill', r.status === 403, String(r.status));
r = await json('POST', '/nfp/backfill-extract', { limit: 25 }, admin);
t('the admin runs it: 2 read, 0 remaining, 2 pending', r.status === 200 && r.body?.read?.length === 2 && r.body?.remaining === 0 && r.body?.pending === 2, JSON.stringify(r.body).slice(0, 300));
const f0 = db.prepare("SELECT sha256, original_filename, extract_status FROM nfp_files WHERE version_id = ?").get(v0);
t('the legacy file now carries its hash and name, and was read', /^[0-9a-f]{64}$/.test(f0?.sha256 || '') && !!f0?.original_filename && f0?.extract_status === 'ok', JSON.stringify(f0));
r = await json('GET', '/nfp/proposed', null, admin);
const p0 = r.body?.proposed?.find((p) => p.version_id === v0);
const p1 = r.body?.proposed?.find((p) => p.version_id === v1);
t('V0\'s proposal: calories among the fills, sodium among the conflicts', p0?.fills?.some((f) => f.field === 'calories' && f.value === 130) && p0?.conflicts?.some((c) => c.field === 'sodium' && c.stored === 999), JSON.stringify([p0?.fills?.map((f) => f.field), p0?.conflicts]));
t('V1\'s proposal has nothing to fill (its draft was filled from the file)', p1 && p1.fills.length === 0 && p1.conflicts.length === 0, JSON.stringify(p1?.fills));
r = await json('POST', `/nfp/proposed/${p0.id}/confirm`, {}, PM);
t('a token cannot confirm', r.status === 403);
r = await json('POST', `/nfp/proposed/${p0.id}/confirm`, {}, admin);
const after0 = JSON.parse(ver(v0).panel_json);
t('confirming fills calories 130 on the approved panel', r.status === 200 && after0.calories === 130, JSON.stringify(after0));
t('…and NEVER overwrites sodium 999', after0.sodium_mg === 999);
t('…the version is still approved, same approval', ver(v0).status === 'approved' && ver(v0).approved_at === '2026-03-01');
t('…source stamped "extracted from file", audited', JSON.parse(ver(v0).panel_sources || '{}').calories?.source === 'extracted from file'
  && db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_id = ? AND details LIKE '%left_alone%'").get(v0).c === 1);
r = await json('POST', `/nfp/proposed/${p0.id}/confirm`, {}, admin);
t('confirming twice is 409', r.status === 409);
r = await json('POST', `/nfp/proposed/${p1.id}/dismiss`, { note: 'x' }, admin);
t('dismissing needs a note (400)', r.status === 400 && r.body?.error === 'note_required');
r = await json('POST', `/nfp/proposed/${p1.id}/dismiss`, { note: 'Nothing to take' }, admin);
t('dismissed with a note', r.status === 200 && r.body?.dismissed?.status === 'dismissed');
r = await json('POST', '/nfp/backfill-extract', { limit: 25 }, admin);
t('running the backfill again reads nothing (idempotent)', r.body?.read?.length === 0 && r.body?.pending === 0, JSON.stringify(r.body));

console.log('\n── in a browser at 1280 ──');
// A pending proposal for the queue screen, and an open mismatch on V2's card.
db.prepare("UPDATE nfp_proposed_values SET status = 'pending', decided_by = NULL, decided_at = NULL, note = NULL WHERE version_id = ?").run(v1);
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${BASE}/manifest.webmanifest`);
await page.evaluate(([tok]) => {
  localStorage.setItem('auth_token', tok);
  localStorage.setItem('auth_user', JSON.stringify({ id: 'ex-admin', name: 'Extract Admin', role: 'admin', department: 'qa' }));
}, [admin]);
await page.goto(`${BASE}/?tab=products`);
await page.waitForTimeout(3000);
await page.locator(`[data-grid-row="${sku}"] button, [data-grid-row="${sku}"] code`).first().click().catch(() => {});
await page.waitForTimeout(1500);
t('the draft card carries the extraction block', await page.locator('[data-nfp-extraction][data-extract-status="ok"]').count() >= 1, String(await page.locator('[data-nfp-extraction]').count()));
t('…the file label "New file"', await page.locator('[data-nfp-file-label="new_file"]').count() === 1);
t('…the calories mismatch with its two buttons', await page.locator('[data-nfp-mismatch="calories"]').count() === 1 && await page.locator('[data-nfp-use-file="calories"]').count() === 1 && await page.locator('[data-nfp-keep-stored="calories"]').count() === 1);
t('…and the blocking flag', await page.locator('[data-nfp-flag="extract_mismatch"]').count() === 1);
// The drawer folds a section (D-178) — open the one holding the panel before clicking in it.
const folded = page.locator('section[data-open="0"]:has([data-nfp-keep-stored="calories"]) [data-section-toggle]');
if (await folded.count()) await folded.first().click();
await page.locator('[data-nfp-keep-stored="calories"]').click();
await page.waitForTimeout(1500);
t('keeping the stored value from the card resolves it', await page.locator('[data-nfp-mismatch="calories"][data-nfp-mismatch-resolved="stored"]').count() === 1
  && JSON.parse(ver(v2).extract_resolutions || '{}').calories?.choice === 'stored');
await page.locator('[data-panel-toggle]').first().click().catch(() => {});
await page.waitForTimeout(400);
t('the panel editor marks the fields read from the file', await page.locator('[data-panel-source="serving_grams"]').count() === 1 && await page.locator('[data-panel-source="calories"]').count() === 1);
await page.goto(`${BASE}/?tab=products&view=review`);
await page.waitForSelector('[data-nfp-queue]', { timeout: 20000 }).catch(() => {});
t('the queue counts one approved panel to confirm', /1 approved panel/.test(await page.locator('[data-queue-count="proposed"]').innerText()));
t('…its row is in the bucket with Confirm', await page.locator(`[data-queue-proposed-row="${sku}"] [data-queue-proposed-confirm]`).count() === 1);
await page.locator(`[data-queue-proposed-row="${sku}"] [data-queue-proposed-confirm]`).click();
await page.waitForTimeout(1500);
t('confirming from the screen clears the bucket', await page.locator('[data-queue-proposed-empty-list]').count() === 1
  && db.prepare("SELECT status FROM nfp_proposed_values WHERE version_id = ?").get(v1)?.status === 'confirmed');
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
