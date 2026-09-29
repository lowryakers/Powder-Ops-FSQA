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

// D-118: the plant writes the word AFTER the bracket — "Room 7 (72 hr) cleanning"
// — and the suffix rule anchored the bracket to the end, so the plant's own
// dominant spelling was refused while the tidier one folded.
t('"Room 7 (72 hr) cleanning" — the plant\'s spelling — folds to Room 7', canonicalArea('Room 7 (72 hr) cleanning') === '7', canonicalArea('Room 7 (72 hr) cleanning'));
t('"Room 8 (72 hr) cleaning" folds to the retired Room 8, not nothing', canonicalArea('Room 8 (72 hr) cleaning') === '8');
t('"Room 7 (72 HR cleaning)" still folds — nothing regressed', canonicalArea('Room 7 (72 HR cleaning)') === '7');
t('"Batching room 2 (72 Hr cleanning)" still folds', canonicalArea('Batching room 2 (72 Hr cleanning)') === 'Batching 2');
t('only the cleaning word is allowed after the bracket — "Room 7 (72 hr) storage" is still refused', canonicalArea('Room 7 (72 hr) storage') === null);
t('a chemical is not a room and is refused, never guessed', canonicalArea('Simple Green') === null && canonicalArea('Sanitizer Dilution') === null);

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
