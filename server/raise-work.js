// ONE RAISE PATH FOR SCHEDULED WORK (single-spine move 05, D-377).
//
// Six calendars raise work orders — the PM recurrence and its backfill, quality
// schedules, document reviews, the 72-hour re-cleans, annual vendor reviews and
// stability pulls — and each had its own INSERT. Two of them carried the
// schedule's named owner onto the card and the rest did not, which is how the
// housekeeping backfill ("the path that actually keeps the task list full")
// raised tomorrow's daily with nobody on it while the manual Raise button put
// the owner back. One function now writes every one of them.
//
// TWO-LEVEL OWNERSHIP, and this file keeps both levels (D-094):
//   - the TEAM (`task_group`) is always set — the schedule's own, else the
//     generator's default — so the card reaches everyone in that department;
//   - the OWNER (`assigned_to` / `assigned_to_id`) is ADDITIVE: copied whenever
//     the source names one, left blank otherwise ("nobody in particular — the
//     whole team"). Nothing here ever invents an owner.
//
// What this does NOT decide: whether a card is owed. Each generator keeps its
// own guard (one live card per schedule, missed included; one per document,
// per flag, per review date, per pull). Training is not routed here — an
// assignment always names one person and deliberately has no team.
import { v4 as uuid } from 'uuid';
import { resolveUserId } from './person-links.js';

/** The team a generator's card goes to when its source names none. */
export const DEFAULT_TEAM = Object.freeze({
  pm: 'warehouse',
  quality: 'qa',
  document_review: 'document_control',
  reclean: 'cleaning',
  preop: 'cleaning',
  supplier_review: 'qa',
  stability: 'qa',
});

/**
 * WHO THE SOURCE SAYS OWNS THIS JOB, resolved to a name that is current today.
 * The id is the identity, the stored name a label (D-074): an owner renamed
 * since resolves to their CURRENT name, so the card matches them on both
 * columns. An owner with no account id falls back to the stored name. A source
 * that names nobody returns { id: null, name: null } — the whole team.
 */
export function scheduleAssignee(db, src) {
  const id = src?.assigned_to_id || null;
  if (id) {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
    if (u) return { id: u.id, name: u.name };
  }
  const name = src?.assigned_to || null;
  return { id: name ? resolveUserId(db, name) : null, name };
}

// The columns a raise may write. Listed once, so a generator cannot quietly
// write something the others do not know about.
const COLUMNS = [
  'pm_schedule_id', 'quality_schedule_id', 'document_id', 'supplier_qualification_id', 'stability_pull_id',
  'equipment_id', 'title', 'description', 'priority', 'due_date', 'procedure_steps', 'status',
];

/**
 * Insert one work order. `kind` picks the default team; `owner` is the row that
 * may name an owner (a PM or quality schedule) — omit it for a source that has
 * none. Returns { id, task_group, assigned_to, assigned_to_id }.
 */
export function raiseWorkOrder(db, kind, fields, { owner = null } = {}) {
  if (!DEFAULT_TEAM[kind]) throw new Error(`raiseWorkOrder: unknown kind "${kind}"`);
  const id = fields.id || uuid();
  const team = fields.task_group || DEFAULT_TEAM[kind];
  const who = owner ? scheduleAssignee(db, owner) : { id: null, name: null };
  const row = { status: 'open', ...fields };
  const cols = ['id', 'task_group'];
  const vals = [id, team];
  // The owner columns are written only when there is an owner: an unowned card
  // is exactly the insert it always was ("nobody in particular").
  if (who.name || who.id) { cols.push('assigned_to', 'assigned_to_id'); vals.push(who.name, who.id); }
  for (const c of COLUMNS) {
    if (row[c] === undefined) continue;
    cols.push(c); vals.push(row[c]);
  }
  db.prepare(`INSERT INTO work_orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  return { id, task_group: team, assigned_to: who.name, assigned_to_id: who.id };
}
