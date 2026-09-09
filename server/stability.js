// Stability studies and their pulls (CAR 4990683-9) — the parts that are not
// a router: planning the pulls from a study, raising the pull tasks, and
// reading what is missed. PURE where it can be (planPulls), reads where it
// must (pullStatus), one writer for the tasks.
//
// A pull is PRE-CREATED for every pull month when the study is filed. That is
// what makes a missed pull visible: a row past its due date with nothing
// pulled is the miss, and nothing has to remember to raise it. The task for a
// pull is raised LEAD_DAYS ahead (the supplier-review shape), idempotent on
// the pull's own work_order_id.

import { randomUUID as uuid } from 'crypto';

export const LEAD_DAYS = 14;
const dayStr = (d) => d.toISOString().slice(0, 10);

/** Add whole months to an ISO date, clamping to the month's last day. */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

/** The pull rows a study implies — PURE. */
export function planPulls(study) {
  const months = [...new Set((study.pull_months || []).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
  return months.map(m => ({ pull_month: m, due_date: addMonths(study.start_date, m) }));
}

/** A pull's read-time state: planned / tasked / missed / pulled / resulted. */
export function pullState(p, today = dayStr(new Date())) {
  if (p.status === 'resulted') return 'resulted';
  if (p.status === 'pulled') return 'pulled';
  if (p.status === 'skipped') return 'skipped';
  if (p.due_date < today) return 'missed';
  return p.work_order_id ? 'tasked' : 'planned';
}

/**
 * Raise a work order for every pull that falls within LEAD_DAYS (or is
 * already past) on an active study and has no task yet.
 */
export function generateStabilityPullTasks(db, { today = dayStr(new Date()) } = {}) {
  const horizon = dayStr(new Date(Date.parse(today) + LEAD_DAYS * 86400000));
  let rows;
  try {
    rows = db.prepare(`SELECT p.*, s.title AS study_title, s.product_family, s.condition, s.tests, s.retention_sample_id, s.lot_number
      FROM stability_pulls p JOIN stability_studies s ON s.id = p.study_id
      WHERE p.status = 'planned' AND p.work_order_id IS NULL AND s.status = 'active' AND p.due_date <= ?
      ORDER BY p.due_date`).all(horizon);
  } catch { return { created: 0 }; }
  if (!rows.length) return { created: 0 };
  const ins = db.prepare(`INSERT INTO work_orders
    (id, equipment_id, title, description, priority, due_date, procedure_steps, task_group, status, stability_pull_id)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'qa', 'open', ?)`);
  const stamp = db.prepare("UPDATE stability_pulls SET work_order_id = ?, updated_at = datetime('now') WHERE id = ?");
  let created = 0;
  db.transaction(() => {
    for (const p of rows) {
      const woId = uuid();
      const overdue = p.due_date < today;
      ins.run(woId,
        `Stability pull — ${p.study_title} — ${p.pull_month} month${p.pull_month === 1 ? '' : 's'}`,
        `Pull the ${p.pull_month}-month sample for the ${p.condition === 'accelerated' ? 'accelerated' : 'real-time'} stability study "${p.study_title}"`
          + `${p.lot_number ? ` (lot ${p.lot_number})` : ''}. Due ${p.due_date}${overdue ? ' (overdue)' : ''}.`
          + `${p.tests ? ` Tests: ${p.tests}.` : ''} Record what was pulled and where it went; the result is entered on the study when the laboratory reports.`,
        overdue ? 'high' : 'normal', p.due_date,
        JSON.stringify(['Pull the sample from the retention box named on the study', 'Record the quantity pulled and the laboratory it goes to', 'Enter the result on the study when it comes back']),
        p.id);
      stamp.run(woId, p.id);
      created++;
    }
  })();
  return { created };
}

/** What is missed, due and awaiting a result — one walk, used by the screen and the review. */
export function stabilityStatus(db, { today = dayStr(new Date()) } = {}) {
  const pulls = db.prepare(`SELECT p.*, s.title AS study_title, s.status AS study_status FROM stability_pulls p
    JOIN stability_studies s ON s.id = p.study_id WHERE s.status IN ('active','planned')`).all();
  const states = pulls.map(p => ({ ...p, state: pullState(p, today) }));
  return {
    missed: states.filter(p => p.state === 'missed'),
    awaiting_result: states.filter(p => p.state === 'pulled'),
    upcoming: states.filter(p => (p.state === 'planned' || p.state === 'tasked') && p.due_date <= dayStr(new Date(Date.parse(today) + 60 * 86400000))),
    today,
  };
}
