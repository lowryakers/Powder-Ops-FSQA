/**
 * Does an item's specification cover what 21 CFR 111.70 asks for, and was
 * identity confirmed by something other than a look, smell and taste?
 * (CAR 4990683-3, finding 4.3.6.)
 *
 * PURE and in `shared/` because the COA screen shows the same gaps the server
 * refuses on. The categories are the rule's: identity, purity, strength,
 * composition, and limits on contaminants. A test is placed by name, from
 * the plant's own test vocabulary (the COA picker's groups plus the names the
 * laboratory prints). A name nothing matches is `null` — recorded, never
 * guessed into a category.
 *
 * The gate has three modes, kept in app_settings.coa_release_gate:
 *   off  — grade and record nothing about coverage
 *   warn — a release goes through and carries its gaps (the default while the
 *          specification program catches up; the count is what QA works down)
 *   on   — a lot whose item lacks coverage cannot be released
 */

export const CATEGORIES = ['identity', 'purity', 'strength', 'composition', 'contaminants'];
export const CATEGORY_LABEL = {
  identity: 'Identity', purity: 'Purity', strength: 'Strength (potency / assay)',
  composition: 'Composition', contaminants: 'Limits on contaminants (micro, heavy metals, allergens)',
};
export const GATE_MODES = ['off', 'warn', 'on'];

const RULES = [
  ['organoleptic', /organoleptic|sensory/i],
  ['identity', /\bftir\b|\bid\b|identity|identification|\bnir\b|\bhptlc\b|\btlc\b|fingerprint/i],
  ['contaminants', /aerobic|coliform|e\.?\s?coli|salmonella|staph|yeast|mold|mould|listeria|bacillus|enterobact|micro|arsenic|cadmium|mercury|\blead\b|heavy metal|pesticide|aflatoxin|mycotoxin|gluten|allergen|residual solvent|melamine/i],
  ['strength', /potency|assay|vitamin|\bmg\/serving|per serving|label claim|caffeine|creatine|active/i],
  ['composition', /moisture|water activity|\baw\b|protein|\bfat\b|carbohydrate|\bash\b|mineral|calcium|sodium|iron\b|magnesium|potassium|zinc|fiber|fibre|sugar|loss on drying|particle|bulk density|\bph\b/i],
  ['purity', /purity|impurit|foreign matter|sieve|related substances|adulterant/i],
];

/** 'identity' | 'purity' | 'strength' | 'composition' | 'contaminants' | 'organoleptic' | null */
export function categoryOf(testType) {
  const t = String(testType || '');
  if (!t.trim()) return null;
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return null;
}

/** Which categories the item's ACTIVE specs cover, and which are missing. */
export function specCoverage(specs = []) {
  const covered = Object.fromEntries(CATEGORIES.map(c => [c, []]));
  const unplaced = [];
  for (const s of specs) {
    const c = categoryOf(s.test_type);
    if (c && covered[c]) covered[c].push(s.test_type);
    else if (c !== 'organoleptic') unplaced.push(s.test_type);
  }
  const missing = CATEGORIES.filter(c => covered[c].length === 0);
  return { covered, missing, unplaced };
}

/**
 * Was identity confirmed by more than a look, smell and taste? True when a
 * result of an identity-category test exists with a pass verdict.
 */
export function identityEvidence(results = []) {
  const idTests = results.filter(r => categoryOf(r.test_type) === 'identity');
  return { confirmed: idTests.some(r => r.pass_fail === 'pass'), tests: idTests.map(r => r.test_type),
    organoleptic_only: idTests.length === 0 && results.some(r => categoryOf(r.test_type) === 'organoleptic') };
}

/** The gate. `gaps` is what a release would carry (warn) or be refused on (on). */
export function releaseGate({ specs = [], results = [], mode = 'warn' } = {}) {
  const cov = specCoverage(specs);
  const id = identityEvidence(results);
  const gaps = cov.missing.map(c => `No approved specification for ${CATEGORY_LABEL[c].toLowerCase()}`);
  if (!id.confirmed) gaps.push(id.organoleptic_only ? 'Identity confirmed by organoleptic test only' : 'No identity test result on this lot');
  const m = GATE_MODES.includes(mode) ? mode : 'warn';
  return { mode: m, gaps, ok: gaps.length === 0, blocks: m === 'on' && gaps.length > 0, coverage: cov, identity: id };
}
