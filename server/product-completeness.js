// The spec sheet's completeness: named gaps per SKU, never a score (D-128).
//
// Products is the spec sheet, and "what is still missing" had to be hunted for
// across the drawer, the Nutrition panels tab, the colours and the artwork
// board. This is one walk over all of them that answers it per SKU, per
// requirement group, BY FIELD NAME.
//
// NO PERCENTAGE ANYWHERE, and that is the design, not an omission. A score
// invites "we're at 94%, ship it"; a list of named gaps is a list that goes to
// zero. Roll-ups count SKUs and gaps — things a person can go and fix — and
// never divide.
//
// THE CONTRACT IS DATA (`GROUPS` below) and each entry reads the field that
// already OWNS that fact, never a copy: the product name is `products.flavor`,
// the flavour `base_flavor`, the line `category`, the packaging type `pack`,
// the formula ref and version `mrp_formula_id` / `formula_rev` (the catalogue's
// pointers), the film facts the packaging spec's columns, the spot colours the
// `product_colors` slots, the panel and its callouts the current `nfp_versions`
// row, provenance that row's block (shared/panel-provenance.js).
//
// NOT APPLICABLE IS A STATE, not a pass. Wind direction and an eye mark are
// facts about film fed off a roll (pouch, stick, a bottle's shrink sleeve); a
// carton or a cup has neither, and counting them as gaps would put a permanent
// red mark on 29 SKUs for something that cannot be filled.
//
// BLOCKED IS A THIRD STATE, not "incomplete". A plant bottle cannot be finished
// until its formula is final; that is a decision somebody owns, with a reason,
// and it reads differently on the dashboard from a field somebody forgot. A
// blocked SKU stays listed with its gaps and leaves the incomplete count.
//
// STALE is a flag beside the state: the panel was computed against a formula
// version the catalogue has moved past, or at a fill weight more than 1% off
// the catalogue's (shared/panel-provenance.js `provenanceStale`).

import { provenanceOf, provenanceMissing, provenanceStale } from '../shared/panel-provenance.js';
import { naOf } from '../shared/product-fields.js';

export const PACK_LABEL = { PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick pack', BOX: 'Carton', CUP: 'Cup', BTL: 'Bottle' };

/** Film fed off a roll carries a wind direction and an eye mark. */
export const ROLL_FED_FORMATS = new Set(['pouch', 'stick', 'bottle']);

/** The line a SKU is rolled up under: the product line and the pack. */
export const lineOf = (p) => `${p.category || 'Uncategorised'} · ${PACK_LABEL[p.pack] || p.pack || '?'}`;

const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// The mandatory panel fields, in the panel's own words (21 CFR 101.9 order).
export const PANEL_REQUIRED = [
  ['calories', 'Calories'], ['total_fat_g', 'Total fat'], ['saturated_fat_g', 'Saturated fat'],
  ['trans_fat_g', 'Trans fat'], ['cholesterol_mg', 'Cholesterol'], ['sodium_mg', 'Sodium'],
  ['total_carbohydrate_g', 'Total carbohydrate'], ['dietary_fiber_g', 'Dietary fiber'],
  ['total_sugars_g', 'Total sugars'], ['added_sugars_g', 'Added sugars'], ['protein_g', 'Protein'],
  ['vitamin_d_mcg', 'Vitamin D'], ['calcium_mg', 'Calcium'], ['iron_mg', 'Iron'], ['potassium_mg', 'Potassium'],
  ['ingredients', 'Ingredients'], ['allergen_statement', 'Allergen statement'],
  ['serving_size_desc', 'Serving size (description)'], ['serving_size_g', 'Serving size (g)'],
  ['servings_per_container', 'Servings per container'], ['net_weight_g', 'Net weight (g)'],
];

export const CALLOUTS_REQUIRED = [['protein_g', 'Protein callout'], ['calories', 'Calories callout'], ['added_sugar_g', 'Added sugar callout']];

const PROV_LABEL = { formula_ref: 'Panel formula ref', formula_version: 'Panel formula version', bom_fill_weight_g: 'Panel BOM fill weight' };

/**
 * Each group's check returns `{ missing: [label], na?: [label] }` — the named
 * gaps, and the fields that do not apply to this SKU.
 */
export const GROUPS = [
  {
    key: 'identity', label: 'Identity',
    check: ({ p }) => {
      const missing = [];
      if (!present(p.gtin)) missing.push('GTIN');
      else if (!p.gtin_valid) missing.push('GTIN (fails its check digit)');
      if (!present(p.flavor)) missing.push('Product name');
      if (!present(p.base_flavor)) missing.push('Flavor');
      if (!present(p.category)) missing.push('Line');
      if (!present(p.pack)) missing.push('Packaging type');
      return { missing };
    },
  },
  {
    key: 'packaging', label: 'Packaging',
    check: ({ p, spec, colors }) => {
      const missing = []; const na = [];
      if (!spec) {
        missing.push('Packaging spec');
      } else {
        if (!(present(spec.trim_length_mm) && present(spec.trim_width_mm))) missing.push(`Die / trim size (${spec.spec_id})`);
        if (!present(spec.material_structure)) missing.push(`Material (${spec.spec_id})`);
        const rollFed = ROLL_FED_FORMATS.has(String(spec.format || '').toLowerCase());
        if (rollFed) {
          if (!present(spec.wind_direction)) missing.push(`Wind direction (${spec.spec_id})`);
        } else na.push('Wind direction');
        // NA BY DECISION is a different fact from NA by derivation, and both are
        // done, not gaps: the carton has no eye mark because cartons do not;
        // this pouch has none because somebody with a name said so.
        if (naOf(p).eyemark_color) na.push('Eye mark color (marked not applicable)');
        else if (rollFed) {
          if (!present(p.eyemark_color)) missing.push('Eye mark color');
        } else na.push('Eye mark color');
      }
      if (!colors.some((c) => present(c.pms))) missing.push('PMS spot colors');
      if (!colors.some((c) => present(c.hex))) missing.push('Hex spot colors');
      if (p.dieline_required === null || p.dieline_required === undefined) missing.push('Die line required');
      return { missing, na };
    },
  },
  {
    key: 'formula', label: 'Formula',
    check: ({ p }) => {
      const missing = [];
      if (!present(p.mrp_formula_id)) missing.push('Formula ref');
      if (!present(p.formula_rev)) missing.push('Formula version');
      if (!present(p.fill_weight_g)) missing.push('Fill weight (g)');
      return { missing };
    },
  },
  {
    key: 'panel', label: 'Nutrition panel',
    check: ({ panel }) => {
      if (!panel) return { missing: ['No nutrition panel on file'] };
      const missing = [];
      if (panel.status !== 'approved') missing.push(`Panel ${panel.version} is ${panel.status}, not approved`);
      if (!present(panel.version)) missing.push('Panel version');
      const values = panel.values || {};
      for (const [k, label] of PANEL_REQUIRED) if (!present(values[k])) missing.push(label);
      return { missing };
    },
  },
  {
    key: 'callouts', label: 'Front call-outs',
    check: ({ panel }) => {
      if (!panel) return { missing: ['No nutrition panel on file'] };
      const c = panel.callouts || {};
      // Present = a value OR an explicit null ("not claimed on this pack").
      // Absent = nobody has answered. Two different facts (D-128).
      return { missing: CALLOUTS_REQUIRED.filter(([k]) => !(k in c) || c[k] === '').map(([, l]) => l) };
    },
  },
  {
    key: 'provenance', label: 'Provenance',
    check: ({ panel }) => {
      if (!panel) return { missing: ['No nutrition panel on file'] };
      return { missing: provenanceMissing(panel.provenance).map((k) => PROV_LABEL[k]) };
    },
  },
  {
    key: 'artwork', label: 'Artwork',
    check: ({ artwork }) => {
      if (!artwork) return { missing: ['No artwork on file'] };
      const missing = [];
      if (artwork.panel_rev === null || artwork.panel_rev === undefined) missing.push('Panel version the artwork was proofed against');
      if (!present(artwork.proof_job_id)) missing.push('Proof job id');
      return { missing };
    },
  },
];

// A group is incomplete while any field is missing. Not applicable is recorded
// per FIELD (`na`), shown beside the group — no group here is wholly
// inapplicable to a SKU, so a group-level N/A would be a state nothing reaches.
const groupState = (r) => (r.missing.length ? 'incomplete' : 'complete');

/** One SKU. Pure: every input is already fetched. */
export function completenessOf({ p, spec, colors = [], panel = null, artwork = null, block = null }) {
  const groups = {};
  const missing = [];
  for (const g of GROUPS) {
    const r = g.check({ p, spec, colors, panel, artwork });
    const res = { state: groupState(r), missing: r.missing, na: r.na || [] };
    groups[g.key] = res;
    for (const m of r.missing) missing.push(`${g.label}: ${m}`);
  }
  const stale = panel ? provenanceStale(panel.provenance, p) : [];
  const state = block ? 'blocked' : (missing.length ? 'incomplete' : 'complete');
  // EMPTY AND NOT-APPLICABLE ARE COUNTED APART: `gaps` is what is missing,
  // `na` is what was answered "does not apply" — by the pack format or by a
  // person (`na_fields`, the explicit ones, with who and when).
  const naLabels = Object.values(groups).flatMap((g) => g.na);
  return {
    sku: p.sku, product: p.flavor, line: lineOf(p), status: p.status,
    state, groups, missing, gaps: missing.length, stale,
    na: naLabels, na_count: naLabels.length, na_fields: naOf(p),
    block: block ? { reason: block.reason, owner: block.owner, by: block.blocked_by, at: block.blocked_at } : null,
    panel_version: panel?.version || null, panel_status: panel?.status || null,
  };
}

/** The current panel, the way the read endpoint picks it: approved, else the live draft. */
function currentPanels(db) {
  const rows = db.prepare(`SELECT * FROM nfp_versions WHERE status IN ('approved','draft','sent','rejected')
    ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, COALESCE(approved_at, '') DESC, updated_at DESC`).all();
  const out = new Map();
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  for (const v of rows) {
    if (out.has(v.sku)) continue;
    out.set(v.sku, { version: v.version, status: v.status, values: parse(v.panel_json) || {},
      callouts: parse(v.front_callouts) || {}, provenance: provenanceOf(v) });
  }
  return out;
}

/** The current artwork: print-ready first, else the newest live version; the primary component first. */
function currentArtwork(db) {
  const rows = db.prepare(`SELECT sku, component, version, status, panel_rev, proof_job_id FROM artwork_versions
    WHERE status NOT IN ('superseded','rejected')
    ORDER BY CASE component WHEN 'primary' THEN 0 ELSE 1 END, CASE status WHEN 'print_ready' THEN 0 ELSE 1 END, version DESC`).all();
  const out = new Map();
  for (const a of rows) if (!out.has(a.sku)) out.set(a.sku, a);
  return out;
}

/** The whole catalogue, one walk, with the roll-up by line. */
export function catalogueCompleteness(db) {
  const products = db.prepare('SELECT * FROM products ORDER BY category, pack, flavor').all();
  const specs = new Map(db.prepare('SELECT * FROM packaging_specs').all().map((s) => [s.spec_id, s]));
  const colors = new Map();
  for (const c of db.prepare('SELECT sku, pms, hex FROM product_colors').all()) {
    if (!colors.has(c.sku)) colors.set(c.sku, []);
    colors.get(c.sku).push(c);
  }
  const panels = currentPanels(db);
  const artwork = currentArtwork(db);
  const blocks = new Map(db.prepare('SELECT * FROM product_completeness_blocks').all().map((b) => [b.sku, b]));

  const rows = products.map((p) => completenessOf({
    p, spec: specs.get(p.spec_id) || null, colors: colors.get(p.sku) || [],
    panel: panels.get(p.sku) || null, artwork: artwork.get(p.sku) || null, block: blocks.get(p.sku) || null,
  }));

  // Counts of things, never a ratio. Every figure is `.length` of the rows under it.
  const lines = new Map();
  for (const r of rows) {
    if (!lines.has(r.line)) lines.set(r.line, { line: r.line, skus: [], complete: [], incomplete: [], blocked: [], stale: [], gaps: 0 });
    const l = lines.get(r.line);
    l.skus.push(r.sku);
    l[r.state].push(r.sku);
    if (r.stale.length) l.stale.push(r.sku);
    if (r.state === 'incomplete') l.gaps += r.gaps;
  }
  const lineRows = [...lines.values()].map((l) => ({
    line: l.line, skus: l.skus.length, complete: l.complete.length, incomplete: l.incomplete.length,
    blocked: l.blocked.length, stale: l.stale.length, gaps: l.gaps,
  })).sort((a, b) => b.gaps - a.gaps || a.line.localeCompare(b.line));

  return {
    rows,
    lines: lineRows,
    counts: {
      skus: rows.length,
      complete: rows.filter((r) => r.state === 'complete').length,
      incomplete: rows.filter((r) => r.state === 'incomplete').length,
      blocked: rows.filter((r) => r.state === 'blocked').length,
      stale: rows.filter((r) => r.stale.length).length,
      gaps: rows.filter((r) => r.state === 'incomplete').reduce((n, r) => n + r.gaps, 0),
      // SKUs carrying an explicit not-applicable, and the fields so marked.
      na_skus: rows.filter((r) => Object.keys(r.na_fields).length).length,
      na_fields: rows.reduce((n, r) => n + Object.keys(r.na_fields).length, 0),
    },
    groups: GROUPS.map((g) => ({ key: g.key, label: g.label })),
  };
}
