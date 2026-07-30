// Which sanitation_records rows are actually QA inspections.
//
// Light Inspection (Form 110-01/02), Brittle Plastic & Glass (Form 431-02) and
// Temperature & Humidity Control (Form 110-04) are QA's records, but they're
// stored in sanitation_records alongside cleaning for history's sake. Every row
// carries the group it belongs to, and each list asks for its own — a record is
// in exactly ONE list, so nothing is ever duplicated between the two views.
//
// This lives in its own module because three callers need to agree on it: the
// write path (api/sanitation.js), the migration for records filed before the
// column existed (db.js), and the post-seed re-tag (server.js). One list, one
// definition.

export const QA_RECORD_AREA = /^(brittle plastic|light inspection|temp\s*\/?\s*humidity|temperature\s*(&|and)?\s*humidity)/i;

export function recordGroupFor(area) {
  return QA_RECORD_AREA.test(String(area || '').trim()) ? 'qa' : 'sanitation';
}

// SQL mirror of the regex above, for bulk re-tagging.
const AREA_SQL = `(area LIKE 'Brittle Plastic%' OR area LIKE 'Light Inspection%'
  OR area LIKE 'Temp/Humidity%' OR area LIKE 'Temp %Humidity%'
  OR area LIKE 'Temperature and Humidity%' OR area LIKE 'Temperature & Humidity%'
  OR area LIKE 'Temperature Humidity%')`;

/**
 * Move any untagged inspection record onto QA's list.
 *
 * Must run AFTER the historical seeds, not only as a migration: on a fresh
 * database (new deploy, DR restore) the migration runs against an empty table
 * and the seeds then insert every inspection with the default 'sanitation'
 * group — which is how a brand-new environment ends up with an empty QA
 * Inspections list and a Sanitation log full of QA's records. Idempotent, so
 * calling it from both places is free.
 */
export function tagQaInspectionRecords(db) {
  try {
    const { changes } = db.prepare(`UPDATE sanitation_records SET record_group = 'qa'
      WHERE COALESCE(record_group, 'sanitation') != 'qa' AND ${AREA_SQL}`).run();
    if (changes > 0) console.log(`[db] Moved ${changes} inspection records to the QA list`);
    return changes;
  } catch (e) {
    console.warn('[db] QA inspection tagging skipped:', e.message);
    return 0;
  }
}
