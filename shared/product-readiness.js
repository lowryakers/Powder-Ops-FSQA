// WHAT A PRODUCT STILL OWES — and what stops being true when something moves.
//
// ONE definition, both sides. The server computes it on every read and the
// drawer renders it; a second copy in a component is how the checklist and the
// catalogue's Ready column start disagreeing about the same SKU.
//
// TWO IDEAS, and the second is the one that was missing:
//
//   1. A step is DONE when its record exists. Nothing is ticked by hand except
//      the three that record work done in another system — a formula approved
//      in the MRP, a listing in Shopify, a sync to ShipHero. ReadyDoc cannot
//      see into those, so a person says so, and it is stamped with their name
//      and the date rather than being a bare boolean.
//
//   2. A step is STALE when it was done and something it DEPENDED ON has since
//      changed. Artwork signed off print-ready is not print-ready any more once
//      the GTIN moves — the barcode on that film is now the wrong number. The
//      old model could not say that: every step was an independent tick, so a
//      corrected GTIN left eight green ticks and a pack that must not print.
//
// A stale step does NOT count as done. That is the whole point — it comes back
// onto the punch list, naming what changed, until somebody redoes it.
//
// THE FIRST-SIGHT RULE, and it is the most important thing here. A step
// satisfied before any of this existed has no recorded basis, and is treated as
// DONE, never stale. The alternative — comparing against nothing and calling it
// a change — would light up all 118 products amber on the deploy that shipped
// this, which is how a warning becomes wallpaper. The same reasoning as
// `controlled.js` recording a never-seen definition as the approved baseline
// silently. A dependency added to a step later behaves the same way: it is
// absent from what was recorded, so it cannot read as having moved.

/**
 * The facts a step can depend on.
 *
 * Each returns a string that changes when the fact changes and at no other
 * time. Keep them cheap — they are computed for every step of every product on
 * every read of the catalogue.
 */
export const FACTS = {
  sku: (p) => p.sku || '',
  gtin: (p) => p.gtin || '',
  spec: (p) => p.spec_id || '',
  // The name printed on the pack, and the name the panel is filed against.
  flavor: (p) => `${p.flavor || ''}|${p.base_flavor || ''}`,
  // A re-approved formula is a new formula as far as the panel is concerned.
  formula: (p) => `${p.formula_approved_at || ''}|${p.mrp_formula_id || ''}|${p.formula_rev || ''}`,
  nfp: (p) => p.nfp_version || '',
  colors: (p) => (p.colors || [])
    .map((c) => `${c.pms_code || c.pms || ''}:${c.hex || ''}`).sort().join(','),
};

/** How a changed dependency is named to a person. */
export const FACT_LABEL = {
  sku: 'the SKU', gtin: 'the GTIN', spec: 'the packaging spec',
  flavor: 'the product name', formula: 'the approved formula',
  nfp: 'the nutrition panel', colors: 'the brand colours',
};

/**
 * The steps, in the order they are shown.
 *
 * `owns`    — the columns whose change means this step was RE-DONE. Writing one
 *             of them re-stamps the basis; writing anything else does not, which
 *             is what lets an upstream edit leave the step stale.
 * `depends` — the facts that must still hold for the step to remain true.
 * `tick`    — work done in another system, confirmed by a person here.
 * `redo`    — what a person has to do to clear it once stale, for the steps
 *             that are not a simple tick.
 */
export const READINESS = [
  {
    key: 'sku', label: 'SKU assigned',
    // A bare numeric code is a Shopify variant id that arrived with the import,
    // not a SKU somebody assigned.
    ok: (p) => !!p.sku && !/^\d{8,}$/.test(p.sku),
    owns: ['sku'],
  },
  {
    key: 'gtin', label: 'GS1 barcode',
    ok: (p) => !!p.gtin && !!p.gtin_valid,
    owns: ['gtin'],
  },
  {
    key: 'spec', label: 'Packaging spec',
    ok: (p) => !!p.spec_id && !!p.material_structure,
    owns: ['spec_id'],
  },
  {
    // "MRP formula" named the system rather than the fact, and the system is
    // being replaced (MRPEasy → Keychain). What matters is that a recipe was
    // approved, wherever it lives.
    key: 'formula', label: 'Approved formula', tick: true,
    ok: (p) => !!p.formula_approved_at,
    owns: ['formula_approved_at', 'mrp_formula_id', 'formula_rev'],
  },
  {
    key: 'nfp', label: 'NFP approved',
    ok: (p) => !!p.nfp_version && !!p.nfp_approved_at,
    owns: ['nfp_version', 'nfp_approved_at'],
    // The panel is computed FROM the recipe and carries the product's name.
    depends: ['formula', 'flavor'],
    redo: 'Approve the next panel version under Nutrition panels.',
  },
  {
    key: 'artwork', label: 'Artwork print-ready',
    ok: (p) => p.artwork_status === 'print_ready',
    owns: ['artwork_status', 'artwork_version'],
    // Everything printed on the film. A change to any of them means the film
    // on file is not the film this product needs.
    depends: ['gtin', 'spec', 'nfp', 'flavor', 'colors'],
    redo: 'Release the artwork again once it has been redrawn.',
  },
  {
    key: 'colors', label: 'Brand colours',
    ok: (p) => (p.colors || []).length > 0,
    owns: [],
  },
  {
    key: 'shopify', label: 'Listed in Shopify', tick: true,
    ok: (p) => !!p.shopify_listed_at,
    owns: ['shopify_listed_at', 'shopify_sku'],
    // Shopify snapshots the SKU onto every order line and scans the barcode.
    depends: ['sku', 'gtin'],
  },
  {
    key: 'shiphero', label: 'Synced to ShipHero', tick: true,
    ok: (p) => !!p.shiphero_synced_at,
    owns: ['shiphero_synced_at'],
    // Inventory locations and open order lines are keyed to the SKU.
    depends: ['sku', 'gtin'],
  },
];

/** The three steps a person confirms, by key. */
export const TICKABLE = READINESS.filter((s) => s.tick).map((s) => s.key);

export function parseBasis(raw) {
  return (() => {
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  })();
}

function fingerprint(step, p) {
  const out = {};
  for (const d of step.depends || []) out[d] = FACTS[d](p);
  return out;
}

/**
 * Which of a step's dependencies have moved since it was satisfied.
 *
 * A dependency ABSENT from what was recorded is skipped, never counted as
 * changed — see the first-sight rule at the top.
 */
function movedSince(step, p, recorded) {
  const out = [];
  for (const d of step.depends || []) {
    if (!recorded || !(d in recorded)) continue;
    if (FACTS[d](p) !== recorded[d]) out.push(d);
  }
  return out;
}

export function readinessOf(p) {
  const basis = parseBasis(p.readiness_basis);
  const steps = READINESS.map((s) => {
    const meta = { key: s.key, label: s.label, tick: !!s.tick, redo: s.redo || null };
    if (!s.ok(p)) return { ...meta, state: 'todo', done: false, changed: [] };
    const rec = basis[s.key];
    const moved = movedSince(s, p, rec?.deps);
    return {
      ...meta,
      state: moved.length ? 'stale' : 'done',
      // `done` is kept for callers that only ever asked the yes/no question.
      // A STALE STEP IS NOT DONE — that is what puts it back on the list.
      done: moved.length === 0,
      changed: moved,
      changed_labels: moved.map((d) => FACT_LABEL[d] || d),
      at: rec?.at || null,
      by: rec?.by || null,
    };
  });
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    missing: steps.filter((s) => !s.done).map((s) => s.label),
    stale: steps.filter((s) => s.state === 'stale').map((s) => s.label),
  };
}

/**
 * The basis to store after a write.
 *
 * A step is re-stamped only when it has just BECOME satisfied, or when one of
 * the columns it owns was written in this same edit — that second clause is
 * what "I have redone it" means. Anything else leaves the recorded basis alone,
 * so an upstream change makes the step stale instead of being quietly absorbed.
 *
 * A step that has stopped being satisfied loses its basis entirely: there is
 * nothing left to be stale about, and keeping it would make the step read as
 * stale the moment it is satisfied again.
 */
export function nextBasis(before, after, changedColumns = [], who = null) {
  const basis = { ...parseBasis(before?.readiness_basis) };
  const touched = new Set(changedColumns);
  const now = new Date().toISOString();
  for (const s of READINESS) {
    if (!s.ok(after)) { delete basis[s.key]; continue; }
    const redone = (s.owns || []).some((c) => touched.has(c));
    // Already satisfied, not re-done, and already has a baseline: leave it.
    if (s.ok(before) && !redone && basis[s.key]) continue;
    basis[s.key] = {
      at: basis[s.key] && !redone ? basis[s.key].at : now,
      by: basis[s.key] && !redone ? basis[s.key].by : who,
      deps: fingerprint(s, after),
    };
  }
  return JSON.stringify(basis);
}
