// WHAT AN EMPTY MODULE MAP MEANS DEPENDS ON THE ROLE, and the two readings are
// opposite. `moduleLevel()` gives an admin 'edit' on every module whatever
// their map says, and gives everybody else **null** the moment the map is empty
// (`if (ma == null) return null`). So a missing map is full access for an admin
// and NO access for an operator.
//
// Settings used to derive "Full access (all modules)" from `map == null` for
// everyone, so adding a new user showed that box ticked and saved null — the
// screen promised them every module while the server gave them nothing but
// Messages. Worse, the box could not be unticked: turning it off wrote `{}`,
// and `Object.keys({}).every(...)` is **true**, so the next render read the
// empty map straight back as full access. Vacuous truth, same class as the
// `LIKE '%%'` search that matched everyone.
//
// These four functions are the one definition of the rule, imported by the
// editor and by the check that asserts it against the real `moduleLevel`.
import { OPT_IN_SET } from './opt-in-modules.js';

export const ordinaryIds = (allIds) => (allIds || []).filter(id => !OPT_IN_SET.has(id));

export const optInEntries = (map) =>
  Object.fromEntries(Object.entries(map || {}).filter(([k]) => OPT_IN_SET.has(k)));

// Is this map "everything"? For an admin, anything that does not narrow the
// ordinary modules — the same test `isRestrictionMap()` applies. For everyone
// else it has to be WRITTEN DOWN: absence is not a shorthand for presence.
export function isFullAccess(role, map, allIds) {
  if (role === 'admin') return !Object.keys(map || {}).some(k => !OPT_IN_SET.has(k));
  const ordinary = ordinaryIds(allIds);
  return ordinary.length > 0 && ordinary.every(id => (map || {})[id] === 'edit');
}

// The map to store for "full access", which is null-ish only for an admin.
export function fullAccessMap(role, map, allIds) {
  const grants = optInEntries(map);
  if (role === 'admin') return Object.keys(grants).length ? grants : null;
  return { ...Object.fromEntries(ordinaryIds(allIds).map(id => [id, 'edit'])), ...grants };
}

// The map to store for "nothing assigned". Opt-in grants ride along untouched —
// they are granted by name and are not part of what "full access" covers.
export function noAccessMap(map) {
  const grants = optInEntries(map);
  return Object.keys(grants).length ? grants : null;
}

// The map with full access written out, so unticking ONE module from full
// access leaves the other fifty-three rather than starting from empty.
export function expandedMap(role, map, allIds) {
  if (!isFullAccess(role, map, allIds)) return { ...(map || {}) };
  return { ...Object.fromEntries(ordinaryIds(allIds).map(id => [id, 'edit'])), ...optInEntries(map) };
}
