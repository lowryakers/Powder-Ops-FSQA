// THE `coa-prep` GRANT (D-311): a person or bot that PREPARES COA work and never
// decides it. `isQaReviewer` used to gate both the plan/product writes and
// signing, so the only way to let the Quality bot fill in plans was to make it
// a signer. This grant opens exactly:
//   PUT  /api/coa/products/:item            the COA product list
//   POST /api/coa/plans                     a new draft plan
//   PUT  /api/coa/plans/:id                 a draft plan (approved plans refuse anyway)
//   POST /api/coa/plans/:id/new-version     a draft of the next version
//   PUT  /api/coa/requests/:id              an UNSIGNED request's fields, never its status
// and an account holding it is REFUSED every other COA write — approving a
// plan, applying one, approving a specification, signing, un-signing,
// deleting, results, files — whatever its department or role (an admin is
// unaffected). It does not satisfy isQaReviewer and never makes anyone one.
import { hasExplicitGrant } from './module-access.js';

export const COA_PREP = 'coa-prep';
export const hasCoaPrep = (u) => hasExplicitGrant(u, COA_PREP);
/** True for a non-admin holding coa-prep: the account that may prepare and never decide. */
export const isCoaPrepOnly = (u) => !!u && u.role !== 'admin' && hasCoaPrep(u);

export const COA_PREP_ALLOWED = Object.freeze([
  { method: 'PUT', re: /^\/products\/[^/]+$/, what: 'the COA product list' },
  { method: 'POST', re: /^\/plans\/?$/, what: 'a new draft test plan' },
  { method: 'PUT', re: /^\/plans\/[^/]+$/, what: 'a draft test plan' },
  { method: 'POST', re: /^\/plans\/[^/]+\/new-version$/, what: 'a draft of the next plan version' },
  { method: 'PUT', re: /^\/requests\/[^/]+$/, what: "an unsigned request's fields (not its status)" },
]);

/** Router-level: refuses a coa-prep account any COA write outside the list. */
export function coaPrepGuard(req, res, next) {
  if (req.method === 'GET' || !isCoaPrepOnly(req.user)) return next();
  const ok = COA_PREP_ALLOWED.find(a => a.method === req.method && a.re.test(req.path));
  if (!ok) {
    return res.status(403).json({ error: 'This account holds the COA prep grant: it prepares plans, products and unsigned requests, and never approves, signs, un-signs, deletes or changes results.', coa_prep: true });
  }
  if (/^\/requests\//.test(req.path) && req.body?.status !== undefined) {
    return res.status(403).json({ error: 'The COA prep grant does not set a request\'s status. A person in Quality decides pass or fail.', coa_prep: true });
  }
  return next();
}
