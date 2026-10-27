// The one release rule for a ProDough lot (D-246, COA Phase 2 task D1). PURE:
// rows in, an answer out — the sign door, the production sign-off door, the
// readiness report and publishing all call it, so they cannot disagree.
//
// A lot is its BASE lot; its batches are the COA requests on file for that base
// lot (101690-1, 101690-2 — D-237). A batch is ok only when:
//   · its request is signed,
//   · every required test of the product's approved plan has a result,
//   · every judged ("limit") test passed — a report-only test needs only a result,
//   · no result failed,
//   · no line of its lab report is left unread (an open UNREAD_ROWS item),
//   · the re-read of its lab report matches what is saved (when it was checked).
// A later signed pass for the same batch supersedes an earlier failed request
// (a re-test: `retest_of` when set, else the same batch). The lot is MET only
// when every batch is ok. No approved plan means "unknown" — never met.
import { splitLot, glutenSupportsGfClaim } from './lot-model.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const defaultMatch = (testType, results) => results.find(r => norm(r.test_type) === norm(testType)) || null;

export const LOT_STATES = { met: 'Released', not_met: 'Not released', unknown: 'No required tests defined' };

/**
 * One batch request against the plan. `assumeSigned` lets the sign door judge
 * the request it is about to sign (it is not signed yet by definition).
 */
export function batchState({ request, results = [], plan, unreadOpen = false, reread = null, match = defaultMatch, assumeSigned = false }) {
  const reasons = [];
  if (!request.signed && !assumeSigned) reasons.push('not signed yet');
  if (results.some(r => r.pass_fail === 'fail')) {
    reasons.push(`failed: ${results.filter(r => r.pass_fail === 'fail').map(r => r.test_type).join(', ')}`);
  }
  if (plan) {
    for (const t of plan.tests.filter(x => x.required !== 0 && x.required !== false)) {
      const r = match(t.test_type, results);
      if (!r || r.result_value == null || String(r.result_value).trim() === '') { reasons.push(`no result for ${t.test_type}`); continue; }
      if (t.evaluation !== 'report_only' && r.pass_fail !== 'pass' && r.pass_fail !== 'fail') reasons.push(`${t.test_type} has no pass/fail`);
    }
  }
  if (unreadOpen) reasons.push('lines of the lab report are still unread');
  if (reread && reread.ok === false) reasons.push(...(reread.problems || ['the lab report no longer matches what is saved']).map(p => `re-read: ${p}`));
  return { state: reasons.length ? 'not_ok' : 'ok', reasons };
}

/**
 * The lot. `requests`: [{ id, lot_number, signed, retest_of, created_at }];
 * `resultsByRequest`: { [id]: results }; `openUnread`: Set of request ids;
 * `reread`: { [id]: { ok, problems } } for what was re-read (else untested).
 */
export function lotReadiness({ requests = [], resultsByRequest = {}, plan = null, openUnread = new Set(), reread = {}, gfClaim = false, match = defaultMatch, assumeSigned = null } = {}) {
  const approved = plan && plan.status === 'approved';
  const byId = new Map(requests.map(r => [r.id, r]));
  const batchKey = (r) => {
    let cur = r; const seen = new Set();
    while (cur?.retest_of && byId.has(cur.retest_of) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.retest_of); }
    return splitLot(cur?.lot_number).batch ?? '';
  };
  const groups = new Map();
  for (const r of requests) {
    const k = batchKey(r);
    if (!groups.has(k)) groups.set(k, []);
    const one = batchState({ request: r, results: resultsByRequest[r.id] || [], plan: approved ? plan : null,
      unreadOpen: openUnread.has(r.id), reread: reread[r.id] || null, match, assumeSigned: assumeSigned === r.id });
    groups.get(k).push({ ...one, request_id: r.id, lot_number: r.lot_number, signed: !!r.signed, created_at: r.created_at || '' });
  }
  const batches = [...groups].map(([batch, list]) => {
    const ok = list.filter(b => b.state === 'ok').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pick = ok[0] || [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    return { batch: batch || null, request_id: pick.request_id, lot_number: pick.lot_number, state: pick.state, reasons: pick.reasons,
      superseded: list.filter(b => b.request_id !== pick.request_id).map(b => b.request_id) };
  }).sort((a, b) => String(a.batch ?? '').localeCompare(String(b.batch ?? ''), undefined, { numeric: true }));
  const problems = [];
  if (!requests.length) problems.push('no lab request on file for this lot');
  if (!approved) problems.push(plan ? 'the product\'s test plan is not approved yet' : 'no required tests defined (no approved test plan)');
  const at_fault = batches.filter(b => b.state !== 'ok');
  const missing_tests = [...new Set(batches.flatMap(b => b.reasons.filter(x => x.startsWith('no result for ')).map(x => x.slice(14))))];
  const state = !approved ? 'unknown' : (requests.length && !at_fault.length ? 'met' : 'not_met');
  let claim_supported = null;
  if (gfClaim) {
    claim_supported = batches.length > 0 && batches.every(b => {
      const g = (resultsByRequest[b.request_id] || []).filter(r => /gluten/i.test(r.test_type));
      return g.length > 0 && g.every(x => x.pass_fail === 'pass' && glutenSupportsGfClaim(x));
    });
  }
  return { met: state === 'met', state, batches, at_fault, missing_tests, problems, claim_supported,
    summary: summarize(state, batches, problems) };
}

/** "1 of 2 batches signed and passing — lot not released", in words. */
export function summarize(state, batches, problems = []) {
  if (state === 'unknown') return problems[0] || LOT_STATES.unknown;
  const ok = batches.filter(b => b.state === 'ok').length;
  if (state === 'met') return `${ok} of ${batches.length} batch${batches.length === 1 ? '' : 'es'} signed and passing — lot released`;
  return `${ok} of ${batches.length} batch${batches.length === 1 ? '' : 'es'} signed and passing — lot not released`;
}
