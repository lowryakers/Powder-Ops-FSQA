// Seed the initial Knife / Razor Blade / Scissor masterlist from Form 440-01 (V2):
//   20 scissors, 10 razor blades, 5 knives — all marked/registered by Maria Servin
//   on 2026-07-07. Scissor #6 broke and was decommissioned on 2026-07-15.
// Idempotent: only seeds when the knife_accountability log is empty, so it never
// duplicates on restart or clobbers records entered in the app.
import { v4 as uuid } from 'uuid';

const MARKED_BY = 'Maria Servin';
const REG_DATE = '2026-07-07';

export function seedKnifeMasterlist(db) {
  const existing = db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type = 'knife_accountability'").get().c;
  if (existing > 0) return 0;

  const items = [];
  for (let i = 1; i <= 20; i++) items.push({ type: 'Scissor', n: i });
  for (let i = 1; i <= 10; i++) items.push({ type: 'Razorblade', n: i });
  for (let i = 1; i <= 5; i++) items.push({ type: 'Knife', n: i });

  const ins = db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, notes, created_by)
    VALUES (?, 'knife_accountability', ?, ?, ?, ?, 0, ?, 'system-import')`);

  let seeded = 0;
  db.transaction(() => {
    items.forEach((it, idx) => {
      const number = 'KB-' + String(idx + 1).padStart(3, '0');
      const data = { tool_id: `${it.type} ${it.n}`, marked_by: MARKED_BY, condition: 'Good' };
      let status = 'available';
      let notes = null;
      // Scissor #6 broke and was decommissioned per the form.
      if (it.type === 'Scissor' && it.n === 6) {
        status = 'decommissioned';
        data.decommissioned_by = MARKED_BY;
        notes = 'Decommissioned 2026-07-15 by Maria Servin — scissor broke and was thrown away.';
      }
      ins.run(uuid(), number, REG_DATE, status, JSON.stringify(data), notes);
      seeded++;
    });
  })();
  return seeded;
}
