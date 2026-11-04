// verify:coaprepbot — the coa-prep grant on a bot TOKEN (D-313).
//
// A fresh database. The Quality bot's account has COA at Edit and is NOT in
// Quality, so only the token grant can open the two routes. Two tokens on it:
// one with no grant, one with coa-prep.
// Asserted:
//   - Settings offers coa-prep as a tick box (the grant catalog);
//   - with no grant: PUT /coa/plans/:id and PUT /coa/products/:item are 403;
//   - with coa-prep: a DRAFT plan's tests (limits, units, judging rules) and its
//     proposed products save; a product is registered, aliased and branded;
//   - every value the bot saved reads "bot-prepared" (plan, tests, product),
//     and one `bot_coa_write` audit row per write names the token with the old
//     and new values;
//   - with coa-prep, always 403 with a reason: approve, apply, sign, delete,
//     editing an APPROVED plan, setting a product's claim or slug, moving a
//     test's public flag, editing a product whose approved plan is applied,
//     marking a product reviewed;
//   - a person approving the plan clears its marks; a person marks the product
//     reviewed and its mark clears.
//
// Caller sets PORT + DBPATH (verify-all does).
// Control: run against `main` before D-313. The coa-prep token grant does not
// exist, so the grant is refused and every bot edit is 403.
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 5188);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'CoaPrepBot2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('cp-admin', 'Ada Admin', 'admin', 'admin');
  mk('cp-qa', 'Quinn Quality', 'supervisor', 'qa', { coa: 'edit' });
  mk('cp-bot', '*Quality Bot', 'operator', 'office', { coa: 'edit' });
  const ins = db.prepare(`INSERT OR IGNORE INTO coa_requests (id, item_number, item_description, lot_number, tests_requested, status, source, created_by)
    VALUES (?, ?, ?, ?, 'HM & Micro', 'pending', 'fixture', 'fixture')`);
  ins.run('cp-req-1', 'CP-WHEY-01', 'Whey Vanilla', 'L-1');
  ins.run('cp-req-2', 'CP-WHEY-02', 'Whey Chocolate', 'L-2');
  ins.run('cp-req-3', 'CP-LOCKED', 'Pancake Mix', 'L-3');
  db.close();
}

const call = async (m, p, b, tok) => {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('cp-admin', 'Ada Admin');
const qa = await signIn('cp-qa', 'Quinn Quality');
t('an admin and a QA supervisor signed in', !!admin && !!qa);

console.log('\n── the grant in Settings ──');
let r = await call('GET', '/api-tokens', null, admin);
t('Settings offers coa-prep as a tick box', (r.json?.grants || []).some((g) => g.key === 'coa-prep'), JSON.stringify((r.json?.grants || []).map(g => g.key)));

// Test tokens on this throwaway database only, minted by its own test admin.
const mint = async (label, grants) => {
  const m = await call('POST', '/api-tokens', { user_id: 'cp-bot', label, scopes: ['read', 'write'] }, admin);
  const id = m.json?.token?.id;
  let gstatus = null;
  if (grants.length) gstatus = (await call('POST', `/api-tokens/${id}/grants`, { grants }, admin)).status;
  return { id, plain: m.json?.plaintext, gstatus };
};
const NONE = await mint('Quality bot (no grant)', []);
const PREP = await mint('Quality bot (COA prep)', ['coa-prep']);
t('a no-grant token and a coa-prep token minted on the fresh database', !!NONE.plain && !!PREP.plain);
t('the coa-prep grant was accepted', PREP.gstatus === 200, String(PREP.gstatus));

// Two plans a person made: one stays a draft, one is approved.
r = await call('POST', '/coa/plans', { name: 'Whey Protein CP' }, qa);
const draft = r.json;
r = await call('POST', '/coa/plans', { name: 'Pancake CP' }, qa);
const locked = r.json;
r = await call('PUT', `/coa/plans/${locked.id}`, { tests: [{ test_type: 'Lead', comparator: '<', max_value: 0.5, unit: 'ppm' }] }, qa);
r = await call('POST', `/coa/plans/${locked.id}/approve`, { signature_password: PW }, qa);
t('a person made a draft plan and approved a second one', draft?.status === 'draft' && r.json?.status === 'approved', `${draft?.status} ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
r = await call('PUT', '/coa/products/CP-LOCKED', { brand_owner: 'ProDough' }, qa);
r = await call('POST', `/coa/plans/${locked.id}/apply`, { item_numbers: ['CP-LOCKED'], mode: 'apply', reason: 'set up', signature_password: PW }, qa);
t('…and applied it to CP-LOCKED', r.status === 200 && r.json?.applied === 1, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);

console.log('\n── no grant ──');
const TESTS = [
  { test_type: 'Lead', evaluation: 'limit', comparator: '<', max_value: 0.5, unit: 'ppm', method: 'ICP-MS' },
  { test_type: 'Total Plate Count', evaluation: 'limit', comparator: '<=', max_value: 10000, unit: 'CFU/g' },
];
r = await call('PUT', `/coa/plans/${draft.id}`, { tests: TESTS }, NONE.plain);
t('PUT /coa/plans/:id with no grant: 403', r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('PUT', '/coa/products/CP-WHEY-01', { brand_owner: 'ProDough' }, NONE.plain);
t('PUT /coa/products/:item with no grant: 403', r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);
t('…and nothing was written', one('SELECT COUNT(*) c FROM coa_test_plan_tests WHERE plan_id = ?', draft.id).c === 0
  && !one("SELECT 1 x FROM coa_products WHERE item_number = 'CP-WHEY-01'"));

console.log('\n── coa-prep prepares ──');
r = await call('PUT', `/coa/plans/${draft.id}`, { tests: TESTS, items: ['CP-WHEY-01', 'CP-WHEY-02'] }, PREP.plain);
t('edits the DRAFT plan: limits, units, judging rules and its products', r.status === 200 && r.json?.tests?.length === 2
  && r.json.tests[0].max_value === 0.5 && r.json.tests[0].unit === 'ppm' && r.json.proposed?.length === 2, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t('the plan and both tests read bot-prepared, naming the token', !!r.json?.bot_prepared_at && r.json?.bot_prepared_by === 'Quality bot (COA prep)'
  && r.json.tests.every(x => x.bot_prepared_by === 'Quality bot (COA prep)'));
t('the plan is still a draft — nothing approved', one('SELECT status, approved_by FROM coa_test_plans WHERE id = ?', draft.id).status === 'draft');
r = await call('PUT', '/coa/products/CP-WHEY-01', { brand_owner: 'ProDough', aliases: ['Whey Vanilla 2lb'], display_name: 'Whey Vanilla' }, PREP.plain);
t('registers CP-WHEY-01 with a brand and an alias', r.status === 200 && r.json?.brand_owner === 'ProDough' && /Whey Vanilla 2lb/.test(r.json?.aliases || ''), `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t('…and it reads bot-prepared, naming what it set', !!r.json?.bot_prepared_at && JSON.parse(r.json.bot_prepared_fields).includes('registered'));

const audits = q("SELECT entity_type, details, previous_state, new_state FROM audit_log WHERE action = 'bot_coa_write' ORDER BY rowid");
t('two bot_coa_write audit rows', audits.length === 2, String(audits.length));
const a0 = audits[0] && JSON.parse(audits[0].details);
const prev0 = audits[0] && JSON.parse(audits[0].previous_state || 'null');
const new0 = audits[0] && JSON.parse(audits[0].new_state || 'null');
t('the plan row names the token, with the old (none) and new limits', a0?.token_label === 'Quality bot (COA prep)' && a0?.grant === 'coa-prep'
  && prev0?.tests?.length === 0 && new0?.tests?.[0]?.max_value === 0.5, audits[0]?.details);
const new1 = audits[1] && JSON.parse(audits[1].new_state || 'null');
t('the product row has the old (none) and new brand', audits[1]?.entity_type === 'coa_product' && audits[1].previous_state == null && new1?.brand_owner === 'ProDough');
t('no audit row carries the token itself', !q("SELECT details FROM audit_log").some(x => (x.details || '').includes(PREP.plain)));

console.log('\n── coa-prep never decides ──');
const refused = (x) => x.status === 403 && !!(x.json?.reason || x.json?.message);
r = await call('POST', `/coa/plans/${draft.id}/approve`, { signature_password: PW }, PREP.plain);
t('approve: 403 with a reason', refused(r) && r.json?.error === 'approve_requires_human_session', JSON.stringify(r.json));
r = await call('POST', `/coa/plans/${locked.id}/apply`, { item_numbers: ['CP-WHEY-01'], mode: 'apply', reason: 'bot', signature_password: PW }, PREP.plain);
t('apply to products: 403 naming "Apply to products"', refused(r) && /Apply to products/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('PUT', `/coa/plans/${locked.id}`, { tests: TESTS }, PREP.plain);
t('editing an APPROVED plan: 403 naming why', refused(r) && /approved/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('POST', '/coa/requests/cp-req-1/sign', { signature_password: PW }, PREP.plain);
t('signing a certificate: 403', refused(r), JSON.stringify(r.json));
r = await call('DELETE', '/coa/requests/cp-req-1/sign', { reason: 'bot' }, PREP.plain);
t('un-signing: 403', r.status === 403, JSON.stringify(r.json));
r = await call('DELETE', `/coa/plans/${draft.id}`, null, PREP.plain);
t('deleting: 403', r.status === 403 && r.json?.error === 'token_denied', JSON.stringify(r.json));
r = await call('POST', `/coa/specifications/x/approve`, {}, PREP.plain);
t('approving a spec: 403', refused(r), JSON.stringify(r.json));
r = await call('PUT', '/coa/products/CP-WHEY-01', { gf_claim: true, slug: 'whey' }, PREP.plain);
t('a product\'s gluten-free claim or slug: 403 naming the fields', refused(r) && /gf_claim/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('PUT', `/coa/plans/${draft.id}`, { tests: [{ ...TESTS[0], evaluation: 'report_only', public: true }] }, PREP.plain);
t('moving a test onto the public certificate: 403', refused(r) && /public/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('PUT', `/coa/plans/${draft.id}`, { tests: TESTS, brand_owner: 'X' }, PREP.plain);
t('a plan field it is not given (brand_owner): 403', refused(r) && /brand_owner/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('PUT', '/coa/products/CP-LOCKED', { aliases: ['Pancake 1lb'] }, PREP.plain);
t('a product with an approved plan applied: 403', refused(r) && /approved plan/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('POST', '/coa/products/CP-WHEY-01/acknowledge', {}, PREP.plain);
t('marking its own work reviewed: 403', r.status === 403, JSON.stringify(r.json));
t('none of that wrote a third bot_coa_write row', one("SELECT COUNT(*) c FROM audit_log WHERE action = 'bot_coa_write'").c === 2);

console.log('\n── a person reviews ──');
r = await call('PUT', '/coa/products/CP-WHEY-02', { brand_owner: 'ProDough' }, qa);
t('a person\'s product write carries no bot mark', r.status === 200 && !r.json?.bot_prepared_at);
r = await call('POST', '/coa/products/CP-WHEY-01/acknowledge', {}, qa);
t('a person marks CP-WHEY-01 reviewed: the mark clears', r.status === 200 && !r.json?.bot_prepared_at, JSON.stringify(r.json).slice(0, 160));
r = await call('POST', `/coa/plans/${draft.id}/approve`, { signature_password: PW }, qa);
t('a person approves the plan with a password', r.status === 200 && r.json?.status === 'approved', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
t('…and every bot mark on it clears', !r.json?.bot_prepared_at && r.json?.tests?.every(x => !x.bot_prepared_at));
r = await call('PUT', `/coa/plans/${draft.id}`, { tests: TESTS }, PREP.plain);
t('the bot can no longer edit it (now approved): 403', refused(r) && /approved/.test(r.json?.reason || ''), JSON.stringify(r.json));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
