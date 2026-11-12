// What the product page READS for the source-of-truth sections (R-0645 PR B).
//
//   Label     — the current APPROVED nutrition panel: its key facts, the front
//               callouts and the allergen statement, read straight off the
//               nfp_versions row. Never a second editor; the panel is edited in
//               the NFP module and this is a read of what was approved.
//   Barcodes  — the inner and case barcode images (product_barcodes), each
//               saying which number it encodes and whether that is still the
//               product's number.
//   Pricing   — shown to canManage readers only; stripped from every other
//               reader's copy of the row.
//   Saved views — a named filter + column set on the catalogue.

import { PRICE_FIELDS } from '../shared/product-sot-config.js';
import { cleanFilters } from '../shared/product-filters.js';
import { sameGtin } from '../shared/gtin.js';

/** canManage readers see prices; nobody else's copy of a row carries them. */
export function stripPrices(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of PRICE_FIELDS) delete out[f];
  out.prices_hidden = true;
  return out;
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** The label facts shown on the product page, from these panel fields only. */
export const LABEL_FACTS = [
  ['serving', 'Serving'], ['servings_per_container', 'Servings per container'], ['calories', 'Calories'],
  ['protein_g', 'Protein (g)'], ['total_carbohydrate_g', 'Total carbohydrate (g)'], ['total_sugars_g', 'Total sugars (g)'],
  ['added_sugars_g', 'Added sugars (g)'], ['total_fat_g', 'Total fat (g)'], ['sodium_mg', 'Sodium (mg)'],
  ['net_weight', 'Net weight'],
];
export const CALLOUT_LABEL = { protein_g: 'Protein (g)', calories: 'Calories', added_sugar_g: 'Added sugar (g)', net_carbs_g: 'Net carbs (g)' };

/**
 * The current approved panel, as the Label section reads it. Null when no
 * panel is approved — a draft is never shown as the label, because the label
 * is what was approved. `pending` names an open draft so the page can say so.
 */
export function approvedLabel(db, sku) {
  let v = null; let pending = null; let file = null;
  try {
    v = db.prepare(`SELECT id, version, status, approved_by, approved_at, panel_json, front_callouts
      FROM nfp_versions WHERE sku = ? AND status = 'approved' ORDER BY approved_at DESC, updated_at DESC LIMIT 1`).get(sku);
    pending = db.prepare(`SELECT id, version, status FROM nfp_versions WHERE sku = ? AND status NOT IN ('approved','superseded')
      ORDER BY updated_at DESC LIMIT 1`).get(sku) || null;
    if (v) file = db.prepare(`SELECT id, filename FROM nfp_files WHERE version_id = ? AND kind = 'panel' ORDER BY created_at DESC LIMIT 1`).get(v.id) || null;
  } catch { /* a database without the NFP tables reads as no panel */ }
  if (!v) return { approved: null, pending };
  const panel = parse(v.panel_json) || {};
  const callouts = parse(v.front_callouts) || {};
  const serving = [panel.serving_household, panel.serving_grams != null && panel.serving_grams !== '' ? `(${panel.serving_grams} g)` : null]
    .filter(Boolean).join(' ') || panel.serving_size_desc || null;
  const net = [panel.net_weight_oz != null && panel.net_weight_oz !== '' ? `${panel.net_weight_oz} oz` : null,
    panel.net_weight_g != null && panel.net_weight_g !== '' ? `${panel.net_weight_g} g` : null].filter(Boolean).join(' / ') || null;
  const values = { ...panel, serving, net_weight: net };
  return {
    approved: {
      id: v.id, version: v.version, approved_by: v.approved_by || null, approved_at: v.approved_at || null,
      file_id: file?.id || null, file_name: file?.filename || null,
      facts: LABEL_FACTS.map(([k, label]) => ({ key: k, label, value: values[k] ?? null }))
        .filter((f) => f.value !== null && f.value !== ''),
      // A callout is three states (D-128): a number, null = "this pack does not claim it", absent = not answered.
      callouts: Object.entries(CALLOUT_LABEL).map(([k, label]) => ({
        key: k, label, state: !(k in callouts) ? 'unanswered' : callouts[k] === null ? 'not_claimed' : 'claimed', value: callouts[k] ?? null,
      })),
      allergen_statement: panel.allergen_statement || null,
    },
    pending,
  };
}

/** The inner and case barcode images on file, each saying whether it still encodes the product's code. */
export function levelBarcodes(db, product) {
  let rows = [];
  try { rows = db.prepare('SELECT * FROM product_barcodes WHERE sku = ?').all(product.sku); } catch { /* none */ }
  const out = {};
  for (const level of ['inner', 'case']) {
    const r = rows.find((x) => x.level === level);
    const current = product[`gtin_${level}`] || null;
    out[level] = r ? {
      filename: r.filename, barcode_gtin: r.barcode_gtin, uploaded_by: r.uploaded_by, uploaded_at: r.uploaded_at,
      stale: !!current && !sameGtin(r.barcode_gtin, current), orphaned: !current,
    } : null;
  }
  return out;
}

// ── Saved views ──────────────────────────────────────────────────────────────

const shapeView = (r, me) => ({
  id: r.id, name: r.name, shared: !!r.shared, mine: r.user_id === me,
  owner: r.owner_name || null, filters: cleanFilters(parse(r.filters) || {}),
  columns: (parse(r.columns) || []).filter((c) => typeof c === 'string').slice(0, 50),
  created_at: r.created_at, updated_at: r.updated_at,
});

/** Mine, plus every shared view, newest first. */
export function listViews(db, userId) {
  return db.prepare(`SELECT v.*, u.name AS owner_name FROM product_saved_views v LEFT JOIN users u ON u.id = v.user_id
    WHERE v.user_id = ? OR v.shared = 1 ORDER BY v.name COLLATE NOCASE`).all(userId).map((r) => shapeView(r, userId));
}

export function getView(db, id, userId) {
  const r = db.prepare(`SELECT v.*, u.name AS owner_name FROM product_saved_views v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ?`).get(id);
  if (!r || (r.user_id !== userId && !r.shared)) return null;
  return shapeView(r, userId);
}

/** Validate a saved view's body. `{ error }` or `{ name, filters, columns, shared }`. */
export function cleanViewBody(b) {
  const name = String(b?.name || '').trim();
  if (name.length < 2) return { error: 'Give the view a name (two characters or more).' };
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' };
  const columns = Array.isArray(b?.columns) ? b.columns.filter((c) => typeof c === 'string' && /^[a-z_]{1,40}$/.test(c)).slice(0, 50) : [];
  return { name, filters: cleanFilters(b?.filters), columns, shared: b?.shared ? 1 : 0 };
}
