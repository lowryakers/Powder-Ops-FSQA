/**
 * DOES THIS CLEANING TASK OWE AN ATP SWAB, AND WHY?
 *
 * The task door grades an ATP reading and files it with its limit (`0bf4e75`,
 * OBL-32) — but the only screen that can SUPPLY a reading decided whether to
 * draw the box from a private title regex in `OperatorView.jsx`:
 *
 *   t.includes('pre-op') || t.includes('changeover') || t.includes('production line')
 *
 * Every title that matches was written by a SEEDER. The re-clean tasks this
 * app raises at RUNTIME match none of them:
 *
 *   `72h Re-clean — Room 7`
 *   `Re-clean — Room 6 (used since last clean)`
 *   `Re-clean — Room 7 (no clean on record)`
 *   `Re-clean — Room 1 (2 failed ATP swabs)`
 *
 * so all four fell through to the plain `cleaning` form, which has no ATP
 * field at all. The last one is the one that matters: it is raised BY two
 * failed swabs and exists to get a second one (D-036), and the chain it starts
 * can only be reset by a passing GRADED reading — which the cleaner holding
 * that task had no way to enter. She had to go and find the Sanitation form.
 *
 * This is the third time the same defect has been found in this codebase, and
 * each time in a different map: `recordAreaForTask()` was missing the two
 * runtime re-clean titles, `closeRecleanTasksFor` matched one by exact string,
 * and now the screen. **So this derives from the map that already exists**
 * rather than adding a fourth list of titles. `recordAreaForTask()` is the one
 * answer to "what does completing this task file, and where", and whether a
 * swab belongs is a fact about that area.
 *
 * REPORTED, NEVER REQUIRED. Nothing here blocks a completion. "A missing
 * reading is a gap, not a failure" is the rule the form door has always
 * followed (D-020) and the task door copies it line for line; this only puts
 * the box on the screen and says why it is there.
 */
import { recordAreaForTask } from './qa-records.js';
import { isRoomToken } from '../shared/rooms.js';
import { isAtpReclean } from '../shared/reclean-reasons.js';

/**
 * The same three-value vocabulary as `shared/clean-levels.js`, so "required"
 * means one thing across the app: the clean is defined by its swab and its
 * absence is a GAP in the record — not that the app will refuse the
 * completion. `optional` has no member here yet and is accepted rather than
 * dropped, because a clean that may or may not swab is a real category (a
 * Partial Clean is exactly that) and the renderer already handles it.
 */
export const SWAB_LEVELS = ['required', 'optional', 'none'];

/**
 * What a completed cleaning task should carry, or null when it carries no
 * swab at all.
 *
 * `null` is the answer for the restroom, the warehouse and the breakroom —
 * those cleans have never swabbed and drawing an ATP box on them would be the
 * wallpaper that gets a real one ignored — and for every task that is not a
 * clean. It is a different fact from `{ atp: 'none' }`, which nothing returns
 * today; the distinction is kept because "this is not a clean" and "this is a
 * clean that does not swab" are not the same sentence.
 */
export function swabPlanForTask(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  const area = recordAreaForTask(t);
  if (!area) return null;

  // The pre-op / changeover clean files under 'Production'; a re-clean files
  // under the room's own token. Both are production rooms and both swab.
  const isProduction = area === 'Production' || isRoomToken(area);
  if (!isProduction) return null;

  // The re-clean raised by two failed swabs is the one case that is not just
  // "a clean takes a swab" — it is a specific instruction, and the reading
  // entered here is what resets the chain.
  if (isAtpReclean(t)) {
    return { atp: 'required', reason: 'second_swab' };
  }
  return { atp: 'required', reason: 'production_clean' };
}

/** Stamp the plan onto task rows, beside `check_form`. */
export function attachSwabPlans(rows) {
  return rows.map(r => {
    const plan = swabPlanForTask(r.title);
    return plan ? { ...r, swab_plan: plan } : r;
  });
}
