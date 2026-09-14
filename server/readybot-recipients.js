// Who an automatic ReadyBot message reaches — one definition per message, used
// by the sender AND by the Settings screen that describes it.
//
// D-079 said each audience must be resolved by the function that actually sends
// it, and then made an exception for audiences that were a SQL predicate inside
// their sender: those had "the same predicate run here". THAT EXCEPTION IS WHAT
// DRIFTED, exactly as the rule predicts, and by 14 September the registry was
// wrong about four of them:
//
//   • supplier reviews — the sender requires supervisor/manager in QA, quality
//     or purchasing; the registry listed ANY user in those departments, so
//     Settings named people who were never messaged.
//   • QA records waiting — the same shape, the same over-report.
//   • a change parked for Document Control — the registry added quality and QA;
//     the sender never did.
//   • an auditor pass — the registry said "every admin"; the sender also
//     includes QA, so Settings UNDER-reported who was told.
//
// So there is no second predicate anywhere now. Each sender exports one
// function; the registry calls it; and because that function is the only place
// the audience is decided, making it settable is the same edit as narrowing it.
//
// TWO RULES HOLD FOR ALL OF THEM:
//  1. A stored list of ids WINS over the rule, so widening or narrowing an
//     audience is a settings change and not a deploy.
//  2. UNSET IS NEVER NOBODY. A message configured and delivered to no one is
//     indistinguishable from a broken job, so every default falls back to the
//     active admins if the people it names do not exist on this roster.

export const ACTIVE = "is_active = 1 AND name != 'ReadyBot' AND role != 'auditor'";

const admins = (db) => {
  try { return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE} AND role = 'admin' ORDER BY name`).all(); }
  catch { return []; }
};

/**
 * The people a stored setting names, or null when nobody has chosen.
 * Inactive accounts drop out: a list is a preference, not a licence to message
 * somebody who has left.
 */
export function chosen(db, key) {
  const ids = (() => {
    try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || 'null'); }
    catch { return null; }
  })();
  if (!Array.isArray(ids) || !ids.length) return null;
  const ph = ids.map(() => '?').join(',');
  try { return db.prepare(`SELECT id, name FROM users WHERE id IN (${ph}) AND ${ACTIVE} ORDER BY name`).all(...ids); }
  catch { return null; }
}

/**
 * Accounts matching any of these names, on the roster, right now.
 *
 * NOTHING IS INVENTED. A name with no account resolves to nobody rather than to
 * a guess or an address — the same refusal the client-channel seed makes. That
 * is also why the defaults below name people rather than departments: a
 * department is a net, and every one of these lists got large by OR-ing
 * `role = 'admin'` onto a net.
 */
export function byNames(db, names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return [];
  const ph = list.map(() => 'LOWER(?)').join(',');
  try {
    return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE} AND LOWER(name) IN (${ph}) ORDER BY name`).all(...list);
  } catch { return []; }
}

/** Accounts in any of these departments, optionally narrowed to a role set. */
export function byDept(db, depts, roles = null) {
  const d = (depts || []).map(x => x.toLowerCase());
  if (!d.length) return [];
  const dph = d.map(() => '?').join(',');
  const roleClause = roles?.length ? ` AND role IN (${roles.map(() => '?').join(',')})` : '';
  try {
    return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE}
      AND LOWER(COALESCE(department,'')) IN (${dph})${roleClause} ORDER BY name`).all(...d, ...(roles || []));
  } catch { return []; }
}

/** Adam, by name, with a department fallback — the env-limits precedent. */
export function adam(db) {
  const named = byNames(db, ['adam bliss']);
  if (named.length) return named;
  try {
    return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE} AND LOWER(name) LIKE 'adam %' ORDER BY name`).all();
  } catch { return []; }
}

/** De-duplicate, and never hand back an empty audience. */
export function settle(db, ...groups) {
  const out = new Map();
  for (const g of groups) for (const u of (g || [])) if (u?.id) out.set(u.id, { id: u.id, name: u.name });
  return out.size ? [...out.values()].sort((a, b) => a.name.localeCompare(b.name)) : admins(db);
}

/**
 * The shape every audience below returns: `{ users, source }` where source is
 * 'setting' when a person chose the list and 'default' when the rule did. The
 * Settings screen renders that word, so it cannot claim a list was chosen when
 * it was not.
 */
export function resolve(db, key, ruleFn) {
  const picked = chosen(db, key);
  if (picked?.length) return { users: picked, source: 'setting' };
  return { users: settle(db, ruleFn()), source: 'default' };
}
