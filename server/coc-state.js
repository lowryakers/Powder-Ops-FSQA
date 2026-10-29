// The Certificate of Compliance state of one inspection, read from the
// database (D-275). Kept out of the receiving router so the bell can read it.
import { cocRequirements } from './coc-items.js';
import { itemKey } from './lab-test-items.js';

/**
 * What one inspection owes in Certificates of Compliance (D-275), derived on
 * every read from the lines filed against it, QA's list and the proofs on
 * record. Never stored, so filing a line or attaching a CoC moves it at once.
 */
export function cocState(db, inspectionNo, onDate) {
  try {
    const lines = db.prepare('SELECT id, part_number, part_description, vendor_lot, quantity_received, uom FROM receiving_log WHERE inspection_no = ?').all(inspectionNo);
    const rules = db.prepare('SELECT * FROM receiving_coc_items WHERE is_active = 1').all();
    const proofs = db.prepare('SELECT * FROM receiving_coc_proofs WHERE inspection_no = ? AND removed_at IS NULL ORDER BY created_at').all(inspectionNo);
    const required = cocRequirements(lines, rules, proofs, onDate);
    return {
      required,
      missing: required.filter(r => r.status === 'missing').length,
      // A line with no part number cannot be checked against QA's list at all.
      unchecked_lines: lines.filter(l => !itemKey(l.part_number)).length,
    };
  } catch { return { required: [], missing: 0, unchecked_lines: 0 }; }
}


/** Open (unsigned) inspections still owing a CoC — the bell and the Inspections list read this. */
export function openCocGaps(db) {
  try {
    const open = db.prepare('SELECT inspection_no, inspection_date FROM receiving_checklists WHERE reviewed_at IS NULL').all();
    return open.map(c => ({ ...c, missing: cocState(db, c.inspection_no, c.inspection_date).missing })).filter(c => c.missing > 0);
  } catch { return []; }
}
