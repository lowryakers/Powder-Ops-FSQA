/**
 * "What does this machine still need before it can run?"
 *
 * Adding equipment is the start of a chain of other records — a PM schedule,
 * somebody assigned to it, a LOTO procedure, a hygienic design verification, a
 * course people are trained on, the work instruction they're trained against.
 * Every one of those lives in a different module, and nothing on the Equipment
 * screen said they were owed. So a machine went in, and the PM schedule turned
 * up months later when someone noticed the task list was thin.
 *
 * TWO DECISIONS SHAPE THIS.
 *
 * 1. It is a CHECKLIST DERIVED FROM RECORDS, not a wizard. A wizard fires once,
 *    at the moment you least want it (you are adding eleven machines off a
 *    spreadsheet), and it can only ever help equipment added after it shipped.
 *    Reading the real tables answers the same question for the ~100 pieces
 *    already in the system, and keeps answering it after somebody retires the
 *    only LOTO procedure. Nothing is ticked by hand: a step is done when the
 *    record exists, so the list cannot claim work that was never done.
 *
 * 2. NOTHING IS AUTO-CREATED. It would be easy to write a PM schedule with a
 *    guessed frequency and an empty procedure the moment equipment is saved.
 *    That produces a compliance record asserting maintenance exists, which is
 *    worse than the gap it papers over — the gap is at least visible. Each step
 *    links to the module where the real thing is made, by a person who knows
 *    what belongs in it.
 *
 * `applies` keeps the list honest per row: a hand scoop has no lockout point,
 * a BPG inspection zone is not operated by anyone, and listing steps that will
 * never be done teaches people the checklist is noise.
 *
 * IT DECIDES THAT FROM COLUMNS, NOT FROM THE `type` STRING. The first cut kept
 * its own list of type names and so disagreed with `equipment.loto_required`,
 * which the LOTO module and the compliance badge had been reading all along.
 * `asset_kind` ('machine' | 'zone') and `loto_required` are the authorities;
 * shared/equipment-types.js only supplies the DEFAULTS applied when a row is
 * created, and the vocabulary the form offers.
 */
import { needsLoto, needsTraining, needsCalibration, isZone } from '../shared/equipment-types.js';


// `required` steps are what "ready" means. `recommended` ones are real, but a
// plant can reasonably run without them, and marking everything required is how
// a checklist stops distinguishing anything.
const STEPS = [
  {
    id: 'pm_schedule',
    label: 'Preventive maintenance schedule',
    why: 'Without one, this machine generates no maintenance tasks at all.',
    weight: 'required',
    link: { tab: 'pm' },
    applies: () => true,
    check: (db, eq) => {
      const n = db.prepare('SELECT COUNT(*) c FROM pm_schedules WHERE equipment_id = ? AND is_active = 1').get(eq.id).c;
      return { done: n > 0, detail: n ? `${n} active schedule${n === 1 ? '' : 's'}` : 'No PM schedule' };
    },
  },
  {
    id: 'pm_assignee',
    label: 'PM work assigned to a team',
    // A schedule with no task_group generates work orders that reach nobody's
    // list, which looks identical to having no schedule from the floor.
    why: 'A schedule with no team reaches nobody — the tasks generate and sit unseen.',
    weight: 'required',
    link: { tab: 'equipment' },
    applies: () => true,
    check: (db, eq) => ({
      done: !!eq.task_group,
      detail: eq.task_group ? `Assigned to ${eq.task_group}` : 'No team assigned',
    }),
  },
  {
    id: 'maintenance_tasks',
    label: 'Maintenance tasks written out',
    why: 'The steps the PM work order tells the technician to actually do.',
    weight: 'recommended',
    link: { tab: 'equipment' },
    applies: () => true,
    check: (db, eq) => {
      let tasks;
      try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { tasks = {}; }
      const n = Object.values(tasks).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      return { done: n > 0, detail: n ? `${n} task${n === 1 ? '' : 's'}` : 'No tasks written' };
    },
  },
  {
    id: 'loto',
    label: 'Lockout / tagout procedure',
    why: 'Anything with a stored energy source needs one before maintenance goes near it.',
    weight: 'required',
    link: { tab: 'loto' },
    // `equipment.loto_required` is the authority and defaults to 1 — the same
    // column the LOTO module and the compliance badge read. A zone never has
    // one; a machine is asked unless somebody has marked it not required.
    applies: (eq) => !isZone(eq) && needsLoto(eq),
    check: (db, eq) => {
      const n = db.prepare('SELECT COUNT(*) c FROM loto_procedures WHERE equipment_id = ? AND is_active = 1').get(eq.id).c;
      return { done: n > 0, detail: n ? `${n} procedure${n === 1 ? '' : 's'}` : 'No LOTO procedure' };
    },
  },
  {
    id: 'hygienic_design',
    label: 'Hygienic design verification',
    // The table already models this exactly — trigger_reason 'new_install'.
    why: 'Food-contact equipment is verified as cleanable before it is put into service.',
    weight: 'required',
    link: { tab: 'hygienic' },
    applies: (eq) => !!eq.is_food_contact && !isZone(eq),
    check: (db, eq) => {
      const row = db.prepare(`
        SELECT overall_result, trigger_reason FROM design_verifications
        WHERE equipment_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(eq.id);
      if (!row) return { done: false, detail: 'Never verified' };
      // Pending is not done — it is the record that somebody started.
      return {
        done: row.overall_result === 'approved' || row.overall_result === 'conditional',
        detail: row.overall_result === 'pending' ? 'Verification pending approval' : `Last result: ${row.overall_result}`,
      };
    },
  },
  {
    id: 'training_course',
    label: 'Training course',
    why: 'What operators are signed off on before they run it.',
    weight: 'required',
    link: { tab: 'training' },
    applies: (eq) => needsTraining(eq),
    check: (db, eq) => {
      const n = db.prepare('SELECT COUNT(*) c FROM training_courses WHERE equipment_id = ? AND active = 1').get(eq.id).c;
      return { done: n > 0, detail: n ? `${n} course${n === 1 ? '' : 's'}` : 'No course linked' };
    },
  },
  {
    id: 'training_material',
    label: 'Course material (manual or video)',
    why: 'The manual or video the course actually shows people.',
    weight: 'recommended',
    link: { tab: 'training' },
    applies: (eq) => needsTraining(eq),
    check: (db, eq) => {
      const n = db.prepare(`
        SELECT COUNT(*) c FROM training_materials m
        JOIN training_courses c ON m.course_id = c.id
        WHERE c.equipment_id = ?
      `).get(eq.id).c;
      return { done: n > 0, detail: n ? `${n} file${n === 1 ? '' : 's'}` : 'No material uploaded' };
    },
  },
  {
    id: 'work_instruction',
    label: 'Work instruction',
    why: 'The controlled document the training is given against.',
    weight: 'recommended',
    link: { tab: 'document-control' },
    applies: (eq) => needsTraining(eq),
    check: (db, eq) => {
      const n = db.prepare("SELECT COUNT(*) c FROM sop_documents WHERE equipment_id = ? AND status != 'archived'").get(eq.id).c;
      return { done: n > 0, detail: n ? `${n} document${n === 1 ? '' : 's'}` : 'No document linked' };
    },
  },
  {
    id: 'calibration',
    label: 'Calibration instrument record',
    why: 'Anything that measures needs a calibration interval and a history.',
    weight: 'required',
    link: { tab: 'calibration' },
    // Only things that measure. A blender is not out of compliance for having
    // no calibration record. See CALIBRATED_TYPES.
    applies: (eq) => needsCalibration(eq),
    check: (db, eq) => {
      const n = db.prepare('SELECT COUNT(*) c FROM calibration_instruments WHERE equipment_id = ?').get(eq.id).c;
      return { done: n > 0, detail: n ? 'Linked to a calibration instrument' : 'Not set up for calibration' };
    },
  },
  {
    id: 'haccp',
    label: 'HACCP CCP link',
    why: 'If this equipment is a control point, the record should say which one.',
    weight: 'recommended',
    link: { tab: 'equipment' },
    applies: (eq) => !!eq.is_food_contact && !isZone(eq),
    check: (db, eq) => ({
      done: !!eq.haccp_ccp_id,
      detail: eq.haccp_ccp_id ? 'Linked to a CCP' : 'No CCP linked',
    }),
  },
];

/**
 * The checklist for one piece of equipment.
 *
 * A step that errors is reported as unknown rather than as done — a readiness
 * screen that quietly marks a step complete because a query failed is worse
 * than one that admits it could not tell.
 */
export function equipmentReadiness(db, equipment) {
  const steps = STEPS.filter(s => s.applies(equipment)).map(s => {
    let result;
    try { result = s.check(db, equipment); }
    catch (e) { result = { done: false, unknown: true, detail: `Could not check (${e.message})` }; }
    return {
      id: s.id, label: s.label, why: s.why, weight: s.weight, link: s.link,
      done: !!result.done, unknown: !!result.unknown, detail: result.detail || '',
    };
  });
  const outstanding = steps.filter(s => !s.done);
  return {
    equipment_id: equipment.id,
    equipment_name: equipment.name,
    steps,
    total: steps.length,
    done: steps.length - outstanding.length,
    outstanding: outstanding.length,
    // What "ready" means. A machine missing only recommended steps is running
    // legitimately; one missing a required step is not.
    blocking: outstanding.filter(s => s.weight === 'required').length,
  };
}

/**
 * Counts for every piece of equipment in one pass, for the list badges.
 *
 * Bounded like every other list endpoint, and it runs the same `check`
 * functions rather than a second, faster copy of the same SQL — two definitions
 * of "has a PM schedule" is how a badge and the panel it opens start
 * disagreeing.
 */
export function readinessSummary(db, { limit = 500 } = {}) {
  const rows = db.prepare('SELECT * FROM equipment ORDER BY name LIMIT ?').all(limit);
  const out = {};
  for (const eq of rows) {
    const r = equipmentReadiness(db, eq);
    out[eq.id] = { outstanding: r.outstanding, blocking: r.blocking, total: r.total };
  }
  return out;
}

export { STEPS as READINESS_STEPS };
