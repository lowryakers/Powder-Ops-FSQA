// A QMS approval signature, from the record's own Approve button — executed
// against a live server.
//
// QA Review signed through signQmsApproval behind gateSignature: the password,
// the already-signed refusal, the attestation. The module's own Approve button
// on the identical record wrote the approval inline with none of that, and
// would overwrite an existing signature with a different person's name.
// Every assertion here goes through the real routes.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4909;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
const mk = (tok) => (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
// The module-level control: the first cut of this fix deleted these two exports
// and every syntax check still passed. qa-review.js importing them is what
// would have failed at boot.
{
  const q = await import('../server/api/qms.js');
  t('qms.js still exports signQmsApproval and BULK_APPROVE', typeof q.signQmsApproval === 'function' && !!q.BULK_APPROVE);
}

const db = new Database(process.env.DBPATH);
const mkUser = (id, name, dept) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES (?,?,?,'supervisor',?,1,?,datetime('now','+7 day'))`).run(id, name, name, dept, 'SC-' + id);
mkUser('qa-1', 'Sig QA One', 'qa');
mkUser('qa-2', 'Sig QA Two', 'qa');
db.close();

const login = async (id, name, pw) => {
  const anon = mk(null);
  await anon('/users/login', { method: 'POST', body: JSON.stringify({ name }) });
  await anon('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password: pw, setup_code: 'SC-' + id }) });
  return (await J(await anon('/users/login', { method: 'POST', body: JSON.stringify({ name, password: pw }) })))?.token;
};
const PW1 = 'QaOnePW2026!', PW2 = 'QaTwoPW2026!';
const tok1 = await login('qa-1', 'Sig QA One', PW1);
const tok2 = await login('qa-2', 'Sig QA Two', PW2);
const qa1 = mk(tok1), qa2 = mk(tok2);
t('two QA users signed in', !!tok1 && !!tok2);

console.log('\nThe record\'s own Approve button asks for the password');
const dev = await J(await qa1('/qms/deviation', { method: 'POST', body: JSON.stringify({
  initiator: 'Sig QA One', description: 'signature test', lot: 'L-1' }) }));
t('a deviation is filed', !!dev?.id, JSON.stringify(dev || {}).slice(0, 80));
{
  const r = await qa1(`/qms/deviation/${dev.id}/approve`, { method: 'POST', body: JSON.stringify({ role: 'qa_director' }) });
  const b = await J(r);
  t('NO PASSWORD → 403, never 401 (a 401 would sign QA out)', r.status === 403, `got ${r.status}`);
  t('...and the refusal says signature_required', b?.signature_required === true);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const row = d.prepare('SELECT approvals FROM qms_records WHERE id = ?').get(dev.id); d.close();
  t('nothing was signed', !JSON.parse(row?.approvals || '{}').qa_director);
}
{
  const r = await qa1(`/qms/deviation/${dev.id}/approve`, { method: 'POST', body: JSON.stringify({ role: 'qa_director', signature_password: 'wrong' }) });
  t('a wrong password is refused', r.status === 403, `got ${r.status}`);
}
{
  const r = await qa1(`/qms/deviation/${dev.id}/approve`, { method: 'POST', body: JSON.stringify({ role: 'qa_director', signature_password: PW1 }) });
  const b = await J(r);
  t('the right password signs', r.ok, `got ${r.status}`);
  t('signed by the person who typed it', b?.approvals?.qa_director?.name === 'Sig QA One', JSON.stringify(b?.approvals || {}).slice(0, 100));
  t('with the attestation the queue writes', /certify/i.test(b?.approvals?.qa_director?.attestation || ''));
}

console.log('\nA signed approval cannot be overwritten from this door');
{
  const r = await qa2(`/qms/deviation/${dev.id}/approve`, { method: 'POST', body: JSON.stringify({ role: 'qa_director', signature_password: PW2 }) });
  t('a second signer is refused with 409', r.status === 409, `got ${r.status}`);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const row = d.prepare('SELECT approvals FROM qms_records WHERE id = ?').get(dev.id); d.close();
  t('THE FIRST SIGNATURE STANDS', JSON.parse(row?.approvals || '{}').qa_director?.name === 'Sig QA One');
}

console.log('\nBulk sign-off: one password, checked before anything is signed');
{
  const d = new Database(process.env.DBPATH);
  const ins = d.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, approvals, created_by)
    VALUES (?, 'maintenance_sign_out', ?, date('now'), 'returned', ?, '{}', 'Sig QA One')`);
  ins.run('so-routine', 'SO-R', JSON.stringify({ employee_name: 'A', item_description: 'Wrench', condition_out: 'Good', condition_returned: 'Good', return_reason: 'Returned' }));
  ins.run('so-bad', 'SO-B', JSON.stringify({ employee_name: 'B', item_description: 'Drill', condition_out: 'Good', condition_returned: 'Bad', return_reason: 'Returned' }));
  d.close();
  const r = await qa1('/qms/maintenance_sign_out/bulk-approve', { method: 'POST', body: JSON.stringify({}) });
  t('no password → 403', r.status === 403, `got ${r.status}`);
  const d2 = new Database(process.env.DBPATH, { readonly: true });
  const n = d2.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='maintenance_sign_out' AND json_extract(approvals,'$.quality') IS NOT NULL").get().c; d2.close();
  t('A REFUSED BATCH SIGNED NOTHING', n === 0, `${n} signed`);
  const r2 = await qa1('/qms/maintenance_sign_out/bulk-approve', { method: 'POST', body: JSON.stringify({ signature_password: PW1 }) });
  const b2 = await J(r2);
  t('with the password the batch signs', r2.ok, `got ${r2.status}`);
  t('the routine one is signed, the bad-condition one skipped', b2?.signed === 1 && b2?.skipped === 1, JSON.stringify(b2 || {}));
  const d3 = new Database(process.env.DBPATH, { readonly: true });
  const bad = d3.prepare("SELECT approvals FROM qms_records WHERE id='so-bad'").get(); d3.close();
  t('the bad-condition record is still unsigned', !JSON.parse(bad?.approvals || '{}').quality);
}

console.log('\nThe password never reaches the audit log');
{
  const d = new Database(process.env.DBPATH, { readonly: true });
  const rows = d.prepare("SELECT * FROM audit_log").all(); d.close();
  const hits = rows.filter(r => { const s = JSON.stringify(r); return s.includes(PW1) || s.includes(PW2); }).length;
  t('no audit row contains either password', hits === 0, `${hits} rows`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
