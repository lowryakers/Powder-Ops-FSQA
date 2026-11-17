// verify:trainingroster — one record is one person, and who was trained on a
// course is one list and one PDF (D-351).
//
// Daniela typed "Maria Servin, Diana Quishpe, Adam Bliss" into the one-person
// Log Completion form; it saved as ONE employee nobody is, so the record counted
// for none of them. And the evidence Carol needs ("QA and Purchasing were trained
// on SOP 404") had no page: records one at a time, or a matrix of every course.
//
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: main before this — the several-names POST answers 201 and the roster
// routes are 404, so the first assertions fail.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5221);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'Roster2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma = null, extra = '') => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access${extra ? ', not_trainee' : ''})
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?${extra ? ', 1' : ''})`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ro-dc', 'Dina Control', 'supervisor', 'document_control', { training: 'edit' });
mk('ro-qa', 'Quella Assure', 'operator', 'qa', { operator: 'view' });
mk('ro-qa2', 'Quentin Assure', 'operator', 'qa', { operator: 'view' });
mk('ro-pur', 'Penny Buyer', 'operator', 'purchasing', { operator: 'view' });
mk('ro-wh', 'Walt House', 'operator', 'warehouse', { operator: 'view' });
mk('ro-bot', 'Quality Bot', 'operator', 'qa', { operator: 'view' }, 'bot');
const course = db.prepare("SELECT id, code, title FROM training_courses WHERE active = 1 AND code = 'GMP-101'").get()
  || db.prepare('SELECT id, code, title FROM training_courses WHERE active = 1 ORDER BY code LIMIT 1').get();
// An old imported record under a name nobody holds — an edit that leaves the name alone must still save.
db.prepare(`INSERT INTO training_records (id, employee_name, training_topic, course_id, training_date, completion_date, status, method, score, passed)
  VALUES ('ro-legacy', 'Former Person', 'Imported', ?, '2024-01-10', '2024-01-10', 'completed', 'quiz', 100, 1)`).run(course.id);
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
  return { status: r.status, json, buf, type: r.headers.get('content-type') || '' };
};
await call('POST', '/users/set-password', { user_id: 'ro-dc', password: PW, setup_code: 'SC-ro-dc' });
const tok = (await call('POST', '/users/login', { name: 'Dina Control', password: PW })).json?.token;
t('Document Control signs in with the Training grant', !!tok && !!course);
const today = new Date().toISOString().slice(0, 10);
const rec = (extra) => ({ course_id: course.id, training_date: today, completion_date: today, method: 'verbal', status: 'completed',
  competence_confirmed: true, signature_password: PW, ...extra });
const count = () => q('SELECT COUNT(*) AS n FROM training_records')[0].n;

console.log('\n── one record is one person ──');
let before = count();
let r = await call('POST', '/training', rec({ employee_name: 'Quella Assure, Penny Buyer, Walt House' }), tok);
t('SEVERAL NAMES IN ONE BOX ARE REFUSED', r.status === 400 && r.json?.code === 'SEVERAL_PEOPLE', `${r.status} ${JSON.stringify(r.json)}`);
t('…pointing to Group Training', /Group Training/.test(r.json?.error || ''));
r = await call('POST', '/training', rec({ employee_name: 'Quella Assure and Penny Buyer' }), tok);
t('"and" between two names is several people too', r.json?.code === 'SEVERAL_PEOPLE');
r = await call('POST', '/training', rec({ employee_name: 'Nobody Here' }), tok);
t('a name nobody holds is refused', r.status === 400 && r.json?.code === 'NOT_AN_EMPLOYEE', JSON.stringify(r.json));
r = await call('POST', '/training', rec({ employee_name: 'Quality Bot' }), tok);
t('a bot account is not a trainee', r.status === 400 && r.json?.code === 'NOT_A_TRAINEE', JSON.stringify(r.json));
t('…and none of those filed anything', count() === before);
r = await call('POST', '/training', rec({ employee_name: 'quella assure' }), tok);
t('a real person typed in lower case files', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
t('…linked to her account, under her own spelling', r.json?.employee_user_id === 'ro-qa' && r.json?.employee_name === 'Quella Assure', JSON.stringify([r.json?.employee_user_id, r.json?.employee_name]));
const qaRec = r.json?.id;

console.log('\n── an edit ──');
r = await call('PUT', '/training/ro-legacy', { notes: 'checked against the paper log' }, tok);
t('an imported record under a name with no account still takes an edit that leaves the name alone', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('PUT', `/training/${qaRec}`, { employee_name: 'Quella Assure, Quentin Assure' }, tok);
t('moving a record onto a list of names is refused', r.status === 400 && r.json?.code === 'SEVERAL_PEOPLE', JSON.stringify(r.json));

console.log('\n── who is trained on the course ──');
r = await call('GET', `/training/courses/${course.id}/roster?departments=qa,purchasing`, null, tok);
const rows = r.json?.rows || [];
const row = (n) => rows.find(x => x.name === n);
t('the roster answers for QA and Purchasing', r.status === 200 && rows.length >= 3, `${r.status} ${rows.length}`);
t('QA person trained shows trained, with the date and who signed', ['current', 'due_soon', 'trained'].includes(row('Quella Assure')?.state)
  && row('Quella Assure')?.trained_on === today && row('Quella Assure')?.sign_off?.by === 'Dina Control', JSON.stringify(row('Quella Assure')));
t('EVERYONE IN THE DEPARTMENTS IS LISTED — the untrained QA person reads Not trained', row('Quentin Assure')?.state === 'missing', JSON.stringify(row('Quentin Assure')));
t('…and so does Purchasing', row('Penny Buyer')?.state === 'missing');
t('the warehouse is not on a QA + Purchasing list', !row('Walt House'));
t('a bot is never on it', !row('Quality Bot'));
t('the counts are the rows', r.json?.counts?.people === rows.length && r.json?.counts?.trained === rows.filter(x => ['current', 'due_soon', 'trained'].includes(x.state)).length);
t('the departments to pick from are offered', (r.json?.departments_available || []).some(d => d.key === 'purchasing' && d.label === 'Purchasing'));
r = await call('GET', `/training/courses/${course.id}/roster.pdf?departments=qa,purchasing`, null, tok);
t('the PDF downloads', r.status === 200 && /pdf/.test(r.type) && r.buf.slice(0, 4).toString() === '%PDF', `${r.status} ${r.type}`);
r = await call('GET', '/training/courses/no-such/roster', null, tok);
t('an unknown course is a 404', r.status === 404);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const me = (await call('GET', '/users/me', null, tok)).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('module_tab_training'); }, [tok, me]);
  await page.goto(`${URL}/?tab=training`);
  await page.waitForTimeout(3000);
  const tabs = await page.locator('[role="tab"], [data-module-tab]').allInnerTexts().catch(() => []);
  if (width === 1280) {
    const labels = tabs.map(s => s.trim()).filter(Boolean);
    t('Records is the second tab, beside the matrix', labels.indexOf('Records') === 1 || (await page.getByRole('button', { name: /^Records$/ }).count()) > 0, JSON.stringify(labels.slice(0, 4)));
    await page.getByRole('button', { name: /Log Completion/ }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder('Start typing a name…').fill('Quentin Assure, Penny Buyer');
    t('the form says several people is a Group Training job', await page.locator('[data-name-several]').count() === 1);
    t('…offers to open it', await page.locator('[data-use-group]').count() === 1);
    t('…and Save waits', await page.locator('[data-save-completion]').isDisabled());
    await page.getByPlaceholder('Start typing a name…').fill('Quentin Ghost');
    t('a name nobody holds says to pick from the list', await page.locator('[data-name-unknown]').count() === 1);
    await page.goto(`${URL}/?tab=training&view=courses`);
    await page.waitForTimeout(2500);
    await page.locator(`[data-roster-open="${course.id}"]`).click();
    await page.waitForTimeout(1200);
    t('the course card opens who is trained', await page.locator('[data-course-roster]').count() === 1);
    await page.locator('[data-roster-dept="qa"]').click();
    await page.locator('[data-roster-dept="purchasing"]').click();
    await page.waitForTimeout(1200);
    t('…picking QA and Purchasing lists them, untrained in red', await page.locator('[data-roster-row="missing"]').count() >= 2
      && await page.locator('[data-roster-row]', { hasText: 'Quella Assure' }).count() === 1);
    t('…with a PDF button', await page.locator('[data-roster-pdf]').count() === 1);
  } else {
    t('on a phone nothing pans sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
