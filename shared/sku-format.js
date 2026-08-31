// The SKU standard for new products: PROTEIN · PACK · FLAVOUR.
//
//     WHY-BTL-BLM   Whey, bottle, Blueberry Muffin
//     BEF-STK-DCH   Beef, stick pack, Double Chocolate
//
// NO SERIAL. The legacy codes carry one (`PP-BLM-23`) and it buys nothing: it
// is not the order anything is made in, it collides across product lines — the
// live data has `PP-BF-21` (Whey Bananas Foster) and `PP-BB-21` (Plant Brownie
// Batter) — and it is one more thing to be wrong. The three parts identify the
// product completely.
//
// THE PROTEIN MOVES TO THE FRONT, which is the substantive fix rather than a
// tidier shape. `PP-` is used today for BOTH whey and plant pouches, so the
// legacy SKU does not say what is in the bag; you have to look it up. Under
// this standard the first three characters answer it.
//
// In `shared/` because the eventual SKU suggester, the products API and any
// import that has to recognise the shape all need the same vocabulary, and a
// second copy is how one of them starts minting codes the others reject.

/**
 * The first segment: the product line.
 *
 * ONLY THE THREE THAT HAVE BEEN AGREED. The bottling line is whey, beef and
 * plant, and `WHY-PLG-BLM` is the worked example the standard was written
 * against. The mixes (donut, pancake, cupcake, crepe, oatmeal, flour) have no
 * agreed code, and one is NOT invented here: a line code is the first three
 * characters of every SKU in that line forever, and guessing it produces a
 * preview somebody copies. A product on an uncoded line reports the gap.
 */
export const LINE_CODES = {
  'Whey Protein': 'WHY',
  'Beef Protein': 'BEF',
  'Plant Protein': 'PLT',
};

// The old name, kept because the bottling work reads it that way.
export const PROTEIN_CODES = LINE_CODES;

/**
 * One entry per PACKAGING SPEC, not per rough shape — because a spec is one
 * film, one price tier and one purchase order, and the plant already keeps
 * large and small pouches apart for exactly that reason.
 */
export const PACK_CODES = {
  Stick: 'STK',
  'Pouch (large)': 'PLG',
  'Pouch (small)': 'PSM',
  // The bottling line. A second bottle size gets its own code and its own spec
  // rather than sharing this one; one spec = one film = one quote = one PO.
  Bottle: 'BTL',
  Box: 'BOX',
  Cup: 'CUP',
};

// LETTERS ONLY, and that is what tells the new shape from the old one. The
// legacy codes end in a serial (`PP-BLM-23`), so allowing digits here made
// parseSku() accept a legacy SKU and report its serial as a flavour code —
// which would have quietly mapped an old pouch onto the wrong product.
export const SKU_PART = /^[A-Z]{2,4}$/;

/**
 * Assemble a SKU. Returns null rather than a half-formed code when any part is
 * missing or malformed — a SKU is a join key, and a plausible-looking wrong one
 * is worse than none.
 */
export function buildSku(protein, pack, flavorCode) {
  const parts = [protein, pack, flavorCode].map(p => String(p ?? '').trim().toUpperCase());
  return parts.every(p => SKU_PART.test(p)) ? parts.join('-') : null;
}

/**
 * Which pack code a product's format and spec resolve to.
 *
 * The pouches split on their SPEC rather than on the word "Pouch", because
 * large and small are different films, different price tiers and different
 * purchase orders — the same distinction `PACK_CODES` is keyed on.
 */
export function packCodeFor({ pack, format, spec_id: specId } = {}) {
  // `products.pack` ALREADY HOLDS THE CODE — the catalogue seeder writes PLG /
  // PSM / STK / BOX / CUP into it. Read it rather than re-deriving from the
  // format string: a second derivation is how the column and the SKU start
  // disagreeing about which pouch a product is.
  const stored = String(pack || '').trim().toUpperCase();
  if (Object.values(PACK_CODES).includes(stored)) return stored;

  const f = String(format || '').trim().toLowerCase();
  if (f === 'pouch') {
    if (String(specId || '').toUpperCase().includes('SM')) return PACK_CODES['Pouch (small)'];
    if (String(specId || '').toUpperCase().includes('LG')) return PACK_CODES['Pouch (large)'];
    return null; // a pouch whose spec does not say which size cannot be coded
  }
  if (f === 'stick') return PACK_CODES.Stick;
  if (f === 'bottle') return PACK_CODES.Bottle;
  if (f === 'box') return PACK_CODES.Box;
  if (f === 'cup') return PACK_CODES.Cup;
  return null;
}

/**
 * What this product's SKU WOULD be under the new standard — and, when it cannot
 * be worked out, exactly which part is missing.
 *
 * DERIVED ON READ, NEVER STORED. The flavour half depends on the register, and
 * a stored preview would go stale the moment somebody breaks a collision. It is
 * also explicitly NOT the product's SKU: the existing 118 keep their codes (the
 * rename is its own project, costed separately), and this column exists to show
 * what the target looks like and to be the punch list for the day it happens.
 *
 * `blocked_by` names the gap rather than emitting a half-code. A plausible
 * looking wrong SKU is worse than a blank, because somebody will copy it.
 */
export function preferredSku(product, codeByFlavor = {}) {
  const line = String(product?.product_line || product?.category || '').trim();
  const lineCode = LINE_CODES[line] || null;
  const pack = packCodeFor(product);
  const flavour = String(product?.base_flavor || product?.flavor || '').trim();
  const flavourCode = codeByFlavor[flavour] || null;

  const missing = [
    !lineCode && (line ? `no code agreed for ${line}` : 'no product line'),
    !pack && `no pack code for ${product?.pack || product?.format || 'this format'}`,
    !flavourCode && (flavour ? `${flavour} has no flavour code yet` : 'no flavour'),
  ].filter(Boolean);

  if (missing.length) return { sku: null, blocked_by: missing };
  return { sku: buildSku(lineCode, pack, flavourCode), blocked_by: [] };
}

/** The inverse, for reading a code back. Unknown parts come back as written. */
export function parseSku(sku) {
  const parts = String(sku ?? '').trim().toUpperCase().split('-');
  if (parts.length !== 3 || !parts.every(p => SKU_PART.test(p))) return null;
  return { protein: parts[0], pack: parts[1], flavor: parts[2] };
}
