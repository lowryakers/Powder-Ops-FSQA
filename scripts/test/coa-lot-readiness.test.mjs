// The lot rule (D-246), pure: shared/coa-lot-readiness.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotReadiness, batchState, summarize } from '../../shared/coa-lot-readiness.js';

const plan = { status: 'approved', tests: [
  { test_type: 'Lead', evaluation: 'limit', required: 1 },
  { test_type: 'Gluten Allergen', evaluation: 'limit', required: 1 },
  { test_type: 'Moisture', evaluation: 'report_only', required: 1 },
  { test_type: 'Color', evaluation: 'limit', required: 0 },
] };
const good = () => [
  { test_type: 'Lead', result_value: '0.1', pass_fail: 'pass' },
  { test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', pass_fail: 'pass' },
  { test_type: 'Moisture', result_value: '4.2', pass_fail: null },
];
const req = (id, lot, extra = {}) => ({ id, lot_number: lot, signed: true, created_at: `2026-10-0${id.length}`, ...extra });

test('every batch signed with every required test passing: released', () => {
  const r = lotReadiness({ requests: [req('a', '101690-1'), req('b', '101690-2')], resultsByRequest: { a: good(), b: good() }, plan });
  assert.equal(r.state, 'met'); assert.equal(r.met, true);
  assert.equal(r.batches.length, 2);
  assert.equal(r.summary, '2 of 2 batches signed and passing — lot released');
});

test('one unsigned batch: not released, and the batch is named', () => {
  const r = lotReadiness({ requests: [req('a', '101690-1'), req('b', '101690-2', { signed: false })], resultsByRequest: { a: good(), b: good() }, plan });
  assert.equal(r.state, 'not_met');
  assert.equal(r.at_fault.length, 1); assert.equal(r.at_fault[0].batch, '2');
  assert.match(r.at_fault[0].reasons.join(), /not signed yet/);
  assert.equal(r.summary, '1 of 2 batches signed and passing — lot not released');
});

test('a required test with no result, or a judged one with no pass/fail, holds the batch; a report-only test needs only a result', () => {
  let s = batchState({ request: req('a', '1'), results: good().filter(x => x.test_type !== 'Lead'), plan });
  assert.deepEqual(s.reasons, ['no result for Lead']);
  s = batchState({ request: req('a', '1'), results: good().map(x => (x.test_type === 'Lead' ? { ...x, pass_fail: null } : x)), plan });
  assert.deepEqual(s.reasons, ['Lead has no pass/fail']);
  s = batchState({ request: req('a', '1'), results: good(), plan });
  assert.equal(s.state, 'ok', 'Moisture has no pass/fail and is report-only');
  s = batchState({ request: req('a', '1'), results: good(), plan: { ...plan, tests: plan.tests.filter(t => t.test_type !== 'Color') } });
  assert.equal(s.state, 'ok', 'an optional test is never asked for');
});

test('any failed result fails the batch, whether or not the plan names it', () => {
  const s = batchState({ request: req('a', '1'), results: [...good(), { test_type: 'Yeast', result_value: '900', pass_fail: 'fail' }], plan });
  assert.match(s.reasons.join(), /failed: Yeast/);
});

test('unread lines and a re-read that disagrees hold the batch', () => {
  const r = lotReadiness({ requests: [req('a', '9-1')], resultsByRequest: { a: good() }, plan, openUnread: new Set(['a']), reread: { a: { ok: false, problems: ['the report says <4 but the saved result is <44'] } } });
  assert.match(r.at_fault[0].reasons.join('|'), /still unread/);
  assert.match(r.at_fault[0].reasons.join('|'), /re-read: the report says <4/);
});

test('no approved plan is "unknown", never met', () => {
  let r = lotReadiness({ requests: [req('a', '1')], resultsByRequest: { a: good() }, plan: null });
  assert.equal(r.state, 'unknown'); assert.equal(r.met, false);
  assert.match(r.summary, /no required tests defined/);
  r = lotReadiness({ requests: [req('a', '1')], resultsByRequest: { a: good() }, plan: { ...plan, status: 'draft' } });
  assert.equal(r.state, 'unknown'); assert.match(r.summary, /not approved yet/);
});

test('a later passing re-test supersedes the failed request for the same batch', () => {
  const failed = [...good().filter(x => x.test_type !== 'Lead'), { test_type: 'Lead', result_value: '3', pass_fail: 'fail' }];
  const r = lotReadiness({ requests: [req('a', '101690-1', { created_at: '2026-10-01' }), req('bb', '101690-1', { created_at: '2026-10-05' })],
    resultsByRequest: { a: failed, bb: good() }, plan });
  assert.equal(r.state, 'met');
  assert.deepEqual(r.batches[0].superseded, ['a']);
  // …and `retest_of` follows a re-test filed under a different lot spelling.
  const r2 = lotReadiness({ requests: [req('a', '101690-1', { created_at: '2026-10-01' }), req('bb', 'RT-101690', { created_at: '2026-10-05', retest_of: 'a' })],
    resultsByRequest: { a: failed, bb: good() }, plan });
  assert.equal(r2.batches.length, 1); assert.equal(r2.state, 'met');
});

test('the sign door judges the request it is about to sign as if signed', () => {
  const r = lotReadiness({ requests: [req('a', '1', { signed: false })], resultsByRequest: { a: good() }, plan, assumeSigned: 'a' });
  assert.equal(r.state, 'met');
});

test('the gluten-free claim is supported only when every batch is under 20 ppm', () => {
  const hi = good().map(x => (x.test_type === 'Gluten Allergen' ? { ...x, result_value: '22' } : x));
  let r = lotReadiness({ requests: [req('a', '101690-1'), req('b', '101690-2')], resultsByRequest: { a: good(), b: good() }, plan, gfClaim: true });
  assert.equal(r.claim_supported, true);
  r = lotReadiness({ requests: [req('a', '101690-1'), req('b', '101690-2')], resultsByRequest: { a: good(), b: hi }, plan, gfClaim: true });
  assert.equal(r.claim_supported, false);
  r = lotReadiness({ requests: [req('a', '101690-1')], resultsByRequest: { a: good() }, plan });
  assert.equal(r.claim_supported, null, 'a product with no claim is not asked');
});

test('no request on file is not released', () => {
  const r = lotReadiness({ requests: [], plan });
  assert.equal(r.state, 'not_met'); assert.match(r.problems.join(), /no lab request/);
  assert.equal(summarize('not_met', [], []), '0 of 0 batches signed and passing — lot not released');
});
