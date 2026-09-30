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

/* ── The shelf-life BASIS, and the date type derived from it (D-133) ─────────
 *
 * CAR 4990683-9's rule: an EXPIRATION date only where stability data covers
 * the SKU; otherwise BEST BY. The data is the client's, an in-house study's,
 * or read across from a covered SKU; "none" is a recorded decision that the
 * pack prints Best by. The kind lives on the justification that is in force
 * for the SKU (the most recent one naming it — currentJustifications), and
 * the date type is DERIVED from it on every read. It is never stored on the
 * product: a column there is the second owner of this fact, and the day a
 * newer justification lands the two disagree.
 *
 * NOTHING IS BACKFILLED. A SKU no justification names reads `recorded: false`
 * and best by — the rule's own answer for "no data" — and Completeness names
 * it as a gap. A justification filed before the kind existed reads
 * `kind_missing` (best by, still): free text nobody classified is not data
 * the app may promote to an expiration date.
 */
export const BASIS_KINDS = ['client_data', 'in_house_study', 'read_across', 'none_best_by'];
export const BASIS_KIND_LABEL = {
  client_data: 'Client stability data',
  in_house_study: 'In-house stability study',
  read_across: 'Read across from a covered SKU',
  none_best_by: 'No data — Best by',
};
/** The date type a kind permits: data ⇒ expiration; none, or no kind ⇒ best by. */
export const dateTypeFor = (kind) => (kind && kind !== 'none_best_by' && BASIS_KINDS.includes(kind) ? 'expiration' : 'best_by');
export const DATE_TYPE_LABEL = { expiration: 'Expiration date', best_by: 'Best by' };

/**
 * The basis in force for each SKU is the MOST RECENT justification naming it —
 * derived on read, never a stored flag. A later justification for one SKU of a
 * family does not unsay the earlier one for the rest of the family; each row
 * reports `current_for`, the SKUs it still speaks for.
 */
export function currentJustifications(db) {
  const rows = db.prepare('SELECT * FROM stability_justifications ORDER BY decided_on DESC, created_at DESC, rowid DESC').all()
    .map(j => ({ ...j, skus: JSON.parse(j.product_skus || '[]') }));
  const claimed = new Set();
  for (const j of rows) {
    j.current_for = j.skus.filter(k => !claimed.has(k));
    for (const k of j.current_for) claimed.add(k);
    // A pre-D-133 row linked to a study IS an in-house study; anything else
    // unclassified stays unclassified.
    j.kind = j.basis_kind || (j.basis_type === 'study' ? 'in_house_study' : null);
    j.date_type = dateTypeFor(j.kind);
  }
  return rows;
}

/** What a SKU with nothing on file reads: the rule's answer for no data. */
export const NO_BASIS = Object.freeze({ recorded: false, basis_kind: null, kind_missing: false, date_type: 'best_by', shelf_life_months: null, justification_id: null, decided_on: null, decided_by: null });

/** sku → { recorded, basis_kind, kind_missing, date_type, shelf_life_months, justification_id, decided_on, decided_by }. One walk for the whole catalogue. */
export function shelfLifeBasis(db) {
  const out = new Map();
  const rows = (() => { try { return currentJustifications(db); } catch { return []; } })();
  for (const j of rows) {
    for (const sku of j.current_for) {
      out.set(sku, {
        recorded: true, basis_kind: j.kind, kind_missing: !j.kind, date_type: j.date_type,
        shelf_life_months: j.shelf_life_months, justification_id: j.id, decided_on: j.decided_on, decided_by: j.decided_by,
      });
    }
  }
  return out;
}
/** One SKU's basis, or the no-data answer. */
export const shelfLifeFor = (db, sku) => shelfLifeBasis(db).get(String(sku || '').toUpperCase()) || NO_BASIS;
