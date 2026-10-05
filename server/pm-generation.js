// Which active schedules are raising work, and why the rest are not (D-142).
//
// "Daily forklift tasks are good, weekly are not generating" (Adam, 2 Oct). The
// generator (`markMissedWorkOrders`, run by housekeeping) raises a card for any
// active schedule with nothing outstanding — and SKIPS, without a word, a
// schedule whose machine is not in service, whose equipment row is gone (the
// inner join drops it), or whose title matches a card another schedule on the
// same machine already has (the same-job guard). Every one of those skips was
// correct and every one was invisible: a schedule "silently producing nothing"
// read exactly like a generator that had stopped.
//
// This module is the ONE answer, derived on every read and never stored. The
// generator and this sweep read the same three conditions, in the same order.

export const OUTSTANDING = "('open','in_progress','overdue','missed')";

export const REASONS = {
  equipment_missing: 'Its equipment record no longer exists, so the generator cannot see it.',
  equipment_inactive: 'Its machine is not in service, and an out-of-service machine raises nothing new.',
  same_job: 'Another schedule on the same machine with the same title already has a card out, and one card covers both.',
  pending: 'Nothing is outstanding and nothing stops it: the next housekeeping pass (within five minutes) raises its card.',
};

/**
 * Every active schedule with its state:
 *  { id, title, frequency_type, equipment_*, task_group, state: 'raising' | <reason>,
 *    card: { id, status, due_date } | null, blocking: { schedule_id, title, card_id } | null }
 * and a roll-up per frequency.
 */
export function generationSweep(db) {
  const rows = db.prepare(`SELECT ps.id, ps.title, ps.frequency_type, ps.task_group, ps.equipment_id,
      e.id AS eq_id, e.name AS equipment_name, e.asset_id, e.type AS equipment_type, e.status AS equipment_status
    FROM pm_schedules ps LEFT JOIN equipment e ON e.id = ps.equipment_id
    WHERE ps.is_active = 1 ORDER BY ps.frequency_type, e.name, ps.title`).all();
  const cardOf = db.prepare(`SELECT id, status, due_date FROM work_orders WHERE pm_schedule_id = ? AND status IN ${OUTSTANDING}
    ORDER BY due_date DESC LIMIT 1`);
  const sameJob = db.prepare(`SELECT wo.id, wo.pm_schedule_id, wo.title FROM work_orders wo
    WHERE wo.title = ? AND wo.status IN ${OUTSTANDING} AND wo.equipment_id = ? AND COALESCE(wo.pm_schedule_id, '') != ? LIMIT 1`);
  const out = [];
  for (const r of rows) {
    const card = cardOf.get(r.id) || null;
    let state = 'raising', blocking = null;
    if (!card) {
      if (!r.eq_id) state = 'equipment_missing';
      else if (r.equipment_status !== 'active') state = 'equipment_inactive';
      else {
        const b = sameJob.get(r.title, r.equipment_id, r.id);
        if (b) { state = 'same_job'; blocking = { schedule_id: b.pm_schedule_id, title: b.title, card_id: b.id }; }
        else state = 'pending';
      }
    }
    out.push({
      id: r.id, title: r.title, frequency_type: r.frequency_type, task_group: r.task_group,
      equipment_id: r.equipment_id, equipment_name: r.equipment_name || null, asset_id: r.asset_id || null,
      equipment_type: r.equipment_type || null, equipment_status: r.equipment_status || null,
      state, reason: state === 'raising' ? null : REASONS[state], card, blocking,
    });
  }
  const by_frequency = {};
  for (const s of out) {
    const f = (by_frequency[s.frequency_type] ||= { active: 0, raising: 0, not_raising: 0 });
    f.active++; s.state === 'raising' ? f.raising++ : f.not_raising++;
  }
  const silent = out.filter((s) => s.state !== 'raising');
  return { schedules: out, not_raising: silent, by_frequency, total: out.length, not_raising_count: silent.length };
}
