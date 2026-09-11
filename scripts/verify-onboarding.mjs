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
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ob-office','Onb Office','Onb Office','supervisor','office',1,'SC-OO',datetime('now','+7 day'),'{"onboarding":"edit"}')`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ob-wh','Onb Warehouse','Onb Warehouse','supervisor','warehouse',1,'SC-OW',datetime('now','+7 day'),'{"onboarding":"edit"}')`).run();
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
  const plain = await portal(tok, 'PUT', { first_name: 'Test', last_name: 'Hire', dob: '1995-04-02', gender: 'F', address1: '1 Main', city: 'Provo', state: 'UT', zip: '84601', phone: '8015551212',
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

    // THE REVEAL: the office keys the packet into RUN by hand, so the three
    // numbers every screen masks have exactly one audited door.
    console.log('\nThe reveal for ADP entry');
    const as = async (name, id, code, fn) => {
      const keep = token;
      await post('/users/login', { name });
      await post('/users/set-password', { user_id: id, password: 'OnbPW2026!', setup_code: code });
      token = (await J(await post('/users/login', { name, password: 'OnbPW2026!' })))?.token;
      try { return await fn(); } finally { token = keep; }
    };
    const list = await J(await req('/onboarding'));
    t('the list tells the admin they may reveal', list?.can_reveal === true);
    const noPw = await post(`/onboarding/${rec.id}/reveal`, {});
    t('without the password it is refused with 403 signature_required, never 401', noPw.status === 403 && (await J(noPw))?.signature_required === true, `${noPw.status}`);
    const wrongPw = await post(`/onboarding/${rec.id}/reveal`, { signature_password: 'nope-nope-nope' });
    t('a wrong password is refused', wrongPw.status === 403);
    const ok = await post(`/onboarding/${rec.id}/reveal`, { signature_password: 'OnbPW2026!' });
    const shown = await J(ok);
    t('with the password the clear SSN, routing and account come back once', ok.ok && shown?.ssn === '123456789' && shown?.dd_routing === '021000021' && shown?.dd_account === '000123456789', JSON.stringify(shown).slice(0, 160));
    t('…naming who looked and when', shown?.revealed_by === 'Onb Admin' && !!shown?.revealed_at && shown?.fields?.includes('ssn'));
    const d2 = new Database(process.env.DBPATH, { readonly: true });
    const aud = d2.prepare("SELECT * FROM audit_log WHERE entity_type = 'onboarding' AND entity_id = ? AND action LIKE '%reveal%'").all(rec.id);
    const auditText = JSON.stringify(aud);
    const anyAudit = JSON.stringify(d2.prepare('SELECT details, previous_state, new_state FROM audit_log').all());
    const rowAfter = d2.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
    d2.close();
    const audDetail = (() => { try { return JSON.parse(aud[0]?.details || '{}'); } catch { return {}; } })();
    t('the audit entry records the fields and the signature check, with the admin\'s name', aud.length === 1 && JSON.stringify(audDetail.fields) === '["ssn","dd_routing","dd_account"]' && audDetail.signature_verified === true && aud[0].actor === 'Onb Admin', auditText.slice(0, 200));
    t('the values themselves are NOWHERE in the audit log', !anyAudit.includes('123456789') && !anyAudit.includes('021000021') && !anyAudit.includes('000123456789'));
    t('the record is untouched: still encrypted, still last-4 only', rowAfter?.ssn_last4 === '6789' && !JSON.stringify(rowAfter).includes('123-45-6789') && !JSON.stringify(rowAfter).includes('123456789'));
    const stillMasked = await J(await req('/onboarding'));
    t('the list still masks it after a reveal', JSON.stringify(stillMasked).includes('6789') && !JSON.stringify(stillMasked).includes('123456789'));
    await as('Onb Office', 'ob-office', 'SC-OO', async () => {
      const l = await J(await req('/onboarding'));
      t('an office supervisor holding the grant may reveal', l?.can_reveal === true);
      const r2 = await post(`/onboarding/${rec.id}/reveal`, { signature_password: 'OnbPW2026!' });
      t('…and gets the numbers with their own password', r2.ok && (await J(r2))?.ssn === '123456789', `${r2.status}`);
    });
    await as('Onb Warehouse', 'ob-wh', 'SC-OW', async () => {
      const l = await J(await req('/onboarding'));
      t('a warehouse supervisor holding the SAME grant reads the packet but may not reveal', l?.can_reveal === false && Array.isArray(l?.records));
      const r3 = await post(`/onboarding/${rec.id}/reveal`, { signature_password: 'OnbPW2026!' });
      t('…refused outright, before the password is even checked', r3.status === 403 && !(await J(r3))?.signature_required, `${r3.status}`);
    });
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
  // The office is TOLD, not left to discover it. The announcement runs after
  // the response, so give it a moment.
  await new Promise(r => setTimeout(r, 800));
  const d3 = new Database(process.env.DBPATH, { readonly: true });
  const dms = d3.prepare("SELECT body FROM chat_messages WHERE body LIKE '%finished their onboarding packet%'").all();
  const bot = d3.prepare("SELECT id FROM users WHERE name = 'ReadyBot'").get();
  const dmTo = bot ? d3.prepare(`SELECT DISTINCT m.user_id FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
      JOIN chat_messages msg ON msg.channel_id = c.id WHERE msg.body LIKE '%finished their onboarding packet%' AND m.user_id != ?`).all(bot.id).map(r => r.user_id) : [];
  d3.close();
  t('ReadyBot DMs the office the moment the packet is finished, naming the hire and the forms', dms.length >= 1 && /Test Hire/.test(dms[0]?.body || '') && /W-4 and I-9 Section 1 signed/.test(dms[0]?.body || ''), JSON.stringify(dms).slice(0, 200));
  t('…and it reaches the admin who started it and the office supervisor, not the warehouse', dmTo.includes('ob-admin') && dmTo.includes('ob-office') && !dmTo.includes('ob-wh') && !dmTo.includes('ob-op'), JSON.stringify(dmTo));
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

console.log('\nAn EMPLOYEE cannot finish without the gender RUN requires');
{
  const g = await J(await post('/onboarding', { first_name: 'Gap', last_name: 'Case' }));
  const gt = String(g.link).split('/').pop();
  await portal(gt, 'PUT', { phone: '8015550777', dob: '1990-01-01', address1: '2 Elm', city: 'Provo', state: 'UT', zip: '84601' });
  const v = await J(await portal(gt, 'GET'));
  t('gender is on the outstanding list for an employee', (v.missing || []).some(m => m.field === 'gender'));
}

console.log('\nA 1099 CONTRACTOR signs a W-9 and never an I-9');
{
  const c = await J(await post('/onboarding', {
    first_name: 'Dana', last_name: 'Reyes', position: 'Line Consultant',
    start_date: '2026-10-01', worker_type: 'contractor',
  }));
  t('an onboarding can be opened as a contractor', c?.worker_type === 'contractor', JSON.stringify(c || {}).slice(0, 120));
  const ctok = String(c.link).split('/').pop();
  // The engagement is the office's to set and to correct — until a form is signed.
  const plain = await J(await post('/onboarding', { first_name: 'Ada', last_name: 'Default' }));
  t('with nothing said, an onboarding opens as a W-2 employee', plain?.worker_type === 'employee' && plain?.is_contractor === false, String(plain?.worker_type));
  const flipped = await J(await req(`/onboarding/${plain.id}`, { method: 'PUT', body: JSON.stringify({ worker_type: 'contractor' }) }));
  t('the office can correct it to contractor before anything is signed', flipped?.worker_type === 'contractor', JSON.stringify(flipped || {}).slice(0, 120));
  await post(`/onboarding/${plain.id}/cancel`, {});

  let v = await J(await portal(ctok, 'GET'));
  t('the portal says they are a contractor', v?.is_contractor === true);
  t('and hands back the W-9 certification to sign under', /Under penalties of perjury, I certify/.test(v?.attestations?.w9 || ''));
  t('the four W-9 items are all present while backup withholding is not claimed',
    /4\. The FATCA/.test(v.attestations.w9) && /2\. I am not subject to backup withholding/.test(v.attestations.w9));

  // THE I-9 IS NEVER ASKED FOR.
  t('nothing on the outstanding list mentions the I-9',
    !(v.missing || []).some(m => m.step === 'i9'), JSON.stringify((v.missing || []).map(m => m.step)));
  t('but the W-9 is', (v.missing || []).some(m => m.step === 'w9'));

  await portal(ctok, 'PUT', {
    phone: '8015550444', dob: '1985-02-02', address1: '9 Mill Rd', city: 'Orem', state: 'UT', zip: '84057',
    ssn: '444-55-6666', dd_routing: '124000054', dd_account: '99887766', dd_account_type: 'checking',
    w9_business_name: 'Reyes Consulting LLC', w9_tax_classification: 'llc', w9_llc_classification: 'S',
    w9_tin_type: 'ein', ein: '12-3456789',
  });
  v = await J(await portal(ctok, 'GET'));
  t('the EIN is stored encrypted and comes back only as a flag and last four',
    v?.has_ein === true && v?.ein_last4 === '6789' && v?.ein === undefined, `${v?.has_ein}/${v?.ein_last4}`);
  t('gender is NOT demanded of a contractor', !(v.missing || []).some(m => m.field === 'gender'));

  // Refusals that matter.
  const wrongForm = await portal(ctok, 'PUT', { w4_sign: true, signed_name: 'Dana Reyes', attest: true });
  t('a contractor cannot sign a W-4, and is told which form is theirs',
    wrongForm.status === 400 && /Form W-9/.test((await J(wrongForm))?.error || ''), String(wrongForm.status));
  const wrongI9 = await portal(ctok, 'PUT', { i9_sign: true, signed_name: 'Dana Reyes', attest: true });
  t('nor an I-9', wrongI9.status === 400, String(wrongI9.status));

  const signed = await portal(ctok, 'PUT', { w9_sign: true, signed_name: 'Dana Reyes', attest: true });
  t('but the W-9 signs', signed.ok, `${signed.status} ${JSON.stringify(await J(signed) || {}).slice(0, 120)}`);
  const locked = await req(`/onboarding/${c.id}`, { method: 'PUT', body: JSON.stringify({ worker_type: 'employee' }) });
  t('once a form is signed the worker type is LOCKED — the record would contradict its forms', locked.status === 400 && /already been signed/.test((await J(locked))?.error || ''), String(locked.status));
  v = await J(await portal(ctok, 'GET'));
  t('the signature records the certification it was given under',
    /Under penalties of perjury/.test(v?.w9_signature?.attestation || ''));
  t('nothing is outstanding now', (v.missing || []).length === 0, JSON.stringify((v.missing || []).map(m => m.label)));

  const fin = await fetch(`${B}/onboarding-portal/${ctok}/finish`, { method: 'POST' });
  t('and it finishes with no I-9 anywhere', fin.ok, String(fin.status));

  // Backup withholding strikes item 2 out of what they sign.
  const c2 = await J(await post('/onboarding', { first_name: 'Sam', last_name: 'Vale', worker_type: 'contractor' }));
  const t2 = String(c2.link).split('/').pop();
  await portal(t2, 'PUT', { w9_backup_withholding: true });
  const v2 = await J(await portal(t2, 'GET'));
  t('ticking backup withholding removes item 2 from the certification',
    !/I am not subject to backup withholding/.test(v2.attestations.w9)
    && /struck out/.test(v2.attestations.w9), v2.attestations.w9.slice(0, 90));

  const pdf = await req(`/onboarding/${c.id}/packet.pdf`);
  const buf = Buffer.from(await pdf.arrayBuffer());
  t('the packet renders for a contractor', pdf.ok && buf.length > 1000, `${pdf.status} ${buf.length}`);

  // COMPLETING A CONTRACTOR GIVES THEM NOTHING IN READYDOC.
  await post(`/onboarding/${c.id}/complete`, { create_account: true });
  {
    const d = new Database(process.env.DBPATH, { readonly: true });
    const u = d.prepare("SELECT id FROM users WHERE name = 'Dana Reyes'").get();
    const pe = d.prepare("SELECT worker_type, contractor_company FROM pay_employees WHERE name = 'Dana Reyes'").get();
    d.close();
    t('the employee tick-box does NOT create an account for a contractor', !u, `user=${u?.id}`);
    t('but they DO land on the pay roster', !!pe);
    t('as a contractor, not staff — the headcount and the review cycle exclude them',
      pe?.worker_type === 'contractor', String(pe?.worker_type));
    t('carrying the business name off the W-9', pe?.contractor_company === 'Reyes Consulting LLC', String(pe?.contractor_company));
  }

  // ...unless somebody asks for it deliberately, and then it is marked as one.
  const c3 = await J(await post('/onboarding', {
    first_name: 'Kit', last_name: 'Moss', worker_type: 'contractor', department: 'maintenance',
  }));
  await post(`/onboarding/${c3.id}/complete`, { grant_readydoc_access: true });
  {
    const d = new Database(process.env.DBPATH, { readonly: true });
    const u = d.prepare("SELECT id, is_contractor, module_access, is_active FROM users WHERE name = 'Kit Moss'").get();
    d.close();
    t('a deliberate grant DOES create the account', !!u);
    t('flagged as a contractor rather than passing as staff', u?.is_contractor === 1, String(u?.is_contractor));
    t('with no module access — Messages only until somebody grants one', u?.module_access == null, String(u?.module_access));

    const noReason = await post(`/onboarding/${c3.id}/end-access`, { reason: '' });
    t('ending access without saying why is refused', noReason.status === 400, String(noReason.status));
    const ended = await J(await post(`/onboarding/${c3.id}/end-access`, { reason: 'contract finished' }));
    t('ending access switches the account off', ended?.account === true);
    t('and takes them off the pay roster in the same act', ended?.roster === true);

    const d2 = new Database(process.env.DBPATH, { readonly: true });
    const after = d2.prepare("SELECT is_active FROM users WHERE name = 'Kit Moss'").get();
    const pe2 = d2.prepare("SELECT active FROM pay_employees WHERE name = 'Kit Moss'").get();
    const sess = d2.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id);
    d2.close();
    t('the account is deactivated, NOT deleted — the audit trail survives', after?.is_active === 0);
    t('the roster row stays too, so what they were paid is still on record', pe2?.active === 0);
    t('and any live session is dropped rather than left to expire', sess?.n === 0, String(sess?.n));
  }
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
