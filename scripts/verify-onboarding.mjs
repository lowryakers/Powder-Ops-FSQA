// New-hire onboarding, executed against a live server: the fold (D-048), and
// now the forms — the finish gate that refuses a packet with no SSN, the full
// W-4 and I-9 Section 1 with their signatures, the pictures behind them
// through the S3 stand-in, I-9 Section 2 under the password gate, and the
// packet PDF.
//
// Caller sets PORT + DBPATH. Needs a fresh database. With ONBOARDING_ENC_KEY
// the encrypted path is exercised; without it the no-collection path. With
// the R2 stand-in the uploads are exercised; without it they are skipped.
const PORT = process.env.PORT || 4902;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const portal = (tok, method, body) => fetch(`${B}/onboarding-portal/${tok}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const keyed = !!process.env.ONBOARDING_ENC_KEY;
const storage = !!process.env.R2_ENDPOINT;

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('ob-admin','Onb Admin','Onb Admin','admin','office',1,'SC-OB',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ob-op','Onb Operator','Onb Operator','operator','warehouse',1,'SC-OP',datetime('now','+7 day'),'{"production-log":"edit"}')`).run();
t('the onboarding_records table exists on a fresh database',
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='onboarding_records'").get());
t('and onboarding_files', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='onboarding_files'").get());
db.close();

await post('/users/login', { name: 'Onb Admin' });
await post('/users/set-password', { user_id: 'ob-admin', password: 'OnbPW2026!', setup_code: 'SC-OB' });
token = (await J(await post('/users/login', { name: 'Onb Admin', password: 'OnbPW2026!' })))?.token;
t('admin signed in', !!token);

console.log('\nThe admin router is mounted and behind the module');
let rec = null, link = null;
{
  const r = await post('/onboarding', { first_name: 'Test', last_name: 'Hire', email: 't@example.com', start_date: '2026-09-15', position: 'Kitting' });
  rec = await J(r);
  t('a record can be created', r.ok && !!rec?.id, `got ${r.status}`);
  t('it starts as invited', rec?.status === 'invited', `got ${rec?.status}`);
  const list = await J(await req('/onboarding'));
  const rows = list?.records || [];
  t('and it comes back on the list, carrying what is still missing', rows.some(x => x.id === rec?.id && Array.isArray(x.missing) && x.missing.length > 5));
  t('the list carries the attestation texts for the office', /perjury/.test(list?.attestations?.i9_s2 || ''));
}

console.log('\nThe token link, and the public portal a new hire uses');
{
  const r = await J(await post(`/onboarding/${rec.id}/reissue`));
  link = r?.link || null;
  t('a link is issued', !!link, JSON.stringify(r || {}).slice(0, 90));
}
const tok = String(link || '').split('/').pop();
{
  const noAuth = await fetch(`${B}/onboarding-portal/${tok}`);
  t('THE PORTAL ANSWERS WITH NO SESSION', noAuth.ok, `got ${noAuth.status}`);
  const body = await J(noAuth);
  t('and returns that hire\'s record', body?.first_name === 'Test' || body?.id === rec.id, JSON.stringify(body || {}).slice(0, 90));
  t('the portal never shows the employer\'s Section 2 or the office notes', !('i9_section2' in (body || {})) && !('notes' in (body || {})));
  const bogus = await fetch(`${B}/onboarding-portal/not-a-real-token`);
  t('a bad token is refused', bogus.status === 404, `got ${bogus.status}`);
}

console.log('\nThe finish gate: nothing goes to the office half done');
{
  const fin = await fetch(`${B}/onboarding-portal/${tok}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const fb = await J(fin);
  t('finishing an empty packet is refused and names what is missing', fin.status === 400 && Array.isArray(fb?.missing) && fb.missing.length > 5, JSON.stringify(fb).slice(0, 120));
  if (keyed) t('…including the SSN', fb.missing.some(m => m.field === 'ssn'));
  t('…the W-4 signature', fb.missing.some(m => m.field === 'w4_signature'));
  t('…and the I-9 signature', fb.missing.some(m => m.field === 'i9_signature'));
}

console.log('\nThe data that should never be in clear, and the numbers that must check out');
{
  // The page's own fields first, with the secret keys BLANK — exactly what the
  // wizard sends after a save has cleared them — then the secrets.
  const plain = await portal(tok, 'PUT', { first_name: 'Test', last_name: 'Hire', dob: '1995-04-02', address1: '1 Main', city: 'Provo', state: 'UT', zip: '84601', phone: '8015551212',
    pay_method: 'direct_deposit', dd_bank_name: 'Zions', dd_account_type: 'checking', ssn: '', dd_routing: '', dd_account: '' });
  t('blank secret keys do not refuse the save (they are what the wizard re-sends)', plain.ok, `${plain.status}`);
  const secret = await portal(tok, 'PUT', { ssn: '123-45-6789', dd_account: '000123456789', dd_routing: '021000021' });
  if (keyed) t('the secrets save with a key', secret.ok, `${secret.status}`);
  else t('with no key, a real SSN is REFUSED rather than stored bare', secret.status === 400, `${secret.status}`);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const row = d.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
  d.close();
  const clear = JSON.stringify(row);
  if (keyed) {
    t('the submission actually saved', !!row?.ssn_enc && !!row?.dd_account_enc, `ssn_enc=${!!row?.ssn_enc} dd_account_enc=${!!row?.dd_account_enc}`);
    t('only the last four are readable', row?.ssn_last4 === '6789' && row?.dd_account_last4 === '6789');
    t('the SSN is not stored in clear', !clear.includes('123-45-6789') && !clear.includes('123456789'));
    t('the account number is not stored in clear', !clear.includes('000123456789'));
    const badSsn = await portal(tok, 'PUT', { ssn: '12-34' });
    t('a malformed SSN is refused', badSsn.status === 400, `${badSsn.status}`);
    const badRouting = await portal(tok, 'PUT', { dd_routing: '123456789' });
    t('a routing number that fails the ABA checksum is refused', badRouting.status === 400, `${badRouting.status}`);
  } else {
    t('with no key, nothing sensitive is stored at all', !row?.ssn_enc && !row?.ssn_last4 && !row?.dd_account_enc);
    t('and certainly not in clear', !clear.includes('123-45-6789') && !clear.includes('000123456789'));
    t('the rest of the submission still saves', row?.dob === '1995-04-02' && row?.city === 'Provo', `dob=${row?.dob}`);
  }
}

console.log('\nThe W-4, signed');
{
  const unsigned = await portal(tok, 'PUT', { w4_filing_status: 'married_jointly', w4_multiple_jobs: true, w4_qualifying_children: '2', w4_dependents_amount: '4000' });
  const ub = await J(unsigned);
  t('the W-4 fields save', unsigned.ok && ub?.w4_filing_status === 'married_jointly' && ub?.w4_multiple_jobs === true);
  const wrongName = await portal(tok, 'PUT', { w4_sign: true, signed_name: 'Somebody Else', attest: true });
  t('a signature under another name is refused', wrongName.status === 400, `${wrongName.status}`);
  const noAttest = await portal(tok, 'PUT', { w4_sign: true, signed_name: 'Test Hire', attest: false });
  t('a signature without the attestation is refused', noAttest.status === 400, `${noAttest.status}`);
  const signed = await J(await portal(tok, 'PUT', { w4_sign: true, signed_name: 'Test Hire', attest: true }));
  t('signed with the legal name, time and origin recorded', signed?.w4_signature?.name === 'Test Hire' && !!signed.w4_signature.at && 'ip' in signed.w4_signature, JSON.stringify(signed?.w4_signature));
  t('the W-4 attestation travels with the signature', /perjury/.test(signed?.w4_signature?.attestation || ''));
}

console.log('\nThe I-9 Section 1, signed — with the conditional fields the status demands');
{
  const alien = await portal(tok, 'PUT', { i9_citizenship: 'authorized_alien' });
  const ab = await J(alien);
  t('an authorized noncitizen with no number is listed as missing one', (ab?.missing || []).some(m => m.field === 'i9_work_until') && (ab?.missing || []).some(m => m.field === 'i9_uscis_number'));
  const beforeSign = await portal(tok, 'PUT', { i9_citizenship: 'citizen', i9_sign: true, signed_name: 'Test Hire', attest: true });
  const sb = await J(beforeSign);
  t('a citizen signs Section 1', beforeSign.ok && sb?.i9_signature?.name === 'Test Hire', JSON.stringify(sb?.i9_signature || sb));
  t('…and the conditional fields are no longer missing', !(sb?.missing || []).some(m => m.step === 'i9'));
}

if (storage) {
  console.log('\nThe pictures behind the forms');
  const fd = new FormData();
  fd.append('kind', 'id_document');
  fd.append('files', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'license-front.png');
  fd.append('files', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'ssn-card.png');
  const up = await fetch(`${B}/onboarding-portal/${tok}/files`, { method: 'POST', body: fd });
  const ub = await J(up);
  t('the new hire attaches two ID photos from the link, no session', up.ok && ub?.files?.length === 2 && ub.files.every(f => f.kind === 'id_document' && f.uploaded_by === 'new hire'), JSON.stringify(ub?.files || ub));
  const fd2 = new FormData();
  fd2.append('kind', 'voided_check');
  fd2.append('files', new Blob(['check'], { type: 'image/jpeg' }), 'void.jpg');
  const ub2 = await J(await fetch(`${B}/onboarding-portal/${tok}/files`, { method: 'POST', body: fd2 }));
  t('and a voided check', ub2?.files?.some(f => f.kind === 'voided_check'));
  const own = await fetch(`${B}/onboarding-portal/${tok}/files/${ub.files[1].id}`, { method: 'DELETE' });
  t('they can remove their own upload', own.ok);
  const officeList = await J(await req('/onboarding'));
  const mine = officeList.records.find(x => x.id === rec.id);
  t('the office sees the files on the packet', mine?.files?.length === 2);
  const url = await J(await req(`/onboarding/files/${mine.files[0].id}/url`));
  t('and can open one', typeof url?.url === 'string' && (await (await fetch(url.url)).arrayBuffer()).byteLength === 8);
  const fd3 = new FormData();
  fd3.append('kind', 'other');
  fd3.append('files', new Blob(['offer'], { type: 'application/pdf' }), 'offer-letter.pdf');
  const ob = await J(await fetch(`${B}/onboarding/${rec.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd3 }));
  t('the office can attach its own file', ob?.files?.some(f => f.filename === 'offer-letter.pdf' && f.uploaded_by === 'Onb Admin'));
  const notMine = await fetch(`${B}/onboarding-portal/${tok}/files/${ob.files.find(f => f.filename === 'offer-letter.pdf').id}`, { method: 'DELETE' });
  t("the new hire cannot remove the office's file", notMine.status === 404, `${notMine.status}`);
}

console.log('\nFinishing, once everything is in');
{
  const fin = await fetch(`${B}/onboarding-portal/${tok}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const fb = await J(fin);
  if (!keyed && !storage) {
    // No key and no storage: direct deposit needs a voided check the portal cannot take. Switch to check.
    await portal(tok, 'PUT', { pay_method: 'check' });
  }
  const fin2 = (!keyed && !storage) ? await fetch(`${B}/onboarding-portal/${tok}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) : fin;
  t('the packet finishes once the forms are complete and signed', fin2.ok, `${fin2.status} ${JSON.stringify(fb).slice(0, 160)}`);
  const after = await J(await fetch(`${B}/onboarding-portal/${tok}`));
  t('the record reads ready with nothing missing', after?.status === 'ready' && after?.missing?.length === 0, JSON.stringify(after?.missing));
}

console.log('\nI-9 Section 2 is the employer\'s, under the password gate');
{
  const body = { documents: [{ list: 'B', title: "Driver's license", issuing_authority: 'Utah DLD', number: 'UT123456', expires: '2030-01-01' }, { list: 'C', title: 'Social Security card', issuing_authority: 'SSA', number: '•••-••-6789' }], first_day: '2026-09-15', employer_title: 'Office Manager', attest: true };
  const noPw = await post(`/onboarding/${rec.id}/i9-section2`, body);
  const nb = await J(noPw);
  t('signing Section 2 without the password is refused with 403 + signature_required, never 401', noPw.status === 403 && nb?.signature_required === true, `${noPw.status} ${JSON.stringify(nb)}`);
  const halfDocs = await post(`/onboarding/${rec.id}/i9-section2`, { ...body, documents: [body.documents[0]], signature_password: 'OnbPW2026!' });
  t('List B alone is refused — the form wants A, or B and C', halfDocs.status === 400, `${halfDocs.status}`);
  const signed = await post(`/onboarding/${rec.id}/i9-section2`, { ...body, signature_password: 'OnbPW2026!' });
  const sb = await J(signed);
  t('with the password it signs, naming who and when', signed.ok && sb?.i9_section2?.signed_by === 'Onb Admin' && sb.i9_section2.signature_verified === true && sb.i9_section2.documents.length === 2, JSON.stringify(sb?.i9_section2 || sb).slice(0, 200));
  const d = new Database(process.env.DBPATH, { readonly: true });
  const audit = d.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'onboarding' AND action = 'sign'").get().c;
  const leak = d.prepare("SELECT COUNT(*) c FROM audit_log WHERE details LIKE '%OnbPW2026%'").get().c;
  d.close();
  t('the signatures are in the audit trail (employee W-4, employee I-9, employer Section 2)', audit >= 3, `${audit}`);
  t('and the password never is', leak === 0);
}

console.log('\nThe packet as a document');
{
  const pdf = await fetch(`${B}/onboarding/${rec.id}/packet.pdf`, { headers: { Authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  t('the packet PDF downloads', pdf.ok && pdf.headers.get('content-type') === 'application/pdf' && bytes.subarray(0, 4).toString() === '%PDF', `${pdf.status} ${pdf.headers.get('content-type')}`);
  const text = bytes.toString('latin1');
  t('the full SSN is not in the PDF', !text.includes('123456789') && !text.includes('123-45-6789'));
}

console.log('\nAn operator with no grant gets nothing');
{
  await post('/users/login', { name: 'Onb Operator' });
  await post('/users/set-password', { user_id: 'ob-op', password: 'OpPW2026!', setup_code: 'SC-OP' });
  const opTok = (await J(await post('/users/login', { name: 'Onb Operator', password: 'OpPW2026!' })))?.token;
  const r = await fetch(`${B}/onboarding`, { headers: { Authorization: `Bearer ${opTok}` } });
  t('the module guard refuses them', r.status === 403 || r.status === 401, `got ${r.status}`);
  const pdf = await fetch(`${B}/onboarding/${rec.id}/packet.pdf`, { headers: { Authorization: `Bearer ${opTok}` } });
  t('…and the packet PDF too', pdf.status === 403 || pdf.status === 401, `got ${pdf.status}`);
}

console.log('\nCompleting with create_account produces an account that can SIGN IN');
{
  const r = await post(`/onboarding/${rec.id}/complete`, { create_account: true });
  const b = await J(r);
  t('complete with create_account is accepted', r.ok, `got ${r.status} ${JSON.stringify(b || {}).slice(0, 80)}`);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const u = d.prepare("SELECT id, name, username FROM users WHERE name = 'Test Hire'").get();
  d.close();
  t('an account was created', !!u, 'no users row named Test Hire');
  t('and it has a username at creation, not after a restart', !!u?.username, `username=${u?.username}`);
  const look = await J(await fetch(`${B}/users/lookup?q=${encodeURIComponent('Test Hi')}`));
  const names = (Array.isArray(look) ? look : []).map(x => x.username || x.name);
  t('the login type-ahead can find them', names.some(n => /test hire/i.test(String(n))), names.join('|'));
}

console.log('\nADP itself degrades gracefully, like storage and AI');
{
  const r = await post(`/onboarding/${rec.id}/submit-adp`, {});
  t('submitting with no ADP credentials 503s rather than throwing', r.status === 503 || r.status === 400, `got ${r.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
