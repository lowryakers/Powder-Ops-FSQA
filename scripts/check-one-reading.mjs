// One nullable column, one reading — and the server reads an admin's map the
// way the client does.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { moduleLevel as serverLevel } from '../server/module-access.js';
import { moduleLevel as clientLevel } from '../src/utils/permissions.js';
import { needsLoto } from '../shared/equipment-types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── an admin\'s restriction map, both sides ──');
const cases = [
  ['admin, no map', { role: 'admin', module_access: null }],
  ['admin restricted to pm', { role: 'admin', module_access: { pm: 'edit' } }],
  ['admin with only an opt-in grant', { role: 'admin', module_access: { 'dannys-list': 'edit' } }],
  ['supervisor mapped', { role: 'supervisor', module_access: { coa: 'view', pm: 'edit' } }],
  ['operator, no map', { role: 'operator', module_access: null }],
];
for (const [label, u] of cases) {
  for (const m of ['pm', 'coa', 'settings', 'dannys-list']) {
    t(`${label} → ${m}: server and client agree`, serverLevel(u, m) === clientLevel(u, m),
      `server ${serverLevel(u, m)} / client ${clientLevel(u, m)}`);
  }
}
t('A MODULE UN-TICKED FOR AN ADMIN IS NOT WRITABLE THROUGH THE API', serverLevel({ role: 'admin', module_access: { pm: 'edit' } }, 'coa') === null);
t('...but Settings can never be taken from an admin', serverLevel({ role: 'admin', module_access: { pm: 'edit' } }, 'settings') === 'edit');

console.log('\n── loto_required: NULL reads one way ──');
t('needsLoto reads NULL as "needs a procedure"', needsLoto({ loto_required: null }) === true && needsLoto({ loto_required: 0 }) === false);
t('every SQL reader COALESCEs the same way',
  (src('server/api/compliance.js').match(/COALESCE\(loto_required, 1\) = 1/g) || []).length === 2
  && /COALESCE\(e\.loto_required, 1\) = 1/.test(src('server/api/loto.js'))
  && !/[^(]\bloto_required = 1\b/.test(src('server/api/compliance.js').replace(/COALESCE\(loto_required, 1\) = 1/g, ''))
  && !/e\.loto_required = 1\b/.test(src('server/api/loto.js')));
t('boot closes NULL off', /UPDATE equipment SET loto_required = 1 WHERE loto_required IS NULL/.test(src('server/db.js')));

console.log('\n── one reading of the rest ──');
const compliance = src('server/api/compliance.js');
const joins = compliance.match(/(LEFT )?JOIN equipment e ON wo\.equipment_id = e\.id/g) || [];
t('every work-order → equipment join on the dashboard is a LEFT JOIN', joins.length >= 2 && joins.every(j => j.startsWith('LEFT ')), joins.join(' | '));
t('the form register groups NULL record_group with sanitation',
  /GROUP BY area, COALESCE\(record_group, 'sanitation'\)/.test(src('server/api/forms.js')));
t('the facility tile reads last_clean from the group the 72-hour rule reads',
  /result = 'pass' AND COALESCE\(record_group, 'sanitation'\) = 'sanitation'/.test(src('server/api/facility.js')));
t('the dead form-registry grant branch is gone',
  !/ma\['form-registry'\]/.test(src('server/api/forms.js')) && /moduleLevel\(user, '/.test(src('server/api/forms.js')));
t('the QA Review count carries no duplicated predicate',
  !/qa_waived_at IS NULL AND qa_waived_at IS NULL/.test(src('server/qa-review.js')));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
