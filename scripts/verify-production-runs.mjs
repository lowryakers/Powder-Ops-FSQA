// verify:productionruns — D-146 (OBL-22), live on a fresh database and a browser at 390px.
//
// PC #1 (Protocol 003 V4) is "a pre-operational clean at the beginning of every
// run". D-125 retired the daily Pre-Op card and nothing knew a run had begun.
// A run now opens and closes, its start asks Cleaning for the Pre-Op when none
// is on record for the room since its last run, and either door of filing the
// clean answers it. Reported, never gated.
//
// Caller sets PORT + DBPATH + DB_PATH (server already up). Needs a built client.
// The control is `main`: there is no run to start.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5059);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
const mk = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mk('pr-sup', 'Bernardo Runs', 'supervisor', 'Batching', { 'production-log': 'edit', sanitation: 'edit' });
mk('pr-cln', 'Zuleika Runs', 'operator', 'cleaning', null);
mk('pr-op', 'Floor Runs', 'operator', 'warehouse', null);
// A passing Pre-Op in Batching 2 an hour ago: the room is ready.
db.prepare(`INSERT INTO sanitation_records (id, area, type, performed_by, performed_at, entered_at, result, record_group, atp_reading, atp_limit, notes)
  VALUES ('pr-b2', 'Batching 2', 'pre_op', 'Zuleika Runs', datetime('now','-1 hour'), datetime('now','-1 hour'), 'pass', 'sanitation', 14, 35, 'planted')`).run();
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name) => {
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const sup = await login('pr-sup', 'Bernardo Runs');
const cln = await login('pr-cln', 'Zuleika Runs');
const op = await login('pr-op', 'Floor Runs');
t('a supervisor, a cleaner and a floor operator sign in', !!sup?.token && !!cln?.token && !!op?.token);
const S = (m, p, b) => c(m, p, b, sup.token);
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

console.log('\n── a run with no Pre-Op on record asks Cleaning for one ──');
let r = await J(await S('POST', '/production/runs', { room: '4', team: 'Filling', mo_number: 'MO77001', product_name: 'Pancake' }));
t('starting a run in Room 4 issues RUN-0001', r?.run?.run_no === 'RUN-0001', JSON.stringify(r).slice(0, 160));
t('…reads "no Pre-Op on record" and says it asked', r?.run?.preop?.state === 'owed' && r?.prompt_raised === true);
const run4 = r.run;
// THE FLOOR'S CLOCK: a run starts, the clean follows minutes later. Records are
// stamped to the second, so the fixture spaces them as the floor does.
const shift = (sql, ...a) => { const d = new Database(DBP); d.prepare(sql).run(...a); d.close(); };
shift("UPDATE production_runs SET started_at = datetime('now','-30 minutes') WHERE id = ?", run4.id);
const wo = q('SELECT * FROM work_orders WHERE id = ?', run4.prompt_work_order_id)[0];
t('the prompt is a Cleaning task due today, naming the room and the run', wo?.task_group === 'cleaning' && wo?.title === 'Pre-Op clean — Room 4 (run RUN-0001 starting)'
  && wo?.due_date === q("SELECT date('now') d")[0].d && /PC #1/.test(wo?.description || ''), JSON.stringify({ t: wo?.title, g: wo?.task_group }));
let res = await S('POST', '/production/runs', { room: '4' });
t('a second run in a room with one open is refused, naming it', res.status === 409 && /RUN-0001/.test((await J(res))?.error || ''));
res = await S('POST', '/production/runs', { room: 'Restroom' });
t('a run is refused outside a production or batching room', res.status === 400);
res = await c('POST', '/production/runs', { room: '6' }, op.token);
t('a floor operator without the right cannot start one', res.status === 403);

console.log('\n── a room already cleaned starts without a prompt ──');
r = await J(await S('POST', '/production/runs', { room: 'Batching 2', mo_number: 'MO77002' }));
t('Batching 2, cleaned an hour ago, reads "Pre-Op on record" and raises nothing', r?.run?.preop?.state === 'before' && r?.prompt_raised === false && !r.run.prompt_work_order_id);

console.log('\n── the cleaner answers it from her Operator View ──');
const ops = await J(await c('GET', '/pm/operator-tasks', null, cln.token));
const card = (ops || []).find((x) => x.id === run4.prompt_work_order_id);
t('the Pre-Op task is on the cleaner\'s Operator View, asking for the ATP swab', !!card && card.swab_plan?.atp === 'required', JSON.stringify(card?.swab_plan));
res = await c('POST', `/pm/work-orders/${run4.prompt_work_order_id}/complete-and-recur`, { readings: { atp_reading: '12' }, result: 'pass' }, cln.token);
t('completing it works', res.status === 200, `${res.status} ${JSON.stringify(await J(res)).slice(0, 160)}`);
const filed = q("SELECT * FROM sanitation_records WHERE area = '4' AND type = 'pre_op' ORDER BY rowid DESC LIMIT 1")[0];
t('…and files Room 4\'s Pre-Op record under the room token, graded against 35', filed?.result === 'pass' && filed?.atp_reading == 12 && filed?.atp_limit === 35);
shift("UPDATE sanitation_records SET performed_at = datetime('now','-20 minutes') WHERE id = ?", filed.id);
r = await J(await S('GET', '/production/runs'));
t('the run now reads "Pre-Op filed after the start" — late, and on record', r?.runs?.find((x) => x.id === run4.id)?.preop?.state === 'after');

console.log('\n── the next run owes its own ──');
await S('POST', `/production/runs/${run4.id}/close`, {});
shift("UPDATE production_runs SET ended_at = datetime('now','-10 minutes') WHERE id = ?", run4.id);
t('closing the run records who and when', q('SELECT status, ended_by FROM production_runs WHERE id = ?', run4.id)[0]?.ended_by === 'Bernardo Runs');
r = await J(await S('POST', '/production/runs', { room: '4', mo_number: 'MO77003' }));
t('the next run in Room 4 owes a new Pre-Op — the clean before the last run does not count twice', r?.run?.preop?.state === 'owed' && r.prompt_raised === true
  && r.run.prompt_work_order_id !== run4.prompt_work_order_id);
const run4b = r.run;

console.log('\n── a Pre-Op filed on the Sanitation form closes the task ──');
res = await S('POST', '/sanitation', { area: '4', type: 'pre_op', performed_by: 'Zuleika Runs', result: 'pass', atp_reading: 10 });
t('filing the Pre-Op on the form works', res.status === 201 || res.status === 200, String(res.status));
t('…and closes the prompt it answers, with the reason on it', q('SELECT status, notes FROM work_orders WHERE id = ?', run4b.prompt_work_order_id)[0]?.status === 'completed'
  && /Closed by the Pre-Op record/.test(q('SELECT notes FROM work_orders WHERE id = ?', run4b.prompt_work_order_id)[0]?.notes || ''));

console.log('\n── a failed swab is not a Pre-Op ──');
r = await J(await S('POST', '/production/runs', { room: '6' }));
await S('POST', '/sanitation', { area: '6', type: 'pre_op', performed_by: 'Zuleika Runs', result: 'pass', atp_reading: 80 });
const run6 = (await J(await S('GET', '/production/runs'))).runs.find((x) => x.room === '6');
t('an over-limit swab is graded a fail, so the run still owes its Pre-Op and the task stays open', run6?.preop?.state === 'owed'
  && q('SELECT status FROM work_orders WHERE id = ?', r.run.prompt_work_order_id)[0]?.status === 'open');
t('nothing about the clean is stored on the run — it is read off the Sanitation log', !q('PRAGMA table_info(production_runs)').some((x) => /preop|atp|clean/i.test(x.name)));

console.log('\n── in the browser at 390px ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [sup.token, sup.user]);
  await page.goto(`${URL}/?tab=production-log&view=runs`);
  await page.locator('[data-production-runs]').waitFor({ timeout: 15000 });
  t('Production Log → Runs opens from the link', true);
  await page.locator('[data-run-room]').selectOption('5');
  await page.locator('[data-run-mo]').fill('MO77005');
  await page.locator('[data-run-start]').click();
  await page.locator('[data-run-msg]').waitFor();
  t('starting a run on the phone says Cleaning was asked for the Pre-Op', /Pre-Op task went to Cleaning/.test(await page.locator('[data-run-msg]').innerText()));
  const row = page.locator('[data-run="RUN-0005"]');
  t('the run reads "No Pre-Op on record" in red', await row.locator('[data-run-preop="owed"]').count() === 1);
  t('Batching 2 reads "Pre-Op on record"', await page.locator('[data-run="RUN-0002"] [data-run-preop="before"]').count() === 1);
  await page.locator('[data-run-close="RUN-0005"]').click();
  await page.waitForTimeout(600);
  t('Close run closes it', q("SELECT status FROM production_runs WHERE run_no = 'RUN-0005'")[0]?.status === 'closed');
  t('no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
} catch (e) { t('the Runs tab rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
