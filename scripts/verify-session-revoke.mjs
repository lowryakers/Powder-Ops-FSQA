// A revocation has to reach the sessions the account already holds.
//
// Found by a sweep, not a report: the auth middleware refuses a deactivated
// account on the next request, which hid that nothing DELETED the rows — so
// reactivating brought every old phone back — and that a revoked auditor pass
// changed nothing for the visitor already signed in. Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4989; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
for (const [id, name, role, dept, code] of [
  ['sr-admin', 'Session Admin', 'admin', 'office', 'SC-SA'],
  ['sr-op', 'Session Operator', 'operator', 'warehouse', 'SC-SO'],
]) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, JSON.stringify({ sanitation: 'view' }));
}
const call = async (method, p, body, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id, code, pw) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await call('POST', '/users/login', { name, password: pw })).body?.token;
};
const alive = async (tok) => (await call('GET', '/users/me', null, tok)).status === 200;
const sessionsOf = (id) => db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(id).c;

const admin = await signIn('Session Admin', 'sr-admin', 'SC-SA', 'Admin2026!');
t('admin signed in', !!admin);

// 1. Self-service password change signs out every OTHER device, keeps this one.
const a2 = (await call('POST', '/users/login', { name: 'Session Admin', password: 'Admin2026!' })).body?.token;
t('a second admin session exists', await alive(a2));
let r = await call('POST', '/users/me/password', { current_password: 'Admin2026!', new_password: 'Admin2026!!' }, admin);
// set-password issues a session of its own, so "other" is every session but this one.
t('password changed from the first session', r.status === 200 && r.body.other_sessions_signed_out >= 1 && sessionsOf('sr-admin') === 1, JSON.stringify(r.body));
t('the session that changed it still works', await alive(admin));
t('the other session is signed out', !(await alive(a2)));

// 2. Deactivating in Settings deletes the rows and the devices; reactivation revives nothing.
const op = await signIn('Session Operator', 'sr-op', 'SC-SO', 'Oper2026!');
t('operator signed in', await alive(op));
db.prepare("INSERT INTO chat_push_subscriptions (id,user_id,endpoint,p256dh,auth) VALUES ('sub1','sr-op','https://push.example/sr-op','k','a')").run();
r = await call('PUT', '/users/sr-op', { is_active: false }, admin);
t('deactivated', r.status === 200, JSON.stringify(r.body).slice(0, 120));
t('the operator token is refused', !(await alive(op)));
t('no session rows are left behind', sessionsOf('sr-op') === 0);
t('the push subscription went with the account', db.prepare("SELECT COUNT(*) c FROM chat_push_subscriptions WHERE user_id='sr-op'").get().c === 0);
r = await call('PUT', '/users/sr-op', { is_active: true }, admin);
t('reactivated', r.status === 200);
t('reactivation does NOT revive the old token', !(await alive(op)));
const audit = db.prepare("SELECT details FROM audit_log WHERE entity_id='sr-op' AND action='permission_change' ORDER BY rowid DESC LIMIT 2").all().map(x => x.details).join(' ');
t('the deactivation audit says how many sessions were cut', /sessions_revoked/.test(audit));

// 3. Auditor pass: the session is capped at the pass, and revoke cuts it.
r = await call('POST', '/auditor-passes', { visitor_name: 'Sweep Auditor', days: 1 }, admin);
t('a one-day pass is issued', r.status === 201 && !!r.body.token, JSON.stringify(r.body).slice(0, 120));
const passId = r.body?.id, passExp = r.body?.expires_at;
r = await call('POST', '/auditor-pass/redeem', { token: r.body.token });
t('the pass redeems into a session', r.status === 200 && !!r.body.token);
const audTok = r.body?.token;
const sess = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(audTok);
t('the session expires no later than the pass (was: 30 days off a 1-day pass)', !!sess && sess.expires_at <= passExp, `${sess?.expires_at} vs ${passExp}`);
t('the auditor can read', await alive(audTok));
r = await call('DELETE', `/auditor-passes/${passId}`, null, admin);
t('revoke reports the session it cut', r.status === 200 && r.body.sessions_signed_out === 1, JSON.stringify(r.body));
t('the redeemed session is dead the moment the pass is revoked', !(await alive(audTok)));

// 4. A pass that reactivates a deactivated auditor account starts clean.
const audUser = db.prepare("SELECT id FROM users WHERE role='auditor' AND name='Sweep Auditor'").get();
db.prepare("INSERT INTO sessions (id,user_id,token,expires_at) VALUES ('stale','"+audUser.id+"','stale-token',datetime('now','+20 day'))").run();
db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(audUser.id);
r = await call('POST', '/auditor-passes', { visitor_name: 'Sweep Auditor', days: 2 }, admin);
t('a second pass reactivates the account', r.status === 201);
t('…without reviving a session that survived deactivation', sessionsOf(audUser.id) === 0);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
