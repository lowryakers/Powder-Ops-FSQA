// verify:artworkretire — D-330, live on a fresh database.
//
// An artwork version a newer one replaced can be RETIRED (superseded) straight
// from draft or in review, by a person or by a bot token; a token may also
// REJECT with a stated reason; a token still cannot approve, release or delete.
// Releasing a version supersedes its draft / in-review siblings too. Retiring or
// rejecting a version leaves the product row alone unless it describes that
// version.
//
// Caller sets PORT + DBPATH (verify-all does). The control is `main` before
// this change: the first retire is 400 "Cannot go from in review to superseded."
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 5071);
const DBP = process.env.DBPATH;
const BASE = `http://localhost:${PORT}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('ar-adm', 'Rhea Release', 'admin', 'qa', null);
mkUser('ar-bot', 'Proof Bot', 'supervisor', 'qa', { products: 'view', artwork: 'edit' });
const skus = db.prepare("SELECT sku FROM products WHERE status NOT IN ('discontinued','not_launching') AND artwork_status IS NULL ORDER BY sku LIMIT 6").all().map(r => r.sku);
const [S1, S2, S3, S4, S5] = skus;
const prod = (sku) => db.prepare('SELECT artwork_status, artwork_version FROM products WHERE sku = ?').get(sku);
const row = (id) => db.prepare('SELECT * FROM artwork_versions WHERE id = ?').get(id);
const audits = (id) => db.prepare("SELECT details FROM audit_log WHERE entity_type = 'artwork' AND entity_id = ? AND action LIKE '%status%' ORDER BY rowid").all(id).map(a => JSON.parse(a.details || '{}'));

const c0 = (m, p, b, k) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(k ? { Authorization: `Bearer ${k}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c0('POST', '/users/login', { name: 'Rhea Release' });
await c0('POST', '/users/set-password', { user_id: 'ar-adm', password: 'RheaRelease2026!!', setup_code: 'SC-ar-adm' });
const ses = (await J(await c0('POST', '/users/login', { name: 'Rhea Release', password: 'RheaRelease2026!!' })))?.token;
const minted = await J(await c0('POST', '/api-tokens', { user_id: 'ar-bot', label: 'Proof bot (verify)', scopes: ['read', 'write'] }, ses));
const tok = minted?.plaintext;
t('fixtures: a QA admin session, a write token on a QA supervisor holding artwork edit, five SKUs with no artwork status', !!ses && !!tok && skus.length >= 5, JSON.stringify(minted).slice(0, 120));

const call = (m, p, b, k = ses) => c0(m, p, b, k);
const create = async (sku) => (await J(await call('POST', '/artwork', { sku })))?.id;
const move = (id, status, extra = {}, k = ses) => call('POST', `/artwork/versions/${id}/status`, { status, ...extra }, k);

console.log('\n── a person retires an old draft or review version (1, 2) ──');
const a1 = await create(S1); await move(a1, 'in_review');
const a2 = await create(S1);
const p1 = prod(S1);
let r = await move(a1, 'superseded');
let j = await J(r);
t('1. session: in_review → superseded is 200, named as replaced by the current version', r.status === 200 && j?.status === 'superseded' && j?.superseded_by === a2, `${r.status} ${JSON.stringify(j).slice(0, 160)}`);
const a3 = await create(S1);
r = await move(a2, 'superseded', { superseded_by: a3 });
t('2. session: draft → superseded is 200 with the id sent', r.status === 200 && row(a2).status === 'superseded' && row(a2).superseded_by === a3);
t('10. retiring versions that are not the current one leaves the product row as it was', JSON.stringify(prod(S1)) === JSON.stringify(p1), JSON.stringify(prod(S1)));

r = await move(a3, 'superseded', { superseded_by: a3 });
t('superseded_by naming the row itself is 400', r.status === 400 && (await J(r))?.code === 'SUPERSEDED_BY_INVALID');
const other = await create(S5);
r = await move(a3, 'superseded', { superseded_by: other });
t('superseded_by naming another SKU\'s version is 400, and nothing moved', r.status === 400 && row(a3).status === 'draft');
r = await move(other, 'superseded');
t('the current (only) version retires with nothing named as its replacement', r.status === 200 && row(other).superseded_by === null);

console.log('\n── a bot token retires and rejects; it cannot approve, release or delete (3–7, 9) ──');
const b1 = await create(S2); await move(b1, 'in_review');
const b2 = await create(S2);
const p2 = prod(S2);
r = await move(b1, 'superseded', {}, tok);
j = await J(r);
t('3. token: in_review → superseded is 200, replaced by the current version', r.status === 200 && j?.status === 'superseded' && j?.superseded_by === b2, `${r.status} ${JSON.stringify(j).slice(0, 160)}`);
const ab = audits(b1).at(-1);
t('3. …audited artwork_status_changed in_review → superseded with superseded_by', ab?.from === 'in_review' && ab?.to === 'superseded' && ab?.superseded_by === b2, JSON.stringify(ab));
t('3. …via the token', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_id = ? AND details LIKE '%via_token%'").get(b1));
const b3 = await create(S2);
r = await move(b2, 'superseded', {}, tok);
t('4. token: draft → superseded is 200', r.status === 200 && row(b2).status === 'superseded' && row(b2).superseded_by === b3);
t('10. …and the product row is untouched by either', JSON.stringify(prod(S2)) === JSON.stringify(p2));

await move(b3, 'in_review', {}, tok);
r = await move(b3, 'approved', {}, tok);
t('5. token: approved → 403 approve_requires_human_session, row unchanged', r.status === 403 && (await J(r))?.error === 'approve_requires_human_session' && row(b3).status === 'in_review');
r = await move(b3, 'print_ready', {}, tok);
t('6. token: print_ready → 403 approve_requires_human_session, row unchanged', r.status === 403 && (await J(r))?.error === 'approve_requires_human_session' && row(b3).status === 'in_review');
r = await call('DELETE', `/artwork/versions/${b3}`, null, tok);
j = await J(r);
t('7. token: DELETE a version → 403 token_denied (delete), row still there', r.status === 403 && j?.error === 'token_denied' && j?.category === 'delete' && !!row(b3));
r = await call('POST', '/artwork/checks/x/dismiss', { reason: 'bot' }, tok);
t('token: dismissing a check is still 403 token_denied (decision)', r.status === 403 && (await J(r))?.category === 'decision');

r = await move(b3, 'rejected', {}, tok);
t('9. token: reject with no reason → 400 REASON_REQUIRED, nothing moved', r.status === 400 && (await J(r))?.code === 'REASON_REQUIRED' && row(b3).status === 'in_review');
r = await move(b3, 'rejected', { reason: '   ' }, tok);
t('9. …a blank reason is the same 400', r.status === 400);
r = await move(b3, 'rejected', { reason: 'Lowry 11/10: dropped, will re-add as drafts when ready' }, tok);
j = await J(r);
t('9. token: reject with a reason → 200, the reason on the version', r.status === 200 && j?.status === 'rejected' && j?.rejected_reason === 'Lowry 11/10: dropped, will re-add as drafts when ready' && j?.rejected_by === 'Proof Bot' && !!j?.rejected_at);
j = await J(await call('GET', `/artwork/versions/${b3}`));
t('9. …and on GET /artwork/versions/:id', (j?.rejected_reason || j?.version?.rejected_reason) === 'Lowry 11/10: dropped, will re-add as drafts when ready', JSON.stringify(j).slice(0, 200));
t('9. …and in the audit entry', audits(b3).at(-1)?.reason === 'Lowry 11/10: dropped, will re-add as drafts when ready');
const sx = await create(S5);
r = await move(sx, 'rejected', { reason: 'Wrong flavor art' });
t('9. session: reject with a reason → 200, stored', r.status === 200 && row(sx).rejected_reason === 'Wrong flavor art' && row(sx).rejected_by === 'Rhea Release');

console.log('\n── the product row: the Plant-draft shape (current draft, no film, status blank) ──');
const w1 = await create(S4);
r = await move(w1, 'rejected', { reason: 'dropped' }, tok);
t('rejecting the only (current) draft of a product with no artwork status leaves that status blank, not "rejected"', r.status === 200 && prod(S4).artwork_status === null, JSON.stringify(prod(S4)));

console.log('\n── release supersedes draft and in-review siblings; a released film keeps the product row (8, 11, 13) ──');
const PANEL = {
  serving_size_desc: '1 scoop', serving_size_g: 34.86, servings_per_container: 1, calories: 130,
  total_fat_g: 1.5, total_fat_dv: 2, saturated_fat_g: 1, saturated_fat_dv: 5, trans_fat_g: 0,
  cholesterol_mg: 45, cholesterol_dv: 15, sodium_mg: 115, sodium_dv: 5,
  total_carbohydrate_g: 5, total_carbohydrate_dv: 2, dietary_fiber_g: 0, dietary_fiber_dv: 0,
  total_sugars_g: 2, added_sugars_g: 1, added_sugars_dv: 2, protein_g: 24,
  vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 130, calcium_dv: 10, iron_mg: 0.3, iron_dv: 0,
  potassium_mg: 160, potassium_dv: 4,
  ingredients: 'Whey protein isolate, natural flavors', allergen_statement: 'Contains milk.',
  net_weight_g: 34.86, net_weight_oz: 1.23,
};
await call('PUT', `/products/${S3}`, { mrp_formula_id: 'F-00123', formula_rev: 'v2.0', fill_weight_g: 34.86 });
const nv = await J(await call('POST', '/nfp', { sku: S3, version: 'V3', drive_url: 'https://drive.example/panel', provenance: { formula_ref: 'F-00123', formula_version: 'v2.0', bom_fill_weight_g: 34.86, source_system: 'Genesis R&D' } }));
await call('PUT', `/nfp/${nv?.id}/panel`, { panel: PANEL, front_callouts: { protein_g: 24, calories: 130, added_sugar_g: null } });
r = await call('POST', `/nfp/${nv?.id}/decide`, { signature_password: 'RheaRelease2026!!', decision: 'approved' });
t('fixture: the third SKU\'s panel is approved', r.ok, `${r.status} ${JSON.stringify(await J(r)).slice(0, 160)}`);
const z1 = await create(S3);
await move(z1, 'in_review'); await move(z1, 'approved');
r = await move(z1, 'print_ready');
t('13. session: draft → in_review → approved → print_ready still works and sets the product print_ready', r.status === 200 && prod(S3).artwork_status === 'print_ready' && prod(S3).artwork_version === String(row(z1).version), `${r.status} ${JSON.stringify(prod(S3))}`);
const filmRow = JSON.stringify(prod(S3));
const z2 = await create(S3);
r = await move(z2, 'rejected', { reason: 'Dropped this draft' });
t('11. rejecting the current draft while a released film is on file leaves the product on that film (print_ready, its version)', r.status === 200 && JSON.stringify(prod(S3)) === filmRow, JSON.stringify(prod(S3)));
const z3 = await create(S3); await move(z3, 'in_review');
r = await move(z3, 'superseded');
t('11. …and superseding the current version (which had put the product "in review") points it back at the film', r.status === 200 && JSON.stringify(prod(S3)) === filmRow, JSON.stringify(prod(S3)));
const z4 = await create(S3); await move(z4, 'in_review');
const z5 = await create(S3);
const z6 = await create(S3);
await move(z6, 'in_review'); await move(z6, 'approved');
r = await move(z6, 'print_ready');
t('8. releasing a new version is 200', r.status === 200, `${r.status} ${JSON.stringify(await J(r)).slice(0, 160)}`);
t('8. the previous film, the in-review and the draft siblings are superseded by it', [z1, z4, z5].every(id => row(id).status === 'superseded' && row(id).superseded_by === z6),
  JSON.stringify([z1, z4, z5].map(id => [row(id).status, row(id).superseded_by === z6])));
t('8. each has its own audit row (from its own status, auto, superseded_by)', [[z1, 'print_ready'], [z4, 'in_review'], [z5, 'draft']].every(([id, from]) => audits(id).some(a => a.auto && a.from === from && a.to === 'superseded' && a.superseded_by === z6)));
t('8. the rejected sibling stays rejected and the retired one stays as it was', row(z2).status === 'rejected' && row(z3).status === 'superseded' && row(z3).superseded_by !== z6);
t('13. the product now reads print_ready on the new version', prod(S3).artwork_status === 'print_ready' && prod(S3).artwork_version === String(row(z6).version));

console.log('\n── illegal moves still 400 (12) ──');
const s4 = await create(S4);
for (const [id, to, label] of [[z1, 'draft', 'superseded → draft'], [s4, 'approved', 'draft → approved'], [z4, 'in_review', 'superseded → in_review'], [w1, 'superseded', 'rejected → superseded']]) {
  r = await move(id, to);
  t(`12. ${label} is 400`, r.status === 400 && /^Cannot go from/.test((await J(r))?.error || ''));
}
await move(s4, 'in_review');
r = await move(s4, 'print_ready');
t('12. in_review → print_ready is 400', r.status === 400);

db.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
