// D-374: signing off a receiving inspection and approving a disposal are
// signatures (21 CFR 111.140(b)(2): quality control's review, approval or
// rejection is documented with the date and the signature of the person who
// did it). Before this neither asked for anything but a session.
//
// What this proves, for both acts and for taking each back:
//   - a session with no password is refused (403 signature_required) and nothing is written;
//   - a wrong password is refused and audited as signature_failed;
//   - the right password signs, and the signature carries its meaning in words
//     and a fingerprint of what was signed;
//   - a changed item after approval reads "changed since signed";
//   - a token is refused (403) whatever its account may do;
//   - a bot ACCOUNT signing in with its password is refused too;
//   - the record interface, which has no password to ask, cannot sign either.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5239;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('sg-a', 'Gate Admin', 'admin', 'quality', null);
mkUser('sg-w', 'Gate Receiver', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'edit' }));
mkUser('sg-q', 'Gate Quality', 'supervisor', 'qa', JSON.stringify({ disposals: 'edit' }));
mkUser('sg-bot', 'Gate Bot', 'supervisor', 'qa', JSON.stringify({ disposals: 'edit', 'receiving-log': 'edit' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const tok = (await call('POST', '/users/login', { name, password: pw })).body?.token;
  return { ...H, Authorization: `Bearer ${tok}` };
};
const A = await login('sg-a', 'Gate Admin', 'GateAdmin2026!');
const W = await login('sg-w', 'Gate Receiver', 'GateReceiver2026!');
const Q = await login('sg-q', 'Gate Quality', 'GateQuality2026!');
const B = await login('sg-bot', 'Gate Bot', 'GateBot2026!!');
const failures = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE '%signature_failed%' OR details LIKE '%signature_failed%'").get().n;

console.log('── a receiving inspection ──');
let r = await call('POST', '/receiving/checklist', { vendor: 'Gate Vendor' }, W);
const NO = r.body?.inspection_no;
const { allItems } = await import('../server/receiving-checklist.js');
r = await call('POST', '/receiving/checklist', { inspection_no: NO, answers: Object.fromEntries(allItems().map(i => [i.key, 'na'])) }, W);
t('a checklist is started and every line answered', !!NO && r.status === 200, `${r.status}`);
const reviewed = () => db.prepare('SELECT reviewed_by, reviewed_at, review_meaning, review_hash FROM receiving_checklists WHERE inspection_no = ?').get(NO);

r = await call('POST', `/receiving/checklist/${NO}/review`, {}, W);
t('no password: refused with signature_required', r.status === 403 && r.body?.signature_required === true, `${r.status} ${JSON.stringify(r.body)}`);
t('…and nothing is written', reviewed().reviewed_at === null);
const f0 = failures();
r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'not-it' }, W);
t('a wrong password is refused', r.status === 403 && r.body?.signature_required === true && reviewed().reviewed_at === null);
t('…and audited as signature_failed', failures() > f0);

mkUser('sg-tok', 'Gate Token', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'edit', disposals: 'edit' }));
const tok = (await call('POST', '/api-tokens', { user_id: 'sg-tok', label: 'sign-gates test', scopes: ['read', 'write'] }, A)).body?.plaintext;
const T = { ...H, Authorization: `Bearer ${tok}` };
r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'anything' }, T);
t('a token is refused (403)', !!tok && r.status === 403 && reviewed().reviewed_at === null, `${r.status} ${JSON.stringify(r.body)}`);

// A bot account: it once held a token, now signs in with a password.
await call('POST', '/api-tokens', { user_id: 'sg-bot', label: 'sign-gates bot', scopes: ['read'] }, A);
r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'GateBot2026!!' }, B);
t('a bot account is refused even with its own password', r.status === 403 && r.body?.error === 'bot_account_cannot_approve' && reviewed().reviewed_at === null, `${r.status} ${JSON.stringify(r.body)}`);

{
  const { recordType } = await import('../server/record-interface.js');
  const { getDb } = await import('../server/db.js');
  const id = db.prepare('SELECT id FROM receiving_checklists WHERE inspection_no = ?').get(NO).id;
  // This process has not run the controlled sync, so it reads the code's form,
  // which can be a revision ahead of the one the server serves. Answer every
  // line of both, so the only thing left to refuse the act is the password.
  const ans = JSON.parse(db.prepare('SELECT answers FROM receiving_checklists WHERE id = ?').get(id).answers || '{}');
  const answersBefore = JSON.stringify(ans);
  for (const i of allItems()) ans[i.key] ??= 'na';
  db.prepare('UPDATE receiving_checklists SET answers = ? WHERE id = ?').run(JSON.stringify(ans), id);
  const out = recordType('receiving').sign(getDb(), { id: 'sg-w', name: 'Gate Receiver', role: 'operator', department: 'warehouse' }, id, {});
  t('the record interface cannot sign it: there is no password to ask', out.status === 403 && reviewed().reviewed_at === null, JSON.stringify(out));
  db.prepare('UPDATE receiving_checklists SET answers = ? WHERE id = ?').run(answersBefore, id);
}

r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'GateReceiver2026!' }, W);
const rv = reviewed();
t('the right password signs it off', r.status === 200 && rv.reviewed_by === 'Gate Receiver' && !!rv.reviewed_at, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…with its meaning in words', rv.review_meaning === 'Reviewed the receiving inspection and signed it off', rv.review_meaning);
t('…and a fingerprint', /^[0-9a-f]{64}$/.test(rv.review_hash || ''));
t('…which reads intact', r.body?.review_signature === 'signed', r.body?.review_signature);
const audit = db.prepare("SELECT details FROM audit_log WHERE action LIKE '%receiving_checklist_reviewed%' ORDER BY rowid DESC LIMIT 1").get();
t('…and the audit says the password was checked, never what it was', /signature_verified/.test(audit?.details || '') && !/GateReceiver2026/.test(JSON.stringify(db.prepare('SELECT details FROM audit_log').all())));

r = await call('DELETE', `/receiving/checklist/${NO}/review`, {}, W);
t('revoking without the password is refused', r.status === 403 && r.body?.signature_required === true && !!reviewed().reviewed_at);
r = await call('DELETE', `/receiving/checklist/${NO}/review`, { signature_password: 'GateReceiver2026!' }, T);
t('revoking with a token is refused', r.status === 403 && !!reviewed().reviewed_at);
r = await call('DELETE', `/receiving/checklist/${NO}/review`, { signature_password: 'GateReceiver2026!' }, W);
t('the signer revokes with the password; meaning and fingerprint go with it', r.status === 200 && reviewed().reviewed_at === null && reviewed().review_hash === null);

console.log('\n── a disposal ──');
r = await call('POST', '/disposals', { disposal_date: '2026-11-20', reason: 'Expired', witness: 'Wes',
  items: [{ item_name: 'Gate Whey', item_number: 'RM-G-1', lot_number: 'G-LOT-1', quantity: '25 kg' }] }, Q);
const D = r.body?.id;
t('a disposal is filed', r.status === 201 && !!D, `${r.status}`);
const approvals = () => JSON.parse(db.prepare('SELECT approvals FROM disposals WHERE id = ?').get(D).approvals || '{}');

r = await call('POST', `/disposals/${D}/approve`, { role: 'quality_control' }, Q);
t('no password: refused with signature_required', r.status === 403 && r.body?.signature_required === true && !approvals().quality_control, `${r.status} ${JSON.stringify(r.body)}`);
r = await call('POST', `/disposals/${D}/approve`, { role: 'quality_control', signature_password: 'nope' }, Q);
t('a wrong password is refused', r.status === 403 && !approvals().quality_control);
r = await call('POST', `/disposals/${D}/approve`, { role: 'ops_manager', signature_password: 'anything' }, T);
t('a token is refused (403)', r.status === 403 && !approvals().ops_manager, `${r.status}`);
r = await call('POST', `/disposals/${D}/approve`, { role: 'quality_control', signature_password: 'GateBot2026!!' }, B);
t('a bot account is refused even with its own password', r.status === 403 && r.body?.error === 'bot_account_cannot_approve' && !approvals().quality_control, `${r.status} ${JSON.stringify(r.body)}`);
{
  const { recordType } = await import('../server/record-interface.js');
  const { getDb } = await import('../server/db.js');
  const out = recordType('disposal').sign(getDb(), { id: 'sg-q', name: 'Gate Quality', role: 'supervisor', department: 'qa' }, D, { role: 'quality_control' });
  t('the record interface cannot approve it', out.status === 403 && !approvals().quality_control, JSON.stringify(out));
}
r = await call('POST', `/disposals/${D}/approve`, { role: 'quality_control', signature_password: 'GateQuality2026!' }, Q);
const sig = approvals().quality_control;
t('the right password approves', r.status === 200 && sig?.name === 'Gate Quality', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
t('…with its meaning in words and a fingerprint', sig?.meaning === 'Approved the disposal as Quality Control' && /^[0-9a-f]{64}$/.test(sig?.hash || '') && sig?.verified_via === 'password', JSON.stringify(sig));
r = await call('GET', `/disposals/${D}`, undefined, Q);
t('…which reads intact', r.body?.approval_state?.quality_control === 'signed', JSON.stringify(r.body?.approval_state));
r = await call('POST', `/disposals/${D}/approve`, { role: 'quality_control', signature_password: 'GateQuality2026!' }, Q);
t('an approval is not overwritten by a second one', r.status === 409 && approvals().quality_control.signed_at === sig.signed_at);
db.prepare("UPDATE disposal_items SET quantity = '250 kg' WHERE disposal_id = ?").run(D);
r = await call('GET', `/disposals/${D}`, undefined, Q);
t('an item changed after approval reads "changed"', r.body?.approval_state?.quality_control === 'changed', JSON.stringify(r.body?.approval_state));
r = await call('DELETE', `/disposals/${D}/approve/quality_control`, {}, Q);
t('revoking without the password is refused', r.status === 403 && r.body?.signature_required === true && !!approvals().quality_control);
r = await call('DELETE', `/disposals/${D}/approve/quality_control`, { signature_password: 'x' }, T);
t('revoking with a token is refused', r.status === 403 && !!approvals().quality_control);
r = await call('DELETE', `/disposals/${D}/approve/quality_control`, { signature_password: 'GateQuality2026!' }, Q);
t('the signer revokes with the password', r.status === 200 && !approvals().quality_control);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
