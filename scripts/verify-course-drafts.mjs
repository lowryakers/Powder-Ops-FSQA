// verify:coursedrafts — course drafts staged by the Quality bot, published by two people (D-278).
//
//   1. A bot token with the `course-drafts` grant stages a draft: content, quiz
//      in English and Spanish, a video. Without the grant it is refused.
//   2. A draft is never training: the live course, its quiz, the matrix and the
//      trainee's tasks are unchanged while it is open.
//   3. Publishing takes two people with their passwords — Document Control and a
//      QA supervisor, never the same person, never the bot (token or session).
//      An edit clears the signatures. The second signature publishes.
//   4. The draft shows the document and revision it was built from, the diff
//      against the live course and who staged it.
//   5. The bot cannot write a live course, test, file, record or document.
//   6. Publishing a draft built on the document's new revision marks the course
//      updated for it (D-277) and assigns retraining; a draft built on a revision
//      the document has moved past is refused.
//
// Plus a real browser: the Course drafts view and signing through the password prompt.
//
// Caller sets PORT + DBPATH and the S3 stand-in (verify-all does).
// Control: drop the `course-drafts` entries from WRITE_AREAS — the bot cannot
// stage anything and the run stops at the first draft.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5167);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('cd-admin', 'Ada Admin', 'admin', 'admin');
  mk('cd-bot', '*Quality Bot', 'operator', 'qa', { training: 'edit' });
  mk('cd-dc', 'Dana Control', 'supervisor', 'document_control', { training: 'view' });
  mk('cd-qa', 'Quinn Quality', 'supervisor', 'qa', { training: 'view' });
  mk('cd-sup', 'Sam Production', 'supervisor', 'filling', { training: 'edit' });
  mk('cd-op', 'Otto Trainee', 'operator', 'warehouse', { operator: 'view' });
  db.close();
}
const call = async (m, p, b, tok, form) => {
  const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: form || (b ? JSON.stringify(b) : undefined) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const PW = 'Drafts2026!!';
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: PW });
  return r.json;
};
const adminL = await signIn('cd-admin', 'Ada Admin');
const admin = adminL?.token;
const dcL = await signIn('cd-dc', 'Dana Control');
const dc = dcL?.token;
const qa = (await signIn('cd-qa', 'Quinn Quality'))?.token;
const sup = (await signIn('cd-sup', 'Sam Production'))?.token;
t('four people signed in', !!admin && !!dc && !!qa && !!sup);

// An approved SOP at V1, a course built on it with a quiz, and Otto trained on V1.
let r = await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 950', title: 'Hand Washing', category: 'quality', revision: 'V1', status: 'active', content: 'Wash for 20 seconds.' }, admin);
const doc = r.json;
r = await call('POST', '/training/courses', { code: 'SOP950', title: 'Hand Washing Training', description: 'Old content.', sop_id: doc.id, retrain_on_doc_change: true }, admin);
const course = r.json;
await call('PUT', `/training/courses/${course.id}/test`, { passing_score: 80, questions: [
  { type: 'multiple_choice', prompt: 'How long?', options: ['5 s', '20 s'], correct_answer: '2' },
] }, admin);
await call('POST', '/training', { employee_name: 'Otto Trainee', employee_user_id: 'cd-op', course_id: course.id, status: 'completed',
  training_date: '2026-10-01', completion_date: '2026-10-01', method: 'verbal', competence_confirmed: true }, admin);
t('a live course on SOP 950 V1 with a one-question quiz, and Otto trained on it', course.built_on_revision === 'V1'
  && q('SELECT COUNT(*) c FROM training_records WHERE course_id = ? AND sop_revision = ?', course.id, 'V1')[0].c === 1);

// The document moves to V2: the course needs an update.
const dr = (await call('POST', `/documents/${doc.id}/revisions`, {}, admin)).json;
await call('PUT', `/documents/${doc.id}/revisions/${dr.id}`, { description: 'Wash for 30 seconds.', change_summary: '30 s' }, admin);
r = await call('POST', `/documents/${doc.id}/revisions/${dr.id}/approve`, { signature_password: PW }, admin);
t('SOP 950 is approved at V2', r.status === 200 && q('SELECT revision FROM sop_documents WHERE id = ?', doc.id)[0].revision === 'V2', `${r.status} ${r.json?.error}`);

// The Quality bot's token (a test database's own token, minted by the test admin).
r = await call('POST', '/api-tokens', { user_id: 'cd-bot', label: 'Quality bot', scopes: ['read', 'write'] }, admin);
const tokenId = r.json?.token?.id; const bot = r.json?.plaintext;
t('the Quality bot holds a write token', !!bot && !!tokenId, JSON.stringify(r.json).slice(0, 120));

console.log('\n── 1. staging needs the course-drafts grant ──');
const QUIZ = [
  { type: 'multiple_choice', prompt: 'How long do you wash?', prompt_es: '¿Cuánto tiempo se lava?', options: ['20 s', '30 s'], options_es: ['20 s', '30 s'], correct_answer: '2' },
  { type: 'true_false', prompt: 'Dry with a paper towel.', prompt_es: 'Séquese con una toalla de papel.', options: ['True', 'False'], options_es: ['Verdadero', 'Falso'], correct_answer: '1' },
];
r = await call('POST', '/training/drafts', { course_id: course.id, description: 'Wash for 30 seconds.', questions: QUIZ }, bot);
t('without the grant the bot is refused', r.status === 403 && r.json?.error === 'token_denied', `${r.status} ${JSON.stringify(r.json)}`);
r = await call('POST', `/api-tokens/${tokenId}/grants`, { grants: ['course-drafts'] }, admin);
t('an admin gives the token the course-drafts grant', r.status === 200);
r = await call('POST', '/training/drafts', { course_id: course.id, description: 'Wash for 30 seconds, then dry.', questions: QUIZ, change_note: 'SOP 950 V2: 30 seconds' }, bot);
const draft = r.json;
t('the bot stages a draft of the course', r.status === 201 && draft?.status === 'draft' && draft.course_id === course.id, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t('…built from SOP 950 V2, staged by the bot via its token', draft?.built_from_revision === 'V2' && draft?.document?.doc_number === 'SOP 950'
  && draft?.staged_by === '*Quality Bot' && draft?.staged_via_token === true);
r = await call('POST', '/training/drafts', { course_id: course.id, title: 'Again' }, bot);
t('one open draft per course (409 naming it)', r.status === 409 && r.json?.draft_id === draft?.id);
r = await call('PUT', `/training/drafts/${draft?.id}`, { questions: [{ prompt: 'Q', options: ['a', 'b'], options_es: ['a'], correct_answer: '1' }] }, bot);
t('a quiz whose Spanish options do not match the English is refused', r.status === 400 && /Spanish options/.test(r.json?.error || ''));

const fd = (name, type, bytes) => { const f = new FormData(); f.append('files', new Blob([bytes], { type }), name); return f; };
r = await call('POST', `/training/drafts/${draft?.id}/materials`, null, bot, fd('handwash.mp4', 'video/mp4', Buffer.alloc(2048, 7)));
t('the bot uploads a training video to the draft', r.status === 201 && r.json?.files?.[0]?.is_video === true, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('POST', `/training/drafts/${draft?.id}/materials`, null, bot, fd('page.html', 'text/html', '<script>1</script>'));
t('…but not an .html file', r.status === 415);

console.log('\n── 2. a draft is never training ──');
const live = (await call('GET', '/training/courses', null, admin)).json.find(c => c.id === course.id);
t('the live course still reads the old content', live?.description === 'Old content.');
const liveTest = (await call('GET', `/training/courses/${course.id}/test`, null, admin)).json;
t('…and still has the one-question quiz', liveTest?.questions?.length === 1 && liveTest.version === 1);
t('no course row was added for the draft', q('SELECT COUNT(*) c FROM training_courses WHERE title = ?', 'Hand Washing Training')[0].c === 1);
t('no live material until it is published', q('SELECT COUNT(*) c FROM training_materials WHERE course_id = ?', course.id)[0].c === 0);
t('Otto has no task from the draft', q('SELECT COUNT(*) c FROM work_orders WHERE training_course_id = ?', course.id)[0].c === 0);
const matrix = (await call('GET', '/training/matrix', null, admin)).json;
t('the matrix knows nothing about drafts', !JSON.stringify(matrix).includes(draft?.id || 'none'));

console.log('\n── 4. what the draft shows ──');
const view = (await call('GET', `/training/drafts/${draft?.id}`, null, dc)).json;
t('the diff names the changed content', view?.diff?.fields?.some(f => f.field === 'description' && f.live === 'Old content.'));
t('…the quiz question by question (1 → 2)', view?.diff?.quiz?.live_count === 1 && view.diff.quiz.draft_count === 2 && view.diff.quiz.rows.length === 2);
t('…and the file it adds', view?.diff?.files?.added?.includes('handwash.mp4') && view.materials?.[0]?.url);
t('the Spanish quiz travels with it', view?.questions?.[0]?.prompt_es === '¿Cuánto tiempo se lava?');

console.log('\n── 5. the bot cannot touch live data ──');
const denied = async (label, m, p, b) => { const x = await call(m, p, b, bot); t(`bot: ${label} → refused`, x.status === 403, `${x.status} ${JSON.stringify(x.json).slice(0, 100)}`); };
await denied('edit the live course', 'PUT', `/training/courses/${course.id}`, { title: 'Hacked' });
await denied('replace the live quiz', 'PUT', `/training/courses/${course.id}/test`, { questions: QUIZ });
await denied('create a live course', 'POST', '/training/courses', { title: 'Bot course' });
await denied('mark the course updated', 'POST', `/training/courses/${course.id}/revision`, { kind: 'updated' });
await denied('file a training record', 'POST', '/training', { employee_name: 'Otto Trainee', course_id: course.id });
await denied('edit a document', 'PUT', `/documents/${doc.id}`, { owner: 'Bot' });
await denied('delete a course file', 'DELETE', '/training/materials/anything');
t('nothing live moved', q('SELECT title FROM training_courses WHERE id = ?', course.id)[0].title === 'Hand Washing Training');

console.log('\n── 3. two people, their passwords, never the bot ──');
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: 'x' }, bot);
t('the bot token cannot sign', r.status === 403 && r.json?.error === 'approve_requires_human_session');
r = await call('POST', `/training/drafts/${draft?.id}/discard`, { reason: 'bot' }, bot);
t('…nor discard', r.status === 403 && r.json?.error === 'token_denied');
const botSess = (await signIn('cd-bot', '*Quality Bot'))?.token;
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: PW }, botSess);
t('the bot account signed in as a session cannot sign either', r.status === 403 && /bot.account/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: PW }, sup);
t('a production supervisor cannot confirm the document', r.status === 403);
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: PW }, qa);
t('QA cannot sign the document confirmation', r.status === 403);
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, {}, dc);
t('Document Control is asked for the password', r.status === 403 && r.json?.signature_required === true);
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: PW }, dc);
t('Document Control confirms it matches the document', r.status === 200 && r.json?.signatures?.document?.by === 'Dana Control' && !r.json?.published, `${r.status} ${r.json?.error}`);
r = await call('PUT', `/training/drafts/${draft?.id}`, { change_note: 'SOP 950 V2: 30 seconds, then dry' }, bot);
t('an edit by the bot clears the signature and says whose', r.status === 200 && r.json?.signatures_cleared?.includes('Dana Control') && !r.json?.signatures?.document);
r = await call('POST', `/training/drafts/${draft?.id}/sign/document`, { signature_password: PW }, dc);
t('Document Control signs again', r.status === 200);
r = await call('POST', `/training/drafts/${draft?.id}/sign/food_safety`, { signature_password: PW }, dc);
t('Document Control cannot also approve food safety', r.status === 403);

console.log('\n── 6. the second signature publishes ──');
r = await call('POST', `/training/drafts/${draft?.id}/sign/food_safety`, { signature_password: PW }, qa);
t('the QA supervisor approves the food safety content and it publishes', r.status === 200 && r.json?.status === 'published' && r.json?.published?.course_id === course.id, `${r.status} ${r.json?.error}`);
const after = q('SELECT * FROM training_courses WHERE id = ?', course.id)[0];
t('the live course has the new content', after.description === 'Wash for 30 seconds, then dry.');
const cur = q('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1', course.id)[0];
t('a new quiz version (2) with both questions in Spanish', cur?.version === 2 && cur.sop_revision === 'V2'
  && q('SELECT COUNT(*) c FROM training_questions WHERE test_id = ? AND prompt_es IS NOT NULL', cur.id)[0].c === 2);
t('the video is on the live course', q('SELECT filename FROM training_materials WHERE course_id = ?', course.id).map(x => x.filename).includes('handwash.mp4'));
t('the course is built on V2, marked updated', after.built_on_revision === 'V2' && after.built_on_kind === 'updated');
t('retraining for V2 is assigned to Otto', r.json?.published?.retraining?.assigned === 1
  && q("SELECT COUNT(*) c FROM work_orders WHERE training_course_id = ? AND assigned_to_id = 'cd-op'", course.id)[0].c === 1);
r = await call('PUT', `/training/drafts/${draft?.id}`, { change_note: 'late' }, bot);
t('a published draft is closed to the bot', r.status === 403);
t('the publish is audited with both signers and the stager', q("SELECT details FROM audit_log WHERE entity_type = 'course_draft' AND action = 'publish'")
  .some(a => /Dana Control/.test(a.details) && /Quinn Quality/.test(a.details) && /Quality Bot/.test(a.details)));

console.log('\n── a new course, two different people, and a moved document ──');
r = await call('POST', '/training/drafts', { title: 'Glove Changes', code: 'SOP950-G', sop_id: doc.id, questions: QUIZ }, bot);
const fresh = r.json;
t('the bot stages a new course built on V2', r.status === 201 && fresh.course_id === null && fresh.built_from_revision === 'V2');
await call('POST', `/training/drafts/${fresh.id}/sign/document`, { signature_password: PW }, admin);
r = await call('POST', `/training/drafts/${fresh.id}/sign/food_safety`, { signature_password: PW }, admin);
t('one admin cannot give both signatures', r.status === 403 && /two different people/.test(r.json?.error || ''));
const dr3 = (await call('POST', `/documents/${doc.id}/revisions`, {}, admin)).json;
await call('POST', `/documents/${doc.id}/revisions/${dr3.id}/approve`, { signature_password: PW }, admin);
r = await call('POST', `/training/drafts/${fresh.id}/sign/food_safety`, { signature_password: PW }, qa);
t('the document moved to V3: publishing is refused, naming both revisions', r.status === 409 && r.json?.code === 'DOCUMENT_MOVED' && /V3/.test(r.json?.error) && /V2/.test(r.json?.error), `${r.status} ${r.json?.error}`);
t('…and nothing was created', q('SELECT COUNT(*) c FROM training_courses WHERE title = ?', 'Glove Changes')[0].c === 0);

console.log('\n── the screen ──');
r = await call('POST', '/training/drafts', { title: 'Hairnets', sop_id: doc.id }, bot);
const third = r.json;
await call('POST', `/training/drafts/${third.id}/sign/food_safety`, { signature_password: PW }, qa);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin, adminL.user]);
await page.goto(`${URL}/?tab=training&view=drafts`);
await page.waitForSelector('[data-course-drafts]', { timeout: 15000 }).catch(() => {});
t('Training → Course drafts lists the open drafts', await page.locator('[data-draft-row="Hairnets"]').count() === 1 && await page.locator('[data-draft-row="Glove Changes"]').count() === 1);
await page.locator('[data-draft-row="Hairnets"]').click();
await page.waitForSelector('[data-draft-detail] [data-draft-facts]', { timeout: 8000 }).catch(() => {});
t('the detail names who staged it (bot token) and the document revision', /bot token/.test(await page.locator('[data-draft-staged]').innerText().catch(() => ''))
  && /SOP 950/.test(await page.locator('[data-draft-facts]').innerText().catch(() => '')));
t('it offers the admin the document signature only', await page.locator('[data-draft-sign-btn="document"]').count() === 1 && await page.locator('[data-draft-sign-btn="food_safety"]').count() === 0);
await page.locator('[data-draft-sign-btn="document"]').click();
const pw = page.locator('input[type="password"]').last();
await pw.waitFor({ timeout: 5000 }).catch(() => {});
await pw.click();
await page.keyboard.type(PW);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
t('signing through the password prompt publishes it', q('SELECT status FROM course_drafts WHERE id = ?', third.id)[0]?.status === 'published'
  && /Published/.test(await page.locator('[data-draft-notice]').innerText().catch(() => '')));
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
