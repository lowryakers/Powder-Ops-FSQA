// The Settings module editor and the permission rule have to agree about what
// an empty map means. They did not: the editor rendered `null` as "Full access
// (all modules)" for everyone, while moduleLevel() reads it as NO access for
// anybody but an admin — so adding a new user promised them every module and
// gave them none. And the checkbox could not be unticked, because
// `Object.keys({}).every(...)` is true.
//
// Every assertion below runs the editor's rule and the REAL moduleLevel over
// the same map, so the two cannot drift apart again.
import assert from 'node:assert/strict';
import { isFullAccess, fullAccessMap, noAccessMap, expandedMap } from '../shared/module-access.js';
import { moduleLevel, canViewModule } from '../src/utils/permissions.js';
import { OPT_IN_MODULES } from '../shared/opt-in-modules.js';

const IDS = ['production-log', 'sanitation', 'equipment', 'receiving-log', ...OPT_IN_MODULES];
const ORDINARY = IDS.filter(id => !OPT_IN_MODULES.includes(id));
const OPT_IN = OPT_IN_MODULES[0];

let n = 0, bad = 0;
const ok = (label, fn) => {
  n++;
  try { fn(); } catch (e) { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); return; }
  console.log(`  ok    ${label}`);
};
const user = (role, map) => ({ role, department: 'warehouse', module_access: map });

console.log('\nWhat an empty map means');
ok('a new operator with no map has NO modules (server)', () => {
  ORDINARY.forEach(id => assert.equal(moduleLevel(user('operator', null), id), null));
});
ok('...and the editor no longer calls that full access', () => {
  assert.equal(isFullAccess('operator', null, IDS), false);
});
ok('an empty object is the same as null for an operator, both sides', () => {
  assert.equal(isFullAccess('operator', {}, IDS), false);
  ORDINARY.forEach(id => assert.equal(moduleLevel(user('operator', {}), id), null));
});
ok('an admin with no map DOES have everything, both sides', () => {
  assert.equal(isFullAccess('admin', null, IDS), true);
  ORDINARY.forEach(id => assert.equal(moduleLevel(user('admin', null), id), 'edit'));
});

console.log('\nThe vacuous-truth trap that made the checkbox dead');
ok('an empty map is not "every key is opt-in"', () => {
  // The original test. [].every() === true, so {} read back as full access and
  // unticking the box could never take effect.
  assert.equal(Object.keys({}).every(k => OPT_IN_MODULES.includes(k)), true);
  assert.equal(isFullAccess('operator', {}, IDS), false, 'the rule must not use that test');
});
ok('unticking full access on an operator produces a map that stays unticked', () => {
  const off = noAccessMap(null);
  assert.equal(isFullAccess('operator', off, IDS), false);
});
ok('ticking it back on produces a map that reads as full access', () => {
  const on = fullAccessMap('operator', null, IDS);
  assert.equal(isFullAccess('operator', on, IDS), true);
});

console.log('\nFull access has to be written down for a non-admin');
ok('the stored map really grants every ordinary module (server)', () => {
  const map = fullAccessMap('operator', null, IDS);
  ORDINARY.forEach(id => assert.equal(moduleLevel(user('operator', map), id), 'edit', id));
});
ok('an admin at full access is still stored as null, not 54 keys', () => {
  assert.equal(fullAccessMap('admin', null, IDS), null);
});
ok('a supervisor is not special-cased — absence is still nothing', () => {
  assert.equal(isFullAccess('supervisor', null, IDS), false);
  assert.equal(moduleLevel(user('supervisor', null), 'production-log'), null);
});

console.log('\nOpt-in grants ride along untouched');
ok('full access never includes the opt-in module', () => {
  const map = fullAccessMap('operator', null, IDS);
  assert.equal(map[OPT_IN], undefined);
  assert.equal(moduleLevel(user('operator', map), OPT_IN), null);
});
ok('an existing opt-in grant survives turning full access on', () => {
  const map = fullAccessMap('operator', { [OPT_IN]: 'edit' }, IDS);
  assert.equal(map[OPT_IN], 'edit');
  assert.equal(moduleLevel(user('operator', map), OPT_IN), 'edit');
});
ok('...and survives turning it off', () => {
  assert.deepEqual(noAccessMap({ [OPT_IN]: 'edit' }), { [OPT_IN]: 'edit' });
});
ok('an admin holding only an opt-in grant still has full access', () => {
  assert.equal(isFullAccess('admin', { [OPT_IN]: 'edit' }, IDS), true);
  assert.equal(moduleLevel(user('admin', { [OPT_IN]: 'edit' }), 'sanitation'), 'edit');
});

console.log('\nUnticking one module from full access keeps the rest');
ok('an operator loses exactly the one module', () => {
  const base = expandedMap('operator', fullAccessMap('operator', null, IDS), IDS);
  delete base['sanitation'];
  assert.equal(canViewModule(user('operator', base), 'sanitation'), false);
  assert.equal(canViewModule(user('operator', base), 'production-log'), true);
});
ok('an admin becomes a restriction map rather than staying unrestricted', () => {
  const base = expandedMap('admin', null, IDS);
  delete base['sanitation'];
  assert.equal(isFullAccess('admin', base, IDS), false);
  assert.equal(moduleLevel(user('admin', base), 'sanitation'), null);
  assert.equal(moduleLevel(user('admin', base), 'settings'), 'edit', 'ADMIN_ALWAYS');
});

console.log('\nThe default prop is the safe reading');
ok('an unpassed role is treated as non-admin', () => {
  // Bulk permissions never targets admins (the endpoint excludes them), and a
  // caller that forgets the prop must get the strict answer, not the loose one.
  assert.equal(isFullAccess(undefined, null, IDS), false);
});

console.log(`\n${n - bad}/${n} assertions passed`);
process.exit(bad ? 1 : 0);
