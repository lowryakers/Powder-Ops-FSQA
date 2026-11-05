// A receiving line filed under a mis-spelled inspection number joins its
// checklist (D-314). Every lookup is an exact match, so `A-100-6338 ` (a
// trailing space) on a line pointed at a checklist that did not exist — it
// opened blank from the Receiving Log — while the signed checklist
// `A-100-6338` counted 0 lines filed.
//
// Runs every boot and is idempotent by construction: it only touches a value
// whose clean spelling differs, so once fixed it finds nothing. Nothing is
// deleted and no answer, signature or line field other than the number moves.
//   • receiving_log: the number is respelled. Audited per line.
//   • receiving_checklists / receiving_coc_proofs: a checklist saved with a
//     stray character is respelled ONLY when no checklist already holds the
//     clean number; if one does, two checklists claim one delivery and a person
//     decides — it is reported and left alone.
import { logAudit } from './db.js';
import { cleanInspectionNo } from './inspection-no.js';

const untidy = (db, table) => db.prepare(`SELECT * FROM ${table} WHERE inspection_no IS NOT NULL`).all()
  .filter(r => cleanInspectionNo(r.inspection_no) !== r.inspection_no);

export function repairInspectionNumbers(db) {
  const out = { lines: 0, checklists: 0, proofs: 0, conflicts: [] };
  db.transaction(() => {
    for (const c of untidy(db, 'receiving_checklists')) {
      const clean = cleanInspectionNo(c.inspection_no);
      if (!clean) continue;
      if (db.prepare('SELECT 1 FROM receiving_checklists WHERE inspection_no = ?').get(clean)) {
        out.conflicts.push({ from: c.inspection_no, to: clean });
        continue;
      }
      db.prepare('UPDATE receiving_checklists SET inspection_no = ? WHERE id = ?').run(clean, c.id);
      logAudit('system', 'update', 'receiving_checklist', c.id,
        { repair: 'inspection_no_spelling', from: c.inspection_no, to: clean, decision: 'D-314' },
        { inspection_no: c.inspection_no }, { inspection_no: clean }, clean);
      out.checklists++;
    }
    const conflicted = new Set(out.conflicts.map(c => c.from));
    for (const p of untidy(db, 'receiving_coc_proofs')) {
      if (conflicted.has(p.inspection_no)) continue;
      const clean = cleanInspectionNo(p.inspection_no);
      if (!clean) continue;
      db.prepare('UPDATE receiving_coc_proofs SET inspection_no = ? WHERE id = ?').run(clean, p.id);
      out.proofs++;
    }
    for (const l of untidy(db, 'receiving_log')) {
      const clean = cleanInspectionNo(l.inspection_no);
      db.prepare('UPDATE receiving_log SET inspection_no = ? WHERE id = ?').run(clean, l.id);
      logAudit('system', 'update', 'receiving_log', l.id,
        { repair: 'inspection_no_spelling', from: l.inspection_no, to: clean, decision: 'D-314' },
        { inspection_no: l.inspection_no }, { inspection_no: clean }, clean || l.id);
      out.lines++;
    }
  })();
  if (out.lines || out.checklists || out.proofs) {
    console.log(`[repair] Inspection numbers respelled: ${out.lines} receiving line(s), ${out.checklists} checklist(s), ${out.proofs} CoC proof(s).`);
  }
  for (const c of out.conflicts) {
    console.warn(`[repair] Two checklists claim inspection ${c.to} (one saved as ${JSON.stringify(c.from)}). Left for a person to decide.`);
  }
  return out;
}
