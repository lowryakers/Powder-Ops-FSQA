// gradeReadings() graded an EMPTY form as COMPLETE and PASS, because
// `[].every()` is true. controlled.js would apply a snapshot with `points: []`.
// Both halves asserted here; no server needed.
import assert from 'node:assert/strict';
import { gradeReadings, SCALE_FORMS } from '../server/scale-forms.js';

let n = 0, bad = 0;
const ok = (label, fn) => { n++; try { fn(); console.log(`  ok    ${label}`); } catch (e) { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); } };
const real = SCALE_FORMS[0];

console.log('\nThe grader');
ok('a form with NO points is not complete and is not a pass', () => {
  const g = gradeReadings({ ...real, points: [] }, []);
  assert.equal(g.empty, true);
  assert.equal(g.complete, false);
  assert.equal(g.result, 'fail');
});
ok('the real form with every reading on nominal passes', () => {
  const g = gradeReadings(real, real.points.map(p => p.nominal));
  assert.equal(g.empty, false); assert.equal(g.complete, true); assert.equal(g.result, 'pass');
});
ok('one reading out of tolerance fails', () => {
  const vals = real.points.map(p => p.nominal); vals[0] = real.points[0].nominal + real.points[0].tolerance * 10;
  assert.equal(gradeReadings(real, vals).result, 'fail');
});
ok('a missing reading is incomplete, not a pass', () => {
  const vals = real.points.map(p => p.nominal); vals[1] = '';
  const g = gradeReadings(real, vals);
  assert.equal(g.complete, false); assert.equal(g.result, 'fail');
});

console.log('\nThe snapshot that could feed it an empty list');
{
  // Reproduce controlled.js's apply() against a copy of the form, so the
  // module-level SCALE_FORMS is never mutated by this check.
  const form = { ...real, points: real.points.map(p => ({ ...p })) };
  const apply = (snap) => {
    if (Array.isArray(snap.points) && snap.points.length) form.points = snap.points;
    if (snap.unit) form.unit = snap.unit;
  };
  ok('a snapshot with points: [] leaves the form\'s points alone', () => {
    const before = form.points.length; apply({ points: [], unit: form.unit });
    assert.equal(form.points.length, before); assert.ok(before > 0);
  });
  ok('a snapshot with real points still applies', () => {
    const pts = [{ nominal: 1, tolerance: 0.01 }]; apply({ points: pts });
    assert.equal(form.points.length, 1);
  });
}
ok('the guard in controlled.js is the one asserted above', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server/controlled.js', import.meta.url), 'utf8');
  assert.match(src, /Array\.isArray\(snap\.points\) && snap\.points\.length\) form\.points = snap\.points/);
});

setTimeout(() => { console.log(`\n${n - bad}/${n} assertions passed`); process.exit(bad ? 1 : 0); }, 50);
