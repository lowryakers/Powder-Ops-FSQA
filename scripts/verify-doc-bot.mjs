// verify:docbot — one bot grant per document type (D-306).
//
// A fresh database. The Quality bot's account has edit on SOPs, Work
// Instructions and Job Descriptions. Its tokens hold different grants:
//   sops-edit only · wi-edit · jd-edit.
// Asserted:
//   - an SOP-only token is refused (403, naming wi-edit) on a WI: the revision
//     Quality hit on WI005, an attach, a new draft;
//   - a wi-edit token files a draft WI, edits it, starts and edits a revision of
//     an approved WI (doc_number staged), attaches the signed PDF to the draft;
//     the WI in force does not move until a person approves;
//   - the wi-edit token is refused approve, sign, retire (DELETE), reinstate,
//     DELETE of the revision, and every SOP / JD write;
//   - a jd-edit token does the same for a JD and is refused on a WI;
//   - each successful bot write is one `bot_sop_write` audit row carrying the
//     token's label, the document type and the grant it used;
//   - Settings offers the wi-edit and jd-edit tick boxes (the grant catalog).
//
// Caller sets PORT + DBPATH and the S3 stand-in (verify-all does).
// Control: run against `main` before D-306. The wi-edit grant does not exist,
// so the token cannot be given it, and the first WI revision is 403.
import Database from 'better-sqlite3';
import { markQaReviewed, fileApprovedDoc } from './lib/qa-review-fixture.mjs';

const PORT = Number(process.env.PORT || 5185);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'DocBot2026!!';

// File a document into force the D-321 way: draft → QA review marked → approved with a password.
const fileDoc = async (body, tok) => ({ status: 201, json: await fileApprovedDoc((m, p, b) => call(m, p, b, tok), DBP, { signature_password: PW, ...body }) });
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  const docs = { sops: 'edit', 'work-instructions': 'edit', 'job-descriptions': 'edit' };
  mk('db-admin', 'Ada Admin', 'admin', 'admin');
  mk('db-qa', 'Quinn Quality', 'supervisor', 'qa', docs);
  mk('db-bot', '*Quality Bot', 'operator', 'qa', docs);
  db.close();
}

const call = async (m, p, b, tok, form) => {
  const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: form || (b ? JSON.stringify(b) : undefined) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('db-admin', 'Ada Admin');
const qa = await signIn('db-qa', 'Quinn Quality');
t('an admin and a QA supervisor signed in', !!admin && !!qa);

console.log('\n── the grants in Settings ──');
let r = await call('GET', '/api-tokens', null, admin);
const catalog = (r.json?.grants || []).map((g) => g.key);
t('Settings offers sops-edit, wi-edit and jd-edit as tick boxes', ['sops-edit', 'wi-edit', 'jd-edit'].every((g) => catalog.includes(g)), JSON.stringify(catalog));

// Test tokens on this throwaway database only, minted by its own test admin.
const mint = async (label, grants) => {
  const m = await call('POST', '/api-tokens', { user_id: 'db-bot', label, scopes: ['read', 'write'] }, admin);
  const id = m.json?.token?.id;
  const g = await call('POST', `/api-tokens/${id}/grants`, { grants }, admin);
  return { id, plain: m.json?.plaintext, granted: g.json?.token?.grants || g.json?.grants || null, gstatus: g.status };
};
const SOP = await mint('Quality bot (SOPs only)', ['sops-edit']);
const WI = await mint('Quality bot (WIs)', ['wi-edit']);
const JD = await mint('Quality bot (JDs)', ['jd-edit']);
t('an SOP-only, a wi-edit and a jd-edit token minted on the fresh database', [SOP, WI, JD].every((x) => x.plain));
t('the wi-edit and jd-edit grants were accepted', WI.gstatus === 200 && JD.gstatus === 200, `${WI.gstatus} ${JD.gstatus}`);

// Documents a person filed and approved with a password.
const file = async (body) => (await fileDoc({ category: 'quality', ...body }, admin)).json;
const wiDoc = await file({ doc_type: 'work_instruction', doc_number: 'WI005', title: 'Hand Filling', revision: 'V2', content: 'WI text V2.' });
const jdDoc = await file({ doc_type: 'job_description', doc_number: 'JD 07', title: 'Batching Lead', revision: 'V1', content: 'JD text V1.' });
const sopDoc = await file({ doc_type: 'sop', doc_number: 'SOP-202', title: 'Glass', revision: 'V2', content: 'SOP text.' });
t('WI005, JD 07 and SOP-202 approved by a person', [wiDoc, jdDoc, sopDoc].every((d) => d?.status === 'active'), JSON.stringify([wiDoc?.status, jdDoc?.status, sopDoc?.status]));
const wiRow = () => JSON.stringify(one('SELECT doc_number, revision, description, status, approved_by FROM sop_documents WHERE id = ?', wiDoc.id));
const wiBefore = wiRow();

console.log('\n── an SOP-only token on a Work Instruction ──');
r = await call('POST', `/documents/${wiDoc.id}/revisions`, { revision: 'V3' }, SOP.plain);
t('POST /documents/:id/revisions on WI005: 403 token_denied, naming wi-edit', r.status === 403 && r.json?.error === 'token_denied'
  && /sops-edit grant covers SOPs only; a Work Instruction needs the wi-edit grant/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('POST', '/documents', { title: 'X', category: 'quality', doc_type: 'work_instruction' }, SOP.plain);
t('a new draft WI: 403', r.status === 403 && /wi-edit/.test(r.json?.reason || ''), JSON.stringify(r.json));
const MARK = 'DOC-BOT-WI-SCAN-1c9e';
const PDF = Buffer.from(`%PDF-1.4\n% ${MARK}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const form = (name, fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('files', new Blob([PDF], { type: 'application/pdf' }), name);
  return f;
};
r = await call('POST', `/documents/${wiDoc.id}/attachments`, null, SOP.plain, form('WI005.pdf', { kind: 'signed_original' }));
t('an attach to WI005: 403', r.status === 403 && r.json?.error === 'token_denied', JSON.stringify(r.json));
t('…and nothing was written', one("SELECT COUNT(*) c FROM document_revisions WHERE document_id = ? AND status = 'draft'", wiDoc.id).c === 0
  && one('SELECT COUNT(*) c FROM document_attachments WHERE document_id = ?', wiDoc.id).c === 0);

console.log('\n── a wi-edit token stages WI work ──');
r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 040', title: 'Auger cleaning', category: 'production', revision: 'V1', content: 'Draft WI.' }, WI.plain);
const newWi = r.json;
t('files a draft WI with no approver', r.status === 201 && newWi?.status === 'draft' && newWi?.doc_type === 'work_instruction' && newWi?.approved_by == null, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
r = await call('PUT', `/documents/${newWi.id}`, { title: 'Auger cleaning, corrected', content: 'Corrected.' }, WI.plain);
t('edits the draft WI', r.status === 200 && r.json?.title === 'Auger cleaning, corrected', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
r = await call('POST', `/documents/${wiDoc.id}/revisions`, { revision: 'V3', change_summary: 'From the signed scan' }, WI.plain);
const rev = r.json;
t('starts a V3 draft revision of WI005', r.status === 201 && rev?.status === 'draft', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
r = await call('PUT', `/documents/${wiDoc.id}/revisions/${rev?.id}`, { revision: 'V3', description: 'WI text V3.', effective_date: '2026-11-01', doc_number: 'WI 005' }, WI.plain);
t('edits the draft revision and stages a new doc_number', r.status === 200 && r.json?.description === 'WI text V3.' && r.json?.doc_number === 'WI 005', `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
r = await call('POST', `/documents/${wiDoc.id}/attachments`, null, WI.plain, form('WI005_V3_signed.pdf', { kind: 'signed_original', revision: 'V3', revision_id: rev.id }));
t('attaches the signed_original PDF to the draft', r.status === 201 && r.json?.[0]?.state === 'draft', `${r.status} ${JSON.stringify(r.json)}`);
t('WI005 in force is UNCHANGED until a person approves', wiRow() === wiBefore, wiRow());

console.log('\n── what the wi-edit token may never do ──');
const NEVER = [
  ['approve the WI revision', 'POST', `/documents/${wiDoc.id}/revisions/${rev.id}/approve`, { signature_password: PW }],
  ['sign WI005', 'POST', `/documents/${wiDoc.id}/sign`, {}],
  ['retire WI005 (DELETE)', 'DELETE', `/documents/${wiDoc.id}`, { reason: 'No longer in use' }],
  ['reinstate WI005', 'POST', `/documents/${wiDoc.id}/reinstate`, {}],
  ['DELETE the draft revision', 'DELETE', `/documents/${wiDoc.id}/revisions/${rev.id}`, { reason: 'x' }],
  ['edit WI005 in force directly', 'PUT', `/documents/${wiDoc.id}`, { title: 'Renamed' }],
  ['move the draft WI to active', 'PUT', `/documents/${newWi.id}`, { status: 'active' }],
  ['file a WI as active', 'POST', '/documents', { doc_type: 'work_instruction', title: 'X', category: 'q', status: 'active' }],
  ['start a revision of an SOP', 'POST', `/documents/${sopDoc.id}/revisions`, { revision: 'V3' }],
  ['file an SOP (no doc_type)', 'POST', '/documents', { title: 'X', category: 'q' }],
  ['start a revision of a JD', 'POST', `/documents/${jdDoc.id}/revisions`, { revision: 'V2' }],
  ['file a policy', 'POST', '/documents', { doc_type: 'policy', title: 'X', category: 'q' }],
];
for (const [n, m, p, b] of NEVER) {
  r = await call(m, p, b, WI.plain);
  t(`refused: ${n}`, r.status === 403 && ['token_denied', 'approve_requires_human_session'].includes(r.json?.error), `${r.status} ${JSON.stringify(r.json)}`);
}
t('WI005 is still V2 and active; the draft revision is still a draft', wiRow() === wiBefore
  && one('SELECT status FROM document_revisions WHERE id = ?', rev.id).status === 'draft');

console.log('\n── a jd-edit token on a Job Description ──');
r = await call('POST', `/documents/${jdDoc.id}/revisions`, { revision: 'V2' }, JD.plain);
const jrev = r.json;
t('starts a V2 draft revision of JD 07', r.status === 201 && jrev?.status === 'draft', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
r = await call('PUT', `/documents/${jdDoc.id}/revisions/${jrev?.id}`, { description: 'JD text V2.' }, JD.plain);
t('edits the JD draft revision', r.status === 200 && r.json?.description === 'JD text V2.', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
markQaReviewed(DBP, jrev.id); // QA reviewed it first (D-319)
r = await call('POST', `/documents/${jdDoc.id}/revisions/${jrev.id}/approve`, { signature_password: PW }, JD.plain);
t('refused: approve the JD revision', r.status === 403, JSON.stringify(r.json));
r = await call('DELETE', `/documents/${jdDoc.id}`, { reason: 'x' }, JD.plain);
t('refused: retire JD 07', r.status === 403, JSON.stringify(r.json));
r = await call('PUT', `/documents/${wiDoc.id}/revisions/${rev.id}`, { description: 'hijack' }, JD.plain);
t('refused: the jd-edit token on the WI draft revision, naming wi-edit', r.status === 403 && /needs the wi-edit grant/.test(r.json?.reason || ''), JSON.stringify(r.json));

console.log('\n── a person approves the WI ──');
markQaReviewed(DBP, rev.id); // QA reviewed it first (D-319)
r = await call('POST', `/documents/${wiDoc.id}/revisions/${rev.id}/approve`, { signature_password: PW }, qa);
t('the QA supervisor approves V3 with their password', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
const after = one('SELECT doc_number, revision, approved_by FROM sop_documents WHERE id = ?', wiDoc.id);
t('WI005 is now "WI 005" at V3, approved by the person', after.revision === 'V3' && after.doc_number === 'WI 005' && after.approved_by === 'Quinn Quality', JSON.stringify(after));

console.log('\n── the audit trail ──');
const rows = q("SELECT actor_id, details FROM audit_log WHERE action = 'bot_sop_write' ORDER BY id").map((x) => JSON.parse(x.details || '{}'));
const wiRows = rows.filter((d) => d.doc_type === 'work_instruction');
const jdRows = rows.filter((d) => d.doc_type === 'job_description');
t('one bot_sop_write row per WI write: create, edit, new revision, edit revision, attach',
  JSON.stringify(wiRows.map((d) => d.kind)) === JSON.stringify(['create_draft', 'edit_draft', 'new_revision', 'edit_revision', 'attach']), JSON.stringify(wiRows.map((d) => d.kind)));
t('…each names the token, the grant wi-edit and the bot', wiRows.every((d) => d.token_label === 'Quality bot (WIs)' && d.token_id === WI.id && d.grant === 'wi-edit' && d.bot_name === '*Quality Bot'), JSON.stringify(wiRows[0]));
t('two rows for the JD writes, with the grant jd-edit', jdRows.length === 2 && jdRows.every((d) => d.grant === 'jd-edit' && d.token_label === 'Quality bot (JDs)'), JSON.stringify(jdRows));
t('no audit row carries the token itself', !q("SELECT details FROM audit_log").some((x) => [SOP, WI, JD].some((k) => (x.details || '').includes(k.plain))));
t('a refused write is logged as api_token_write_blocked with its reason', q("SELECT details FROM audit_log WHERE action = 'api_token_write_blocked'").some((x) => /wi-edit/.test(x.details || '')));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
