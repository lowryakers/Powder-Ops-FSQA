// verify:trainingupdate — finishing the training update (D-269 … D-273).
//
//   - Restore: the records the edit bug failed go back to completed, by an admin,
//     with a reason; a real fail and a low-score fail to check are left alone.
//   - Competence is REQUIRED: a passed quiz or the trainer's tick, on the record
//     form, the group entry, Group Sheets and the task card.
//   - The group entry picks people by department and role, Select all, then untick.
//   - Group Sheets asks the same how-it-was-trained fields; recorded date/by stay locked.
//   - Bots and not-a-trainee accounts stay out of retraining counts, reminders and
//     Most missed.
//   - An unused auditor account that duplicates a staff name is not a trainee (Carol).
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: main before this — a record with neither quiz nor tick saves (201),
// there is no restore route (404), and the picker has no Select all.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 5162);
const DBP = process.env.DBPATH || process.env.DB_PATH;
process.env.DB_PATH = DBP; // the modules imported below read the same file
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, extra = {}) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access,not_trainee)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?,?)`).run(id, name, extra.username || name, role, dept, `SC-${id}`,
  JSON.stringify({ training: 'edit' }), extra.not_trainee ? 1 : 0);
mk('tu-admin', 'Una Admin', 'admin', 'qa');
mk('tu-sup', 'Sid Super', 'supervisor', 'qa');
mk('tu-w1', 'Wes Warehouse', 'operator', 'warehouse');
mk('tu-w2', 'Wren Warehouse', 'operator', 'warehouse');
mk('tu-w3', 'Walt Warehouse', 'supervisor', 'warehouse');
mk('tu-c1', 'Cleo Cleaning', 'operator', 'cleaning');
mk('tu-bot', '*Update Bot', 'operator', 'warehouse', { not_trainee: true });
const course = db.prepare("SELECT id, title, passing_score FROM training_courses WHERE active = 1 AND COALESCE(has_test, 0) = 0 ORDER BY code LIMIT 1").get();
const pass80 = course.passing_score ?? 80;
let H_DB = db;
const one = (sql, ...a) => H_DB.prepare(sql).get(...a);

const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Update2026!!xx', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Update2026!!xx' })).json;
};
const admin = await signIn('Una Admin', 'tu-admin');
const sup = await signIn('Sid Super', 'tu-sup');

console.log('\n── restore the records the edit bug failed ──');
const rec = (id, name, uid, status, passed, completion, score) => H_DB.prepare(`INSERT INTO training_records
  (id, employee_name, employee_user_id, training_topic, course_id, training_date, completion_date, status, passed, score)
  VALUES (?, ?, ?, 'Fixture', ?, '2026-09-01', ?, ?, ?, ?)`).run(id, name, uid, course.id, completion, status, passed, score);
const edit = (id) => H_DB.prepare(`INSERT INTO audit_log (timestamp, actor, action, entity_type, entity_id, details)
  VALUES ('2026-10-15 14:00:00', 'Daniela Servin', 'update', 'training', ?, '{}')`).run(id);
rec('tu-bug', 'Cleo Cleaning', 'tu-c1', 'failed', 0, '2026-09-01', null); edit('tu-bug');
rec('tu-low', 'Wes Warehouse', 'tu-w1', 'failed', 0, '2026-09-01', 40); edit('tu-low');
rec('tu-real', 'Wren Warehouse', 'tu-w2', 'failed', 0, null, 40); edit('tu-real');
let r = await call('POST', '/compliance/edit-failed-training/restore', { ids: ['tu-bug'], reason: 'edit bug' }, sup.token);
t('restoring is admin-only', r.status === 403);
r = await call('POST', '/compliance/edit-failed-training/restore', { ids: ['tu-bug'] }, admin.token);
t('a reason is required', r.status === 400 && /reason|why/i.test(r.json?.error || ''));
r = await call('POST', '/compliance/edit-failed-training/restore', { ids: ['tu-bug', 'tu-low', 'tu-real'], reason: 'Edit bug D-264, restored after review' }, admin.token);
t('the edit bug\'s fail is restored', r.status === 200 && r.json?.restored?.map(x => x.id).join() === 'tu-bug', r.text.slice(0, 200));
t('a low-score fail and a real fail are skipped, by name', r.json?.skipped?.map(x => x.id).sort().join() === 'tu-low,tu-real');
const bug = one('SELECT * FROM training_records WHERE id = ?', 'tu-bug');
t('…it is completed again, with its own date and a blank pass', bug.status === 'completed' && bug.completion_date === '2026-09-01' && bug.passed === null && bug.superseded === 0, JSON.stringify(bug).slice(0, 160));
t('…the other two are untouched', one('SELECT status s FROM training_records WHERE id = ?', 'tu-low').s === 'failed' && one('SELECT status s FROM training_records WHERE id = ?', 'tu-real').s === 'failed');
t('…and the restore is audited with the reason', !!one(`SELECT 1 FROM audit_log WHERE entity_id = 'tu-bug' AND details LIKE '%edit_failed_restored%' AND details LIKE '%restored after review%'`));
r = await call('GET', '/compliance/edit-failed-training', null, admin.token);
t('the report no longer lists it', !(r.json?.likely || []).some(x => x.id === 'tu-bug'));
r = await call('POST', '/compliance/edit-failed-training/restore', { ids: ['tu-bug'], reason: 'again' }, admin.token);
t('restoring twice does nothing', r.json?.restored?.length === 0 && r.json?.skipped?.length === 1);

console.log('\n── competence is required ──');
const base = { employee_name: 'Wes Warehouse', employee_user_id: 'tu-w1', course_id: course.id, status: 'completed', training_date: '2026-10-20', completion_date: '2026-10-20', method: 'verbal', trainer: 'Adam Bliss' };
r = await call('POST', '/training', base, admin.token);
t('neither a passed quiz nor the trainer\'s tick: refused', r.status === 400 && r.json?.code === 'COMPETENCE_REQUIRED', r.text.slice(0, 120));
r = await call('POST', '/training', { ...base, competence_confirmed: true }, admin.token);
t('with the tick it saves, and the statement names the trainer', r.status === 201 && r.json?.competence_statement === 'Adam Bliss: "I confirm this person understands this training."', r.text.slice(0, 160));
r = await call('POST', '/training', { ...base, method: 'quiz', score: pass80 }, admin.token);
t('a passed quiz saves without the tick', r.status === 201);
r = await call('POST', '/training', { ...base, method: 'quiz', score: pass80 - 10, passed: false }, admin.token);
t('a failed quiz files as a fail, not asked for the tick', r.status === 201 && r.json?.status === 'failed');
r = await call('POST', '/training/bulk-complete', { course_id: course.id, training_date: '2026-10-21', method: 'verbal', attendees: [
  { employee_user_id: 'tu-w1', employee_name: 'Wes Warehouse', score: pass80 }, { employee_user_id: 'tu-w2', employee_name: 'Wren Warehouse' },
  { employee_user_id: 'tu-bot', employee_name: '*Update Bot' }] }, admin.token);
t('the group entry is refused while someone has neither, naming them (and not the bot)', r.status === 400 && r.json?.lacking?.join() === 'Wren Warehouse', r.text.slice(0, 200));
r = await call('POST', '/training/bulk-complete', { course_id: course.id, training_date: '2026-10-21', method: 'verbal', attendees: [
  { employee_user_id: 'tu-w1', employee_name: 'Wes Warehouse', score: pass80 }] }, admin.token);
t('…and saves when everyone passed a quiz', r.status === 200 && r.json?.created === 1);
const { missingForCheck } = await import('../shared/check-forms.js');
const noTest = { kind: 'training', has_test: false, passing_score: 80 };
t('the task card for a course with no test asks for the tick', missingForCheck(noTest, { trainer: 'Adam' }).some(m => m.key === 'competence'));
t('…and is satisfied by it', !missingForCheck(noTest, { trainer: 'Adam', competence_confirmed: true }).length);

console.log('\n── bots and not-a-trainee accounts stay out ──');
db.prepare(`INSERT INTO training_records (id, employee_name, employee_user_id, training_topic, course_id, training_date, completion_date, status, passed, next_due_date)
  VALUES ('tu-botrec', '*Update Bot', 'tu-bot', 'Fixture', ?, '2025-01-01', '2025-01-01', 'completed', 1, '2025-06-01')`).run(course.id);
r = await call('GET', '/training/due', null, admin.token);
t('the retraining list has no bot', !(r.json || []).some(d => d.employee_name === '*Update Bot'));
const { TRAINEE_RECORD_SQL } = await import('../server/trainees.js');
const counted = (sql) => db.prepare(`SELECT COUNT(*) n FROM training_records tr WHERE tr.course_id = ? ${sql}`).get(course.id).n;
t('the retraining count a document change reports leaves the bot out', counted('') - counted(`AND ${TRAINEE_RECORD_SQL('tr')}`) === 1);
db.prepare(`INSERT INTO work_orders (id, equipment_id, title, status, due_date, training_course_id, assigned_to, assigned_to_id, task_group, created_at)
  VALUES ('tu-botwo', NULL, 'Training', 'open', '2026-11-01', ?, '*Update Bot', 'tu-bot', 'warehouse', datetime('now','-5 day'))`).run(course.id);
const { trainingNudges, tellAssignee } = await import('../server/training-notify.js');
await trainingNudges(db).catch(() => null);
t('the reminder job does not chase a bot', one("SELECT last_nudge_at x FROM work_orders WHERE id = 'tu-botwo'").x === null);
t('…and nothing tells a bot it was assigned training', await tellAssignee(db, { user_id: 'tu-bot', items: [{ course: { title: 'X' } }] }) === false);
db.prepare(`INSERT INTO training_tests (id, course_id, version, is_current) VALUES ('tu-test', ?, 9, 0)`).run(course.id);
db.prepare(`INSERT INTO training_questions (id, test_id, position, type, prompt, options, correct_answer) VALUES ('tu-q', 'tu-test', 0, 'true_false', 'Q?', '[]', 'true')`).run();
for (const [id, name, uid] of [['tu-a1', 'Wes Warehouse', 'tu-w1'], ['tu-a2', '*Update Bot', 'tu-bot']]) {
  db.prepare(`INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, employee_user_id, answers) VALUES (?, 'tu-test', ?, ?, ?, '{"tu-q":"false"}')`).run(id, course.id, name, uid);
}
const { questionMisses } = await import('../server/training-misses.js');
const mm = questionMisses(db, { course_id: course.id, include_old: true }).courses?.find(c => c.test_id === 'tu-test');
t('Most missed counts the person and not the bot', mm?.people === 1 && !mm.questions?.[0]?.missed_by?.includes('*Update Bot'), JSON.stringify(mm)?.slice(0, 160));

console.log('\n── an unused auditor duplicate is not a trainee ──');
mk('tu-cara1', 'Cara Pierce', 'supervisor', 'qa');
mk('tu-cara2', 'Cara Pierce', 'auditor', 'qa', { username: 'cara.pierce.pass' });
mk('tu-ann', 'Ann Auditor', 'auditor', 'qa');
mk('tu-dan1', 'Dan Twice', 'operator', 'warehouse');
mk('tu-dan2', 'Dan Twice', 'auditor', 'qa', { username: 'dan.twice.pass' });
db.prepare(`INSERT INTO audit_log (actor, action, entity_type, entity_id) VALUES ('Dan Twice', 'login', 'user', 'tu-dan2')`).run();
db.prepare("DELETE FROM app_settings WHERE key = 'training_auditor_duplicates_flagged_v1'").run();
// The pass audits through the app's own connection, so it runs on that one
// (two connections in one transaction lock each other out).
db.close();
const { getDb } = await import('../server/db.js');
const adb = getDb();
const { flagUnusedAuditorDuplicatesOnce } = await import('../server/trainees.js');
const out = flagUnusedAuditorDuplicatesOnce(adb, { log: {} });
const nt = (id) => adb.prepare('SELECT not_trainee n FROM users WHERE id = ?').get(id).n;
t('the auditor account sharing a staff name, never signed in, is flagged', nt('tu-cara2') === 1 && out?.flagged?.some(f => f.id === 'tu-cara2'), JSON.stringify(out));
t('the staff account with that name is not', nt('tu-cara1') === 0);
t('an auditor with a name of their own is not', nt('tu-ann') === 0);
t('an auditor duplicate that has signed in is not', nt('tu-dan2') === 0);
t('the account stays active (nothing deactivated)', adb.prepare('SELECT is_active a FROM users WHERE id = ?').get('tu-cara2').a === 1);
t('it runs once', flagUnusedAuditorDuplicatesOnce(adb, { log: {} }) === null);
{
  const auditBefore = adb.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  const rep = await call('GET', '/compliance/auditor-duplicates', null, admin.token);
  t('the report lists every account the pass matched — here only the duplicate', rep.status === 200
    && rep.json?.flagged?.map(f => f.id).join() === 'tu-cara2', JSON.stringify(rep.json?.flagged)?.slice(0, 200));
  const f0 = rep.json?.flagged?.[0];
  t('…with the staff account it duplicates and the change it logged', f0?.same_name_accounts?.some(x => x.id === 'tu-cara1') && f0?.changes?.length >= 1);
  t('…and what the rule would match now', rep.json?.would_match_now?.some(w => w.id === 'tu-cara2' && w.already_flagged));
  t('…in plain text', /Cara Pierce — account tu-cara2/.test(rep.json?.text || ''));
  t('running the report writes nothing', adb.prepare('SELECT COUNT(*) n FROM audit_log').get().n === auditBefore);
  t('the report is admin-only', (await call('GET', '/compliance/auditor-duplicates', null, sup.token)).status === 403);
}
adb.close();
H_DB = new Database(DBP);

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://localhost:${PORT}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
await page.goto(`http://localhost:${PORT}/?tab=training&view=records`);
await page.getByRole('button', { name: 'Group Training' }).click({ timeout: 20000 }).catch(() => {});
const gt = page.locator('div.fixed', { hasText: 'Record a training session' }).last();
await gt.locator('[data-people-picker]').waitFor({ timeout: 10000 }).catch(() => {});
await gt.locator('[data-filter-dept]').selectOption('warehouse').catch(() => {});
await gt.locator('[data-filter-role]').selectOption('operator').catch(() => {});
const shown = await gt.locator('[data-person]').allInnerTexts().catch(() => []);
t('the department and role filters narrow the list', shown.length >= 2 && shown.every(x => /warehouse/i.test(x) && /operator/i.test(x)) && !shown.some(x => /Walt Warehouse/.test(x)), shown.join(' | '));
t('…and a bot is never offered', !shown.some(x => /Update Bot/.test(x)));
await gt.locator('[data-select-all]').click().catch(() => {});
const ticked = await gt.locator('[data-person] input[type=checkbox]:checked').count();
t('Select all ticks everyone shown', ticked === shown.length, `${ticked} of ${shown.length}`);
await gt.locator('[data-person="Wren Warehouse"] input[type=checkbox]').uncheck().catch(() => {});
t('…and one can be unticked', (await gt.locator('[data-picked-count]').innerText().catch(() => '')).startsWith(`${shown.length - 1} selected`));
await gt.locator('select').first().selectOption(course.id).catch(() => {});
t('Record is held until the trainer ticks competence', await gt.locator('[data-record-session]').isDisabled());
await gt.locator('[data-field="competence"] input').check().catch(() => {});
t('…and allowed once ticked', !(await gt.locator('[data-record-session]').isDisabled()));
await page.keyboard.press('Escape');
await gt.getByRole('button', { name: 'Cancel' }).click().catch(() => {});

await page.getByRole('button', { name: 'Group Sheets' }).click({ timeout: 10000 }).catch(() => {});
const gs = page.locator('div.fixed', { hasText: 'File group sign-in sheets' }).last();
const dir = mkdtempSync(join(tmpdir(), 'tu-'));
const pdf = join(dir, '2026-10-20 GMP sheet.pdf');
writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
await gs.locator('input[type=file]').setInputFiles(pdf).catch(() => {});
await gs.locator('[data-how-trained]').waitFor({ timeout: 10000 }).catch(() => {});
const has = async (sel) => (await gs.locator(sel).count()) > 0;
t('Group Sheets asks the date trained, method, language, trainer, revision, change request and competence',
  await has('[data-field="date-trained"]') && await has('[data-field="method"]') && await has('[data-field="language"]') && await has('[data-field="trainer"]')
  && await has('[data-field="sop_revision"]') && await has('[data-field="dcr_id"]') && await has('[data-field="competence"]'));
t('…with read and sign as the method it starts on', (await gs.locator('[data-field="method"]').inputValue().catch(() => '')) === 'read_and_sign');
t('…and no box for the date recorded or who recorded it', !(await has('[data-field="recorded_by"]')) && !(await has('[data-field="created_at"]')));
await gs.locator('select', { hasText: 'Add a course' }).selectOption(course.id).catch(() => {});
t('…the course\'s document is named', await has('[data-sheet-documents]'));
await gs.locator('[data-field="date-trained"]').fill('2026-10-20').catch(() => {});
await gs.locator('[data-field="trainer"]').fill('Maria Servin').catch(() => {});
await gs.locator('[data-field="language"]').selectOption('es').catch(() => {});
await gs.locator('[data-person="Cleo Cleaning"] input[type=checkbox]').check().catch(() => {});
await gs.getByRole('button', { name: /File sheet/ }).click().catch(() => {});
t('filing without the competence tick is refused on screen', /I confirm this person understands this training/.test(await gs.innerText().catch(() => '')));
await gs.locator('[data-field="competence"] input').check().catch(() => {});
await gs.getByRole('button', { name: /File sheet/ }).click().catch(() => {});
await page.waitForTimeout(1500);
const sheetRec = one(`SELECT * FROM training_records WHERE employee_user_id = 'tu-c1' AND session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`);
t('the sheet files with its fields, and ReadyDoc stamps who recorded it', sheetRec?.method === 'read_and_sign' && sheetRec?.language === 'es' && sheetRec?.trainer === 'Maria Servin'
  && sheetRec?.training_date === '2026-10-20' && sheetRec?.recorded_by === 'Una Admin' && /^Maria Servin: /.test(sheetRec?.competence_statement || ''), JSON.stringify(sheetRec)?.slice(0, 200));
await page.keyboard.press('Escape');

// Settings: the restore button on the report.
rec('tu-bug2', 'Wes Warehouse', 'tu-w1', 'failed', 0, '2026-09-02', null); edit('tu-bug2');
await page.goto(`http://localhost:${PORT}/?tab=settings&section=backup`);
await page.locator('[data-edit-fails-run]').click({ timeout: 20000 }).catch(() => {});
await page.locator('[data-edit-fails-restore]').waitFor({ timeout: 10000 }).catch(() => {});
t('the report offers Restore beside the list', await page.locator('[data-edit-fails-restore-go]').count() === 1);
t('…held until a reason is typed', await page.locator('[data-edit-fails-restore-go]').isDisabled().catch(() => false));
await page.locator('[data-edit-fails-reason]').fill('Edit bug, checked against paper');
page.once('dialog', d => d.accept());
await page.locator('[data-edit-fails-restore-go]').click().catch(() => {});
await page.locator('[data-edit-fails-restored]').waitFor({ timeout: 10000 }).catch(() => {});
t('pressing it restores the record', one('SELECT status s FROM training_records WHERE id = ?', 'tu-bug2').s === 'completed');
await browser.close();
H_DB.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
