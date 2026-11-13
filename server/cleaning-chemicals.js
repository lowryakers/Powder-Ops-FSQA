/**
 * WHICH CHEMICAL WAS USED ON THIS CLEAN (D-349).
 *
 * Completing a cleaning task files a Sanitation record (`recordAreaForTask`,
 * `fileQaInspectionRecord`). The Sanitation form a person fills by hand has
 * always asked for the chemicals (`sanitation_records.chemicals_used`) — but
 * the task's completion form never did, so every clean finished from a task
 * card (the warehouse, the restrooms, the breakroom, the Pre-Op, every
 * re-clean) filed with no chemical on it. Maria asked for Zuleika to record
 * the chemical per area; she had no box to do it in.
 *
 * Same shape as `swab_plan` (D-112): the SERVER says which tasks owe the
 * answer, from the one map that already says what a task files, and both
 * completion screens render what they are told. No list of titles anywhere.
 *
 * "No chemical used" is an answer (a dry sweep is a real clean). A blank is
 * not, and the completion is refused until one of the two is given.
 */
import { recordAreaForTask, recordGroupFor } from './qa-records.js';

/** The chemical categories a clean is done with. Lubricants and hand soap are not. */
export const CLEANING_CATEGORIES = ['sanitizer', 'cleaner', 'degreaser'];

/** `{ area }` when completing this task files a cleaning record, else null. */
export function chemicalPlanForTask(title) {
  const area = recordAreaForTask(title);
  if (!area || recordGroupFor(area) !== 'sanitation') return null;
  return { area };
}

export function attachChemicalPlans(rows) {
  return rows.map(r => {
    const plan = chemicalPlanForTask(r.title);
    return plan ? { ...r, chemical_plan: plan } : r;
  });
}

/** The approved chemicals a cleaner may pick, with where each may be used. */
export function cleaningChemicalOptions(db) {
  return db.prepare(`SELECT id, name, category, is_food_grade, location_for_use FROM approved_chemicals
    WHERE is_active = 1 AND category IN (${CLEANING_CATEGORIES.map(() => '?').join(',')})
    ORDER BY name`).all(...CLEANING_CATEGORIES)
    .map(c => ({ ...c, is_food_grade: !!c.is_food_grade }));
}

/**
 * Read `cleaning_chemicals: { ids: [], other: '', none: false }` off a
 * completion body. Returns:
 *   { missing: true }                         nothing answered
 *   { error }                                 an id that is not an active chemical
 *   { none: true, text: null, firstId: null } "No chemical used"
 *   { none: false, text, firstId, names }     what was used
 */
export function readChemicalAnswer(db, raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const ids = Array.isArray(v.ids) ? [...new Set(v.ids.map(String).filter(Boolean))] : [];
  const other = String(v.other || '').trim().slice(0, 200);
  if (v.none === true && !ids.length && !other) return { none: true, text: null, firstId: null, names: [] };
  if (!ids.length && !other) return { missing: true };
  const get = db.prepare('SELECT id, name FROM approved_chemicals WHERE id = ? AND is_active = 1');
  const picked = [];
  for (const id of ids) {
    const c = get.get(id);
    if (!c) return { error: `That chemical is not on the approved list any more (${id}). Pick it again.` };
    picked.push(c);
  }
  const names = [...picked.map(c => c.name), ...(other ? [other] : [])];
  return { none: false, text: names.join(', '), firstId: picked[0]?.id || null, names };
}
