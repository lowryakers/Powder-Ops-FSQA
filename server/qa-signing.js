// WHO MAY APPLY A COUNTER-SIGNATURE — one definition, imported by everyone.
//
// These predicates used to live in qa-review.js, which is the QUEUE. That was
// fine until you notice a queue is only one of the doors: every module also
// has its own Verify button on the record itself, and those routes were
// checking nothing. An operator could counter-sign a cleaning record from the
// Sanitation log while the identical action was correctly refused in QA
// Review — the same two-doors-one-checked shape that put the QMS router's
// missing guard in the notes, and that `signQmsApproval` exists to prevent.
//
// They cannot live in qa-review.js, because qa-review.js imports the modules'
// own sign functions and the modules would have to import back. Its own file
// for exactly that reason, the same way password-policy.js was extracted so
// middleware/auth.js and api/users.js could share it without a cycle.
//
// Keep in step with `canSeeQaReview` in src/utils/permissions.js.

import { hasExplicitEdit, hasExplicitGrant } from './module-access.js';

/**
 * Who QA Review is for. NOT every supervisor: that handed the queue to
 * Filling, Batching and Warehouse supervisors by role alone, over the top of
 * whatever Settings said, and let them counter-sign QA records. Admins, the
 * QA/quality department, or an explicit grant.
 */
export const isQaReviewer = (u) => u?.role === 'admin'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase())
  || hasExplicitGrant(u, 'qa-review');

// Signing a specific module's records survives this independently — each also
// accepts that module's own EDIT grant, so a production supervisor with
// Production Log edit can still sign production entries. Note `hasExplicitEdit`
// and not `moduleLevel`: a null module_access means "role decides" for
// visibility, and must never be read as permission to sign.
export const canSignProduction = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'production-log');
export const canSignSanitation = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'sanitation');
export const canSignInspection = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'qa-inspections');
export const canSignScale = (u) => isQaReviewer(u) || hasExplicitEdit(u, 'calibration');

/**
 * Cleaning records and QA inspections share one table, so one route verifies
 * both. A caller who can sign either kind is allowed; the record itself decides
 * nothing, because an inspection filed under the sanitation area regex is still
 * QA's record and vice versa — splitting the permission by regex would make the
 * answer depend on how the area happened to be typed.
 */
export const canVerifySanitation = (u) => canSignSanitation(u) || canSignInspection(u);
