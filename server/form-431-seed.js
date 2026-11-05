// FORM 431-01 in the controlled registry (D-316).
//
// The Brittle Plastic & Glass diagram is a FORM. It was seeded into
// sop_documents with no doc_type, so the column default ('sop') applied and it
// showed on the SOPs tab — and nothing in the app can change doc_type (the
// document PUT ignores it). The seed now says 'form', and a once-per-row repair
// moves the row already on file. Nothing else about the row moves: not its
// status, revision, owner, content or id. The Forms tab reads controlled_forms,
// which is a separate row and is left alone.
import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';

export const FORM_431_NUMBER = 'FORM 431-01';
export const FORM_431_DOC_TYPE = 'form';

const DESCRIPTION = `Facility diagram identifying every zone covered by the monthly Brittle Plastic & Glass inspection (Form 431-02), with the items in each zone and their material.

The diagram itself is at /forms/FORM-431-01-V5-Brittle-Plastic-and-Glass-Diagram.pdf and is linked from the QA Inspections BPG filter and from every BPG inspection record.

The ITEM LISTS this diagram documents are maintained in the app, one schedule per zone (QA Inspections → Brittle Plastic & Glass), in the form item | qty | material. The zone names come from the "bpg_zones" managed list in Settings → Log Structure. Changing an item list there is what keeps this document and the inspections in step; re-issue the diagram through Document Control when the drawing itself changes.

V5 renumbers the floor: production rooms are 1–8 and batching rooms 1–3, and Room 0 no longer exists. Plastic pallet quantities vary with shipments and are used interchangeably between the production and warehouse zones.`;

// Insert-only: a row that exists is never touched here.
export function seedForm431(db) {
  const has = db.prepare('SELECT COUNT(*) AS c FROM sop_documents WHERE doc_number = ?').get(FORM_431_NUMBER).c;
  if (has) return false;
  db.prepare(`INSERT INTO sop_documents (id, doc_type, doc_number, title, category, revision, effective_date, review_due, owner, description, source_file)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), FORM_431_DOC_TYPE, FORM_431_NUMBER, 'Brittle Plastic and Glass Diagram', 'quality', 'V5',
      '2026-08-19', '2027-08-19', 'Daniela Servin', DESCRIPTION,
      '/forms/FORM-431-01-V5-Brittle-Plastic-and-Glass-Diagram.pdf');
  console.log('[seed] Created FORM 431-01 — Brittle Plastic and Glass Diagram');
  return true;
}

// Idempotent by construction: it only matches a row still filed as 'sop'.
export function fixForm431DocType(db) {
  const rows = db.prepare("SELECT id, doc_type FROM sop_documents WHERE doc_number = ? AND doc_type = 'sop'").all(FORM_431_NUMBER);
  if (!rows.length) return 0;
  const upd = db.prepare("UPDATE sop_documents SET doc_type = ? WHERE id = ? AND doc_type = 'sop'");
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      changed += upd.run(FORM_431_DOC_TYPE, r.id).changes;
      logAudit('system', 'update', 'document', r.id,
        { repair: 'doc_type', reason: 'seeded with wrong doc_type', from: 'sop', to: FORM_431_DOC_TYPE, decision: 'D-316' },
        { doc_type: 'sop' }, { doc_type: FORM_431_DOC_TYPE }, FORM_431_NUMBER);
    }
  })();
  console.log(`[repair] FORM 431-01 doc_type sop → form: ${changed} row(s) changed`);
  return changed;
}
