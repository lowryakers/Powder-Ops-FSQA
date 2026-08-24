// Server-side enforcement of the per-module View/Edit permission model.
// Mirrors src/utils/permissions.js — keep the two in sync.
//
// Semantics (matching the client):
//   module_access null   → NOTHING ASSIGNED — no modules, reads included
//   legacy array         → visible modules, level per role
//   object {id: level}   → explicit per-module 'view' | 'edit'; absent = none
//
// A NULL MAP IS AN EMPTY ACCOUNT — decided 2026-08-13, tightened the same
// day. The first cut of this decision made NULL mean "role decides"
// (supervisors edit, everyone else view everywhere); the user's rule is
// stricter and simpler: a brand-new account gets NOTHING automatically except
// Messages (comms is not behind this guard and has its own membership rules).
// Every ReadyDoc module is assigned in Settings, whatever the role — an
// unmapped supervisor is as empty as an unmapped operator. Since every
// existing employee already carries an explicit map, this changes only
// accounts nobody has set up yet, which is the point: safe by default.
//
// Auditors are the one exception: their whole contract is read-only
// everywhere (GETs pass, every write refused), because the Auditor View reads
// across every module by design.
//
// A router can span several modules (production serves the log, schedule and
// KPIs), so a write is allowed when the user has edit on ANY of the mapped
// modules. The QMS router enforces exactly per record type instead (see
// qms.js requireType). Public kiosk paths (/api/submit) never carry req.user
// and are not behind this guard; their exposure is bounded by their handlers.

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
  // The visitor book. The lobby tablet itself is a public kiosk and needs no
  // grant; this is the record behind it.
  'visitors',
  // Danny's List — the text-message request log for the owner. Granted, never
  // a role default: it is one person's working queue, not a plant module.
  'dannys-list',
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
  if (user.role === 'auditor') return 'view';
  if (ma == null) return null; // nothing assigned — see the note at the top
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

// Express middleware. Writes are gated on edit access to any of the router's
// modules; GETs pass for any MAPPED user (view-level cross-module reads are
// load-bearing — the warehouse reading QA's film inspections is the worked
// example) and for auditors, whose contract is read-only everywhere. The one
// account whose GETs are refused is the NOTHING-ASSIGNED account: a NULL map
// means no modules, and "no modules" that still answered every read would be
// the same two-mechanisms gap this rule just closed on the write side.
export function requireModuleWrite(...moduleIds) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const unassigned = user.role !== 'admin' && user.role !== 'auditor' && user.module_access == null;
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      if (unassigned) return res.status(403).json({ error: 'No modules have been assigned to this account yet. An admin assigns them in Settings.' });
      return next();
    }
    if (user.role === 'admin') return next();
    if (user.role === 'auditor') return res.status(403).json({ error: 'Auditor accounts are read-only.' });
    if (unassigned) return res.status(403).json({ error: 'No modules have been assigned to this account yet. An admin assigns them in Settings.' });
    if (canEditAny(user, moduleIds)) return next();
    return res.status(403).json({ error: 'You have view-only access to this module. An admin can grant edit access in Settings.' });
  };
}
