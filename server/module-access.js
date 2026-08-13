// Server-side enforcement of the per-module View/Edit permission model.
// Mirrors src/utils/permissions.js — keep the two in sync.
//
// Semantics (matching the client):
//   module_access null   → no restriction (role decides; legacy behavior)
//   legacy array         → visible modules, edit per role
//   object {id: level}   → explicit per-module 'view' | 'edit'; absent = none
//
// Enforcement philosophy: the granular map is what admins configure in
// Settings, so ONLY an explicit object map is enforced here — users with no
// restriction keep today's role-based behavior, so nothing on the floor
// breaks. Auditors are read-only everywhere regardless.
//
// A router can span several modules (production serves the log, schedule and
// KPIs), so a write is allowed when the user has edit on ANY of the mapped
// modules. The QMS router enforces exactly per record type instead (see
// qms.js requireType).

// Must include every id used in Settings' MODULE_GROUPS (src side).
export const ALL_MODULE_IDS = [
  'dashboard', 'critical-tracking', 'operator',
  'production-log', 'production-eod', 'production-schedule', 'production-dashboard',
  'pm', 'equipment', 'calibration', 'loto',
  'sanitation', 'qa-inspections', 'chemicals', 'hygienic', 'coa',
  // The counter-signature queue. Automatic for QA/quality and admins; listed
  // here so it can also be granted deliberately to someone outside QA.
  'qa-review',
  'capa', 'sops', 'work-instructions', 'job-descriptions', 'org-chart',
  'disposals', 'training', 'certifications', 'recall',
  'office-requests', 'supply-requests', 'time-requests',
  'accounts-payable', 'accounts-receivable', 'partner-reconciliation', 'reimbursements', 'banking',
  'procurement', 'newsletter', 'pay-tracking',
  // Company policies (the handbook), separate from the controlled-document registry.
  'policies',
  'dcr', 'deviations', 'non-conformance', 'on-hold',
  'component-signout', 'maintenance-signout', 'currently-out', 'organoleptic',
  'knife-accountability', 'flavor-approvals',
  'form-maintenance', 'form-knife', 'form-components',
  // Warehouse receiving record (replaces the Monday board).
  'receiving-log',
  // Meeting minutes: management review, food safety team, production, safety.
  'meetings',
  // Internal audits (Form 403-01).
  'internal-audits',
  // Safety: crisis contacts (501-01), evacuation headcounts (501-02), first
  // aid injury log (502-01).
  'safety',
  // Self-serve structure: edit an existing log's fields and dropdown lists in
  // the app. Grant-able so a QA or ops lead can own form structure without
  // needing full admin.
  'log-builder',
  // Product management. Deliberately NOT part of any role default — the floor
  // has no reason to see the finished-goods catalogue, and a nav this long
  // only stays usable if new groups are granted rather than assumed.
  'products',
  // Artwork version history and proof verification. Separate from 'products'
  // so QA can be given the pack checks without the catalogue behind them.
  'artwork',
];

export function moduleLevel(user, moduleId) {
  if (!user) return null;
  const ma = user.module_access;
  if (user.role === 'admin') return 'edit';
  if (ma == null) return user.role === 'supervisor' ? 'edit' : 'view';
  if (Array.isArray(ma)) return ma.includes(moduleId) ? (user.role === 'supervisor' ? 'edit' : 'view') : null;
  const lvl = ma[moduleId];
  return lvl === 'edit' ? 'edit' : lvl === 'view' ? 'view' : null;
}

export function canEditAny(user, moduleIds) {
  return moduleIds.some(id => moduleLevel(user, id) === 'edit');
}

// Explicit grants — modules a user was deliberately given in Settings, as
// opposed to ones visible through their role default. Server-side mirror of
// the client's hasExplicitGrant; opt-in pseudo-modules (critical-tracking,
// production-eod, …) key off these.
export function hasExplicitGrant(user, moduleId) {
  const ma = user?.module_access;
  if (!ma) return false;
  return Array.isArray(ma) ? ma.includes(moduleId) : !!ma[moduleId];
}
export function hasExplicitEdit(user, moduleId) {
  const ma = user?.module_access;
  return !!(ma && !Array.isArray(ma) && ma[moduleId] === 'edit');
}

// Express middleware: gate non-GET requests on edit access to any of the
// router's modules. GETs pass (View means read). Only enforced for users
// with an explicit granular map (see philosophy above), except auditors,
// who are always read-only.
export function requireModuleWrite(...moduleIds) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role === 'admin') return next();
    if (user.role === 'auditor') return res.status(403).json({ error: 'Auditor accounts are read-only.' });
    const ma = user.module_access;
    const granular = ma != null && !Array.isArray(ma);
    if (!granular) return next(); // legacy / unrestricted: role-based behavior
    if (canEditAny(user, moduleIds)) return next();
    return res.status(403).json({ error: 'You have view-only access to this module.' });
  };
}
