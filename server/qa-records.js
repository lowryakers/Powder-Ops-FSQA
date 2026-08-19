// Which sanitation_records rows are actually QA inspections.
//
// Light Inspection (Form 110-01/02), Brittle Plastic & Glass (Form 431-02) and
// Temperature & Humidity Control (Form 110-04) are QA's records, but they're
// stored in sanitation_records alongside cleaning for history's sake. Every row
// carries the group it belongs to, and each list asks for its own — a record is
// in exactly ONE list, so nothing is ever duplicated between the two views.
//
// This lives in its own module because several callers need to agree on it: the
// write path (api/sanitation.js), the migration for records filed before the
// column existed (db.js), the post-seed re-tag (server.js) — and now the TASK
// side too. One list, one definition.
//
// The record side and the task side are two different tables and were fixed at
// different times, which is how a plant ended up with QA's inspection records
// correctly on QA's list while the tasks that produce them still sat under
// Cleaning. Both live here now so they cannot drift again.

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

/* ── The task side: schedules and work orders ─────────────────────────────── */

// The same three inspections, matched on the TITLE a schedule carries:
//   "Brittle Plastic & Glass Inspection — Break Room"
//   "Light Inspection — Warehouse"
//   "Temp & Humidity Check — Production"
// SQL rather than the regex because this re-tags in bulk, and the two are kept
// side by side so a change to one is an obvious prompt to change the other.
const TASK_TITLE_SQL = `(title LIKE 'Brittle Plastic%' OR title LIKE 'Light Inspection%'
  OR title LIKE 'Temp & Humidity%' OR title LIKE 'Temp/Humidity%'
  OR title LIKE 'Temperature & Humidity%' OR title LIKE 'Temperature and Humidity%')`;

/**
 * Put QA's inspection TASKS on QA's list.
 *
 * The seeders create these with `task_group = 'qa'` and `createNextWorkOrder`
 * copies the schedule's group, so anything generated today is already right.
 * What was missing is a backfill: a plant seeded before that was true has
 * schedules — and every work order generated from them since — sitting under
 * Cleaning, and the seeders skip once data exists, so a redeploy never fixes
 * it. This is the task-side twin of `tagQaInspectionRecords`.
 *
 * COMPLETED work is deliberately left alone. `task_group` routed the work at
 * the time and the completed row is the record of that; rewriting it would
 * move finished work between departments in Team Activity's history. Only
 * schedules (which govern what is generated next) and work that is still
 * outstanding are moved. The count of completed rows left behind is returned
 * so a caller can say so rather than leave it silent.
 *
 * Idempotent — a second run changes nothing.
 */
/* ── Completing the task must FILE the record ─────────────────────────────── */

// The task title a schedule carries, turned into the area its record is filed
// under. The two vocabularies were never the same — the seeders write
// "Temp & Humidity Check — Production 1" as the task and
// "Temp/Humidity — Production 1" as the record — and nothing joined them, so
// completing the check closed the task and filed nothing.
//
// Light Inspection is deliberately absent from this table: its task title and
// its record area are already identical ("Light Inspection — Zone 1 — Room 1"),
// so it needs no rewrite, only recognising.
// THE CLEANING LOGS HAVE THE SAME GAP, for the same reason: completing
// "Warehouse/Grounds Daily Cleaning" closed the task and filed no cleaning
// record, so FORM 202-01 (and 108-2, and 108-03) went as empty as the QA
// inspections did. These map to the areas the Sanitation log already files
// under — `Warehouse & Grounds`, `Breakroom, Lobby & Office`, `Restroom` —
// which is what `canonicalArea()` and the 72-hour re-clean rule read, so a
// task-filed record is indistinguishable from a hand-filed one.
//
// A cleaning record lands on the SANITATION list, not QA's: `recordGroupFor()`
// decides that from the area, so nothing here has to know which list it is.
const AREA_FROM_TITLE = [
  [/^Temp(?:erature)?\s*(?:&|and|\/)?\s*Humidity(?:\s+Check)?\s*—\s*(.+)$/i, loc => `Temp/Humidity — ${loc}`],
  [/^Brittle Plastic\s*(?:&|and)\s*Glass(?:\s+Inspection)?\s*—\s*(.+)$/i, zone => `Brittle Plastic/Glass — ${zone}`],
  [/^(Light Inspection\s*—\s*.+)$/i, whole => whole],
  [/^Break\s?room\s*[,/].*cleaning/i, () => 'Breakroom, Lobby & Office'],
  [/^Warehouse\s*[&/]\s*Grounds.*cleaning/i, () => 'Warehouse & Grounds'],
  [/^Restroom.*cleaning/i, () => 'Restroom'],
  [/^Production Line Pre-?Op|^.*Changeover Clean/i, () => 'Production'],
];

/**
 * The sanitation_records area a completed task should file under, or null when
 * the task does not answer to one of these logs.
 *
 * Returns null rather than guessing: a maintenance PM must never file an
 * inspection or cleaning record, and an unrecognised title is not either.
 */
export function recordAreaForTask(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  for (const [re, build] of AREA_FROM_TITLE) {
    const m = re.exec(t);
    // The cleaning patterns match a whole title and capture nothing — their
    // builder ignores the argument and returns a fixed area — so m[1] may be
    // undefined. Passing the full match keeps every builder callable.
    if (m) return build((m[1] ?? m[0]).trim());
  }
  return null;
}

export function tagQaInspectionTasks(db) {
  try {
    const sched = db.prepare(`UPDATE pm_schedules SET task_group = 'qa'
      WHERE COALESCE(task_group, '') != 'qa' AND ${TASK_TITLE_SQL}`).run();
    const open = db.prepare(`UPDATE work_orders SET task_group = 'qa'
      WHERE COALESCE(task_group, '') != 'qa' AND ${TASK_TITLE_SQL}
        AND status IN ('open', 'in_progress', 'overdue', 'missed')`).run();
    const completed = db.prepare(`SELECT COUNT(*) AS n FROM work_orders
      WHERE COALESCE(task_group, '') != 'qa' AND ${TASK_TITLE_SQL}
        AND status NOT IN ('open', 'in_progress', 'overdue', 'missed')`).get().n;
    if (sched.changes || open.changes) {
      console.log(`[db] Moved ${sched.changes} inspection schedule(s) and ${open.changes} open task(s) to QA`
        + (completed ? ` (${completed} already-completed task(s) left as filed)` : ''));
    }
    return { schedules: sched.changes, open: open.changes, completed_left: completed };
  } catch (e) {
    console.warn('[db] QA inspection task tagging skipped:', e.message);
    return { schedules: 0, open: 0, completed_left: 0 };
  }
}
