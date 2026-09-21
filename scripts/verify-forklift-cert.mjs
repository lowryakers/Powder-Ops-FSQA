// A forklift certification is two halves and a certificate — end to end.
//
// WHAT WAS WRONG. FORK-101 shipped with the plant's own twenty-question
// written quiz and nothing else, so passing it filed a completion and every
// screen read "trained". 29 CFR 1910.178(l)(2)(ii) asks for formal
// instruction, practical training AND an evaluation of the operator's
// performance in the workplace, and (l)(6) says the employer shall certify
// that each operator has been trained AND evaluated. One of the three,
// recorded as though it were all of them.
//
// So what is asserted is the spine:
//   - passing the written test alone does NOT certify anybody, and the gap is
//     named rather than left as a silent pass;
//   - an evaluation cannot be filed half-answered, self-signed, or dated in
//     the future;
//   - the verdict is DERIVED from the items — any "needs practice" fails;
//   - "not evaluated" is a real answer, must explain itself, and is PRINTED on
//     the certificate rather than quietly dropped;
//   - the certificate is REFUSED while somebody is not certified, and carries
//     the four facts 1910.178(l)(6) names when they are;
//   - an evaluation the plant already did on paper files with its real date.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5004;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'sup') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const get = (p, who) => req(p, {}, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const PW = { sup: 'WandaPW2026!', op: 'GastonPW2026!' };
for (const [id, name, role, dept, code, access] of [
  ['fc-sup', 'Wanda Floor', 'supervisor', 'warehouse', 'SC-FS', '{"training":"edit","pm":"edit"}'],
  ['fc-op', 'Gaston Ruiz', 'operator', 'warehouse', 'SC-FO', '{"pm":"edit"}'],
]) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, access);
}
const signIn = async (who, id, name, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  tok[who] = (await J(await post('/users/login', { name, password: pw })))?.token;
};
await signIn('sup', 'fc-sup', 'Wanda Floor', 'SC-FS', PW.sup);
await signIn('op', 'fc-op', 'Gaston Ruiz', 'SC-FO', PW.op);
t('a supervisor and an operator are signed in', !!tok.sup && !!tok.op);

const courses = await J(await get('/training/courses', 'sup'));
const fork = (courses || []).find(c => c.code === 'FORK-101');
const pj = (courses || []).find(c => c.code === 'PJ-101');
t('the forklift course is flagged as needing a practical evaluation', !!fork?.has_practical);
t('THE PALLET-JACK COURSE IS NOT — whether it needs one is the plant’s call, and no material for it was supplied',
  !!pj && !pj.has_practical);

console.log('\n── the form ──');
const formRes = await J(await get(`/training/courses/${fork.id}/practical`, 'sup'));
const form = formRes?.form;
const items = (form?.sections || []).flatMap(s => s.items);
t('the form is served with its sections and items', items.length >= 15, String(items.length));
t('every item carries Spanish as well — a safety form half the shift cannot read is half a form',
  items.every(i => i.label_es && i.label_es !== i.label));
t('IT IS STAMPED DRAFT AND SAYS SO ON SCREEN — no controlled form has been issued, and a record that did not say so would read as filed against one',
  form.revision === 'DRAFT-1' && form.form_code === null && /Document Control/.test(formRes.draft_note || ''));
const pjForm = await get(`/training/courses/${pj.id}/practical`, 'sup');
t('a course with no evaluation has no form to serve', pjForm.status === 404);

console.log('\n── the written test alone certifies nobody ──');
// Through the REAL door: the course is assigned, and he takes it off his own
// task. He has no Training grant and must not need one — the assignment is
// the authorization, which is the arrangement the assign work shipped.
const assigned = await J(await post('/training/assign', {
  course_id: fork.id, due_date: day(30), people: [{ user_id: 'fc-op', name: 'Gaston Ruiz' }],
}, 'sup'));
const woId = assigned?.created?.[0]?.work_order_id;
t('the forklift course can be assigned, and lands as a task on his own list', !!woId, JSON.stringify(assigned).slice(0, 140));
const key = db.prepare(`SELECT q.id, q.correct_answer FROM training_questions q
  JOIN training_tests t ON t.id = q.test_id WHERE t.course_id = ? AND t.is_current = 1`).all(fork.id);
const right = Object.fromEntries(key.map(q => [q.id, q.correct_answer]));
const attempt = await J(await post(`/pm/work-orders/${woId}/training-test`, { answers: right }, 'op'));
t('Gaston passes the written test and a completion is filed', attempt?.passed === true && !!attempt.record_id, JSON.stringify({ p: attempt?.passed, s: attempt?.score }));

const half = await J(await get(`/training/courses/${fork.id}/certification?user_id=fc-op&name=Gaston%20Ruiz`, 'sup'));
t('AND HE IS STILL NOT CERTIFIED — the written half is one of the three things the rule asks for, and was being recorded as all of them',
  half?.certified === false, JSON.stringify(half?.gaps));
t('the gap is NAMED rather than left silent', (half?.gaps || []).some(g => /practical evaluation/i.test(g)));
t('and the written half is credited, not ignored', !!half?.trained_on && half.training_score >= 80);

const refused = await get(`/training/courses/${fork.id}/certificate.pdf?user_id=fc-op&name=Gaston%20Ruiz`, 'sup');
t('THE CERTIFICATE IS REFUSED — a forklift certificate is laminated and carried, so one that prints while half the certification is missing is a hazard, not a draft',
  refused.status === 409, String(refused.status));
t('and the refusal says what is missing', /practical evaluation/i.test(JSON.stringify(await J(refused))));

console.log('\n── filing the evaluation ──');
const allAnswers = (result = 'competent') => Object.fromEntries(items.map(i => [i.key, { result }]));
const TRUCK = 'Sit-down counterbalance (Class IV/V)';
const header = { employee_name: 'Gaston Ruiz', employee_user_id: 'fc-op', evaluator_name: 'Wanda Floor', truck_type: TRUCK };

const blank = await post(`/training/courses/${fork.id}/practical`, { ...header, evaluated_on: day(0), answers: {} }, 'sup');
const blankBody = await J(blank);
t('AN EVALUATION CANNOT BE FILED HALF-ANSWERED — blank items read later as though those tasks were watched',
  blank.status === 400 && (blankBody.missing || []).length >= items.length, String((blankBody.missing || []).length));

const future = await post(`/training/courses/${fork.id}/practical`, { ...header, evaluated_on: day(3), answers: allAnswers() }, 'sup');
t('nor dated in the future — that is a record of something that has not happened', future.status === 400);

const selfSigned = await post(`/training/courses/${fork.id}/practical`,
  { ...header, evaluator_name: 'Gaston Ruiz', evaluated_on: day(0), answers: allAnswers() }, 'sup');
t('NOR SIGNED BY THE OPERATOR THEMSELVES — the standard asks for an observer, and one name in both boxes is a record of nobody having watched',
  selfSigned.status === 400, String(selfSigned.status));

const noReason = { ...allAnswers(), [items[0].key]: { result: 'not_evaluated' } };
const naBlank = await J(await post(`/training/courses/${fork.id}/practical`, { ...header, evaluated_on: day(0), answers: noReason }, 'sup'));
t('"Not evaluated" has to explain itself — without a reason it is a box nobody read',
  (naBlank?.missing || []).some(m => /not evaluated/i.test(m)), JSON.stringify(naBlank?.missing || []).slice(0, 120));

const unsigned = await post(`/training/courses/${fork.id}/practical`, { ...header, evaluated_on: day(0), answers: allAnswers() }, 'sup');
const unsignedBody = await J(unsigned);
t('A COMPLETE EVALUATION STILL ASKS FOR THE PASSWORD — 403 and signature_required, never a 401 that would sign the evaluator out mid-form',
  unsigned.status === 403 && unsignedBody.signature_required === true, `${unsigned.status} ${JSON.stringify(unsignedBody).slice(0, 80)}`);

const opTry = await post(`/training/courses/${fork.id}/practical`,
  { ...header, employee_name: 'Someone Else', evaluated_on: day(0), answers: allAnswers(), signature_password: PW.op }, 'op');
t('an operator cannot sign an evaluation of anybody', opTry.status === 403, String(opTry.status));

// One item honestly not evaluated — no trailer on the dock.
const realAnswers = { ...allAnswers(), trailer_secured: { result: 'not_evaluated', note: 'No trailer on the dock today' } };
const filed = await J(await post(`/training/courses/${fork.id}/practical`,
  { ...header, evaluated_on: day(0), answers: realAnswers, signature_password: PW.sup }, 'sup'));
t('with the password it files', filed?.evaluation?.id && filed.graded.result === 'pass', JSON.stringify(filed?.graded || filed).slice(0, 140));
t('the record is stamped with the form revision it was filed against', filed.evaluation.form_revision === 'DRAFT-1');
t('and with who signed it', filed.evaluation.signed_by === 'Wanda Floor' && !!filed.evaluation.signed_at);
t('the item nobody watched is kept BY NAME, not dropped', (filed.evaluation.not_evaluated || []).some(i => i.key === 'trailer_secured'));

console.log('\n── the verdict is derived from the items ──');
const failAnswers = { ...allAnswers(), fork_height: { result: 'needs_practice' }, pedestrians: { result: 'needs_practice' } };
const failed = await J(await post(`/training/courses/${fork.id}/practical`,
  { employee_name: 'Nipsi Batchman', evaluator_name: 'Wanda Floor', truck_type: 'Stand-up reach truck (Class II)',
    evaluated_on: day(0), answers: failAnswers, signature_password: PW.sup }, 'sup'));
t('ANY "needs practice" FAILS the evaluation — a partial pass is not competence to operate a powered industrial truck',
  failed?.graded?.result === 'fail', JSON.stringify(failed?.graded || failed).slice(0, 120));
t('and the failing tasks are NAMED, so the retraining is not guesswork',
  (failed.graded.needs_practice || []).map(n => n.key).sort().join(',') === 'fork_height,pedestrians');
t('a failed evaluation certifies nobody', failed.certification?.certified === false);

console.log('\n── certified, and the certificate ──');
const cert = await J(await get(`/training/courses/${fork.id}/certification?user_id=fc-op&name=Gaston%20Ruiz`, 'sup'));
t('BOTH HALVES ON FILE ⇒ certified', cert?.certified === true, JSON.stringify(cert?.gaps));
// 1910.178(l)(6) names exactly four facts. Each is asserted by name.
t('the certification carries the operator’s name', cert.employee_name === 'Gaston Ruiz');
t('the date of the training', cert.trained_on === day(0));
t('the date of the evaluation', cert.evaluated_on === day(0));
t('and who performed the training and the evaluation', !!cert.trained_by && cert.evaluated_by === 'Wanda Floor');
t('it names the truck it was earned on — being put on a different type is its own reason to re-evaluate', !!cert.truck_type);
t('THE RE-EVALUATION CLOCK RUNS THREE YEARS FROM THE EVALUATION, per 1910.178(l)(4)(iii)',
  cert.expires_on === new Date(new Date(`${day(0)}T00:00:00Z`).setUTCMonth(new Date(`${day(0)}T00:00:00Z`).getUTCMonth() + 36)).toISOString().slice(0, 10),
  cert.expires_on);

const pdf = await get(`/training/courses/${fork.id}/certificate.pdf?user_id=fc-op&name=Gaston%20Ruiz`, 'sup');
const bytes = Buffer.from(await pdf.arrayBuffer());
t('the certificate renders', pdf.status === 200 && bytes.slice(0, 4).toString() === '%PDF', `${pdf.status} ${bytes.length}b`);
t('as a real download, not a page', /attachment; filename=/.test(pdf.headers.get('content-disposition') || ''));

// READ BACK OUT OF THE PDF, not counted in bytes. A certificate that renders
// and is missing one of the four facts the rule names is a certificate that
// does not certify, and a size check would pass on it happily.
const { extractInvoiceText } = await import('../server/invoice-text.js');
const printed = String((await extractInvoiceText(bytes, 'cert.pdf', 'application/pdf')) || '');
for (const [what, needle] of [
  ['the operator\u2019s name', 'Gaston Ruiz'],
  ['the date of the training', 'DATE OF TRAINING'],
  ['who delivered the training', 'TRAINING DELIVERED BY'],
  ['the date of the evaluation', 'DATE OF EVALUATION'],
  ['who evaluated them', 'Wanda Floor'],
  ['the truck it was earned on', 'Sit-down counterbalance'],
  ['when it has to be redone', 'RE-EVALUATION DUE BY'],
  ['and the rule it is issued under', '1910.178(l)(6)'],
]) t(`the printed certificate carries ${what}`, printed.includes(needle), printed.slice(0, 80));

t('THE TASK NOBODY WATCHED IS PRINTED BY NAME WITH ITS REASON — the flattering version of this document would leave it out',
  /NOT EVALUATED ON THIS OCCASION/.test(printed) && /No trailer on the dock today/.test(printed));
t('and the certificate says the evaluation form is still a draft rather than implying an issued number',
  /not yet issued/.test(printed) && /DRAFT-1/.test(printed));
t('the cut-out operator card is on the same page — it is what somebody is actually asked for on the floor',
  /operator card/.test(printed) && /FORKLIFT OPERATOR/.test(printed));

console.log('\n── the roster is the punch list ──');
const roster = await J(await get(`/training/courses/${fork.id}/certifications`, 'sup'));
t('everybody with any record on the course is listed, certified or not', (roster?.people || []).length >= 2);
t('every count is the length of the rows returned, so a card cannot disagree with the list under it',
  roster.counts.certified === roster.people.filter(p => p.certified).length
  && roster.counts.needs_evaluation === roster.people.filter(p => p.gaps.some(g => /practical evaluation/i.test(g))).length,
  JSON.stringify(roster.counts));
t('Gaston reads certified and Nipsi does not', roster.people.find(p => p.employee_name === 'Gaston Ruiz')?.certified === true
  && roster.people.find(p => p.employee_name === 'Nipsi Batchman')?.certified === false);

console.log('\n── an evaluation done on paper keeps its own date ──');
const paper = await J(await post(`/training/courses/${fork.id}/practical`,
  { employee_name: 'Osvaldo Reyes', evaluator_name: 'Wanda Floor', truck_type: 'Sit-down counterbalance (Class IV/V)',
    evaluated_on: day(-120), answers: allAnswers(), source: 'paper', signature_password: PW.sup }, 'sup'));
t('NOBODY IS ASKED TO RE-WATCH A DRIVER THEY WATCHED IN MAY — a paper evaluation files with the date it actually happened',
  paper?.evaluation?.evaluated_on === day(-120) && paper.evaluation.source === 'paper');
t('and the record says it came off paper rather than looking like it was filed on the day', paper.evaluation.source === 'paper');

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// Wanda is a supervisor with the Training grant: the person who actually runs
// an evaluation, not an admin.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok.sup, { id: 'fc-sup', name: 'Wanda Floor', role: 'supervisor', department: 'warehouse' }]);
await page.goto(`${URL}/?tab=training&view=certifications`);
const onTab = await page.waitForSelector('[data-certifications]', { timeout: 20000 }).then(() => true).catch(() => false);
t('the Operator certification tab renders for the supervisor who runs the evaluations', onTab,
  (await page.locator('body').innerText()).slice(0, 90).replace(/\n/g, ' '));

if (onTab) {
  const body = await page.locator('[data-certifications]').innerText();
  t('Gaston reads certified and offers his certificate',
    await page.locator('[data-print-cert="Gaston Ruiz"]').count() > 0, body.slice(0, 160));
  t('and somebody with only the written test is offered an EVALUATION rather than a certificate — the row names the work, not the gap alone',
    await page.locator('[data-evaluate="Nipsi Batchman"]').count() > 0);
  await page.locator('[data-new-evaluation]').click();
  await page.waitForSelector('[data-practical-modal]', { timeout: 10000 });
  t('the evaluation form opens', await page.locator('[data-practical-modal]').isVisible());
  t('IT SAYS THE FORM IS A DRAFT, on the screen and not only in the code',
    /Document Control/.test(await page.locator('[data-practical-draft]').innerText()));
  t('every item offers all three answers, so "not evaluated" is as reachable as a pass',
    await page.locator('[data-eval-pick$=":not_evaluated"]').count() === items.length,
    `${await page.locator('[data-eval-pick$=":not_evaluated"]').count()} of ${items.length}`);
  // Picking "not evaluated" has to ask why, right there.
  await page.locator(`[data-eval-pick="${items[0].key}:not_evaluated"]`).click();
  await page.waitForTimeout(150);
  t('choosing "not evaluated" asks for the reason on the spot',
    await page.locator(`[data-eval-note="${items[0].key}"]`).count() === 1);
  // And the server's refusal is rendered as a list, not a bare error.
  await page.locator('[data-eval-operator]').fill('Someone New');
  await page.locator('[data-eval-evaluator]').fill('Wanda Floor');
  await page.selectOption('[data-eval-truck]', TRUCK);
  await page.locator('[data-eval-sign]').click();
  const named = await page.waitForSelector('[data-eval-missing]', { timeout: 10000 }).then(() => true).catch(() => false);
  t('SUBMITTING HALF A FORM NAMES WHAT IS STILL NEEDED rather than failing with one line',
    named, named ? (await page.locator('[data-eval-missing]').innerText()).slice(0, 100) : 'no list');
}

// The phone: this is filled in standing next to the lift.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok.sup, { id: 'fc-sup', name: 'Wanda Floor', role: 'supervisor', department: 'warehouse' }]);
await phone.goto(`${URL}/?tab=training&view=certifications`);
const onPhone = await phone.waitForSelector('[data-certifications]', { timeout: 20000 }).then(() => true).catch(() => false);
if (onPhone) {
  await phone.locator('[data-new-evaluation]').click();
  await phone.waitForSelector('[data-practical-modal]', { timeout: 10000 });
  const over = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  t('the form works at 390px with no sideways scroll — it is filled in beside the machine, not at a desk', !over);
} else { fail++; console.log('  ✗ the certification screen never rendered on a phone'); }

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
