// A product's status (R-0645, D-342), and the one that means "this SKU is not
// going live" (D-324).
//
// FIVE STATUSES a person picks: draft → ready → active, plus hold and
// discontinued. Stored as lowercase SLUGS; the label is what a person reads.
// Dozens of compares already read the slug `active` (the proofer feed, the
// delete refusals, the stability coverage), so the slug is what stays — the
// label is the only thing that says "Active".
//
// `active` IS A GATE, NOT A VALUE TO TYPE. Only the configured approver, in a
// person's own session, moves a product to Active, and only when its checklist
// is done or N/A (server/product-sot-gate.js). A token or a bot account never
// does, even on that person's account.
//
// `not_launching` is set ONLY by POST /products/:sku/not-launching, with a
// reason and a name — never typed into the status cell, because a SKU that
// silently drops out of the catalog and the proofer feed is a decision nobody
// can find later. Moving it back is the same route with `undo`.
//
// `discontinued` (sold, then stopped) is a different fact and keeps its old
// behaviour: it stays on the catalog list and leaves the proofer feed.

export const DRAFT = 'draft';
export const ACTIVE = 'active';
export const NOT_LAUNCHING = 'not_launching';

/** The five a person may pick from the status list, in order. */
export const EDITABLE_STATUSES = ['draft', 'ready', 'active', 'hold', 'discontinued'];
/** Every stored value, including the one only its own route sets. */
export const PRODUCT_STATUSES = [...EDITABLE_STATUSES, NOT_LAUNCHING];

export const STATUS_LABEL = {
  draft: 'Draft', ready: 'Ready', active: 'Active', hold: 'Hold',
  discontinued: 'Discontinued', not_launching: "Won't launch",
};

/**
 * What an older stored value means now. The live catalogue mixes `Draft` (the
 * merch variants and bottle drafts) and `active`; the old grid also offered
 * in_development / concept / on_hold, none of which are on a live row. The
 * migration script (scripts/product-status-migrate.mjs) moves stored rows; this
 * map is also what a write reads, so a client still sending an old spelling
 * lands on the new slug instead of being refused.
 */
export const LEGACY_STATUS = {
  Draft: 'draft', DRAFT: 'draft', draft: 'draft',
  Active: 'active', ACTIVE: 'active', active: 'active',
  in_development: 'ready', concept: 'ready', Ready: 'ready', ready: 'ready',
  on_hold: 'hold', Hold: 'hold', hold: 'hold',
  Discontinued: 'discontinued', discontinued: 'discontinued',
  not_launching: 'not_launching',
};

/** A stored or sent value as its slug; unknown text comes back unchanged so it can be refused by name. */
export const normalizeStatus = (s) => (s == null ? s : (LEGACY_STATUS[String(s).trim()] ?? String(s).trim()));
export const isActiveStatus = (s) => normalizeStatus(s) === ACTIVE;
export const statusLabel = (s) => STATUS_LABEL[normalizeStatus(s)] || String(s || '').replace(/_/g, ' ');

/** Statuses that leave every "live catalog" reader (the proofer feed, NFP and artwork worklists). */
export const OFF_CATALOG = ['discontinued', NOT_LAUNCHING];
export const OFF_CATALOG_SQL = `('${OFF_CATALOG.join("','")}')`;
