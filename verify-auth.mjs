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

// ── Setup: give Alba a password of her own ─────────────────────────────────
let d = await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Alba Reyes' }) }));
const albaId = d.user_id;
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: albaId, password: 'AlbaSecret2026' }) });
d = await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Marco Diaz' }) }));
const marcoId = d.user_id;
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: marcoId, password: 'MarcoSecret2026' }) });

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
  const a = db.prepare("SELECT actor, actor_id FROM audit_log WHERE entity_type='qms_record' ORDER BY timestamp DESC LIMIT 1").get();
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
check('AC-14', 'An account created but never signed into can be claimed by anyone who learns its id',
  'Should be refused without proof of identity',
  `HTTP ${r.status} — ${r.ok ? 'a session was issued to an unauthenticated caller' : (await J(r))?.error}`,
  !r.ok);

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
