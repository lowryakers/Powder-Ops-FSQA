// Per-module access levels.
//
// A user's `module_access` can be:
//   - null            → no restriction (see all modules; edit per role)
//   - ["a","b"]       → legacy: visible modules; edit per role (auto-migrated to object form)
//   - { a:"edit", b:"view" } → explicit per-module level; modules absent = no access
//
// Admins always have full edit access. For null/legacy access, edit falls back
// to role (admin/supervisor edit, everyone else view) so existing setups are
// unchanged until an admin sets explicit view/edit levels.

function roleDefault(role) {
  return role === 'admin' || role === 'supervisor' ? 'edit' : 'view';
}

export function moduleLevel(user, moduleId) {
  if (!user) return null;
  if (user.role === 'admin') return 'edit';
  const ma = user.module_access;
  if (ma == null) return roleDefault(user.role);
  if (Array.isArray(ma)) return ma.includes(moduleId) ? roleDefault(user.role) : null;
  const lvl = ma[moduleId];
  return lvl === 'edit' ? 'edit' : lvl === 'view' ? 'view' : null;
}

export const canViewModule = (user, moduleId) => moduleLevel(user, moduleId) != null;
export const canEditModule = (user, moduleId) => moduleLevel(user, moduleId) === 'edit';

export function visibleModuleIds(user, allIds) {
  if (!user) return [];
  if (user.role === 'admin') return allIds;
  const ma = user.module_access;
  if (ma == null) return allIds;
  if (Array.isArray(ma)) return allIds.filter(id => ma.includes(id));
  return allIds.filter(id => ma[id]);
}
