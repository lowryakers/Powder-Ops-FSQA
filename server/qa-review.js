// QA Review Center — every record waiting on a QA signature, in one list.
//
// The signatures themselves are unchanged and still belong to their modules:
// a production entry is signed by production.js, a cleaning record by
// sanitation.js, a scale check by scale-verification.js. This file only knows
// how to FIND what's outstanding and which function to hand it to. Signing here
// writes exactly what signing in the module writes — same columns, same audit
// entry — because it calls the module's own function rather than its own SQL.
//
// That constraint is the whole design. A second place that writes signatures
// would be a second thing to keep in step with the compliance rules, and the
// first time they diverged the records would stop agreeing with each other.
//
// Adding a source = one entry in SOURCES. It needs:
//   key       stable id, used by the client and the sign endpoint
//   label     what QA calls this pile
//   form      the controlled form number, when there is one
//   module    tab id, so "open it in its own module" works
//   pending   (db, limit) => rows, oldest first — what still needs a signature
//   count     (db) => number outstanding (cheap; the badge uses this)
//   sign      (db, user, id) => { error, status } | { ok: true }
//   canSign   (user) => boolean
//
// Sources deliberately NOT here: QMS records (deviation / non-conformance /
// on-hold) and disposals. Those are multi-party APPROVALS with an e-signature
// intent statement, not a counter-signature — approving one is a decision about
// product, and it belongs on the record where the reviewer can see the whole
// investigation. The panel links to them instead of pretending a row in a list
// is enough to approve a deviation.

import { verifySanitationRecord } from './api/sanitation.js';
import { signOffProductionEntry } from './api/production.js';
import { verifyScaleCheck } from './api/scale-verification.js';
import { hasExplicitEdit } from './module-access.js';

// Who counts as QA for the purposes of a counter-signature. Matches the rule
// each module already applies, kept in one place so the review screen can't
// offer someone a button their module would refuse.
export const isQaReviewer = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase());

const canSignProduction = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'production-log');
const canSignSanitation = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'sanitation');
const canSignInspection = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'qa-inspections');
const canSignScale = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'calibration');

// Oldest first everywhere: the point of the queue is that nothing ages out of
// sight, so the top of the list is always the thing that has waited longest.
const LIMIT = 200;

export const SOURCES = [
  {
    key: 'production',
    label: 'Production entries',
    form: null,
    module: 'production-log',
    noun: 'entry',
    plural: 'entries',
    count: (db) => db.prepare('SELECT COUNT(*) c FROM production_entries WHERE qa_signoff_by IS NULL').get().c,
    pending: (db, limit = LIMIT) => db.prepare(
      `SELECT id, date, team, room, product_name, mo_number, lot_number, submitted_by
       FROM production_entries WHERE qa_signoff_by IS NULL
       ORDER BY date ASC, created_at ASC LIMIT ?`).all(limit).map(r => ({
      id: r.id,
      title: [r.product_name, r.mo_number && `MO ${r.mo_number}`].filter(Boolean).join(' · ') || 'Production entry',
      subtitle: [r.team, r.room].filter(Boolean).join(' · '),
      by: r.submitted_by,
      date: r.date,
      extra: r.lot_number ? `Lot ${r.lot_number}` : null,
    })),
    canSign: canSignProduction,
    sign: (db, user, id) => {
      // Refuse an entry that already carries a signature.
      //
      // The Production Log's own route allows a re-sign (it only ever offers
      // the button on unsigned entries, and an amendment clears the signature
      // first, so it always starts from unsigned). A queue is different: two
      // people can work the same list, and a stale row must not let the second
      // one overwrite the first one's signature. The other three sources
      // already refuse this — matching them.
      const row = db.prepare('SELECT qa_signoff_by FROM production_entries WHERE id = ?').get(id);
      if (!row) return { error: 'Production entry not found', status: 404 };
      if (row.qa_signoff_by) return { error: 'Already signed off.', status: 400 };

      const { error, status } = signOffProductionEntry(db, id, { by: user?.name });
      return error ? { error, status } : { ok: true };
    },
  },
  {
    key: 'qa-inspections',
    label: 'QA inspections',
    form: '110-01 · 110-02 · 431-02 · 110-04',
    module: 'qa-inspections',
    noun: 'inspection',
    plural: 'inspections',
    count: (db) => db.prepare(
      "SELECT COUNT(*) c FROM sanitation_records WHERE verified_by IS NULL AND record_group = 'qa'").get().c,
    pending: (db, limit = LIMIT) => db.prepare(
      `SELECT id, area, type, performed_by, performed_at, result, notes
       FROM sanitation_records WHERE verified_by IS NULL AND record_group = 'qa'
       ORDER BY performed_at ASC LIMIT ?`).all(limit).map(r => ({
      id: r.id,
      title: r.area || 'Inspection',
      subtitle: r.type || '',
      by: r.performed_by,
      date: (r.performed_at || '').slice(0, 10),
      result: r.result,
      extra: r.notes || null,
    })),
    canSign: canSignInspection,
    sign: (db, user, id) => {
      const { error } = verifySanitationRecord(db, id, user?.name);
      return error ? { error, status: 400 } : { ok: true };
    },
  },
  {
    key: 'sanitation',
    label: 'Cleaning records',
    form: null,
    module: 'sanitation',
    noun: 'record',
    plural: 'records',
    count: (db) => db.prepare(
      "SELECT COUNT(*) c FROM sanitation_records WHERE verified_by IS NULL AND (record_group IS NULL OR record_group != 'qa')").get().c,
    pending: (db, limit = LIMIT) => db.prepare(
      `SELECT id, area, type, performed_by, performed_at, result, notes
       FROM sanitation_records WHERE verified_by IS NULL AND (record_group IS NULL OR record_group != 'qa')
       ORDER BY performed_at ASC LIMIT ?`).all(limit).map(r => ({
      id: r.id,
      title: r.area || 'Cleaning record',
      subtitle: r.type || '',
      by: r.performed_by,
      date: (r.performed_at || '').slice(0, 10),
      result: r.result,
      extra: r.notes || null,
    })),
    canSign: canSignSanitation,
    sign: (db, user, id) => {
      const { error } = verifySanitationRecord(db, id, user?.name);
      return error ? { error, status: 400 } : { ok: true };
    },
  },
  {
    key: 'scale-verification',
    label: 'Scale verifications',
    form: '417-01 … 417-05',
    module: 'calibration',
    noun: 'check',
    plural: 'checks',
    count: (db) => db.prepare('SELECT COUNT(*) c FROM scale_verifications WHERE verified_by IS NULL').get().c,
    pending: (db, limit = LIMIT) => db.prepare(
      `SELECT id, form_code, form_title, room, performed_by, performed_at, result
       FROM scale_verifications WHERE verified_by IS NULL
       ORDER BY performed_at ASC LIMIT ?`).all(limit).map(r => ({
      id: r.id,
      title: r.form_title || r.form_code,
      subtitle: [r.room, r.form_code].filter(Boolean).join(' · '),
      by: r.performed_by,
      date: (r.performed_at || '').slice(0, 10),
      result: r.result,
      extra: null,
    })),
    canSign: canSignScale,
    sign: (db, user, id) => {
      const { error, status } = verifyScaleCheck(db, user, id);
      return error ? { error, status } : { ok: true };
    },
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
