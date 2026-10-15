// verify:qaclearance — hygiene clearances are in QA Review (D-180).
//
// The Task Center's Clearance tab read 18 while QA Review — "everything waiting
// on your signature, across every log" — showed none of them: the registry had
// no source for a food-contact clearance. Asserts, live:
//   1. QA Review's count is the Task Center's count, row for row;
//   2. a routine clearance signs from the list, written by the SAME function
//      the Task Center card uses, as the signed-in person;
//   3. a job with something wrong on it (issue flagged, step unticked,
//      lubricant not food-grade) is listed but must be OPENED — never signed
//      from a list, never ticked by "select all";
//   4. nobody clears their own work, and only QA clears;
//   5. the Task Center door records the signed-in clearer, not a typed name;
//   6. in a browser: the card is there, a blocked row offers no Sign, and
//      "Open" lands on the Task Center's Clearance list.
// THE CONTROL is the code before D-180: no `hygiene-clearance` source.
const PORT = process.env.PORT || 5107;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const DBP = process.env.DBPATH;
const PW = 'Clearance2026!';
const q1 = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const u = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES (?,?,?,?,?,1,?,?,datetime('now','+7 day'))`);
  u.run('qc-qa', 'Clear Qa', 'Clear Qa', 'supervisor', 'qa', JSON.stringify({ pm: 'edit', 'qa-review': 'view' }), 'SC-QC1');
  u.run('qc-adm', 'Clear Admin', 'Clear Admin', 'admin', 'office', null, 'SC-QC2');
  db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,is_food_contact,status) VALUES ('qc-eq','Clearance Mixer','Mixer',1,'active')`).run();
  const wo = db.prepare(`INSERT OR REPLACE INTO work_orders (id,equipment_id,title,status,due_date,completed_by,completed_at,
    procedure_steps,step_results,issue_flagged,lubricant_used,lubricant_is_food_grade,clearance_required,clearance_status)
    VALUES (?, 'qc-eq', ?, 'completed', date('now'), ?, datetime('now', ?), ?, ?, ?, ?, ?, 1, 'pending')`);
  wo.run('qc-ok', 'QC Daily clean — routine', 'Ricardo Floor', '-3 hour', '["Wipe","Inspect"]', '[true,true]', 0, null, null);
  wo.run('qc-issue', 'QC Daily clean — issue flagged', 'Ricardo Floor', '-2 hour', '["Wipe"]', '[true]', 1, null, null);
  wo.run('qc-lube', 'QC Weekly — grease', 'Ricardo Floor', '-1 hour', '["Grease"]', '[true]', 0, 'Grease X', 0);
  wo.run('qc-own', 'QC Daily clean — by the QA lead', 'Clear Qa', '-4 hour', '[]', '[]', 0, null, null);
  wo.run('qc-door', 'QC Daily clean — task door', 'Ricardo Floor', '-5 hour', '[]', '[]', 0, null, null);
  db.close();
}
async function signIn(id, name, code) {
  const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: PW, setup_code: code });
  return J(await post('/users/login', { name, password: PW }));
}
const qa = await signIn('qc-qa', 'Clear Qa', 'SC-QC1');
const adm = await signIn('qc-adm', 'Clear Admin', 'SC-QC2');
t('signed in as QA and as an admin outside QA', !!qa?.token && !!adm?.token);
const as = (tok) => (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` } });
const Q = as(qa.token); const A = as(adm.token);

console.log('\n── the count is the Task Center\'s count ──');
const review = async (r = Q) => (await J(await r('/qa-review?source=hygiene-clearance')))?.sources?.find((s) => s.key === 'hygiene-clearance');
let src = await review();
const tc = await J(await Q('/pm/clearance-pending'));
t('QA REVIEW HAS A HYGIENE CLEARANCE PILE', !!src, 'no source');
t('…with the Task Center\'s count', src?.count === tc?.length && src?.count >= 5, `review=${src?.count} taskcenter=${tc?.length}`);
t('…every Task Center clearance is a row', (tc || []).every((w) => src?.items?.some((i) => i.id === w.id)));
t('…and it opens the Task Center\'s Clearance list', src?.module === 'pm' && src?.view === 'clearance');
t('QA may sign it', src?.can_sign === true);
t('AN ADMIN OUTSIDE QA SEES IT BUT MAY NOT SIGN (the Task Center\'s own rule)', (await review(A))?.can_sign === false);
const row = (id) => src?.items?.find((i) => i.id === id);
t('a routine job is signable, and says what was done', !row('qc-ok')?.blocked && /2 of 2 steps ticked/.test(row('qc-ok')?.extra || ''));
t('A FLAGGED ISSUE MUST BE OPENED', /issue was flagged/.test(row('qc-issue')?.blocked || ''));
t('…and so must a lubricant not marked food-grade', /not marked food-grade/.test(row('qc-lube')?.blocked || ''));

console.log('\n── signing ──');
const sign = (ids, r = Q) => r('/qa-review/sign', { method: 'POST', body: JSON.stringify({ source: 'hygiene-clearance', ids, signature_password: PW }) });
let r = await J(await sign(['qc-ok', 'qc-issue', 'qc-lube', 'qc-own']));
t('the routine clearance is signed', r?.signed?.includes('qc-ok'), JSON.stringify(r));
const ok = q1('SELECT * FROM work_orders WHERE id = ?', 'qc-ok');
t('…recorded as cleared by the signed-in person', ok?.clearance_status === 'cleared' && ok?.clearance_by === 'Clear Qa');
t('…with the method saying where it was signed (no inspection method invented)', ok?.clearance_method === 'QA Review sign-off');
t('THE FLAGGED JOB IS REFUSED, still pending', r?.failed?.some((f) => f.id === 'qc-issue' && /Task Center/.test(f.error))
  && q1('SELECT clearance_status s FROM work_orders WHERE id = ?', 'qc-issue')?.s === 'pending');
t('…and the lubricant one', r?.failed?.some((f) => f.id === 'qc-lube'));
t('NOBODY CLEARS THEIR OWN WORK', r?.failed?.some((f) => f.id === 'qc-own' && /someone other/.test(f.error)));
t('an admin outside QA is refused', (await sign(['qc-door'], A)).status === 403);
src = await review();
t('the count drops by the one signed, and still matches the Task Center', src?.count === (await J(await Q('/pm/clearance-pending')))?.length);
r = await J(await sign(['qc-ok']));
t('a clearance already given is not given twice', r?.failed?.[0] && /Already cleared/.test(r.failed[0].error), JSON.stringify(r));

console.log('\n── the Task Center door ──');
let rr = await Q('/pm/work-orders/qc-door/clearance', { method: 'PUT', body: JSON.stringify({ status: 'cleared', cleared_by: 'Somebody Else', method: 'ATP Swab Test' }) });
t('the card still clears', rr.status === 200, String(rr.status));
t('THE CLEARER IS THE SIGNED-IN PERSON, not the name in the body', q1('SELECT clearance_by b FROM work_orders WHERE id = ?', 'qc-door')?.b === 'Clear Qa');

console.log('\n── in a browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
await page.goto(`${URL}/?tab=qa-review`);
const card = page.locator('button', { hasText: 'Hygiene clearances' }).first();
await card.waitFor({ timeout: 20000 }).catch(() => {});
t('the Hygiene clearances card is on QA Review', await card.count() === 1);
await card.click().catch(() => {});
await page.locator('[data-review-row="qc-issue"]').waitFor({ timeout: 8000 }).catch(() => {});
t('A FLAGGED ROW OFFERS NO SIGN BUTTON and says why', await page.locator('[data-review-sign="qc-issue"]').count() === 0
  && /issue was flagged/.test(await page.locator('[data-review-row="qc-issue"]').innerText().catch(() => '')));
await page.getByRole('button', { name: /Open Hygiene clearances/ }).click().catch(() => {});
await page.getByText('Pending Hygiene Clearance').waitFor({ timeout: 15000 }).catch(() => {});
t('"OPEN" LANDS ON THE TASK CENTER\'S CLEARANCE LIST', await page.getByText('Pending Hygiene Clearance').count() >= 1);
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
