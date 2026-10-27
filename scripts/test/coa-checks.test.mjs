// The checks a result and a signature must pass (D-243, D-244), and the
// admin-run link script (D-245) on a scratch database. Pure apart from that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { compareReadToStored, editNeedsReason, squash, isHandEntered } from '../../server/coa-checks.js';
import { evaluate, applyPlan, counts, reviewCsv } from '../coa-link-results-to-specs.mjs';

const read = [
  { test_type: 'Total Aerobic Microbial Count (USP)', result_value: '<100', unit: 'cfu/g', mdl: '100', file_id: 'f1' },
  { test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', mdl: '4', file_id: 'f1' },
];
const stored = (over = {}) => [
  { id: 'a', test_type: 'Total Aerobic Microbial Count (USP)', result_value: '<100', unit: 'cfu/g', mdl: '100', source: 'pdf', source_file_id: 'f1' },
  { id: 'b', test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', mdl: '4', source: 'pdf', source_file_id: 'f1', ...over },
];

test('the same report and record: nothing to say', () => {
  const c = compareReadToStored(read, stored(), { readableFileIds: ['f1'] });
  assert.deepEqual(c, { problems: [], explained: [] });
});

test('case, spaces and a leading-dot MDL are not differences', () => {
  assert.equal(squash(' .001 '), squash('0.001'));
  assert.equal(squash('< 4'), squash('<4'));
  const c = compareReadToStored(read, stored({ result_value: '< 4', mdl: '4' }), { readableFileIds: ['f1'] });
  assert.equal(c.problems.length, 0);
});

test('a value that differs blocks — unless a person changed it with a reason', () => {
  let c = compareReadToStored(read, stored({ result_value: '<44' }), { readableFileIds: ['f1'] });
  assert.equal(c.problems.length, 1);
  assert.match(c.problems[0], /the report says <4 but the saved result is <44/);
  c = compareReadToStored(read, stored({ result_value: '<44', edit_reason: 'Typed from the paper copy' }), { readableFileIds: ['f1'] });
  assert.equal(c.problems.length, 0);
  assert.match(c.explained[0], /changed by hand: Typed from the paper copy/);
});

test('a line on the report that is not saved blocks', () => {
  const c = compareReadToStored(read, stored().slice(0, 1), { readableFileIds: ['f1'] });
  assert.match(c.problems[0], /"Gluten Allergen <4" is on the lab report but is not saved/);
});

test('a result saved "from the PDF" that the PDF no longer shows blocks', () => {
  const c = compareReadToStored(read.slice(0, 1), stored(), { readableFileIds: ['f1'] });
  assert.match(c.problems[0], /saved as read from the lab report, but the report no longer shows it/);
});

test('a result typed by hand is not expected on the report', () => {
  const s = [...stored(), { id: 'c', test_type: 'Moisture', result_value: '4.1', source: 'manual' }];
  assert.equal(compareReadToStored(read, s, { readableFileIds: ['f1'] }).problems.length, 0);
});

test('a reason is needed for a hand verdict or a changed value, not for the automatic one', () => {
  const spec = { test_type: 'Gluten Allergen', max_value: 20, unit: 'ppm' };
  assert.equal(editNeedsReason({ next: { result_value: '<4', unit: 'ppm', pass_fail: 'pass' }, spec, read: read[1] }).needed, false);
  const v = editNeedsReason({ next: { result_value: '<4', unit: 'ppm', pass_fail: 'fail' }, spec, read: read[1] });
  assert.equal(v.needed, true); assert.match(v.why, /set by hand/);
  const w = editNeedsReason({ next: { result_value: '<5', unit: 'ppm', pass_fail: 'pass' }, spec, read: read[1] });
  assert.equal(w.needed, true); assert.match(w.why, /differs from the lab report \(<4\)/);
  assert.equal(isHandEntered({ source: 'manual' }), true);
  assert.equal(isHandEntered({ source: 'pdf' }), false);
});

// ── the link script ─────────────────────────────────────────────────────────
function scratch() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE coa_requests (id TEXT PRIMARY KEY, item_number TEXT, item_description TEXT, lot_number TEXT, qa_signed_at TEXT);
    CREATE TABLE coa_specifications (id TEXT PRIMARY KEY, item_number TEXT, test_type TEXT, specification TEXT, min_value REAL, max_value REAL, unit TEXT, is_active INTEGER);
    CREATE TABLE coa_test_results (id TEXT PRIMARY KEY, request_id TEXT, test_type TEXT, result_value TEXT, unit TEXT, specification_id TEXT, pass_fail TEXT);
    CREATE TABLE coa_review_items (id TEXT PRIMARY KEY, item_key TEXT UNIQUE, kind TEXT, request_id TEXT, title TEXT, recommended_action TEXT, reason TEXT, evidence TEXT, steps TEXT, decision_ref TEXT, status TEXT DEFAULT 'open');`);
  db.prepare("INSERT INTO coa_requests VALUES ('r1','ITEM','Mix','101','')").run();
  db.prepare("UPDATE coa_requests SET qa_signed_at = NULL").run();
  db.prepare("INSERT INTO coa_requests VALUES ('r2','ITEM','Mix','102','2026-08-01 10:00')").run();
  db.prepare("INSERT INTO coa_specifications VALUES ('s1','ITEM','Lead',NULL,NULL,0.5,'ppm',1)").run();
  db.prepare("INSERT INTO coa_specifications VALUES ('s2','ITEM','Arsenic',NULL,NULL,0.5,'ppm',1)").run();
  const ins = db.prepare('INSERT INTO coa_test_results VALUES (?,?,?,?,?,NULL,?)');
  ins.run('t1', 'r1', 'Lead', '0.1', 'ppm', 'pass');         // agrees → LINK
  ins.run('t2', 'r1', 'Arsenic', '0.9', 'ppm', 'pass');      // disagrees → REVIEW
  ins.run('t3', 'r1', 'Moisture', '4', '%', 'pass');         // no spec → left alone
  ins.run('t4', 'r2', 'Lead', '0.1', 'ppm', 'pass');         // signed → never touched
  return db;
}

test('the link script: links only what agrees, on unsigned requests only', () => {
  const db = scratch();
  const plan = evaluate(db);
  assert.deepEqual(counts(plan), { LINK: 1, REVIEW: 1, NO_SPEC: 1 });
  assert.ok(!plan.some(p => p.result_id === 't4'), 'a signed request is not even considered');
  assert.match(reviewCsv(plan), /Arsenic.*the specification on file .* gives fail/);
  const audits = [];
  const out = applyPlan(db, { logAudit: (...a) => audits.push(a), fileItems: true });
  assert.equal(out.linked, 1); assert.equal(out.items, 1);
  assert.equal(db.prepare("SELECT specification_id s FROM coa_test_results WHERE id = 't1'").get().s, 's1');
  for (const id of ['t2', 't3', 't4']) assert.equal(db.prepare('SELECT specification_id s FROM coa_test_results WHERE id = ?').get(id).s, null);
  assert.equal(db.prepare("SELECT pass_fail p FROM coa_test_results WHERE id = 't2'").get().p, 'pass', 'the stored verdict is never changed');
  const item = db.prepare("SELECT * FROM coa_review_items WHERE kind = 'SPEC_LINK_REVIEW'").get();
  assert.deepEqual(JSON.parse(item.steps).result_ids, ['t2']);
  assert.equal(audits.filter(a => a[2] === 'coa_test_result').length, 1);
  // A second run writes nothing.
  const again = applyPlan(db, { logAudit: () => {}, fileItems: true });
  assert.equal(again.linked, 0); assert.equal(again.items, 0);
});
