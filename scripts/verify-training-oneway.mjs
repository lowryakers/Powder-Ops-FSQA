// verify:trainingoneway — one way in (D-352).
//
// 1. Several names typed into Log Completion record ONE group session, a record
//    each, instead of being refused and sent to Group Training.
// 2. Marking a course updated for its document's new revision writes a group
//    session ahead, filled in with the people who owe it; recording it closes it.
// 3. On a phone, Training opens on Log training · Records · Who's trained.
//
// Caller sets PORT + DBPATH. Control: main before this — no /session-drafts
// route (404) and the form refuses several names.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5222);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'OneWay2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ow-dc', 'Dora Trainer', 'supervisor', 'document_control', { training: 'edit' });
mk('ow-a', 'Alma Uno', 'operator', 'qa', { operator: 'view' });
mk('ow-b', 'Beto Dos', 'operator', 'purchasing', { operator: 'view' });
mk('ow-c', 'Cata Tres', 'operator', 'qa', { operator: 'view' });
db.prepare(`INSERT OR REPLACE INTO sop_documents (id, doc_number, title, category, revision, status) VALUES ('ow-doc', 'SOP 404', 'Supplier Approval', 'quality', 'V4', 'active')`).run();
db.prepare(`INSERT OR REPLACE INTO training_courses (id, code, title, active, sop_id, retrain_on_doc_change, built_on_revision, built_on_kind, passing_score)
  VALUES ('ow-course', 'OW-404', 'Supplier approval (SOP 404)', 1, 'ow-doc', 1, 'V4', 'linked', 80)`).run();
for (const [id, uid, name] of [['ow-r1', 'ow-a', 'Alma Uno'], ['ow-r2', 'ow-b', 'Beto Dos']]) {
  db.prepare(`INSERT OR REPLACE INTO training_records (id, employee_name, employee_user_id, training_topic, course_id, training_date, completion_date, status, method, score, passed, sop_revision)
    VALUES (?, ?, ?, 'SOP 404', 'ow-course', '2026-01-10', '2026-01-10', 'completed', 'quiz', 100, 1, 'V4')`).run(id, name, uid);
}
const courseId = db.prepare("SELECT id FROM training_courses WHERE active = 1 AND code = 'GMP-101'").get()?.id
  || db.prepare("SELECT id FROM training_courses WHERE active = 1 AND id != 'ow-course' ORDER BY code LIMIT 1").get().id;
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
await call('POST', '/users/set-password', { user_id: 'ow-dc', password: PW, setup_code: 'SC-ow-dc' });
const tok = (await call('POST', '/users/login', { name: 'Dora Trainer', password: PW })).json?.token;
t('the trainer signs in', !!tok);

console.log('\n── a session filled in ahead for a new revision ──');
let r = await call('GET', '/training/session-drafts', null, tok);
t('the drafts list answers, empty to begin with', r.status === 200 && Array.isArray(r.json) && !r.json.some(d => d.course_id === 'ow-course'), `${r.status}`);
const sd = new Database(DBP); sd.prepare("UPDATE sop_documents SET revision = 'V5' WHERE id = 'ow-doc'").run(); sd.close();
r = await call('POST', '/training/courses/ow-course/revision', { kind: 'updated', note: 'new approval step' }, tok);
t('marking the course updated for V5 answers', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('GET', '/training/session-drafts', null, tok);
const draft = (r.json || []).find(d => d.course_id === 'ow-course');
t('A SESSION IS WAITING, filled in with the two who owe V5', !!draft && draft.sop_revision === 'V5'
  && draft.people.map(p => p.user_id).sort().join() === 'ow-a,ow-b', JSON.stringify(draft));
t('…and nobody was given a record for it', q("SELECT COUNT(*) n FROM training_records WHERE course_id = 'ow-course' AND sop_revision = 'V5'")[0].n === 0);
r = await call('POST', `/training/session-drafts/${draft?.id}/dismiss`, { reason: '' }, tok);
t('"not needed" without a reason is refused', r.status === 400);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const me = (await call('GET', '/users/me', null, tok)).json;
const open = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('module_tab_training'); }, [tok, me]);
  await page.goto(`${URL}/?tab=training`);
  await page.waitForTimeout(3000);
  return page;
};
const signIfAsked = async (page) => {
  await page.waitForTimeout(600);
  const pw = page.locator('[data-signature-password]');
  if (await pw.count()) {
    const name = page.locator('[data-signature-name]');
    if (await name.count()) await name.click().then(() => name.fill('Dora Trainer'));
    await pw.click(); await pw.fill(PW);
    await page.locator('[data-signature-submit]').click();
  }
  await page.waitForTimeout(1500);
};

let page = await open(1280);
await page.getByRole('button', { name: /Log Completion/ }).click();
await page.waitForTimeout(400);
await page.locator('select').filter({ hasText: 'Select course' }).first().selectOption(courseId);
await page.getByPlaceholder('Start typing a name…').fill('Alma Uno, Ghost Person');
t('a name with no account in the list is named', await page.locator('[data-group-person="unknown"]').count() === 1);
t('…and Save waits', await page.locator('[data-save-completion]').isDisabled());
await page.getByPlaceholder('Start typing a name…').fill('Alma Uno, Beto Dos and Cata Tres');
t('SEVERAL REAL NAMES READ AS ONE GROUP SESSION', await page.locator('[data-name-group="ok"]').count() === 1
  && await page.locator('[data-group-person="ok"]').count() === 3);
const tick = page.locator('[data-field="competence"] input[type="checkbox"]');
if (await tick.count()) await tick.check();
t('…Save is offered once the trainer ticks competence', !(await page.locator('[data-save-completion]').isDisabled()));
const before = q('SELECT COUNT(*) n FROM training_sessions')[0].n;
await page.locator('[data-save-completion]').click();
await signIfAsked(page);
const sess = q('SELECT * FROM training_sessions ORDER BY created_at DESC, rowid DESC LIMIT 1')[0];
const att = sess ? q('SELECT employee_user_id FROM training_records WHERE session_id = ?', sess.id).map(x => x.employee_user_id).sort().join() : '';
t('ONE SESSION, A RECORD EACH, linked to their accounts', q('SELECT COUNT(*) n FROM training_sessions')[0].n === before + 1 && att === 'ow-a,ow-b,ow-c', att);

await page.goto(`${URL}/?tab=training`);
await page.waitForTimeout(2500);
t('the waiting session is shown on Training', await page.locator(`[data-session-draft="${draft?.id}"]`).count() === 1);
await page.locator(`[data-session-draft="${draft?.id}"] [data-open-draft]`).click();
await page.waitForTimeout(800);
t('…Record it opens Group Training filled in', await page.locator('[data-draft-session]').count() === 1
  && (await page.locator('[data-picked-count]').innerText()).startsWith('2'));
const ht = page.locator('[data-field="competence"] input[type="checkbox"]');
if (await ht.count()) await ht.first().check();
await page.locator('[data-record-session]').click();
await signIfAsked(page);
t('RECORDING IT FILES V5 FOR BOTH', q("SELECT COUNT(*) n FROM training_records WHERE course_id = 'ow-course' AND sop_revision = 'V5'")[0].n === 2);
t('…and the draft closes', q("SELECT status FROM training_session_drafts WHERE id = ?", draft?.id)[0]?.status === 'recorded');
await page.close();

page = await open(390);
t('ON A PHONE, Training opens on the short menu', await page.locator('[data-training-short-menu]').count() === 1
  && await page.locator('[data-short-log]').count() === 1 && await page.locator('[data-short-records]').count() === 1 && await page.locator('[data-short-roster]').count() === 1);
t('…the eleven tabs are behind "All tabs and tools"', await page.locator('[data-module-tab], [role="tab"]').count() === 0);
await page.locator('[data-short-roster]').click();
await page.waitForTimeout(300);
await page.locator('[data-roster-course]').selectOption('ow-course');
await page.waitForTimeout(1200);
t('Who\'s trained opens the roster for the course picked', await page.locator('[data-course-roster]').count() === 1);
await page.keyboard.press('Escape');
await page.locator('[data-course-roster] button[aria-label="Close"]').click();
await page.locator('[data-short-more]').click();
await page.waitForTimeout(300);
t('…and every tab is one tap away', await page.locator('[data-short-back]').count() === 1);
t('nothing pans sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.close();
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
