// Raising a Corrective Action Request into the ONE register — `capas`.
//
// Internal audits, environmental monitoring and the GMP walk-through all raise
// CARs, and each used to (or would have) grown its own copy of the numbering
// and the insert. One helper, so a CAR raised from a Zone 2 positive is
// byte-for-byte the record a CAR raised from an internal audit is, and the
// number sequence has one owner.

import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';

export function nextCapaNumber(db) {
  const existing = db.prepare("SELECT capa_number FROM capas WHERE capa_number LIKE 'CAPA-%' ORDER BY capa_number DESC LIMIT 1").get();
  if (!existing) return 'CAPA-001';
  const m = String(existing.capa_number).match(/(\d+)/);
  return m ? `CAPA-${String(parseInt(m[1], 10) + 1).padStart(3, '0')}` : 'CAPA-001';
}

/**
 * Insert one CAPA. `actor` is the req.user object or a system string.
 * Returns the inserted row.
 */
export function raiseCapa(db, actor, { title, description, source_type, assigned_to = null, priority = 'normal', due_date = null, date_issued = null, extra = {} }) {
  const id = uuid();
  const num = nextCapaNumber(db);
  const issued = date_issued || db.prepare("SELECT date('now') d").get().d;
  db.prepare(`INSERT INTO capas (id, capa_number, title, description, assigned_to, priority, due_date, status, date_issued, source_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
    .run(id, num, String(title || '').slice(0, 160), description || null, assigned_to || null,
      ['low', 'normal', 'high', 'critical'].includes(priority) ? priority : 'normal', due_date || null, issued, source_type || null);
  const row = db.prepare('SELECT * FROM capas WHERE id = ?').get(id);
  logAudit(actor, 'create', 'capa', id, { capa_number: num, source_type, ...extra }, null, row, num);
  return row;
}
