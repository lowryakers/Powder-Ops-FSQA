// The catalogue's export presets (R-0645 PR C). PURE: products in, a header
// row and data rows out. The server turns the result into CSV or XLSX; a check
// runs the same function. master.csv is NOT here and does not change — it is
// the artwork proofer's contract (MASTER_CSV_CONTRACT).
//
// NOTHING HERE MAKES A GTIN. The unit's GTIN-14 is the stored UPC-12 padded with
// zeros — the same number, display only. Inner and case are printed exactly as
// stored, grouped 3-5-5-1. A blank stays blank.

import { unitGtin14, groupGtin14, sameItem } from './level-gtin.js';
import { gtinValid, normalizeGtin } from './gtin.js';
import { statusLabel } from './product-status.js';

/**
 * Shalee's distributor sheet — her 14 headers, byte for byte, in her order
 * (row 4 of the Distributor tab). Note the TWO spaces in "INTERPACK  CASE UPC"
 * and the trailing spaces on four of them. Do not tidy these.
 */
export const SHALEE_DISTRIBUTOR_HEADERS = Object.freeze([
  'Flavor',
  'Unit Size',
  'SELLING UNIT UPC',
  'INTERPACK  CASE UPC',
  'MASTER PACK CASE UPC ',
  'MASTER PACK CASE CONTENTS',
  'FOB MASTER PACK CASE COST ',
  'SRP',
  'MASTER CASE DIMENSIONS',
  'CASE CUBE ',
  'CASE WEIGHT',
  'TI/HI',
  'CASE QTY ON PALLET ',
  'SHELF LIFE',
]);

const blank = (v) => v === null || v === undefined || v === '';
/** 16 → "16", 7.20 → "7.2". */
export const num = (v) => (blank(v) || !Number.isFinite(Number(v)) ? '' : String(Number(v)));
const money2 = (v) => (blank(v) ? '' : Number(v).toFixed(2));

const PACK_NOUN = { STK: 'packets', PLG: 'pouches', PSM: 'pouches', CUP: 'cups', BOX: 'boxes', BTL: 'bottles' };

/** "72/1.18 OZ packets 6/12pks" from units per case, unit size, inners per case and units per inner. */
export function caseContents(p) {
  if (blank(p.units_per_case) || blank(p.unit_size)) return '';
  let s = `${num(p.units_per_case)}/${String(p.unit_size).trim()} ${PACK_NOUN[p.pack] || 'units'}`;
  if (!blank(p.inners_per_case) && !blank(p.units_per_inner)) s += ` ${num(p.inners_per_case)}/${num(p.units_per_inner)}pks`;
  return s;
}

/** "$120.24 COST / $1.67 UNIT" from the two stored numbers. */
export function fobString(p) {
  const parts = [];
  if (!blank(p.price_fob_case)) parts.push(`$${money2(p.price_fob_case)} COST`);
  if (!blank(p.price_fob_unit)) parts.push(`$${money2(p.price_fob_unit)} UNIT`);
  return parts.join(' / ');
}

/** 16" x 10" x 7" — blank unless all three are known. */
export function dimensions(p) {
  if (blank(p.case_l) || blank(p.case_w) || blank(p.case_h)) return '';
  return `${num(p.case_l)}" x ${num(p.case_w)}" x ${num(p.case_h)}"`;
}

/** "7.2LBS / 115.2 OZ" from the stored pounds. */
export function caseWeight(p) {
  if (blank(p.case_weight)) return '';
  const oz = Math.round(Number(p.case_weight) * 16 * 10) / 10;
  return `${num(p.case_weight)}LBS / ${num(oz)} OZ`;
}

/** "8/4" from the two stored integers. */
export const tiHi = (p) => (blank(p.ti) || blank(p.hi) ? '' : `${num(p.ti)}/${num(p.hi)}`);
export const shelfLife = (p) => (blank(p.shelf_life_months_commercial) ? '' : `${num(p.shelf_life_months_commercial)} Months`);

const unit14 = (p) => unitGtin14(p.gtin) || '';
const grouped = (code) => (blank(code) ? '' : groupGtin14(code));

/** One Shalee row. */
export function shaleeRow(p) {
  return [
    p.base_flavor || p.flavor || '',
    p.unit_size || '',
    grouped(unit14(p)),
    grouped(p.gtin_inner),
    grouped(p.gtin_case),
    caseContents(p),
    fobString(p),
    money2(p.price_srp),
    dimensions(p),
    num(p.case_cube),
    caseWeight(p),
    tiHi(p),
    num(p.pallet_qty),
    shelfLife(p),
  ];
}

const stepState = (p, key) => (p.readiness?.steps || []).find((s) => s.key === key)?.state || '';

/** [header, get(p)] — the Full preset: every source-of-truth field, plus fill weight and spec. */
export const FULL_COLUMNS = [
  ['SKU', (p) => p.sku], ['Preferred SKU', (p) => p.preferred_sku || ''], ['Name', (p) => p.flavor || ''],
  ['Brand', (p) => p.brand || ''], ['Line', (p) => p.category || ''], ['Flavor', (p) => p.base_flavor || ''],
  ['Pack', (p) => p.pack || ''], ['Status', (p) => statusLabel(p.status)],
  ['Unit GTIN-12', (p) => p.gtin || ''], ['Unit GTIN-14', unit14], ['Inner GTIN-14', (p) => p.gtin_inner || ''],
  ['Case GTIN-14', (p) => p.gtin_case || ''], ['Case GTIN source', (p) => p.gtin_case_source || ''],
  ['Unit size', (p) => p.unit_size || ''], ['Units per inner', (p) => num(p.units_per_inner)],
  ['Units per case', (p) => num(p.units_per_case)], ['Inners per case', (p) => num(p.inners_per_case)],
  ['Case L (in)', (p) => num(p.case_l)], ['Case W (in)', (p) => num(p.case_w)], ['Case H (in)', (p) => num(p.case_h)],
  ['Case cube (ft3)', (p) => num(p.case_cube)], ['Case weight (lb)', (p) => num(p.case_weight)],
  ['Ti', (p) => num(p.ti)], ['Hi', (p) => num(p.hi)], ['Pallet qty', (p) => num(p.pallet_qty)],
  ['Shelf life (months)', (p) => num(p.shelf_life_months_commercial)],
  ['FOB case', (p) => money2(p.price_fob_case)], ['FOB unit', (p) => money2(p.price_fob_unit)],
  ['Wholesale case', (p) => money2(p.price_wholesale_case)], ['Wholesale unit', (p) => money2(p.price_wholesale_unit)],
  ['SRP', (p) => money2(p.price_srp)],
  ['NFP version (approved)', (p) => p._label?.version || ''], ['Allergen statement', (p) => p._label?.allergen_statement || ''],
  ['Artwork status', (p) => p.artwork_status || ''], ['Artwork version', (p) => p.artwork_version || ''],
  ['MRPEasy formula', (p) => p.mrp_formula_id || ''], ['Formula version', (p) => p.formula_rev || ''],
  ['Formula source', (p) => p.formula_source_system || ''],
  ['Shopify SKU', (p) => p.shopify_sku || ''], ['Shopify variant id', (p) => p.shopify_variant_id || ''],
  ['Shopify listed', (p) => stepState(p, 'shopify')], ['ShipHero synced', (p) => stepState(p, 'shiphero')],
  ['Amazon channel', (p) => p.amazon_channel || ''], ['Amazon SKU', (p) => p.amazon_sku || ''], ['Amazon ASIN', (p) => p.amazon_asin || ''],
  ['Distributor item no', (p) => p.distributor_item_no || ''], ['Wholesale item no', (p) => p.wholesale_item_no || ''],
  ['Fill weight (g)', (p) => num(p.fill_weight_g)], ['Spec', (p) => p.spec_id || ''],
  ['Family', (p) => p.family || ''], ['Notes', (p) => p.notes || ''],
];

/** Retailer item setup — the spec's column list, in its order. */
export const RETAILER_COLUMNS = [
  ['Preferred SKU', (p) => p.preferred_sku || ''], ['Name', (p) => p.flavor || ''], ['Brand', (p) => p.brand || ''],
  ['Line', (p) => p.category || ''], ['Flavor', (p) => p.base_flavor || ''], ['Pack', (p) => p.pack || ''],
  ['Status', (p) => statusLabel(p.status)], ['Unit size', (p) => p.unit_size || ''],
  ['Unit GTIN-12', (p) => p.gtin || ''], ['Unit GTIN-14', unit14], ['Inner GTIN-14', (p) => p.gtin_inner || ''],
  ['Case GTIN-14', (p) => p.gtin_case || ''], ['Units per inner', (p) => num(p.units_per_inner)],
  ['Units per case', (p) => num(p.units_per_case)], ['Case L', (p) => num(p.case_l)], ['Case W', (p) => num(p.case_w)],
  ['Case H', (p) => num(p.case_h)], ['Case cube', (p) => num(p.case_cube)], ['Case weight', (p) => num(p.case_weight)],
  ['Ti', (p) => num(p.ti)], ['Hi', (p) => num(p.hi)], ['Pallet qty', (p) => num(p.pallet_qty)],
  ['Shelf life', shelfLife], ['SRP', (p) => money2(p.price_srp)], ['FOB case', (p) => money2(p.price_fob_case)],
  ['FOB unit', (p) => money2(p.price_fob_unit)], ['Wholesale case', (p) => money2(p.price_wholesale_case)],
  ['Wholesale unit', (p) => money2(p.price_wholesale_unit)], ['Allergen statement', (p) => p._label?.allergen_statement || ''],
  ['Shopify SKU', (p) => p.shopify_sku || ''], ['Amazon SKU', (p) => p.amazon_sku || ''], ['Amazon ASIN', (p) => p.amazon_asin || ''],
  ['Distributor item no', (p) => p.distributor_item_no || ''], ['Wholesale item no', (p) => p.wholesale_item_no || ''],
];

/** GS1 check — ReadyDoc's three codes against the last GS1 export loaded by the backfill. */
export const GS1_CHECK_HEADERS = [
  'Preferred SKU', 'ReadyDoc SKU', 'Unit GTIN-12', 'Unit GTIN-14', 'Inner GTIN-14', 'Case GTIN-14',
  'Unit check digit OK', 'Inner check digit OK', 'Case check digit OK',
  'Inner matches unit (mid-12)', 'Case matches unit (mid-12)',
  'Unit in GS1 export', 'Inner in GS1 export', 'Case in GS1 export',
  'Unit GS1 status', 'Inner GS1 status', 'Case GS1 status',
  'Unit GS1 level', 'Inner GS1 level', 'Case GS1 level',
  'GS1 description', 'Mismatch notes',
];

const yn = (b) => (b === null || b === undefined ? '' : b ? 'yes' : 'no');

/**
 * One GS1-check row. `gs1` maps a GTIN-14 to `{ level, status, description }`
 * from the last export loaded; null when none has been loaded.
 */
export function gs1CheckRow(p, gs1) {
  const u = unit14(p); const inner = p.gtin_inner || ''; const cs = p.gtin_case || '';
  const at = (code) => (code && gs1 ? gs1.get(code) || null : null);
  const notes = [];
  const ok = (code) => (code ? gtinValid(code) : null);
  if (u && !ok(u)) notes.push('unit fails its check digit');
  if (inner && !ok(inner)) notes.push('inner fails its check digit');
  if (cs && !ok(cs)) notes.push('case fails its check digit');
  const innerSame = inner ? sameItem(inner, p.gtin) : null;
  const caseSame = cs ? sameItem(cs, p.gtin) : null;
  if (innerSame === false) notes.push('inner is not this unit');
  if (caseSame === false) notes.push('case is not this unit');
  const inExport = (code) => (!code ? null : gs1 ? !!gs1.get(code) : null);
  if (gs1) for (const [lbl, code] of [['unit', u], ['inner', inner], ['case', cs]]) if (code && !gs1.get(code)) notes.push(`${lbl} not in the GS1 export`);
  if (!gs1) notes.push('no GS1 export loaded');
  return [
    p.preferred_sku || '', p.sku, normalizeGtin(p.gtin) || '', u, inner, cs,
    yn(ok(u)), yn(ok(inner)), yn(ok(cs)), yn(innerSame), yn(caseSame),
    yn(inExport(u)), yn(inExport(inner)), yn(inExport(cs)),
    at(u)?.status || '', at(inner)?.status || '', at(cs)?.status || '',
    at(u)?.level || '', at(inner)?.level || '', at(cs)?.level || '',
    at(u)?.description || at(cs)?.description || '', notes.join('; '),
  ];
}

export const PRESETS = {
  full: { label: 'Full', filename: 'products-full' },
  shalee: { label: 'Distributor sheet (Shalee)', filename: 'products-distributor-sheet' },
  retailer: { label: 'Retailer item setup', filename: 'products-retailer-setup' },
  gs1: { label: 'GS1 check', filename: 'products-gs1-check' },
};

/** Columns that carry a price, by preset — blanked for a reader who may not see prices. */
const PRICE_HEADERS = new Set(['FOB case', 'FOB unit', 'Wholesale case', 'Wholesale unit', 'SRP', 'FOB MASTER PACK CASE COST ']);

/**
 * `{ headers, rows }` for a preset over these products (already filtered, in
 * order). `prices: false` blanks every price cell — the export never carries
 * more than the screen does.
 */
export function buildExport(preset, products, { gs1 = null, prices = true } = {}) {
  let headers; let rows;
  if (preset === 'shalee') { headers = [...SHALEE_DISTRIBUTOR_HEADERS]; rows = products.map(shaleeRow); }
  else if (preset === 'gs1') { headers = [...GS1_CHECK_HEADERS]; rows = products.map((p) => gs1CheckRow(p, gs1)); }
  else if (preset === 'retailer' || preset === 'full') {
    const cols = preset === 'full' ? FULL_COLUMNS : RETAILER_COLUMNS;
    headers = cols.map(([h]) => h); rows = products.map((p) => cols.map(([, get]) => { const v = get(p); return v == null ? '' : String(v); }));
  } else return null;
  if (!prices) {
    const idx = headers.map((h, i) => (PRICE_HEADERS.has(h) ? i : -1)).filter((i) => i >= 0);
    rows = rows.map((r) => r.map((v, i) => (idx.includes(i) ? '' : v)));
  }
  return { headers, rows };
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = ({ headers, rows }) => [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
