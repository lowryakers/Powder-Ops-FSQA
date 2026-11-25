// D-401: a bot closes a DEACTIVATED person's open training cards as N/A.
//
// Lowry, 25 Nov: "This doesn't need to be a human, right? This is data clean up."
// On 25 Nov at 2:40 PM the Quality bot was refused on 17 such cards with
// not_open_to_tokens. What this proves (live server, fresh database):
//   a. token + Training Edit, no grant: a missed training card for an inactive user goes
//      N/A, completion fields empty; its audit row carries via_token, previous and new
//      status, reason and assignee; an api_token_call row is there too;
//   b. the same on an ACTIVE person's card: 403 "Bots may mark N/A only for deactivated users.";
//      and on a card that is not training: 403;
//   c. no reason: 400;
//   d. the token still cannot complete a training card, and cannot DELETE a work order;
//   e. Training set to View: 403 missing_grant, naming training-na and Training Edit;
//   f. the training-na grant alone (Training View) opens it.
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5258;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma, active = 1) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, active, ma, `SC-${id}`);
const setAccess = (id, ma) => db.prepare('UPDATE users SET module_access = ? WHERE id = ?').run(JSON.stringify(ma), id);
mkUser('tn-a', 'Training Admin', 'admin', 'admin', null);
mkUser('tn-bot', '*Quality Bot', 'operator', 'quality', JSON.stringify({ training: 'edit' }));
mkUser('tn-gone', 'Brandon Gone', 'operator', 'warehouse', JSON.stringify({ operator: 'view' }), 0);
mkUser('tn-here', 'Hana Here', 'operator', 'warehouse', JSON.stringify({ operator: 'view' }), 1);
db.prepare("INSERT OR REPLACE INTO training_courses (id, code, title) VALUES ('tn-c1', 'GMP-101', 'GMP Basics')").run();
const card = (id, who, whoName, opts = {}) => db.prepare(`INSERT OR REPLACE INTO work_orders (id, title, priority, due_date, status, task_group, assigned_to, assigned_to_id, training_course_id)
  VALUES (?, ?, 'normal', date('now','-10 day'), ?, 'warehouse', ?, ?, ?)`).run(id, opts.title || 'Training: GMP Basics', opts.status || 'missed', whoName, who, opts.course === undefined ? 'tn-c1' : opts.course);
card('tn-w1', 'tn-gone', 'Brandon Gone');
card('tn-w2', 'tn-gone', 'Brandon Gone');
card('tn-w3', 'tn-here', 'Hana Here');
card('tn-w4', 'tn-gone', 'Brandon Gone', { title: 'Daily PM — Mixer', course: null });
card('tn-w5', 'tn-gone', 'Brandon Gone');

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
await call('POST', '/users/set-password', { user_id: 'tn-a', password: 'TrainAdmin2026!', setup_code: 'SC-tn-a' });
const A = { ...H, Authorization: `Bearer ${(await call('POST', '/users/login', { name: 'Training Admin', password: 'TrainAdmin2026!' })).body?.token}` };
const mint = async (grants) => {
  const m = await call('POST', '/api-tokens', { user_id: 'tn-bot', label: `fixture training ${grants.join(',') || 'none'}`, scopes: ['read', 'write'] }, A);
  if (grants.length) await call('POST', `/api-tokens/${m.body?.token?.id}/grants`, { grants }, A);
  return { ...H, Authorization: `Bearer ${m.body?.plaintext}` };
};
const B = await mint([]);
const REASON = 'Account deactivated / employment ended. This is not a completion.';
const na = (id, body, h = B) => call('POST', `/pm/work-orders/${id}/not-applicable`, body, h);
const row = (id) => db.prepare('SELECT status, completed_at, completed_by, notes FROM work_orders WHERE id = ?').get(id);

console.log('\n── a. a deactivated person\'s training card ──');
let r = await na('tn-w1', { reason: REASON });
const w1 = row('tn-w1');
t('token + Training Edit, no grant: 200, N/A', r.status === 200 && w1.status === 'not_applicable', JSON.stringify(r.body));
t('…completion time and completer stay empty; the reason is on the card', w1.completed_at === null && w1.completed_by === null && w1.notes === REASON);
const audit = db.prepare("SELECT details, previous_state, new_state FROM audit_log WHERE action IN ('not_applicable') AND entity_id = 'tn-w1'").get();
const d = audit ? JSON.parse(audit.details) : {};
t('…audit row: via_token, previous and new status, reason, assignee', !!d.via_token && d.previous_status === 'missed' && d.new_status === 'not_applicable'
  && d.reason === REASON && d.assignee_id === 'tn-gone', audit?.details);
t('…and an api_token_call row for the call', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'api_token_call' AND details LIKE '%/api/pm/work-orders/tn-w1/not-applicable%'").get().n === 1);
t('…a second call is 409 (already closed), nothing rewritten', (await na('tn-w1', { reason: REASON })).status === 409 && row('tn-w1').notes === REASON);

console.log('\n── b. not for an active person, not for other cards ──');
r = await na('tn-w3', { reason: REASON });
t("an active person's card: 403 with the clear reason", r.status === 403 && r.body?.reason === 'Bots may mark N/A only for deactivated users.' && row('tn-w3').status === 'missed', JSON.stringify(r.body));
r = await na('tn-w4', { reason: REASON });
t('a card that is not training: 403, untouched', r.status === 403 && row('tn-w4').status === 'missed', JSON.stringify(r.body));

console.log('\n── c. a reason is required ──');
r = await na('tn-w2', {});
t('no reason: 400, untouched', r.status === 400 && row('tn-w2').status === 'missed', JSON.stringify(r.body));

console.log('\n── d. never a completion, never a delete ──');
r = await call('POST', '/pm/work-orders/tn-w2/complete-and-recur', { notes: 'done' }, B);
t('completing a training card: 403', r.status === 403 && row('tn-w2').status === 'missed', `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', '/pm/work-orders/tn-w2/training-test', { answers: [] }, B);
t('recording its test: 403', r.status === 403, `${r.status}`);
r = await call('DELETE', '/pm/work-orders/tn-w2', undefined, B);
t('DELETE a work order: 403, still there', r.status === 403 && !!row('tn-w2'), `${r.status}`);

console.log('\n── e. Training set to View ──');
setAccess('tn-bot', { training: 'view' });
r = await na('tn-w2', { reason: REASON });
t('403 missing_grant (never not_open_to_tokens)', r.status === 403 && r.body?.category === 'missing_grant', JSON.stringify(r.body));
t('…naming the training-na grant and Training Edit', /training-na/.test(r.body?.reason || '') && /Edit on Training/.test(r.body?.reason || ''));

console.log('\n── f. the grant alone ──');
const G = await mint(['training-na']);
r = await na('tn-w2', { reason: REASON }, G);
t('the training-na grant with Training View: 200, N/A', r.status === 200 && row('tn-w2').status === 'not_applicable', JSON.stringify(r.body));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
