// Merch: apparel sold under the ProDough name, tracked in Products (D-302).
//
// PURE — strings in, verdicts out. The server refuses what does not fit and the
// screen shows the same rule beside the box; one definition, two callers.
//
// A MERCH SKU IS BUILT, NEVER TYPED:  MCH-<garment><flavor code>-<color>-<size>
//
//     MCH-HBDC-BLU-S   Merch, Hoodie, Birthday Cake (BDC), Blue, Small
//     MCH-HMC-BLK-M    Merch, Hoodie, Mint Chocolate (MC), Black, Medium
//
// The style segment is ONE garment letter plus the flavour's EXISTING code from
// the flavour register — the same code the food SKUs carry. Register codes are
// two or three letters, so the segment is three or four characters. The
// garment letter is one character, so `HBDC` and `HMC` read back unambiguously.
//
// THE FOOD STANDARD IS UNTOUCHED. `SKU_RE` stays LINE-PACK-FLAVOR; this rule
// applies only when the line is MCH. A four-part SKU on any other line is
// refused, and an MCH code is never accepted where a food SKU is minted.
//
// A merch SKU is FROZEN once minted: a later change to a register code does not
// rename it. A colour correction before any GTIN exists is a rename through the
// ordinary rename route, so the child tables move with it.

export const MERCH_LINE = 'MCH';
export const MERCH_CATEGORY = 'Merch';
// products.pack is NOT NULL and the food SKU reads it as a pack code. A garment
// has no pack; this value says so and is in no pack-code list.
export const MERCH_PACK = 'Apparel';

/** Garment letters. A new garment is one entry here and the regex below. */
export const GARMENTS = { H: 'Hoodie', T: 'Tee', C: 'Cap' };

/** Sizes in the order they are worn. S, M and L today; the rest for later styles. */
export const MERCH_SIZES = [
  { code: 'XS', label: 'Extra small', sort: 1 },
  { code: 'S', label: 'Small', sort: 2 },
  { code: 'M', label: 'Medium', sort: 3 },
  { code: 'L', label: 'Large', sort: 4 },
  { code: 'XL', label: 'Extra large', sort: 5 },
  { code: 'XXL', label: '2X large', sort: 6 },
  { code: 'OS', label: 'One size', sort: 7 },
];
export const SIZE_BY_CODE = Object.fromEntries(MERCH_SIZES.map((s) => [s.code, s]));

export const STYLE_CODE_RE = /^MCH-([HTC])([A-Z]{2,3})$/;
export const MERCH_SKU_RE = /^MCH-[HTC][A-Z]{2,3}-[A-Z]{3}-(?:XS|S|M|L|XL|XXL|OS)$/;
export const COLOR_CODE_RE = /^[A-Z]{3}$/;
export const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}$/;

const up = (v) => String(v ?? '').trim().toUpperCase();

export const isMerchSku = (sku) => MERCH_SKU_RE.test(up(sku));
export const isMerch = (p) => p?.product_type === 'merch';

/** `MCH-HBDC` → { garment: 'H', flavor_code: 'BDC' }, or null. */
export function parseStyleCode(code) {
  const m = STYLE_CODE_RE.exec(up(code));
  return m ? { style_code: `MCH-${m[1]}${m[2]}`, garment: m[1], flavor_code: m[2] } : null;
}

/** One garment letter + a register code → the style code, or null. */
export function buildStyleCode(garment, flavorCode) {
  const g = up(garment); const f = up(flavorCode);
  if (!GARMENTS[g] || !/^[A-Z]{2,3}$/.test(f)) return null;
  return `MCH-${g}${f}`;
}

/** Style + colour + size → the variant SKU, or null when any part is malformed. */
export function buildMerchSku(styleCode, colorCode, sizeCode) {
  const st = parseStyleCode(styleCode);
  const c = up(colorCode); const s = up(sizeCode);
  if (!st || !COLOR_CODE_RE.test(c) || !SIZE_BY_CODE[s]) return null;
  const sku = `${st.style_code}-${c}-${s}`;
  return MERCH_SKU_RE.test(sku) ? sku : null;
}

/** The inverse. Null for anything that is not a merch SKU. */
export function parseMerchSku(sku) {
  const s = up(sku);
  if (!MERCH_SKU_RE.test(s)) return null;
  const [, style, color, size] = s.split('-');
  const st = parseStyleCode(`MCH-${style}`);
  return { line: MERCH_LINE, style_code: st.style_code, garment: st.garment, flavor_code: st.flavor_code, color, size };
}

/** What a variant is called: "Birthday Cake Hoodie - Blue / S". */
export function variantTitle({ flavor, garment, colorName, sizeCode }) {
  const g = GARMENTS[up(garment)] || 'Merch';
  return `${String(flavor || '').trim()} ${g} - ${String(colorName || '').trim()} / ${up(sizeCode)}`.replace(/\s+/g, ' ').trim();
}

/**
 * Why this variant may NOT be given a GTIN yet, or null when it may.
 *
 * A GTIN is printed on the swing tag, so it waits for the facts the tag names.
 * A colour still being confirmed may change, and a GTIN drawn for "Blue" that
 * becomes "Navy" is a number spent on a product that never existed.
 */
export function gtinAssignRefusal(variant, color) {
  if (!variant) return 'No such variant.';
  if (!isMerch(variant)) return 'Only a merch variant is assigned a GTIN here; food GTINs are set on the product.';
  if (!variant.color_code) return 'The variant has no color. A GTIN waits for the color and size.';
  if (!variant.size_code) return 'The variant has no size. A GTIN waits for the color and size.';
  if (!color) return `Color ${variant.color_code} is not in the color register.`;
  if (color.confirming) return `Color ${color.code} (${color.name}) is still being confirmed. Confirm it before assigning a GTIN.`;
  if (variant.gtin) return `${variant.sku} already carries GTIN ${variant.gtin}.`;
  return null;
}

/**
 * The lowest free item number under a 9-digit prefix, with its check digit.
 *
 * `taken` is every GTIN on file and every reserved number, already normalised to
 * twelve digits (shared/gtin.js normalizeGtin). A SUGGESTION ONLY: the person
 * confirms it and the write re-checks inside its transaction.
 */
export function suggestNextGtin(prefix, taken, checkDigit) {
  const p = String(prefix || '').trim();
  if (!/^\d{9}$/.test(p)) return null;
  const used = new Set();
  for (const g of taken || []) if (/^\d{12}$/.test(g) && g.startsWith(p)) used.add(g.slice(9, 11));
  for (let i = 0; i < 100; i++) {
    const item = String(i).padStart(2, '0');
    if (used.has(item)) continue;
    const body = `${p}${item}`;
    return { prefix: p, item, gtin: `${body}${checkDigit(body)}`, free: 100 - used.size };
  }
  return null;
}
