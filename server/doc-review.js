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
import { numberingWork } from './api/forms.js';
import { zoneDrift, bpgDiagram } from './bpg-zones.js';
import { GO_LIVE_DATE } from './db.js';
import { typeFromNumber, TYPE_LABELS } from '../shared/document-type.js';

// The registry tab each document type lives on — where "Open to approve" lands.
const TAB_FOR_TYPE = { sop: 'sops', work_instruction: 'work-instructions', job_description: 'job-descriptions' };

// ONE definition of "a revision waiting for approval" (D-304): an open draft on
// a document that is in force (active or under review). A draft on an
// archived document is not waiting on anybody; a draft DOCUMENT is the
// `draft-documents` pile. The queue, its count, the consistency section and
// the nav badge all read this.
export const DRAFT_REVISION_WHERE = `r.status = 'draft' AND d.status IN ('active', 'under_review')`;
export function draftRevisionCount(db) {
  return db.prepare(`SELECT COUNT(*) c FROM document_revisions r JOIN sop_documents d ON d.id = r.document_id
    WHERE ${DRAFT_REVISION_WHERE}`).get().c;
}
export function draftRevisionRows(db, limit = 200) {
  return db.prepare(`SELECT r.id, r.document_id, r.revision, r.effective_date, r.created_by, r.created_at,
      r.change_summary, r.doc_number AS staged_number,
      d.doc_number, d.title, d.revision AS in_force, d.doc_type,
      (SELECT COUNT(*) FROM document_attachments a WHERE a.revision_id = r.id AND a.kind = 'signed_original') AS signed_files
    FROM document_revisions r JOIN sop_documents d ON d.id = r.document_id
    WHERE ${DRAFT_REVISION_WHERE} ORDER BY r.created_at ASC LIMIT ?`).all(limit);
}

// Documents filed under a type their number contradicts, or under a type no
// Document Control list shows (D-317). Derived on every read, so changing a
// document's type clears it. A `form` document is fine while the Forms tab has
// a register entry for its number — that entry is its home.
export function documentTypeProblems(db) {
  const docs = db.prepare(`SELECT id, doc_number, title, doc_type, status FROM sop_documents
    WHERE COALESCE(doc_type, 'sop') != 'reference' AND status != 'archived' ORDER BY doc_number`).all();
  const forms = new Set(db.prepare('SELECT code FROM controlled_forms').all().map(f => String(f.code || '').trim().toUpperCase()));
  const out = [];
  for (const d of docs) {
    const type = d.doc_type || 'sop';
    const suggested = typeFromNumber(d.doc_number);
    if (suggested && suggested !== type) {
      out.push({ ...d, type, suggested, why: `The number says ${TYPE_LABELS[suggested]}; it is filed as ${TYPE_LABELS[type] || type}.` });
    } else if (type === 'policy') {
      out.push({ ...d, type, suggested: 'sop', why: 'Filed as Policy, which no Document Control tab lists.' });
    } else if (type === 'form' && !forms.has(String(d.doc_number || '').trim().toUpperCase())) {
      out.push({ ...d, type, suggested: null, why: 'Filed as Form, and the Forms tab has no register entry for this number.' });
    }
  }
  return out;
}

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
  // ── A revision staged and not yet approved (D-304). The document in force
  // is still `active`, so `draft-documents` never saw it, and the draft sat
  // inside the document's own Revisions box where only somebody who opened
  // that document could find it. Not batchable: approving a revision is a
  // password signature on that one document, so each row opens it.
  {
    key: 'draft-revisions',
    label: 'Revisions waiting for approval',
    module: 'document-control',
    noun: 'revision',
    plural: 'revisions',
    help: 'A new revision of a document that is already in force, staged and not yet approved. The document in force does not change until a person approves the draft with their password. Open each one to approve or discard it.',
    count: (db) => draftRevisionCount(db),
    pending: (db, limit = LIMIT) => draftRevisionRows(db, limit).map(r => ({
      id: r.id,
      title: `${r.doc_number ? `${r.doc_number} — ` : ''}${r.title}`,
      subtitle: [
        `Draft ${r.revision || '(no number)'} (in force: ${r.in_force || '—'})`,
        r.effective_date && `effective ${r.effective_date}`,
        r.created_by && `started by ${r.created_by}`,
        r.signed_files > 0 ? 'signed PDF attached' : 'no signed PDF',
        r.staged_number && r.staged_number !== r.doc_number && `number ${r.doc_number || '(none)'} → ${r.staged_number}`,
      ].filter(Boolean).join(' · '),
      date: String(r.created_at || '').slice(0, 10),
      overdue: false,
      extra: r.change_summary || null,
      link: `/?tab=${TAB_FOR_TYPE[r.doc_type] || 'sops'}&doc=${r.document_id}`,
      document_id: r.document_id,
      tab: TAB_FOR_TYPE[r.doc_type] || 'sops',
    })),
    canAct: isDocController,
  },
  // ── Documents filed under the wrong type (D-317). Not batchable: each is
  // fixed on the document with Change type, which asks for a reason.
  {
    key: 'document-type',
    label: 'Documents filed under the wrong type',
    module: 'document-control',
    noun: 'document',
    plural: 'documents',
    help: 'The type decides which tab a document is listed on. These are filed under a type their number contradicts, or under a type no tab lists. Open each one and use Change type; it asks for a reason and moves nothing else.',
    count: (db) => documentTypeProblems(db).length,
    pending: (db, limit = LIMIT) => documentTypeProblems(db).slice(0, limit).map(d => ({
      id: d.id,
      title: `${d.doc_number ? `${d.doc_number} — ` : ''}${d.title}`,
      subtitle: d.suggested ? `Filed as ${TYPE_LABELS[d.type] || d.type} · suggested ${TYPE_LABELS[d.suggested]}` : `Filed as ${TYPE_LABELS[d.type] || d.type}`,
      date: null,
      overdue: false,
      extra: d.why,
      ...(TAB_FOR_TYPE[d.type] ? { link: `/?tab=${TAB_FOR_TYPE[d.type]}&doc=${d.id}`, link_label: 'Open', document_id: d.id, tab: TAB_FOR_TYPE[d.type] } : {}),
    })),
    canAct: isDocController,
  },
  // ── Two piles that were already derived, on screens Document Control does
  // not land on (D-121). Neither is batchable: both are worked where the record
  // is — and `view` names the tab there, so "open it" opens the right one.
  {
    key: 'form-numbering',
    label: 'Form numbers to rule on',
    module: 'form-registry',   // the Forms tab of Controlled Documents (a hub tab id)
    noun: 'question',
    plural: 'questions',
    help: 'A record form disagreeing with the register about its number, or a series written two ways. Each clears itself when the register is put right, or is ruled correct as it stands with a reason. Worked on the Forms tab of Controlled Documents.',
    count: (db) => numberingWork(db).filter(i => !i.ruled).length,
    pending: (db, limit = LIMIT) => numberingWork(db).filter(i => !i.ruled).slice(0, limit)
      .map(i => ({
        id: `${i.kind}:${i.subject}`,
        title: i.title,
        subtitle: i.evidence || null,
        date: null,
        overdue: false,
        extra: i.action || null,
      })),
    canAct: isDocController,
  },
  {
    key: 'bpg-zone-drift',
    label: 'Zones that have left the BP&G drawing',
    module: 'qa-inspections',
    view: 'zones',
    form: '431-01',
    noun: 'zone',
    plural: 'zones',
    help: 'A zone whose inventory in the app no longer matches what FORM 431-01 shows. The drawing cannot redraw itself: this is the list of what a re-issue has to carry, worked from Zones & items on QA Inspections. It clears when the re-issued drawing is transcribed.',
    count: (db) => zoneDrift(db).drifted.length,
    pending: (db, limit = LIMIT) => {
      const dg = bpgDiagram(db);
      return zoneDrift(db).drifted.slice(0, limit).map(z => ({
        id: String(z.schedule_id),
        title: z.zone,
        subtitle: [
          z.added.length && `added: ${z.added.map(i => i.name).join(', ')}`,
          z.removed.length && `removed: ${z.removed.map(i => i.name).join(', ')}`,
          z.changed.length && `changed: ${z.changed.map(c => `${c.name} ${c.was} → ${c.now}`).join(', ')}`,
        ].filter(Boolean).join(' · '),
        date: null,
        overdue: false,
        extra: `${z.moved} item${z.moved === 1 ? '' : 's'} differ from ${dg.code}${dg.revision ? ` ${dg.revision}` : ''}`,
      }));
    },
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
