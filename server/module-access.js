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
  'production-log', 'production-schedule', 'production-dashboard',
  'pm', 'equipment', 'calibration', 'loto',
  'sanitation', 'chemicals', 'hygienic', 'coa',
  'capa', 'sops', 'work-instructions', 'job-descriptions', 'org-chart',
  'disposals', 'training', 'certifications', 'recall',
  'office-requests',
  'dcr', 'deviations', 'non-conformance', 'on-hold',
  'component-signout', 'maintenance-signout', 'currently-out', 'organoleptic',
  'knife-accountability', 'flavor-approvals',
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
