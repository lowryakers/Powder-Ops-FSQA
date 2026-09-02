// Two defects Maria and the floor found on one screen.
//
// 1. "QA Verified: No" beside "Verified by Maria Servin". The tile rendered
//    `rinse_verified` — a step of the CLEANING procedure — under QA's label, so
//    a counter-signed record contradicted itself. Two facts, one label, and the
//    wrong one. Asserted here at the DATA level: the two columns are
//    independent, and verifying a record moves only one of them.
//
// 2. The chemical dilution form demanded an Area, and the only options were
//    production rooms. The app itself files those records under
//    "Chemical Verification" every day — a value its own picker did not offer.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4905;
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
const { SANITATION_AREAS, canonicalArea, NON_PRODUCTION_AREAS } = await import('../server/sanitation-areas.js');
const { recordAreaForTask } = await import('../server/qa-records.js');

const PW = 'SanPW2026!';
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('sa-qa','San QA','San QA','admin','qa',1,'SC-SA',datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'San QA' });
await post('/users/set-password', { user_id: 'sa-qa', password: PW, setup_code: 'SC-SA' });
token = (await J(await post('/users/login', { name: 'San QA', password: PW })))?.token;
t('QA signed in', !!token);

console.log('\nThe picker offers every area the app files under');
{
  const values = SANITATION_AREAS.map(a => a.value);
  t('Chemical Verification is offered', values.includes('Chemical Verification'));
  t('Production is offered', values.includes('Production'));
  t('neither can raise a 72-hour re-clean', NON_PRODUCTION_AREAS.has('Chemical Verification') && NON_PRODUCTION_AREAS.has('Production'));
  const list = await J(await req('/structure/lists/sanitation_areas'));
  const opts = (list?.options || []).map(o => o.value);
  t('and the SEEDED list carries them, so the form can pick them',
    opts.includes('Chemical Verification') && opts.includes('Production'), opts.join('|'));
}

console.log('\nA dilution with no room can now be filed');
{
  const r = await post('/sanitation', {
    area: 'Chemical Verification', type: 'pre_op', performed_by: 'Zuleika Nava',
    chemicals_used: 'Dawn Professional Heavy Duty', concentration: '1 tsp to 2.5 gal water', result: 'pass',
  });
  const rec = await J(r);
  t('the record is accepted', r.ok, `got ${r.status}`);
  t('and stored under that exact area', rec?.area === 'Chemical Verification', `got ${rec?.area}`);
  t('an area is still REQUIRED — blank is refused', (await post('/sanitation', {
    area: '', type: 'pre_op', performed_by: 'X', result: 'pass' })).status === 400);
}

console.log('\nOne area, one spelling — the task path no longer bypasses canonicalArea');
{
  t('the task title maps to the old singular', recordAreaForTask('Restroom Daily Cleaning') === 'Restroom');
  t('and canonicalArea folds it onto the picker value', canonicalArea('Restroom') === 'Restrooms');
  // The filing path applies it, so a completed restroom clean lands on the
  // same area a hand-filed one does.
  const r = await post('/sanitation', { area: 'Restroom', type: 'pre_op', performed_by: 'X', result: 'pass' });
  const rec = await J(r);
  t('a record filed as "Restroom" is stored as "Restrooms"', rec?.area === 'Restrooms', `got ${rec?.area}`);
}

console.log('\nRinse verified and QA verified are different facts');
let id = null;
{
  const rec = await J(await post('/sanitation', {
    area: '7', type: 'pre_op', performed_by: 'Zuleika Nava', result: 'pass', rinse_verified: false }));
  id = rec?.id;
  t('a record files with rinse_verified false', rec?.rinse_verified === 0, `got ${rec?.rinse_verified}`);
  t('and unverified by QA', !rec?.verified_by);

  const v = await put(`/sanitation/${id}/verify`, { signature_password: PW });
  const after = await J(v);
  t('QA verifies it', v.ok, `got ${v.status}`);
  t('verified_by is now set', !!after?.verified_by, `got ${after?.verified_by}`);
  // THE ASSERTION THAT MATTERS: verifying moved QA's column and left the
  // cleaning-procedure column exactly where the operator put it. The screen
  // used to read the second one under QA's label.
  t('RINSE_VERIFIED IS UNTOUCHED BY QA VERIFICATION', after?.rinse_verified === 0,
    `got ${after?.rinse_verified}`);
  t('so "QA Verified" derived from verified_by reads Yes', !!after?.verified_by);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
