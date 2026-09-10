// The link is the identity; the name is a label.
//
// Four tables identified a person by the name string alone — work_orders
// (assigned_to / completed_by), certifications (person_name), first_aid_injuries
// (employee_name) and production_entries (submitted_by) — so renaming somebody
// in Settings split their history in two: Team Activity grew a phantom
// colleague, the renamed operator's own task screen went quiet, the delete
// guard counted zero history and let them be removed. The same defect
// pay_employees.user_id and time_adjustments.employee_id already had.
//
// Each of those tables now carries an id column BESIDE the name. The name stays:
// it is the label and the historical record. Three things live here:
//
//  1. TRIGGERS resolve the id from the name on every insert, and again when the
//     name column changes and the caller did not set the id itself. One place,
//     so a write path added next year cannot forget it — the FTS sync triggers
//     are the precedent. A name that matches two accounts resolves to NULL:
//     nothing is guessed, and the name fallback still works for that row.
//  2. A ONE-TIME BACKFILL for rows that predate the columns (guarded in
//     app_settings, exact case-insensitive match, only where unambiguous).
//  3. Read helpers: `personMatch()` builds the id-first / name-fallback WHERE
//     clause, `withCurrentNames()` shows the account's CURRENT name and keeps
//     the stored one as `renamed_from`.
//
// Columns that are meant to be SNAPSHOTS — audit_log.actor, *.performed_by,
// *.verified_by, signatures — are deliberately not here. Those must not follow
// a rename.

export const PERSON_LINKS = [
  { table: 'work_orders', nameCol: 'assigned_to', idCol: 'assigned_to_id' },
  { table: 'work_orders', nameCol: 'completed_by', idCol: 'completed_by_id' },
  { table: 'certifications', nameCol: 'person_name', idCol: 'user_id' },
  { table: 'first_aid_injuries', nameCol: 'employee_name', idCol: 'employee_user_id' },
  { table: 'production_entries', nameCol: 'submitted_by', idCol: 'submitted_by_id' },
];

const BACKFILL_FLAG = 'person_ids_linked';

// One account with that name, or nothing.
const RESOLVE = (nameExpr) => `(SELECT u.id FROM users u WHERE LOWER(u.name) = LOWER(${nameExpr})
    AND (SELECT COUNT(*) FROM users u2 WHERE LOWER(u2.name) = LOWER(${nameExpr})) = 1)`;

export function installPersonLinks(db, { addColumnIfMissing }) {
  for (const { table, nameCol, idCol } of PERSON_LINKS) {
    addColumnIfMissing(table, idCol, 'TEXT');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_${idCol} ON ${table}(${idCol});`);
    // On insert: resolve when the caller did not supply an id.
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_${idCol}_ai AFTER INSERT ON ${table}
      WHEN NEW.${nameCol} IS NOT NULL AND NEW.${idCol} IS NULL
      BEGIN
        UPDATE ${table} SET ${idCol} = ${RESOLVE(`NEW.${nameCol}`)} WHERE id = NEW.id;
      END;`);
    // On a name change: re-resolve, unless the same statement set the id
    // deliberately (then the caller knows better than the name does).
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_${idCol}_au AFTER UPDATE OF ${nameCol} ON ${table}
      WHEN NEW.${nameCol} IS NOT OLD.${nameCol} AND NEW.${idCol} IS OLD.${idCol}
      BEGIN
        UPDATE ${table} SET ${idCol} = ${RESOLVE(`NEW.${nameCol}`)} WHERE id = NEW.id;
      END;`);
  }

  // One-time backfill of the rows that predate the columns. Not marked done on
  // a database with nothing in any of the four tables — a fresh deploy seeds
  // them later, and the triggers cover every row written from here on anyway.
  try {
    // On a fresh database app_settings is created further down the boot; there
    // is nothing to backfill there anyway (the triggers cover every row the
    // seeds will write), so a missing table is a quiet skip, not a warning.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get()) return;
    const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BACKFILL_FLAG);
    if (done) return;
    const anyRows = PERSON_LINKS.some(({ table }) => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
    if (!anyRows) return;
    let total = 0;
    for (const { table, nameCol, idCol } of PERSON_LINKS) {
      const r = db.prepare(`UPDATE ${table} SET ${idCol} = ${RESOLVE(`${table}.${nameCol}`)}
        WHERE ${idCol} IS NULL AND ${nameCol} IS NOT NULL
          AND (SELECT COUNT(*) FROM users u3 WHERE LOWER(u3.name) = LOWER(${table}.${nameCol})) = 1`).run();
      total += r.changes;
    }
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(BACKFILL_FLAG, new Date().toISOString());
    if (total) console.log(`[migrate] linked ${total} person reference(s) to their accounts`);
  } catch (e) { console.warn('[migrate] person link backfill skipped:', e.message); }
}

/** The one account with exactly this name, or null. Case-insensitive; two matches is nobody. */
export function resolveUserId(db, name) {
  if (!name) return null;
  const rows = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 2').all(String(name).trim());
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * WHERE fragment matching a person by account OR by the name as filed. `user`
 * is `{ id, name }`. The account catches rows filed under a spelling Settings
 * has since changed; the name catches rows written before the id existed,
 * rows whose name was ambiguous, and a filter typed as the OLD name.
 */
export function personMatch(idCol, nameCol, user) {
  return {
    sql: `(${idCol} = ? OR ${nameCol} = ?)`,
    params: [user?.id || '', user?.name || ''],
  };
}

/**
 * Replace a stored name with the account's CURRENT one where an id is linked,
 * keeping what was filed as `renamed_from`. Same shape as office.js
 * withCurrentNames, generalised to any column pair.
 */
export function withCurrentNames(db, rows, pairs) {
  const list = Array.isArray(pairs) ? pairs : [pairs];
  const ids = new Set();
  for (const r of rows) for (const { idCol } of list) if (r[idCol]) ids.add(r[idCol]);
  if (!ids.size) return rows;
  const names = new Map();
  try {
    const arr = [...ids];
    for (const u of db.prepare(`SELECT id, name FROM users WHERE id IN (${arr.map(() => '?').join(',')})`).all(...arr)) names.set(u.id, u.name);
  } catch { return rows; }
  return rows.map(r => {
    let out = r;
    for (const { idCol, nameCol } of list) {
      const current = r[idCol] && names.get(r[idCol]);
      if (!current || current === r[nameCol]) continue;
      if (out === r) out = { ...r };
      out[`${nameCol}_renamed_from`] = r[nameCol];
      out[nameCol] = current;
    }
    return out;
  });
}

/** The key one person aggregates under: the account when linked, the name otherwise. */
export const personRef = (id, name) => id || (name ? `name:${name}` : null);
