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


// ─────────────────────────────────────────────────────────────────────────────
// THE PICKER IS A SECOND OWNER OF THE VOCABULARY (D-118).
//
// The record form's Area dropdown reads the managed list `sanitation_areas`;
// the 72-hour rule and the normalizer read SANITATION_AREAS. Nothing compared
// them, so Normalize cleaned the records while the form went on offering
// "Room 7 (72 hr) cleanning" the next morning — and that spelling, the plant's
// own dominant one, was REFUSED by the suffix rule because the word follows the
// bracket. Planted below exactly as the 25 September capture photographed them.
console.log('\nThe Area dropdown has options the area list does not know');
const STRAYS = ['Room 7 (72 hr) cleanning', 'Room 8 (72 hr) cleanning', 'Sanitizer Dilution', 'Simple Green', 'Simple green'];
{
  const db = new Database(process.env.DBPATH);
  const ins = db.prepare("INSERT OR IGNORE INTO app_list_options (id,list_key,value,label,sort_order,is_active) VALUES (?,'sanitation_areas',?,?,?,1)");
  STRAYS.forEach((v, i) => ins.run(`stray-${i}`, v, v, 90 + i));
  // Two cleans filed under the plant's spelling, and one under a chemical name.
  const rec = db.prepare(`INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, entered_at, result, record_group, notes)
    VALUES (?, ?, 'pre_op', 'Zuleika Nava', datetime('now', ?), datetime('now'), 'pass', 'sanitation', 'planted')`);
  rec.run('stray-rec-1', 'Room 7 (72 hr) cleanning', '-3 hours');
  rec.run('stray-rec-2', 'Room 7 (72 hr) cleanning', '-1 day');
  rec.run('stray-rec-3', 'Simple Green', '-2 hours');
  db.close();

  const before = await J(await req('/structure/lists/sanitation_areas'));
  const offered = (before?.options || []).map(o => o.value);
  t('the form offers every planted stray — this is the state the plant is in', STRAYS.every(v => offered.includes(v)));

  const plan = await J(await req('/sanitation/areas/preview'));
  const strays = plan?.picker?.strays || [];
  t('the preview REPORTS the picker’s strays, not only the records', strays.length === 5, `${strays.length}: ${strays.map(x => x.value).join(' | ')}`);
  const r7 = strays.find(x => x.value === 'Room 7 (72 hr) cleanning');
  t('"Room 7 (72 hr) cleanning" FOLDS to Room 7 — the plant’s spelling, refused before', r7?.folds_to === '7', JSON.stringify(r7));
  t('…and the preview counts the two records filed under it', r7?.records === 2, `${r7?.records}`);
  t('"Room 8 (72 hr) cleanning" folds to the retired Room 8', strays.find(x => x.value === 'Room 8 (72 hr) cleanning')?.folds_to === '8');
  t('"Simple Green" and "Sanitizer Dilution" do NOT fold — a chemical is not a room and the app will not guess',
    ['Simple Green', 'Simple green', 'Sanitizer Dilution'].every(v => strays.find(x => x.value === v)?.folds_to === null));
  t('the RECORD changes include the two Room 7 rows', plan.changes.some(c => c.from === 'Room 7 (72 hr) cleanning' && c.to === '7' && c.records === 2));
  t('and the Simple Green record is left exactly as filed', plan.unmatched.some(u => u.area === 'Simple Green'));
  t('nothing canonical is missing from the picker', (plan.picker.missing || []).length === 0, (plan.picker.missing || []).join(','));
}

console.log('\nApply folds the records AND retires the duplicate options');
{
  const r = await J(await post('/sanitation/areas/normalize', {}));
  t('two records moved onto Room 7', r?.updated >= 2, `${r?.updated}`);
  const retiredVals = (r?.retired || []).map(x => x.value).sort();
  t('THE TWO FOLDABLE OPTIONS ARE RETIRED WITH THEM', JSON.stringify(retiredVals) === JSON.stringify(['Room 7 (72 hr) cleanning', 'Room 8 (72 hr) cleanning']), retiredVals.join(' | '));
  const after = await J(await req('/structure/lists/sanitation_areas'));
  const offered = (after?.options || []).map(o => o.value);
  t('the form no longer offers them tomorrow morning', !offered.includes('Room 7 (72 hr) cleanning') && !offered.includes('Room 8 (72 hr) cleanning'));
  t('the three the app cannot place are STILL offered — reported, never removed by the app', ['Simple Green', 'Simple green', 'Sanitizer Dilution'].every(v => offered.includes(v)));
  t('…and are still reported after Apply', (r?.picker?.strays || []).length === 3);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const moved = d.prepare("SELECT area FROM sanitation_records WHERE id IN ('stray-rec-1','stray-rec-2')").all().map(x => x.area);
  const left = d.prepare("SELECT area FROM sanitation_records WHERE id = 'stray-rec-3'").get().area;
  const retiredRows = d.prepare("SELECT value, is_active FROM app_list_options WHERE id IN ('stray-0','stray-1')").all();
  const audit = d.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'app_list_option' AND action = 'retire' AND entity_id IN ('stray-0','stray-1')").get().c;
  d.close();
  t('the records are stored under the canonical token 7', moved.every(a => a === '7'), moved.join(','));
  t('the Simple Green record is untouched', left === 'Simple Green');
  t('retired, not deleted — the rows survive with is_active = 0', retiredRows.length === 2 && retiredRows.every(x => x.is_active === 0));
  t('each retirement is its own audit entry', audit === 2, `${audit}`);
  // The point of all of it: the 72-hour rule can now see the clean.
  const status = await J(await req('/sanitation/reclean-status'));
  const rooms = Array.isArray(status) ? status : (status?.rooms || []);
  const room7 = rooms.find(x => String(x.room) === '7' || String(x.area) === '7');
  const lastClean = room7 && (room7.last_clean_at || room7.last_clean || room7.last_cleaned_at || room7.last_passed_at);
  t('and the 72-hour rule now sees Room 7’s clean from three hours ago', !!lastClean, JSON.stringify(room7 || null).slice(0, 160));
}

console.log('\nRetiring one the app cannot place is a person’s act, with a reason');
{
  const plan = await J(await req('/sanitation/areas/preview'));
  const lower = plan.picker.strays.find(x => x.value === 'Simple green');
  t('no reason → refused', (await post('/sanitation/areas/retire-option', { id: lower.id })).status === 400);
  const canon = await J(await req('/structure/lists/sanitation_areas'));
  const room7opt = (canon.options || []).find(o => o.value === '7');
  const refused = await post('/sanitation/areas/retire-option', { id: room7opt.id, reason: 'testing' });
  t('a REAL area is refused here — that is a Settings act, not a tidy-up', refused.status === 400, `${refused.status}`);
  const ok = await J(await post('/sanitation/areas/retire-option', { id: lower.id, reason: 'Duplicate spelling of Simple Green; a chemical, not an area' }));
  t('with a reason, the duplicate "Simple green" leaves the dropdown', ok?.ok === true && ok?.option?.is_active === 0);
  t('…and says how many records were left as filed', typeof ok?.records_left_as_filed === 'number');
  const after = await J(await req('/structure/lists/sanitation_areas'));
  t('the form no longer offers it', !(after.options || []).some(o => o.value === 'Simple green'));
  t('Room 7 is still offered', (after.options || []).some(o => o.value === '7'));

  // RETIRING NEVER TOUCHES HISTORY (fix doc A7, 5 Oct): a clean filed under
  // "Simple Green" stays filed under it, readable, and the option row is kept
  // retired rather than deleted, so the record still resolves.
  const sg = plan.picker.strays.find(x => x.value === 'Simple Green');
  const res = await J(await post('/sanitation/areas/retire-option', { id: sg.id, reason: 'A chemical, not an area (fix doc A7)' }));
  t('retiring "Simple Green" reports the one record it left as filed', res?.records_left_as_filed === 1, JSON.stringify(res?.records_left_as_filed));
  const rec = await J(await req('/sanitation/stray-rec-3'));
  t('…and that record is still there, still reading "Simple Green"', rec?.area === 'Simple Green');
  const dbr = new Database(process.env.DBPATH, { readonly: true });
  const row = dbr.prepare("SELECT is_active FROM app_list_options WHERE list_key = 'sanitation_areas' AND value = 'Simple Green'").get();
  dbr.close();
  t('the option row is retired, not deleted', row && row.is_active === 0);
}

console.log('\nIn a real browser: the strip names the strays where the log is');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  page.on('dialog', d => d.accept('Not an area — it is a chemical'));
  const URL = `http://localhost:${PORT}`;
  await page.goto(`${URL}/manifest.webmanifest`);
  const me = await J(await req('/users/me'));
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [token, me]);
  await page.goto(`${URL}/?tab=sanitation`);
  await page.waitForTimeout(4000);
  const title = page.locator('[data-area-strip-title]');
  t('the strip is on the Sanitation screen with only strays left (no records to fold)', await title.count() === 1 && /1 option\b/.test(await title.innerText().catch(() => '')), (await title.innerText().catch(() => '')).slice(0, 120));
  await page.getByText('Review', { exact: true }).click().catch(() => {});
  await page.waitForTimeout(500);
  t('it lists Sanitizer Dilution, and not Simple Green (retired above)', await page.locator('[data-area-stray="Sanitizer Dilution"]').count() === 1 && await page.locator('[data-area-stray="Simple Green"]').count() === 0);
  t('with a Retire button each, and no Apply — nothing left that the app may decide alone', await page.locator('[data-area-stray-retire]').count() === 1 && await page.locator('[data-area-apply]').count() === 0);
  await page.locator('[data-area-stray="Sanitizer Dilution"] [data-area-stray-retire]').click();
  await page.waitForTimeout(1500);
  t('retiring the last one from the screen clears the strip without a reload — the state A7 asks the plant to reach', await page.locator('[data-area-stray="Sanitizer Dilution"]').count() === 0 && await page.locator('[data-area-strip-title]').count() === 0);
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
