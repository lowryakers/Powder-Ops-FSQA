// Signing refusals and the one-time void of never-issued numbers (D-228).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { signRefusals, voidUnissuedCertNumbers, allocateCertNumber, UNISSUED_REASON } from '../../server/coa-certificate.js';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE coa_requests (id TEXT PRIMARY KEY, item_number TEXT, item_description TEXT, lot_number TEXT, status TEXT,
      certificate_number TEXT, date_of_issuance TEXT, qa_signed_at TEXT, updated_at TEXT);
    CREATE TABLE coa_test_results (id TEXT PRIMARY KEY, request_id TEXT, test_type TEXT, pass_fail TEXT);
    CREATE TABLE coa_specifications (id TEXT PRIMARY KEY, item_number TEXT, test_type TEXT, is_active INTEGER);
    CREATE TABLE coa_counters (name TEXT PRIMARY KEY, value INTEGER);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);`);
  return d;
}

test('a request whose results are all N/A cannot be signed', () => {
  const d = db();
  d.prepare("INSERT INTO coa_requests (id, item_number, status) VALUES ('r', 'I', 'pass')").run();
  d.prepare("INSERT INTO coa_test_results VALUES ('a', 'r', 'Odor', 'na'), ('b', 'r', 'Taste', 'na')").run();
  const why = signRefusals(d, d.prepare("SELECT * FROM coa_requests WHERE id = 'r'").get());
  assert.ok(why.some(w => /no result passed/.test(w)), why.join(' | '));
  // One pass beside the N/As is signable.
  d.prepare("INSERT INTO coa_test_results VALUES ('c', 'r', 'Arsenic', 'pass')").run();
  assert.deepEqual(signRefusals(d, d.prepare("SELECT * FROM coa_requests WHERE id = 'r'").get()), []);
});

test('never-issued numbers on unsigned requests are voided once, audited, and never drawn again', () => {
  const d = db();
  const ins = d.prepare('INSERT INTO coa_requests (id, item_description, lot_number, status, certificate_number, date_of_issuance, qa_signed_at) VALUES (?,?,?,?,?,?,?)');
  ins.run('u1', 'Whey', 'L1', 'pending', '160210', '2026-08-01', null);
  ins.run('u2', 'Whey', 'L2', 'pass', '160215', null, null);
  ins.run('s1', 'Whey', 'L3', 'pass', '160200', '2026-07-01', '2026-07-01 10:00:00');
  ins.run('n1', 'Whey', 'L4', 'pending', null, null, null);
  const audit = [];
  const r = voidUnissuedCertNumbers(d, (...a) => audit.push(a));
  assert.deepEqual(r.voided.map(v => v.certificate_number).sort(), ['160210', '160215']);
  const num = (id) => d.prepare('SELECT certificate_number n FROM coa_requests WHERE id = ?').get(id).n;
  assert.equal(num('u1'), null); assert.equal(num('u2'), null);
  assert.equal(num('s1'), '160200', 'a signed request is never touched');
  assert.equal(d.prepare("SELECT COUNT(*) n FROM coa_requests WHERE qa_signed_at IS NULL AND certificate_number IS NOT NULL").get().n, 0);
  assert.equal(audit.length, 2);
  for (const a of audit) {
    assert.equal(a[1], 'void');
    assert.equal(a[4].reason, UNISSUED_REASON);
    assert.ok(a[4].voided_certificate_number);
  }
  // The counter is past every voided number: the next one issued is 160216.
  assert.equal(allocateCertNumber(d), '160216');
  // Once: a later run finds the marker and does nothing.
  d.prepare("UPDATE coa_requests SET certificate_number = '999' WHERE id = 'n1'").run();
  assert.equal(voidUnissuedCertNumbers(d, () => { throw new Error('must not audit'); }).already, true);
  assert.equal(num('n1'), '999');
});
