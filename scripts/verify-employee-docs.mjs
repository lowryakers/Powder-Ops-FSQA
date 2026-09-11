// Documents sent to an existing employee to sign, executed against a live
// server on a fresh database, with the S3 stand-in holding the files.
//
// What it proves: the office door is the office door (a warehouse supervisor
// holding the same grant is refused); the employee sees only their own; a
// signature needs the name on the account, the statement, a drawn signature
// AND the password; the signed PDF is the document with the answers locked in
// and a signature page added; a signed document cannot be signed again or
// withdrawn; and the ReadyBot message reaches the person who has to sign.
//
// Caller sets PORT + DBPATH + the R2 stand-in.
const PORT = process.env.PORT || 4993;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const tok = {};
const req = (p, o = {}, who = 'office') => fetch(B + p, { ...o, headers: {
  ...(o.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
  ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const get = (p, who) => req(p, {}, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
const mk = (id, name, role, dept, code, map) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, map);
mk('ed-admin', 'Ed Admin', 'admin', 'office', 'SC-EA', null);
mk('ed-office', 'Ed Office', 'supervisor', 'office', 'SC-EO', '{"onboarding":"edit"}');
mk('ed-wh', 'Ed Warehouse', 'supervisor', 'warehouse', 'SC-EW', '{"onboarding":"edit"}');
mk('ed-emp', 'Ed Operator', 'operator', 'batching', 'SC-EP', '{"production-log":"edit"}');
mk('ed-other', 'Ed Other', 'operator', 'batching', 'SC-EX', '{"production-log":"edit"}');
t('the employee_documents tables exist on a fresh database',
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_documents'").get()
  && !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_document_templates'").get());

const signIn = async (who, id, name, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  tok[who] = (await J(await post('/users/login', { name, password: pw })))?.token;
};
await signIn('admin', 'ed-admin', 'Ed Admin', 'SC-EA', 'EdAdmin2026!');
await signIn('office', 'ed-office', 'Ed Office', 'SC-EO', 'EdOffice2026!');
await signIn('wh', 'ed-wh', 'Ed Warehouse', 'SC-EW', 'EdWare2026!');
await signIn('emp', 'ed-emp', 'Ed Operator', 'SC-EP', 'EdOper2026!');
await signIn('other', 'ed-other', 'Ed Other', 'SC-EX', 'EdOther2026!');
t('everyone signed in', ['admin', 'office', 'wh', 'emp', 'other'].every(k => !!tok[k]));

console.log('\nTwo doors, and they are different people');
{
  const r = await get('/employee-documents', 'office');
  t('the office reads the queue', r.ok, `got ${r.status}`);
  const wh = await get('/employee-documents', 'wh');
  t('A WAREHOUSE SUPERVISOR HOLDING THE SAME GRANT IS REFUSED', wh.status === 403, `got ${wh.status}`);
  const emp = await get('/employee-documents', 'emp');
  t('an operator is refused the office queue', emp.status === 403, `got ${emp.status}`);
  const mine = await get('/employee-documents/mine', 'emp');
  t('but reads their own list with no module grant at all', mine.ok, `got ${mine.status}`);
  const body = await J(mine);
  t('which is empty to begin with', (body?.pending || []).length === 0);
  t('and carries the statement they will sign under', /electronic signature/i.test(body?.attestation || ''));
}

// A small fillable PDF, built with the same library the server reads it with.
const { PDFDocument, StandardFonts, PDFName, PDFString } = await import('pdf-lib');
const makePdf = async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Form W-4 (stand-in) Employee's Withholding Certificate", { x: 40, y: 740, size: 13, font });
  const form = doc.getForm();
  const name = form.createTextField('f1_01'); name.addToPage(page, { x: 40, y: 690, width: 300, height: 20 });
  name.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(a). First name and last name'));
  const ssn = form.createTextField('f1_05'); ssn.addToPage(page, { x: 40, y: 650, width: 200, height: 20 });
  ssn.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(b). Social security number'));
  const status = form.createRadioGroup('c1_1');
  status.addOptionToPage('Single', page, { x: 40, y: 610, width: 14, height: 14 });
  status.addOptionToPage('Head of household', page, { x: 40, y: 590, width: 14, height: 14 });
  status.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(c). Filing status'));
  return Buffer.from(await doc.save());
};
const pdf = await makePdf();
const fd = (parts, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(parts)) f.append(k, v);
  if (file) f.append('file', new Blob([file], { type: 'application/pdf' }), 'w4.pdf');
  return f;
};

console.log('\nA template is kept once and sent again');
let templateId = null;
{
  const bad = await req('/employee-documents/templates', { method: 'POST', body: fd({ title: 'W-4 2026', kind: 'w4' }, pdf) }, 'wh');
  t('the warehouse supervisor cannot add one', bad.status === 403, `got ${bad.status}`);
  const r = await req('/employee-documents/templates', { method: 'POST', body: fd({ title: 'Form W-4 2026', kind: 'w4', instructions: 'Update your withholding for 2026.' }, pdf) }, 'office');
  const body = await J(r);
  templateId = body?.id;
  t('the office adds one', r.ok && !!templateId, JSON.stringify(body || {}).slice(0, 120));
  t('AND THE PDF IS READ: its three fillable boxes are counted', body?.field_count === 3, `got ${body?.field_count}`);
  t('the fields come back labelled from the form itself', /Filing status/.test(JSON.stringify(body?.fields || [])));
  const notPdf = await req('/employee-documents/templates', { method: 'POST', body: (() => { const f = new FormData(); f.append('title', 'x'); f.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt'); return f; })() }, 'office');
  t('a file that is not a PDF is refused in words', notPdf.status === 400 && /PDF/.test((await J(notPdf))?.error || ''), `got ${notPdf.status}`);
}

console.log('\nSending it');
let reqId = null;
{
  const none = await post('/employee-documents/send', { template_id: templateId, user_ids: [] }, 'office');
  t('sending it to nobody is refused', none.status === 400, `got ${none.status}`);
  const r = await post('/employee-documents/send', { template_id: templateId, user_ids: ['ed-emp', 'ed-other'], due_date: '2026-09-30' }, 'office');
  const body = await J(r);
  t('one request per person', r.ok && body?.requests?.length === 2, JSON.stringify(body || {}).slice(0, 140));
  reqId = body?.requests?.find(x => x.user_id === 'ed-emp')?.id;
  t('each carries the title, the sender and the date it is due', body?.requests?.[0]?.title === 'Form W-4 2026' && body?.requests?.[0]?.sent_by === 'Ed Office' && body?.requests?.[0]?.due_date === '2026-09-30');
  t('and both people were told by ReadyBot', body?.told === 2, `told ${body?.told}`);
  const bad = await post('/employee-documents/send', { template_id: templateId, user_ids: ['ed-emp'] }, 'wh');
  t('the warehouse supervisor cannot send one', bad.status === 403, `got ${bad.status}`);
}
{
  const msg = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channel_members cm ON cm.channel_id = m.channel_id
    WHERE cm.user_id = 'ed-emp' ORDER BY m.created_at DESC LIMIT 1`).get();
  t('THE DM NAMES THE DOCUMENT AND WHO SENT IT', /Form W-4 2026/.test(msg?.body || '') && /Ed Office/.test(msg?.body || ''), (msg?.body || '').slice(0, 90));
  t('and links straight to it', new RegExp(`\\?sign=${reqId}`).test(msg?.body || ''));
}

console.log('\nThe employee sees only their own');
{
  const mine = await J(await get('/employee-documents/mine', 'emp'));
  t('it is waiting on their list', mine?.pending?.length === 1 && mine.pending[0].id === reqId);
  const theirs = await get(`/employee-documents/${reqId}`, 'other');
  t("SOMEBODY ELSE'S DOCUMENT IS NOT FOUND, not forbidden", theirs.status === 404, `got ${theirs.status}`);
  const one = await J(await get(`/employee-documents/${reqId}`, 'emp'));
  t('the person it was sent to reads it, with the form\'s own boxes to fill', one?.can_sign === true && (one?.fields || []).length === 3);
  t('and a link to the file itself', !!one?.source_url);
  const office = await J(await get(`/employee-documents/${reqId}`, 'office'));
  t('the office can read it too', !!office && office.can_sign === false);
  const opened = await J(await get('/employee-documents?status=pending', 'office'));
  t('and sees it was opened', !!opened?.requests?.find(r => r.id === reqId)?.opened_at);
}

console.log('\nSigning: every refusal before anything is written');
const SIG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201e2d3aebc0000000049454e44ae426082', 'hex').toString('base64');
const values = { f1_01: 'Ed Operator', f1_05: '123-45-6789', c1_1: 'Head of household' };
{
  const wrongName = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Somebody Else', attest: true, signature_image: SIG, values, signature_password: 'EdOper2026!' }, 'emp');
  t('A SIGNATURE UNDER SOMEBODY ELSE\'S NAME IS REFUSED', wrongName.status === 400 && /name on your account/i.test((await J(wrongName))?.error || ''), `got ${wrongName.status}`);
  const noAttest = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: false, signature_image: SIG, values, signature_password: 'EdOper2026!' }, 'emp');
  t('unticked statement is refused', noAttest.status === 400, `got ${noAttest.status}`);
  const noDraw = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, values, signature_password: 'EdOper2026!' }, 'emp');
  t('no drawn signature is refused', noDraw.status === 400 && /Draw your signature/.test((await J(noDraw))?.error || ''), `got ${noDraw.status}`);
  const noPw = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, signature_image: SIG, values }, 'emp');
  const nb = await J(noPw);
  t('WITHOUT THE PASSWORD IT IS 403 WITH signature_required, never 401', noPw.status === 403 && nb?.signature_required === true, `got ${noPw.status}`);
  const wrongPw = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, signature_image: SIG, values, signature_password: 'nope' }, 'emp');
  t('a wrong password is refused', wrongPw.status === 403, `got ${wrongPw.status}`);
  const notMine = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Office', attest: true, signature_image: SIG, values, signature_password: 'EdOffice2026!' }, 'office');
  t('THE OFFICE CANNOT SIGN IT FOR THEM', notMine.status === 403, `got ${notMine.status}`);
  const badValue = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, signature_image: SIG, values: { c1_1: 'Widowed' }, signature_password: 'EdOper2026!' }, 'emp');
  t('a filing status the form does not offer is refused BY NAME, not dropped', badValue.status === 400 && /Filing status/.test((await J(badValue))?.error || ''), JSON.stringify(await J(badValue)).slice(0, 100));
  const still = await J(await get(`/employee-documents/${reqId}`, 'emp'));
  t('after all of that it is still waiting, unsigned', still?.status === 'pending' && !still.signed_at);
}

console.log('\nThe signature itself');
let signed = null;
{
  const r = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, signature_image: SIG, values, signature_password: 'EdOper2026!' }, 'emp');
  signed = await J(r);
  t('it signs', r.ok && signed?.status === 'signed', JSON.stringify(signed || {}).slice(0, 140));
  t('the record carries the name, the time and that the password was confirmed', signed?.signature?.name === 'Ed Operator' && !!signed?.signature?.at && signed?.signature?.verified === true);
  t('and the statement it was signed under', /electronic signature/i.test(signed?.signature?.attestation || ''));
  t('the signed file is hashed, and so is the document as it was sent', !!signed?.signed_sha256 && !!signed?.source_sha256 && signed.signed_sha256 !== signed.source_sha256);
  const again = await post(`/employee-documents/${reqId}/sign`, { signed_name: 'Ed Operator', attest: true, signature_image: SIG, values, signature_password: 'EdOper2026!' }, 'emp');
  t('A SIGNED DOCUMENT CANNOT BE SIGNED AGAIN', again.status === 409, `got ${again.status}`);
  const cancel = await post(`/employee-documents/${reqId}/cancel`, { reason: 'changed my mind' }, 'office');
  t('and cannot be withdrawn after the fact', cancel.status === 409, `got ${cancel.status}`);
}

console.log('\nWhat the signed PDF actually contains');
{
  const r = await get(`/employee-documents/${reqId}/signed`, 'emp');
  const buf = Buffer.from(await r.arrayBuffer());
  t('the employee downloads their own copy', r.ok && buf.slice(0, 5).toString() === '%PDF-', `got ${r.status}`);
  const doc = buf.slice(0, 5).toString() === '%PDF-' ? await PDFDocument.load(buf, { ignoreEncryption: true }) : null;
  t('THE ANSWERS ARE LOCKED IN: the form has no editable fields left', doc?.getForm().getFields().length === 0);
  t('and a signature record page was added', doc?.getPageCount() === 2);
  const office = await get(`/employee-documents/${reqId}/signed`, 'office');
  t('the office can download it', office.ok);
  const other = await get(`/employee-documents/${reqId}/signed`, 'other');
  t('a colleague cannot', other.status === 404, `got ${other.status}`);
}

console.log('\nWhat is kept beside the record, and what is not');
{
  const row = db.prepare('SELECT values_json FROM employee_documents WHERE id = ?').get(reqId);
  const kept = JSON.parse(row.values_json || '{}');
  t('the ordinary answers are readable by the office', Object.values(kept).includes('Ed Operator') && Object.values(kept).includes('Head of household'));
  t('THE SOCIAL SECURITY NUMBER IS NOT COPIED OUT OF THE PDF', !JSON.stringify(kept).includes('123-45-6789'), row.values_json);
  const audit = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'employee_document' AND action = 'sign' ORDER BY timestamp DESC, id DESC LIMIT 1").get();
  const d = JSON.parse(audit?.details || '{}');
  t('the audit entry records the act and that it was password-verified', d.signature_verified === true && d.signed_as === 'Ed Operator');
  t('and never the password or the number', !/EdOper2026|123-45-6789/.test(audit?.details || ''));
}

console.log('\nThe office is told, and can chase what is still waiting');
{
  const msg = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channel_members cm ON cm.channel_id = m.channel_id
    WHERE cm.user_id = 'ed-office' ORDER BY m.created_at DESC LIMIT 1`).get();
  t('the sender is DMd when it is signed', /Ed Operator/.test(msg?.body || '') && /signed/i.test(msg?.body || ''), (msg?.body || '').slice(0, 80));
  const list = await J(await get('/employee-documents', 'office'));
  t('the counts reconcile with the rows returned', list.counts.signed === list.requests.filter(r => r.status === 'signed').length
    && list.counts.pending === list.requests.filter(r => r.status === 'pending').length);
  const otherId = list.requests.find(r => r.user_id === 'ed-other')?.id;
  const rem = await post(`/employee-documents/${otherId}/remind`, {}, 'office');
  t('a reminder can be sent for the one still waiting', rem.ok && (await J(rem))?.ok === true);
  const cancelNoReason = await post(`/employee-documents/${otherId}/cancel`, {}, 'office');
  t('withdrawing without a reason is refused', cancelNoReason.status === 400, `got ${cancelNoReason.status}`);
  const cancelled = await post(`/employee-documents/${otherId}/cancel`, { reason: 'sent to the wrong person' }, 'office');
  t('withdrawing with one works and keeps the reason', cancelled.ok && (await J(cancelled))?.cancelled_reason === 'sent to the wrong person');
  const gone = await J(await get('/employee-documents/mine', 'other'));
  t('and it leaves that person\'s list of things to do', (gone?.pending || []).length === 0);
}

console.log('\nDeclining is an answer, not a silence');
{
  const sent = await J(await post('/employee-documents/send', { template_id: templateId, user_ids: ['ed-other'], title: 'Attendance policy', kind: 'policy' }, 'office'));
  const id = sent.requests[0].id;
  const noReason = await post(`/employee-documents/${id}/decline`, {}, 'other');
  t('declining without a reason is refused', noReason.status === 400, `got ${noReason.status}`);
  const r = await post(`/employee-documents/${id}/decline`, { reason: 'the name on it is wrong' }, 'other');
  const body = await J(r);
  t('declining with one records it', r.ok && body?.status === 'declined' && body.declined_reason === 'the name on it is wrong');
  const notTheirs = await post(`/employee-documents/${id}/decline`, { reason: 'nope' }, 'emp');
  t('and only the person it was sent to can decline it', notTheirs.status === 404 || notTheirs.status === 403, `got ${notTheirs.status}`);
}

console.log('\nA retired template is not offered again');
{
  const r = await req(`/employee-documents/templates/${templateId}`, { method: 'DELETE' }, 'office');
  t('the office retires it', r.ok);
  const still = db.prepare('SELECT retired_at FROM employee_document_templates WHERE id = ?').get(templateId);
  t('THE ROW SURVIVES — a signed request points at it', !!still?.retired_at);
  const send = await post('/employee-documents/send', { template_id: templateId, user_ids: ['ed-emp'] }, 'office');
  t('and it cannot be sent any more', send.status === 409, `got ${send.status}`);
  const signedStill = await get(`/employee-documents/${reqId}/signed`, 'emp');
  t('while the copy already signed against it still downloads', signedStill.ok);
}

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
