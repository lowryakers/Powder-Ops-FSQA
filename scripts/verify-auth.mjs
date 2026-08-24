// Authentication verification — executed, not asserted.
// Every line of the record this produces is a measured result.
const B = process.env.BASE || 'http://localhost:4830/api';
const DB = process.env.DBPATH;
const results = [];
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });

function check(id, title, expected, actual, ok) {
  results.push({ id, title, expected, actual, verdict: ok ? 'PASS' : 'FAIL' });
}

// ── Setup: two ordinary staff accounts, each with a password of their own ──
// Fixture accounts, created here rather than borrowed from the roster, so the
// protocol runs the same way on any copy of the database and never sets a
// password on somebody real. The setup codes are written straight in because
// that is what an admin does from Settings; issuing them is not under test.
{
  const { default: Database } = await import('better-sqlite3');
  const { v4: uuid4 } = await import('uuid');
  const db = new Database(DB);
  db.prepare("DELETE FROM users WHERE name IN ('Alba Reyes','Marco Diaz','Nina Fresh')").run();
  const ins = db.prepare(`INSERT INTO users (id, name, username, role, department, is_active,
      setup_code, setup_code_expires_at)
    VALUES (?, ?, ?, ?, ?, 1, 'SEED-CODE', datetime('now','+7 day'))`);
  ins.run(uuid4(), 'Alba Reyes', 'Alba Reyes', 'operator', 'qa');
  ins.run(uuid4(), 'Marco Diaz', 'Marco Diaz', 'operator', 'warehouse');
  db.close();
}
let d = await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes' }) }));
const albaId = d.user_id;
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: albaId, password: 'AlbaSecret2026', setup_code: 'SEED-CODE' }) });
d = await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Marco Diaz' }) }));
const marcoId = d.user_id;
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: marcoId, password: 'MarcoSecret2026', setup_code: 'SEED-CODE' }) });

// ── AC-01 correct credentials are accepted ─────────────────────────────────
let r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes', password: 'AlbaSecret2026' }) });
let s = await J(r);
check('AC-01', 'A user signing in with their own password is admitted',
  'HTTP 200 and a session issued for that user',
  `HTTP ${r.status}; session user = ${s?.user?.name}`,
  r.ok && s?.user?.name === 'Alba Reyes' && !!s?.token);
const albaTok = s.token;

// ── AC-02 another person's password does not work ──────────────────────────
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes', password: 'MarcoSecret2026' }) });
check('AC-02', "Marco's password does not sign anyone in as Alba",
  'HTTP 401, no session', `HTTP ${r.status}; ${(await J(r))?.error}`, r.status === 401);

// ── AC-03 a guessed password does not work ─────────────────────────────────
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes', password: 'password123' }) });
check('AC-03', 'A guessed password is refused',
  'HTTP 401, no session', `HTTP ${r.status}`, r.status === 401);

// ── AC-04 a name alone is not enough ───────────────────────────────────────
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes' }) });
s = await J(r);
check('AC-04', 'Knowing a colleague’s name is not enough to sign in as them',
  'Refused, and NOT offered a password-setup route for an account that already has one',
  `HTTP ${r.status}; needs_password_setup = ${!!s?.needs_password_setup}; token issued = ${!!s?.token}`,
  !s?.token && !s?.needs_password_setup);

// ── AC-05 an unknown name is refused ───────────────────────────────────────
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Nobody Here', password: 'x' }) });
check('AC-05', 'An account that does not exist cannot be signed into',
  'HTTP 401', `HTTP ${r.status}`, r.status === 401);

// ── AC-06 repeated guessing locks the account ──────────────────────────────
let lockedAt = null;
for (let i = 1; i <= 6; i++) {
  r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Marco Diaz', password: `guess${i}` }) });
  if (r.status === 429) { lockedAt = i; break; }
}
check('AC-06', 'Repeated wrong passwords lock the account against further attempts',
  'Locked out after a small number of attempts (HTTP 429)',
  lockedAt ? `Locked on attempt ${lockedAt} (HTTP 429)` : 'Never locked',
  lockedAt !== null && lockedAt <= 6);

// ── AC-07 the lockout is not bypassed by the correct password ──────────────
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Marco Diaz', password: 'MarcoSecret2026' }) });
check('AC-07', 'A locked account stays locked even for the right password',
  'HTTP 429 while the lockout is in force', `HTTP ${r.status}`, r.status === 429);

// ── AC-08 passwords are not stored in readable form ────────────────────────
let stored = null, plaintextFound = null;
if (DB) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const row = db.prepare('SELECT password_hash, pin FROM users WHERE id = ?').get(albaId);
  stored = row.password_hash;
  plaintextFound = db.prepare("SELECT COUNT(*) c FROM users WHERE password_hash LIKE '%AlbaSecret2026%' OR COALESCE(pin,'') LIKE '%AlbaSecret2026%'").get().c;
  db.close();
}
check('AC-08', 'The password is stored only as a salted hash, never readable',
  'No plaintext anywhere in the users table; stored value is salt:hash',
  `plaintext matches in DB = ${plaintextFound}; stored form = ${String(stored).slice(0, 24)}… (${String(stored).split(':').length} parts, ${String(stored).length} chars)`,
  plaintextFound === 0 && String(stored).includes(':') && !String(stored).includes('AlbaSecret'));

// ── AC-09 every protected read needs a valid session ───────────────────────
r = await req('/users/me');
const noTok = r.status;
r = await req('/users/me', { headers: { Authorization: 'Bearer not-a-real-token' } });
const badTok = r.status;
check('AC-09', 'Plant data cannot be read without a valid session token',
  'HTTP 401 with no token and with a forged token',
  `no token → HTTP ${noTok}; forged token → HTTP ${badTok}`,
  noTok === 401 && badTok === 401);

// ── AC-10 a session identifies exactly one person ──────────────────────────
r = await req('/users/me', { headers: { Authorization: 'Bearer ' + albaTok } });
s = await J(r);
check('AC-10', "A session resolves to the person who signed in, and cannot be pointed at another",
  'The session returns Alba, regardless of what the caller claims',
  `/users/me returned ${s?.name} (${s?.role})`,
  s?.name === 'Alba Reyes');

// ── AC-11 work is attributed to the signed-in person, not a claimed name ───
r = await req('/qms/deviation', {
  method: 'POST', headers: { Authorization: 'Bearer ' + albaTok },
  body: JSON.stringify({ record_date: '2026-08-24', description: 'Auth verification test record', created_by: 'Marco Diaz' }),
});
const rec = await J(r);
let attributed = null;
if (DB && r.ok) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const a = db.prepare("SELECT actor, actor_id FROM audit_log WHERE entity_type='deviation' ORDER BY timestamp DESC LIMIT 1").get();
  attributed = a; db.close();
}
check('AC-11', 'A record is attributed to the signed-in user even if the request claims someone else',
  "Audit trail names Alba, not the 'Marco Diaz' sent in the body",
  r.ok ? `audit actor = ${attributed?.actor}; actor_id = ${attributed?.actor_id === albaId ? "Alba's id" : attributed?.actor_id}`
       : `record create returned HTTP ${r.status}`,
  r.ok && attributed?.actor === 'Alba Reyes' && attributed?.actor_id === albaId);

// ── AC-12 changing a password requires the current one ─────────────────────
r = await req('/users/me/password', {
  method: 'POST', headers: { Authorization: 'Bearer ' + albaTok },
  body: JSON.stringify({ current_password: 'wrong-one', new_password: 'BrandNewPass99' }),
});
check('AC-12', 'A password cannot be changed without proving the current one',
  'HTTP 401', `HTTP ${r.status}`, r.status === 401);

// ── AC-13 a signed-in user cannot set a password for another account ───────
r = await req('/users/set-password', {
  method: 'POST', headers: { Authorization: 'Bearer ' + albaTok },
  body: JSON.stringify({ user_id: marcoId, password: 'AlbaTakesOver1' }),
});
check('AC-13', "One user cannot claim a colleague's account that already has a password",
  'Refused', `HTTP ${r.status}; ${(await J(r))?.error || ''}`, r.status >= 400);

// ── AC-14 an account with NO password yet ──────────────────────────────────
// The first-sign-in path. This is the one worth testing hardest.
const { default: DB2 } = await import('better-sqlite3');
const dbw = new DB2(DB);
const { v4: uuid } = await import('uuid');
const freshId = uuid();
dbw.prepare("INSERT INTO users (id,name,username,role,department,is_active) VALUES (?,?,?,'operator','warehouse',1)")
  .run(freshId, 'Nina Fresh', 'Nina Fresh');
dbw.close();
r = await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: freshId, password: 'StrangerSetsIt1' }) });
check('AC-14', 'An account that has never been signed into cannot be claimed without an invitation',
  'Refused — a first password needs a PIN or an admin-issued setup code',
  `HTTP ${r.status} — ${r.ok ? 'A SESSION WAS ISSUED TO AN UNAUTHENTICATED CALLER' : (await J(r))?.error}`,
  !r.ok);

// ── AC-14b the public type-ahead does not hand out account ids ─────────────
r = await req('/users/lookup?q=nina'); const look = await J(r);
check('AC-14b', 'The public login type-ahead does not expose account identifiers',
  'Names only, no id',
  look?.length ? `fields returned: ${Object.keys(look[0]).join(', ')}` : 'no match returned',
  Array.isArray(look) && look.length > 0 && !('id' in look[0]));

// ── AC-14c a wrong setup code is refused, the right one works once ─────────
const dbc = new DB2(DB);
const issued = 'TEST-CODE';
dbc.prepare("UPDATE users SET setup_code = ?, setup_code_expires_at = datetime('now','+7 day') WHERE id = ?").run(issued, freshId);
dbc.close();
r = await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: freshId, password: 'StrangerSetsIt1', setup_code: 'WRONG-ONE' }) });
check('AC-14c', 'A guessed setup code is refused',
  'HTTP 401', `HTTP ${r.status}`, r.status === 401);
r = await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: freshId, password: 'NinaOwnPass2026', setup_code: issued }) });
const claimed = await J(r);
check('AC-14d', 'The person the code was issued to can set their own password with it',
  'HTTP 200 and a session for that account', `HTTP ${r.status}; session = ${claimed?.user?.name}`,
  r.ok && claimed?.user?.name === 'Nina Fresh');
r = await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: freshId, password: 'SomeoneElse1', setup_code: issued }) });
const reuse = await J(r);
let codeAfter = null;
{ const dbr = new DB2(DB, { readonly: true });
  codeAfter = dbr.prepare('SELECT setup_code FROM users WHERE id = ?').get(freshId)?.setup_code; dbr.close(); }
check('AC-14e', 'A setup code cannot be used twice',
  'Refused once spent, and the code is cleared from the account',
  `HTTP ${r.status}; ${reuse?.error || ''}; stored code afterwards = ${codeAfter === null ? 'none' : codeAfter}`,
  !r.ok && codeAfter === null);

// ── AC-17 every failed attempt leaves a record ─────────────────────────────
// A control nobody can review after the fact is not a control.
let attempts = null;
{
  const dba = new DB2(DB, { readonly: true });
  attempts = dba.prepare(`SELECT actor, json_extract(details,'$.reason') reason FROM audit_log
      WHERE action = 'login_failed' ORDER BY timestamp DESC LIMIT 40`).all();
  dba.close();
}
const reasons = [...new Set(attempts.map(a => a.reason))];
check('AC-17', 'Every refused sign-in is written to the audit log, named and reasoned',
  'Refusals appear with the name tried and why it failed',
  `${attempts.length} refusal(s) recorded; reasons seen: ${reasons.join(', ')}`,
  attempts.length > 0 && reasons.includes('bad_password') && reasons.includes('unknown_user')
    && reasons.includes('no_setup_code_issued') && reasons.includes('bad_setup_code'));

// ── AC-18 an expired password stops working ────────────────────────────────
// Backdate Nina's password change beyond the 365-day policy and confirm the
// session can do nothing but change it.
const ninaTok = claimed?.token;
{ const dbe = new DB2(DB);
  dbe.prepare("UPDATE users SET password_changed_at = datetime('now','-400 day') WHERE id = ?").run(freshId);
  dbe.close(); }
r = await req('/pm/work-orders', { headers: { Authorization: 'Bearer ' + ninaTok } });
const blocked = r.status; const blockedBody = await J(r);
r = await req('/users/me', { headers: { Authorization: 'Bearer ' + ninaTok } });
check('AC-18', 'A password past its one-year life stops working until it is changed',
  'Plant data refused with password_expired; only the change-password path stays open',
  `plant data → HTTP ${blocked} (password_expired = ${!!blockedBody?.password_expired}); own account → HTTP ${r.status}`,
  blocked === 403 && blockedBody?.password_expired === true && r.ok);

// ── AC-15 a deactivated account cannot sign in ─────────────────────────────
const dbw2 = new DB2(DB);
dbw2.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(albaId);
dbw2.close();
r = await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes', password: 'AlbaSecret2026' }) });
check('AC-15', 'A deactivated account cannot sign in',
  'HTTP 401', `HTTP ${r.status}`, r.status === 401);

// ── AC-16 an existing session dies with the account ────────────────────────
r = await req('/users/me', { headers: { Authorization: 'Bearer ' + albaTok } });
check('AC-16', "Deactivating an account ends the sessions it already had",
  'HTTP 401 on a token issued before deactivation',
  `HTTP ${r.status}`, r.status === 401);

console.log(JSON.stringify(results, null, 1));
const failed = results.filter(x => x.verdict === 'FAIL');
console.error(`\n${results.length - failed.length} PASS / ${failed.length} FAIL`);
for (const f of failed) console.error(`  FAIL ${f.id} ${f.title}\n        actual: ${f.actual}`);
