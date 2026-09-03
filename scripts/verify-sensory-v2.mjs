// FORM 602-01 V2 against a live server: the first test writes the draft
// spec, a QA lead approves it, later tests grade against it, a fail raises
// the disposal, the flavour approval is scored the same way and files the
// same record, and a V1 record on file still reads. Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4932;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { v4: uuid } = await import('uuid');
const DB = () => new Database(process.env.DBPATH);
{ const db = DB();
  for (const [id, name, role, dept, code] of [['sv-lead', 'QA Lead', 'supervisor', 'qa', 'SC-SL'], ['sv-qa', 'QA Tech', 'operator', 'qa', 'SC-SQ'], ['sv-op', 'Line Op', 'operator', 'warehouse', 'SC-SO']]) {
    db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
      VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),'{"organoleptic":"edit","flavor-approvals":"edit"}')`).run(id, name, name, role, dept, code);
  }
  db.close(); }
const signIn = async (name, id, code) => { await post('/users/login', { name }); await post('/users/set-password', { user_id: id, password: 'Sens2026!', setup_code: code }); return (await J(await post('/users/login', { name, password: 'Sens2026!' })))?.token; };
const lead = await signIn('QA Lead', 'sv-lead', 'SC-SL'); const tech = await signIn('QA Tech', 'sv-qa', 'SC-SQ'); const op = await signIn('Line Op', 'sv-op', 'SC-SO');
token = tech;
t('signed in', !!lead && !!tech && !!op);

const PRODUCT = 'Whey Blueberry Muffin';
const SPEC = { appearance: 'Light tan, free-flowing, no clumps', odor: 'Sweet blueberry, no off notes', taste: 'Blueberry muffin, mildly sweet', color: 'Light tan with blue flecks', texture: 'Fine powder, dissolves cleanly' };
const allPass = { appearance: 'pass', odor: 'pass', taste: 'pass', color: 'pass', texture: 'pass' };

console.log('\nThe served form is V2 on a fresh database (first sight is the baseline)');
const cfg = await J(await req('/qms/config'));
const org = Array.isArray(cfg) ? cfg.find(x => x.key === 'organoleptic') : (cfg?.organoleptic || (cfg?.types || []).find?.(x => x.key === 'organoleptic'));
t('the Organoleptic form serves sensory fields', !!org && org.fields.some(f => f.type === 'sensory'), JSON.stringify(org?.fields?.map(f => f.key)).slice(0, 120));

console.log('\nA product with no spec: the first test refuses a pass with nothing to check against');
let r = await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-1', evaluator: 'QA Tech', ...allPass });
let body = await J(r);
t('a fail without its result cell is refused', (await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-0', ...allPass, taste: 'fail' })).status === 400);
t('...but a pass with no spec on file files (nothing to draft yet was given)', r.status === 201, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
t('and the record carries NO spec snapshot — none existed', !body?.sensory_spec);

console.log('\nThe first test that describes the product WRITES THE DRAFT SPEC');
r = await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-2', evaluator: 'QA Tech', ...allPass, sensory_spec_draft: SPEC });
body = await J(r);
t('filed', r.status === 201, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
t('THE RECORD CARRIES THE SPEC IT WAS GRADED AGAINST, marked draft', body?.sensory_spec?.status === 'draft' && body.sensory_spec.attributes.taste === SPEC.taste, JSON.stringify(body?.sensory_spec).slice(0, 160));
let spec = (await J(await req(`/qms/sensory-spec?product=${encodeURIComponent('  whey  blueberry MUFFIN ')}`)))?.spec;
t('the spec is on file for the product, found however the name is spaced or cased', spec?.status === 'draft' && spec.drafted_by === 'QA Tech', JSON.stringify(spec).slice(0, 120));
t('a second draft for the same product is not created', (await J(await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-3', ...allPass, sensory_spec_draft: { ...SPEC, taste: 'something else' } })))?.sensory_spec?.attributes?.taste === SPEC.taste);

console.log('\nApproval is a QA lead\'s act');
token = tech; r = await post(`/qms/sensory-specs/${spec.id}/approve`, {});
t('a QA technician cannot approve', r.status === 403, String(r.status));
token = op; r = await post(`/qms/sensory-specs/${spec.id}/approve`, {});
t('an operator cannot approve', r.status === 403, String(r.status));
token = lead; r = await post(`/qms/sensory-specs/${spec.id}/approve`, {});
body = await J(r);
t('the QA lead approves, and the record says who and when', r.status === 200 && body?.status === 'approved' && body.approved_by === 'QA Lead' && !!body.approved_at, JSON.stringify(body).slice(0, 120));
r = await post(`/qms/sensory-specs/${spec.id}/approve`, {});
t('approving twice is refused', r.status === 409);
r = await put(`/qms/sensory-specs/${spec.id}`, { taste: 'rewritten' });
t('AN APPROVED SPEC IS LOCKED', r.status === 409, String(r.status));

console.log('\nLater tests grade against the approved spec');
token = tech;
r = await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-4', evaluator: 'QA Tech', ...allPass, taste: 'fail', taste_result: 'bitter aftertaste, not blueberry' });
body = await J(r);
t('a failing test files', r.status === 201, `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
t('its snapshot is the APPROVED spec', body?.sensory_spec?.status === 'approved' && body.sensory_spec.approved_by === 'QA Lead');
t('and what was seen travels with it', body?.taste_result === 'bitter aftertaste, not blueberry');
{ const db = DB(); const d = db.prepare("SELECT * FROM disposals WHERE source_type = 'organoleptic' AND source_id = ?").get(body.id); db.close();
  t('A DOES-NOT-MATCH RAISES THE DRAFT DISPOSAL', !!d && d.status === 'draft', JSON.stringify(d).slice(0, 100)); }
r = await post('/qms/organoleptic', { product: PRODUCT, lot: 'L-5', ...allPass, odor: 'maybe' });
t('an invented answer is refused', r.status === 400);

console.log('\nThe Flavor Approval is scored the same way and files the same record');
const fa = await J(await post('/qms/flavor_approval', { product_name: 'Beef Cinnamon Sugar', lot_number: 'B-9', mo_number: '77001' }));
t('flavor approval filed pending', fa?.status === 'pending', JSON.stringify(fa).slice(0, 100));
r = await post(`/qms/flavor_approval/${fa.id}/send`, {});
body = await J(r);
t('it cannot be texted before the evaluation, and the refusal names the V2 ask', r.status === 400 && body?.needs_sensory === true && /odor, taste, color and texture/.test(body.error), body?.error);
token = op; r = await post(`/qms/flavor_approval/${fa.id}/sensory`, { ...allPass });
t('only QA records the evaluation', r.status === 403);
token = tech;
r = await post(`/qms/flavor_approval/${fa.id}/sensory`, { ...allPass, texture: '' });
t('a part-checked tasting is refused', r.status === 400);
const BEEF = { appearance: 'Brown, fine', odor: 'Cinnamon sugar', taste: 'Cinnamon sugar, sweet', color: 'Light brown', texture: 'Fine powder' };
r = await post(`/qms/flavor_approval/${fa.id}/sensory`, { ...allPass, sensory_spec_draft: BEEF, sensory_notes: 'good batch' });
body = await J(r);
t('QA records it, and a new flavour DRAFTS ITS OWN SPEC from the scoring step', r.status === 200 && body?.sensory_spec?.status === 'draft' && body.sensory_by === 'QA Tech', JSON.stringify(body).slice(0, 160));
t('the beef spec now exists as a draft', (await J(await req(`/qms/sensory-spec?product=${encodeURIComponent('Beef Cinnamon Sugar')}`)))?.spec?.status === 'draft');
r = await post(`/qms/flavor_approval/${fa.id}/send`, {});
body = await J(r);
t('now it can be sent (a link is issued)', r.status === 200 && !!body?.link, `${r.status} ${JSON.stringify(body).slice(0, 100)}`);
const tokenLink = String(body?.link || '').split('/approve/')[1];
const pub = await J(await fetch(`${B}/submit/flavor-approval/${tokenLink}`));
t('THE APPROVER SEES THE V2 EVALUATION: five results against the spec, complete, with a PASS', pub?.sensory?.shape === 'v2' && pub.sensory.complete === true && pub.sensory.result === 'pass' && pub.sensory.spec?.attributes?.taste === BEEF.taste, JSON.stringify(pub?.sensory).slice(0, 160));
r = await fetch(`${B}/submit/flavor-approval/${tokenLink}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approved', name: 'Danny' }) });
t('the approver decides', r.status === 200, String(r.status));
{ const db = DB(); const rows = db.prepare("SELECT data FROM qms_records WHERE record_type = 'organoleptic' AND json_extract(data, '$.source_flavor_approval_id') = ?").all(fa.id); db.close();
  const d = rows[0] ? JSON.parse(rows[0].data) : null;
  t('ONE TASTING, TWO RECORDS: the Organoleptic record is filed from the decision', rows.length === 1, `${rows.length} rows`);
  t('...as a V2 record, with the spec snapshot and the evaluator', d?.odor === 'pass' && d?.sensory_spec?.attributes?.odor === BEEF.odor && d?.evaluator === 'QA Tech' && d?.aroma === undefined, JSON.stringify(d).slice(0, 160)); }

console.log('\nA V1 record on file still reads');
const v1id = uuid();
{ const db = DB();
  db.prepare("INSERT INTO qms_records (id, record_type, record_number, record_date, data, created_by) VALUES (?, 'organoleptic', 'ORG-V1', '2026-03-01', ?, 'import')")
    .run(v1id, JSON.stringify({ product: 'Old lot', appearance: '4', texture: '4', aroma: '2', flavor: '4', overall: '3' }));
  db.close(); }
const v1 = await J(await req(`/qms/organoleptic/${v1id}`));
t('it is served with its scores', v1?.aroma === '2');
r = await fetch(`${B}/qms/organoleptic/${v1id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
t('its PDF renders (FAIL, below 3)', r.status === 200 && (r.headers.get('content-type') || '').includes('pdf'), String(r.status));
r = await put(`/qms/organoleptic/${v1id}`, { lot: 'corrected' });
body = await J(r);
t('correcting another field on a V1 record does not demand V2 answers', r.status === 200 && body?.aroma === '2' && body?.lot === 'corrected', `${r.status} ${JSON.stringify(body).slice(0, 100)}`);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
