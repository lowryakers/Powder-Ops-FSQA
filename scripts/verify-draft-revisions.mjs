// verify:draftrevisions — a revision waiting for approval is seen; its files
// wait with it; a new number moves only on approval (D-304).
//
// A fresh database. On 3 Nov the Quality bot staged new revisions of SOPs
// already in force and attached their signed scans, and nothing showed it:
// the document still read Active, Doc Control Review counted no drafts
// (`draft-documents` counts documents in status draft only), and the scan
// filed under Attachments looked like the current signed copy.
//
//   1. An active SOP with no draft → the "Revisions waiting for approval" pile is 0.
//   2. A V3 draft → the pile is 1, its line says "Draft V3 (in force: 1.0)" and
//      links to the document; draft-documents is unchanged; the list row says
//      draft_revision V3 and status active.
//   3. A signed PDF attached to the draft → "signed PDF attached"; the live
//      Attachments list does not show it as current.
//   4. A token on a non-Document-Control account → 403 on GET /api/doc-review.
//   5. Approve with the password → pile 0, document at V3, no draft_revision,
//      the PDF is now the current signed original.
//   6. Discard a new draft → pile 0; its file is not on the live document.
//   7. (The control: this script on 604b8de fails at step 2.)
//   8. A withdrawn document carrying a draft revision is not counted.
//   + a document number staged on a draft does not move until approval, moves
//     on approval, and a number another document holds is refused (409).
//   + the bot may pass revision_id and doc_number; it still cannot approve.
//
// Caller sets PORT + DBPATH and the S3 stand-in (verify-all does).
import Database from 'better-sqlite3';
import { markQaReviewed, fileApprovedDoc } from './lib/qa-review-fixture.mjs';

const PORT = Number(process.env.PORT || 5184);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'DraftRev2026!!';

// File a document into force the D-321 way: draft → QA review marked → approved with a password.
const fileDoc = async (body, tok) => ({ status: 201, json: await fileApprovedDoc((m, p, b) => call(m, p, b, tok), DBP, { signature_password: PW, ...body }) });
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  const mk = (id, name, role, dept, ma = null) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
  mk('dv-admin', 'Ada Admin', 'admin', 'admin');
  mk('dv-dc', 'Dana Control', 'operator', 'document_control', { sops: 'edit' });
  mk('dv-bot', '*Quality Bot', 'operator', 'qa', { sops: 'edit' });
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
const admin = await signIn('dv-admin', 'Ada Admin');
const dc = await signIn('dv-dc', 'Dana Control');
t('an admin and Document Control signed in', !!admin && !!dc);

// Test tokens on this throwaway database only.
const mint = async (user, label, grants = []) => {
  const r = await call('POST', '/api-tokens', { user_id: user, label, scopes: ['read', 'write'] }, admin);
  const id = r.json?.token?.id;
  if (grants.length) await call('POST', `/api-tokens/${id}/grants`, { grants }, admin);
  return r.json?.plaintext;
};
const BOT = await mint('dv-bot', 'Quality bot', ['sops-edit']);
t('a test token for the bot on the fresh database', !!BOT);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const pdfForm = (name, fields = {}) => {
  const fd = new FormData();
  fd.append('files', new Blob([PDF], { type: 'application/pdf' }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const review = async () => (await call('GET', '/doc-review', null, dc)).json?.sources || [];
const pile = async (key) => (await review()).find(s => s.key === key);
const listRow = async (id) => ((await call('GET', '/documents?doc_type=sop', null, dc)).json || []).find(d => d.id === id);
const files = async (id) => (await call('GET', `/documents/${id}/attachments`, null, dc)).json || [];

// ── 1 ──
console.log('\n── 1. an active SOP, nothing staged ──');
let r = await fileDoc({ doc_type: 'sop', doc_number: 'SOP-T1', title: 'Test Procedure', category: 'quality',
  revision: '1.0', content: 'Version one.' }, admin);
const doc = r.json;
t('SOP-T1 is active at rev 1.0', r.status === 201 && doc?.status === 'active' && doc?.revision === '1.0', `${r.status} ${r.json?.error}`);
let src = await pile('draft-revisions');
t('step 1: "Revisions waiting for approval" exists and reads 0', src && src.count === 0, JSON.stringify(src && { count: src.count }));
const draftDocsBefore = (await pile('draft-documents'))?.count;

// ── 2 ──
console.log('\n── 2. a V3 draft is staged ──');
r = await call('POST', `/documents/${doc.id}/revisions`, { revision: 'V3', change_summary: 'Annual update' }, dc);
const draft = r.json?.draft || r.json;
t('a V3 draft revision is started', r.status === 201 && draft?.id && draft?.status === 'draft', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
src = await pile('draft-revisions');
const item = src?.items?.find(i => i.id === draft?.id);
t('step 2: the pile reads 1', src?.count === 1, `count ${src?.count}`);
t('step 2: its line says "Draft V3 (in force: 1.0)"', item?.subtitle?.includes('Draft V3 (in force: 1.0)'), item?.subtitle);
t('step 2: it links to the document on the SOPs tab', item?.link?.endsWith(`?tab=sops&doc=${doc.id}`), item?.link);
t('step 2: the title names the document', item?.title === 'SOP-T1 — Test Procedure', item?.title);
t('step 2: draft-documents is unchanged', (await pile('draft-documents'))?.count === draftDocsBefore);
let row = await listRow(doc.id);
t('step 2: the list row says draft_revision V3 and status active', row?.draft_revision === 'V3' && row?.status === 'active', JSON.stringify(row && { d: row.draft_revision, s: row.status }));
r = await call('GET', `/documents/${doc.id}`, null, dc);
t('step 2: the document in force is still rev 1.0', r.json?.revision === '1.0');
const cons = (await call('GET', '/doc-review/consistency', null, dc)).json;
const consSec = cons?.sections?.find(s => s.key === 'draft_revisions');
t('the consistency review lists it under "Revision drafts not yet approved"', consSec?.items?.some(i => i.id === doc.id && i.draft_revision === 'V3'), JSON.stringify(consSec).slice(0, 200));
const notes = (await call('GET', '/compliance/notifications', null, dc)).json;
t('Doc Control Review carries a badge of 1', notes?.badges?.['doc-review'] === 1, JSON.stringify(notes?.badges?.['doc-review']));

// ── 3 ──
console.log('\n── 3. the signed PDF is filed against the draft ──');
r = await call('POST', `/documents/${doc.id}/attachments`, null, dc, pdfForm('SOP-T1_V3_signed.pdf', { kind: 'signed_original', revision_id: draft.id }));
t('attached against the draft', r.status === 201 && r.json?.[0]?.state === 'draft', `${r.status} ${JSON.stringify(r.json)}`);
const v3File = r.json?.[0]?.id;
src = await pile('draft-revisions');
t('step 3: the line says "signed PDF attached"', src?.items?.[0]?.subtitle?.includes('signed PDF attached'), src?.items?.[0]?.subtitle);
let list = await files(doc.id);
let f = list.find(x => x.id === v3File);
t('step 3: the file reads state "draft", label V3 by default', f?.state === 'draft' && f?.revision === 'V3' && f?.draft_label === 'V3', JSON.stringify(f));
t('step 3: it is not a current attachment of the live document', !list.some(x => x.id === v3File && x.state === 'current'));
r = await call('POST', `/documents/${doc.id}/attachments`, null, dc, pdfForm('x.pdf', { kind: 'signed_original', revision_id: 'not-a-draft' }));
t('a revision_id that is not an open draft of this document is 400 NOT_A_DRAFT', r.status === 400 && r.json?.code === 'NOT_A_DRAFT', JSON.stringify(r.json));

// ── 4 ──
console.log('\n── 4. who may read the queue ──');
r = await call('GET', '/doc-review', null, BOT);
t('step 4: a token on a non-Document-Control account gets 403', r.status === 403, `${r.status}`);

// ── document number staged on the draft ──
console.log('\n── + a document number staged on the draft ──');
r = await fileDoc({ doc_type: 'sop', doc_number: 'SOP-T9', title: 'Another Procedure', category: 'quality',
  revision: '2.0', content: 'Other.' }, admin);
const other = r.json;
r = await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { doc_number: 'SOP-T9' }, dc);
t('a number another document holds is refused, naming it', r.status === 409 && r.json?.code === 'DOC_NUMBER_USED' && /Another Procedure|SOP-T9/.test(r.json?.error || ''), JSON.stringify(r.json));
r = await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { doc_number: 'SOP T 9' }, dc);
t('the same number written another way is refused too', r.status === 409 && r.json?.code === 'DOC_NUMBER_USED', JSON.stringify(r.json));
// The bot stages the number (D-303 token, D-304 key).
r = await call('PUT', `/documents/${doc.id}/revisions/${draft.id}`, { doc_number: 'SOP-T5' }, BOT);
t('the bot stages a new number on the draft', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('GET', `/documents/${doc.id}`, null, dc);
t('the document keeps SOP-T1 before approval', r.json?.doc_number === 'SOP-T1', r.json?.doc_number);
src = await pile('draft-revisions');
t('the queue line shows the number change', src?.items?.[0]?.subtitle?.includes('number SOP-T1 → SOP-T5'), src?.items?.[0]?.subtitle);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, {}, BOT);
t('the bot cannot approve the draft', r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);

// ── 5 ──
console.log('\n── 5. a person approves with the password ──');
markQaReviewed(DBP, draft.id); // QA reviewed it first (D-319)
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, {}, dc);
t('approving without the password is refused', r.status === 403 && r.json?.signature_required, `${r.status}`);
r = await call('POST', `/documents/${doc.id}/revisions/${draft.id}/approve`, { signature_password: PW }, dc);
t('approved with the password', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t('step 5: the pile reads 0', (await pile('draft-revisions'))?.count === 0);
r = await call('GET', `/documents/${doc.id}`, null, dc);
t('step 5: the document is at V3', r.json?.revision === 'V3', r.json?.revision);
t('the staged number moved on approval: SOP-T5', r.json?.doc_number === 'SOP-T5', r.json?.doc_number);
row = await listRow(doc.id);
t('step 5: draft_revision is null', row && row.draft_revision == null, JSON.stringify(row?.draft_revision));
list = await files(doc.id);
f = list.find(x => x.id === v3File);
t('step 5: the PDF is now the current signed original', f?.state === 'current' && f?.kind === 'signed_original', JSON.stringify(f));
const audit = q("SELECT details FROM audit_log WHERE entity_id = ? AND action LIKE '%approve%' ORDER BY rowid DESC LIMIT 1", draft.id)[0]
  || q("SELECT details FROM audit_log WHERE details LIKE ? ORDER BY rowid DESC LIMIT 1", '%to_doc_number%')[0];
t('the approval audit names the number change', /SOP-T1/.test(audit?.details || '') && /SOP-T5/.test(audit?.details || ''), audit?.details?.slice(0, 200));

// ── 6 ──
console.log('\n── 6. a new draft is discarded ──');
r = await call('POST', `/documents/${doc.id}/revisions`, { revision: 'V4' }, BOT);
const d4 = r.json?.draft || r.json;
t('the bot starts V4', r.status === 201 && d4?.id, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
r = await call('POST', `/documents/${doc.id}/attachments`, null, BOT, pdfForm('SOP-T5_V4_signed.pdf', { kind: 'signed_original', revision_id: d4.id }));
t('the bot attaches the scan to the V4 draft (revision_id)', r.status === 201 && r.json?.[0]?.state === 'draft', `${r.status} ${JSON.stringify(r.json)}`);
const v4File = r.json?.[0]?.id;
const botAudit = q("SELECT details FROM audit_log WHERE action = 'bot_sop_write' AND details LIKE ? ORDER BY rowid DESC LIMIT 1", '%"attach"%')[0];
t("the bot's audit row names the draft", (botAudit?.details || '').includes(d4.id), botAudit?.details?.slice(0, 200));
t('the pile reads 1 again', (await pile('draft-revisions'))?.count === 1);
r = await call('DELETE', `/documents/${doc.id}/revisions/${d4.id}`, { reason: 'Started by mistake' }, dc);
t('the V4 draft is discarded', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
t('step 6: the pile reads 0', (await pile('draft-revisions'))?.count === 0);
list = await files(doc.id);
f = list.find(x => x.id === v4File);
t('step 6: its file is kept but not on the live document (state discarded)', f?.state === 'discarded' && f?.discarded_revision === 'V4', JSON.stringify(f));
t('the V3 file is still the current signed original', list.find(x => x.id === v3File)?.state === 'current');
r = await call('GET', '/documents/' + doc.id + '/revisions', null, dc);
t('a new draft is offered V4 again, the discarded file does not hold the number', r.json?.suggested_revision === 'V4', r.json?.suggested_revision);

// ── 8 ──
console.log('\n── 8. a withdrawn document is not waiting on anybody ──');
r = await call('POST', `/documents/${other.id}/revisions`, { revision: '3.0' }, dc);
t('a draft on SOP-T9', r.status === 201);
t('counted while SOP-T9 is in force', (await pile('draft-revisions'))?.count === 1);
r = await call('DELETE', `/documents/${other.id}`, { reason: 'No longer used' }, admin);
t('SOP-T9 withdrawn', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
t('step 8: its draft is not counted', (await pile('draft-revisions'))?.count === 0);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
