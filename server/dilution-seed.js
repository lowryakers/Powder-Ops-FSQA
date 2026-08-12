// One recurring task PER DILUTION, and the record they file into.
//
// The plant already had a daily "Chemical Dilution Verification" task on the
// Chemical Station zone, so the answer to "are the dilutions showing up as
// tasks?" was technically yes. It was still being hand-filed in Sanitation
// every day, for two reasons this seeder and the completion hook fix:
//
//   1. ONE TASK COVERED FOUR CHEMICALS. Its six steps named Sani-512, chlorine,
//      Dawn and Simple Green, but the completion form asks for ONE chemical
//      name and ONE reading — so a check of four chemicals closed having
//      recorded one, and there was no honest way to say "we didn't mix Dawn
//      today". Four schedules means four tasks, each individually completable
//      and each individually skippable through the existing not-applicable
//      path (which recurs the schedule, so tomorrow's still arrives).
//   2. COMPLETING A TASK FILED NO RECORD. The reading landed in
//      `work_orders.readings` and Form 106-01 — the sanitation log — got
//      nothing. So QA typed it in again by hand. See fileDilutionRecord().
//
// SEPARATE SEEDER, and it must stay separate: seedCleaningPMSchedules() is
// `if (any cleaning schedule exists) return`, all-or-nothing on an empty
// database, so it can never introduce a schedule to an instance that already
// has one — which is every deployed instance. This one runs each boot and adds
// only what is missing, the same arrangement as seedWorkInstructionCourses().

import { randomUUID as uuid } from 'crypto';
import { DILUTIONS, dilutionTitle, FORM_REVISION, isMeasured } from '../shared/dilution-forms.js';

const LUMPED_TITLE = 'Chemical Dilution Verification';
const ZONE_ASSET_ID = 'QA-CL-004'; // the Chemical Station zone

function steps(form) {
  return [
    isMeasured(form)
      ? `Test ${form.chemical} with a test strip — verify ${form.target}`
      : `Verify ${form.chemical} is mixed to ${form.target}`,
    'Record the dilution or test strip lot number and expiration date',
  ];
}

export function seedDilutionSchedules(db) {
  const zone = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').get(ZONE_ASSET_ID);
  if (!zone) return 0; // the cleaning seed has not run — nothing to hang these on

  const findSched = db.prepare('SELECT id, is_active FROM pm_schedules WHERE title = ?');
  const insertPM = db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active, task_group)
    VALUES (?, ?, ?, ?, 'daily', 1, ?, 1, 'cleaning')
  `);
  const openWo = db.prepare(
    "SELECT id FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed') LIMIT 1");
  const insertWO = db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cleaning', 'open')
  `);

  const today = new Date().toISOString().split('T')[0];
  let created = 0;

  db.transaction(() => {
    for (const form of DILUTIONS) {
      const title = dilutionTitle(form);
      // A title that already exists is left COMPLETELY alone — an edited
      // cadence, a reassigned team or a schedule somebody deactivated are
      // decisions, and a seeder that undoes them on every deploy is how people
      // stop trusting a setting.
      let sched = findSched.get(title);
      if (!sched) {
        const id = uuid();
        insertPM.run(id, zone.id, title,
          `${FORM_REVISION} — daily ${isMeasured(form) ? 'test strip verification' : 'mixing ratio verification'}. Target: ${form.target}.`,
          JSON.stringify(steps(form)));
        sched = { id, is_active: 1 };
        created++;
      }
      if (sched.is_active && !openWo.get(sched.id)) {
        insertWO.run(uuid(), sched.id, zone.id, title, `Target: ${form.target}.`, today, JSON.stringify(steps(form)));
      }
    }

    // The lumped schedule is DEACTIVATED, never deleted — it is what generated
    // the history, and deleting it would orphan every task filed against it.
    // Its open task is cancelled with the reason on the record rather than left
    // in a cleaner's list beside the four that replace it.
    const old = findSched.get(LUMPED_TITLE);
    if (old?.is_active) {
      db.prepare('UPDATE pm_schedules SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(old.id);
      db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = 'system',
        notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now')
        WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`)
        .run('Replaced by one task per chemical, so each dilution is recorded and skipped on its own.', old.id);
    }
  })();

  if (created > 0) console.log(`[seed] Chemical dilution schedules: created ${created} (one per chemical, ${FORM_REVISION})`);
  return created;
}
