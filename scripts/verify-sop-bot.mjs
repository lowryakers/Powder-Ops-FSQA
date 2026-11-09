// verify:sopbot — the Quality bot stages SOP work; owners approve (D-303).
//
// A fresh database. The Quality bot (operator, QA, SOPs edit) holds write
// tokens with the `sops-edit` grant. It may: file a draft SOP, edit a draft
// SOP, start and edit a new revision of an approved SOP, attach a PDF. It may
// never approve, sign, make effective, delete, withdraw, reinstate or use a
// bulk route. A QA supervisor approves with their password. Every successful
// bot write has one `bot_sop_write` audit row; a person's write has none.
//
// Several tokens on the same account so the 20-writes-a-minute bucket is not
// spent by the scenarios themselves; one token is spent on purpose to show the
// bot is paced, not exempted.
//
// Caller sets PORT + DBPATH and the S3 stand-in (verify-all does).
// Control: run against `main` before D-303 (only this script copied in). The
// first bot call with the grant — POST /api/documents/:id/revisions — is
// 403 token_denied / not_open_to_tokens, the exact refusal Quality hit on
// 3 Nov, and the run fails from there.
import Database from 'better-sqlite3';
import { markQaReviewed, fileApprovedDoc } from './lib/qa-review-fixture.mjs';

const PORT = Number(process.env.PORT || 5183);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
const PW = 'SopBot2026!!';

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
  mk('sb-admin', 'Ada Admin', 'admin', 'admin');
  mk('sb-qa', 'Quinn Quality', 'supervisor', 'qa', { sops: 'edit' });
  mk('sb-bot', '*Quality Bot', 'operator', 'qa', { sops: 'edit' });
  mk('sb-bot2', '*Other Bot', 'operator', 'qa', { sops: 'edit' });
  mk('sb-view', '*Viewer Bot', 'operator', 'qa', { sops: 'view' });
  db.close();
}

const call = async (m, p, b, tok, form) => {
  const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${URL}/api${p}`, { method: m, headers, body: form || (b ? JSON.stringify(b) : undefined) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json, retryAfter: r.headers.get('retry-after') };
};
const signIn = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const admin = await signIn('sb-admin', 'Ada Admin');
const qa = await signIn('sb-qa', 'Quinn Quality');
t('an admin and a QA supervisor signed in', !!admin && !!qa);

// Test tokens on this throwaway database only, minted by its own test admin.
const mint = async (user, label, scopes, grants = []) => {
  const r = await call('POST', '/api-tokens', { user_id: user, label, scopes }, admin);
  const id = r.json?.token?.id; const plain = r.json?.plaintext;
  if (grants.length) await call('POST', `/api-tokens/${id}/grants`, { grants }, admin);
  return { id, plain };
};
const A = await mint('sb-bot', 'Quality bot', ['read', 'write'], ['sops-edit']);
const B = await mint('sb-bot', 'Quality bot', ['read', 'write'], ['sops-edit']);
const C = await mint('sb-bot', 'Quality bot', ['read', 'write'], ['sops-edit']);
const D = await mint('sb-bot', 'Quality bot', ['read', 'write'], ['sops-edit']);
const NOGRANT = await mint('sb-bot2', 'Other bot', ['read', 'write']);
const VIEW = await mint('sb-view', 'Viewer bot', ['read', 'write'], ['sops-edit']);
const READ = await mint('sb-bot', 'Quality bot (read)', ['read']);
t('test tokens minted on the fresh database', [A, B, C, D, NOGRANT, VIEW, READ].every((x) => x.plain && x.id));

// Documents a person filed: SOP-202 approved at V2, a draft SOP, a draft WI.
let r = await fileDoc({ doc_type: 'sop', doc_number: 'SOP-202', title: 'Glass and Brittle Plastic', category: 'quality',
  revision: 'V2', content: 'Version two text.' }, admin);
const active = r.json;
t('SOP-202 is approved at V2 (a person, with a password)', r.status === 201 && active?.status === 'active' && active?.revision === 'V2', `${r.status} ${r.json?.error}`);
r = await call('POST', '/documents', { doc_type: 'sop', doc_number: 'SOP 435', title: 'Draft SOP', category: 'quality', revision: 'V1', content: 'Draft text.' }, admin);
const draft = r.json;
r = await call('POST', '/documents', { doc_type: 'work_instruction', doc_number: 'WI 901', title: 'A work instruction', category: 'production', content: 'WI.' }, admin);
const wi = r.json;
t('a draft SOP and a draft work instruction on file', draft?.status === 'draft' && wi?.doc_type === 'work_instruction');

console.log('\n── who gets through the door ──');
r = await call('POST', `/documents/${active.id}/revisions`, { revision: 'V3' }, NOGRANT.plain);
t('without the grant: 403 token_denied / not_open_to_tokens (the 3 Nov refusal)', r.status === 403 && r.json?.error === 'token_denied' && r.json?.category === 'not_open_to_tokens', JSON.stringify(r.json));
r = await call('POST', `/documents/${active.id}/revisions`, { revision: 'V3' }, VIEW.plain);
t('with the grant, account on SOPs view: refused by the module check, not the token door', r.status === 403 && r.json?.error !== 'token_denied', JSON.stringify(r.json));
r = await call('POST', `/documents/${active.id}/revisions`, { revision: 'V3' }, READ.plain);
t('a read-only token: 403 token_scope', r.status === 403 && r.json?.error === 'token_scope', JSON.stringify(r.json));
t('…and none of the three wrote a revision', one('SELECT COUNT(*) c FROM document_revisions WHERE document_id = ? AND status = \'draft\'', active.id).c === 0);

console.log('\n── create a draft SOP ──');
r = await call('POST', '/documents', { doc_number: 'SOP 429', title: 'Allergen Changeover', category: 'quality', revision: 'V1', effective_date: '2026-10-21', content: 'New SOP text.' }, A.plain);
const created = r.json;
t('201, filed as a draft with no approver', r.status === 201 && created?.status === 'draft' && created?.approved_by == null && created?.doc_type === 'sop', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
for (const [n, body] of [['status active', { status: 'active' }], ['status under_review', { status: 'under_review' }], ['an approver named', { approved_by: 'Quinn Quality' }]]) {
  r = await call('POST', '/documents', { title: 'X', category: 'quality', ...body }, A.plain);
  t(`refused with ${n}: approve_requires_human_session`, r.status === 403 && r.json?.error === 'approve_requires_human_session', JSON.stringify(r.json));
}
r = await call('POST', '/documents', { title: 'X', category: 'quality', doc_type: 'work_instruction' }, A.plain);
t('refused for a work instruction, saying why', r.status === 403 && r.json?.error === 'token_denied' && /SOPs only/.test(r.json?.reason || ''), JSON.stringify(r.json));

console.log('\n── edit a draft SOP ──');
const versionsBefore = one('SELECT COUNT(*) c FROM sop_versions WHERE sop_id = ?', draft.id).c;
r = await call('PUT', `/documents/${draft.id}`, { revision: 'V2', title: 'Draft SOP, corrected', doc_number: 'SOP 435A', effective_date: '2026-10-15', content: 'Corrected draft text.', _change_summary: 'From the signed scan' }, A.plain);
t('PUT on a draft SOP works', r.status === 200 && r.json?.title === 'Draft SOP, corrected' && r.json?.doc_number === 'SOP 435A' && r.json?.status === 'draft', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
t('…and writes a version row', one('SELECT COUNT(*) c FROM sop_versions WHERE sop_id = ?', draft.id).c === versionsBefore + 1);
const activeRow = () => one('SELECT revision, description, status, approved_by, approved_at, doc_number, title FROM sop_documents WHERE id = ?', active.id);
const activeBefore = JSON.stringify(activeRow());
r = await call('PUT', `/documents/${active.id}`, { title: 'Renamed' }, A.plain);
t('PUT on an ACTIVE SOP is refused, saying to start a revision', r.status === 403 && /revision/.test(r.json?.reason || ''), JSON.stringify(r.json));
r = await call('PUT', `/documents/${draft.id}`, { status: 'active' }, A.plain);
t('PUT moving a draft to active is refused (approve guard)', r.status === 403 && r.json?.error === 'approve_requires_human_session', JSON.stringify(r.json));
r = await call('PUT', `/documents/${draft.id}`, { approved_by: 'Quinn Quality' }, A.plain);
t('PUT naming an approver is refused', r.status === 403, JSON.stringify(r.json));
r = await call('PUT', `/documents/${draft.id}`, { equipment_ids: ['e1'] }, A.plain);
t('PUT with a field not on the list is refused, naming it', r.status === 403 && /equipment_ids/.test(r.json?.reason || ''), JSON.stringify(r.json));
t('the draft is still a draft and the active SOP is untouched', one('SELECT status FROM sop_documents WHERE id = ?', draft.id).status === 'draft' && JSON.stringify(activeRow()) === activeBefore);

console.log('\n── a new revision of SOP-202 ──');
r = await call('POST', `/documents/${active.id}/revisions`, { revision: 'V3', change_summary: 'From the signed scan of 21 Oct' }, B.plain);
const rev = r.json;
t('POST on the active SOP returns a draft revision', r.status === 201 && rev?.status === 'draft', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
r = await call('PUT', `/documents/${active.id}/revisions/${rev?.id}`, { revision: 'V3', effective_date: '2026-10-21', title: 'Glass and Brittle Plastic Control', description: 'Version three text.' }, B.plain);
t('PUT sets V3, its date, title and text', r.status === 200 && r.json?.revision === 'V3' && r.json?.effective_date === '2026-10-21' && r.json?.description === 'Version three text.', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
t('the SOP in force is UNCHANGED until a person approves', JSON.stringify(activeRow()) === activeBefore, JSON.stringify(activeRow()));
r = await call('POST', `/documents/${draft.id}/revisions`, { revision: 'V2' }, B.plain);
t('a revision of a DRAFT SOP is refused by the handler (409)', r.status === 409, JSON.stringify(r.json));
r = await call('POST', `/documents/${active.id}/revisions`, { revision: 'V4' }, B.plain);
t('a second revision while one is open is 409', r.status === 409, JSON.stringify(r.json));

console.log('\n── attach the signed scan ──');
const MARK = 'BOT-SOP-SCAN-TEXT-7f3a';
const PDF = Buffer.from(`%PDF-1.4\n% ${MARK}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const form = (files, fields = { kind: 'signed_original', revision: 'V3' }) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [name, type, bytes] of files) f.append('files', new Blob([bytes], { type }), name);
  return f;
};
const attachCount = () => one('SELECT COUNT(*) c FROM document_attachments').c;
r = await call('POST', `/documents/${active.id}/attachments`, null, B.plain, form([['SOP-202_V3_signed.pdf', 'application/pdf', PDF]]));
t('a PDF attaches to the active SOP', r.status === 201 && r.json?.[0]?.kind === 'signed_original', `${r.status} ${JSON.stringify(r.json)}`);
r = await call('POST', `/documents/${draft.id}/attachments`, null, B.plain, form([['SOP-435_signed.pdf', 'application/pdf', PDF]], { kind: 'attachment' }));
t('a PDF attaches to a draft SOP', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
r = await call('GET', `/documents/${active.id}/attachments`, null, admin);
t('it is listed on the SOP, with its revision', (r.json || []).some((a) => a.filename === 'SOP-202_V3_signed.pdf' && a.revision === 'V3' && a.kind === 'signed_original'), JSON.stringify(r.json).slice(0, 200));
const before = attachCount();
for (const [n, files] of [
  ['an .exe', [['tool.exe', 'application/octet-stream', Buffer.from('MZ....')]]],
  ['an .html', [['page.html', 'text/html', Buffer.from('<script>1</script>')]]],
  ['a .docx', [['sop.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from([0x50, 0x4b, 3, 4, 0, 0])]]],
  ['a .pdf whose bytes are HTML', [['fake.pdf', 'application/pdf', Buffer.from('<html>not a pdf</html>')]]],
  ['a PDF declared as text/plain', [['scan.pdf', 'text/plain', PDF]]],
]) {
  r = await call('POST', `/documents/${active.id}/attachments`, null, B.plain, form(files));
  t(`${n} is 415, naming the file`, r.status === 415 && r.json?.message?.includes(files[0][0]), `${r.status} ${JSON.stringify(r.json)}`);
}
r = await call('POST', `/documents/${active.id}/attachments`, null, B.plain, form([['ok.pdf', 'application/pdf', PDF], ['bad.html', 'text/html', Buffer.from('<p>')]]));
t('a batch with one refused file is 415', r.status === 415);
const eleven = Array.from({ length: 11 }, (_, i) => [`p${i}.pdf`, 'application/pdf', PDF]);
r = await call('POST', `/documents/${active.id}/attachments`, null, B.plain, form(eleven));
t('11 files are refused', r.status >= 400, String(r.status));
t('…and none of the refused uploads stored anything', attachCount() === before, `${attachCount()} vs ${before}`);

console.log('\n── never, with the same grant ──');
const revRow = () => JSON.stringify(one('SELECT status, revision, description FROM document_revisions WHERE id = ?', rev.id));
const attId = one('SELECT id FROM document_attachments WHERE document_id = ? LIMIT 1', active.id)?.id;
const snap = () => JSON.stringify([activeRow(), revRow(), one('SELECT status FROM sop_documents WHERE id = ?', draft.id), attachCount()]);
const snapBefore = snap();
for (const [n, m, p, b] of [
  ['approve the revision', 'POST', `/documents/${active.id}/revisions/${rev.id}/approve`, { signature_password: PW }],
  ['apply a revision', 'POST', `/documents/${active.id}/apply-revision`, { revision: 'V3' }],
  ['apply a worklist item', 'POST', '/documents/revisions/items/x/apply', {}],
  ['sign', 'POST', `/documents/${active.id}/sign`, {}],
  ['withdraw (DELETE the document)', 'DELETE', `/documents/${active.id}`, { reason: 'bot' }],
  ['DELETE the revision', 'DELETE', `/documents/${active.id}/revisions/${rev.id}`, { reason: 'bot' }],
  ['DELETE an attachment', 'DELETE', `/documents/attachments/${attId}`, {}],
  ['reinstate', 'POST', `/documents/${active.id}/reinstate`, {}],
  ['bulk', 'POST', '/documents/bulk', { ids: [draft.id] }],
  ['bulk-update', 'POST', '/documents/bulk-update', { ids: [draft.id], status: 'active' }],
  ['bulk-delete', 'POST', '/documents/bulk-delete', { ids: [draft.id] }],
  ['attachments/bulk', 'POST', '/documents/attachments/bulk', {}],
  ['a status move to active through PUT', 'PUT', `/documents/${draft.id}`, { status: 'active' }],
]) {
  r = await call(m, p, b, C.plain);
  t(`refused: ${n}`, r.status === 403 && ['token_denied', 'approve_requires_human_session'].includes(r.json?.error), `${r.status} ${JSON.stringify(r.json)}`);
}
t('…and nothing moved', snap() === snapBefore, `${snap()} vs ${snapBefore}`);

console.log('\n── a person approves ──');
markQaReviewed(DBP, rev.id); // QA reviewed it first (D-319)
r = await call('POST', `/documents/${active.id}/revisions/${rev.id}/approve`, { signature_password: PW }, qa);
t('the QA supervisor approves V3 with their password', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
const after = activeRow();
t('SOP-202 is now V3 with the new text, approved by the person, never the bot', after.revision === 'V3' && after.description === 'Version three text.'
  && after.approved_by === 'Quinn Quality' && after.status === 'active', JSON.stringify(after));
r = await call('PUT', `/documents/${draft.id}`, { title: 'A person edits the draft' }, qa);
t('a person edits a draft SOP', r.status === 200);

console.log('\n── the audit trail ──');
const rows = q("SELECT actor, actor_id, entity_type, entity_id, entity_label, details FROM audit_log WHERE action = 'bot_sop_write' ORDER BY id").map((x) => ({ ...x, d: JSON.parse(x.details || '{}') }));
const kinds = rows.map((x) => x.d.kind);
t('one bot_sop_write row per successful write: create, edit, new revision, edit revision, 2 attaches', JSON.stringify(kinds) === JSON.stringify(['create_draft', 'edit_draft', 'new_revision', 'edit_revision', 'attach', 'attach']), JSON.stringify(kinds));
t('…each naming the token (id, prefix, label) and the bot', rows.every((x) => x.d.token_id && x.d.token_prefix && x.d.token_label === 'Quality bot' && x.d.bot_name === '*Quality Bot' && x.actor_id === 'sb-bot'));
t('…and the document, method and path', rows.every((x) => x.d.document_id && x.d.method && x.d.path?.startsWith('/api/documents')));
t('a revision row is entity document_revision; a create is entity document, labelled with number and title',
  rows[2]?.entity_type === 'document_revision' && rows[0]?.entity_type === 'document' && rows[0]?.entity_label === 'SOP 429 Allergen Changeover');
t('the edit names the fields it changed, by name only', ['revision', 'title', 'doc_number', 'effective_date', 'content'].every((k) => rows[1]?.d.fields_changed?.includes(k)), JSON.stringify(rows[1]?.d.fields_changed));
t('an attach carries filename, size, sha256 and type', rows[4]?.d.filename === 'SOP-202_V3_signed.pdf' && rows[4]?.d.size_bytes === PDF.length
  && /^[0-9a-f]{64}$/.test(rows[4]?.d.sha256 || '') && rows[4]?.d.content_type === 'application/pdf', JSON.stringify(rows[4]?.d));
t('a person\'s write produced no bot_sop_write row', rows.every((x) => x.actor_id === 'sb-bot'));
const blocked = q("SELECT details FROM audit_log WHERE action = 'api_token_write_blocked'").map((x) => JSON.parse(x.details || '{}'));
t('a condition refusal is logged as api_token_write_blocked, with its reason', blocked.some((d) => /revision/.test(d.rule || '') && /documents/.test(d.path || '')), JSON.stringify(blocked.slice(-3)));
t('an approval attempt is logged as api_token_approve_blocked', one("SELECT COUNT(*) c FROM audit_log WHERE action = 'api_token_approve_blocked'").c > 0);
const viaLabel = q("SELECT details FROM audit_log WHERE action = 'create' AND entity_type = 'document' AND details LIKE '%via_token%'").map((x) => JSON.parse(x.details).via_token);
t('a handler\'s own audit entry names the token label in via_token', viaLabel.some((v) => v?.label === 'Quality bot'), JSON.stringify(viaLabel));
const all = q('SELECT details, entity_label FROM audit_log').map((x) => `${x.details || ''} ${x.entity_label || ''}`).join('\n');
t('no audit row holds a token or the file\'s text', ![A, B, C, D, NOGRANT, VIEW, READ].some((x) => all.includes(x.plain)) && !all.includes(MARK));

console.log('\n── the bot is paced, not exempted ──');
let limited = null;
for (let i = 0; i < 22 && !limited; i++) {
  r = await call('PUT', `/documents/${active.id}`, { title: 'x' }, D.plain);
  if (r.status === 429) limited = r;
}
t('the 21st write in a minute is 429 with Retry-After', !!limited && Number(limited.retryAfter) > 0, limited ? `${limited.status} ${limited.retryAfter}` : 'never limited');

console.log('\n── whoami ──');
r = await call('GET', '/bot/whoami', null, A.plain);
t('whoami lists the token\'s grants and the account\'s SOPs access', (r.json?.grants || []).includes('sops-edit') && r.json?.user?.module_access?.sops === 'edit', JSON.stringify(r.json?.grants));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
