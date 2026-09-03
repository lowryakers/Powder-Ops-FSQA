// One definition of an area, reached from every door — and no custom-field
// scope offered that nothing reads.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { canonicalArea } from '../server/sanitation-areas.js';
import { KNOWN_SCOPES } from '../server/api/structure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

t('the canonical spelling is Restrooms', canonicalArea('Restroom') === 'Restrooms' && canonicalArea('Bathroom') === 'Restrooms');
t('the bulk backfill files the canonical area',
  /canonicalArea\(p\.area\) \|\| p\.area/.test(src('server/qa-record-backfill.js'))
  && /recordGroupFor\(area\)/.test(src('server/qa-record-backfill.js')));
t('the cleaning seed files the canonical spelling', /'Restrooms', 'pre_op'/.test(src('server/cleaning-seed.js'))
  && !/'Restroom', 'pre_op'/.test(src('server/cleaning-seed.js')));
t('the seed spelling is what canonicalArea would produce', canonicalArea('Restrooms') === 'Restrooms');

console.log('\n── scopes ──');
const scopes = KNOWN_SCOPES.map(s => s.scope);
for (const dead of ['supply_order', 'disposal', 'qms:deviation', 'qms:non_conformance', 'qms:on_hold']) {
  t(`${dead} is not offered — no route reads it`, !scopes.includes(dead));
}
// Every offered scope has a route that coerces it.
const apis = ['receiving', 'meetings', 'internal-audits', 'retention', 'reimbursements', 'visitors', 'candidates']
  .map(f => src(`server/api/${f}.js`)).join('\n');
for (const s of scopes) {
  t(`${s} is coerced by a route`, new RegExp(`coerceCustomData\\(db, '${s}'`).test(apis));
}
t('retention answers a required-field error with a 400',
  (src('server/api/retention.js').match(/errors\?\.length\) return res\.status\(400\)/g) || []).length === 2);
t('reimbursements answer a required-field error with a 400',
  (src('server/api/reimbursements.js').match(/errors\?\.length\) return res\.status\(400\)/g) || []).length === 2);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
