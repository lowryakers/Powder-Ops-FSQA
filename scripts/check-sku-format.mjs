// check:skuformat — the SKU standard's vocabulary (shared/sku-format.js) and the
// R-0313 additions: line codes HYD / PRE (PR #43) and the eight ProDough stick
// flavour codes. Pure: no server, no database.
import { LINE_CODES, PACK_CODES, SKU_PART, preferredSku, parseSku, buildSku } from '../shared/sku-format.js';
import { R0313_FLAVORS, R0313_NOTE } from '../server/flavor-code-r0313.js';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const lines = Object.values(LINE_CODES);
const packs = Object.values(PACK_CODES);
t('every line code is unique', new Set(lines).size === lines.length, lines.join(','));
t('every line code matches SKU_PART', lines.every(c => SKU_PART.test(c)));
for (const [name, code] of [['Hydration', 'HYD'], ['Pre-Workout', 'PRE']]) {
  t(`${name} is ${code}`, LINE_CODES[name] === code);
  t(`${code} matches SKU_PART /^[A-Z]{2,4}$/`, SKU_PART.test(code));
  t(`${code} clashes with no pack code (${packs.join('/')})`, !packs.includes(code));
}

const codes = Object.fromEntries(R0313_FLAVORS.map(f => [f.flavor, f.code]));
const rkp = preferredSku({ category: 'Hydration', pack: 'STK', base_flavor: 'Rocket Pop' }, codes);
t('Hydration · stick · Rocket Pop → HYD-STK-RKP', rkp.sku === 'HYD-STK-RKP' && rkp.blocked_by.length === 0, JSON.stringify(rkp));
const tpc = preferredSku({ category: 'Pre-Workout', format: 'Stick', base_flavor: 'Tropical' }, codes);
t('Pre-Workout · stick · Tropical → PRE-STK-TPC', tpc.sku === 'PRE-STK-TPC' && tpc.blocked_by.length === 0, JSON.stringify(tpc));
t('product_line wins over category, the way the catalogue reads it',
  preferredSku({ product_line: 'Hydration', category: 'Whey Protein', pack: 'STK', base_flavor: 'Rocket Pop' }, codes).sku === 'HYD-STK-RKP');
t('parseSku reads HYD-STK-RKP back', JSON.stringify(parseSku('HYD-STK-RKP')) === JSON.stringify({ protein: 'HYD', pack: 'STK', flavor: 'RKP' }));
t('parseSku reads PRE-STK-TPC back', parseSku('PRE-STK-TPC')?.protein === 'PRE');
const blocked = preferredSku({ category: 'Hydration', pack: 'STK', base_flavor: 'Mango' }, codes);
t('a Hydration flavour with no code is blocked, naming the gap', blocked.sku === null && /Mango has no flavor code/.test(blocked.blocked_by.join()));
t('Tropical Paradise is not Tropical — it gets no TPC from this list', !codes['Tropical Paradise']);

t('eight R-0313 flavours', R0313_FLAVORS.length === 8);
t('each R-0313 code matches SKU_PART', R0313_FLAVORS.every(f => SKU_PART.test(f.code)));
t('R-0313 codes are unique', new Set(R0313_FLAVORS.map(f => f.code)).size === 8);
t('no R-0313 code is a line or pack code', R0313_FLAVORS.every(f => !lines.includes(f.code) && !packs.includes(f.code)));
t('every R-0313 SKU assembles on a stick', R0313_FLAVORS.every(f => buildSku('HYD', 'STK', f.code) === `HYD-STK-${f.code}`));
t('the note names the release', R0313_NOTE === 'ProDough stick supplements, R-0313, 2026-10-19');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
