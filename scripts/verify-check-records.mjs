// A scheduled check files a record (D-060), end to end on a live server:
// the two new schedules seed; the EMP, GMP-walk and list-review tasks carry a
// check_form; completion is refused until the form is satisfied and files the
// record when it is; laboratory results grade against FORM 604-01, an action
// level raises one CAR and only one; a repeated walk-through finding raises a
// CAR; the readiness review and the bell read the same rows; and the Quality
// Schedules tabs show it all in a real browser. Caller sets PORT + DBPATH;
// needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4982; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('cr-qa','Maria Check','Maria Check','supervisor','qa',1,'SC-CQ',datetime('now','+7 day'),'{"pm":"edit","quality-schedules":"edit","sanitation":"edit"}')`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('cr-op','Omar Check','Omar Check','operator','warehouse',1,'SC-CO',datetime('now','+7 day'),'{"pm":"view","quality-schedules":"view"}')`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (name, id, pw, code) => { await call('POST', '/users/login', { name }); await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code }); return (await (await call('POST', '/users/login', { name, password: pw })).json()); };
const qa = await login('Maria Check', 'cr-qa', 'Quality2026!', 'SC-CQ');
const op = await login('Omar Check', 'cr-op', 'Operator2026!', 'SC-CO');
t('Quality and an operator signed in', !!qa?.token && !!op?.token);
const A = qa.token, O = op.token;
const sqlite = () => new Database(dbPath);

console.log('\n── the schedules ship, and their tasks know what they must carry ──');
const scheds = await (await call('GET', '/quality-schedules', null, A)).json();
const byTitle = (s) => scheds.find(x => x.title === s);
t('the weekly GMP walk-through and the annual list review are seeded', !!byTitle('Weekly GMP Walk-through') && byTitle('Weekly GMP Walk-through').frequency_type === 'weekly' && byTitle('Banned/Prohibited Substance List Review')?.frequency_type === 'annual');
// housekeeping generated today's tasks at boot; find them
const grouped = await (await call('GET', '/pm/by-frequency?group=qa', null, A)).json();
const all = Object.values(grouped).flat();
const find = (title) => all.find(w => w.title === title);
const empRoom = find('EMP Zone 1 Swabs — Room Surfaces'), empZ2 = find('EMP Zone 2 Swabs (Salmonella / Listeria)'), walk = find('Weekly GMP Walk-through'), review = find('Banned/Prohibited Substance List Review'), audit = find('Internal Audit (Form 403-01)');
t('the EMP, walk-through and list-review tasks exist in the Task Center', !!empRoom && !!empZ2 && !!walk && !!review, JSON.stringify(all.map(w => w.title)));
t('each carries a check_form of the right kind', empRoom?.check_form?.kind === 'emp' && empRoom.check_form.zone === 'zone1' && walk?.check_form?.kind === 'gmp_walk' && review?.check_form?.kind === 'banned_list_review');
t('Zone 2 offers the site list off FORM 604-01; Zone 1 has two tests', empZ2?.check_form?.sites?.includes('Control Panel') && empRoom.check_form.tests.length === 2);
t('a task that is not one of these carries no check_form', audit && !audit.check_form);
const opTasks = await (await call('GET', '/pm/operator-tasks?group=qa', null, A)).json();
t('the Operator View payload carries the same check_form', opTasks.find(w => w.id === walk.id)?.check_form?.kind === 'gmp_walk');
t('the walk-through is stamped as a DRAFT checklist', walk.check_form.draft === true && walk.check_form.revision === 'DRAFT-1');

console.log('\n── completing an EMP sampling task ──');
let r = await call('POST', '/pm/work-orders/batch-complete', { ids: [empRoom.id] }, A);
let j = await r.json();
t('batch-complete skips it and says why', j.completed === 0 && j.skipped?.[0]?.reason?.includes('files a record'));
r = await call('POST', `/pm/work-orders/${empRoom.id}/complete-and-recur`, { notes: 'swabbed' }, A);
j = await r.json();
t('completing with no sites is refused and names what is missing', r.status === 400 && j.requires_check === true && j.missing?.[0]?.key === 'sites', JSON.stringify(j).slice(0, 200));
r = await call('POST', `/pm/work-orders/${empRoom.id}/complete-and-recur`, { check: { sites: ['Blender 1', 'Table in Room 1', 'blender 1'], lab: 'CTLA' } }, A);
j = await r.json();
t('with two sites it completes and files 2 sites × 2 tests = 4 pending samples', r.status === 200 && j.check_record?.kind === 'emp' && j.check_record.ids.length === 4 && j.check_record.sites === 2, JSON.stringify(j).slice(0, 200));
let sum = await (await call('GET', '/check-records/emp/summary', null, A)).json();
t('the summary counts 4 awaiting a result, and the count is the rows', sum.pending_count === 4 && sum.pending.length === 4);
const tab = sum.pending.find(s => s.site === 'Blender 1' && s.test === 'Total Aerobic Bacteria Count');
const ym = sum.pending.find(s => s.site === 'Blender 1' && s.test === 'Total Yeast and Mold Count');
t('each row carries the form revision it was sampled under', tab?.form_revision === 'FORM 604-01 V1' && tab.lab === 'CTLA');

console.log('\n── entering the laboratory\'s results ──');
r = await call('POST', `/check-records/emp/samples/${tab.id}/result`, { result_value: '250' }, O);
t('an operator cannot enter a result', r.status === 403);
r = await call('POST', `/check-records/emp/samples/${tab.id}/result`, { result_value: 'maybe' }, A);
t('an unreadable result is refused in words, not filed as pending', r.status === 400 && /Could not read/.test((await r.json()).error));
r = await call('POST', `/check-records/emp/samples/${tab.id}/result`, { result_value: '250' }, A); j = await r.json();
t('250 CFU on a Zone 1 TAB swab grades OK and freezes the limits on the row', j.outcome === 'ok' && j.sample.alert_limit === '>300 CFU/cm²' && j.sample.action_limit === '>1000 CFU/cm²');
const capasBefore = sqlite().prepare('SELECT COUNT(*) c FROM capas').get().c;
r = await call('POST', `/check-records/emp/samples/${ym.id}/result`, { result_value: '160' }, A); j = await r.json();
t('160 CFU yeast & mold grades ALERT (alert >150, action >500)', j.outcome === 'alert' && !j.capa);
const table = sum.pending.find(s => s.site === 'Table in Room 1' && s.test === 'Total Aerobic Bacteria Count');
r = await call('POST', `/check-records/emp/samples/${table.id}/result`, { result_value: '1,200' }, A); j = await r.json();
t('1,200 CFU grades ACTION and raises a CAR', j.outcome === 'action' && /^CAPA-\d+$/.test(j.capa?.capa_number || ''), JSON.stringify(j).slice(0, 200));
r = await call('POST', `/check-records/emp/samples/${table.id}/result`, { result_value: '1300' }, A); j = await r.json();
t('re-entering a corrected value never raises a second CAR', j.capa === null && sqlite().prepare('SELECT COUNT(*) c FROM capas').get().c === capasBefore + 1);
let bell = await (await call('GET', '/compliance/notifications', null, A)).json();
const bellItems = bell.items || bell;
t('the bell names the action-level result with no corrective action', JSON.stringify(bellItems).includes('emp-action'));
r = await call('PUT', `/check-records/emp/samples/${table.id}/corrective-action`, { corrective_action: 'ok' }, A);
t('a corrective action under 3 characters is refused', r.status === 400);
r = await call('PUT', `/check-records/emp/samples/${table.id}/corrective-action`, { corrective_action: 'Table re-cleaned and re-swabbed; hold on lot 4471 pending re-swab.' }, A);
sum = await (await call('GET', '/check-records/emp/summary', null, A)).json();
t('recording it clears the open-action count and leaves one result awaited', r.status === 200 && sum.open_action_count === 0 && sum.pending_count === 1);

console.log('\n── a result the plant already holds, filed by hand ──');
r = await call('POST', '/check-records/emp/samples', { zone: 'water', site: 'Kitchen tap', test: 'Total Coliforms', sampled_on: '2026-03-04', result_value: 'Absent', lab: 'CTLA' }, A); j = await r.json();
t('a March water result files as OK, graded like any other', r.status === 201 && j.sample.outcome === 'ok' && j.sample.source === 'manual');
r = await call('POST', '/check-records/emp/samples', { zone: 'water', site: 'Kitchen tap', test: 'Total Yeast and Mold Count', sampled_on: '2026-03-04' }, A);
t('a test the form does not list for that zone is refused', r.status === 400);
r = await call('POST', '/check-records/emp/samples', { zone: 'air', site: 'Room 1', test: 'Settle plate', sampled_on: '2099-01-01', result_value: '12' }, A);
t('a future sample date is refused', r.status === 400);
r = await call('POST', '/check-records/emp/samples', { zone: 'air', site: 'Room 1', test: 'Settle plate', sampled_on: '2026-02-10', result_value: '12' }, A); j = await r.json();
t('an air result records as information only — the form sets no limit', j.sample.outcome === 'info');
const list = await (await call('GET', '/check-records/emp/samples?zone=water', null, A)).json();
t('the log filters by zone', list.samples.length === 1 && list.samples[0].site === 'Kitchen tap');

console.log('\n── the weekly GMP walk-through ──');
const walkBody = (footwear, note) => ({ check: { area: 'Production 1 and 2', items: { gowning: { result: 'c' }, hairnets: { result: 'c' }, jewelry: { result: 'na' }, handwashing: { result: 'c' }, footwear: { result: footwear, note } } } });
r = await call('POST', `/pm/work-orders/${walk.id}/complete-and-recur`, { check: { area: 'Production 1', items: { gowning: { result: 'c' } } } }, A); j = await r.json();
t('a walk with items unanswered is refused and names them', r.status === 400 && j.missing.some(m => m.key === 'footwear'));
r = await call('POST', `/pm/work-orders/${walk.id}/complete-and-recur`, walkBody('nc', ''), A); j = await r.json();
t('a not-compliant item with nothing written is refused', r.status === 400 && j.missing.some(m => m.key === 'footwear_note'));
r = await call('POST', `/pm/work-orders/${walk.id}/complete-and-recur`, walkBody('nc', 'Two visitors in street shoes past the line'), A); j = await r.json();
t('the walk completes and files its record with one not-compliant item and NO CAR', r.status === 200 && j.check_record?.kind === 'gmp_walk' && j.check_record.nc_count === 1 && j.check_record.capas.length === 0);
// A second week's task, raised the way housekeeping would raise it.
{ const db = sqlite(); const s = db.prepare("SELECT id FROM quality_schedules WHERE title = 'Weekly GMP Walk-through'").get();
  db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status) VALUES ('cr-walk-2', 'Weekly GMP Walk-through', 'x', 'normal', date('now'), '[]', 'qa', ?, 'open')`).run(s.id); db.close(); }
r = await call('POST', '/pm/work-orders/cr-walk-2/complete-and-recur', walkBody('nc', 'Still no covers at the door'), A); j = await r.json();
t('the SAME item not compliant on the next walk raises a CAR', r.status === 200 && j.check_record.capas.length === 1);
const walks = await (await call('GET', '/check-records/gmp-walks', null, A)).json();
t('two walks on record, DRAFT-1 stamped, the second carrying its CAR', walks.walks.length === 2 && walks.walks.every(w => w.checklist_revision === 'DRAFT-1') && walks.walks[0].capa_ids.length === 1);
t('the CAR names the walk-through as its source', sqlite().prepare("SELECT COUNT(*) c FROM capas WHERE source_type = 'GMP Walk-through'").get().c === 1);

console.log('\n── the annual banned-list review ──');
r = await call('POST', `/pm/work-orders/${review.id}/complete-and-recur`, { check: { editions: { wada: '2026 Prohibited List' }, changes_found: 'none' } }, A); j = await r.json();
t('a review missing three editions and the actions is refused', r.status === 400 && j.missing.length === 4);
r = await call('POST', `/pm/work-orders/${review.id}/complete-and-recur`, { check: { editions: { nsf306_annex_c: 'Annex C, 2025 edition', nfl_nflpa: 'NFL-NFLPA 2026', mlb: 'MLB 2026', wada: '2026 Prohibited List' }, changes_found: 'Two stimulants added to WADA S6', actions_taken: 'Checked against approved materials — none present', materials_rechecked: true } }, A); j = await r.json();
t('the review files with all four editions', r.status === 200 && j.check_record?.kind === 'banned_list_review');
const lr = await (await call('GET', '/check-records/list-reviews', null, A)).json();
t('the latest review is the record of the editions in use', lr.current?.editions?.wada === '2026 Prohibited List' && lr.reviews.length === 1 && lr.reviews[0].materials_rechecked === 1);

console.log('\n── the review and the audit trail read the same rows ──');
const rev = await (await call('GET', '/compliance/readiness-review', null, A)).json();
const sec = (title) => rev.sections.find(s => s.title === title);
t('the EMP section counts graded results against samples', sec('Environmental Monitoring (EMP)')?.items.some(i => /of \d+ samples have a graded result/.test(i.label)));
t('the GMP walk-through section reads the last walk and its open CAR', sec('GMP walk-through')?.items.some(i => /Last GMP walk-through 0 day/.test(i.label)) && sec('GMP walk-through').items.some(i => /1 CAR\(s\) open/.test(i.label)));
t('the GMP for Sport section reads the documented list review', sec('NSF GMP for Sport (Audit Guide)')?.items.some(i => /lists reviewed 0 day/.test(i.label)));
{ const db = sqlite();
  const acts = db.prepare("SELECT action FROM audit_log WHERE action IN ('emp_result_entered','emp_sample_filed','emp_corrective_action')").all().map(a => a.action);
  t('results, manual filings and corrective actions are audited', acts.includes('emp_result_entered') && acts.includes('emp_sample_filed') && acts.includes('emp_corrective_action'));
  const wo = db.prepare("SELECT status FROM work_orders WHERE id = ?").get(empRoom.id);
  t('the sampling task itself reads completed', wo.status === 'completed');
  db.close(); }

console.log('\n── in the browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, qa.user]);
await page.goto(`${URL}/?tab=quality-schedules&view=emp`);
await page.waitForSelector('[data-emp-results]', { timeout: 15000 });
await page.waitForSelector('[data-emp-pending="1"]', { timeout: 15000 }).catch(() => {});
t('the EMP results tab opens with one result awaited and the site trend', (await page.locator('[data-emp-pending]').getAttribute('data-emp-pending')) === '1' && await page.locator('[data-emp-site-row]').count() >= 3,
  `pending=${await page.locator('[data-emp-pending]').getAttribute('data-emp-pending')} rows=${await page.locator('[data-emp-site-row]').count()}`);
await page.locator('[data-emp-result-input]').first().fill('40');
await page.locator('[data-emp-result-save]').first().click();
await page.waitForTimeout(1500);
t('entering the last result from the screen clears the awaited list', (await page.locator('[data-emp-pending]').getAttribute('data-emp-pending')) === '0');
t('the log shows the action-level row in red with its CAR number', await page.locator('[data-outcome="action"]').count() >= 1 && /CAPA-\d+/.test(await page.locator('[data-emp-results]').innerText()));
await page.getByRole('tab', { name: 'GMP walks' }).click();
await page.waitForSelector('[data-gmp-walks]');
t('the GMP walks tab lists both walks with the not-compliant note', (await page.locator('[data-gmp-walk]').count()) === 2 && /Still no covers/.test(await page.locator('[data-gmp-walks]').innerText()));
await page.getByRole('tab', { name: 'List reviews' }).click();
await page.waitForSelector('[data-list-current="1"]', { timeout: 15000 }).catch(() => {});
t('the list reviews tab shows the editions in use', /2026 Prohibited List/.test(await page.locator('[data-list-current]').innerText()));
// The Task Center form asks for the check's fields and holds Complete until they are answered.
await page.goto(`${URL}/?tab=pm`);
await page.waitForTimeout(3000);
const z2Title = page.locator('text=EMP Zone 2 Swabs (Salmonella / Listeria)').first();
if (await z2Title.count()) {
  // The card's own Done button, not the first Done on the page.
  const card = z2Title.locator('xpath=ancestor::div[.//button[normalize-space()="Done"]][1]');
  await card.getByRole('button', { name: 'Done' }).first().click();
  await page.waitForTimeout(800);
}
const fields = await page.locator('[data-check-fields="emp"]').count();
t('the Task Center completion form renders the EMP site picker', fields >= 1, `found ${fields}`);
if (fields) {
  const submit = page.getByRole('button', { name: /Complete & Generate Next/ }).first();
  t('Complete is held until a site is ticked', await submit.isDisabled());
  await page.locator('[data-emp-site="Control Panel"]').first().click();
  t('and released once one is', !(await submit.isDisabled()));
}
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
