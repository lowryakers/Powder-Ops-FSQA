// The sensory shape, asserted end to end — written so it FAILS when V2 lands
// half-way: one definition, and every second copy gone.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SENSORY_KEYS, LEGACY_SENSORY_KEYS, sensoryNoteKey, sensoryShape, sensoryComplete, sensoryResult, formIsV2, productKey } from '../shared/sensory.js';
import { QMS_TYPES } from '../server/qms-config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

console.log('\n── the one definition ──');
t('V2 is the form: appearance, odor, taste, color, texture', SENSORY_KEYS.join(',') === 'appearance,odor,taste,color,texture');
t('the retired keys are not reused', !SENSORY_KEYS.includes('aroma') && !SENSORY_KEYS.includes('flavor') && !SENSORY_KEYS.includes('overall'));
const v2 = { appearance: 'pass', odor: 'pass', taste: 'fail', taste_result: 'bitter aftertaste', color: 'pass', texture: 'pass' };
const v1 = { appearance: '4', texture: '4', aroma: '3', flavor: '2', overall: '3' };
t('a V2 record is read as V2', sensoryShape(v2) === 'v2');
t('a V1 record is read as V1 — shared keys do not fool it', sensoryShape(v1) === 'v1');
t('nothing answered is no shape', sensoryShape({ product: 'x' }) === null);
t('V2: one Doesn\'t match fails the test', sensoryResult(v2) === 'fail');
t('V2: five matches pass', sensoryResult({ ...v2, taste: 'pass' }) === 'pass');
t('V2: four matches are not complete and not a result', !sensoryComplete({ ...v2, taste: 'pass', texture: '' }) && sensoryResult({ ...v2, taste: 'pass', texture: '' }) === null);
t('V2: a Doesn\'t match is a fail even before the rest is answered', sensoryResult({ ...v2, texture: '' }) === 'fail');
t('V1: below 3 fails, as it always did', sensoryResult(v1) === 'fail' && sensoryResult({ ...v1, flavor: '3' }) === 'pass');
t('V1: part-scored is incomplete', !sensoryComplete({ appearance: '4' }));
t('the note key is derived, not typed', sensoryNoteKey('odor') === 'odor_result');
t('a product name folds to one key', productKey('  Whey   Blueberry Muffin ') === 'whey blueberry muffin' && productKey('WHEY BLUEBERRY MUFFIN') === 'whey blueberry muffin');

console.log('\n── both forms carry the shape from the definition ──');
for (const key of ['organoleptic', 'flavor_approval']) {
  const cfg = QMS_TYPES[key];
  t(`${key} is a V2 form`, formIsV2(cfg.fields));
  t(`${key} carries every attribute and its result cell`, SENSORY_KEYS.every(k => cfg.fields.some(f => f.key === k && f.type === 'sensory') && cfg.fields.some(f => f.key === sensoryNoteKey(k) && f.type === 'sensory_note')));
  t(`${key} carries no 1–5 select`, !cfg.fields.some(f => Array.isArray(f.options) && f.options.join('') === '12345'));
  t(`${key} has no passFail table of its own`, !cfg.passFail && cfg.sensory === true);
}
t('the form code says V2', QMS_TYPES.organoleptic.formCode === 'Form 602-01 V2');

console.log('\n── the second copies are gone ──');
const qms = src('server/api/qms.js');
t('qms.js has no threshold arithmetic of its own', !/passFail\.threshold/.test(qms) && !/parseInt\(rec\[k\], 10\)/.test(qms));
t('the disposal is raised from sensoryResult', /sensoryResult\(rec\) !== 'fail'/.test(qms));
t('the FA → ORG copy carries both shapes and the spec snapshot', /sensoryShape\(rec\) === 'v2' \? \[\.\.\.SENSORY_KEYS/.test(qms) && /data\.sensory_spec = rec\.sensory_spec/.test(qms));
t('the public approval page builds its panel from the definition', /SENSORY_KEYS, \.\.\.SENSORY_KEYS\.map\(sensoryNoteKey\), \.\.\.LEGACY_SENSORY_KEYS/.test(src('server/api/submit.js')));
t('the log badge has no threshold of its own', !/cfg\.passFail/.test(src('src/components/compliance/QMSRecordsPanel.jsx')) && /return sensoryResult\(rec\)/.test(src('src/components/compliance/QMSRecordsPanel.jsx')));
t('FlavorPanel has no private completeness rule', !/SENSORY\.every/.test(src('src/components/compliance/FlavorPanel.jsx')) && /sensoryComplete\(values\)/.test(src('src/components/compliance/FlavorPanel.jsx')));
t('no user-facing string still lists aroma / flavor / overall as the ask', !/appearance, texture, aroma, flavor and overall — the approval/.test(qms) && !/This needs its sensory evaluation first — appearance, texture, aroma/.test(qms));
t('the process map describes V2', /against the product\\'s written specification/.test(src('src/data/processFlows.js')) && !/1–5 scale/.test(src('src/data/processFlows.js')));
t('the form register reads V2', /code: 'FORM 602-01', revision: 'V2'/.test(src('shared/form-registry.js')));
t('the sensory route is declared before /:type', qms.indexOf("router.get('/sensory-specs'") < qms.indexOf("router.get('/:type'"));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
