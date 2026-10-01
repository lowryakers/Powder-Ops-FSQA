// Which machines a consolidated daily checklist covers (D-138).
//
// PM consolidation v1 (22 July, server.js) folded per-machine DAILY schedules
// into one checklist per (team, room): one schedule, one line per machine,
// `Machine name #ASSET — tasks`. The schedule row can only carry ONE
// `equipment_id`, so it was hung on the first machine folded — the "anchor" —
// and every other machine on it has no schedule of its own.
//
// EVERYTHING THAT READ `pm_schedules.equipment_id` TOOK THAT LITERALLY, and
// each reader was wrong in its own direction:
//  - the anchor's own edits wrote over the checklist: saving the anchor's task
//    list replaced all N machines' lines with the anchor's Daily list, and
//    re-routing the anchor's team re-routed the whole room's checklist;
//  - every OTHER machine read as unscheduled: the setup checklist said
//    "nothing generates them", and "Create schedules from these tasks" offered
//    each one a Daily PM of its own — a second daily task for a machine that
//    already has a line on the room checklist;
//  - and a per-point schedule brought back later (the Temp & Humidity repair,
//    which reactivated Production 1 and 2 and left "Daily PM Checklist —
//    Production (Qa)" running beside them) is the same check on the floor twice,
//    the merged one with no form number and filing no record.
//
// This module is the ONE answer to "which machines does this checklist cover",
// read from the lines themselves. Every reader asks it.

export const CONSOLIDATED_LIKE = 'Consolidated daily checks%';
export const isConsolidated = (s) => /^Consolidated daily checks/.test(String(s?.description || ''));

/** The machine label at the head of a checklist line, or null. */
export function lineLabel(step) {
  if (typeof step !== 'string') return null;
  const i = step.indexOf(' — ');
  return i > 0 ? step.slice(0, i).trim() : null;
}

/**
 * Resolve a line's label to equipment ids. The asset number is the stable part
 * (`#QA-TH-011`) — equipment NAMES were normalised after consolidation ran — so
 * it is tried first; a label with no asset number matches on the exact name.
 * Two rows sharing an asset number are both returned: they are the duplicate
 * entries consolidation (a) already found, and either may hold the schedule.
 */
function resolveLabel(db, label) {
  const m = label.match(/#(\S+)$/);
  if (m) {
    const rows = db.prepare('SELECT id FROM equipment WHERE asset_id = ?').all(m[1]);
    if (rows.length) return rows.map((r) => r.id);
  }
  const name = m ? label.slice(0, m.index).trim() : label;
  return db.prepare('SELECT id FROM equipment WHERE name = ?').all(name).map((r) => r.id);
}

/**
 * Every ACTIVE consolidated checklist with its lines resolved:
 * `[{ schedule, steps, lines: [{ index, step, label, equipment_ids }] }]`.
 */
export function consolidatedChecklists(db, { includeInactive = false } = {}) {
  const rows = db.prepare(`SELECT * FROM pm_schedules WHERE description LIKE ?
    ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY title`).all(CONSOLIDATED_LIKE);
  return rows.map((s) => {
    let steps;
    try { steps = JSON.parse(s.procedure_steps || '[]'); } catch { steps = []; }
    if (!Array.isArray(steps)) steps = [];
    const lines = steps.map((step, index) => {
      const label = lineLabel(step);
      return { index, step, label, equipment_ids: label ? resolveLabel(db, label) : [] };
    });
    return { schedule: s, steps, lines };
  });
}

/**
 * Map equipment id → the active checklists that carry a line for it.
 * The anchor is included only when it actually has a line (it normally does).
 */
export function checklistCoverage(db) {
  const map = new Map();
  for (const c of consolidatedChecklists(db)) {
    for (const l of c.lines) {
      for (const id of l.equipment_ids) {
        if (!map.has(id)) map.set(id, []);
        if (!map.get(id).some((x) => x.id === c.schedule.id)) {
          map.get(id).push({ id: c.schedule.id, title: c.schedule.title, frequency_type: c.schedule.frequency_type, task_group: c.schedule.task_group });
        }
      }
    }
  }
  return map;
}

// The readiness roll-up asks this once per machine — ~180 times per badge
// refresh — and the answer only moves when a checklist's lines do. A walk is
// kept for two seconds per database; write paths call checklistCoverage().
const recent = new WeakMap();
/** The checklists covering ONE machine. */
export function checklistsCovering(db, equipmentId) {
  const hit = recent.get(db);
  const now = Date.now();
  const map = hit && now - hit.at < 2000 ? hit.map : checklistCoverage(db);
  if (!hit || hit.map !== map) recent.set(db, { at: now, map });
  return map.get(equipmentId) || [];
}

const REASON_PAUSE = 'Every machine on this room checklist has its own daily schedule again, so the checklist '
  + 'was the same check a second time (D-138). Paused, not deleted — the per-machine task is the one to do.';
const OUTSTANDING = "('open','in_progress','overdue','missed')";

/**
 * A line is a DUPLICATE when its machine has its OWN active daily schedule
 * (one that is not itself a consolidated checklist). The checklist "replaces
 * the individual daily PM tasks" — that was its whole description — so a
 * machine with both is tracked twice.
 *
 *  - Duplicate lines come off the checklist and off its outstanding cards.
 *  - A checklist left with no lines is PAUSED (never deleted: it is the record
 *    of what was done under it) and its outstanding cards — missed included —
 *    are cancelled with the reason on each, the D-125 shape. Completed work is
 *    left exactly as filed.
 *
 * Idempotent by construction: a second run finds no line with a twin.
 * Returns what it did, per checklist, for the boot log and the verify.
 */
export function repairChecklistOverlap(db, logAudit) {
  const own = db.prepare(`SELECT id, title, task_group FROM pm_schedules WHERE equipment_id = ? AND is_active = 1
    AND frequency_type = 'daily' AND (description IS NULL OR description NOT LIKE ?)`);
  const report = [];
  const tx = db.transaction(() => {
    for (const c of consolidatedChecklists(db)) {
      const dup = [];
      for (const l of c.lines) {
        const twins = l.equipment_ids.flatMap((id) => own.all(id, CONSOLIDATED_LIKE));
        if (twins.length) dup.push({ ...l, twins: twins.map((t) => t.title) });
      }
      if (!dup.length) continue;
      const drop = new Set(dup.map((d) => d.index));
      const kept = c.steps.filter((_, i) => !drop.has(i));
      const s = c.schedule;
      const entry = { id: s.id, title: s.title, removed: dup.map((d) => ({ line: d.label, own_schedule: d.twins })), kept: kept.length, paused: false, cancelled: 0 };
      if (kept.length) {
        const json = JSON.stringify(kept);
        db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(json, s.id);
        db.prepare(`UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ${OUTSTANDING}`).run(json, s.id);
      } else {
        db.prepare("UPDATE pm_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
        entry.paused = true;
        const open = db.prepare(`SELECT id, title FROM work_orders WHERE pm_schedule_id = ? AND status IN ${OUTSTANDING}`).all(s.id);
        for (const w of open) {
          db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = 'ReadyDoc',
            notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`).run(REASON_PAUSE, w.id);
          logAudit?.('system', 'update', 'work_order', w.id, { status: 'cancelled', reason: REASON_PAUSE }, null, null, w.title);
          entry.cancelled++;
        }
      }
      logAudit?.('system', 'update', 'pm_schedule', s.id,
        { reason: 'consolidated_checklist_overlap', removed_lines: entry.removed, paused: entry.paused, cancelled: entry.cancelled },
        { procedure_steps: c.steps }, { procedure_steps: kept, is_active: entry.paused ? 0 : s.is_active }, s.title);
      report.push(entry);
    }
  });
  tx();
  return report;
}
