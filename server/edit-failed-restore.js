// Restore the training records the edit bug turned into fails (D-271).
import { logAudit } from './db.js';
import { dueDateFor, supersedeOlder } from './training-records.js';
import { editFailedTraining } from './edit-failed-training.js';

/**
 * Put back the records the edit bug turned into fails (D-271). Only rows the
 * finder lists under `likely` RIGHT NOW are touched — the eligibility is
 * re-derived here, never trusted from the request — so an id that is a real
 * fail, already restored, or edited since is skipped and named. A low-score
 * fail (`check`) is never restored here: it may be real.
 *
 * Each record goes back to `completed` with its own completion date, its pass
 * left blank (or 1 when its score passes), its retraining clock recomputed,
 * and which record is current re-settled. One audit row per record carrying
 * the reason, plus a summary. A person, not this, decides; nothing runs at boot.
 */
export function restoreEditFailed(db, ids, { actor = 'system', reason } = {}) {
  const why = String(reason || '').trim();
  if (why.length < 3) return { error: 'Say why — the reason goes on every restored record.' };
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!want.length) return { error: 'Choose at least one record to restore.' };
  const eligible = new Map(editFailedTraining(db).likely.map(x => [x.id, x]));
  const restored = [], skipped = [];
  const upd = db.prepare(`UPDATE training_records SET status = 'completed', passed = ?, next_due_date = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'failed'`);
  db.transaction(() => {
    for (const id of want) {
      const item = eligible.get(id);
      if (!item) { skipped.push({ id, why: 'not on the list of records the edit bug failed (a real fail, already restored, or changed since)' }); continue; }
      const before = db.prepare('SELECT * FROM training_records WHERE id = ?').get(id);
      const passed = before.score == null ? null : 1;
      const due = dueDateFor(db, before.course_id, before.completion_date);
      upd.run(passed, due, id);
      supersedeOlder(db, before.employee_name, before.course_id, id, before.employee_user_id || null);
      const after = db.prepare('SELECT * FROM training_records WHERE id = ?').get(id);
      logAudit(actor, 'update', 'training', id, {
        event: 'edit_failed_restored', reason: why,
        changed: { status: { from: 'failed', to: 'completed' }, passed: { from: before.passed, to: after.passed }, next_due_date: { from: before.next_due_date, to: after.next_due_date } },
      }, { status: before.status, passed: before.passed }, { status: after.status, passed: after.passed }, before.employee_name);
      restored.push({ id, person: item.person, course: item.course, trained: item.trained, next_due: after.next_due_date });
    }
  })();
  if (restored.length) logAudit(actor, 'update', 'training', null, { event: 'edit_failed_restore_batch', reason: why, restored: restored.length, skipped: skipped.length });
  return { restored, skipped };
}
