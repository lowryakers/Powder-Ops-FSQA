// verify:docqareview — a controlled document's three verifications (D-319).
//
// The owner wrote it, a QA supervisor reviewed it with their password, Document
// Control approved it with theirs. Boots its own server on a fresh database
// (DOCQA_PORT) and drives the real routes:
//   1. Approval is refused until QA has reviewed the draft.
//   2. QA review is a QA supervisor's: an operator in QA, Document Control and a
//      bot account are refused; the document's owner is refused; the password is asked.
//   3. An edit to the text takes the review off; a new revision number does not.
//   4. The reviewer cannot also approve; the reviewer (or an admin) can withdraw it.
//   5. The approved revision keeps the review, QA Review lists the waiting draft,
//      and the PDF header prints Owner, QA Review and Approved By.
// Control: main before D-319 — the approval goes through with no QA review at all.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DOCQA_PORT || 5203);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'readydoc-docqa-'));
const dbPath = path.join(dir, 'docqa.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

let child = null; const out = [];
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); console.error(`Port ${PORT} is already serving. Set DOCQA_PORT.`); process.exit(1); } catch { /* free */ }
child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test', SIGNATURE_NAME_OPTIONAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* booting */ } if (!up) await sleep(500); }
if (!up) { console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n')); process.exit(1); }

const PW = 'Pass-word-2026';
const hashOf = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const ACCESS = '{"sops":"edit","work-instructions":"edit","job-descriptions":"edit"}';
const DOC_ID = crypto.randomUUID();
{
  const db = new Database(dbPath);
  const user = (id, name, role, dept) => db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, password_changed_at, module_access)
    VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), ?)`).run(id, name, name, role, dept, hashOf(PW), ACCESS);
  user('qa-sup', 'Quinn Assurance', 'supervisor', 'qa');      // reviews
  user('qa-op', 'Opal Tech', 'operator', 'qa');               // in QA, not a supervisor
  user('qa-owner', 'Carla Owner', 'supervisor', 'quality');   // owns the document
  user('dc', 'Dana Control', 'supervisor', 'document_control'); // approves
  user('adm', 'Ada Admin', 'admin', 'office');
  user('bot', '*Quality Bot', 'supervisor', 'qa');            // a bot account, whatever its department
  db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, status, owner, description, approved_by, approved_at)
    VALUES (?, 'sop', 'SOP-106', 'Humidity Temperature Control and Lighting', 'quality', 'V3', 'active', 'Carla Owner', ?, 'Dana Control', datetime('now'))`)
    .run(DOC_ID, '## 1.0 Purpose\nIn-force V3 text.');
  db.close();
}
const tok = {};
for (const name of ['Quinn Assurance', 'Opal Tech', 'Carla Owner', 'Dana Control', 'Ada Admin', '*Quality Bot']) {
  tok[name] = (await (await fetch(`${BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: PW }) })).json()).token;
}
const call = async (m, p, body, who) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
t('signed in as all six', Object.values(tok).every(Boolean));

console.log('\n── 1. no approval before QA review ──');
let r = await call('POST', `/documents/${DOC_ID}/revisions`, { revision: 'V4' }, 'Dana Control');
const draft = r.json;
t('Document Control starts draft V4', r.status === 201 && draft?.revision === 'V4', `${r.status} ${r.json?.error}`);
await call('PUT', `/documents/${DOC_ID}/revisions/${draft.id}`, { description: '## 1.0 Purpose\nNew V4 text.' }, 'Dana Control');
r = await call('POST', `/documents/${DOC_ID}/revisions/${draft.id}/approve`, { signature_password: PW }, 'Dana Control');
t('approving is refused: QA has not reviewed it', r.status === 409 && r.json?.code === 'QA_REVIEW_REQUIRED', `${r.status} ${r.json?.code}`);
t('…and SOP-106 is still V3', one('SELECT revision FROM sop_documents WHERE id = ?', DOC_ID).revision === 'V3');
r = await call('GET', `/documents/${DOC_ID}/revisions`, null, 'Quinn Assurance');
t('the QA supervisor is offered QA review; the draft reads not reviewed', r.json?.can_qa_review === true && r.json?.draft?.qa_review_state === null);
r = await call('GET', `/documents/${DOC_ID}/revisions`, null, 'Dana Control');
t('Document Control is not offered QA review', r.json?.can_qa_review === false);
r = await call('GET', '/qa-review?source=doc-qa-review', null, 'Ada Admin');
const src = (r.json?.sources || []).find(s => s.key === 'doc-qa-review');
t('QA Review lists the draft waiting for QA', src?.count === 1 && (src?.items || []).some(i => i.id === draft.id && i.link?.doc === DOC_ID), JSON.stringify(src));

console.log('\n── 2. who may give QA review ──');
const QA = `/documents/${DOC_ID}/revisions/${draft.id}/qa-signoff`;
r = await call('POST', QA, { signature_password: PW }, 'Opal Tech');
t('an operator in QA is refused', r.status === 403 && r.json?.code === 'QA_REVIEW_NOT_ALLOWED', `${r.status}`);
r = await call('POST', QA, { signature_password: PW }, 'Dana Control');
t('Document Control is refused', r.status === 403, `${r.status}`);
r = await call('POST', QA, { signature_password: PW }, '*Quality Bot');
t('a bot account is refused, whatever its department', r.status === 403 && /bot/.test(r.json?.code || r.json?.error || ''), `${r.status} ${r.json?.code}`);
r = await call('POST', QA, { signature_password: PW }, 'Carla Owner');
t('the document\'s owner is refused — somebody else in Quality reviews it', r.status === 409 && r.json?.code === 'QA_REVIEW_OWNER', `${r.status} ${r.json?.code}`);
r = await call('POST', QA, {}, 'Quinn Assurance');
t('the QA supervisor is asked for the password', r.status === 403 && r.json?.signature_required === true, `${r.status}`);
r = await call('POST', QA, { signature_password: 'wrong-password-x' }, 'Quinn Assurance');
t('a wrong password records nothing', r.status === 403 && !one('SELECT qa_reviewed_at FROM document_revisions WHERE id = ?', draft.id).qa_reviewed_at);
r = await call('POST', QA, { signature_password: PW }, 'Quinn Assurance');
t('with the password, QA review is recorded', r.status === 200 && r.json?.qa_reviewed_by === 'Quinn Assurance' && r.json?.qa_review_state === 'signed', `${r.status} ${r.json?.error}`);
const aud = one("SELECT details FROM audit_log WHERE entity_type = 'document_revision' AND entity_id = ? AND action = 'sign' ORDER BY rowid DESC LIMIT 1", draft.id);
t('…audited as a signature, with its meaning and the password check', /qa_review/.test(aud?.details || '') && /Reviewed and accepted by Quality/.test(aud?.details || '') && /signature_verified/.test(aud?.details || ''));
r = await call('POST', QA, { signature_password: PW }, 'Quinn Assurance');
t('it is given once', r.status === 409 && r.json?.code === 'QA_REVIEW_DONE');
r = await call('GET', '/qa-review?source=doc-qa-review', null, 'Ada Admin');
t('…and the draft leaves QA Review', ((r.json?.sources || []).find(s => s.key === 'doc-qa-review'))?.count === 0);

console.log('\n── 3. what takes the review off ──');
r = await call('PUT', `/documents/${DOC_ID}/revisions/${draft.id}`, { revision: 'V5' }, 'Dana Control');
t('a new revision number keeps the review (that is Document Control\'s)', r.status === 200 && r.json?.qa_reviewed_by === 'Quinn Assurance');
await call('PUT', `/documents/${DOC_ID}/revisions/${draft.id}`, { revision: 'V4' }, 'Dana Control');
r = await call('PUT', `/documents/${DOC_ID}/revisions/${draft.id}`, { description: '## 1.0 Purpose\nNew V4 text, edited after review.' }, 'Dana Control');
t('an edit to the text takes the review off', r.status === 200 && !r.json?.qa_reviewed_at);
t('…and the edit\'s audit entry says so', /qa_review_cleared/.test(one("SELECT details FROM audit_log WHERE entity_id = ? AND action = 'update' ORDER BY rowid DESC LIMIT 1", draft.id)?.details || ''));
r = await call('POST', `/documents/${DOC_ID}/revisions/${draft.id}/approve`, { signature_password: PW }, 'Dana Control');
t('…so approving is refused again', r.status === 409 && r.json?.code === 'QA_REVIEW_REQUIRED');

console.log('\n── 4. three people, and taking it back ──');
await call('POST', QA, { signature_password: PW }, 'Quinn Assurance');
r = await call('POST', `/documents/${DOC_ID}/revisions/${draft.id}/approve`, { signature_password: PW }, 'Quinn Assurance');
t('the QA reviewer cannot also approve', r.status === 409 && r.json?.code === 'QA_REVIEWER_CANNOT_APPROVE', `${r.status} ${r.json?.code}`);
r = await call('DELETE', QA, { reason: 'not mine' }, 'Dana Control');
t('Document Control cannot withdraw QA\'s review', r.status === 403);
r = await call('DELETE', QA, {}, 'Quinn Assurance');
t('withdrawing needs a reason', r.status === 400);
r = await call('DELETE', QA, { reason: 'Missed the humidity limit' }, 'Quinn Assurance');
t('the reviewer withdraws it, with a reason', r.status === 200 && !r.json?.qa_reviewed_at);
t('…audited as a revoke', /qa_review_withdrawn/.test(one("SELECT details FROM audit_log WHERE entity_id = ? AND action = 'revoke' ORDER BY rowid DESC LIMIT 1", draft.id)?.details || ''));
await call('POST', QA, { signature_password: PW }, 'Quinn Assurance');
r = await call('POST', `/documents/${DOC_ID}/revisions/${draft.id}/approve`, {}, 'Dana Control');
t('Document Control is asked for the password', r.status === 403 && r.json?.signature_required === true);
r = await call('POST', `/documents/${DOC_ID}/revisions/${draft.id}/approve`, { signature_password: PW }, 'Dana Control');
t('Document Control approves V4', r.status === 200 && r.json?.document?.revision === 'V4', `${r.status} ${r.json?.error}`);
const rev = one('SELECT * FROM document_revisions WHERE id = ?', draft.id);
t('the approved revision keeps QA\'s review and the approver, two people', rev.status === 'approved' && rev.qa_reviewed_by === 'Quinn Assurance' && rev.approved_by === 'Dana Control');
r = await call('GET', `/documents/${DOC_ID}/revisions`, null, 'Ada Admin');
t('the history reads the QA review as signed', r.json?.revisions?.find(x => x.id === draft.id)?.qa_review_state === 'signed');

console.log('\n── 5. the PDF header ──');
const pr = await fetch(`${BASE}/documents/${DOC_ID}/pdf`, { headers: { Authorization: `Bearer ${tok['Ada Admin']}` } });
const pdf = await getDocument({ data: new Uint8Array(await pr.arrayBuffer()) }).promise;
const page1 = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
t('Owner: Carla Owner', /Owner:\s*Carla Owner/.test(page1), page1.slice(0, 300));
t('QA Review: Quinn Assurance, dated', /QA Review:\s*Quinn Assurance · \w+/.test(page1));
t('Approved By: Dana Control', /Approved By:\s*Dana Control/.test(page1));
// A revision approved before QA review existed says so rather than inventing one.
await call('POST', `/documents/${DOC_ID}/revisions`, { revision: 'V5' }, 'Dana Control');
const pd = await fetch(`${BASE}/documents/${DOC_ID}/pdf?copy=draft`, { headers: { Authorization: `Bearer ${tok['Ada Admin']}` } });
const dpage = (await (await (await getDocument({ data: new Uint8Array(await pd.arrayBuffer()) }).promise).getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
t('the draft copy reads "QA Review: not reviewed yet"', /QA Review:\s*not reviewed yet/.test(dpage.replace(/\s+/g, ' ')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
