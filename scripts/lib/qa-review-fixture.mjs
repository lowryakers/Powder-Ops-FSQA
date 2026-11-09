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
