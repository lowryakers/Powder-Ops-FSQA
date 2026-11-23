// Who a work order belongs to, for COUNTING it (single-spine P1, D-367).
//
// A card is TEAM-OWNED when nobody is named on it (assigned_to and
// assigned_to_id both empty) — the whole team sees it. It is PERSON-OWNED when a
// name is on it. A card whose named person has been DEACTIVATED belongs to
// nobody who can do it: it is left out of every overdue count, so a person who
// has left does not keep a figure up for weeks.
//
// The deactivated match reads the account id first (D-074), then the name — and
// a name only when no ACTIVE account shares it, so a namesake who still works
// here never hides real work.
//
// No db.js import: flash-report.js stays importable without the app's connection.

export const OUTSTANDING = "('open','in_progress','overdue','missed')";

/** SQL: true when the card's named person is a deactivated account. `wo` is the work_orders alias. */
export function inactiveAssigneeSql(wo = 'wo') {
  return `(EXISTS (SELECT 1 FROM users ux WHERE ux.id = ${wo}.assigned_to_id AND COALESCE(ux.is_active, 1) = 0)
    OR (${wo}.assigned_to_id IS NULL AND TRIM(COALESCE(${wo}.assigned_to, '')) <> ''
      AND EXISTS (SELECT 1 FROM users ux WHERE LOWER(ux.name) = LOWER(TRIM(${wo}.assigned_to)) AND COALESCE(ux.is_active, 1) = 0)
      AND NOT EXISTS (SELECT 1 FROM users ux WHERE LOWER(ux.name) = LOWER(TRIM(${wo}.assigned_to)) AND COALESCE(ux.is_active, 1) = 1)))`;
}

/** SQL: true when nobody is named on the card. */
export function teamOwnedSql(wo = 'wo') {
  return `(${wo}.assigned_to_id IS NULL AND TRIM(COALESCE(${wo}.assigned_to, '')) = '')`;
}

/**
 * Past-due outstanding cards, split team-owned / person-owned, deactivated
 * assignees left out. `createdBefore` (an SQLite datetime expression) narrows to
 * cards that already existed then — the flash's "a week ago" figure.
 */
export function overdueCounts(db, today, { createdBefore = null } = {}) {
  const r = db.prepare(`SELECT
      SUM(CASE WHEN ${inactiveAssigneeSql()} THEN 0 WHEN ${teamOwnedSql()} THEN 1 ELSE 0 END) team,
      SUM(CASE WHEN ${inactiveAssigneeSql()} THEN 0 WHEN ${teamOwnedSql()} THEN 0 ELSE 1 END) person,
      SUM(CASE WHEN ${inactiveAssigneeSql()} THEN 1 ELSE 0 END) left_out
    FROM work_orders wo
    WHERE wo.status IN ${OUTSTANDING} AND wo.due_date < ?${createdBefore ? ` AND wo.created_at < ${createdBefore}` : ''}`).get(today);
  const team = r.team || 0, person = r.person || 0;
  return { total: team + person, team, person, deactivated_left_out: r.left_out || 0 };
}
