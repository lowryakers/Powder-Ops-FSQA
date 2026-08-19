// Collapse the duplicate tasks the generator already put on the floor.
//
// Until now the "is this schedule already serviced" guards counted only OPEN
// and IN PROGRESS work. So the moment a task slipped past its due date and was
// flipped to overdue (or missed), its schedule looked unserviced and produced
// another — and that one aged the same way. Maria was looking at six identical
// "Temp & Humidity Check — Warehouse" cards, same equipment, same due date,
// all overdue, with no way to tell which to complete.
//
// The guards are fixed, but a fix only stops new ones. This collapses what is
// already there, and it is deliberately conservative:
//
//   - THE OLDEST SURVIVES. It carries the real due date and whatever history
//     (notes, reassignment, snooze) has accumulated; the later copies are the
//     accidents.
//   - THE OTHERS ARE CANCELLED, NEVER DELETED. A deleted task is
//     indistinguishable from one that never existed, which is the gap an
//     auditor asks about. Each keeps its reason and points at the survivor.
//   - ONLY EXACT DUPLICATES: same title AND same equipment AND both still
//     outstanding. Two genuinely different jobs never collapse.
//   - Every cancellation is audited individually, plus one summary row.

import { logAudit } from './db.js';

const FLAG = 'duplicate_task_cleanup_v1';

export function cleanupDuplicateTasks(db) {
  try {
    if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(FLAG)) return 0;

    // Outstanding work, oldest first, grouped by the job it describes.
    const rows = db.prepare(`SELECT id, title, equipment_id, pm_schedule_id, due_date, status, created_at
      FROM work_orders
      WHERE status IN ('open', 'in_progress', 'overdue', 'missed')
      ORDER BY COALESCE(created_at, due_date)`).all();

    const groups = new Map();
    for (const w of rows) {
      const key = `${(w.title || '').trim().toLowerCase()}|${w.equipment_id || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }

    const cancel = db.prepare(`UPDATE work_orders
      SET status = 'cancelled', completed_at = datetime('now'), completed_by = 'system (duplicate cleanup)',
          notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now')
      WHERE id = ?`);

    let collapsed = 0, jobs = 0;
    const tx = db.transaction(() => {
      for (const [, list] of groups) {
        if (list.length < 2) continue;
        const keep = list[0];
        jobs++;
        for (const dup of list.slice(1)) {
          cancel.run(`Duplicate of ${keep.id} (same job, same equipment) — the schedule generated a second copy while the first was overdue. Cancelled by cleanup; the original remains open.`, dup.id);
          logAudit('system', 'update', 'work_order', dup.id,
            { cancelled_as_duplicate_of: keep.id, title: dup.title, due_date: dup.due_date, was: dup.status },
            null, null, dup.title);
          collapsed++;
        }
      }
    });
    tx();

    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(FLAG, new Date().toISOString());
    if (collapsed) {
      logAudit('system', 'update', 'work_order', null,
        { duplicate_cleanup: true, tasks_cancelled: collapsed, jobs_affected: jobs }, null, null, 'Duplicate task cleanup');
      console.log(`[cleanup] Collapsed ${collapsed} duplicate task(s) across ${jobs} job(s); the oldest of each was kept`);
    }
    return collapsed;
  } catch (e) {
    console.warn('[cleanup] duplicate task cleanup failed (will retry next boot):', e.message);
    return 0;
  }
}
