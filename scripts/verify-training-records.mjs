// verify:trainingrecords — what a training record says about how somebody was
// trained, and the session that records many people at once (D-264).
//
// SQF 2.9.2.3 / FORM 408-02: document + revision, date trained (may be past),
// date recorded and recorded by (set by ReadyDoc, never edited), trainer,
// method (verbal / hands-on / read and sign / quiz), the trainer's statement of
// competence, language and a link to the DCR. Also: a backdated record no
// longer pushes a newer one aside; a course's videos reach the trainee's task;
// the document importer keeps the version its filename names.
//
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: put back the old supersedeOlder (mark everything but the new row) —
// "a backdated record leaves the newer one current" fails, as does the re-settle.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

// Signing asks for the signer's password (D-282). Everyone in this script has
// the one password it set, so a write carries it — as a person re-entering it would.
const SIGN_PW = 'Records2026!!';
const SIGNED_PATHS = /^\/(documents(\/[^/]+)?|documents\/[^/]+\/apply-revision|documents\/revisions\/items\/[^/]+\/apply|training(\/[^/]+)?|training\/bulk-complete|pm\/work-orders\/[^/]+\/complete-and-recur)$/;
const signed = (b, m, p) => (m !== 'GET' && SIGNED_PATHS.test(String(p).split('?')[0]) && b && typeof b === 'object' && !Array.isArray(b) && b.signature_password === undefined && !('password' in b) ? { ...b, signature_password: SIGN_PW } : b);
import { resettleCurrentOnce } from '../server/training-records.js';

const PORT = Number(process.env.PORT || 5158);
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

const db = new Database(DBP);
const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tr-admin', 'Dana Records', 'admin', 'admin');
mk('tr-op', 'Olga Floor', 'operator', 'warehouse', { operator: 'view' });
mk('tr-op2', 'Pedro Line', 'operator', 'warehouse', { operator: 'view' });
mk('tr-op3', 'Quinn Other', 'operator', 'warehouse', { operator: 'view' });
const course = db.prepare('SELECT id, title FROM training_courses WHERE active = 1 ORDER BY code LIMIT 1').get();
db.prepare(`INSERT OR REPLACE INTO qms_records (id, record_type, record_number, record_date, status, data, created_by)
  VALUES ('tr-dcr', 'document_change_request', 'TR-0001', '2026-09-01', 'open', ?, 'fixture')`)
  .run(JSON.stringify({ doc_number: 'SOP 401', doc_name: 'cGMP Policy', revision: '4', requires_training: true }));
db.close();

const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(signed(b, m, p)) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Records2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Records2026!!' })).json;
};
const admin = await signIn('Dana Records', 'tr-admin');
const op = await signIn('Olga Floor', 'tr-op');
const op3 = await signIn('Quinn Other', 'tr-op3');
t('a course to train on exists', !!course);

console.log('\n── one record ──');
let r = await call('POST', '/training', {
  employee_name: 'Olga Floor', employee_user_id: 'tr-op', course_id: course.id, status: 'completed',
  training_date: '2026-09-01', completion_date: '2026-09-01', method: 'hands_on', language: 'es', trainer: 'Adam Bliss',
  competence_confirmed: true, sop_revision: '4', dcr_id: 'tr-dcr',
  recorded_by: 'Somebody Else', recorded_by_id: 'tr-op3', // a client cannot claim who recorded it
}, admin.token);
const sept = r.json;
t('a past date is accepted', r.status === 201 && sept?.training_date === '2026-09-01', r.text.slice(0, 160));
t('recorded by is the signed-in person, not what the form sent', sept?.recorded_by === 'Dana Records' && sept?.recorded_by_id === 'tr-admin');
t('date recorded is set by ReadyDoc (today)', !!sept?.created_at && sept.created_at.slice(0, 4) === new Date().toISOString().slice(0, 4));
t('method, language, revision and DCR are stored', sept?.method === 'hands_on' && sept?.language === 'es' && sept?.sop_revision === '4' && sept?.dcr_id === 'tr-dcr');
// D-282: the statement names the person who SIGNED it (the session), never a typed trainer.
t('the competence statement is stored in words, naming the signer', sept?.competence_statement === 'Dana Records: "I confirm this person understands this training."', sept?.competence_statement);
t('…signed with a password, with a time, a meaning and an intact fingerprint', sept?.competence_signed_by === 'Dana Records' && !!sept?.competence_signed_at
  && sept?.competence_meaning === 'Trained and competent' && sept?.competence_signature === 'signed' && sept?.trainer === 'Dana Records', JSON.stringify({ by: sept?.competence_signed_by, st: sept?.competence_signature }));

r = await call('POST', '/training', { employee_name: 'Olga Floor', course_id: course.id, status: 'completed', training_date: '2099-01-01', completion_date: '2099-01-01', method: 'verbal' }, admin.token);
t('a date in the future is refused', r.status === 400 && /future/.test(r.json?.error || ''), r.text);
r = await call('POST', '/training', { employee_name: 'Olga Floor', course_id: course.id, status: 'completed', method: 'telepathy' }, admin.token);
t('a method outside the four is refused', r.status === 400 && /Method must be/.test(r.json?.error || ''));
r = await call('POST', '/training', { employee_name: 'Olga Floor', course_id: course.id, status: 'completed', method: 'verbal', language: 'fr' }, admin.token);
t('a language outside the list is refused', r.status === 400);
r = await call('POST', '/training', { employee_name: 'Olga Floor', course_id: course.id, status: 'completed', method: 'verbal', dcr_id: 'no-such-dcr' }, admin.token);
t('a change request that does not exist is refused', r.status === 400 && /change request/.test(r.json?.error || ''));

console.log('\n── editing ──');
r = await call('PUT', `/training/${sept.id}`, { recorded_by: 'Somebody Else' }, admin.token);
t('who recorded it cannot be edited', r.status === 400 && r.json?.code === 'SYSTEM_SET');
r = await call('PUT', `/training/${sept.id}`, { created_at: '2020-01-01 00:00:00' }, admin.token);
t('the date recorded cannot be edited', r.status === 400 && r.json?.code === 'SYSTEM_SET');
r = await call('PUT', `/training/${sept.id}`, { ...sept, language: 'both' }, admin.token);
t('sending the record back unchanged with one field moved saves', r.status === 200 && r.json?.language === 'both' && r.json?.recorded_by === 'Dana Records', r.text.slice(0, 160));
t('…and does not turn a record with no score into a fail (the Edit form sends passed: null)', r.json?.status === 'completed' && r.json?.passed === null, `${r.json?.status} ${r.json?.passed}`);
const audit = one("SELECT details FROM audit_log WHERE entity_type = 'training' AND entity_id = ? ORDER BY id DESC LIMIT 1", sept.id);
t('the edit is audited with what changed', /"language":\{"from":"es","to":"both"\}/.test(audit?.details || ''), audit?.details);
r = await call('PUT', `/training/${sept.id}`, { competence_confirmed: false }, admin.token);
t('unticking a SIGNED statement is refused — it is withdrawn, never edited off (D-282)', r.status === 409 && r.json?.code === 'COMPETENCE_SIGNED', r.text.slice(0, 160));

console.log('\n── a past session does not push a newer record aside ──');
r = await call('POST', '/training', { employee_name: 'Olga Floor', employee_user_id: 'tr-op', course_id: course.id, status: 'completed', training_date: '2026-03-01', completion_date: '2026-03-01', method: 'verbal', competence_confirmed: true }, admin.token);
const march = r.json;
const flags = Object.fromEntries(q('SELECT id, superseded FROM training_records WHERE id IN (?, ?)', sept.id, march.id).map(x => [x.id, x.superseded]));
t('logging March after September leaves September current', flags[sept.id] === 0 && flags[march.id] === 1, JSON.stringify(flags));
r = await call('POST', '/training', { employee_name: 'Olga Floor', employee_user_id: 'tr-op', course_id: course.id, status: 'completed', training_date: '2026-10-01', completion_date: '2026-10-01', method: 'quiz', score: 95 }, admin.token);
const oct = r.json;
t('a newer record still becomes current', one('SELECT superseded s FROM training_records WHERE id = ?', oct.id).s === 0 && one('SELECT superseded s FROM training_records WHERE id = ?', sept.id).s === 1);
t('a passed quiz needs no tick', oct?.status === 'completed' && oct?.competence_statement === null);
r = await call('POST', '/training', { employee_name: 'Olga Floor', employee_user_id: 'tr-op', course_id: course.id, status: 'completed', training_date: '2026-10-02', completion_date: '2026-10-02', method: 'verbal' }, admin.token);
t('neither a passed quiz nor the trainer\'s tick: refused', r.status === 400 && r.json?.code === 'COMPETENCE_REQUIRED', r.text.slice(0, 160));

// Records left in the old (wrong) state are put right once, on boot.
{
  const w = new Database(DBP);
  w.prepare('UPDATE training_records SET superseded = 0 WHERE id = ?').run(march.id);
  w.prepare('UPDATE training_records SET superseded = 1 WHERE id = ?').run(oct.id);
  w.prepare("DELETE FROM app_settings WHERE key = 'training_current_resettled_v1'").run();
  const out = resettleCurrentOnce(w, { log() {} });
  t('the once-over re-settle corrects a record the old rule left current', out?.records_changed >= 2
    && w.prepare('SELECT superseded s FROM training_records WHERE id = ?').get(oct.id).s === 0
    && w.prepare('SELECT superseded s FROM training_records WHERE id = ?').get(march.id).s === 1, JSON.stringify(out));
  t('…and runs once', resettleCurrentOnce(w, { log() {} }) === null);
  w.close();
}

console.log('\n── one session, many people ──');
r = await call('POST', '/training/bulk-complete', {
  course_id: course.id, training_date: '2026-06-15', completion_date: '2026-06-15', method: 'verbal', language: 'both',
  trainer: 'Maria Servin', competence_confirmed: true, sop_revision: '3', dcr_id: 'tr-dcr',
  attendees: [{ employee_user_id: 'tr-op', employee_name: 'Olga Floor' }, { employee_user_id: 'tr-op2', employee_name: 'Pedro Line' }],
}, admin.token);
const sid = r.json?.session_id;
t('a session is saved for the group', !!sid && r.json?.created === 2, r.text.slice(0, 160));
const sess = one('SELECT * FROM training_sessions WHERE id = ?', sid);
t('the session holds the document revision, DCR, method, language and trainer', sess?.sop_revision === '3' && sess?.dcr_id === 'tr-dcr' && sess?.method === 'verbal' && sess?.language === 'both' && sess?.trainer === 'Dana Records' && sess?.attendee_count === 2);
t('…and who recorded it', sess?.recorded_by === 'Dana Records');
const recs = q('SELECT * FROM training_records WHERE session_id = ?', sid);
t('each attendee has their own record pointing at the session', recs.length === 2 && recs.every(x => x.sop_revision === '3' && x.language === 'both' && x.recorded_by === 'Dana Records' && /^Dana Records: /.test(x.competence_statement || '') && x.competence_signed_by_id === 'tr-admin'));
t('a June session does not push Olga\'s October record aside', one('SELECT superseded s FROM training_records WHERE id = ?', oct.id).s === 0);
r = await call('GET', '/training/sessions', null, admin.token);
const listed = r.json?.find(s => s.id === sid);
t('the Sessions list shows it with who attended', listed?.attendees?.map(a => a.employee_name).sort().join(',') === 'Olga Floor,Pedro Line' && listed?.dcr_number === 'TR-0001');
r = await call('POST', '/training/bulk-complete', { course_id: course.id, training_date: '2099-01-01', competence_confirmed: true, attendees: [{ employee_user_id: 'tr-op', employee_name: 'Olga Floor' }] }, admin.token);
t('a session dated in the future is refused', r.status === 400);
r = await call('GET', '/training/change-requests', null, admin.token);
t('the DCR picker lists change requests', r.json?.some(d => d.id === 'tr-dcr' && d.doc_number === 'SOP 401' && d.revision === '4'));

console.log('\n── course material on the trainee\'s task ──');
r = await call('POST', '/training/assign', { course_id: course.id, people: [{ user_id: 'tr-op' }], due_date: '2026-12-01' }, admin.token);
const wo = r.json?.created?.[0]?.work_order_id;
r = await call('GET', `/pm/work-orders/${wo}/training-materials`, null, op.token);
t('the trainee can read their course\'s material from the task', r.status === 200 && Array.isArray(r.json), r.text.slice(0, 120));
r = await call('GET', `/pm/work-orders/${wo}/training-materials`, null, op3.token);
t('somebody else\'s task is not found', r.status === 404);

console.log('\n── the document importer keeps the version ──');
{
  const fd = new FormData();
  fd.append('files', new Blob(['Purpose\nA test document.\n'], { type: 'text/plain' }), 'SOP-998_Record_Test_Doc_V4.txt');
  const res = await fetch(`http://localhost:${PORT}/api/documents/extract`, { method: 'POST', headers: { Authorization: `Bearer ${admin.token}` }, body: fd });
  const j = await res.json();
  const d = j.documents?.[0];
  t('reading the file returns the version its name gives', d?.revision === '4' && !/V4/.test(d?.title || ''), JSON.stringify(d)?.slice(0, 160));
  r = await call('POST', '/documents/bulk', { documents: [{ doc_type: 'sop', doc_number: d.doc_number, title: d.title, category: 'quality', revision: d.revision }] }, admin.token);
  const stored = one("SELECT revision FROM sop_documents WHERE doc_number = 'SOP-998' ORDER BY created_at DESC LIMIT 1");
  t('the imported document is stored at that version, not 1.0', stored?.revision === '4', JSON.stringify(stored));
}

// A record filed before competence was required, with neither — the list flags it.
{ const w = new Database(DBP); w.prepare(`INSERT INTO training_records (id, employee_name, training_topic, course_id, training_date, completion_date, status, method)
    VALUES ('tr-legacy', 'Olga Floor', 'Legacy', ?, '2025-01-01', '2025-01-01', 'completed', 'verbal')`).run(course.id); w.close(); }
console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://localhost:${PORT}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
await page.goto(`http://localhost:${PORT}/?tab=training&view=records`);
await page.locator('[data-recorded]').first().waitFor({ timeout: 20000 }).catch(() => {});
t('Records shows when and by whom each record was entered', await page.locator('[data-recorded]', { hasText: 'Dana Records' }).count() > 0);
t('…and flags a verbal record with no competence statement', await page.locator('[data-competence-missing]').count() > 0);
await page.getByRole('button', { name: 'Group Training' }).click({ timeout: 10000 }).catch(() => {});
await page.getByText('Record a training session').waitFor({ timeout: 10000 }).catch(() => {});
const modal = page.locator('div.fixed').last();
const methods = await modal.locator('[data-field="method"] option').allInnerTexts().catch(() => []);
t('the session form offers the four methods', ['Verbal', 'Hands-on', 'Read and sign', 'Quiz'].every(m => methods.includes(m)), methods.join(','));
t('…a language, the revision and the change request', await modal.locator('[data-field="language"]').count() === 1 && await modal.locator('[data-field="sop_revision"]').count() === 1 && await modal.locator('[data-field="dcr_id"] option', { hasText: 'TR-0001' }).count() === 1);
t('…and the trainer\'s competence tick, whatever the method', await modal.locator('[data-field="competence"]').count() === 1);
await modal.locator('[data-field="method"]').selectOption('read_and_sign');
t('…still asked for read and sign', await modal.locator('[data-field="competence"]').count() === 1);
t('the date cannot be set in the future', (await modal.locator('[data-field="date-trained"]').getAttribute('max')) !== null);
await page.keyboard.press('Escape');
await page.goto(`http://localhost:${PORT}/?tab=training&view=sessions`);
await page.locator('[data-session]').first().waitFor({ timeout: 20000 }).catch(() => {});
await page.locator(`[data-session="${sid}"]`).click().catch(() => {});
const sessText = await page.locator('[data-sessions]').innerText().catch(() => '');
t('the Sessions tab lists the session and, opened, who attended', /Dana Records/.test(sessText) && /Pedro Line/.test(sessText) && /DCR TR-0001/.test(sessText), sessText.slice(0, 200));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
