// The product record as the source of truth (R-0645, D-342): the settings and
// defaults that pack decided, each in ONE place so changing one is one line.
//
// PURE. Both sides import it. Nothing here names a person: who may move a
// product to Active and who edits prices are USER IDS kept in app_settings,
// chosen by an admin in Settings → Products, read through
// server/product-sot-gate.js. An unset id is a refusal that names the setting,
// never a fallback to "any admin".
//
// GTINs ARE NEVER GENERATED HERE. The indicator policy below is a CHECK on a
// code a person copied from the GS1 Data Hub — it is never used to build one.

/** app_settings keys holding the configured user ids (A-20261110-021 items 6 and 8). */
export const SOT_SETTINGS = {
  active_approver: 'product_sot.active_approver_user_id',
  price_editor: 'product_sot.price_editor_user_id',
  // Distributor / wholesale item numbers. Unset ⇒ the price editor.
  item_no_editor: 'product_sot.item_no_editor_user_id',
};
export const SOT_SETTING_LABEL = {
  active_approver: 'Who moves a product to Active',
  price_editor: 'Who edits prices (FOB, wholesale, SRP)',
  item_no_editor: 'Who edits distributor and wholesale item numbers',
};

/**
 * GS1 indicator digits by pack level, for codes a person ENTERS (item 4):
 * Each 0, Inner 3, Case 1. Additive only — codes already allocated in GS1 with
 * another indicator (historical cases at 2 or 3) are loaded as copied by the
 * backfill and never rewritten to fit this.
 */
export const INDICATOR_POLICY = { unit: '0', inner: '3', case: '1' };
/** 'reject' refuses a new paste that breaks the policy; 'warn' saves it and says so. */
export const INDICATOR_POLICY_MODE = 'reject';

/** New food rows default to this brand (item 7). Merch may carry another later. */
export const BRAND_DEFAULT = 'ProDough';

/** Pricing — written only by the configured price editor, never by a token or bot. */
export const PRICE_FIELDS = ['price_fob_case', 'price_fob_unit', 'price_wholesale_case', 'price_wholesale_unit', 'price_srp'];
/** External item numbers — written only by the configured item-number editor. */
export const ITEM_NO_FIELDS = ['distributor_item_no', 'wholesale_item_no'];
/** Inner and case GS1 codes — pasted by a person or loaded from the GS1 export, never by a token. */
export const LEVEL_GTIN_FIELDS = ['gtin_inner', 'gtin_case'];

/** Pack and shipping facts (canManage, like the rest of the catalogue). */
export const PACK_FIELDS = [
  'unit_size', 'units_per_inner', 'units_per_case', 'inners_per_case',
  'case_l', 'case_w', 'case_h', 'case_cube', 'case_weight', 'ti', 'hi', 'pallet_qty',
  'shelf_life_months_commercial',
];

/** Every new source-of-truth column, as the schema adds them. */
export const SOT_COLUMNS = ['brand', ...LEVEL_GTIN_FIELDS, 'gtin_case_source', ...PACK_FIELDS, ...PRICE_FIELDS, ...ITEM_NO_FIELDS];

/** What the distributor sheet needs on a SKU before it can be sent (the readiness step). */
export const DISTRIBUTOR_REQUIRED = [
  'unit_size', 'units_per_case', 'case_l', 'case_w', 'case_h', 'case_weight',
  'ti', 'hi', 'pallet_qty', 'shelf_life_months_commercial',
  'price_fob_case', 'price_fob_unit', 'price_srp',
];

export const FIELD_LABEL = {
  brand: 'Brand', gtin_inner: 'Inner GTIN', gtin_case: 'Case GTIN', gtin_case_source: 'Case GTIN source',
  unit_size: 'Unit size', units_per_inner: 'Units per inner', units_per_case: 'Units per case',
  inners_per_case: 'Inners per case', case_l: 'Case length (in)', case_w: 'Case width (in)', case_h: 'Case height (in)',
  case_cube: 'Case cube (ft³)', case_weight: 'Case weight (lb)', ti: 'Ti', hi: 'Hi', pallet_qty: 'Cases per pallet',
  shelf_life_months_commercial: 'Shelf life (months, sell sheet)',
  price_fob_case: 'FOB case ($)', price_fob_unit: 'FOB unit ($)', price_wholesale_case: 'Wholesale case ($)',
  price_wholesale_unit: 'Wholesale unit ($)', price_srp: 'SRP ($)',
  distributor_item_no: 'Distributor item no', wholesale_item_no: 'Wholesale item no',
};

/** Whole numbers vs decimals, for validation. */
export const INTEGER_FIELDS = ['units_per_inner', 'units_per_case', 'inners_per_case', 'ti', 'hi', 'pallet_qty', 'shelf_life_months_commercial'];
export const DECIMAL_FIELDS = ['case_l', 'case_w', 'case_h', 'case_cube', 'case_weight', ...PRICE_FIELDS];
