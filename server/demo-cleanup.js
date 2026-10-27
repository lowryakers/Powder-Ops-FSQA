// The demo build's leftovers on a live database (D-219). The code that made them is gone (D-215); these
// passes deal with what it left behind, ONCE per database, on Lowry's decision of 27 October.
//
// Nothing is deleted. An invented completion is marked CANCELLED with the reason, so it leaves Team
// Activity and task history and stays traceable; the demo Auditor account is deactivated.
import { GO_LIVE_DATE } from './db.js';

export const DEMO_TECHS = ['Adam B.', 'Ricardo A.', 'Spencer R.'];
const RETIRE_REASON = 'Invented by the demo build (four months of "completed" PM history written at first boot, D-215), '
  + 'never performed. Retired, not deleted, on 27 Oct 2026 (D-219).';

/**
 * The fingerprint the usage report counts: completed under a demo name, BEFORE go-live, with no audit
 * entry by an account — a real completion always writes one. Returns the count and the date range.
 */
export function retireInventedHistory(db, logAudit) {
  const ph = DEMO_TECHS.map(() => '?').join(',');
  const where = `status = 'completed' AND completed_by IN (${ph}) AND completed_at < ?
    AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'work_order' AND a.entity_id = work_orders.id AND a.actor_id IS NOT NULL)`;
  const span = db.prepare(`SELECT COUNT(*) n, MIN(completed_at) first, MAX(completed_at) last FROM work_orders WHERE ${where}`)
    .get(...DEMO_TECHS, GO_LIVE_DATE);
  if (!span.n) return { retired: 0 };
  const r = db.prepare(`UPDATE work_orders SET status = 'cancelled', notes = COALESCE(notes || char(10), '') || ?,
    updated_at = datetime('now') WHERE ${where}`).run(RETIRE_REASON, ...DEMO_TECHS, GO_LIVE_DATE);
  // One entry for the batch, not 19,000: the rows carry the reason themselves.
  logAudit?.('system', 'update', 'work_order', 'demo-history', { reason: RETIRE_REASON, retired: r.changes, first: span.first, last: span.last },
    null, null, 'Invented demo maintenance history');
  return { retired: r.changes, first: span.first, last: span.last };
}

/** The demo "Auditor" account, still active on a known PIN with no password. Real auditors get a pass. */
export function deactivateDemoAuditor(db, logAudit) {
  const rows = db.prepare(`SELECT id, name FROM users WHERE name = 'Auditor' AND role = 'auditor' AND is_active = 1
    AND pin IS NOT NULL AND pin != '' AND (password_hash IS NULL OR password_hash = '')`).all();
  for (const u of rows) {
    db.prepare("UPDATE users SET is_active = 0, pin = NULL, updated_at = datetime('now') WHERE id = ?").run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    logAudit?.('system', 'update', 'user', u.id, { reason: 'Demo account on a known PIN with no password; deactivated and PIN cleared (D-219).' },
      { is_active: 1 }, { is_active: 0 }, u.name);
  }
  return rows.length;
}
