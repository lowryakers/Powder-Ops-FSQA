// Pre-launch cleanup — closing out the noise from before the plant was really
// using ReadyDoc.
//
// The whole design rests on one rule: **nothing is deleted, and nothing is
// signed.** A deleted task is indistinguishable from one that never existed,
// which is exactly the gap an auditor asks about; and back-dating a QA
// signature onto a shift nobody reviewed would be a false record, which is
// worse than the gap. So every item here is CLOSED with a reason, a name and a
// timestamp, and stays in the log saying so.
//
// Work orders close as `cancelled` (the status already exists) with the reason
// in `notes`. Production entries are WAIVED — `qa_signoff_by` stays NULL
// forever and `qa_waived_*` records who closed it and why, so a waived entry
// can never be mistaken for a reviewed one.
//
// Adding a source = one entry in SOURCES:
//   key      stable id used by the client and the close endpoint
//   label    what this pile is called
//   note     why these are safe to close, shown above the list
//   stale    (db, cutoff, limit) => rows filed before the cutoff
//   count    (db, cutoff) => how many
//   close    (db, user, id, reason) => { error } | { ok: true }

const LIMIT = 500;

export const SOURCES = {
  'work-orders': {
    key: 'work-orders',
    label: 'Open tasks and PMs',
    module: 'pm',
    note: 'Closed as cancelled with your reason. Recurring schedules are not touched — the next occurrence still generates on its own cycle.',
    stale: (db, cutoff, limit = LIMIT) => db.prepare(`
      SELECT wo.id, wo.title, wo.due_date, wo.task_group, wo.status, wo.assigned_to,
        e.name AS equipment_name
      FROM work_orders wo LEFT JOIN equipment e ON e.id = wo.equipment_id
      WHERE wo.status IN ('open','in_progress','overdue','missed') AND wo.due_date < ?
      ORDER BY wo.due_date LIMIT ?`).all(cutoff, limit)
      .map(r => ({
        id: r.id,
        title: r.title,
        detail: [r.equipment_name, r.task_group, r.assigned_to].filter(Boolean).join(' · '),
        date: r.due_date,
        status: r.status,
      })),
    count: (db, cutoff) => db.prepare(`SELECT COUNT(*) c FROM work_orders
      WHERE status IN ('open','in_progress','overdue','missed') AND due_date < ?`).get(cutoff).c,
    close: (db, user, id, reason) => {
      const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
      if (!wo) return { error: 'Not found' };
      if (!['open', 'in_progress', 'overdue', 'missed'].includes(wo.status)) {
        return { error: `Already ${wo.status}` };
      }
      db.prepare(`UPDATE work_orders
        SET status = 'cancelled', completed_at = datetime('now'), completed_by = ?,
            notes = ?, updated_at = datetime('now')
        WHERE id = ?`).run(user.name, reason, id);
      return { ok: true, before: wo, label: wo.title };
    },
  },

  'production-qa': {
    key: 'production-qa',
    label: 'Production entries awaiting QA sign-off',
    module: 'production-log',
    note: 'These are WAIVED, not signed. The QA signature stays empty forever — nobody reviewed these shifts — and the record shows who waived it, when and why.',
    stale: (db, cutoff, limit = LIMIT) => db.prepare(`
      SELECT id, date, team, room, product_name, mo_number, lot_number, submitted_by
      FROM production_entries
      WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL AND date < ?
      ORDER BY date LIMIT ?`).all(cutoff, limit)
      .map(r => ({
        id: r.id,
        title: `${r.product_name || 'Entry'}${r.mo_number ? ` (MO ${r.mo_number})` : ''}`,
        detail: [r.team, r.room, r.lot_number && `Lot ${r.lot_number}`, r.submitted_by].filter(Boolean).join(' · '),
        date: r.date,
        status: 'pending QA',
      })),
    count: (db, cutoff) => db.prepare(`SELECT COUNT(*) c FROM production_entries
      WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL AND date < ?`).get(cutoff).c,
    close: (db, user, id, reason) => {
      const e = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
      if (!e) return { error: 'Not found' };
      if (e.qa_signoff_by) return { error: 'Already signed off' };
      if (e.qa_waived_at) return { error: 'Already waived' };
      db.prepare(`UPDATE production_entries
        SET qa_waived_at = datetime('now'), qa_waived_by = ?, qa_waived_reason = ?
        WHERE id = ?`).run(user.name, reason, id);
      return { ok: true, before: e, label: `${e.product_name || 'Entry'} ${e.date}` };
    },
  },
};

export const sourceFor = (key) => SOURCES[key] || null;

/** Every source's outstanding count before the cutoff. Cheap — drives the summary. */
export function counts(db, cutoff) {
  return Object.values(SOURCES).map(s => {
    let count;
    try { count = s.count(db, cutoff); } catch { count = 0; }
    return { key: s.key, label: s.label, module: s.module, note: s.note, count };
  });
}
