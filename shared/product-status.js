// A product's status, and the one that means "this SKU is not going live" (D-324).
//
// `not_launching` is set ONLY by POST /products/:sku/not-launching, with a
// reason and a name — never typed into the status cell, because a SKU that
// silently drops out of the catalog and the proofer feed is a decision nobody
// can find later. Moving it back is the same route with `undo`.
//
// `discontinued` (sold, then stopped) is a different fact and keeps its old
// behaviour: it stays on the catalog list and leaves the proofer feed.

export const PRODUCT_STATUSES = ['active', 'in_development', 'concept', 'on_hold', 'discontinued', 'not_launching'];
export const NOT_LAUNCHING = 'not_launching';
export const STATUS_LABEL = {
  active: 'Active', in_development: 'In development', concept: 'Concept',
  on_hold: 'On hold', discontinued: 'Discontinued', not_launching: "Won't launch",
};
export const statusLabel = (s) => STATUS_LABEL[s] || String(s || '').replace(/_/g, ' ');

/** Statuses that leave every "live catalog" reader (the proofer feed, NFP and artwork worklists). */
export const OFF_CATALOG = ['discontinued', NOT_LAUNCHING];
export const OFF_CATALOG_SQL = `('${OFF_CATALOG.join("','")}')`;
