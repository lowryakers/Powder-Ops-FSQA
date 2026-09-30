// The facts the new-product stage is derived from, read once per list (D-134).
// The stage itself is shared/product-stage.js — pure — and nothing here
// decides a gate. One walk: the approved panel per SKU, the current released
// artwork, the PO recorded against that artwork, and the block.

import { provenanceOf } from '../shared/panel-provenance.js';
import { stageOf } from '../shared/product-stage.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export function stageInputs(db) {
  // The APPROVED panel — the one the print gate reads. A superseded or draft
  // panel is never the answer to "is the panel done".
  const panels = new Map();
  for (const v of safe(() => db.prepare(`SELECT * FROM nfp_versions WHERE status = 'approved'
      ORDER BY COALESCE(approved_at, '') DESC, updated_at DESC`).all(), [])) {
    if (!panels.has(v.sku)) panels.set(v.sku, { id: v.id, version: v.version, provenance: provenanceOf(v) });
  }
  // The current RELEASED artwork: print-ready, the primary component first, newest version.
  const artwork = new Map();
  for (const a of safe(() => db.prepare(`SELECT id, sku, component, version, nfp_version FROM artwork_versions
      WHERE status = 'print_ready' ORDER BY CASE component WHEN 'primary' THEN 0 ELSE 1 END, version DESC`).all(), [])) {
    if (!artwork.has(a.sku)) artwork.set(a.sku, a);
  }
  const pos = new Map();
  for (const r of safe(() => db.prepare(`SELECT * FROM packaging_po_records WHERE artwork_version_id IS NOT NULL
      ORDER BY recorded_at DESC`).all(), [])) {
    if (!pos.has(r.artwork_version_id)) pos.set(r.artwork_version_id, r);
  }
  const blocks = new Map(safe(() => db.prepare('SELECT * FROM product_completeness_blocks').all(), []).map((b) => [b.sku, b]));
  return { panels, artwork, pos, blocks };
}

/** The stage of one hydrated product (it must carry `readiness`). */
export function stageFor(inputs, p) {
  const art = inputs.artwork.get(p.sku) || null;
  return stageOf({
    p, panel: inputs.panels.get(p.sku) || null, artwork: art,
    po: art ? inputs.pos.get(art.id) || null : null, block: inputs.blocks.get(p.sku) || null,
  });
}
