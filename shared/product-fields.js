// What a product field may hold, and the three states it can be in.
//
// PURE — strings in, verdicts out. Both sides import it: the server refuses a
// save that does not fit (400, naming the expected format), and the grid and
// the drawer show the same rule beside the box as somebody types. One
// definition, two callers — the `shared/product-colors.js` arrangement. A
// second copy in a component is how a screen offers a save the server refuses.
//
// THE RULES ARE FOR NEW WRITES. The catalogue's 118 rows carry legacy SKUs
// (`PP-BLM-23`, `PSP-CCR`, `PCCM-V-04`) that are join keys on two-year-old POs
// and are never re-shaped by a validator; the SKU rule below applies to a SKU
// being MINTED or RENAMED, which is the only time a shape can be chosen. The
// same goes for a Pantone reference the audit wrote as `PMS Black C`: it stays
// as transcribed until a person changes that slot, and the strict shape applies
// to the value they type. Existing values that do not fit are REPORTED (Data
// health, `product_colors.pms_valid`), never rewritten by a rule.
//
// THREE STATES, NOT TWO. A field is a VALUE, or EMPTY (nobody has said), or
// NOT APPLICABLE (somebody has said it does not apply to this SKU, with their
// name and the date). NA is set by a control, never typed — `NA` typed into a
// box is a string that would pass through every filter as a value and reach
// the proofer's feed as a colour called "NA". Completeness counts EMPTY as a
// gap and NA as done. A value written into a field clears its NA.

import { normalizeGtin, gtinValid } from './gtin.js';

/**
 * The new SKU standard: `<LINE>-<PACK>-<FLAVOUR>` — `WHY-BTL-BLM`. The third
 * part is optional because a product with no flavour is a two-part SKU
 * (`GFF-PSM`, Gluten Free Flour): `FLAVOURLESS_LINES` in sku-format.js is the
 * list, and refusing the two-part form here would make those unmintable.
 */
export const SKU_RE = /^[A-Z]{3}-[A-Z]{3}(?:-[A-Z0-9]{1,4})?$/;
export const FORMULA_REF_RE = /^F-\d{5}$/;
export const FORMULA_VERSION_RE = /^v\d+\.\d+$/;
/**
 * A spot ink as a printer is handed it: `PMS 158 C`, `PMS 9224 U` — and the
 * NAMED inks Pantone sells without a number, `PMS Black C`, `PMS Warm Red C`,
 * `PMS Reflex Blue C`, which are on this plant's packs today. The ask's rule
 * was the numeric form; refusing `PMS Black C` would refuse a real ink.
 */
export const PMS_RE = /^PMS (?:\d{3,4}|[A-Za-z][A-Za-z ]{2,}) [CU]$/;
/** Six hex digits, upper case, with the catalogue's `HEX` prefix. */
export const HEX_RE = /^HEX [0-9A-F]{6}$/;

/**
 * Field rules, keyed on the products column.
 *
 * `expected` is the sentence a refusal carries. `normalize` is applied before
 * the test and is what gets stored — it never changes the meaning of what was
 * typed (case on a code, whitespace, the GS1 padding D-090 already strips).
 */
export const FIELD_RULES = {
  sku: {
    label: 'SKU',
    expected: 'LINE-PACK-FLAVOUR in capitals, e.g. WHY-BTL-BLM (three letters, three letters, one to four letters or digits; a flavourless line is two parts, e.g. GFF-PSM)',
    normalize: (v) => String(v ?? '').trim().toUpperCase(),
    test: (v) => SKU_RE.test(v),
    unique: true,
  },
  gtin: {
    label: 'GTIN',
    expected: 'a 12-digit UPC-A with a valid GS1 check digit (a 13- or 14-digit padded form is accepted and stored as the 12)',
    normalize: (v) => normalizeGtin(v) || '',
    test: (v) => gtinValid(v),
    unique: true,
  },
  mrp_formula_id: {
    label: 'Formula ref',
    expected: 'F- followed by five digits, e.g. F-00002',
    normalize: (v) => String(v ?? '').trim().toUpperCase(),
    test: (v) => FORMULA_REF_RE.test(v),
  },
  formula_rev: {
    label: 'Formula version',
    expected: 'v<major>.<minor>, e.g. v2.0',
    normalize: (v) => String(v ?? '').trim().toLowerCase(),
    test: (v) => FORMULA_VERSION_RE.test(v),
  },
  fill_weight_g: {
    label: 'Fill weight (g)',
    expected: 'a number of grams greater than 0, e.g. 30',
    normalize: (v) => {
      // The sign is kept so "-3" is refused rather than read as 3; a unit ("30 g") is dropped.
      const n = Number(String(v ?? '').trim().replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : NaN;
    },
    test: (v) => Number.isFinite(v) && v > 0,
  },
  pms: {
    label: 'PMS spot colour',
    expected: 'PMS, a space, a three- or four-digit number (or a named ink such as Black), a space, C or U — e.g. PMS 158 C',
    // The prefix and the C/U suffix are upper-cased; a named ink keeps the
    // case it was typed in, because the proofer matches the separation NAME
    // against this string and "Black" is how the film names it.
    normalize: (v) => {
      const s = String(v ?? '').trim().replace(/\s+/g, ' ');
      const m = /^pms\s+(.+?)\s+([cu])$/i.exec(s);
      return m ? `PMS ${m[1]} ${m[2].toUpperCase()}` : s;
    },
    test: (v) => PMS_RE.test(v),
  },
  hex: {
    label: 'Hex spot colour',
    expected: 'HEX, a space, six hex digits — e.g. HEX EE7623',
    normalize: (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase().replace(/^HEX\s*#?/, 'HEX '),
    test: (v) => HEX_RE.test(v),
  },
};

/**
 * Validate one field. `{ ok: true, value }` with the value to store, or
 * `{ ok: false, error }` naming the expected format. An empty value is
 * `{ ok: true, value: null }` — clearing a field is always allowed; whether
 * empty is a GAP is completeness's question, not this one's.
 */
export function validateField(field, raw) {
  const rule = FIELD_RULES[field];
  if (!rule) return { ok: true, value: raw === '' ? null : raw };
  if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: true, value: null };
  const value = rule.normalize(raw);
  if (!rule.test(value)) {
    return { ok: false, error: `${rule.label} "${String(raw).trim()}" is not in the expected format: ${rule.expected}.`, expected: rule.expected };
  }
  return { ok: true, value };
}

/**
 * The fields a person may mark NOT APPLICABLE on a SKU.
 *
 * Not every field: the identity fields, the formula and the fill weight are
 * owed by every product, and marking one NA would be a gap wearing a tick.
 * Wind direction and the eye mark on a carton are already NA BY DERIVATION
 * (product-completeness.js reads the spec's format); this is for the fields a
 * pack format cannot decide — a pouch whose print carries no eye mark, a
 * product with no legacy code, a line not sold through Shopify.
 */
export const NA_FIELDS = [
  'legacy_sku', 'protein_type', 'pack_count', 'eyemark_color',
  'shopify_sku', 'shopify_variant_id', 'amazon_sku', 'amazon_asin', 'drive_url',
];

/** The NA map on a row: `{ field: { by, at } }`. Tolerates the column being absent or unreadable. */
export function naOf(row) {
  const raw = row?.na_fields;
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** 'value' | 'na' | 'empty' for one field on a row. NA wins over a stray value; a value written clears NA at the write. */
export function fieldState(row, field) {
  if (naOf(row)[field]) return 'na';
  const v = row?.[field];
  return v === null || v === undefined || String(v).trim() === '' ? 'empty' : 'value';
}

/**
 * A value that READS like a typed NA — `NA`, `N/A`, `n.a.`, `not applicable`.
 * Reported on Data health so the person who typed it can move it to the
 * control; never converted, because "NA" might be somebody's initials.
 */
export const looksLikeTypedNa = (v) => /^(?:n\/?\.?a\.?|not\s+applicable)$/i.test(String(v ?? '').trim());

/**
 * Where each master.csv column populates from — one definition, read by the
 * feed (the header list is its keys, in order) and by the product drawer's
 * Packaging block, which prints the source beside each derived value. The
 * sixteen first names are the contract with Artwork-Proofing's
 * `_fetch_sheet_rows()` and MUST NOT be renamed; `fill weight (g)` is the
 * seventeenth and is free.
 */
export const MASTER_CSV_SOURCES = [
  ['sku', 'products.sku (the current code; a rename moves it and legacy_sku keeps the old one)'],
  ['gtin', 'products.gtin, normalised to the 12-digit UPC-A (shared/gtin.js)'],
  ['flavor', 'products.flavor — the product name as printed'],
  ['packaging type', 'products.pack, rendered through PACK_LABEL (PLG → "Pouch — large")'],
  ['material', 'packaging_specs.material_structure via products.spec_id'],
  ['zipper', 'packaging_specs.zipper via products.spec_id'],
  ['print', 'packaging_specs.print_process via products.spec_id'],
  ['trim length', 'packaging_specs.trim_length_mm via products.spec_id'],
  ['trim width', 'packaging_specs.trim_width_mm via products.spec_id'],
  ['gusset dimension', 'packaging_specs.gusset_mm via products.spec_id'],
  ['front panel dimension', 'packaging_specs.front_panel_mm via products.spec_id'],
  ['wind direction', 'packaging_specs.wind_direction via products.spec_id'],
  ['pms spot colors', 'product_colors.pms, slots in order, joined with " | "'],
  ['hex spot colors', 'product_colors.hex, slots in order, joined with " | "'],
  ['eye mark color', 'products.eyemark_color — typed on the product'],
  ['die line required', 'products.dieline_required — typed on the product, sent as yes/no'],
  ['fill weight (g)', 'products.fill_weight_g — weighed, never the label\'s net weight (D-093)'],
];

/** The packaging facts the drawer derives, with the column each one is read from. */
export const PACKAGING_DERIVED = [
  ['material_structure', 'Material', 'packaging_specs.material_structure'],
  ['zipper', 'Zipper', 'packaging_specs.zipper'],
  ['print_process', 'Print', 'packaging_specs.print_process'],
  ['trim_length_mm', 'Trim length (mm)', 'packaging_specs.trim_length_mm'],
  ['trim_width_mm', 'Trim width (mm)', 'packaging_specs.trim_width_mm'],
  ['gusset_mm', 'Gusset (mm)', 'packaging_specs.gusset_mm'],
  ['front_panel_mm', 'Front panel (mm)', 'packaging_specs.front_panel_mm'],
  ['wind_direction', 'Wind direction', 'packaging_specs.wind_direction'],
];

/** Film fed off a roll carries a wind direction and an eye mark; a carton or a cup has neither. */
export const ROLL_FED_FORMATS = new Set(['pouch', 'stick', 'bottle']);
export const isRollFed = (format) => ROLL_FED_FORMATS.has(String(format || '').toLowerCase());
