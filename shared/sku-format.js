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
 * A LINE CODE IS A DIFFERENT KIND OF THING FROM A FLAVOUR CODE, which is why
 * these could be proposed here while the contested flavours could not. A
 * flavour code is read off film the plant is already printing, so there is
 * evidence to derive it from and a wrong one is a wrong pack. No SKU exists in
 * the new format yet, so a line code has no evidence behind it either way — it
 * is a choice, and it is free to change right up until the first SKU is minted.
 *
 * A line code is still the first three characters of every SKU in that line
 * forever, so changing one after the cutover is the rename project again. Agree
 * them before minting.
 */
export const LINE_CODES = {
  // The three the standard was written against.
  'Whey Protein': 'WHY',
  'Beef Protein': 'BEF',
  'Plant Protein': 'PLT',
  // The mixes, added when the preview column was extended to the whole
  // catalogue. UNLIKE A FLAVOUR CODE, THESE ARE NOT READ OFF EXISTING FILM —
  // no SKU is printed in the new format yet, so there is nothing to derive
  // from and they are a proposal. Each mirrors the legacy prefix with the
  // leading "P" (for protein) dropped, since the line segment now says what
  // the product is: PDM→DNT, PPM→PNC, PCCM→CPK, PCM→CRP, POC→OAT, DR→DRC,
  // GFFB→GFF. They are cheap to change while nothing is minted; a flavour
  // code is not.
  'Donut Mix': 'DNT',
  'Pancake Mix': 'PNC',
  // NOT "CUP" — that is the pack code for the oatmeal cup, and while the two
  // segments are positional and could not actually be confused by the parser,
  // a person reading CUP-CUP-AC would rightly stop and check.
  'Cupcake Mix': 'CPK',
  'Crepe Mix': 'CRP',
  'Oatmeal Cup': 'OAT',
  'Daily Recharge': 'DRC',
  'Gluten Free Flour': 'GFF',
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
  const sku = buildSku(lineCode, pack, flavourCode);
  // Belt and braces: every part was present and it STILL would not assemble,
  // which means one of them is malformed for this format. A row that is blocked
  // with nothing in blocked_by renders as an empty cell and tells nobody
  // anything, which is worse than the gap itself.
  if (!sku) {
    return { sku: null, blocked_by: [`"${lineCode}-${pack}-${flavourCode}" is not a valid SKU — each part must be 2–4 letters`] };
  }
  return { sku, blocked_by: [] };
}

/** The inverse, for reading a code back. Unknown parts come back as written. */
export function parseSku(sku) {
  const parts = String(sku ?? '').trim().toUpperCase().split('-');
  if (parts.length !== 3 || !parts.every(p => SKU_PART.test(p))) return null;
  return { protein: parts[0], pack: parts[1], flavor: parts[2] };
}
