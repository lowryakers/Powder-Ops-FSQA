// verify:part11 — password signatures, printed and locked; the audit trail locked;
// the shared sign-in report (D-282, D-283; 21 CFR 11.10(e), 11.50, 11.70, 11.100, 11.200).
//
//   1. One way to sign: the drawn "Sign" is gone; approving a document, recording
//      a paper revision and ticking competence each ask for the signer's own
//      password at that moment; a group is one password.
//   2. The signer is always the signed-in person: no typed approver, the
//      competence statement and trainer name the signer, nobody signs their own.
//   3. Each signature stores name, date and time, and meaning; it is fingerprinted
//      to that revision / record and reads "changed" if a signed fact moves; an
//      edit cannot take it off; withdrawing is its own signed act, kept on the record.
//   4. The training record prints the sign-off; the document PDF prints each approval.
//   5. The audit log refuses UPDATE and DELETE at the database.
//   6. The shared sign-in report finds an account open on two devices at once.
//
// Caller sets PORT + DBPATH (verify-all does).
// Control: drop the competence password gate (signCompetenceOr) — a tick saves with no password.
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = Number(process.env.PORT || 5169);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const PW = 'Part11-2026!!';

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  const all = { sops: 'edit', 'work-instructions': 'edit', training: 'edit', operator: 'view' };
  mk('p11-dc', 'Dana Control', 'supervisor', 'document_control', all);
  mk('p11-qa', 'Quinn Quality', 'supervisor', 'qa', all);
  mk('p11-op', 'Otto Floor', 'operator', 'warehouse', { ...all, sops: 'edit' });
  mk('p11-op2', 'Pia Line', 'operator', 'filling', { operator: 'view' });
  db.close();
}
const call = async (m, p, b, tok, ua = 'verify-part11') => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
  return { status: r.status, json, buf };
};
const signIn = async (id, name, ua) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` }, null, ua);
  return (await call('POST', '/users/login', { name, password: PW }, null, ua)).json?.token;
};
const dc = await signIn('p11-dc', 'Dana Control', 'Phone A');
const qa = await signIn('p11-qa', 'Quinn Quality', 'Laptop');
const op = await signIn('p11-op', 'Otto Floor', 'Tablet');
t('three people signed in', !!dc && !!qa && !!op);
const pdfText = (buf) => {
  const dir = mkdtempSync(join(tmpdir(), 'p11-'));
  writeFileSync(join(dir, 'a.pdf'), buf);
  try { return execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), '-']).toString(); } catch { return ''; }
};

console.log('\n── 1–3. a controlled document is approved with a password ──');
let r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 008', title: 'Scale Cleaning', category: 'quality', revision: 'V3', status: 'active', content: 'Wipe the pan.' }, dc);
t('filing a document as approved without a password is refused', r.status === 403 && r.json?.signature_required === true, `${r.status}`);
r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 008', title: 'Scale Cleaning', category: 'quality', revision: 'V3', status: 'active', content: 'Wipe the pan.', approved_by: 'Somebody Else', signature_password: PW }, dc);
t('a typed approver name is refused', r.status === 400 && r.json?.code === 'TYPED_APPROVER', `${r.status}`);
r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 008', title: 'Scale Cleaning', category: 'quality', revision: 'V3', status: 'active', content: 'Wipe the pan.', signature_password: PW }, op);
t('an operator cannot approve a document, even with a password', r.status === 403, `${r.status}`);
r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 008', title: 'Scale Cleaning', category: 'quality', revision: 'V3', status: 'active', content: 'Wipe the pan.', signature_password: PW }, dc);
const doc = r.json;
t('with the password it is approved, and the approver is the person signed in', r.status === 201 && doc?.status === 'active' && doc?.approved_by === 'Dana Control', `${r.status} ${doc?.approved_by}`);
r = await call('GET', `/documents/${doc.id}/revisions`, null, dc);
const v3 = r.json?.revisions?.find(x => x.revision === 'V3');
t('the approval stores name, date and time, and meaning', v3?.approved_by === 'Dana Control' && /T\d\d:\d\d/.test(v3?.approved_at || '') && v3?.approved_meaning === 'Approved');
t('…and is fingerprinted to that revision (intact)', v3?.approval_state === 'signed' && /^[0-9a-f]{64}$/.test(v3?.approved_hash || ''));
r = await call('POST', `/documents/${doc.id}/sign`, { capacity: 'QA' }, qa);
t('the drawn "Sign" is gone', r.status === 404, `${r.status}`);
{ const d = new Database(DBP); d.prepare('UPDATE document_revisions SET description = ? WHERE id = ?').run('Wipe the pan and the base.', v3.id); d.close(); }
r = await call('GET', `/documents/${doc.id}/revisions`, null, dc);
t('text changed under a signature reads "changed since signed"', r.json?.revisions?.find(x => x.id === v3.id)?.approval_state === 'changed');
{ const d = new Database(DBP); d.prepare('UPDATE document_revisions SET description = ? WHERE id = ?').run('Wipe the pan.', v3.id); d.close(); }
r = await call('GET', `/documents/${doc.id}/pdf`, null, dc);
const docPdf = pdfText(r.buf);
t('the document PDF prints the approval: name, meaning, time with the zone', /Dana Control — Approved \(rev V3\)/.test(docPdf) && /20\d\d, \d{1,2}:\d\d [AP]M M[SD]T/.test(docPdf) && /fingerprint matches/.test(docPdf), docPdf.slice(0, 300));

console.log('\n── 1–3. a training sign-off is the trainer\'s password ──');
r = await call('POST', '/training/courses', { code: 'WI008', title: 'Scale Cleaning Training', sop_id: doc.id }, dc);
const course = r.json;
const rec = { employee_name: 'Pia Line', employee_user_id: 'p11-op2', course_id: course.id, status: 'completed', training_date: '2026-10-20', completion_date: '2026-10-20', method: 'verbal', trainer: 'Typed Name', competence_confirmed: true };
r = await call('POST', '/training', rec, qa);
t('ticking competence without a password is refused', r.status === 403 && r.json?.signature_required === true, `${r.status}`);
r = await call('POST', '/training', { ...rec, employee_name: 'Quinn Quality', employee_user_id: 'p11-qa', signature_password: PW }, qa);
t('nobody signs off their own competence', r.status === 400 && r.json?.code === 'SELF_COMPETENCE', `${r.status}`);
r = await call('POST', '/training', { ...rec, signature_password: PW }, qa);
const tr = r.json;
t('with the password it saves, signed by the person signed in (not the typed name)', r.status === 201 && tr?.competence_signed_by === 'Quinn Quality' && tr?.trainer === 'Quinn Quality'
  && /^Quinn Quality: /.test(tr?.competence_statement || ''), JSON.stringify({ s: r.status, by: tr?.competence_signed_by, trainer: tr?.trainer }));
t('…with date and time, meaning and an intact fingerprint', /T\d\d:\d\d/.test(tr?.competence_signed_at || '') && tr?.competence_meaning === 'Trained and competent' && tr?.competence_signature === 'signed');
r = await call('PUT', `/training/${tr.id}`, { ...tr, employee_name: 'Otto Floor', employee_user_id: 'p11-op' }, qa);
t('an edit cannot move a signed fact (the person)', r.status === 409 && r.json?.code === 'COMPETENCE_SIGNED', `${r.status}`);
r = await call('PUT', `/training/${tr.id}`, { competence_confirmed: false }, qa);
t('an edit cannot take the signature off', r.status === 409 && r.json?.code === 'COMPETENCE_SIGNED', `${r.status}`);
r = await call('PUT', `/training/${tr.id}`, { ...tr, notes: 'Done at the line.' }, qa);
t('an edit to an unsigned fact (notes) still saves, and the signature stays intact', r.status === 200 && r.json?.competence_signature === 'signed', `${r.status} ${r.json?.competence_signature}`);
{ const d = new Database(DBP); d.prepare('UPDATE training_records SET completion_date = ? WHERE id = ?').run('2026-10-21', tr.id); d.close(); }
r = await call('GET', `/training/${tr.id}`, null, qa);
t('a signed fact changed outside the app reads "changed since signed"', r.json?.competence_signature === 'changed');
{ const d = new Database(DBP); d.prepare('UPDATE training_records SET completion_date = ? WHERE id = ?').run('2026-10-20', tr.id); d.close(); }
r = await call('GET', `/training/${tr.id}/pdf`, null, qa);
const recPdf = pdfText(r.buf);
t('the training record prints the sign-off: name, meaning, date and time', r.status === 200 && /Quinn Quality — Trained and competent/.test(recPdf) && /M[SD]T/.test(recPdf) && /fingerprint matches/.test(recPdf), recPdf.slice(0, 300));
r = await call('POST', `/training/${tr.id}/competence/withdraw`, { reason: 'wrong person', signature_password: PW }, dc);
t('only the signer or an admin may withdraw it', r.status === 403, `${r.status}`);
r = await call('POST', `/training/${tr.id}/competence/withdraw`, { signature_password: PW }, qa);
t('withdrawing needs a reason', r.status === 400);
r = await call('POST', `/training/${tr.id}/competence/withdraw`, { reason: 'Signed against the wrong course' }, qa);
t('withdrawing needs the password', r.status === 403 && r.json?.signature_required === true);
r = await call('POST', `/training/${tr.id}/competence/withdraw`, { reason: 'Signed against the wrong course', signature_password: PW }, qa);
const w = JSON.parse(r.json?.competence_withdrawn || '{}');
t('withdrawn: the record keeps who signed, when, who withdrew it and why; it is no longer complete', r.status === 200 && w.signed_by === 'Quinn Quality' && w.withdrawn_by === 'Quinn Quality'
  && w.reason === 'Signed against the wrong course' && r.json?.status === 'in_progress', JSON.stringify(r.json).slice(0, 160));

console.log('\n── a group is one password ──');
r = await call('POST', '/training/bulk-complete', { course_id: course.id, training_date: '2026-10-22', method: 'verbal', competence_confirmed: true,
  attendees: [{ employee_user_id: 'p11-op', employee_name: 'Otto Floor' }, { employee_user_id: 'p11-op2', employee_name: 'Pia Line' }] }, qa);
t('a group sign-off without a password is refused', r.status === 403 && r.json?.signature_required === true);
r = await call('POST', '/training/bulk-complete', { course_id: course.id, training_date: '2026-10-22', method: 'verbal', competence_confirmed: true, signature_password: PW,
  attendees: [{ employee_user_id: 'p11-op', employee_name: 'Otto Floor' }, { employee_user_id: 'p11-op2', employee_name: 'Pia Line' }] }, qa);
const recs = q('SELECT * FROM training_records WHERE session_id = ?', r.json?.session_id || '');
t('one password signs everyone in the group, each record fingerprinted on its own', r.status < 300 && recs.length === 2
  && recs.every(x => x.competence_signed_by === 'Quinn Quality' && /^[0-9a-f]{64}$/.test(x.competence_hash || '')) && recs[0].competence_hash !== recs[1].competence_hash, `${r.status} ${recs.length}`);

console.log('\n── 5. the audit log is locked at the database ──');
const n = q('SELECT COUNT(*) c FROM audit_log')[0].c;
const tryWrite = (sql) => { const d = new Database(DBP); try { d.prepare(sql).run(); return 'ran'; } catch (e) { return e.message; } finally { d.close(); } };
t('UPDATE on audit_log is refused by the database', /append-only/.test(tryWrite("UPDATE audit_log SET actor = 'x' WHERE id = (SELECT MAX(id) FROM audit_log)")));
t('DELETE on audit_log is refused by the database', /append-only/.test(tryWrite('DELETE FROM audit_log WHERE id = (SELECT MAX(id) FROM audit_log)')));
t('…and nothing was lost', q('SELECT COUNT(*) c FROM audit_log')[0].c === n);
t('every signature above is in the audit log, verified by password', q("SELECT COUNT(*) c FROM audit_log WHERE details LIKE '%\"signature_verified\":true%'")[0].c >= 4);

console.log('\n── 6. shared sign-ins ──');
await call('POST', '/users/login', { name: 'Otto Floor', password: PW }, null, 'Another Phone');
const admin = await (async () => { const d = new Database(DBP); d.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at) VALUES ('p11-admin','Ada Admin','Ada Admin','admin','admin',1,'SC-p11-admin',datetime('now','+7 day'))`).run(); d.close(); return signIn('p11-admin', 'Ada Admin', 'Desk'); })();
r = await call('GET', '/compliance/shared-accounts', null, admin);
t('the report names the account open on two devices at once', r.status === 200 && r.json?.concurrent?.some(e => e.name === 'Otto Floor' && e.devices.length >= 2), JSON.stringify(r.json?.concurrent).slice(0, 200));
t('…and not the people on one device', !r.json?.concurrent?.some(e => e.name === 'Quinn Quality'));
r = await call('GET', '/compliance/shared-accounts', null, op);
t('it is for admins only', r.status === 403);

console.log('\n── the e-signature policy is a course everyone takes ──');
{
  const c = q("SELECT * FROM training_courses WHERE code = 'ESIG-101'")[0];
  const nq = c ? q('SELECT COUNT(*) n FROM training_questions qq JOIN training_tests tt ON tt.id = qq.test_id WHERE tt.course_id = ? AND tt.is_current = 1', c.id)[0].n : 0;
  t('ESIG-101 exists for everyone, yearly, with a five-question check the app grades', !!c && c.required_departments === '[]' && c.retrain_months === 12 && c.has_test === 1 && nq === 5, JSON.stringify(c || {}).slice(0, 120));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
