// The 10 October 2025 fire drill, as a training record for everyone who signed.
//
// The drill produced TWO pieces of paper and they are different records:
//
//   * FORM 501-02, the headcount sheet — how many people reached the evacuation
//     site and were accounted for. Imported by evacuation-import.js.
//   * FORM 500-03, the SOP Acknowledgement and Training Form — thirty-three
//     signatures against *Emergency Response & Crisis Management SOP 501 V1*,
//     each countersigned by the trainer.
//
// The second is what answers "is this operator trained on the emergency
// procedure", which is the question an auditor asks, and it had nowhere to live.
// Filing it as an evacuation record would have been the same mistake as merging
// the two forms: they are two controlled documents recording two different
// facts, and the counts happening to agree is a cross-check, not a reason to
// collapse them.
//
// THE COUNTS ARE A CROSS-CHECK AND THEY AGREE. Thirty-three signatures against
// thirty-three accounted for on the headcount form is the strongest available
// evidence that both sheets describe the same event.
//
// TWO OF THE THIRTY-THREE ARE DELIBERATELY NOT FILED, and the gap is recorded
// rather than papered over — a gap must be visible as a gap:
//
//   * one signature is illegible and no name could be read from it. Inventing
//     one would put a person's name on a training record they never signed.
//   * one is a first name only ("Ricardo", distinct from the "Ricardo A." two
//     rows down) belonging to somebody no longer employed here. There is no
//     account to attach it to and no ongoing competency to track.
//
// So the sheet carries 33 and this files 31. `SHEET_SIGNATURES` and
// `NOT_FILED` below are the record of why, and the summary audit entry carries
// both numbers so nobody later reads 31 as a transcription that lost two rows.
import { randomUUID as uuid } from 'crypto';
import { logAudit } from './db.js';
import { personKey } from './person-key.js';

const DRILL_DATE = '2025-10-15';
const TOPIC = 'Emergency Response & Crisis Management SOP 501';
const TRAINER = 'Selena Castillo';
const FORM = 'FORM 500-03 Rev 1';

const SHEET_SIGNATURES = 33;
const NOT_FILED = [
  { row: 20, reason: 'signature illegible — no name could be read' },
  { row: 1, reason: 'first name only ("Ricardo"), no longer employed; distinct from Ricardo Avalos' },
];

// Transcribed from the two signed pages, in sheet order. Where the sheet
// abbreviated a surname the full name was supplied by the plant and is used
// here; where the sheet's own spelling differs from the roster, the ROSTER
// spelling wins on the record and the sheet's is kept in the note — the same
// rule the Training Log and scanned-test importers follow, so a record reads
// like every other record and the provenance is still recoverable.
const SIGNATURES = [
  // page 1
  { name: 'Romina Vega' },
  { name: 'Dayanna Mora León' },
  { name: 'Cecilia León' },
  { name: 'Zuleima Nava' },
  { name: 'Silvia Carrillo' },
  { name: 'Reina Figueroa', as_written: 'Reina F.' },
  { name: 'Olga Olguín' },
  { name: 'Rosaura Castro', as_written: 'Rosaura C.' },
  { name: 'Isabel Rodriguez' },
  // The sheet dates this row 10/25/25. Every other row on both pages reads
  // 10/15/25 and the drill itself was the 15th, so it is filed as the 15th and
  // the discrepancy is written into the note rather than silently corrected.
  { name: 'Maria Fernanda Agudelo', as_written: 'Mafe Agudelo', date_note: 'Sheet dates this row 10/25/25; filed as the drill date, 10/15/2025.' },
  { name: 'Sandra Gerez' },
  { name: 'Danilo Ibañez' },
  { name: 'Jose Ortiz' },
  { name: 'Rene Oporta' },
  { name: 'Ricardo Avalos', as_written: 'Ricardo A.' },
  { name: 'Francisco Padilla' },
  { name: 'Guadalupe Garcia' },
  { name: 'Bernardo Enciso' },
  // page 2
  { name: 'Gricelda Zavala' },
  { name: 'Graciela León' },
  { name: 'Josefa Moy' },
  { name: 'Maria Lopez', as_written: 'Maria L.' },
  { name: 'Jose Girón' },
  { name: 'Jose Luna' },
  { name: 'Ricale Jozep', uncertain: true },
  { name: 'Daniela Servin' },
  { name: 'Maria Servin' },
  { name: 'Juana Gonzalez' },
  { name: 'Selena Castillo' },
  { name: 'Adam Bliss' },
  { name: 'Jake Waits' },
];

export function importDrillTraining(db) {
  try {
    // Idempotent on person + topic + date, the same identity the Training Log
    // and scanned-test importers use. Re-running creates nothing.
    const exists = db.prepare(
      'SELECT 1 FROM training_records WHERE training_topic = ? AND training_date = ? AND LOWER(employee_name) = LOWER(?)');
    const ins = db.prepare(`INSERT INTO training_records
      (id, employee_name, employee_user_id, training_topic, sop_id, trainer, training_date,
       completion_date, status, method, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'classroom', ?)`);

    // The SOP itself, when it is in the registry — so the record points at the
    // document it was trained against rather than only naming it in text.
    const sop = db.prepare(
      `SELECT id FROM sop_documents WHERE doc_number LIKE 'SOP 501%' OR doc_number LIKE 'SOP-501%'
       OR LOWER(title) LIKE '%emergency response%' LIMIT 1`).get();

    // Roster match by the words of the name, accent-folded and sorted, so
    // "Dayanna Mora León" resolves to an account spelled "Dayanna Mora Leon".
    const roster = new Map();
    for (const u of db.prepare('SELECT id, name FROM users WHERE is_active = 1').all()) {
      const k = personKey(u.name);
      if (k && !roster.has(k)) roster.set(k, u);
    }

    let added = 0, linked = 0;
    const created = [];
    const run = db.transaction(() => {
      for (const s of SIGNATURES) {
        const account = roster.get(personKey(s.name)) || null;
        // The ACCOUNT's spelling goes on the record when there is one; the
        // sheet's spelling survives in the note.
        const name = account?.name || s.name;
        if (exists.get(TOPIC, DRILL_DATE, name)) continue;

        const note = [
          `Signed ${FORM} — SOP Acknowledgement and Training Form, fire drill ${DRILL_DATE}.`,
          s.as_written && s.as_written !== name ? `Sheet reads "${s.as_written}".`
            : (account && account.name !== s.name ? `Sheet reads "${s.name}".` : null),
          s.date_note || null,
          s.uncertain ? 'Name read with difficulty from the scan — confirm against the paper.' : null,
          !account ? 'No matching ReadyDoc account at import time.' : null,
        ].filter(Boolean).join(' ');

        ins.run(uuid(), name, account?.id || null, TOPIC, sop?.id || null, TRAINER,
          DRILL_DATE, DRILL_DATE, note);
        added++;
        if (account) linked++;
        created.push(name);
      }

      if (added) {
        // Both numbers, in one place, so 31 is never read as a transcription
        // that quietly lost two rows.
        logAudit('system (paper import)', 'import', 'training_record', null, {
          source: FORM,
          drill_date: DRILL_DATE,
          topic: TOPIC,
          trainer: TRAINER,
          signatures_on_sheet: SHEET_SIGNATURES,
          filed: added,
          linked_to_accounts: linked,
          not_filed: NOT_FILED,
        }, null, null, `Fire drill training ${DRILL_DATE}`);
      }
    });
    run();

    if (added) {
      console.log(`[training] Imported ${added} of ${SHEET_SIGNATURES} fire-drill signatures `
        + `(${linked} linked to accounts, ${NOT_FILED.length} deliberately not filed)`);
    }
    return { added, linked, not_filed: NOT_FILED.length, created };
  } catch (err) {
    // A seeder must never take the boot down with it.
    console.warn('[training] Fire-drill training import skipped:', err.message);
    return { added: 0, linked: 0, not_filed: 0, created: [] };
  }
}
