// Filing the QA inspection records for checks that were DONE and never recorded.
//
// Until this release, completing a Temperature & Humidity, Brittle Plastic &
// Glass or Light Inspection task closed the task and filed no record. The work
// happened — Diana did the checks — and the evidence is sitting in
// `work_orders`: a completed_at, a completed_by, the readings, the step ticks.
// What was missing is the `sanitation_records` row that QA Inspections reads and
// that an auditor is shown. Asking the plant to redo months of checks would be
// absurd when the account of them is already in the database.
//
// SO THIS INVENTS NOTHING. Every record it files is built from a COMPLETION THAT
// ALREADY EXISTS, and it carries that completion's own date, its own person and
// its own readings. A task nobody completed produces nothing — there is no
// "assume it was done" branch anywhere in this file, and there must never be
// one, because a fabricated inspection record is precisely the thing the log
// exists to make impossible.
//
// THE RECORDS SAY THEY WERE FILED LATE. `entered_late` + `late_entry_reason`
// already exist for exactly this (a clean that was done but could not be logged
// on the day), and the same rule applies here: back-dating is only honest when
// it is visible. An auditor sees the work's real date, the date the record
// reached the system, and why the two differ. A back-filled record that looked
// identical to one filed on the day would be the dishonest version of this.

import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';
import { qaInspectionAreaFor, recordGroupFor } from './qa-records.js';

const REASON = 'Filed from the completed task by the QA inspection record backfill — '
  + 'the check was completed in ReadyDoc but the record was not created at the time.';

const safeParse = (v, fb) => { try { return JSON.parse(v || 'null') ?? fb; } catch { return fb; } };

/** The marker fileQaInspectionRecord writes, and the thing that makes this idempotent. */
const taskMarker = (id) => `Filed from task ${id}`;

function buildNotes({ readings, stepResults, notes, workOrderId }) {
  const r = readings || {};
  const ticks = Array.isArray(stepResults)
    ? stepResults.filter(s => s && (s.done ?? s.checked ?? s === true)).length : 0;
  return [
    r.temperature != null && r.temperature !== '' ? `Temperature ${r.temperature}.` : null,
    r.humidity != null && r.humidity !== '' ? `Humidity ${r.humidity}.` : null,
    Array.isArray(stepResults) && stepResults.length ? `${ticks} of ${stepResults.length} items checked.` : null,
    String(notes || '').trim() || null,
    taskMarker(workOrderId) + '.',
  ].filter(Boolean).join(' ');
}

/**
 * What the backfill WOULD file. Writes nothing.
 *
 * A preview computed differently from the commit is a preview that lies, so the
 * commit consumes exactly these rows rather than re-running its own query.
 */
export function planQaRecordBackfill(db) {
  const rows = db.prepare(`
    SELECT w.id, w.title, w.equipment_id, w.completed_at, w.completed_by,
           w.readings, w.step_results, w.reading_result, w.notes
    FROM work_orders w
    WHERE w.status = 'completed'
      AND w.completed_at IS NOT NULL
      AND (w.title LIKE 'Temp %' OR w.title LIKE 'Temperature %'
           OR w.title LIKE 'Brittle Plastic%' OR w.title LIKE 'Light Inspection%')
    ORDER BY w.completed_at
  `).all();

  const plan = [];
  const skipped = { not_an_inspection: 0, already_filed: 0 };

  for (const w of rows) {
    const area = qaInspectionAreaFor(w.title);
    // Belt and braces over the SQL prefilter: the map is the authority on what
    // is an inspection, and it returns null rather than guessing.
    if (!area) { skipped.not_an_inspection += 1; continue; }

    const exists = db.prepare(
      `SELECT 1 FROM sanitation_records WHERE notes LIKE ? LIMIT 1`
    ).get(`%${taskMarker(w.id)}%`);
    if (exists) { skipped.already_filed += 1; continue; }

    const readings = safeParse(w.readings, {});
    const stepResults = safeParse(w.step_results, []);
    plan.push({
      work_order_id: w.id,
      title: w.title,
      area,
      equipment_id: w.equipment_id || null,
      // The date the WORK happened, not today.
      performed_at: w.completed_at,
      performed_by: w.completed_by || 'Unknown',
      result: w.reading_result === 'fail' || w.reading_result === 'reclean' ? w.reading_result : 'pass',
      notes: buildNotes({ readings, stepResults, notes: w.notes, workOrderId: w.id }),
    });
  }

  // Grouped counts are what a person actually reads before authorising a bulk
  // write to a compliance log.
  const byArea = {};
  const byMonth = {};
  for (const p of plan) {
    byArea[p.area] = (byArea[p.area] || 0) + 1;
    const m = String(p.performed_at).slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  }

  return { plan, total: plan.length, skipped, by_area: byArea, by_month: byMonth };
}

/**
 * File them. One transaction, idempotent, audited individually plus a summary —
 * a bulk action has to leave the trail a manual one would.
 */
export function runQaRecordBackfill(db, { by = 'system' } = {}) {
  const { plan, skipped, by_area, by_month } = planQaRecordBackfill(db);
  if (!plan.length) return { created: 0, skipped, by_area, by_month };

  const insert = db.prepare(`
    INSERT INTO sanitation_records
      (id, area, type, equipment_id, performed_by, performed_at, entered_at,
       entered_late, late_entry_reason, result, record_group, notes)
    VALUES (?, ?, 'pre_op', ?, ?, ?, datetime('now'), 1, ?, ?, ?, ?)
  `);

  const created = db.transaction(() => {
    let n = 0;
    for (const p of plan) {
      const id = uuid();
      // 'pre_op' and the three result values are CHECK-constrained, same as the
      // live filing path — an unlisted value throws and takes the whole
      // transaction with it.
      insert.run(id, p.area, p.equipment_id, p.performed_by, p.performed_at,
        REASON, p.result, recordGroupFor(p.area), p.notes);
      logAudit(by, 'create', 'sanitation_record', id,
        `Backfilled from completed task ${p.work_order_id} (${p.title}), performed ${p.performed_at}`,
        null, null, p.area);
      n += 1;
    }
    return n;
  })();

  logAudit(by, 'backfill', 'sanitation_record', 'qa-inspection-backfill',
    `Filed ${created} QA inspection record(s) from completed tasks that had none`);
  console.log(`[qa-backfill] Filed ${created} QA inspection record(s) from completed tasks`);

  return { created, skipped, by_area, by_month };
}
