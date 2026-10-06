// verify:outofcal — D-154, live on a fresh database and a real browser.
//
// Two minors from the 29–30 Sep 2026 SQF audit that ReadyDoc had no field for:
//  - 11.2.3.4: "disposition of product measured by an out-of-calibration device
//    was not documented". A calibration that fails or is adjusted to pass, and a
//    daily scale check that fails, now owe a product disposition. Filing is never
//    refused; the record files as owed and QA is told until somebody decides.
//  - 2.6.4.2: "the crisis test did not document its impact on product and
//    materials". An evacuation now carries a product and material impact
//    assessment beside Form 501-02, dated when written (an addendum says so).
//
// Caller sets PORT + DBPATH (server up). Needs a built client. The control is
// `main`: there is no /calibration/dispositions route and no impact route.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5072);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
const mkUser = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,?,?,datetime('now','+7 day'),?)`);
mkUser.run('oc-admin', 'Occ Admin', 'Occ Admin', 'admin', 'office', 1, 'SC-oca', null);
mkUser.run('oc-qa', 'Qala Lead', 'Qala Lead', 'supervisor', 'qa', 1, 'SC-ocq', JSON.stringify({ calibration: 'edit', safety: 'edit' }));
mkUser.run('oc-op', 'Ware Floorhand', 'Ware Floorhand', 'operator', 'warehouse', 1, 'SC-oco', JSON.stringify({ calibration: 'edit', safety: 'edit' }));
db.prepare(`INSERT OR REPLACE INTO calibration_instruments (id, name, type, asset_number, department, status, next_due)
  VALUES ('oc-inst','Verify Checkweigher','Metal Detector','999','KITTING','active', date('now','+300 days'))`).run();
// The last good calibration, a month back — where the window of doubt opens.
db.prepare(`INSERT OR REPLACE INTO calibration_records (id, instrument_id, calibrated_by, calibrated_at, result)
  VALUES ('oc-good','oc-inst','Tech', datetime('now','-30 days'), 'pass')`).run();
const goodAt = db.prepare("SELECT calibrated_at FROM calibration_records WHERE id='oc-good'").get().calibrated_at;
// A failure filed before this existed: history, never on the bell.
db.prepare(`INSERT OR REPLACE INTO calibration_records (id, instrument_id, calibrated_by, calibrated_at, result)
  VALUES ('oc-hist','oc-inst','Tech', datetime('now','-200 days'), 'fail')`).run();
// An evacuation from April, assessed only now.
// The scale's last passing check, yesterday.
db.prepare(`INSERT OR REPLACE INTO scale_verifications (id, form_code, form_title, performed_by, performed_at, readings, result)
  VALUES ('oc-scale-good','417-03','Scale Verification — Stick Filling','Floor', datetime('now','-1 day'), '[]', 'pass')`).run();
db.prepare(`INSERT OR REPLACE INTO evacuation_headcounts (id, form_revision, event_date, is_drill, areas, completed_by, created_by)
  VALUES ('oc-evac-april','V1','2026-04-23',1,'[]','Office','Office')`).run();
db.close();

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name, code) => {
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: code });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const adm = await login('oc-admin', 'Occ Admin', 'SC-oca');
const qa = await login('oc-qa', 'Qala Lead', 'SC-ocq');
const op = await login('oc-op', 'Ware Floorhand', 'SC-oco');
const A = (m, p, b) => c(m, p, b, adm?.token);
const Q = (m, p, b) => c(m, p, b, qa?.token);
const O = (m, p, b) => c(m, p, b, op?.token);
t('admin, QA lead and a warehouse operator sign in', !!(adm?.token && qa?.token && op?.token));

const bell = async (call, id) => ((await J(await call('GET', '/compliance/notifications')))?.items || []).find(i => i.id === id)?.count || 0;

console.log('\n── 11.2.3.4: a calibration that fails owes a product disposition ──');
let r = await Q('GET', '/calibration/dispositions');
const disp0 = await J(r);
t('the open-findings list exists and says QA may decide', r.status === 200 && Array.isArray(disp0?.pending) && disp0.can_decide === true, `status ${r.status}`);
t('the five answers are served', Object.keys(disp0?.dispositions || {}).join(',') === 'not_used,no_impact,retested_released,on_hold,rejected');
t('a failure filed before this rule is listed as history, not as new work',
  disp0?.not_recorded?.some(x => x.id === 'oc-hist') && !disp0?.pending?.some(x => x.id === 'oc-hist'));
const bell0 = await bell(Q, 'product-disposition');
t('history does not ring the bell', bell0 === 0, `count ${bell0}`);

r = await Q('POST', '/calibration/records', { instrument_id: 'oc-inst', calibrated_by: 'Tech', result: 'pass' });
let rec = await J(r);
t('a passing calibration owes nothing', r.status === 201 && rec.disposition_state === 'not_required' && !rec.disposition);

r = await Q('POST', '/calibration/records', { instrument_id: 'oc-inst', calibrated_by: 'Tech', result: 'fail', reading_before: '+4 g' });
const failRec = await J(r);
t('a FAILED calibration still files — the evidence is never refused', r.status === 201);
t('…and it files as owed', failRec?.disposition === 'pending' && failRec?.disposition_state === 'pending', JSON.stringify(failRec?.disposition));
// The pass filed a moment ago is the last good check before this failure.
t('the window opens at the last good calibration before it', !!failRec?.affected_since && failRec.affected_since >= goodAt, failRec?.affected_since);
const pend1 = (await J(await Q('GET', '/calibration/dispositions'))).pending;
t('it is in the open list', pend1.some(x => x.id === failRec.id && x.source === 'calibration'));
t('QA\'s bell names it', (await bell(Q, 'product-disposition')) === bell0 + 1);
t('a warehouse operator\'s bell does not', (await bell(O, 'product-disposition')) === 0);

r = await O('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'not_used', notes: 'Not used' });
t('a warehouse operator cannot decide it (403) — even holding the Calibration edit grant', r.status === 403);
r = await Q('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'not_used' });
t('an answer with nothing said about the product is refused', r.status === 400 && /assessed/i.test((await J(r))?.error || ''));
r = await Q('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'on_hold', notes: 'Lots 101700-101702 held' });
t('"placed on hold" without the hold number is refused, naming it', r.status === 400 && /On Hold or deviation number/.test((await J(r))?.error || ''));
r = await Q('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'on_hold', notes: 'Lots 101700-101702 held', ref: 'OH-009' });
rec = await J(r);
t('QA records it: placed on hold, OH-009', r.status === 200 && rec.disposition_state === 'recorded' && rec.disposition_label === 'Affected product placed on hold' && rec.disposition_ref === 'OH-009');
t('…signed by the person who decided, with a date', rec.disposition_by === 'Qala Lead' && !!rec.disposition_at);
t('it leaves the open list and the bell', !(await J(await Q('GET', '/calibration/dispositions'))).pending.some(x => x.id === failRec.id)
  && (await bell(Q, 'product-disposition')) === bell0);
r = await Q('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'no_impact', notes: 'second thoughts' });
t('a recorded decision is not rewritten by QA (409)', r.status === 409);
r = await A('POST', `/calibration/dispositions/calibration/${failRec.id}`, { disposition: 'rejected', notes: 'Lots destroyed after retest', ref: 'DSP-12' });
t('an admin can correct it', r.status === 200 && (await J(r)).disposition === 'rejected');
const actions = (() => { const d = new Database(process.env.DBPATH, { readonly: true });
  try { return d.prepare('SELECT action FROM audit_log WHERE entity_type = ? AND entity_id = ?').all('calibration_record', failRec.id).map(x => x.action); }
  finally { d.close(); } })();
t('both acts are in the audit trail', JSON.stringify(actions).includes('product_disposition') && JSON.stringify(actions).includes('disposition_corrected'), JSON.stringify(actions));
const passRec = (await J(await Q('GET', '/calibration/records?instrument_id=oc-inst'))).find(x => x.result === 'pass' && x.id !== 'oc-good');
r = await Q('POST', `/calibration/dispositions/calibration/${passRec.id}`, { disposition: 'not_used', notes: 'n/a' });
t('a passing record refuses a disposition — there is nothing to dispose of', r.status === 400);

const before = (await J(await Q('GET', '/calibration/records?instrument_id=oc-inst'))).length;
r = await Q('POST', '/calibration/records', { instrument_id: 'oc-inst', calibrated_by: 'Tech', result: 'adjusted_pass',
  product_disposition: { disposition: 'no_impact' } });
t('an incomplete disposition offered at filing is refused before anything is written',
  r.status === 400 && (await J(await Q('GET', '/calibration/records?instrument_id=oc-inst'))).length === before);
r = await Q('POST', '/calibration/records', { instrument_id: 'oc-inst', calibrated_by: 'Tech', result: 'adjusted_pass',
  product_disposition: { disposition: 'no_impact', notes: 'Off by 0.2 g against a 5 g tolerance' } });
rec = await J(r);
t('"adjusted to pass" owes one too, and can be recorded on the same form', r.status === 201 && rec.disposition === 'no_impact' && rec.disposition_by === 'Qala Lead');

console.log('\n── 11.2.3.4: a failed daily scale check owes one as well ──');
const forms = (await J(await Q('GET', '/scale-verification/forms'))).forms;
const f = forms.find(x => x.code === '417-03') || forms[0];
const good = f.points.map(p => p.nominal);
const bad = f.points.map(p => p.nominal + p.tolerance * 20);
r = await Q('POST', '/scale-verification', { form_code: f.code, performed_by: 'Qala Lead', readings: good });
t('a passing scale check owes nothing', (await J(r))?.disposition_state === 'not_required');
r = await fetch(`${B}/submit/scale-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ form_code: f.code, performed_by: 'Floor Person', readings: bad }) });
let sc = await J(r);
const scId = sc?.id || sc?.record?.id;
const scRow = (await J(await Q('GET', `/scale-verification?form_code=${f.code}`))).find(x => x.id === scId);
t('a FAILED check from the kiosk files as owed', r.status < 300 && scRow?.disposition === 'pending', JSON.stringify({ status: r.status, d: scRow?.disposition }));
t('…its window opens at the passing check before it', !!scRow?.affected_since);
t('…and it is in the same open list as the calibrations', (await J(await Q('GET', '/calibration/dispositions'))).pending.some(x => x.id === scId && x.source === 'scale'));
r = await Q('POST', `/calibration/dispositions/scale/${scId}`, { disposition: 'retested_released', notes: 'Lots 101710, 101711 reweighed on #85, in spec' });
t('QA records it through the same door', r.status === 200);
t('the scale log reads it back', (await J(await Q('GET', `/scale-verification?form_code=${f.code}`))).find(x => x.id === scId)?.disposition_label === 'Affected product retested and released');

console.log('\n── 2.6.4.2: an evacuation records its product and material impact ──');
const sf = await J(await Q('GET', '/safety/forms'));
t('the Safety forms carry the impact section, labelled as not on Form 501-02', /not on Form 501-02/.test(sf?.impact?.source || '') && sf.impact.can_assess === true);
t('…and the operator is told they cannot assess it', (await J(await O('GET', '/safety/forms')))?.impact?.can_assess === false);
t('the crisis contacts and headcount form are still served unchanged', !!sf?.crisis?.contacts?.length && !!sf?.evacuation?.work_areas?.length);
const evBell0 = await bell(Q, 'evac-impact');
r = await Q('POST', '/safety/evacuations', { event_date: new Date().toISOString().slice(0, 10), is_drill: true });
const ev = await J(r);
t('a headcount files without an impact, and reads as missing', r.status === 201 && ev.impact_state === 'missing' && ev.impact === null);
t('QA\'s bell counts it', (await bell(Q, 'evac-impact')) === evBell0 + 1, `before ${evBell0}`);
let rv = await J(await Q('GET', '/compliance/readiness-review'));
const safetyItems = (rv?.sections || []).find(s => s.title === 'Safety')?.items || [];
t('the readiness review names the evacuation with no impact', safetyItems.some(i => i.status === 'warning' && /no product and material impact/.test(i.label)), JSON.stringify(safetyItems.map(i => i.label)));
r = await O('POST', `/safety/evacuations/${ev.id}/impact`, { product_exposed: 'no', summary: 'All sealed' });
t('the operator cannot write it (403)', r.status === 403);
const nEv = (await J(await O('GET', '/safety/evacuations'))).length;
r = await O('POST', '/safety/evacuations', { event_date: '2026-10-01', impact: { product_exposed: 'no', summary: 'x x x' } });
t('…nor slip one in with a new headcount — refused out loud, and nothing is filed', r.status === 403 && (await J(await O('GET', '/safety/evacuations'))).length === nEv);
r = await Q('POST', `/safety/evacuations/${ev.id}/impact`, { product_exposed: 'yes', summary: 'Blender 1 was running' });
t('"affected" with no product named or nothing said about what was done is refused', r.status === 400 && /Name the product/.test((await J(r))?.error || ''));
r = await Q('POST', `/safety/evacuations/${ev.id}/impact`, { product_exposed: 'no', summary: 'Lines stopped, product lidded, dock doors shut before leaving.' });
let evr = await J(r);
t('QA records it the same day: recorded, not an addendum', r.status === 200 && evr.impact_state === 'recorded' && evr.impact?.product_exposed === 'no' && evr.impact_by === 'Qala Lead');
t('the bell drops by one', (await bell(Q, 'evac-impact')) === evBell0);
rv = await J(await Q('GET', '/compliance/readiness-review'));
t('the readiness review now reads good for the latest evacuation', ((rv?.sections || []).find(s => s.title === 'Safety')?.items || [])
  .some(i => i.status === 'good' && /impact recorded/.test(i.label)));
r = await Q('POST', '/safety/evacuations/oc-evac-april/impact', { product_exposed: 'yes', summary: 'Batching was mid-blend when the alarm sounded.',
  affected: 'MO76712 blend in Blender 2', disposition: 'Held and inspected, released — OH-004' });
evr = await J(r);
t('the April drill gets its assessment now — and it says it is an addendum', r.status === 200 && evr.impact_state === 'addendum');
t('…dated today, never back-dated to April', String(evr.impact_at).slice(0, 10) === new Date().toISOString().slice(0, 10));

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // Leave one open finding for the screen to show.
  const r2 = await J(await Q('POST', '/calibration/records', { instrument_id: 'oc-inst', calibrated_by: 'Tech', result: 'fail' }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
  await page.goto(`${URL}/?tab=calibration`);
  await page.waitForSelector('[data-open-dispositions]', { timeout: 15000 }).catch(() => {});
  const strip = await page.locator('[data-open-dispositions]').innerText().catch(() => '');
  t('Calibration Management opens with the open findings strip', /1 out-of-calibration finding needs/.test(strip), strip.slice(0, 120));
  await page.click(`[data-disposition-open="${r2.id}"]`);
  await page.click(`#disp-${r2.id}-not_used`);
  await page.fill(`#disp-${r2.id}-notes`, 'Checkweigher #999 was locked out the whole week.');
  await page.click('[data-disposition-save]');
  await page.waitForTimeout(1200);
  const strip2 = await page.locator('[data-open-dispositions]').innerText().catch(() => '');
  t('recording it from the strip clears it', /No new findings/.test(strip2), strip2.slice(0, 120));
  t('…and the earlier failure is offered as history, collapsed', await page.locator('[data-disposition-history-toggle]').count() === 1);
  await page.goto(`${URL}/?tab=calibration&view=records`);
  await page.waitForTimeout(1500);
  t('the records list shows the decision as a chip', await page.locator('[data-disposition-chip="recorded"]').count() >= 1);
  await page.goto(`${URL}/?tab=calibration&view=instruments`);
  await page.waitForTimeout(1500);
  await page.locator('button:visible', { hasText: 'Calibrate' }).first().click();
  await page.waitForTimeout(400);
  const sel = page.locator('form select').first();
  t('the Record Calibration form asks nothing extra on a pass', await page.locator('[data-calibrate-disposition]').count() === 0);
  await sel.selectOption('fail');
  t('…and offers the disposition the moment the result is Fail', await page.locator('[data-calibrate-disposition]').count() === 1);

  await page.goto(`${URL}/?tab=safety&view=evacuations`);
  await page.waitForTimeout(1500);
  const missing = await page.locator('[data-impact-state="missing"]').count();
  t('Safety → Evacuations names the evacuations with no impact recorded', missing >= 1, `${missing}`);
  t('the April drill reads as an addendum', await page.locator('[data-impact-state="addendum"]').count() >= 1);
  const firstOpen = page.locator('[data-impact-open]').first();
  const evId = await firstOpen.getAttribute('data-impact-open');
  await firstOpen.click();
  await page.click(`#impact-${evId}-no`);
  await page.fill(`#impact-${evId}-summary`, 'Nothing was running; the warehouse doors were shut.');
  await page.click('[data-impact-save]');
  await page.waitForTimeout(1200);
  t('recording one from the screen replaces the warning with the assessment',
    (await page.locator('[data-impact-state="missing"]').count()) === missing - 1);

  const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await phone.goto(`${URL}/manifest.webmanifest`);
  await phone.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
  for (const path of ['?tab=calibration', '?tab=safety&view=evacuations']) {
    await phone.goto(`${URL}/${path}`);
    await phone.waitForTimeout(1500);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    t(`no sideways scroll at 390px on ${path}`, w <= 390, `${w}px`);
  }
} finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
