// The two internal audits the team ran on paper before the module existed,
// transcribed from the signed scanned copies into the Internal Audits log.
//
// Both are the plant's own Form 403-01 V1 — the same checklist this module
// carries — worked the paper way: sections out of scope carry a diagonal line
// with the auditor's initials and date, answered sections carry an X per row.
// The transcription follows the module's own rules:
//   - ONLY the sections with answers get item rows; the crossed-out sections
//     are simply absent, exactly as picking sections in-app records scope.
//   - Handwritten comments are transcribed AS WRITTEN, spelling included —
//     the record must match the paper an auditor can ask to see.
//   - The one not-compliant answer (July, "Bathrooms are clean daily and the
//     clean is recorded.") is filed as 'nc' with its comment. No CAR is
//     invented for it — raising one is QA's decision, on the record, where
//     the module offers it.
//   - Nothing is invented: the signature on the paper is the sign-off, its
//     date is the sign-off date, and the summary says where the record came
//     from. The signed paper stays the original.
//
// ONE-TIME (app_settings flag): a transcribed audit someone corrects or
// removes in-app must not be resurrected by a redeploy. Within the run, an
// audit already filed for the same date and lead auditor is left alone.

import { randomUUID as uuid } from 'crypto';
import { CHECKLIST_REVISION, itemsForSections } from './audit-checklist.js';

const C = 'c', NC = 'nc';

const PAPER_AUDITS = [
  {
    audit_date: '2026-04-14',
    lead_auditor: 'Carol Pierce',
    focus_areas: 'Incoming, Preventive maintenance',
    sections: ['incoming_inspections', 'incoming_sampling', 'calibration', 'production_packaging'],
    // Every answered row on the paper is marked compliant.
    results: {},
    default_result: C,
    comments: {
      'incoming_inspections.0': 'Form 204-1',
      'incoming_inspections.1': 'No temperature sensitive products.',
    },
    summary:
      'Transcribed from the signed paper checklist (scan on file with QA; Form 403-01 V1, 5 pages). '
      + 'Sections not listed were crossed out on the paper with the auditor\'s initials and the date (CP 4/14/26). '
      + 'Note: the paper\'s Focus Area line reads "Incoming, Preventive maintenance", but the Maintenance and '
      + 'Preventive Maintenances section itself is crossed out; the sections filed here are the ones actually '
      + 'answered (Incoming inspections, Incoming Sampling and Retention, Calibration, Production: Packaging). '
      + 'The Management Review rows were left unmarked on the paper and are filed as out of scope.',
  },
  {
    audit_date: '2026-07-07',
    lead_auditor: 'Carol Pierce',
    focus_areas: 'Washroom and production area',
    sections: [
      'production_dosing', 'maintenance_pm', 'calibration', 'production_molding',
      'document_control_training', 'sanitation_pest', 'production_packaging',
      'management_review', 'internal_audits', 'product_distribution',
      'sanitary_audits', 'quality_responsibilities',
    ],
    results: { 'sanitary_audits.4': NC },
    default_result: C,
    comments: {
      'calibration.0': 'No refrigerators on site. Metal detector not in used, only x-ray in use.',
      'production_molding.3': 'Some signs were due for re-cleaning.',
      'document_control_training.1': 'Done every 6 months.',
      'internal_audits.2': 'Mostly by expirience. Internal auditor cert needed for SQF.',
      'sanitary_audits.4': 'Missing doc from bathroom',
    },
    summary:
      'Transcribed from the signed paper checklist (scan on file with QA; Form 403-01 V1, 5 pages). '
      + 'Sections not listed were crossed out on the paper with the auditor\'s initials and the date (CP 7/7/26). '
      + 'One finding: "Bathrooms are clean daily and the clean is recorded." marked not compliant — '
      + '"Missing doc from bathroom". The paper strikes through the "Molding and de-molding" section title '
      + '(initialled CP 7/7/26) but every row in it is answered compliant; it is filed as answered.',
  },
];

export function importPaperInternalAudits(db) {
  try {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'internal_audit_paper_import_v1'").get()) return 0;
    const exists = db.prepare(
      'SELECT 1 FROM internal_audits WHERE audit_date = ? AND LOWER(COALESCE(lead_auditor, \'\')) = LOWER(?)');
    // Same numbering rule as the module's own create path: max IA-N + 1.
    const nextNo = () => {
      const rows = db.prepare("SELECT audit_no FROM internal_audits WHERE audit_no LIKE 'IA-%'").all();
      const max = rows.reduce((m, r) => Math.max(m, parseInt(String(r.audit_no).replace(/^IA-/, ''), 10) || 0), 0);
      return `IA-${max + 1}`;
    };
    const insAudit = db.prepare(`INSERT INTO internal_audits
      (id, audit_no, checklist_revision, focus_areas, audit_date, lead_auditor, sections,
       status, summary, signed_by, signed_at, completed_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'system (paper import)', datetime('now'), datetime('now'))`);
    const insItem = db.prepare(`INSERT INTO internal_audit_items
      (id, audit_id, section, item_key, prompt, sort_order, result, comments, answered_by, answered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let added = 0;
    const run = db.transaction(() => {
      // Oldest first, so the audit numbers land in date order.
      for (const a of PAPER_AUDITS) {
        if (exists.get(a.audit_date, a.lead_auditor)) continue;
        const id = uuid();
        insAudit.run(id, nextNo(), CHECKLIST_REVISION, a.focus_areas, a.audit_date, a.lead_auditor,
          JSON.stringify(a.sections), a.summary, a.lead_auditor, a.audit_date, a.audit_date);
        itemsForSections(a.sections).forEach((row, i) => {
          insItem.run(uuid(), id, row.section, row.item_key, row.prompt, i,
            a.results[row.item_key] || a.default_result, a.comments[row.item_key] || null,
            a.lead_auditor, a.audit_date);
        });
        added++;
      }
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('internal_audit_paper_import_v1', ?)")
        .run(new Date().toISOString());
    });
    run();
    if (added) console.log(`[seed] Internal audits: imported ${added} signed paper audit(s)`);
    return added;
  } catch (e) {
    console.warn('[seed] internal audit paper import failed:', e.message);
    return 0;
  }
}
