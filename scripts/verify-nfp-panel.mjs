// The nutrition panel, read by the artwork proofing service, and the %DV check
// that stands between a wrong panel and every pack drawn from it.
//
// Caller sets PORT + DBPATH and PRODUCT_MASTER_TOKEN=proof-token on the server.
//
// THE CONTROL that matters: take the `if (warnings.length && !dvAck) throw`
// line out of `decide()` in server/api/nfp.js and the five approval-gate
// assertions fail — including the one that proves the SIGNED LINK is gated
// too, which is the door most of these approvals actually come through.
const PORT = process.env.PORT || 5016;
const B = `http://localhost:${PORT}/api`;
const TOKEN = 'proof-token';
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  // module_access NULL, deliberately: a map on an admin is a RESTRICTION map.
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('nfp-admin','Panel Admin','Panel Admin','admin','qa',1,NULL,'SC-NFP',datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Panel Admin' });
await post('/users/set-password', { user_id: 'nfp-admin', password: 'Panel2026!', setup_code: 'SC-NFP' });
token = (await J(await post('/users/login', { name: 'Panel Admin', password: 'Panel2026!' })))?.token;
t('signed in', !!token);

const products = (() => {
  const db = new Database(process.env.DBPATH, { readonly: true });
  const rows = db.prepare(`SELECT sku, gtin, flavor FROM products
    WHERE gtin IS NOT NULL AND gtin != ''
      AND sku NOT IN (SELECT sku FROM nfp_versions) ORDER BY sku LIMIT 2`).all();
  db.close(); return rows;
})();
const P = products[0], P2 = products[1];
t('two seeded products with GTINs and no panel on file', !!P?.gtin && !!P2?.gtin, JSON.stringify(products));

const panelFor = (q) => fetch(`${B}/products/nutrition-panel?${q}&token=${TOKEN}`);

console.log('\nThe feed is off without the token, and says which lookup failed');
t('no token is refused', (await fetch(`${B}/products/nutrition-panel?gtin=${P.gtin}`)).status === 401);
t('a wrong token is refused', (await fetch(`${B}/products/nutrition-panel?gtin=${P.gtin}&token=nope`)).status === 401);
t('neither gtin nor sku is a 400, not a 404', (await panelFor('')).status === 400);
let r = await panelFor('gtin=000000000000');
let b = await J(r);
t('an unknown GTIN is 404 product_not_found', r.status === 404 && b?.reason === 'product_not_found', `${r.status} ${b?.reason}`);
r = await panelFor(`gtin=${P.gtin}`);
b = await J(r);
// All three refusals read as "unverified" to the proofing service, which is
// right — but to the plant they are three different jobs.
t('A PRODUCT WITH NO PANEL IS 404 no_panel, never an empty panel',
  r.status === 404 && b?.reason === 'no_panel' && !('panel' in (b || {})), `${r.status} ${JSON.stringify(b)}`);

console.log('\nA panel on file with nobody having typed the numbers is its own answer');
r = await post('/nfp', { sku: P.sku, version: 'V1', drive_url: 'https://drive.example/panel-v1' });
const v1 = await J(r);
t('the panel version files', r.status === 201 && !!v1?.id, String(r.status));
t('and starts at panel_rev 0', v1?.panel_rev === 0, String(v1?.panel_rev));
r = await panelFor(`sku=${encodeURIComponent(P.sku)}`);
b = await J(r);
t('the feed says no_panel_values, and names the version it found',
  r.status === 404 && b?.reason === 'no_panel_values' && b?.version === 'V1', `${r.status} ${JSON.stringify(b)}`);

console.log('\nThe numbers, as the panel writes them');
const GOOD = {
  serving_size_desc: '1 Bottle', serving_size_g: 35, servings_per_container: 1, calories: 120,
  total_fat_g: 0.5, total_fat_dv: 1, saturated_fat_g: 0, saturated_fat_dv: 0, trans_fat_g: 0,
  cholesterol_mg: '<5', cholesterol_dv: 1, sodium_mg: 260, sodium_dv: 11,
  total_carbohydrate_g: 4, total_carbohydrate_dv: 1, dietary_fiber_g: '<1', dietary_fiber_dv: 2,
  total_sugars_g: 2, added_sugars_g: 0, added_sugars_dv: 0, protein_g: 25,
  vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 150, calcium_dv: 10,
  iron_mg: 0.3, iron_dv: 0, potassium_mg: 40, potassium_dv: 0,
  ingredients: 'Whey Protein Isolate, Non-Fat Milk Powder', allergen_statement: 'Contains: Milk',
  net_weight_oz: 1.23, net_weight_g: 35,
};
r = await put(`/nfp/${v1.id}/panel`, { panel: GOOD, front_callouts: { protein_g: 25, calories: 120, added_sugar_g: 0, net_carbs_g: null } });
let saved = await J(r);
t('the values save', r.status === 200, String(r.status));
t('and the revision moves to 1', saved?.panel_rev === 1, String(saved?.panel_rev));
t('the serving size is MIRRORED onto the summary the approver reads',
  saved?.serving_size === '1 Bottle', saved?.serving_size);

r = await panelFor(`gtin=${P.gtin}`);
b = await J(r);
t('the feed answers on the GTIN', r.status === 200 && b?.sku === P.sku, `${r.status} ${b?.sku}`);
t('"<5" and "<1" ROUND-TRIP AS STRINGS, never coerced to 5 and 1',
  b?.panel?.cholesterol_mg === '<5' && b?.panel?.dietary_fiber_g === '<1',
  JSON.stringify([b?.panel?.cholesterol_mg, b?.panel?.dietary_fiber_g]));
t('a plainly numeric value is a number', b?.panel?.sodium_mg === 260, JSON.stringify(b?.panel?.sodium_mg));
t('A DRAFT IS READABLE AND SAYS IT IS A DRAFT — not the same 404 as missing',
  b?.status === 'draft', b?.status);
t('version is the LABEL a printer quotes, panel_rev the integer that moves',
  b?.version === 'V1' && b?.panel_rev === 1, `${b?.version}/${b?.panel_rev}`);
t('and panel_version carries the same integer under the name ingest posts back',
  b?.panel_version === 1, String(b?.panel_version));
t('front_callouts are STORED — a null means skip the check, not compute one',
  b?.front_callouts?.protein_g === 25 && b?.front_callouts?.net_carbs_g === null,
  JSON.stringify(b?.front_callouts));
t('net weight travels on the panel', b?.panel?.net_weight_g === 35 && b?.panel?.net_weight_oz === 1.23);
t('nothing is approved yet, so there is no approver and no date',
  b?.approved_by === null && b?.approved_at === null, JSON.stringify([b?.approved_by, b?.approved_at]));
const bySku = await J(await panelFor(`sku=${encodeURIComponent(P.sku)}`));
t('the same answer comes back by SKU when there is no GTIN to give',
  bySku?.panel_rev === 1 && bySku?.panel?.sodium_mg === 260);

console.log('\nThe revision moves when the numbers move, and only then');
r = await put(`/nfp/${v1.id}/panel`, { panel: { sodium_mg: 270 } });
saved = await J(r);
t('an edit increments the revision', saved?.panel_rev === 2, String(saved?.panel_rev));
t('and MERGES — the macros typed at a desk are not blanked by a phone',
  saved?.panel?.calories === 120 && saved?.panel?.sodium_mg === 270, JSON.stringify(saved?.panel?.calories));
r = await put(`/nfp/${v1.id}/panel`, { panel: { sodium_mg: 270 } });
saved = await J(r);
t('A SAVE THAT CHANGED NOTHING IS NOT A REVISION', saved?.panel_rev === 2, String(saved?.panel_rev));
await put(`/nfp/${v1.id}/panel`, { panel: { sodium_mg: 260 } });

console.log('\nThe %DV check, at the moment of approval');
// The three that are in artwork right now.
await put(`/nfp/${v1.id}/panel`, { panel: { saturated_fat_g: 0, saturated_fat_dv: 5, sodium_mg: 570, sodium_dv: 21 } });
const live = await J(await req(`/nfp/sku/${encodeURIComponent(P.sku)}`));
const dv = live?.versions?.[0]?.dv_check || [];
t('the panel screen shows the mismatches LIVE, computed from the current values',
  dv.length === 2, JSON.stringify(dv.map(w => w.nutrient)));
t('and names Saturated Fat 0 g declared at 5%',
  dv.some(w => w.nutrient === 'saturated_fat' && /zero cannot be/i.test(w.note)));
t('and Sodium 570 mg, with the 25% it computes to',
  dv.some(w => w.nutrient === 'sodium' && w.computed_dv === 25));

r = await post(`/nfp/${v1.id}/decide`, { decision: 'approved', approved_by: 'Matt Schramm' });
b = await J(r);
t('APPROVING IS REFUSED while the panel disagrees with its own arithmetic',
  r.status === 409 && b?.needs_dv_ack === true && b?.dv_warnings?.length === 2,
  `${r.status} ${JSON.stringify(b)?.slice(0, 160)}`);
let still = await J(await req(`/nfp/sku/${encodeURIComponent(P.sku)}`));
t('and nothing was written — the panel is still a draft',
  still?.versions?.[0]?.status === 'draft', still?.versions?.[0]?.status);

console.log('\nThe signed link is gated by the same rule — it is the door most approvals use');
r = await post(`/nfp/${v1.id}/send`, { sent_to: '801-555-0100' });
const link = (await J(r))?.link;
const linkToken = link?.split('/').pop();
t('a link issues', !!linkToken, link);
const view = await J(await fetch(`${B}/nfp-link/${linkToken}`));
t('THE APPROVER SEES THE MISMATCHES before deciding, not after',
  view?.dv_check?.length === 2, JSON.stringify(view?.dv_check?.length));
t('and the panel values travel with the link', view?.panel?.calories === 120);
r = await fetch(`${B}/nfp-link/${linkToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'approved', name: 'Matt Schramm' }) });
b = await J(r);
t('approving on the link without acknowledging is refused too',
  r.status === 409 && b?.needs_dv_ack === true, `${r.status} ${b?.error}`);

console.log('\nAcknowledging gets through, and the record says who dismissed what');
r = await fetch(`${B}/nfp-link/${linkToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'approved', name: 'Matt Schramm', dv_ack: true }) });
t('with dv_ack it is approved', r.status === 200, String(r.status));
const decided = (await J(await req(`/nfp/sku/${encodeURIComponent(P.sku)}`)))?.versions?.[0];
t('the panel is approved by the name the approver typed',
  decided?.status === 'approved' && decided?.approved_by === 'Matt Schramm', JSON.stringify([decided?.status, decided?.approved_by]));
t('WHO ACKNOWLEDGED IS RECORDED, with when',
  decided?.dv_ack_by === 'Matt Schramm' && !!decided?.dv_ack_at, JSON.stringify([decided?.dv_ack_by, decided?.dv_ack_at]));
t('and the mismatches are FROZEN with the decision, not recomputed later',
  decided?.dv_warnings_at_approval?.length === 2,
  JSON.stringify(decided?.dv_warnings_at_approval?.length));
b = await J(await panelFor(`gtin=${P.gtin}`));
t('the feed now reads approved, with the approver and the date',
  b?.status === 'approved' && b?.approved_by === 'Matt Schramm' && /^\d{4}-\d{2}-\d{2}$/.test(b?.approved_at || ''),
  JSON.stringify([b?.status, b?.approved_by, b?.approved_at]));
r = await put(`/nfp/${v1.id}/panel`, { panel: { sodium_mg: 100 } });
t('AN APPROVED PANEL IS NEVER REWRITTEN — the numbers are refused too', r.status === 409, String(r.status));

console.log('\nA CORRECT PANEL RAISES NOTHING — the regression this whole feature turns on');
r = await post('/nfp', { sku: P2.sku, version: 'V1', drive_url: 'https://drive.example/p2' });
const v2 = await J(r);
// Calcium 150 mg is 11.5% of the 1300 mg DV. The MINERAL increment rule rounds
// that to 10; the macronutrient rule would say 12 and flag a panel that is
// correct. Almost every panel on this line carries a figure like it.
r = await put(`/nfp/${v2.id}/panel`, { panel: { calcium_mg: 150, calcium_dv: 10, iron_mg: 0.3, iron_dv: 0, sodium_mg: 260, sodium_dv: 11 } });
saved = await J(r);
t('CALCIUM 150 mg DECLARED AT 10% RAISES NOTHING', (saved?.dv_check || []).length === 0,
  JSON.stringify(saved?.dv_check));
r = await post(`/nfp/${v2.id}/decide`, { decision: 'approved', approved_by: 'Matt Schramm' });
t('so it approves with no acknowledgement asked for at all', r.status === 200, String(r.status));
const clean = (await J(await req(`/nfp/sku/${encodeURIComponent(P2.sku)}`)))?.versions?.[0];
t('"[]" means checked and clean; NULL would mean never checked',
  Array.isArray(clean?.dv_warnings_at_approval) && clean.dv_warnings_at_approval.length === 0
    && clean?.dv_ack_by === null,
  JSON.stringify([clean?.dv_warnings_at_approval, clean?.dv_ack_by]));

console.log('\nWhat a proofing run was checked against');
r = await fetch(`${B}/artwork/ingest?token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ job_id: 'job-panel-1', gtin: P.gtin, component: 'primary', panel_version: 3,
    checks: [{ name: 'Nutrition panel', result: 'pass' }] }) });
b = await J(r);
t('ingest accepts panel_version and echoes what it stored', r.status === 201 && b?.panel_rev === 3, `${r.status} ${b?.panel_rev}`);
let hist = await J(await req(`/artwork/sku/${encodeURIComponent(P.sku)}`));
t('and it is on the product\'s artwork history', hist?.versions?.[0]?.panel_rev === 3, String(hist?.versions?.[0]?.panel_rev));
// The two halves of this integration were specified apart — the proofing tool
// says panel_version, ReadyDoc's feed says panel_rev. Both name one number.
r = await fetch(`${B}/artwork/ingest?token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ job_id: 'job-panel-2', gtin: P.gtin, component: 'secondary', panel_rev: 4, checks: [] }) });
t('and panel_rev is accepted under its own name too', (await J(r))?.panel_rev === 4);
r = await fetch(`${B}/artwork/ingest?token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ job_id: 'job-panel-1', gtin: P.gtin, component: 'primary', checks: [] }) });
t('A RETRY THAT SENDS NO REVISION LEAVES THE ONE ON FILE — NULL means not checked',
  (await J(r))?.panel_rev === 3, 'retry blanked it');
r = await fetch(`${B}/artwork/ingest?token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ job_id: 'job-panel-3', gtin: P2.gtin, checks: [] }) });
b = await J(r);
t('a run that never sent one records NULL, not 0', b?.panel_rev === null, String(b?.panel_rev));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
