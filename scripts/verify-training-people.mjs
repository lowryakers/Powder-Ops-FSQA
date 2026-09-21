// Training, turned ninety degrees — and the documents people are trained on.
//
// Document Control asked for two things: to see the assigned trainings for one
// individual, and to train on the SOPs, Work Instructions and Job Descriptions
// that apply to each department and individual.
//
// What was found on the way:
//   1. `training_requirements` has been in the schema and READ BY THE MATRIX
//      since the matrix was built, and nothing has ever written to it — the
//      per-individual half of "who needs this course" existed and was
//      unreachable from any screen.
//   2. NOT ONE of the twenty courses used `sop_id`, including the seven whose
//      code IS a work-instruction number. So retrain-on-document-change was
//      wired, tested and pointing at nothing.
//   3. Neither a role nor a department can express a JOB DESCRIPTION, which
//      applies to whoever holds one position and to nobody else.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5012;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const del = (p) => req(p, { method: 'DELETE' });

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('tp-dc','Dana Control','Dana Control','supervisor','document_control',1,'SC-TP',datetime('now','+7 day'),'{"training":"edit"}')`).run();
await post('/users/set-password', { user_id: 'tp-dc', password: 'DanaPW2026!', setup_code: 'SC-TP' });
tok = (await J(await post('/users/login', { name: 'Dana Control', password: 'DanaPW2026!' })))?.token;
t('Document Control signs in', !!tok);

// A warehouse operator, and the work instruction + job description the plant
// would have in its register.
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access)
  VALUES ('tp-op','Wendy Ware','Wendy Ware','operator','warehouse',1,'{"training":"view"}')`).run();
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, training_revision, status)
  VALUES ('tp-wi','work_instruction','WI 007','Auger Stick Pack Machine','production','V3','V3','active')`).run();
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status)
  VALUES ('tp-jd','job_description','JD-WHSE','Warehouse Associate','admin','V2','active')`).run();
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status)
  VALUES ('tp-ref','reference','REF-XYZ','Somebody else''s standard','other','9','active')`).run();
db.prepare(`INSERT INTO org_positions (id, title, name, department, user_id, job_description_ids, sort_order)
  VALUES ('tp-pos','Warehouse Associate','Wendy Ware','warehouse','tp-op','["tp-jd"]', 1)`).run();
db.prepare(`INSERT INTO org_positions (id, title, name, department, job_description_ids, sort_order)
  VALUES ('tp-vac','Night Warehouse Associate',NULL,'warehouse','["tp-jd"]', 2)`).run();

console.log('\n── one person, not a grid ──');
const person = await J(await req('/training/people/tp-op'));
t('a person’s whole training picture answers in one request',
  person?.user?.name === 'Wendy Ware' && Array.isArray(person.rows) && person.rows.length > 0, JSON.stringify(person?.user));
t('every figure on it reconciles with the rows under it — the count and the list come from one walk',
  person.applies === person.rows.filter(r => r.state !== 'exempt').length
  && person.outstanding === person.rows.filter(r => ['missing', 'overdue', 'due_soon', 'outdated'].includes(r.state)).length);
t('EVERY ROW SAYS WHY IT APPLIES — "why am I being asked to do this" is answerable on the record instead of in somebody’s head',
  person.rows.every(r => ['everyone', 'role', 'department', 'position', 'named', 'exempt'].includes(r.why)),
  [...new Set(person.rows.map(r => r.why))].join(','));
t('…and a warehouse course reaches her by department', person.rows.some(r => r.code === 'WI001' && r.why === 'department'));

const roster = await J(await req('/training/people'));
t('the roster lines up with the person view, so the list and the drill-down cannot disagree',
  roster.find(p => p.id === 'tp-op')?.outstanding === person.outstanding);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,external_org,module_access)
  VALUES ('tp-guest','Gus Guest','Gus Guest','operator','client',1,1,'M4 Dynamic',NULL)`).run();
const roster2 = await J(await req('/training/people'));
t('A GUEST ACCOUNT IS NOT ON THE TRAINING ROSTER — an external account holds no module and reaches no task, so a course it "owes" is training nobody will ever be handed',
  !roster2.some(p => p.id === 'tp-guest') && roster2.length === roster.length,
  `${roster2.length} vs ${roster.length}`);

console.log('\n── the exception that had no door ──');
const forkId = db.prepare("SELECT id FROM training_courses WHERE code = 'FORK-101'").get().id;
const before = person.rows.find(r => r.course_id === forkId);
t('the forklift course reaches her today', before && before.state !== 'exempt', before?.why);
const ex = await post(`/training/courses/${forkId}/requirements`, { user_id: 'tp-op', rule: 'exempt' });
t('THE PER-PERSON EXCEPTION FINALLY HAS A DOOR — `training_requirements` has been read by the compliance matrix since the matrix was built and nothing has ever written to it',
  ex.status === 200, String(ex.status));
const afterEx = await J(await req('/training/people/tp-op'));
t('…an exemption takes the course off what she owes AND out of the denominator, so the counts never claim work that was never owed',
  afterEx.rows.find(r => r.course_id === forkId)?.state === 'exempt' && afterEx.applies === person.applies - 1,
  `${afterEx.applies} vs ${person.applies}`);
const matrix = await J(await req('/training/matrix'));
t('…and the MATRIX says the same thing, because both read one walk',
  matrix.matrix['tp-op'].cells[forkId]?.state === 'exempt');
await del(`/training/courses/${forkId}/requirements/tp-op`);
t('…removing the exception puts the course back under the course’s own rule',
  (await J(await req('/training/people/tp-op'))).rows.find(r => r.course_id === forkId)?.state !== 'exempt');
t('a rule that is neither required nor exempt is refused rather than stored',
  (await post(`/training/courses/${forkId}/requirements`, { user_id: 'tp-op', rule: 'maybe' })).status === 400);

console.log('\n── the courses and the register were two lists that never met ──');
const cov = await J(await req('/training/documents'));
t('NOT ONE COURSE NAMED A DOCUMENT — retrain-on-document-change was wired, tested, and pointing at nothing',
  cov.covered === 0, `${cov.covered} covered`);
t('a reference standard is not a document people are trained on, so it is not on the list',
  !cov.documents.some(d => d.doc_number === 'REF-XYZ'));
t('THE LINK IS OFFERED WITH ITS EVIDENCE, derived on every read — WI007 the course, WI 007 the document, one number written two ways',
  cov.linkable.some(l => l.code === 'WI007' && l.doc_number === 'WI 007'), JSON.stringify(cov.linkable));
const linked = await J(await post('/training/documents/link', {}));
t('…linking them is one act', linked.linked.length === 1 && linked.linked[0].code === 'WI007');
const cov2 = await J(await req('/training/documents'));
t('…and the offer clears itself, because it is derived rather than stored', cov2.linkable.length === 0);
t('…and the coverage figure moves with it', cov2.covered === cov.covered + 1);
t('LINKING DECLARES NOBODY OUTDATED — a completion keeps the revision it was actually taken against, and filling that in from today’s revision would be a fabricated record',
  db.prepare("SELECT COUNT(*) c FROM training_records WHERE sop_revision IS NOT NULL").get().c === 0);
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status)
  VALUES ('tp-old','work_instruction','WI 012','Cleaning the Auger Stick Pack Machine','production','V1','superseded')`).run();
t('A SUPERSEDED DOCUMENT IS NEVER OFFERED AS THE BASIS — training is written against a document that is in force, and the WI012 course keeps waiting for the current revision',
  !(await J(await req('/training/documents'))).linkable.some(l => l.code === 'WI012'));
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status)
  VALUES ('tp-dup','work_instruction','WI-012','Cleaning the Auger (duplicate number)','production','V2','active')`).run();
db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status)
  VALUES ('tp-dup2','work_instruction','WI 012','Cleaning the Auger (second copy)','production','V2','active')`).run();
const amb = await J(await req('/training/documents'));
t('…and TWO documents claiming one number are REPORTED, never guessed between: a link to the wrong document retrains the plant against the wrong revision',
  amb.ambiguous_links.some(a => a.code === 'WI012') && !amb.linkable.some(l => l.code === 'WI012'),
  JSON.stringify(amb.ambiguous_links));
db.prepare("DELETE FROM sop_documents WHERE id IN ('tp-old','tp-dup','tp-dup2')").run();

console.log('\n── a job description is the audience neither a role nor a department can express ──');
const positions = await J(await req('/training/positions'));
t('the org chart is offered as an audience', positions.some(p => p.id === 'tp-pos' && p.held));
t('…and a position NOBODY HOLDS says so rather than looking like a mistake — a course aimed at it is waiting for the job to be filled',
  positions.find(p => p.id === 'tp-vac')?.held === false);
const jdDoc = cov2.documents.find(d => d.id === 'tp-jd');
t('a job description carries its own audience: the positions that cite it',
  jdDoc.suggested_positions.length === 2 && jdDoc.suggested_positions.some(p => p.id === 'tp-pos'));
const made = await post('/training/documents/tp-jd/course', { required_positions: ['tp-pos'] });
t('a course opens FOR the document, taking its number and title from the register', made.status === 201, String(made.status));
const jdCourse = await J(made);
t('…and is linked to it, so revising the job description retrains its holder', jdCourse.sop_id === 'tp-jd');
const withJd = await J(await req('/training/people/tp-op'));
t('IT REACHES THE PERSON WHO HOLDS THE JOB, and says that is why — no role or department list can say "whoever holds this position"',
  withJd.rows.find(r => r.course_id === jdCourse.id)?.why === 'position');
const other = await J(await req('/training/people/tp-dc'));
t('…and reaches nobody else', !other.rows.some(r => r.course_id === jdCourse.id));
t('a second course on the same document is refused — "who is trained on this" must have one answer',
  (await post('/training/documents/tp-jd/course', {})).status === 409);
t('a reference standard cannot be made into a course', (await post('/training/documents/tp-ref/course', {})).status === 400);

console.log('\n── the audience follows the job, not the person ──');
db.prepare("UPDATE org_positions SET user_id = 'tp-dc' WHERE id = 'tp-pos'").run();
const moved = await J(await req('/training/people/tp-dc'));
const left = await J(await req('/training/people/tp-op'));
t('SOMEBODY ELSE TAKES THE JOB AND THE TRAINING FOLLOWS IT, with nothing re-keyed — that is why the audience is the position and not the person',
  moved.rows.some(r => r.course_id === jdCourse.id) && !left.rows.some(r => r.course_id === jdCourse.id));
db.prepare("UPDATE org_positions SET user_id = 'tp-op' WHERE id = 'tp-pos'").run();

console.log('\n── the document moving under a completion ──');
const wiCourse = db.prepare("SELECT id FROM training_courses WHERE code = 'WI007'").get().id;
db.prepare(`INSERT INTO training_records (id, employee_name, employee_user_id, training_topic, course_id, training_date, completion_date, status, sop_revision, superseded)
  VALUES ('tp-rec','Wendy Ware','tp-op','Auger Stick Pack Machine', ?, date('now','-10 day'), date('now','-10 day'), 'completed', 'V3', 0)`).run(wiCourse);
db.prepare("UPDATE training_courses SET required_departments = '[\"warehouse\"]' WHERE id = ?").run(wiCourse);
t('a completion against the current revision reads as current',
  (await J(await req('/training/people/tp-op'))).rows.find(r => r.course_id === wiCourse)?.state === 'current');
db.prepare("UPDATE sop_documents SET training_revision = 'V4' WHERE id = 'tp-wi'").run();
const outdated = (await J(await req('/training/people/tp-op'))).rows.find(r => r.course_id === wiCourse);
t('REVISING THE DOCUMENT PUTS HER BACK ON THE LIST, naming both revisions — the whole point of the link, and it could not fire while no course named a document',
  outdated?.state === 'outdated' && outdated.sop_revision === 'V3' && outdated.current_revision === 'V4',
  JSON.stringify({ s: outdated?.state, was: outdated?.sop_revision, now: outdated?.current_revision }));
t('…and it counts as work still owed, not as a completion',
  (await J(await req('/training/people/tp-op'))).outstanding > 0);

console.log('\n── an operator sees the module, not the levers ──');
const dcTok = tok;
db.prepare("UPDATE users SET setup_code = 'SC-OP', setup_code_expires_at = datetime('now','+7 day') WHERE id = 'tp-op'").run();
await post('/users/set-password', { user_id: 'tp-op', password: 'WendyPW2026!', setup_code: 'SC-OP' });
tok = (await J(await post('/users/login', { name: 'Wendy Ware', password: 'WendyPW2026!' })))?.token;
t('a view-only account may read who owes what', (await req('/training/people/tp-op')).status === 200);
t('…and may NOT decide that somebody is exempt from a course — the same Edit grant assigning training needs',
  (await post(`/training/courses/${forkId}/requirements`, { user_id: 'tp-op', rule: 'exempt' })).status === 403);
t('…nor open a course against a document', (await post('/training/documents/tp-wi/course', {})).status === 403);
tok = dcTok;

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [dcTok, { id: 'tp-dc', name: 'Dana Control', role: 'supervisor', department: 'document_control', module_access: { training: 'edit' } }]);
await page.goto(`${URL}/?tab=training&view=people`);

const tabShown = await page.getByRole('tab', { name: /By person/i }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
t('Training carries a By person view', tabShown);
const row = page.locator('[data-training-person-row="Wendy Ware"]');
t('…listing the plant', await row.waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
if (await row.count()) {
  await row.click();
  const detail = page.locator('[data-training-person="Wendy Ware"]');
  await detail.waitFor({ timeout: 10000 });
  const text = (await detail.innerText()).replace(/\n/g, ' ');
  t('ONE PERSON’S TRAINING ON ONE SCREEN, with the reason beside each course',
    /The job they hold/.test(text) && /Their department/.test(text), text.slice(0, 200));
  t('…and the document that moved is named on the row, not left as a bare "overdue"',
    /document is now V4/i.test(text), text.slice(0, 260));
}

await page.goto(`${URL}/?tab=training&view=documents`);
const docRow = page.locator('[data-doc-row="JD-WHSE"]');
t('a Documents view lists the register and what trains on it',
  await docRow.waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
if (await docRow.count()) {
  t('…and a job description names who holds it, vacancy included',
    /vacant/i.test(await docRow.innerText()), (await docRow.innerText()).replace(/\n/g, ' ').slice(0, 200));
}
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
t('no sideways page scroll at 390px', overflow <= 1, `${overflow}px`);
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
