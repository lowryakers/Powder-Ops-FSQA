// Pausing a recurring schedule closes what it already raised (D-139).
//
// D-012 said retiring a program is two acts — stop it raising work, close what
// it raised — and only the first had a button. D-055 made the pause REPORT the
// work it left behind and pointed at Cleanup Review. In practice the second act
// never happened: Lowry paused the Daily Scale PMs in Settings and on 1 October
// the Operator View still carried their cards, 38 days missed, because the
// Operator View lists work orders by status and a paused schedule's cards keep
// their status for ever. From the floor, the pause looked like it did nothing.
//
// So the pause is now BOTH acts, in one transaction:
//  - `is_active = 0` stops new work (the generator already filters on it);
//  - every card the schedule raised that is still OPEN, OVERDUE or MISSED is
//    CANCELLED with the reason on it — never deleted: a cancelled card is the
//    record that the work was stood down, by whom and why (the D-125 shape).
//  - A card somebody has STARTED (`in_progress`) is left alone and counted:
//    a person is in the middle of it, and the screen says so.
// Completed work is history and is never touched. Resuming the schedule raises
// a fresh card through the ordinary generator.

import { consolidatedChecklists, CONSOLIDATED_LIKE } from './pm-coverage.js';

export const CLOSABLE = "('open','overdue','missed')";

/** Cancel what a schedule left outstanding. Returns { cancelled, in_progress }. */
export function closeScheduleWork(db, scheduleId, { by = 'ReadyDoc', reason, logAudit } = {}) {
  const rows = db.prepare(`SELECT id, title, status FROM work_orders WHERE pm_schedule_id = ? AND status IN ${CLOSABLE}`).all(scheduleId);
  const cancel = db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = ?,
    notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`);
  for (const w of rows) {
    cancel.run(by, reason, w.id);
    logAudit?.(by === 'ReadyDoc' ? 'system' : by, 'cancel', 'work_order', w.id,
      { reason, was: w.status, pm_schedule_id: scheduleId }, null, null, w.title);
  }
  const inProgress = db.prepare("SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status = 'in_progress'").get(scheduleId).c;
  return { cancelled: rows.length, in_progress: inProgress };
}

/** The reason written on each card a pause closes. */
export function pauseReason(scheduleTitle, by, why) {
  const day = new Date().toISOString().slice(0, 10);
  return `Closed because "${scheduleTitle}" was paused by ${by} on ${day}${why ? ` — ${why}` : ''}. `
    + 'Pausing stops a schedule raising work and closes what it had already raised (D-139); resuming it raises a new task.';
}

// ── The Daily Scale PMs (D-011, D-012, D-117) ──────────────────────────────
//
// Scale Verification (FORM 417-01 … 417-05) owns the daily accuracy check and
// files the controlled record; the strip on the Operator View reports any scale
// not checked today (D-117). The generic Daily PM on each scale names no form
// and files nothing — the plant paused them on 24 August (D-012) — but the
// daily scale work was ALSO carried on the room checklists PM consolidation v1
// built in July ("Daily PM Checklist — Production (Warehouse)": 22 lines, every
// one a scale; "Daily PM Checklist — Kitting": the two counting scales), which
// pausing a per-scale PM does not touch, and "Create schedules from these
// tasks" re-created per-scale Daily PMs for scales whose own one was paused.
// Three programs for one activity, and pausing any one left the others raising.
//
// ONCE PER DATABASE (the caller's marker), so a schedule somebody resumes
// afterwards stays resumed:
//  - every DAILY schedule on equipment typed `Scale` that is not QA's and not a
//    room checklist is paused, and its open/overdue/missed cards cancelled;
//  - every scale's line comes off the room checklists (and off their cards
//    still outstanding); a checklist left with no lines is paused the same way.
// Weekly, monthly, quarterly and annual scale PMs are genuinely different work
// and are not touched. The scales stay in the register.
const SCALE_REASON = 'Scale Verification (FORM 417-01 … 417-05) is the daily scale check and files the record; '
  + 'the generic Daily Scale PM duplicated it (D-011, D-012, D-139).';

/** A scale, by its type — `Scale`, `scale `, `Floor Scale`, `Scales` (D-141). */
export const isScaleType = (type) => /\bscales?\b/i.test(String(type || ''));

/**
 * Returns what it did AND what it looked at, so the boot log can say when it
 * matched nothing (D-141: the first pass reported the per-scale PMs and was
 * silent about the 2 room checklists whose lines it could not resolve).
 */
export function retireDailyScalePMs(db, logAudit) {
  const scaleIds = new Set(db.prepare('SELECT id, type FROM equipment').all().filter((e) => isScaleType(e.type)).map((r) => r.id));
  const out = { scales: scaleIds.size, paused: [], lines_removed: [], reanchored: [], unresolved: [], checklists_scanned: 0, cancelled: 0, in_progress: 0 };
  if (!scaleIds.size) return out;
  const pause = db.prepare("UPDATE pm_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?");
  const reasonFor = (title) => `Closed because "${title}" was retired: ${SCALE_REASON}`;

  db.transaction(() => {
    // 1. Per-scale daily PMs, however they were made.
    const own = db.prepare(`SELECT ps.* FROM pm_schedules ps WHERE ps.frequency_type = 'daily'
      AND COALESCE(ps.task_group, '') != 'qa'
      AND (ps.description IS NULL OR ps.description NOT LIKE ?)`).all(CONSOLIDATED_LIKE)
      .filter((s) => scaleIds.has(s.equipment_id));
    for (const s of own) {
      if (s.is_active) pause.run(s.id);
      const r = closeScheduleWork(db, s.id, { reason: reasonFor(s.title), logAudit });
      if (s.is_active || r.cancelled) {
        out.paused.push({ id: s.id, title: s.title, was_active: !!s.is_active, cancelled: r.cancelled });
        logAudit?.('system', 'update', 'pm_schedule', s.id,
          { retired: 'daily_scale_pm', reason: SCALE_REASON, was_active: !!s.is_active, cancelled: r.cancelled, in_progress_left: r.in_progress },
          null, null, s.title);
      }
      out.cancelled += r.cancelled; out.in_progress += r.in_progress;
    }

    // 2. Scale lines on the room checklists, active or not — resolved by the
    //    ONE resolver every checklist reader uses (pm-coverage.js).
    for (const c of consolidatedChecklists(db, { includeInactive: true })) {
      const s = c.schedule;
      if (!c.steps.length) continue;
      out.checklists_scanned++;
      for (const l of c.lines) if (l.label && !l.equipment_ids.length) out.unresolved.push({ checklist: s.title, line: l.label });
      const isScaleLine = (l) => l.equipment_ids.some((id) => scaleIds.has(id));
      const removed = c.lines.filter(isScaleLine);
      if (!removed.length) continue;
      const keptLines = c.lines.filter((l) => !isScaleLine(l));
      const kept = keptLines.map((l) => l.step);
      const json = JSON.stringify(kept);
      db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(json, s.id);
      let cancelled = 0, inProgress = 0, anchor = null;
      if (kept.length) {
        // A checklist hung on a scale that keeps other machines' lines would
        // still read "on Counting Scale #87" on every card. It is re-hung on
        // the first machine it still carries — the anchor was only ever "the
        // first machine folded" (D-138).
        if (scaleIds.has(s.equipment_id)) {
          anchor = keptLines.flatMap((l) => l.equipment_ids).find((id) => !scaleIds.has(id)) || null;
        }
        if (anchor) {
          db.prepare("UPDATE pm_schedules SET equipment_id = ? WHERE id = ?").run(anchor, s.id);
          out.reanchored.push({ id: s.id, title: s.title, from: s.equipment_id, to: anchor });
        }
        db.prepare(`UPDATE work_orders SET procedure_steps = ?${anchor ? ', equipment_id = ?' : ''} WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`)
          .run(...(anchor ? [json, anchor, s.id] : [json, s.id]));
      } else {
        if (s.is_active) pause.run(s.id);
        const r = closeScheduleWork(db, s.id, { reason: reasonFor(s.title), logAudit });
        cancelled = r.cancelled; inProgress = r.in_progress;
        out.paused.push({ id: s.id, title: s.title, was_active: !!s.is_active, cancelled, room_checklist: true });
      }
      out.cancelled += cancelled; out.in_progress += inProgress;
      out.lines_removed.push({ id: s.id, title: s.title, removed: removed.length, kept: kept.length });
      logAudit?.('system', 'update', 'pm_schedule', s.id,
        { retired: 'daily_scale_pm_lines', reason: SCALE_REASON, removed_lines: removed.map((l) => l.label), kept: kept.length, cancelled, in_progress_left: inProgress, reanchored_to: anchor },
        { procedure_steps: c.steps, is_active: s.is_active, equipment_id: s.equipment_id },
        { procedure_steps: kept, is_active: kept.length ? s.is_active : 0, equipment_id: anchor || s.equipment_id }, s.title);
    }
  })();
  return out;
}

/** One line for the boot log, flagging a pass that matched nothing it looked at. */
export function retireSummary(r) {
  const lines = r.lines_removed.reduce((n, x) => n + x.removed, 0);
  let msg = `[migrate] Daily Scale PMs retired: ${r.paused.filter((p) => p.was_active).length} schedule(s) paused, ${lines} scale line(s) off `
    + `${r.lines_removed.length} room checklist(s), ${r.cancelled} open/missed card(s) cancelled, ${r.in_progress} started card(s) left`
    + ` — ${r.scales} scale(s) in the register, ${r.checklists_scanned} room checklist(s) scanned`;
  if (r.reanchored.length) msg += `, ${r.reanchored.length} checklist(s) re-hung off a scale`;
  const warn = [];
  if (!r.paused.length && !lines) warn.push('[migrate] WARNING Daily Scale PM retirement MATCHED NOTHING — check equipment types and checklist labels');
  if (r.unresolved.length) warn.push(`[migrate] WARNING ${r.unresolved.length} room-checklist line(s) resolve to no equipment: `
    + r.unresolved.slice(0, 12).map((u) => `"${u.line}" on ${u.checklist}`).join('; '));
  return { msg, warn };
}
