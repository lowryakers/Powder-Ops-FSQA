// Per-module access levels.
//
// A user's `module_access` can be:
//   - null            → NOTHING ASSIGNED — no modules at all (decided 2026-08-13)
//   - ["a","b"]       → legacy: visible modules; edit per role (auto-migrated to object form)
//   - { a:"edit", b:"view" } → explicit per-module level; modules absent = no access
//
// A NULL MAP IS AN EMPTY ACCOUNT, NOT A ROLE DEFAULT. It briefly meant "role
// decides" (supervisors edit, operators view everywhere), which made every
// brand-new account a viewer of the whole compliance system before anyone
// decided that. The user's rule is the opposite: the only thing an account
// gets automatically is Messages (public channels — comms is not module-gated
// and has its own membership rules); every ReadyDoc module is assigned in
// Settings. Auditors are the exception — their whole contract is read-only
// everywhere, enforced server-side, and they land in the Auditor View.
//
// Admins default to full edit access. If an admin is given an explicit
// module_access OBJECT they respect it (so specific modules can be un-selected
// to reduce clutter) — except modules in ADMIN_ALWAYS, which stay accessible so
// an admin can never lock themselves out of Settings.

const ADMIN_ALWAYS = new Set(['settings']);
import { OPT_IN_SET } from '../../shared/opt-in-modules.js';

// An admin's map is a RESTRICTION only when it narrows the ordinary modules.
// A map that holds nothing but opt-in grants ({'dannys-list':'edit'}) is an
// admin with full access plus one private module — treating it as a
// restriction would strip their whole nav the moment they were granted one.
const isRestrictionMap = (ma) =>
  !!ma && !Array.isArray(ma) && Object.keys(ma).some(k => !OPT_IN_SET.has(k));

function roleDefault(role) {
  return role === 'admin' || role === 'supervisor' ? 'edit' : 'view';
}

export function moduleLevel(user, moduleId) {
  if (!user) return null;
  const ma = user.module_access;
  // Opt-in modules need the explicit grant from EVERYONE, admins included.
  if (OPT_IN_SET.has(moduleId)) {
    if (!ma) return null;
    if (Array.isArray(ma)) return ma.includes(moduleId) ? 'edit' : null;
    return ma[moduleId] ? 'edit' : null;
  }
  if (user.role === 'admin') {
    if (isRestrictionMap(ma) && !ADMIN_ALWAYS.has(moduleId)) return ma[moduleId] ? 'edit' : null;
    return 'edit';
  }
  if (user.role === 'auditor') return 'view';
  if (ma == null) return null;
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
  const optInVisible = (id) => !OPT_IN_SET.has(id) || hasExplicitGrant(user, id);
  if (user.role === 'admin') {
    if (isRestrictionMap(ma)) return allIds.filter(id => (ADMIN_ALWAYS.has(id) || ma[id]) && optInVisible(id));
    return allIds.filter(optInVisible);
  }
  // Auditors never see this nav — they land in the Auditor View — but the
  // answer stays consistent with moduleLevel if anything else asks.
  if (user.role === 'auditor') return allIds;
  // Nothing assigned means nothing shown — see the note at the top.
  if (ma == null) return [];
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

// Who runs a film/pouch inspection (FORM 418-01). It shows on the Receiving
// module's tab strip because that is where the delivery is, but the work — and
// the signature — is QA's, so it is NOT the warehouse's permission. Mirror of
// `canInspect` in server/api/film-inspection.js; the server refuses regardless,
// this only decides whether the buttons are offered.
export const canFilmInspect = (u) => u?.role === 'admin'
  || ['qa', 'quality'].includes(String(u?.department || '').toLowerCase())
  || hasExplicitGrant(u, 'qa-inspections');
