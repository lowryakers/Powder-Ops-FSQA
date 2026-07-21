// Per-module access levels.
//
// A user's `module_access` can be:
//   - null            → no restriction (see all modules; edit per role)
//   - ["a","b"]       → legacy: visible modules; edit per role (auto-migrated to object form)
//   - { a:"edit", b:"view" } → explicit per-module level; modules absent = no access
//
// Admins default to full edit access. If an admin is given an explicit
// module_access OBJECT they respect it (so specific modules can be un-selected
// to reduce clutter) — except modules in ADMIN_ALWAYS, which stay accessible so
// an admin can never lock themselves out of Settings.

const ADMIN_ALWAYS = new Set(['settings']);

function roleDefault(role) {
  return role === 'admin' || role === 'supervisor' ? 'edit' : 'view';
}

export function moduleLevel(user, moduleId) {
  if (!user) return null;
  const ma = user.module_access;
  if (user.role === 'admin') {
    if (ma && !Array.isArray(ma) && !ADMIN_ALWAYS.has(moduleId)) return ma[moduleId] ? 'edit' : null;
    return 'edit';
  }
  if (ma == null) return roleDefault(user.role);
  if (Array.isArray(ma)) return ma.includes(moduleId) ? roleDefault(user.role) : null;
  const lvl = ma[moduleId];
  return lvl === 'edit' ? 'edit' : lvl === 'view' ? 'view' : null;
}

export const canViewModule = (user, moduleId) => moduleLevel(user, moduleId) != null;
export const canEditModule = (user, moduleId) => moduleLevel(user, moduleId) === 'edit';

export function visibleModuleIds(user, allIds) {
  if (!user) return [];
  const ma = user.module_access;
  if (user.role === 'admin') {
    if (ma && !Array.isArray(ma)) return allIds.filter(id => ADMIN_ALWAYS.has(id) || ma[id]);
    return allIds;
  }
  if (ma == null) return allIds;
  if (Array.isArray(ma)) return allIds.filter(id => ma.includes(id));
  return allIds.filter(id => ma[id]);
}
