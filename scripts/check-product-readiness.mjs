// The readiness model, and the dependency rule that is the point of it.
// Pure: no server, no database.
import { READINESS, readinessOf, nextBasis, FACTS } from '../shared/product-readiness.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const step = (r, key) => r.steps.find((s) => s.key === key);

// A product with everything satisfied.
const full = () => ({
  sku: 'BEF-BTL-CSG', gtin: '850079939066', gtin_valid: 1,
  spec_id: 'SPEC-BOTTLE', material_structure: 'PET',
  formula_approved_at: '2026-09-01T00:00:00.000Z',
  mrp_formula_id: null, formula_rev: null,
  nfp_version: 'V1', nfp_approved_at: '2026-09-01',
  artwork_status: 'print_ready', artwork_version: '3',
  colors: [{ pms_code: '7628 C', hex: '9F2E32' }],
  shopify_listed_at: '2026-09-01T00:00:00.000Z',
  shiphero_synced_at: '2026-09-01T00:00:00.000Z',
  readiness_basis: null,
});

console.log('\n── the steps ──');
let r = readinessOf(full());
t('everything satisfied reads complete', r.done === r.total, `${r.done}/${r.total}`);
t('nothing is outstanding', r.missing.length === 0);
t('the step order is stable', r.steps.map((s) => s.key).join(',')
  === 'sku,gtin,spec,formula,nfp,artwork,colors,shopify,shiphero', r.steps.map((s) => s.key).join(','));
t('three steps are ticked by a person', r.steps.filter((s) => s.tick).map((s) => s.key).join(',') === 'formula,shopify,shiphero');
// The screenshot's own row: a numeric Shopify variant id is not a SKU.
t('a bare Shopify variant id is not a SKU', step(readinessOf({ ...full(), sku: '42224277651538' }), 'sku').state === 'todo');
t('"MRP formula" is named for the fact, not the system',
  READINESS.find((s) => s.key === 'formula').label === 'Approved formula');

console.log('\n── the first-sight rule ──');
// THE most important behaviour here: a step satisfied before any of this
// existed has no recorded basis, and must read as done. Otherwise the deploy
// that ships this lights up all 118 products amber at once.
t('no basis at all means done, never stale', readinessOf(full()).stale.length === 0);
t('...for every step', (() => { const st = readinessOf(full()).steps; return st.length > 0 && st.every((s) => s.state === 'done'); })());

console.log('\n── recording what a step was true against ──');
const before = { ...full(), artwork_status: null, readiness_basis: null };
const after = { ...before, artwork_status: 'print_ready' };
const b1 = nextBasis(before, after, ['artwork_status'], 'Lowry');
const parsed = JSON.parse(b1);
t('releasing artwork records its basis', !!parsed.artwork);
t('the basis holds every dependency the step declares',
  Object.keys(parsed.artwork.deps).sort().join(',') === 'colors,flavor,gtin,nfp,spec',
  Object.keys(parsed.artwork.deps).join(','));
t('and who did it', parsed.artwork.by === 'Lowry');

console.log('\n── a change upstream makes the step stale ──');
const released = { ...after, readiness_basis: b1 };
t('untouched, it stays done', step(readinessOf(released), 'artwork').state === 'done');

const gtinMoved = { ...released, gtin: '850079939059' };
const artwork = step(readinessOf(gtinMoved), 'artwork');
t('correcting the GTIN makes the artwork stale', artwork.state === 'stale', artwork.state);
t('it names what changed', artwork.changed_labels.join() === 'the GTIN', artwork.changed_labels.join());
// The whole point: it comes back onto the punch list.
t('A STALE STEP IS NOT DONE', artwork.done === false);
t('and it is counted as outstanding', readinessOf(gtinMoved).missing.includes('Artwork print-ready'));
t('it says how to clear it', /Release the artwork again/.test(artwork.redo || ''));
t('steps that did not depend on it are untouched',
  step(readinessOf(gtinMoved), 'spec').state === 'done' && step(readinessOf(gtinMoved), 'colors').state === 'done');

console.log('\n── the graph, one dependency at a time ──');
const basisAll = nextBasis({ ...full(), readiness_basis: null, artwork_status: null, nfp_version: null,
  shopify_listed_at: null, shiphero_synced_at: null }, full(), READINESS.flatMap((s) => s.owns || []), 'Lowry');
const ready = { ...full(), readiness_basis: basisAll };
t('the baseline is clean', readinessOf(ready).stale.length === 0, readinessOf(ready).stale.join());

const cases = [
  ['the GTIN', { gtin: '850079939059' }, ['Artwork print-ready', 'Listed in Shopify', 'Synced to ShipHero']],
  ['the SKU', { sku: 'BEF-BTL-XXX' }, ['Listed in Shopify', 'Synced to ShipHero']],
  ['the packaging spec', { spec_id: 'SPEC-POUCH-LG' }, ['Artwork print-ready']],
  ['the product name', { flavor: 'Churro Beef Protein Bottle' }, ['NFP approved', 'Artwork print-ready']],
  ['the approved formula', { formula_approved_at: '2026-10-10T00:00:00.000Z' }, ['NFP approved']],
  ['the nutrition panel', { nfp_version: 'V2' }, ['Artwork print-ready']],
  ['the brand colours', { colors: [{ pms_code: '7631 C', hex: '552E2E' }] }, ['Artwork print-ready']],
];
for (const [what, patch, expected] of cases) {
  const got = readinessOf({ ...ready, ...patch }).stale.sort();
  t(`${what} moves → ${expected.join(' + ')}`, got.join('|') === [...expected].sort().join('|'), got.join('|'));
}
// A formula change reaching the panel is the one worth stating out loud: the
// panel is computed FROM the recipe, so a new recipe is a new panel.
t('a formula change does NOT reach the artwork directly',
  !readinessOf({ ...ready, formula_approved_at: '2026-10-10T00:00:00.000Z' }).stale.includes('Artwork print-ready'));

console.log('\n── clearing it ──');
// Re-doing the step is what moves its basis. Editing anything else must not.
const stale = { ...ready, gtin: '850079939059' };
const unrelated = nextBasis(stale, { ...stale, notes: 'x' }, ['notes'], 'Lowry');
t('an unrelated edit leaves it stale',
  readinessOf({ ...stale, readiness_basis: unrelated }).stale.includes('Artwork print-ready'));
const rereleased = nextBasis(stale, stale, ['artwork_status'], 'Lowry');
t('re-releasing the artwork clears it',
  !readinessOf({ ...stale, readiness_basis: rereleased }).stale.includes('Artwork print-ready'));
t('re-confirming Shopify clears only Shopify',
  readinessOf({ ...stale, readiness_basis: nextBasis(stale, stale, ['shopify_listed_at'], 'Lowry') })
    .stale.sort().join('|') === 'Artwork print-ready|Synced to ShipHero');

console.log('\n── un-ticking ──');
const off = { ...ready, shopify_listed_at: null };
t('un-ticking puts the step back to outstanding', step(readinessOf(off), 'shopify').state === 'todo');
t('a step that is no longer satisfied drops its basis',
  !JSON.parse(nextBasis(ready, off, ['shopify_listed_at'], 'Lowry')).shopify);
// And re-ticking must not come back stale against a basis from before.
const back = { ...ready, readiness_basis: nextBasis(ready, off, ['shopify_listed_at'], 'Lowry') };
t('re-ticking is clean, not stale',
  !readinessOf({ ...back, readiness_basis: nextBasis(off, ready, ['shopify_listed_at'], 'Lowry') })
    .stale.includes('Listed in Shopify'));

console.log('\n── a dependency added later is not a change ──');
// Same reasoning as first-sight: a step stamped before a dependency existed has
// no value recorded for it, so it cannot read as having moved.
const partial = { ...ready, readiness_basis: JSON.stringify({ artwork: { deps: { gtin: FACTS.gtin(ready) } } }) };
t('only the recorded dependencies are compared',
  readinessOf({ ...partial, spec_id: 'SPEC-OTHER' }).stale.length === 0);
t('...and a recorded one still bites',
  readinessOf({ ...partial, gtin: '850079939059' }).stale.includes('Artwork print-ready'));

console.log('\n── bad input ──');
t('an unparseable basis is treated as none', readinessOf({ ...full(), readiness_basis: '{oops' }).stale.length === 0);
t('an empty product does not throw', readinessOf({}).done === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
