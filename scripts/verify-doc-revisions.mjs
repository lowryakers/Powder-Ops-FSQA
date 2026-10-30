// verify:docrevisions — document revisions, the Quality bot's signal, the
// revision a course was built on, and retraining that waits for the course (D-277).
//
//   1. An approved document's text and number do not change in place; a draft
//      revision is edited beside it, approved with a password under a NEW
//      number, and the revision it replaces is kept.
//   2. Approving signals the Quality bot (a stand-in HTTP server here) with the
//      document, old and new revision and the linked courses — once.
//   3. A course records the revision it was built on; a newer approved revision
//      shows it as "needs update".
//   4. No retraining is assigned for the new revision until the course is marked
//      updated (or "no change needed"); then everyone on the old revision gets it.
//
// Plus a real browser: the draft panel, approving through the password prompt,
// and the course card's Needs update chip.
//
// Caller sets PORT + DBPATH, QUALITY_WEBHOOK_* pointing at QUALITY_HOOK_PORT.
// Control: remove the PUT guard in api/documents.js — "an approved document's
// text cannot be edited in place" fails, and the draft no longer stands apart.
import http from 'http';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5165);
const HOOK_PORT = Number(process.env.QUALITY_HOOK_PORT || 5166);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

// The Quality bot, standing in.
const received = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    received.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  });
});
await new Promise(r => hook.listen(HOOK_PORT, '127.0.0.1', r));
const waitFor = async (n, ms = 5000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 50)); };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('dr-dc', 'Dana Control', 'admin', 'document_control');
  mk('dr-op', 'Otto Trainee', 'operator', 'warehouse', { operator: 'view' });
  db.close();
}
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
await call('POST', '/users/set-password', { user_id: 'dr-dc', password: 'Control2026!!', setup_code: 'SC-dr-dc' });
const login = await call('POST', '/users/login', { name: 'Dana Control', password: 'Control2026!!' });
const tok = login.json?.token;
t('Document Control signed in', !!tok);

// An approved SOP at V3, a course built on it, and one person trained on V3.
let r = await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 900', title: 'Allergen Changeover', category: 'quality',
  revision: 'V3', status: 'active', content: '# Purpose\nOld text.' }, tok);
const doc = r.json;
t('an approved SOP at V3', r.status === 201 && doc.status === 'active' && doc.revision === 'V3');
r = await call('POST', '/training/courses', { code: 'SOP900', title: 'Allergen Changeover Training', sop_id: doc.id, retrain_on_doc_change: true }, tok);
const course = r.json;
t('a course linked to it records it was built on V3', r.status === 201 && course.built_on_revision === 'V3' && course.built_on_kind === 'linked', JSON.stringify(course).slice(0, 160));
r = await call('POST', '/training', { employee_name: 'Otto Trainee', employee_user_id: 'dr-op', course_id: course.id, status: 'completed',
  training_date: '2026-10-01', completion_date: '2026-10-01', method: 'verbal', competence_confirmed: true }, tok);
t('Otto is trained on V3', r.status === 201 && r.json?.sop_revision === 'V3', `${r.status} ${r.json?.sop_revision}`);

console.log('\n── 1. the approved revision does not move ──');
r = await call('PUT', `/documents/${doc.id}`, { content: '# Purpose\nChanged in place.' }, tok);
t("an approved document's text cannot be edited in place", r.status === 409 && r.json?.code === 'APPROVED_REVISION_LOCKED', `${r.status}`);
r = await call('PUT', `/documents/${doc.id}`, { revision: 'V9' }, tok);
t('nor its revision number', r.status === 409 && r.json?.code === 'APPROVED_REVISION_LOCKED');
r = await call('PUT', `/documents/${doc.id}`, { status: 'draft' }, tok);
t('nor can it be moved back to draft by an edit', r.status === 409);
r = await call('PUT', `/documents/${doc.id}`, { owner: 'Daniela Servin' }, tok);
t('its metadata still edits', r.status === 200 && r.json?.owner === 'Daniela Servin' && r.json?.revision === 'V3');

r = await call('GET', `/documents/${doc.id}/revisions`, null, tok);
t('the next revision offered is V4', r.json?.suggested_revision === 'V4' && r.json?.draft === null);
r = await call('POST', `/documents/${doc.id}/revisions`, {}, tok);
const draft = r.json;
t('a draft revision V4 is started from the text in force', r.status === 201 && draft.revision === 'V4' && draft.status === 'draft' && /Old text/.test(draft.description));
r = await call('POST', `/documents/${doc.id}/revisions`, {}, tok);
t('only one draft at a time', r.status === 409);
r = await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { description: '# Purpose\nNew text for V4.', change_summary: 'Added the swab step' }, tok);
t('the draft takes the new text', r.status === 200 && /New text/.test(r.json?.description));
r = await call('GET', `/documents/${doc.id}`, null, tok);
t('…and the approved document still reads V3 with the old text', r.json?.revision === 'V3' && /Old text/.test(r.json?.description));

console.log('\n── approving: a new number, with a password ──');
await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { revision: 'v3' }, tok);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, {}, tok);
t('a number already used ("v3" is V3) is refused, before any password', r.status === 409 && r.json?.code === 'REVISION_NUMBER_USED' && r.json?.suggested === 'V4', `${r.status} ${r.json?.error}`);
await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { revision: 'V4' }, tok);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, {}, tok);
t('approving asks for the password', r.status === 403 && r.json?.signature_required === true);
t('nothing was signalled before approval', received.length === 0);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, { signature_password: 'Control2026!!' }, tok);
t('approved with the password', r.status === 200 && r.json?.document?.revision === 'V4', `${r.status} ${r.json?.error}`);
r = await call('GET', `/documents/${doc.id}`, null, tok);
t('the document is now V4 with the new text', r.json?.revision === 'V4' && /New text/.test(r.json?.description) && r.json?.training_revision === 'V4');
r = await call('GET', `/documents/${doc.id}/revisions`, null, tok);
const hist = r.json?.revisions || [];
t('V3 is kept as superseded history, V4 is in force', hist.some(h => h.revision === 'V3' && h.status === 'superseded' && h.source === 'baseline' && /Old text/.test(h.description))
  && hist.some(h => h.revision === 'V4' && h.status === 'approved' && h.approved_by === 'Dana Control'));

console.log('\n── 2. the Quality bot is told ──');
await waitFor(1);
const sig = received[0]?.body;
t('one signal reached the Quality bot', received.length === 1, `${received.length}`);
t('it carries the document, the old and new revision', sig?.event === 'document.revision_approved' && sig.document?.doc_number === 'SOP 900'
  && sig.old_revision === 'V3' && sig.new_revision === 'V4', JSON.stringify(sig).slice(0, 200));
t('…and the linked course, marked as needing an update', sig?.linked_courses?.length === 1 && sig.linked_courses[0].code === 'SOP900'
  && sig.linked_courses[0].built_on_revision === 'V3' && sig.linked_courses[0].needs_update === true);
t('it is sent with the Quality bot key', received[0]?.auth === 'Bearer qual-key');

console.log('\n── 3. the course needs an update ──');
let courses = (await call('GET', '/training/courses', null, tok)).json;
let c = courses.find(x => x.id === course.id);
t('the course reads "needs update" against V4', c?.needs_update === true && c.doc_revision === 'V4' && c.built_on_revision === 'V3');

console.log('\n── 4. retraining waits for the course ──');
const openRetrain = () => q("SELECT COUNT(*) n FROM work_orders WHERE training_course_id = ? AND assigned_to_id = 'dr-op' AND status IN ('open','in_progress','overdue')", course.id)[0].n;
t('no retraining is assigned yet', openRetrain() === 0);
let person = (await call('GET', '/training/people/dr-op', null, tok)).json;
t('Otto is not read as out of date against a course that has not caught up', person?.rows?.find(x => x.course_id === course.id)?.state === 'current');
r = await call('PUT', `/training/courses/${course.id}`, { built_on_revision: 'V4' }, tok);
t('the built-on revision cannot be typed on the course', r.status === 400 && r.json?.code === 'BUILT_ON_OWNED');
r = await call('POST', `/training/courses/${course.id}/revision`, { kind: 'no_change' }, tok);
t('"no course change needed" needs a reason', r.status === 400);
r = await call('POST', `/training/courses/${course.id}/revision`, { kind: 'updated', note: 'Swab step added to slide 4' }, tok);
t('marking the course updated for V4 assigns Otto his retraining', r.status === 200 && r.json?.revision === 'V4' && r.json?.created?.length === 1, JSON.stringify(r.json).slice(0, 200));
t('…one open retraining task', openRetrain() === 1);
c = (await call('GET', '/training/courses', null, tok)).json.find(x => x.id === course.id);
t('the course is up to date now', c?.needs_update === false && c.built_on_revision === 'V4' && c.built_on_kind === 'updated');
person = (await call('GET', '/training/people/dr-op', null, tok)).json;
t('…and Otto reads out of date, with the task open', person?.rows?.find(x => x.course_id === course.id)?.state === 'outdated');
r = await call('POST', `/training/courses/${course.id}/revision`, { kind: 'updated' }, tok);
t('marking it again is refused', r.status === 409);

console.log('\n── a draft can be thrown away ──');
const d2 = (await call('POST', `/documents/${doc.id}/revisions`, {}, tok)).json;
r = await call('DELETE', `/documents/${doc.id}/revisions/${d2.id}`, { reason: '' }, tok);
t('discarding needs a reason', r.status === 400);
r = await call('DELETE', `/documents/${doc.id}/revisions/${d2.id}`, { reason: 'Started by mistake' }, tok);
t('discarded with one; the document is unchanged', r.status === 200 && (await call('GET', `/documents/${doc.id}`, null, tok)).json?.revision === 'V4');

console.log('\n── the revision worklist goes through the same writer ──');
r = await call('POST', `/documents/${doc.id}/apply-revision`, { fields: { description: 'Text changed with no new number' } }, tok);
t('new text with no new number is refused', r.status === 400 && /new revision number/.test(r.json?.error || ''));
r = await call('POST', `/documents/${doc.id}/apply-revision`, { fields: { revision: 'V5', description: '# Purpose\nV5 from paper.' }, filename: 'SOP_900_V5.pdf' }, tok);
t('a paper revision with a new number is recorded', r.status === 200 && r.json?.revision === 'V5');
await waitFor(2);
t('…and signals the Quality bot too', received[1]?.body?.new_revision === 'V5' && received[1]?.body?.old_revision === 'V4' && received[1]?.body?.source === 'transcribed');
const rows = (await call('GET', `/documents/${doc.id}/revisions`, null, tok)).json.revisions.slice().reverse();
t('history: V3 and V4 superseded, V5 in force', rows.map(x => `${x.revision}:${x.status}`).join(',') === 'V3:superseded,V4:superseded,V5:approved', JSON.stringify(rows));

console.log('\n── a document not yet approved edits freely, and its first approval signals ──');
const fresh = (await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 901', title: 'Glass Policy', category: 'quality', revision: '1', status: 'draft', content: 'Draft.' }, tok)).json;
r = await call('PUT', `/documents/${fresh.id}`, { content: 'Draft, edited.', revision: '1.1' }, tok);
t('a draft document edits in place', r.status === 200 && r.json?.revision === '1.1');
r = await call('PUT', `/documents/${fresh.id}`, { status: 'active' }, tok);
await waitFor(3);
t('its first approval is recorded and signalled', r.status === 200 && r.json?.status === 'active' && received[2]?.body?.new_revision === '1.1' && received[2]?.body?.old_revision === null);

console.log('\n── the screens ──');
await call('POST', `/documents/${doc.id}/revisions`, { change_summary: 'Browser draft' }, tok);
await call('POST', '/training/courses', { code: 'SOP900B', title: 'Allergen Changeover Refresher', sop_id: doc.id }, tok);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, login.json.user]);
await page.goto(`${URL}/?tab=sops&doc=${doc.id}`);
await page.waitForSelector('[data-doc-revisions]', { timeout: 15000 }).catch(() => {});
t('the document opens from ?doc= with its revisions panel', await page.locator('[data-doc-revisions]').count() === 1);
t('the draft V6 is shown apart from V5 in force', await page.locator('[data-rev-draft="V6"]').count() === 1);
await page.locator('[data-rev-approve]').click();
const pw = page.locator('input[type="password"]').last();
await pw.waitFor({ timeout: 5000 }).catch(() => {});
await pw.click();
await page.keyboard.type('Control2026!!');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
t('approving through the password prompt puts V6 in force', q('SELECT revision FROM sop_documents WHERE id = ?', doc.id)[0]?.revision === 'V6');
t('the panel shows the history', await page.locator('[data-rev-history] li').count() >= 4);
await page.goto(`${URL}/?tab=training&view=courses`);
await page.waitForTimeout(2500);
t('the course card shows "Needs update" for V6', await page.locator('[data-course-rev="SOP900"] [data-course-needs-update]').count() === 1);
await page.locator('[data-course-rev="SOP900"] [data-course-mark="updated"]').click();
await page.locator('[data-course-rev="SOP900"] [data-course-mark-confirm]').click();
await page.waitForTimeout(1200);
t('marking it from the card says what was assigned', /Marked for rev V6/.test(await page.locator('[data-course-rev="SOP900"]').innerText()));
await browser.close();

hook.close();

console.log('\n── V numbers (D-280) ──');
{
  // A document filed before revisions were controlled: the default "1.0", a signed copy that says V3.
  let x = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 008', title: 'Scale Cleaning', category: 'quality', revision: '1.0', status: 'active', content: 'x' }, tok);
  const wi = x.json;
  { const d = new Database(DBP); d.prepare(`INSERT INTO document_attachments (id, document_id, kind, filename, storage_key, revision) VALUES ('att-wi8', ?, 'signed_original', 'WI008_Scale_Cleaning_V3.pdf', 'k/wi8', 'V3')`).run(wi.id); d.close(); }
  x = await call('GET', `/documents/${wi.id}/revisions`, null, tok);
  t('WI 008 at "1.0" with a signed V3 copy is offered V4, not "2.0"', x.json?.suggested_revision === 'V4', x.json?.suggested_revision);
  t('…and its stored revision is left as it was', q('SELECT revision FROM sop_documents WHERE id = ?', wi.id)[0].revision === '1.0');
  x = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 077', title: 'Plain', category: 'quality', revision: '1.0', status: 'active', content: 'x' }, tok);
  const plain = (await call('GET', `/documents/${x.json.id}/revisions`, null, tok)).json;
  t('a "1.0" document with nothing else to go on is offered V2', plain?.suggested_revision === 'V2', plain?.suggested_revision);
  x = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 078', title: 'Unnumbered', category: 'quality', content: 'x' }, tok);
  t('a new document with no revision typed starts at V1', x.json?.revision === 'V1', x.json?.revision);
  x = await call('POST', `/documents/${wi.id}/revisions`, { revision: 'V5' }, tok);
  t('the person may type another label when starting (V5)', x.status === 201 && x.json?.revision === 'V5', `${x.status} ${x.json?.revision}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
