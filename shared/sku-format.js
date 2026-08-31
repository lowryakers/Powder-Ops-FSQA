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

export const PROTEIN_CODES = {
  'Whey Protein': 'WHY',
  'Beef Protein': 'BEF',
  'Plant Protein': 'PLT',
};

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

/** The inverse, for reading a code back. Unknown parts come back as written. */
export function parseSku(sku) {
  const parts = String(sku ?? '').trim().toUpperCase().split('-');
  if (parts.length !== 3 || !parts.every(p => SKU_PART.test(p))) return null;
  return { protein: parts[0], pack: parts[1], flavor: parts[2] };
}
