// Document Control Review Center — everything waiting on Document Control, in
// one list.
//
// Same shape and the same discipline as `qa-review.js`: this file only knows
// how to FIND what's outstanding. Where a pile can be cleared in bulk, the
// action calls the module's own function rather than writing the columns here,
// so one place records a review and there is one audit shape for it.
//
// The important difference from QA Review: **not every pile is batchable, and
// this screen says so instead of pretending.**
//
//   · A document past its review date IS batchable — "I have read it and it is
//     still correct" is a routine act, and it is what the review date asks for.
//   · A parked Controlled Change is NOT. Approving one changes what the app
//     serves to the whole plant; it belongs on the screen that shows the diff.
//   · An open Document Change Request is NOT. It is a decision with an
//     investigation behind it.
//   · A draft document is NOT. Publishing is a per-document act.
//
// So a source declares `action` only when it genuinely has one. The rest are
// counts with a way through to where the work is actually done — which is the
// same reasoning that keeps deviations out of QA Review.

import { recomputeDocumentReview } from './api/documents.js';
import { GO_LIVE_DATE } from './db.js';

// Who is Document Control for the purposes of this screen. Matches the rule the
// modules already apply, kept in one place so the queue can't offer someone a
// button their module would refuse.
export const isDocController = (u) => u?.role === 'admin'
  || (u?.department || '').toLowerCase() === 'document_control'
  || (u?.role === 'supervisor' && ['qa', 'document_control'].includes((u?.department || '').toLowerCase()));

// Oldest/most overdue first everywhere: the point of a queue is that nothing
// ages out of sight.
const LIMIT = 200;

const REVIEW_LEAD_DAYS = 30;

export const SOURCES = [
  {
    key: 'document-review',
    label: 'Documents due for review',
    module: 'document-control',
    noun: 'document',
    plural: 'documents',
    // The one batchable pile: confirming a document is still current.
    action: { verb: 'Mark reviewed', done: 'reviewed' },
    help: 'Marking one reviewed sets today as the last review and schedules the next from the document\'s own frequency.',
    count: (db) => db.prepare(`SELECT COUNT(*) c FROM sop_documents
      WHERE status != 'archived' AND review_due IS NOT NULL AND review_due != ''
        AND date(review_due) <= date('now', ?)`).get(`+${REVIEW_LEAD_DAYS} days`).c,
    pending: (db, limit = LIMIT) => db.prepare(`SELECT id, doc_number, title, revision, owner, review_due, last_reviewed, doc_type
      FROM sop_documents
      WHERE status != 'archived' AND review_due IS NOT NULL AND review_due != ''
        AND date(review_due) <= date('now', ?)
      ORDER BY date(review_due) ASC LIMIT ?`).all(`+${REVIEW_LEAD_DAYS} days`, limit)
      .map(d => ({
        id: d.id,
        title: `${d.doc_number ? `${d.doc_number} — ` : ''}${d.title}`,
        subtitle: [d.revision && `Rev ${d.revision}`, d.owner, d.last_reviewed && `last reviewed ${d.last_reviewed}`].filter(Boolean).join(' · '),
        date: d.review_due,
        overdue: d.review_due < new Date().toISOString().split('T')[0],
        extra: null,
      })),
    canAct: isDocController,
    act: (db, user, id) => {
      const doc = db.prepare('SELECT id FROM sop_documents WHERE id = ?').get(id);
      if (!doc) return { error: 'Document not found', status: 404 };
      // Calls the module's own function — one place computes the next review.
      recomputeDocumentReview(db, id);
      return { ok: true };
    },
  },
  {
    key: 'controlled-changes',
    label: 'Deployed changes waiting on approval',
    module: 'controlled-changes',
    noun: 'change',
    plural: 'changes',
    help: 'A change to a form definition or an acceptance criterion. The app keeps serving the approved version until this is decided — open it to see the difference before approving.',
    count: (db) => db.prepare("SELECT COUNT(*) c FROM controlled_definitions WHERE pending_hash IS NOT NULL").get().c,
    pending: (db, limit = LIMIT) => db.prepare(`SELECT id, scope, key, label, pending_seen_at, version, rejected_at
      FROM controlled_definitions WHERE pending_hash IS NOT NULL
      ORDER BY pending_seen_at ASC LIMIT ?`).all(limit)
      .map(c => ({
        id: c.id,
        title: c.label || `${c.scope} · ${c.key}`,
        subtitle: [c.scope, `v${c.version}`, c.rejected_at && 'previously rejected'].filter(Boolean).join(' · '),
        date: String(c.pending_seen_at || '').slice(0, 10),
        overdue: false,
        extra: null,
      })),
    canAct: isDocController,
  },
  {
    key: 'change-requests',
    label: 'Open Document Change Requests',
    module: 'dcr',
    form: '406-1',
    noun: 'request',
    plural: 'requests',
    help: 'Form 406-1, raised since go-live and still missing its Quality Assurance signature. Each one is a decision with a reason behind it, so they are worked on the record rather than from a checkbox.',
    // "Open" means raised SINCE GO-LIVE and still unsigned.
    //
    // The 180 rows imported from the paper register carry no status and no
    // approvals — they are a history of changes already made, not a queue. A
    // queue headed "180 open requests" is the same inflated number the sign-out
    // tabs used to show, and nobody reads a queue they can't empty. Same
    // go-live cutoff `archivePreSystemBacklog` uses for pre-system work orders.
    count: (db) => db.prepare(`SELECT COUNT(*) c FROM qms_records
      WHERE record_type = 'document_change_request'
        AND COALESCE(status, '') NOT IN ('closed', 'completed', 'rejected', 'cancelled')
        AND date(record_date) >= date(?)
        AND COALESCE(json_extract(approvals, '$.quality_assurance'), '') = ''`).get(GO_LIVE_DATE).c,
    pending: (db, limit = LIMIT) => db.prepare(`SELECT id, record_number, record_date, status, data, created_by
      FROM qms_records
      WHERE record_type = 'document_change_request'
        AND COALESCE(status, '') NOT IN ('closed', 'completed', 'rejected', 'cancelled')
        AND date(record_date) >= date(?)
        AND COALESCE(json_extract(approvals, '$.quality_assurance'), '') = ''
      ORDER BY record_date ASC LIMIT ?`).all(GO_LIVE_DATE, limit)
      .map(r => {
        let d; try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
        return {
          id: r.id,
          title: [d.doc_number, d.doc_name].filter(Boolean).join(' — ') || r.record_number || 'Change request',
          subtitle: [r.record_number, d.change_type, d.revision && `Rev ${d.revision}`, d.initiator || r.created_by].filter(Boolean).join(' · '),
          date: String(r.record_date || '').slice(0, 10),
          overdue: false,
          extra: d.description || null,
        };
      }),
    canAct: isDocController,
  },
  {
    key: 'draft-documents',
    label: 'Documents still in draft',
    module: 'document-control',
    noun: 'draft',
    plural: 'drafts',
    help: 'Created or imported but never issued. A draft is not a controlled document — until it is approved with a revision and an effective date, nobody is working to it.',
    count: (db) => db.prepare("SELECT COUNT(*) c FROM sop_documents WHERE status = 'draft'").get().c,
    pending: (db, limit = LIMIT) => db.prepare(`SELECT id, doc_number, title, revision, owner, doc_type, created_at
      FROM sop_documents WHERE status = 'draft' ORDER BY created_at ASC LIMIT ?`).all(limit)
      .map(d => ({
        id: d.id,
        title: `${d.doc_number ? `${d.doc_number} — ` : ''}${d.title}`,
        subtitle: [d.doc_type?.replace(/_/g, ' '), d.revision && `Rev ${d.revision}`, d.owner].filter(Boolean).join(' · '),
        date: String(d.created_at || '').slice(0, 10),
        overdue: false,
        extra: null,
      })),
    canAct: isDocController,
  },
];

export const getSource = (key) => SOURCES.find(s => s.key === key) || null;

// A source's table may not exist on a partially-migrated database — a missing
// pile should read as zero, not take the whole screen down.
export function safeCount(source, db) {
  try { return source.count(db); } catch { return 0; }
}
export function safePending(source, db, limit) {
  try { return source.pending(db, limit); } catch { return []; }
}
