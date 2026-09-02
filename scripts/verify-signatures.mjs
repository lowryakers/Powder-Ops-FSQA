// Signature verification on QA approvals — executed against a live server.
// Caller sets PORT + DBPATH. Needs a fresh database (it signs real records).
const PORT = process.env.PORT || 4891;
const B = `http://localhost:${PORT}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const PW = 'SigSecret2026';
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sg-qa','Sig QA','Sig QA','admin','qa',1,'SC-SG', datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Sig QA' });
await post('/users/set-password', { user_id: 'sg-qa', password: PW, setup_code: 'SC-SG' });
token = (await J(await post('/users/login', { name: 'Sig QA', password: PW })))?.token;
t('QA signed in', !!token);

// Records to sign, made through the real endpoints.
const day = new Date().toISOString().slice(0, 10);
const entry = await J(await post('/production/entries', {
  date: day, team: 'Filling', room: '1', product_name: 'Sig Test', mo_number: 'MO-SIG',
  lot_number: 'LOT-SIG', people_count: 1, quantity_completed: 1,
  start_time: '06:00', end_time: '14:00', submitted_by: 'Sig QA',
}));
t('a production entry was filed', !!entry?.id, JSON.stringify(entry).slice(0, 120));
const clean = await J(await post('/sanitation', {
  area: '1', type: 'pre_op', result: 'pass', performed_by: 'Sig QA',
}));
t('a cleaning record was filed', !!clean?.id, JSON.stringify(clean).slice(0, 120));

console.log('\n── the gate refuses a signature with no password ──');
let r = await put(`/production/entries/${entry.id}/qa-signoff`, { qa_signoff_by: 'Sig QA' });
let body = await J(r);
t('production sign-off is refused', r.status === 403, `${r.status}`);
// 403, NOT 401: the client logs out on any 401, so asking this way would sign
// QA out every time they pressed Sign.
t('IT IS 403, NOT 401 — a 401 would log the signer out', r.status !== 401);
t('and it says a signature is needed', body.signature_required === true, JSON.stringify(body));
t('NOTHING WAS SIGNED', !(await J(await req(`/production/entries?date=${day}`)))
  ?.find?.((e) => e.id === entry.id)?.qa_signoff_by);

r = await put(`/sanitation/${clean.id}/verify`, {});
t('sanitation verification is refused', r.status === 403 && (await J(r)).signature_required === true);

console.log('\n── a wrong password is refused, and counted ──');
r = await put(`/production/entries/${entry.id}/qa-signoff`, { qa_signoff_by: 'Sig QA', signature_password: 'not-it' });
body = await J(r);
t('a wrong password is refused', r.status === 403, `${r.status}`);
t('it says so plainly', /not correct/i.test(body.error || ''), body.error);
t('and still asks for one, so the prompt reopens', body.signature_required === true);
{
  const db = new Database(process.env.DBPATH);
  const n = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE '%signature_failed%'").get().c;
  db.close();
  t('the failed attempt is audited', n >= 1, `${n}`);
}

console.log('\n── the right password signs it ──');
r = await put(`/production/entries/${entry.id}/qa-signoff`, { qa_signoff_by: 'Sig QA', signature_password: PW });
t('the sign-off goes through', r.status === 200, `${r.status}`);
{
  const db = new Database(process.env.DBPATH);
  const e = db.prepare('SELECT qa_signoff_by, qa_signoff_at FROM production_entries WHERE id = ?').get(entry.id);
  t('the record carries the signature', e.qa_signoff_by === 'Sig QA' && !!e.qa_signoff_at, JSON.stringify(e));
  // signOffProductionEntry writes its own audit entry in the same second, so
  // "the newest one" is ambiguous — ask whether ANY entry for this record says
  // the signature was verified, which is the actual claim.
  const a = db.prepare(`SELECT COUNT(*) c FROM audit_log
    WHERE entity_id = ? AND details LIKE '%signature_verified%'`).get(entry.id);
  t('an audit entry records that the signature was verified', a.c >= 1, JSON.stringify(a));
  // The one thing that must never be written down.
  const leaked = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE details LIKE ?").get(`%${PW}%`).c;
  t('THE PASSWORD IS NEVER WRITTEN TO THE AUDIT LOG', leaked === 0, `${leaked}`);
  db.close();
}

r = await put(`/sanitation/${clean.id}/verify`, { signature_password: PW });
t('sanitation verification goes through', r.status === 200, `${r.status}`);

console.log('\n── the QA Review batch is ONE act ──');
// Two more records to sign together.
const more = [];
for (let i = 0; i < 2; i++) {
  const c = await J(await post('/sanitation', { area: `${i + 2}`, type: 'pre_op', result: 'pass', performed_by: 'Sig QA' }));
  more.push(c.id);
}
r = await post('/qa-review/sign', { source: 'sanitation', ids: more });
t('the batch is refused without a password', r.status === 403, `${r.status}`);
{
  const db = new Database(process.env.DBPATH);
  const signed = db.prepare(`SELECT COUNT(*) c FROM sanitation_records WHERE id IN (${more.map(() => '?').join(',')}) AND verified_by IS NOT NULL`).all(...more);
  t('AND NOTHING IN IT WAS SIGNED — the check runs before the loop', signed[0].c === 0, JSON.stringify(signed));
  db.close();
}
const out = await J(await post('/qa-review/sign', { source: 'sanitation', ids: more, signature_password: PW }));
t('ONE password signs the whole batch', (out?.signed || []).length === 2, JSON.stringify(out).slice(0, 160));
{
  const db = new Database(process.env.DBPATH);
  const a = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'qa_review_batch' ORDER BY timestamp DESC LIMIT 1").get();
  t('the batch act is audited as verified', /signature_verified/.test(a?.details || ''), a?.details);
  t('and records how many it covered', /"signed":2/.test(a?.details || ''), a?.details);
  db.close();
}

console.log('\n── the limiter ──');
const c2 = await J(await post('/sanitation', { area: '9', type: 'pre_op', result: 'pass', performed_by: 'Sig QA' }));
let last = null;
for (let i = 0; i < 6; i++) {
  // eslint-disable-next-line no-await-in-loop
  last = await put(`/sanitation/${c2.id}/verify`, { signature_password: `wrong-${i}` });
}
t('repeated wrong passwords are eventually refused outright', last.status === 429 || /too many/i.test((await J(last)).error || ''), `${last.status}`);
// And the correct password is refused too while the limiter holds — otherwise
// the limit is decorative.
r = await put(`/sanitation/${c2.id}/verify`, { signature_password: PW });
t('the limiter holds even for the RIGHT password', r.status === 429, `${r.status}`);
{
  const db = new Database(process.env.DBPATH);
  t('and that record is still unsigned',
    !db.prepare('SELECT verified_by FROM sanitation_records WHERE id = ?').get(c2.id).verified_by);
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
