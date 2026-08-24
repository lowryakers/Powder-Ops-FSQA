// What counts as a completed PM, in one place.
//
// This existed in three copies that did not agree: the compliance dashboard's
// SQF card, the Task Center's own metrics, and the auditor binder reading the
// first of those. All three treated a CANCELLED work order as a miss — it sat
// in the denominator and not the numerator — so the plant's completion rate
// fell every time somebody tidied up. Standing a task down is a recorded
// decision (cleanup.js and duplicate-task-cleanup.js both demand a reason and
// audit it, pm.js writes one automatically for duplicates), and a decision not
// to do work is not a failure to do it.
//
// So `cancelled` joins `not_applicable`: out of BOTH halves of the fraction.
// It is reported separately as `stood_down` rather than folded away silently,
// because a number that moves for reasons the screen does not name is a number
// nobody can check.
//
// The rate is measured to YESTERDAY, not today: a task due this morning that
// nobody has got to yet is not late, and counting it drags the figure down for
// the whole of every working day.

/** Statuses that leave the fraction entirely — neither done nor missed. */
export const STOOD_DOWN = ['not_applicable', 'cancelled'];

const IN_LIST = `(${STOOD_DOWN.map(s => `'${s}'`).join(',')})`;

/** SQL fragment: rows that count toward the rate at all. */
export const COUNTED_SQL = `status NOT IN ${IN_LIST}`;
/** SQL fragment: rows deliberately stood down. */
export const STOOD_DOWN_SQL = `status IN ${IN_LIST}`;

/** The date the window closes — yesterday, for the reason above. */
export function rateCutoff(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * The rate itself. `extraWhere` lets a caller scope to a team without getting
 * a second opinion about what "completed" means.
 */
export function pmCompletion(db, { from, to, extraWhere = '', params = [] } = {}) {
  const where = `due_date BETWEEN ? AND ?${extraWhere}`;
  const count = (clause) =>
    db.prepare(`SELECT COUNT(*) AS c FROM work_orders WHERE ${where} AND ${clause}`).get(from, to, ...params).c;

  const total = count(COUNTED_SQL);
  const completed = count("status = 'completed'");
  const stoodDown = count(STOOD_DOWN_SQL);
  return {
    total,
    completed,
    stood_down: stoodDown,
    completion_rate: total > 0 ? parseFloat(((completed / total) * 100).toFixed(1)) : 0,
    meets_sqf_target: total > 0 && (completed / total) * 100 >= 95,
  };
}
