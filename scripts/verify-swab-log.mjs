// verify:swablog — D-186. QA's swabs written down as they are taken, filed as
// Sanitation records — one per room visit — through the record's own writer.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main`
// before this change: there is no /api/sanitation/swab-log and the first write fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const URL = `http://localhost:${process.env.PORT || 5112}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('sl-qa', 'Diana Swabs', 'operator', 'qa', { sanitation: 'edit' });
mk('sl-other', 'Other Swabber', 'operator', 'qa', { sanitation: 'edit' });

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Swabs2026!!', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Swabs2026!!' })).json();
};
const qa = await signIn('Diana Swabs', 'sl-qa');
const other = await signIn('Other Swabber', 'sl-other');
t('signed in', !!qa?.token && !!other?.token);
const call = async (method, p, body, auth = qa) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${auth.token}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};

console.log('\n── a round of swabs, written as taken ──');
const first = await call('GET', '/sanitation/swab-log');
t('the log opens empty with the plant\'s date and time', first.status === 200 && first.body.entries.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(first.body.now?.date) && /^\d{2}:\d{2}$/.test(first.body.now?.time), JSON.stringify(first.body).slice(0, 160));
const d = new Date(`${first.body.now.date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
const day = d.toISOString().slice(0, 10);
const line = (b) => call('POST', '/sanitation/swab-log', { swabbed_on: day, ...b });
const a1 = await line({ swabbed_time: '07:57', room: '3', surface: 'Utensils', swab_no: '653', atp_reading: 0, allergen_swab: true, allergen_lot: '9626' });
t('a line saves the moment it is entered', a1.status === 201 && a1.body.swab_no === '653', JSON.stringify(a1.body).slice(0, 160));
await line({ swabbed_time: '08:00', room: '3', surface: 'Sifter', swab_no: '654', atp_reading: 2 });
await line({ swabbed_time: '08:02', room: '3', surface: 'Table', swab_no: '655', atp_reading: 4 });
await line({ swabbed_time: '08:08', room: 'Batching 2', surface: 'Table', swab_no: '657', atp_reading: 0 });
const f1 = await line({ swabbed_time: '08:10', room: '4', surface: 'Table', swab_no: '658', atp_reading: 45 });
t('an over-limit reading is shown as over the limit, before filing', f1.body?.grade?.pass === false && f1.body.grade.limit === 30, JSON.stringify(f1.body?.grade));
await line({ swabbed_time: '08:17', room: '4', surface: 'Table', swab_no: '659', atp_reading: 5 });
const noRoom = await line({ swabbed_time: '08:20', surface: 'Scissors', swab_no: '660', atp_reading: 1 });
t('a line with no room is kept and flagged, never refused', noRoom.status === 201 && /room/i.test(noRoom.body.not_ready || ''));
const bad = await line({ swabbed_time: '08:21', room: '3', atp_reading: 'high' });
t('a reading that is not a number is refused by name', bad.status === 400 && /high/.test(bad.body?.error || ''));
const badTime = await line({ swabbed_time: '8am', room: '3', atp_reading: 1 });
t('a time that is not HH:MM is refused', badTime.status === 400);

console.log('\n── reconciled later ──');
const up = await call('PUT', `/sanitation/swab-log/${a1.body.id}`, { allergen_result: 'pass' });
t('the allergen kit read later is entered on the line', up.status === 200 && up.body.allergen_result === 'pass');
const theirs = await call('PUT', `/sanitation/swab-log/${a1.body.id}`, { atp_reading: 99 }, other);
t('somebody else cannot touch her line (404)', theirs.status === 404);
t('…and does not see it', (await call('GET', '/sanitation/swab-log', null, other)).body.entries.length === 0);
const plan = await call('GET', '/sanitation/swab-log');
t('the log groups the round into room visits: Room 3 (3), Batching 2 (1), Room 4 failed (1), Room 4 re-swab (1)',
  plan.body.visits.length === 4 && plan.body.visits.map((v) => `${v.room}:${v.swabs}`).join(',') === '3:3,Batching 2:1,4:1,4:1', JSON.stringify(plan.body.visits));

console.log('\n── filed at one time ──');
const filed = await call('POST', '/sanitation/swab-log/file', {});
t('four records filed, the roomless line left with its reason', filed.status === 200 && filed.body.filed.length === 4 && filed.body.left.length === 1 && /room/i.test(filed.body.left[0].why), JSON.stringify(filed.body).slice(0, 300));
const rec3 = db.prepare(`SELECT * FROM sanitation_records WHERE id = ?`).get(filed.body.filed[0].record_id);
const swabs3 = db.prepare('SELECT * FROM sanitation_swabs WHERE record_id = ? ORDER BY line').all(rec3?.id);
t('Room 3 is ONE record carrying its three swabs as rows', rec3?.area === '3' && swabs3.length === 3 && swabs3.map((s) => s.swab_no).join(',') === '653,654,655');
t('graded by the record\'s writer against PC #1 in force (30 on a fresh database)', swabs3.every((s) => s.atp_limit === 30 && s.atp_pass === 1) && rec3.result === 'pass' && rec3.atp_reading === 4);
t('the allergen result and lot ride on the row', swabs3[0].allergen_swab === 1 && swabs3[0].allergen_result === 'pass' && swabs3[0].allergen_lot === '9626');
const exp = (await import('../server/swab-sheet-seed.js')).plantLocalToUtc(day, '07:57');
t('the record carries the time she TYPED, as the plant\'s clock, not the filing time', rec3.performed_at === exp, `${rec3.performed_at} vs ${exp}`);
t('it is filed by her, as a pre-op, on the Sanitation list', rec3.performed_by === 'Diana Swabs' && rec3.type === 'pre_op' && rec3.record_group === 'sanitation');
const r4 = filed.body.filed.filter((f) => f.room === '4');
t('Room 4\'s failing swab is its own record, FAILED by the grade; the re-swab is another, passed', r4.length === 2 && r4[0].result === 'fail' && r4[1].result === 'pass', JSON.stringify(r4));
t('…and the failure carries the escalation message the form would have shown', !!r4[0].atp_message);
t('every filed line points at its record', db.prepare("SELECT COUNT(*) n FROM swab_log_entries WHERE person_id = 'sl-qa' AND record_id IS NOT NULL").get().n === 6);
const again = await call('POST', '/sanitation/swab-log/file', {});
t('filing again files nothing new', again.body.filed.length === 0 && again.body.left.length === 1);
const locked = await call('PUT', `/sanitation/swab-log/${a1.body.id}`, { atp_reading: 1 });
t('a filed line is closed — corrected on its record (409)', locked.status === 409);
t('audited', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'swab_log'").get().n >= 1);
const del = await call('DELETE', `/sanitation/swab-log/${noRoom.body.id}`);
t('an unfiled line can be removed', del.status === 200 && (await call('GET', '/sanitation/swab-log')).body.entries.length === 0);

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
  await page.goto(`${URL}/?tab=sanitation`);
  await page.waitForSelector('[data-swab-entry]', { timeout: 20000 }).catch(() => {});
  t(`${width}px: the swab log is at the top of Sanitation`, await page.isVisible('[data-swab-entry]'));
  await page.selectOption('[data-swab-room]', '3');
  await page.fill('[data-swab-surface-in]', 'Table');
  await page.fill('[data-swab-no-in]', width === 1280 ? '700' : '800');
  await page.fill('[data-swab-atp-in]', '7');
  await page.press('[data-swab-atp-in]', 'Enter');
  await page.waitForSelector('[data-swab-line-row]', { timeout: 5000 }).catch(() => {});
  t(`${width}px: Enter adds the line to the list`, (await page.$$('[data-swab-line-row]')).length === 1);
  t(`${width}px: the room stays and the swab # counts up for the next one`,
    await page.inputValue('[data-swab-room]') === '3' && await page.inputValue('[data-swab-no-in]') === (width === 1280 ? '701' : '801'));
  await page.fill('[data-swab-surface-in]', 'Sifter');
  await page.fill('[data-swab-atp-in]', '3');
  await page.press('[data-swab-atp-in]', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-swab-line-row]').length === 2, null, { timeout: 5000 }).catch(() => {});
  t(`${width}px: …and the next`, (await page.$$('[data-swab-line-row]')).length === 2);
  t(`${width}px: the File button says what will be filed`, /File 2 swabs/.test(await page.textContent('[data-swab-file]')) && /1 record/.test(await page.textContent('[data-swab-visits]')));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  t(`${width}px: the page does not pan sideways`, !overflow);
  await page.click('[data-swab-file]');
  await page.waitForSelector('[data-swab-filed]', { timeout: 10000 }).catch(() => {});
  t(`${width}px: filed — one record with two swabs`, /Filed 1 record/.test(await page.textContent('[data-swab-filed]').catch(() => '')) && /2 swabs/.test(await page.textContent('[data-swab-filed]').catch(() => '')));
  t(`${width}px: the list is clear`, (await page.$$('[data-swab-line-row]')).length === 0);
  await page.close();
}
await browser.close();
db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
