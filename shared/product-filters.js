// The catalogue's filters (R-0645 PR B). PURE — the Products screen filters
// with it and the checks assert against it, so a saved view reopens to exactly
// the rows it was saved on.
//
// A CHANNEL IS READ OFF WHAT IS RECORDED, never typed as a second fact:
//   shopify / shiphero — the readiness step is done (a person confirmed it);
//   amazon             — amazon_channel says 'listed';
//   distributor / wholesale — an item number is on the record.
// A product can be on several channels; "none" is a product on none of them.

import { normalizeStatus } from './product-status.js';

export const CHANNELS = [
  { key: 'shopify', label: 'Shopify' },
  { key: 'shiphero', label: 'ShipHero' },
  { key: 'amazon', label: 'Amazon' },
  { key: 'distributor', label: 'Distributor' },
  { key: 'wholesale', label: 'Wholesale' },
  { key: 'none', label: 'No channel yet' },
];

const stepDone = (p, key) => (p?.readiness?.steps || []).some((s) => s.key === key && s.state === 'done');

/** The channels a product is on, as keys of CHANNELS (never 'none'). */
export function channelsOf(p) {
  const out = [];
  if (stepDone(p, 'shopify')) out.push('shopify');
  if (stepDone(p, 'shiphero')) out.push('shiphero');
  if (p?.amazon_channel === 'listed') out.push('amazon');
  if (String(p?.distributor_item_no || '').trim()) out.push('distributor');
  if (String(p?.wholesale_item_no || '').trim()) out.push('wholesale');
  return out;
}

/** The filter keys a saved view may carry. Anything else in a stored view is ignored. */
export const FILTER_KEYS = ['q', 'kind', 'category', 'pack', 'brand', 'channel', 'status', 'showHidden'];

/** A filter object reduced to known keys with string / boolean values. */
export function cleanFilters(raw) {
  const f = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return f;
  for (const k of FILTER_KEYS) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (k === 'showHidden') { f[k] = !!raw[k]; continue; }
    const v = String(raw[k]).slice(0, 200);
    if (v) f[k] = v;
  }
  if (f.kind && !['food', 'merch', 'all'].includes(f.kind)) delete f.kind;
  return f;
}

/** Does this product pass these filters? `notLaunching` is the hidden status slug. */
export function matchesFilters(p, f = {}, { notLaunching = 'not_launching' } = {}) {
  if (!f.showHidden && p.status === notLaunching) return false;
  const kind = f.kind || 'food';
  if (kind === 'food' && p.product_type === 'merch') return false;
  if (kind === 'merch' && p.product_type !== 'merch') return false;
  if (f.category && p.category !== f.category) return false;
  if (f.pack && p.pack !== f.pack) return false;
  if (f.brand && (p.brand || '') !== f.brand) return false;
  if (f.status && normalizeStatus(p.status) !== f.status) return false;
  if (f.channel) {
    const ch = channelsOf(p);
    if (f.channel === 'none' ? ch.length > 0 : !ch.includes(f.channel)) return false;
  }
  const needle = String(f.q || '').trim().toLowerCase();
  if (!needle) return true;
  return [p.sku, p.legacy_sku, p.gtin, p.flavor, p.base_flavor, p.shopify_sku, p.gtin_inner, p.gtin_case]
    .some((v) => (v || '').toLowerCase().includes(needle));
}
