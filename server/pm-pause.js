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

export function retireDailyScalePMs(db, logAudit) {
  const scaleIds = new Set(db.prepare("SELECT id FROM equipment WHERE LOWER(COALESCE(type,'')) = 'scale'").all().map((r) => r.id));
  const out = { scales: scaleIds.size, paused: [], lines_removed: [], cancelled: 0, in_progress: 0 };
  if (!scaleIds.size) return out;
  const pause = db.prepare("UPDATE pm_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?");
  const reasonFor = (title) => `Closed because "${title}" was retired: ${SCALE_REASON}`;

  db.transaction(() => {
    // 1. Per-scale daily PMs, however they were made.
    const own = db.prepare(`SELECT ps.* FROM pm_schedules ps WHERE ps.frequency_type = 'daily'
      AND COALESCE(ps.task_group, '') != 'qa'
      AND (ps.description IS NULL OR ps.description NOT LIKE 'Consolidated daily checks%')`).all()
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

    // 2. Scale lines on the room checklists, active or not.
    const rooms = db.prepare("SELECT * FROM pm_schedules WHERE description LIKE 'Consolidated daily checks%'").all();
    for (const s of rooms) {
      let steps; try { steps = JSON.parse(s.procedure_steps || '[]'); } catch { steps = []; }
      if (!Array.isArray(steps) || !steps.length) continue;
      const isScaleLine = (step) => {
        const i = typeof step === 'string' ? step.indexOf(' — ') : -1;
        if (i < 0) return false;
        const label = step.slice(0, i).trim();
        const m = label.match(/#(\S+)$/);
        const ids = m ? db.prepare('SELECT id FROM equipment WHERE asset_id = ?').all(m[1]).map((r) => r.id) : [];
        const hits = ids.length ? ids : db.prepare('SELECT id FROM equipment WHERE name = ?').all(label).map((r) => r.id);
        return hits.some((id) => scaleIds.has(id));
      };
      const removed = steps.filter(isScaleLine);
      if (!removed.length) continue;
      const kept = steps.filter((x) => !isScaleLine(x));
      const json = JSON.stringify(kept);
      db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(json, s.id);
      let cancelled = 0, inProgress = 0;
      if (kept.length) {
        db.prepare(`UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`).run(json, s.id);
      } else {
        if (s.is_active) pause.run(s.id);
        const r = closeScheduleWork(db, s.id, { reason: reasonFor(s.title), logAudit });
        cancelled = r.cancelled; inProgress = r.in_progress;
        out.paused.push({ id: s.id, title: s.title, was_active: !!s.is_active, cancelled, room_checklist: true });
      }
      out.cancelled += cancelled; out.in_progress += inProgress;
      out.lines_removed.push({ id: s.id, title: s.title, removed: removed.length, kept: kept.length });
      logAudit?.('system', 'update', 'pm_schedule', s.id,
        { retired: 'daily_scale_pm_lines', reason: SCALE_REASON, removed_lines: removed.map((x) => x.split(' — ')[0]), kept: kept.length, cancelled, in_progress_left: inProgress },
        { procedure_steps: steps, is_active: s.is_active }, { procedure_steps: kept, is_active: kept.length ? s.is_active : 0 }, s.title);
    }
  })();
  return out;
}
