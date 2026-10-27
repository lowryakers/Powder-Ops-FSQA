// Cards on the wrong list, closed at the source (D-218). Read with `server/task-routing.js`, the
// read-only report that found every one of these on the live database on 27 October.
//
// Nothing here is deleted. A schedule is PAUSED (resumable) and an outstanding card is CANCELLED with
// the reason on it — the D-139 shape — and completed work is never touched.
import { consolidatedChecklists, CONSOLIDATED_LIKE } from './pm-coverage.js';
import { closeScheduleWork, CLOSABLE } from './pm-pause.js';

const MACHINE_TEAMS = new Set(['maintenance', 'warehouse']);
const MACHINE_CARE = /\bPM\b|preventive maintenance|lubricat|grease/i;

function pause(db, s, why, logAudit) {
  db.prepare("UPDATE pm_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
  const reason = `Closed because "${s.title}" was paused by ReadyDoc on ${new Date().toISOString().slice(0, 10)} — ${why}`;
  const closed = closeScheduleWork(db, s.id, { reason, logAudit });
  logAudit?.('system', 'update', 'pm_schedule', s.id, { reason: why, paused: true, closed_work: closed.cancelled },
    { is_active: 1 }, { is_active: 0 }, s.title);
  return { id: s.id, title: s.title, why, cancelled: closed.cancelled };
}

/**
 * A room checklist with NO lines is a card that asks for nothing. An old task-list save wrote an
 * empty list over three of them (the anchor had no Daily tasks), and they went on raising a blank
 * card every day — "Daily PM Checklist — Production (Qa)" on QA's list was one. EVERY BOOT: a
 * checklist somebody fills in again is no longer empty, and one resumed empty is still nothing.
 */
export function pauseEmptyChecklists(db, logAudit) {
  const out = [];
  db.transaction(() => {
    for (const c of consolidatedChecklists(db)) {
      if (c.steps.length) continue;
      out.push(pause(db, c.schedule, 'this room checklist has no lines left, so its card asked for nothing (D-218).', logAudit));
    }
  })();
  return out;
}

/** Outstanding PM cards for one machine that is no longer in service. */
export function closeEquipmentWork(db, equipmentId, { by = 'ReadyDoc', status, logAudit } = {}) {
  const rows = db.prepare(`SELECT id, title, status FROM work_orders WHERE equipment_id = ? AND pm_schedule_id IS NOT NULL
    AND status IN ${CLOSABLE}`).all(equipmentId);
  const reason = `Closed because the equipment was set to "${status || 'out of service'}" on ${new Date().toISOString().slice(0, 10)}. `
    + 'A machine that is not in service raises no new PM work, and the cards it had already raised are closed with it (D-218).';
  const cancel = db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = ?,
    notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`);
  for (const w of rows) {
    cancel.run(by, reason, w.id);
    logAudit?.(by === 'ReadyDoc' ? 'system' : by, 'cancel', 'work_order', w.id, { reason, was: w.status, equipment_id: equipmentId }, null, null, w.title);
  }
  return rows.length;
}

/**
 * ONCE PER DATABASE (the caller's marker), so anything a person resumes afterwards stays resumed:
 *  - a room checklist folded for a team that is not Maintenance or Warehouse whose lines name no
 *    machine on the register (the Kitting scale leftover; QA's and Cleaning's checks file their own
 *    records, D-138);
 *  - a machine PM on an AREA (asset_kind zone): a monitoring point or inspection zone has no motor;
 *  - the second of two identical active schedules (same machine, title and cadence) — oldest kept;
 *  - outstanding PM cards left by a paused schedule or by equipment no longer in service.
 */
export function routingCleanupOnce(db, logAudit) {
  const r = { paused: [], equipment_cards: 0, paused_schedule_cards: 0 };
  db.transaction(() => {
    for (const c of consolidatedChecklists(db)) {
      if (MACHINE_TEAMS.has(c.schedule.task_group) || !c.steps.length) continue;
      if (c.lines.some(l => l.equipment_ids.length)) continue;
      r.paused.push(pause(db, c.schedule, 'a room checklist for a team whose daily checks file their own records, and none of its lines names a machine on the register (D-218).', logAudit));
    }
    const zonePms = db.prepare(`SELECT ps.id, ps.title FROM pm_schedules ps JOIN equipment e ON e.id = ps.equipment_id
      WHERE ps.is_active = 1 AND e.asset_kind = 'zone' AND (ps.description IS NULL OR ps.description NOT LIKE ?)`).all(CONSOLIDATED_LIKE)
      .filter(s => MACHINE_CARE.test(s.title));
    for (const s of zonePms) r.paused.push(pause(db, s, 'a machine PM on an area (a zone has no machine to service); the area keeps its own inspection (D-218).', logAudit));
    const dups = db.prepare(`SELECT equipment_id, title, frequency_type FROM pm_schedules WHERE is_active = 1
      AND (description IS NULL OR description NOT LIKE ?) GROUP BY equipment_id, title, frequency_type HAVING COUNT(*) > 1`).all(CONSOLIDATED_LIKE);
    for (const d of dups) {
      const rows = db.prepare(`SELECT id, title FROM pm_schedules WHERE is_active = 1 AND equipment_id = ? AND title = ? AND frequency_type = ?
        ORDER BY created_at, id`).all(d.equipment_id, d.title, d.frequency_type);
      for (const s of rows.slice(1)) r.paused.push(pause(db, s, 'a second copy of the same schedule on the same machine; the older one keeps running (D-218).', logAudit));
    }
    for (const s of db.prepare(`SELECT DISTINCT ps.id, ps.title FROM pm_schedules ps JOIN work_orders w ON w.pm_schedule_id = ps.id
      WHERE ps.is_active = 0 AND w.status IN ${CLOSABLE}`).all()) {
      r.paused_schedule_cards += closeScheduleWork(db, s.id, {
        reason: `Closed because "${s.title}" is paused. Pausing closes what a schedule raised (D-139); these cards predate that rule (D-218).`, logAudit }).cancelled;
    }
    for (const e of db.prepare(`SELECT DISTINCT e.id, e.status FROM equipment e JOIN work_orders w ON w.equipment_id = e.id
      WHERE e.status != 'active' AND w.pm_schedule_id IS NOT NULL AND w.status IN ${CLOSABLE}`).all()) {
      r.equipment_cards += closeEquipmentWork(db, e.id, { status: e.status, logAudit });
    }
  })();
  return r;
}
