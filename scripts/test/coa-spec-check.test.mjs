// Malformed active specifications (D-225): the rule, and the one-time retire on item 202532.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { specProblems, retireMalformedSpecs } from '../../server/coa-spec-check.js';

test('specProblems names what cannot be right, and nothing else', () => {
  assert.match(specProblems({ test_type: 'Arsenic', min_value: 0.001, max_value: 0.1, unit: 'ppm' }).join(), /contaminant/);
  assert.match(specProblems({ test_type: 'E. coli', min_value: -1, max_value: 10, unit: null }).join(), /negative minimum/);
  assert.match(specProblems({ test_type: 'Salmonella', min_value: null, max_value: 10, unit: '' }).join(), /no unit/);
  assert.match(specProblems({ test_type: 'Total Aerobic Plate Count', min_value: 100, max_value: 50000, unit: 'cfu/g' }).join(), /contaminant/);
  assert.match(specProblems({ test_type: 'Moisture', min_value: 9, max_value: 2, unit: '%' }).join(), /above its maximum/);
  assert.deepEqual(specProblems({ test_type: 'Arsenic', min_value: null, max_value: 0.5, unit: 'ppm' }), []);
  assert.deepEqual(specProblems({ test_type: 'Protein', min_value: 80, max_value: null, unit: '%' }), []);
});

test('retireMalformedSpecs retires 202532 once, reports others, never touches drafts', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE coa_specifications (id TEXT PRIMARY KEY, item_number TEXT, test_type TEXT, unit TEXT, min_value REAL, max_value REAL,
    is_active INTEGER, approval_status TEXT DEFAULT 'approved', updated_at TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);`);
  const ins = db.prepare('INSERT INTO coa_specifications (id, item_number, test_type, unit, min_value, max_value, is_active, approval_status) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('bad-as', '202532', 'Arsenic', 'ppm', 0.001, 0.1, 1, 'approved');
  ins.run('bad-ec', '202532', 'E. coli', null, -1, 10, 1, 'approved');
  ins.run('ok-pb', '202532', 'Lead', 'ppm', null, 0.5, 1, 'approved');
  ins.run('other', '201177', 'Cadmium', 'ppm', 0.001, 0.1, 1, 'approved');
  ins.run('draft', '202532', 'Mercury', 'ppm', 0.001, 0.1, 0, 'draft');
  const audit = [];
  const r = retireMalformedSpecs(db, (...a) => audit.push(a));
  assert.deepEqual(r.retired.map(x => x.test_type).sort(), ['Arsenic', 'E. coli']);
  assert.deepEqual(r.reported.map(x => x.item_number), ['201177']);
  const active = (id) => db.prepare('SELECT is_active FROM coa_specifications WHERE id = ?').get(id).is_active;
  assert.equal(active('bad-as'), 0); assert.equal(active('bad-ec'), 0);
  assert.equal(active('ok-pb'), 1); assert.equal(active('other'), 1);
  assert.equal(db.prepare("SELECT approval_status s FROM coa_specifications WHERE id = 'draft'").get().s, 'draft');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM coa_specifications').get().n, 5, 'nothing deleted');
  assert.equal(audit.length, 2);
  assert.ok(audit.every(a => a[1] === 'retire'), 'audited as retire, never delete (D-230)');
  // Once: a malformed spec entered later on 202532 is reported, not retired.
  ins.run('later', '202532', 'Cadmium', 'ppm', 0.001, 0.1, 1, 'approved');
  const again = retireMalformedSpecs(db, () => {});
  assert.equal(again.retired.length, 0);
  assert.equal(active('later'), 1);
});
