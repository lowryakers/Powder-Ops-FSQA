// Which product a dropped file belongs to.
//
// The plant has folders of finished NFPs and artwork in Drive, named by
// whoever made them. Attaching them one at a time is the reason 118 products
// have no panel on file. This is the matcher behind the bulk import.
//
// THE RANK IS THE WHOLE DESIGN. A GTIN in the filename is an identification; a
// flavour name that looks a bit like another flavour name is a guess. The first
// three tiers below are applied without asking, the last is only ever
// SUGGESTED, and nothing is auto-applied on a tie. Attaching a nutrition panel
// to the wrong SKU is worse than leaving it unattached — the panel is the thing
// artwork prints from, and a wrong one is a relabel.
//
// The same order the artwork-proofing ingest already follows: GTIN before SKU,
// "because a decoded barcode is the only unambiguous identification".

import { cleanFilename, revisionFromFilename } from './filename-meta.js';

/* ── Text shaping ─────────────────────────────────────────────────────────── */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

// Words that appear in almost every filename and identify nothing. Matching on
// them makes every pancake file look like every other pancake file.
const NOISE = new Set([
  'nfp', 'nutrition', 'facts', 'panel', 'label', 'artwork', 'art', 'proof', 'final',
  'approved', 'draft', 'copy', 'new', 'updated', 'update', 'revised', 'rev', 'version', 'v',
  'front', 'back', 'pouch', 'bag', 'film', 'print', 'ready', 'pdf', 'powder', 'ops', 'prodough',
]);

const words = (s) => norm(s).split(' ').filter(w => w && !NOISE.has(w));

/** Bigram Dice similarity — the same measure the scanned-test importer ranks by. */
function dice(a, b) {
  const grams = (s) => {
    const t = norm(s).replace(/ /g, '');
    const out = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) || 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * shared) / total;
}

/* ── GS1 ──────────────────────────────────────────────────────────────────── */

/**
 * Every 12-to-14 digit run in the filename, as a candidate GTIN.
 *
 * Bounded to that length so a date ("20260813") or a job number can never be
 * read as a barcode. The value still has to match a product exactly — this only
 * decides what is worth looking up.
 */
export function gtinsIn(filename) {
  return (String(filename || '').match(/\d{12,14}/g) || []).map(d => d.replace(/^0+(?=\d{12})/, ''));
}

/* ── Matching ─────────────────────────────────────────────────────────────── */

export const CONFIDENCE = {
  gtin: 'GTIN in the filename',
  sku: 'SKU in the filename',
  legacy_sku: 'Old SKU in the filename',
  name: 'Flavour name looks like this product',
};

/**
 * Match one filename against the catalogue.
 *
 * Returns `{ sku, basis, detail }` when it is CERTAIN, otherwise
 * `{ sku: null, suggestions: [...] }`. A caller applies the first and asks
 * about the second; nothing here writes.
 *
 * `products` is the catalogue: { sku, legacy_sku, gtin, flavor, base_flavor,
 * category, pack }.
 */
export function matchProduct(filename, products) {
  const clean = cleanFilename(filename);
  const tokens = new Set(norm(clean).split(' '));
  const compact = norm(clean).replace(/ /g, '');

  // 1 — GTIN. Unambiguous, so it wins outright.
  const gtins = gtinsIn(filename);
  if (gtins.length) {
    const hit = products.find(p => p.gtin && gtins.includes(String(p.gtin)));
    if (hit) return { sku: hit.sku, basis: 'gtin', detail: `${CONFIDENCE.gtin}: ${hit.gtin}` };
  }

  // 2 — SKU, then the old SKU. Matched as a WHOLE TOKEN or as a run in the
  // compacted name, never as a substring of a longer code: "PPM-B" must not
  // match "PPM-BM", and it would if this searched loosely.
  for (const field of ['sku', 'legacy_sku']) {
    const hits = products.filter((p) => {
      const v = p[field];
      if (!v || String(v).length < 3) return false;
      const n = norm(v);
      return tokens.has(n) || n.split(' ').every(part => tokens.has(part))
        || new RegExp(`(^|[^a-z0-9])${n.replace(/ /g, '')}([^a-z0-9]|$)`).test(compact
          .replace(new RegExp(`(${n.replace(/ /g, '')})`), '-$1-'));
    });
    // Two products whose codes both appear is not an identification.
    if (hits.length === 1) {
      return { sku: hits[0].sku, basis: field, detail: `${CONFIDENCE[field]}: ${hits[0][field]}` };
    }
    if (hits.length > 1) {
      return { sku: null, ambiguous: true, suggestions: hits.slice(0, 6).map(p => ({ sku: p.sku, flavor: p.flavor, score: 1, basis: field })) };
    }
  }

  // 3 — the flavour name. ALWAYS a suggestion, never applied: "Chocolate
  // Protein Pancake Mix" and "Chocolate Protein Crepe Mix" are two products and
  // one word apart, and the panels are different documents.
  const fileWords = words(clean);
  const scored = products.map((p) => {
    const label = `${p.flavor || ''} ${p.category || ''}`;
    const overlap = words(label).filter(w => fileWords.includes(w)).length;
    // Word overlap first, similarity to break ties — a shared distinctive word
    // ("buttermilk") says more than two strings being generally alike.
    return { sku: p.sku, flavor: p.flavor, category: p.category, pack: p.pack, overlap, score: dice(clean, label) };
  }).filter(x => x.overlap > 0 || x.score >= 0.45)
    .sort((a, b) => b.overlap - a.overlap || b.score - a.score)
    .slice(0, 6);

  return { sku: null, suggestions: scored.map(s => ({ ...s, basis: 'name' })) };
}

/* ── What the file itself says ────────────────────────────────────────────── */

/**
 * Serving size and servings per container, off the panel's own text.
 *
 * Only ever used to PRE-FILL a form somebody then looks at. A nutrition panel
 * is a regulatory statement and its numbers are not being read off an OCR guess
 * and filed unseen — everything here is returned as a suggestion beside the
 * line of text it came from, so the person approving can see what was read.
 *
 * Returns nulls freely. A field this cannot find is left for a human, which is
 * the honest outcome; inventing a serving size would be the one mistake that
 * matters on this document.
 */
export function readNfpText(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = { serving_size: null, servings_per_container: null, evidence: {} };
  if (!t) return out;

  // "Serving size 2 sticks (40g)" / "Serving Size: 1 packet (30 g)"
  const ss = t.match(/serving\s*size\s*[:-]?\s*([^.;]{1,60}?)(?=\s*(?:(?:about\s*)?[\d.]+\s*servings?\s*per|servings?\s*per|amount\s*per|calories|$))/i);
  if (ss) {
    out.serving_size = ss[1].trim().replace(/[,\s]+$/, '') || null;
    out.evidence.serving_size = ss[0].trim().slice(0, 120);
  }

  // "Servings per container 20" / "About 14 servings per container"
  const spc = t.match(/servings?\s*per\s*container\s*[:-]?\s*(about\s*)?([\d.]+)/i)
    || t.match(/(?:about\s*)?([\d.]+)\s*servings?\s*per\s*container/i);
  if (spc) {
    const n = spc[2] ?? spc[1];
    out.servings_per_container = String(n).trim() || null;
    out.evidence.servings_per_container = spc[0].trim().slice(0, 120);
  }
  return out;
}

/** The version a filename claims ("…_V3" → "V3"), normalised. */
export function versionFromFilename(filename) {
  const rev = revisionFromFilename(filename);
  return rev ? `V${rev}` : null;
}
