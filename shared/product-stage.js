// Where a product actually is in the new-product flow (D-134).
//
// PURE — facts in, a stage out. The server stamps it on every product it
// returns, the drawer, the grid and the Pipeline render what they are given,
// and the New Product Creation tab prints the same STAGES entries as its
// reference text. One definition: a gate described one way on the reference
// tab and tested another way on the pipeline is how a rule stops being
// believed.
//
// THE STAGE IS DERIVED, NEVER STORED, NEVER TYPED. It is the furthest stage
// whose gate is met AND every gate before it — so a product whose formula
// moves past its approved panel falls from 8 to 4 by itself (the Apple Pie
// case), and a product that has shipped re-enters the flow the moment the
// formula it was made to changes. The flow is a loop, not a ladder: stage 9 is
// "every gate holds TODAY", not a place a product is filed.
//
// GATES REPORT, THEY NEVER REFUSE. Nothing here is read by a write path. Any
// field may be filled in any order; the stage only says how far the product
// has got and names the first thing it is waiting on.
//
// A GATE MET OUT OF ORDER IS HELD, not done. Artwork released against a panel
// that the formula has since moved past is still released — the film exists —
// but it does not count, and it reads amber until the gates before it hold
// again. That is the "artwork step goes amber" of rule (d).

import { normalizeGtin, gtinValid } from './gtin.js';
import { SKU_RE, FORMULA_REF_RE } from './product-fields.js';
import { fillWeightCheck } from './panel-provenance.js';

const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** A legacy code: letters/digits in dash-separated parts, as the 118 on film are. Never purely a number. */
const LEGACY_SKU_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i;

/**
 * The nine stages, in order. `done` is what has to be true; `owner` the role
 * that makes it true (roles, never people — a job changing hands must not
 * change the flow); `breaks` what goes wrong when it is done out of order.
 * These three strings ARE the reference tab.
 */
export const STAGES = [
  {
    n: 1, key: 'formula', label: 'Formula final', owner: 'Formulator',
    done: 'The product names its formula (F- and five digits) and the version it is made to.',
    breaks: 'A SKU and a GTIN minted for a formula that never ships: a purchased number spent on nothing.',
  },
  {
    n: 2, key: 'fill', label: 'Fill weight confirmed', owner: 'Ops',
    done: 'The fill weight in grams, from the formula, confirmed by weighing a sealed pack.',
    breaks: 'The panel and the net-weight check are computed against a number nobody weighed.',
  },
  {
    n: 3, key: 'sku', label: 'SKU created in ReadyDoc', owner: 'Ops',
    done: 'A SKU in the naming standard, minted here — before any other system sees the product.',
    breaks: 'A code from another system becomes the join key everywhere and cannot be renamed cheaply.',
  },
  {
    n: 4, key: 'gtin', label: 'GTIN assigned', owner: 'Ops',
    done: 'A GS1 number with a valid check digit.',
    breaks: 'A barcode drawn before the number is final is a relabel.',
  },
  {
    n: 5, key: 'panel', label: 'Nutrition panel approved, with provenance', owner: 'Formulator',
    done: 'An approved panel computed from the CURRENT formula version, at a BOM fill weight within 1% of the catalog\'s.',
    breaks: 'A correct panel for a formula that has moved: numbers that describe a different product.',
  },
  {
    n: 6, key: 'shopify', label: 'Shopify product created', owner: 'Ops',
    done: 'The listing is confirmed and Shopify carries the same SKU as ReadyDoc.',
    breaks: 'Orders split across two codes for one product; sales reporting splits with them.',
  },
  {
    n: 7, key: 'shiphero', label: 'ShipHero synced', owner: 'Fulfillment',
    done: 'The product is confirmed synced to ShipHero.',
    breaks: 'Stock arrives at the warehouse under a product the 3PL cannot pick.',
  },
  {
    n: 8, key: 'artwork', label: 'Artwork released', owner: 'Design',
    done: 'Artwork released print-ready, drawn against the approved panel\'s version.',
    breaks: 'Film printed from a superseded panel — on the shelf for nine months.',
  },
  {
    n: 9, key: 'po', label: 'Packaging PO placed', owner: 'Ops',
    done: 'A packaging PO recorded against the current released artwork.',
    breaks: 'Film ordered from artwork that is about to change.',
  },
];

/** The three incidents the reference tab carries — a rule with the real case attached. */
export const INCIDENTS = [
  {
    title: 'Four SKUs that are somebody else\'s numbers',
    stage: 3,
    text: '42224277651538 and three siblings are internal ids from another system — not SKUs, not GTINs. The products were created somewhere else first, so the code that reached ReadyDoc was whatever that system called them.',
  },
  {
    title: '"Yes" in Formula ref',
    stage: 1,
    text: 'A field whose helper text says "e.g. F-00002" held the word Yes. A tick in a text box said the formula existed without saying which one — so nothing downstream could be checked against it.',
  },
  {
    title: '33.32 g against 34.86 g',
    stage: 5,
    text: 'A panel generated at a 33.32 g fill from a stale formula copy while the BOM said 34.86 g. It showed 1 g of added sugar against a front panel claiming 0 g. The panel was internally correct; it described a formula that had moved.',
  },
];

export const STAGE_OWNERS = [...new Set(STAGES.map((s) => s.owner))];
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

/**
 * Each gate: `{ met, why }`. `why` is a sentence either way — what makes it
 * met, or exactly what is missing. Inputs:
 *   p        the product row (with `readiness` when the server has computed it)
 *   panel    the product's APPROVED nutrition panel: { version, provenance } or null
 *   artwork  the current RELEASED artwork: { id, version, nfp_version } or null
 *   po       the packaging PO recorded against that artwork: { po_number, ... } or null
 */
function gates({ p, panel, artwork, po }) {
  const step = (k) => (p.readiness?.steps || []).find((s) => s.key === k) || null;
  const out = {};

  // 1 · Formula final
  if (!present(p.mrp_formula_id)) out.formula = { met: false, why: 'No formula named — the product does not say which formula it is made to.' };
  else if (!FORMULA_REF_RE.test(String(p.mrp_formula_id).trim())) out.formula = { met: false, why: `Formula ref "${p.mrp_formula_id}" is not a formula reference (F- and five digits, e.g. F-00002).` };
  else if (!present(p.formula_rev)) out.formula = { met: false, why: `${p.mrp_formula_id} is named but not its version.` };
  else out.formula = { met: true, why: `Made to ${p.mrp_formula_id} ${p.formula_rev}.` };

  // 2 · Fill weight
  const fill = Number(p.fill_weight_g);
  out.fill = present(p.fill_weight_g) && Number.isFinite(fill) && fill > 0
    ? { met: true, why: `${fill} g fill.` }
    : { met: false, why: 'No fill weight in grams recorded.' };

  // 3 · SKU. The standard, or a legacy code already on film (D-131: legacy
  // codes are join keys and are never re-tested). A code that is only a number
  // is another system's id. The SKU is the table's key, so it is unique by
  // construction.
  const sku = String(p.sku || '');
  if (SKU_RE.test(sku)) out.sku = { met: true, why: `${sku} is in the naming standard.` };
  else if (/^\d+$/.test(sku)) out.sku = { met: false, why: `${sku} is a number from another system, not a SKU — the product was created somewhere else first. Rename it to the standard.` };
  else if (LEGACY_SKU_RE.test(sku)) out.sku = { met: true, why: `${sku} is a legacy code already on film; the rename to the standard is its own project.` };
  else out.sku = { met: false, why: sku ? `${sku} is not in the naming standard (LINE-PACK-FLAVOR).` : 'No SKU.' };

  // 4 · GTIN
  out.gtin = !present(p.gtin) ? { met: false, why: 'No GS1 number assigned.' }
    : gtinValid(p.gtin) ? { met: true, why: `GTIN ${normalizeGtin(p.gtin)} passes its check digit.` }
      : { met: false, why: `${p.gtin} fails its GS1 check digit.` };

  // 5 · Panel, WITH PROVENANCE. Not "a panel exists": approved, computed from
  // the current formula version, at a fill weight within 1%.
  if (!panel) out.panel = { met: false, why: 'No approved nutrition panel.' };
  else {
    const prov = panel.provenance || {};
    const fc = fillWeightCheck(prov.bom_fill_weight_g, p.fill_weight_g);
    if (!present(prov.formula_version)) out.panel = { met: false, why: `Panel ${panel.version} is approved but does not record which formula version it was computed from.` };
    else if (present(p.formula_rev) && String(prov.formula_version) !== String(p.formula_rev)) out.panel = { met: false, why: `Panel ${panel.version} was generated against formula ${prov.formula_version} and the formula is now ${p.formula_rev}.` };
    else if (present(prov.formula_ref) && present(p.mrp_formula_id) && String(prov.formula_ref) !== String(p.mrp_formula_id)) out.panel = { met: false, why: `Panel ${panel.version} was computed from ${prov.formula_ref}; the product is made to ${p.mrp_formula_id}.` };
    else if (fc.status === 'no_bom') out.panel = { met: false, why: `Panel ${panel.version} records no BOM fill weight.` };
    else if (fc.status === 'mismatch') out.panel = { met: false, why: `Panel ${panel.version} was computed at ${fc.bom} g; the catalog's fill is ${fc.catalogue} g (${fc.diff_pct}% apart, more than 1%).` };
    else if (fc.status === 'no_catalogue') out.panel = { met: false, why: `Panel ${panel.version} cannot be checked against a fill weight — none is recorded.` };
    else out.panel = { met: true, why: `Panel ${panel.version} approved, from ${prov.formula_ref || 'the formula'} ${prov.formula_version} at ${fc.bom} g.` };
  }

  // 6 · Shopify: the confirmation (not stale) and the same SKU.
  const sh = step('shopify');
  if (!sh || sh.state !== 'done') out.shopify = { met: false, why: sh?.state === 'stale' ? `The Shopify listing was confirmed before ${sh.changed_labels?.join(' and ') || 'something'} changed — confirm it again.` : 'Nobody has confirmed the Shopify product.' };
  else if (present(p.shopify_sku) && p.shopify_sku !== p.sku) out.shopify = { met: false, why: `Shopify carries ${p.shopify_sku}; ReadyDoc carries ${p.sku}.` };
  else out.shopify = { met: true, why: 'Listed in Shopify under the same SKU.' };

  // 7 · ShipHero
  const hero = step('shiphero');
  out.shiphero = hero?.state === 'done' ? { met: true, why: 'Synced to ShipHero.' }
    : { met: false, why: hero?.state === 'stale' ? 'The ShipHero sync was confirmed before the SKU or GTIN changed — confirm it again.' : 'Nobody has confirmed the ShipHero sync.' };

  // 8 · Artwork, released against the approved panel's version.
  if (!artwork) out.artwork = { met: false, why: 'No artwork released print-ready.' };
  else if (!panel) out.artwork = { met: false, why: `Artwork V${artwork.version} is released, but there is no approved panel for it to be drawn against.` };
  else if (String(artwork.nfp_version || '') !== String(panel.version)) out.artwork = { met: false, why: `Artwork V${artwork.version} was drawn against panel ${artwork.nfp_version || '(none recorded)'}; the approved panel is ${panel.version}.` };
  else out.artwork = { met: true, why: `Artwork V${artwork.version} released against panel ${panel.version}.` };

  // 9 · Packaging PO against the current artwork.
  out.po = !artwork ? { met: false, why: 'No released artwork for a PO to be placed against.' }
    : po ? { met: true, why: `PO ${po.po_number} placed against artwork V${artwork.version}${po.placed_on ? ` on ${po.placed_on}` : ''}.` }
      : { met: false, why: `No packaging PO recorded against artwork V${artwork.version}.` };
  return out;
}

/**
 * The stage: `{ stage, label, next, gates, blocked, summary, needs_work }`.
 * `stage` is 0 when not even the formula gate holds — "not started" — and
 * 1–9 otherwise. `next` is the first unmet gate, named; null at stage 9.
 */
export function stageOf({ p, panel = null, artwork = null, po = null, block = null }) {
  const g = gates({ p, panel, artwork, po });
  let stage = 0;
  for (const s of STAGES) { if (g[s.key].met) stage = s.n; else break; }
  const list = STAGES.map((s) => {
    const r = g[s.key];
    const state = s.n <= stage ? 'done' : r.met ? 'held' : s.n === stage + 1 ? 'next' : 'todo';
    return { n: s.n, key: s.key, label: s.label, owner: s.owner, met: r.met, state, why: r.why };
  });
  const nextGate = stage < 9 ? list[stage] : null;
  const blocked = block ? { reason: block.reason, owner: block.owner, by: block.blocked_by || block.by || null, at: block.blocked_at || block.at || null } : null;
  const label = stage === 0 ? 'Not started' : STAGES[stage - 1].label;
  const summary = nextGate
    ? `Stage ${stage} · next: ${nextGate.label.toLowerCase()} — ${nextGate.why}`
    : 'Stage 9 · every gate holds today. A new formula version sends it back through the flow.';
  return {
    stage, label, gates: list,
    next: nextGate ? { n: nextGate.n, key: nextGate.key, label: nextGate.label, owner: nextGate.owner, why: nextGate.why } : null,
    held: list.filter((x) => x.state === 'held').map((x) => x.key),
    blocked, summary,
    // Needs work: not every gate holds, and nobody has said it is waiting on
    // something outside this flow. A blocked product stays listed.
    needs_work: !blocked && stage < 9,
  };
}
