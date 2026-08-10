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

// True when the user was explicitly granted a module in Settings (as opposed
// to seeing it through their role default). Opt-in pseudo-modules —
// critical-tracking, currently-out, office-requests, production-eod — use
// this so they stay hidden unless deliberately shared.
export function hasExplicitGrant(user, moduleId) {
  const ma = user?.module_access;
  if (!ma) return false;
  return Array.isArray(ma) ? ma.includes(moduleId) : !!ma[moduleId];
}

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

// Who may work the QA Review Center — QA/quality by department, supervisors and
// admins by role, or an explicit grant. Lives here rather than in App.jsx
// because OperatorView links to QA Review and a second copy of an access rule
// is how two screens start disagreeing about who can reach a module.
// QA Review is a QA queue, not a supervisor perk.
//
// This used to include `role === 'supervisor'`, which handed the whole queue to
// every production supervisor — Filling, Batching, Warehouse — regardless of
// what Settings said, because the module is force-added by this rule rather
// than read from the grant list. A Filling supervisor counter-signing cleaning
// and scale records is not who that queue is for, and it made the Settings
// checkbox look broken.
//
// Keep this in step with `isQaReviewer` in server/qa-review.js — the two decide
// the same thing on either side of the wire.
export const canSeeQaReview = (u) => u?.role === 'admin'
  || ['qa', 'quality'].includes(String(u?.department || '').toLowerCase())
  || hasExplicitGrant(u, 'qa-review');
