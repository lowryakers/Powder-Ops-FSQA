// Three things, against a live server on a fresh database.
//
//  1. Completing an onboarding SEEDS THE PAY ROSTER, carrying the hire date and
//     the rate off the packet, so nobody types them a second time.
//  2. A 30/90-day review is raised one at a time and works out its own due date
//     from the hire date.
//  3. A contractor sits on the same roster with `worker_type`, and never enters
//     the review cycle.
//
// Caller sets PORT + DBPATH + ONBOARDING_ENC_KEY.
const PORT = process.env.PORT || 4987;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const res = await fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('pr-admin','Roster Admin','Roster Admin','admin','office',1,'SC-PR',datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('pr-sup','Line Supervisor','Line Supervisor','supervisor','production',1,'SC-PS',datetime('now','+7 day'))`).run();
  db.close(); }
await call('POST', '/users/login', { name: 'Roster Admin' });
await call('POST', '/users/set-password', { user_id: 'pr-admin', password: 'Roster2026!', setup_code: 'SC-PR' });
const auth = (await call('POST', '/users/login', { name: 'Roster Admin', password: 'Roster2026!' })).body;
t('signed in as an admin', !!auth?.token);
const A = auth.token;

console.log('\n── onboarding hands the new starter to the pay roster ──');
const hire = '2026-09-01';
const created = (await call('POST', '/onboarding', {
  first_name: 'Nadia', last_name: 'Okonjo', position: 'Blending Operator', department: 'production',
  team: 'Batching', start_date: hire, pay_rate: '22.75', pay_frequency: 'hourly',
}, A)).body;
t('an onboarding was created', !!created?.id);

const before = (await call('GET', '/pay/employees', null, A)).body;
t('the pay roster does not know them yet', !before.some(r => r.name === 'Nadia Okonjo'));

const done = await call('POST', `/onboarding/${created.id}/complete`, { create_account: true }, A);
t('the onboarding completes', done.status === 200, JSON.stringify(done.body).slice(0, 120));

const after = (await call('GET', '/pay/employees', null, A)).body;
const nadia = after.find(r => r.name === 'Nadia Okonjo');
t('completing it put them on the pay roster', !!nadia);
t('the hire date came off the packet, not a keyboard', nadia?.hire_date === hire, String(nadia?.hire_date));
t('so did the rate', Number(nadia?.pay_rate) === 22.75, String(nadia?.pay_rate));
t('the roster row is LINKED to the account, not a loose name', !!nadia?.user_id && !!nadia?.linked);
t('they are an employee, not a contractor', (nadia?.worker_type || 'employee') === 'employee');

// Idempotence and the no-clobber rule.
await call('PUT', `/pay/employees/${nadia.id}`, { hire_date: '2026-08-25' }, A);
await call('POST', `/onboarding/${created.id}/complete`, { create_account: true }, A);
const again = (await call('GET', '/pay/employees', null, A)).body.filter(r => r.name === 'Nadia Okonjo');
t('completing twice does not create a second roster row', again.length === 1, `rows: ${again.length}`);
t('and a hand-corrected hire date is NOT overwritten by the packet', again[0]?.hire_date === '2026-08-25', String(again[0]?.hire_date));

console.log('\n── the 30/90-day review ──');
const bad = await call('POST', '/pay/assignments', { employee_id: nadia.id, reviewer_id: 'pr-sup', occasion: '30_day' }, A);
t('a 30-day review is accepted for a starter with a hire date', bad.status === 201, JSON.stringify(bad.body).slice(0, 140));
const assigns = (await call('GET', '/pay/assignments?status=open&mine=false', null, A)).body;
const thirty = assigns.find(a => a.occasion === '30_day');
t('it is filed as a 30-day review, not an ordinary one', !!thirty);
t('its due date is worked out from the hire date, not left blank', thirty?.due_date === '2026-09-24', String(thirty?.due_date));

const ninety = await call('POST', '/pay/assignments', { employee_id: nadia.id, reviewer_id: 'pr-sup', occasion: '90_day' }, A);
t('a 90-day review can be open at the same time as the 30-day', ninety.status === 201, JSON.stringify(ninety.body).slice(0, 140));
const dupe = await call('POST', '/pay/assignments', { employee_id: nadia.id, reviewer_id: 'pr-sup', occasion: '30_day' }, A);
t('but a SECOND 30-day for the same reviewer is refused as a duplicate', dupe.status === 409, String(dupe.status));
const override = await call('POST', '/pay/assignments', { employee_id: nadia.id, reviewer_id: 'pr-admin', occasion: '30_day', due_date: '2026-10-15' }, A);
t('an explicit date beats the derived one', override.status === 201
  && (await call('GET', '/pay/assignments?status=open&mine=false', null, A)).body.some(a => a.due_date === '2026-10-15'));

console.log('\n── contractors ──');
const con = await call('POST', '/pay/employees', {
  name: 'Temp Worker One', worker_type: 'contractor', pay_rate: 18, team: 'Warehouse',
  contractor_company: 'Bridge Staffing', ends_on: '2026-12-01',
}, A);
t('a contractor can be added with an agency and an end date', con.status === 201, JSON.stringify(con.body).slice(0, 140));
const roster = (await call('GET', '/pay/employees', null, A)).body;
const temp = roster.find(r => r.name === 'Temp Worker One');
t('they are on the same roster, marked as a contractor', temp?.worker_type === 'contractor');
t('the agency and end date are kept', temp?.contractor_company === 'Bridge Staffing' && temp?.ends_on === '2026-12-01');

const evaluatees = (await call('GET', '/pay/evaluatees', null, A)).body;
t('a contractor is NEVER offered as somebody to evaluate', !evaluatees.some(e => e.name === 'Temp Worker One'));
t('an employee still is', evaluatees.some(e => e.name === 'Nadia Okonjo'));
const actions = (await call('GET', '/pay/actions', null, A)).body;
const items = actions?.items || actions || [];
t('and never appears on the office queue as a review falling due',
  !(Array.isArray(items) ? items : []).some(i => i.employee_name === 'Temp Worker One'));

const badType = await call('PUT', `/pay/employees/${temp.id}`, { worker_type: 'freelancer' }, A);
t('an unknown worker type is refused in words', badType.status === 400, String(badType.status));

// Ending an assignment: deactivate, and the pay history survives.
const rated = await call('POST', `/pay/employees/${temp.id}/rate`, { new_rate: 19, effective_at: '2026-10-01' }, A);
t('a contractor rate change files a history row like anyone else', rated.status === 200, JSON.stringify(rated.body).slice(0, 120));
await call('PUT', `/pay/employees/${temp.id}`, { active: 0 }, A);
const ended = (await call('GET', `/pay/employees/${temp.id}`, null, A)).body;
t('taking them off the list keeps the row and its rate history',
  ended?.active === 0 && (ended?.history || []).length >= 1, `history: ${(ended?.history || []).length}`);
const del = await call('DELETE', `/pay/employees/${temp.id}`, null, A);
t('and deleting outright is refused once they have been paid', del.status >= 400, String(del.status));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
