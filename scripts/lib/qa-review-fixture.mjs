// A draft revision QA has reviewed (D-319), for verifies whose subject is
// something else — the approval, a bot's refusal, a PDF. Written straight to the
// database as a QA supervisor fixture would sign it, with the same fingerprint
// `qaReviewHash` in server/document-revisions.js takes. If that rule moves and
// this one does not, the approval answers 409 QA_REVIEW_REQUIRED and the verify
// says so. The review ITSELF — who may give it, the password, the separation —
// is tested through the real route by verify:docqareview.
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

const QA_HASHED = ['document_id', 'title', 'description', 'description_es'];

export function markQaReviewed(dbPath, revisionId, { by = 'QA Review Fixture', byId = 'qa-review-fixture' } = {}) {
  const db = new Database(dbPath);
  try {
    const r = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(revisionId);
    if (!r) throw new Error(`markQaReviewed: no revision ${revisionId}`);
    const hash = createHash('sha256').update(JSON.stringify(QA_HASHED.map(k => r[k] ?? null))).digest('hex');
    db.prepare(`UPDATE document_revisions SET qa_reviewed_by = ?, qa_reviewed_by_id = ?, qa_reviewed_at = ?,
      qa_review_meaning = 'Reviewed and accepted by Quality', qa_review_hash = ? WHERE id = ?`)
      .run(by, byId, new Date().toISOString(), hash, revisionId);
  } finally { db.close(); }
}

// A NEW document QA has reviewed before its first approval (D-321): the review
// sits on the document row until the approval copies it onto the revision.
export function markDocQaReviewed(dbPath, docId, { by = 'QA Review Fixture', byId = 'qa-review-fixture' } = {}) {
  const db = new Database(dbPath);
  try {
    const d = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(docId);
    if (!d) throw new Error(`markDocQaReviewed: no document ${docId}`);
    const row = { ...d, document_id: d.id };
    const hash = createHash('sha256').update(JSON.stringify(QA_HASHED.map(k => row[k] ?? null))).digest('hex');
    db.prepare(`UPDATE sop_documents SET qa_reviewed_by = ?, qa_reviewed_by_id = ?, qa_reviewed_at = ?,
      qa_review_meaning = 'Reviewed and accepted by Quality', qa_review_hash = ? WHERE id = ?`)
      .run(by, byId, new Date().toISOString(), hash, docId);
  } finally { db.close(); }
}

/**
 * File a document straight into force the way the plant now must (D-321): as a
 * draft, QA's review marked, then moved into force with the approver's password.
 * `send(method, path, body)` resolves to the parsed JSON body (or { status, json }).
 */
export async function fileApprovedDoc(send, dbPath, body) {
  const { status = 'active', signature_password, signature_name, ...rest } = body;
  const unwrap = (r) => (r && r.json !== undefined && r.status !== undefined ? r.json : r);
  const created = unwrap(await send('POST', '/documents', { ...rest, status: 'draft' }));
  if (!created?.id) throw new Error(`fileApprovedDoc: create failed ${JSON.stringify(created)}`);
  markDocQaReviewed(dbPath, created.id);
  const pw = signature_password ? { signature_password, ...(signature_name ? { signature_name } : {}) } : {};
  const approved = unwrap(await send('PUT', `/documents/${created.id}`, { status, ...pw }));
  if (approved?.status !== status && approved?.status !== 'active') throw new Error(`fileApprovedDoc: approval failed ${JSON.stringify(approved)}`);
  return approved;
}
