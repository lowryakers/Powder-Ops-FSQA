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

/* ── What a step was true against ─────────────────────────────────────────────
 *
 * MOST OF THIS CHECKLIST CANNOT GO STALE, and that is why the dependency model
 * here is three edges rather than the seven the product one needs. Every step
 * below is a LIVE COUNT of records — "is there a LOTO procedure right now",
 * "is there an active schedule right now" — so retiring the procedure flips the
 * step back to outstanding by itself. Nothing to remember, nothing to expire.
 *
 * Three of them are different: they are an assertion made ABOUT THE MACHINE AS
 * IT WAS, and the machine can change underneath them.
 *
 *   · A hygienic design verification says this equipment is cleanable. Swap the
 *     model, or start calling it food-contact, and what was verified is not
 *     what is standing there.
 *   · A LOTO procedure lists this machine's energy isolation points. A
 *     different model is different points.
 * The PM schedule was a candidate and is DELIBERATELY NOT ONE: schedules are
 * generated from `maintenance_tasks`, but `syncMaintenanceTasksToPM` already
 * pushes an edit straight into every active schedule and its open work orders,
 * so the step genuinely is up to date and flagging it would be a warning that
 * fires when nothing is wrong. Checked before adding the edge, not assumed.
 *
 * The rules are the ones product readiness already follows: a fact absent from
 * what was recorded can never read as changed (the first-sight rule), a step
 * that stops being satisfied drops its basis, and a stale step is NOT done.
 */
const FACTS = {
  // What the machine IS. A relabel and a replacement are indistinguishable from
  // here, so both are treated as "look at this again" — the honest side to err
  // on for a lockout procedure.
  machine: (eq) => `${eq.type || ''}|${eq.model_number || ''}|${eq.serial_number || ''}`,
  food_contact: (eq) => (eq.is_food_contact ? '1' : '0'),
};

const FACT_LABEL = {
  machine: 'the model or serial number',
  food_contact: 'whether it is food-contact',
};

/** Only the steps that can be out of date, and what puts them there. */
const DEPENDS = {
  hygienic_design: ['machine', 'food_contact'],
  loto: ['machine'],
};

function parseBasis(raw) {
  return (() => {
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  })();
}

function fingerprint(stepId, eq) {
  const out = {};
  for (const f of DEPENDS[stepId] || []) out[f] = FACTS[f](eq);
  return out;
}

/** Which recorded dependencies have moved. Absent ones are never "changed". */
function movedSince(stepId, eq, recorded) {
  const out = [];
  for (const f of DEPENDS[stepId] || []) {
    if (!recorded || !(f in recorded)) continue;
    if (FACTS[f](eq) !== recorded[f]) out.push(f);
  }
  return out;
}

/**
 * Record what each satisfied step is true against.
 *
 * Called from the four write paths that can satisfy one of the three: the
 * equipment edit itself, a LOTO procedure being written, a design verification
 * being decided, and schedules being generated from the tasks. `changedColumns`
 * is what makes it precise — writing a column the step OWNS means the work was
 * re-done and the basis moves with it; writing anything else leaves the basis
 * alone so the step can go stale.
 *
 * A step already satisfied with NO recorded basis adopts the current facts
 * silently. That is the first-sight rule, and it is what stops the deploy that
 * ships this lighting up every machine in the plant at once.
 */
const OWNS = {
  hygienic_design: ['hygienic_design'],
  loto: ['loto'],
};

export function stampEquipmentReadiness(db, equipmentId, changedColumns = [], who = null) {
  let eq;
  try { eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipmentId); } catch { return; }
  if (!eq) return;
  const basis = parseBasis(eq.readiness_basis);
  const touched = new Set(changedColumns);
  const now = new Date().toISOString();
  for (const step of STEPS) {
    if (!DEPENDS[step.id]) continue;
    if (!step.applies(eq)) { delete basis[step.id]; continue; }
    const done = (() => { try { return !!step.check(db, eq).done; } catch { return false; } })();
    if (!done) { delete basis[step.id]; continue; }
    const redone = (OWNS[step.id] || []).some((c) => touched.has(c));
    if (basis[step.id] && !redone) continue;   // leave it, so it can go stale
    basis[step.id] = { at: basis[step.id] && !redone ? basis[step.id].at : now, by: who, deps: fingerprint(step.id, eq) };
  }
  try { db.prepare('UPDATE equipment SET readiness_basis = ? WHERE id = ?').run(JSON.stringify(basis), equipmentId); }
  catch { /* column optional on an older database */ }
}


// `required` steps are what "ready" means. `recommended` ones are real, but a
// plant can reasonably run without them, and marking everything required is how
// a checklist stops distinguishing anything.
const STEPS = [
  {
    id: 'pm_schedule',
    // TWO DIFFERENT THINGS SHARE THE WORDS "PM SCHEDULE" and it reads as a bug
    // when they disagree: `equipment.maintenance_tasks` is the task LIST the
    // detail panel prints under "Preventive Maintenance Schedule", while a
    // `pm_schedules` row is the RECURRING SCHEDULE that actually generates work
    // orders. A machine can have thirteen tasks written and generate nothing,
    // which is exactly what the A/C looked like — a screen showing four
    // frequency cards above a step insisting there was no schedule. The label
    // and the detail now name the difference instead of restating it.
    label: 'Recurring PM schedule (generates the tasks)',
    why: 'Writing the tasks out is not the same as scheduling them — without a recurring schedule nothing is ever generated.',
    weight: 'required',
    link: { tab: 'pm' },
    applies: () => true,
    check: (db, eq) => {
      const n = db.prepare('SELECT COUNT(*) c FROM pm_schedules WHERE equipment_id = ? AND is_active = 1').get(eq.id).c;
      if (n) return { done: true, detail: `${n} recurring schedule${n === 1 ? '' : 's'}` };
      let tasks;
      try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { tasks = {}; }
      const written = Object.values(tasks).reduce((t, arr) => t + (Array.isArray(arr) ? arr.length : 0), 0);
      return {
        done: false,
        detail: written
          ? `${written} task${written === 1 ? '' : 's'} written, but nothing generates them`
          : 'No recurring schedule',
      };
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
    why: 'The steps a generated work order tells the technician to actually do.',
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
      // One WI covers several identical machines, so the link is a SET
      // (equipment_ids) with equipment_id mirroring its first entry. Both are
      // read: a document linked to eleven vacuums must answer for the eleventh
      // as readily as for the first, and documents written before the set
      // existed carry only the scalar.
      const n = db.prepare(`SELECT COUNT(*) c FROM sop_documents d
        WHERE d.status != 'archived'
          AND (d.equipment_id = ? OR EXISTS (
                SELECT 1 FROM json_each(d.equipment_ids) WHERE json_each.value = ?))`).get(eq.id, eq.id).c;
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
  // Steps this machine has been told don't apply. Read once rather than per
  // step — the roll-up runs this over every row.
  let waivers = {};
  try {
    for (const w of db.prepare('SELECT step_id, reason, waived_by, waived_at FROM equipment_step_waivers WHERE equipment_id = ?').all(equipment.id)) {
      waivers[w.step_id] = w;
    }
  } catch { waivers = {}; }

  const basis = parseBasis(equipment.readiness_basis);

  const steps = STEPS.filter(s => s.applies(equipment)).map(s => {
    const waiver = waivers[s.id];
    // A waived step is NOT removed from the list. It stays, reading "not
    // applicable" with the reason and who decided — the record of the decision
    // is the point, and a step that silently disappeared could never be
    // questioned or undone.
    if (waiver) {
      return {
        id: s.id, label: s.label, why: s.why, weight: s.weight, link: s.link,
        done: false, unknown: false, waived: true, stale: false, changed: [], changed_labels: [],
        waiver_reason: waiver.reason, waived_by: waiver.waived_by, waived_at: waiver.waived_at,
        detail: `Not applicable — ${waiver.reason}`,
      };
    }
    let result;
    try { result = s.check(db, equipment); }
    catch (e) { result = { done: false, unknown: true, detail: `Could not check (${e.message})` }; }
    // Done, but something it was recorded against has since moved. A STALE STEP
    // IS NOT DONE: it goes back on the outstanding list naming what changed,
    // because that is the only way anyone finds out.
    const moved = result.done ? movedSince(s.id, equipment, basis[s.id]?.deps) : [];
    return {
      id: s.id, label: s.label, why: s.why, weight: s.weight, link: s.link,
      done: !!result.done && moved.length === 0,
      unknown: !!result.unknown, waived: false,
      stale: moved.length > 0,
      changed: moved,
      changed_labels: moved.map((f) => FACT_LABEL[f] || f),
      detail: moved.length
        ? `Needs re-checking — ${moved.map((f) => FACT_LABEL[f] || f).join(' and ')} changed since`
        : (result.detail || ''),
    };
  });
  // Waived steps are not outstanding — that is the whole point of waiving one —
  // but they are not "done" either, so the counts say `total` minus waived
  // rather than pretending the work happened.
  const outstanding = steps.filter(s => !s.done && !s.waived);
  const waived = steps.filter(s => s.waived).length;
  return {
    equipment_id: equipment.id,
    equipment_name: equipment.name,
    steps,
    total: steps.length,
    waived,
    // "done" counts only work that actually happened; a waived step is neither
    // done nor owed, so it comes out of the denominator instead.
    done: steps.filter(s => s.done).length,
    applicable: steps.length - waived,
    outstanding: outstanding.length,
    // Named separately from the rest of the outstanding work: "three things
    // were never done" and "three things were done and something moved
    // underneath them" are different problems needing different attention.
    stale: steps.filter(s => s.stale).map(s => s.label),
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
