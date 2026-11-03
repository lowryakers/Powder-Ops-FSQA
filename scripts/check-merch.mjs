// check:merch — the merch SKU and GTIN rules (D-302). Pure: no server, no database.
//
// Control: `main` before this change has no shared/merch.js and the import fails;
// with only the food rules, parseSku('MCH-HBDC-BLU-S') is null and the round
// trips fail.
import {
  MERCH_SKU_RE, buildStyleCode, buildMerchSku, parseMerchSku, parseStyleCode,
  variantTitle, gtinAssignRefusal, suggestNextGtin, MERCH_STEPS, merchStepsOf,
} from '../shared/merch.js';
import { buildSku, parseSku, preferredSku, LINE_CODES } from '../shared/sku-format.js';
import { SKU_RE, validateField } from '../shared/product-fields.js';
import { checkDigit, gtinValid } from '../shared/gtin.js';
import { readinessOf } from '../shared/product-readiness.js';
import { stageOf } from '../shared/product-stage.js';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('── merch SKUs ──');
t('MCH is the merch line code', LINE_CODES.Merch === 'MCH');
t('a 3-letter register code: buildStyleCode(H, BDC) = MCH-HBDC', buildStyleCode('H', 'BDC') === 'MCH-HBDC');
t('a 2-letter register code: buildStyleCode(H, MC) = MCH-HMC', buildStyleCode('H', 'MC') === 'MCH-HMC');
for (const sku of ['MCH-HBDC-BLU-S', 'MCH-HMC-BLK-XL', 'MCH-TBDC-PNK-OS', 'MCH-CMC-BRN-XXL']) {
  const p = parseSku(sku);
  const back = p && buildSku('MCH', p.style.slice(4), p.color, p.size);
  t(`${sku} round-trips through parseSku/buildSku`, back === sku, JSON.stringify(p));
}
t('parseSku names the parts of MCH-HBDC-BLU-S', JSON.stringify(parseSku('MCH-HBDC-BLU-S')) === JSON.stringify({ protein: 'MCH', pack: null, flavor: 'BDC', style: 'MCH-HBDC', garment: 'H', color: 'BLU', size: 'S', merch: true }));
t('buildMerchSku(MCH-HBDC, BLU, S)', buildMerchSku('MCH-HBDC', 'BLU', 'S') === 'MCH-HBDC-BLU-S');
t('parseMerchSku(MCH-HMC-BLK-M).flavor_code = MC', parseMerchSku('MCH-HMC-BLK-M')?.flavor_code === 'MC');
for (const bad of ['WHY-BTL-BLM-S', 'PLT-STK-VAN-L', 'BEF-PLG-CC-M']) t(`a four-part SKU on a food line is refused: ${bad}`, parseSku(bad) === null);
for (const bad of ['MCH-HBDC', 'MCH-HBDC-BLU', 'MCH-XBDC-BLU-S', 'MCH-HB-BLU-S', 'MCH-HBDCX-BLU-S', 'MCH-HBDC-BL-S', 'MCH-HBDC-BLU-XXXL', 'MCH-HBDC-BLU-S-1']) {
  t(`not a merch SKU: ${bad}`, !MERCH_SKU_RE.test(bad) && parseSku(bad) === null);
}
t('a bad garment builds nothing', buildStyleCode('Z', 'BDC') === null && buildMerchSku('MCH-ZBDC', 'BLU', 'S') === null);
t('a bad size builds nothing', buildMerchSku('MCH-HBDC', 'BLU', 'XXXL') === null);
t('parseStyleCode(MCH-HBDC)', parseStyleCode('MCH-HBDC')?.flavor_code === 'BDC');
t('the variant title', variantTitle({ flavor: 'Birthday Cake', garment: 'H', colorName: 'Blue', sizeCode: 's' }) === 'Birthday Cake Hoodie - Blue / S');

console.log('── food SKUs unchanged ──');
t('SKU_RE is unchanged', String(SKU_RE) === '/^[A-Z]{3}-[A-Z]{3}(?:-[A-Z0-9]{1,4})?$/', String(SKU_RE));
t('the food SKU rule still refuses a merch SKU', !validateField('sku', 'MCH-HBDC-BLU-S').ok && validateField('sku', 'WHY-BTL-BLM').ok);
t('food SKUs still parse as before', JSON.stringify(parseSku('WHY-BTL-BLM')) === JSON.stringify({ protein: 'WHY', pack: 'BTL', flavor: 'BLM' }) && JSON.stringify(parseSku('GFF-PSM')) === JSON.stringify({ protein: 'GFF', pack: 'PSM', flavor: null }));
t('food SKUs still build as before', buildSku('WHY', 'BTL', 'BLM') === 'WHY-BTL-BLM' && buildSku('GFF', 'PSM', '') === 'GFF-PSM');
t('the legacy shape still does not parse as new', parseSku('PP-BLM-23') === null);
t('preferredSku on a food row is unchanged', preferredSku({ category: 'Whey Protein', pack: 'BTL', base_flavor: 'Blueberry Muffin' }, { 'Blueberry Muffin': 'BLM' }).sku === 'WHY-BTL-BLM');

console.log('── GTIN suggestion ──');
const P = '850030869';
const g = (item) => `${P}${item}${checkDigit(`${P}${item}`)}`;
let s = suggestNextGtin(P, [], checkDigit);
t('an empty prefix suggests item 00, with a valid check digit', s.gtin === g('00') && gtinValid(s.gtin) && s.free === 100);
s = suggestNextGtin(P, [g('00'), g('01'), g('03')], checkDigit);
t('the LOWEST free item, filling a gap', s.item === '02' && s.free === 97);
s = suggestNextGtin(P, [g('00'), '850046726009', g('01')], checkDigit);
t('another prefix\'s numbers do not count', s.item === '02');
s = suggestNextGtin(P, Array.from({ length: 100 }, (_, i) => g(String(i).padStart(2, '0'))), checkDigit);
t('a full prefix suggests nothing', s === null);
t('a malformed prefix suggests nothing', suggestNextGtin('85003086', [], checkDigit) === null);

console.log('── who may be given a GTIN ──');
const v = { product_type: 'merch', sku: 'MCH-HBDC-BLU-S', color_code: 'BLU', size_code: 'S', gtin: null };
const blue = { code: 'BLU', name: 'Blue', confirming: true };
t('refused while the colour is confirming', /being confirmed/.test(gtinAssignRefusal(v, blue) || ''));
t('refused with no colour', /no color/.test(gtinAssignRefusal({ ...v, color_code: null }, null) || ''));
t('refused with no size', /no size/.test(gtinAssignRefusal({ ...v, size_code: null }, { ...blue, confirming: false }) || ''));
t('refused on a food product', /Only a merch/.test(gtinAssignRefusal({ ...v, product_type: 'food' }, blue) || ''));
t('refused when it already has one', /already carries/.test(gtinAssignRefusal({ ...v, gtin: g('00') }, { ...blue, confirming: false }) || ''));
t('allowed once the colour is confirmed', gtinAssignRefusal(v, { ...blue, confirming: false }) === null);

console.log('── food-only steps step aside for merch ──');
const merchRow = { ...v, sku: 'MCH-HBDC-BLU-S', category: 'Merch', pack: 'Apparel' };
const keys = readinessOf(merchRow).steps.map((x) => x.key);
t('merch readiness has no panel, formula, spec, artwork or brand-colour step', !['nfp', 'formula', 'spec', 'artwork', 'colors'].some((k) => keys.includes(k)), keys.join(','));
t('…and has the supplier/decorator step', keys.includes('supplier'));
const foodKeys = readinessOf({ sku: 'WHY-BTL-BLM', category: 'Whey Protein' }).steps.map((x) => x.key);
t('food readiness has no supplier step and keeps its panel step', !foodKeys.includes('supplier') && foodKeys.includes('nfp'));
const st = stageOf({ p: { ...merchRow, readiness: readinessOf(merchRow) } });
const gate = Object.fromEntries(st.gates.map((x) => [x.key, x.state]));
t('merch stage: formula, fill, panel, artwork and PO are not applicable', ['formula', 'fill', 'panel', 'artwork', 'po'].every((k) => gate[k] === 'na'), JSON.stringify(gate));
t('merch stage: the SKU gate holds on the merch rule, not the legacy one', gate.sku === 'done');
const bogus = stageOf({ p: { ...merchRow, sku: 'MCH-HBDC-BLU', readiness: readinessOf(merchRow) } });
t('…and does not hold for a malformed merch SKU', Object.fromEntries(bogus.gates.map((x) => [x.key, x.state])).sku !== 'done');

console.log('── the merch pipeline (Merch tab) ──');
t('six steps', MERCH_STEPS.length === 6);
const mr = (over = {}) => ({ ...merchRow, merch_supplier: 'S', merch_decorator: 'D', color: { code: 'BLU', name: 'Blue', confirming: false }, ...over });
const withR = (r) => ({ ...r, readiness: readinessOf(r) });
let f = merchStepsOf(withR(mr({ merch_supplier: '' })));
t('no supplier ⇒ waits at step 2 (index 1)', f.step === 1 && f.next.key === 'supplier', JSON.stringify(f.next));
f = merchStepsOf(withR(mr({ color: { code: 'BLU', name: 'Blue', confirming: true } })));
t('a confirming color ⇒ waits at "Color confirmed", saying so', f.step === 2 && /still being confirmed/.test(f.next.why));
f = merchStepsOf(withR(mr()));
t('color confirmed, no GTIN ⇒ waits at GTIN', f.step === 3 && f.next.key === 'gtin');
f = merchStepsOf(withR(mr({ gtin: g('05'), gtin_valid: 1, shopify_listed_at: '2026-11-01', shiphero_synced_at: '2026-11-01' })));
t('everything done ⇒ step 6, nothing next', f.step === 6 && f.next === null, JSON.stringify(f.steps.filter((x) => !x.done)));
t('a row with no readiness reads as not started, never done', merchStepsOf({}).step === 0);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
