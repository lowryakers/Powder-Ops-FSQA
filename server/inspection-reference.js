// What QA needs beside an open FORM 418-01 sheet (D-348).
//
// QA inspecting a pallet of film, pouches, sleeves or bottles checks it against
// the product's specification and its released artwork. Those live in Products
// and Artwork, so QA ran the inspection with two modules open and walked between
// them — or did the inspection on paper and keyed it in afterwards.
//
// This reads them for the sheet, read-only. It COPIES NOTHING onto the
// inspection: the sheet stores the SKU it is for, and every open reads the spec,
// the colours, the artwork and the approved panel as they stand. The one owner
// of each fact stays where it was.
//
// The door is the inspection's own (QA, `canInspect`), not the Products or
// Artwork grant. That widens nothing a QA lead could not already ask for — QA
// releases artwork (`canRelease`) — and it is narrower than either module: one
// product, read-only, its files as short-lived links.
import { presignGet, storageEnabled } from './storage.js';
import { PACK_LABEL } from '../shared/pack-labels.js';

/** Which packs a sheet's kind is normally for. Used to rank, never to refuse. */
export const KIND_PACKS = Object.freeze({
  film: ['STK'],
  pouch: ['PLG', 'PSM'],
  sleeve: ['BTL'],
  bottle: ['BTL'],
});

export const productLabel = (p) => [p.flavor, p.category, PACK_LABEL[p.pack] || p.pack].filter(Boolean).join(' · ');

/**
 * Products to pick from, for the sheet's product box. Matches SKU, legacy SKU,
 * GTIN, flavour or category; products whose pack fits the sheet's kind come
 * first. At most 25.
 */
export function findProducts(db, q, kind) {
  const term = String(q || '').trim();
  const like = `%${term}%`;
  const rows = term
    ? db.prepare(`SELECT sku, legacy_sku, gtin, flavor, category, pack, status FROM products
        WHERE sku LIKE ? OR legacy_sku LIKE ? OR gtin LIKE ? OR flavor LIKE ? OR base_flavor LIKE ? OR category LIKE ?
        ORDER BY sku LIMIT 200`).all(like, like, like, like, like, like)
    : db.prepare('SELECT sku, legacy_sku, gtin, flavor, category, pack, status FROM products ORDER BY sku LIMIT 200').all();
  const packs = KIND_PACKS[kind] || [];
  const fits = (p) => (packs.includes(p.pack) ? 0 : 1);
  return rows
    .map(p => ({ ...p, label: productLabel(p), fits_kind: packs.length ? packs.includes(p.pack) : null }))
    .sort((a, b) => fits(a) - fits(b) || a.sku.localeCompare(b.sku))
    .slice(0, 25);
}

const link = async (key, filename) => (key && storageEnabled() ? presignGet(key, filename) : null);

/**
 * The artwork QA inspects against, per printed component: the version released
 * to print (print_ready) when there is one; otherwise the newest approved one;
 * otherwise the newest draft or in-review — labelled as NOT released, because
 * inspecting film against a draft is a finding in itself.
 */
function currentArtwork(db, sku) {
  const rows = db.prepare(`SELECT * FROM artwork_versions WHERE sku = ?
    AND status IN ('print_ready','approved','in_review','draft') ORDER BY component, version DESC`).all(sku);
  const byComp = new Map();
  const rank = { print_ready: 0, approved: 1, in_review: 2, draft: 2 };
  for (const v of rows) {
    const cur = byComp.get(v.component);
    if (!cur || rank[v.status] < rank[cur.status]) byComp.set(v.component, v);
  }
  return [...byComp.values()];
}

/** Everything the reference panel shows, for one product. Null when the SKU is unknown. */
export async function inspectionReference(db, sku) {
  const p = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!p) return null;
  const spec = p.spec_id ? db.prepare('SELECT * FROM packaging_specs WHERE spec_id = ?').get(p.spec_id) || null : null;
  const colors = db.prepare('SELECT slot, pms, hex, pms_valid, hex_valid FROM product_colors WHERE sku = ? ORDER BY slot').all(sku)
    .map(c => ({ ...c, pms_valid: !!c.pms_valid, hex_valid: !!c.hex_valid }));

  const artwork = [];
  for (const v of currentArtwork(db, sku)) {
    const files = db.prepare('SELECT id, kind, filename, content_type, storage_key, page FROM artwork_files WHERE version_id = ? ORDER BY kind, page').all(v.id);
    const out = [];
    for (const f of files) out.push({ id: f.id, kind: f.kind, filename: f.filename, content_type: f.content_type, url: await link(f.storage_key, f.filename) });
    const checks = db.prepare("SELECT result FROM artwork_checks WHERE version_id = ?").all(v.id);
    artwork.push({
      id: v.id, component: v.component, version: v.version, status: v.status, released: v.status === 'print_ready',
      nfp_version: v.nfp_version, effective_date: v.effective_date, approved_by: v.approved_by, approved_at: v.approved_at,
      drive_url: v.drive_url, change_summary: v.change_summary,
      open_failures: checks.filter(c => c.result === 'fail').length,
      preview: out.find(f => f.kind === 'preview') || null,
      files: out.filter(f => f.kind !== 'preview'),
    });
  }

  const nfpRow = db.prepare(`SELECT * FROM nfp_versions WHERE sku = ? AND status = 'approved'
    ORDER BY approved_at DESC, updated_at DESC LIMIT 1`).get(sku);
  let nfp = null;
  if (nfpRow) {
    const f = db.prepare("SELECT * FROM nfp_files WHERE version_id = ? AND kind = 'panel' ORDER BY created_at DESC LIMIT 1").get(nfpRow.id);
    nfp = {
      version: nfpRow.version, approved_at: nfpRow.approved_at || null, serving_size: nfpRow.serving_size,
      servings_per_container: nfpRow.servings_per_container, drive_url: nfpRow.drive_url,
      file: f ? { filename: f.filename, content_type: f.content_type, url: await link(f.storage_key, f.filename) } : null,
    };
  }

  return {
    product: {
      sku: p.sku, legacy_sku: p.legacy_sku, label: productLabel(p), flavor: p.flavor, category: p.category,
      pack: p.pack, pack_label: PACK_LABEL[p.pack] || p.pack, status: p.status, gtin: p.gtin, gtin_valid: !!p.gtin_valid,
      eyemark_color: p.eyemark_color, fill_weight_g: p.fill_weight_g, unit_size: p.unit_size || null,
      dieline_required: !!p.dieline_required,
    },
    barcode: p.barcode_key ? {
      filename: p.barcode_filename, gtin: p.barcode_gtin, url: await link(p.barcode_key, p.barcode_filename),
      // The image encodes the number it was made for; say when that is not the product's.
      stale: !!p.barcode_gtin && !!p.gtin && String(p.barcode_gtin).replace(/^0+/, '') !== String(p.gtin).replace(/^0+/, ''),
    } : null,
    spec: spec ? {
      spec_id: spec.spec_id, name: spec.name, format: spec.format, material_structure: spec.material_structure,
      zipper: spec.zipper, print_process: spec.print_process, trim_length_mm: spec.trim_length_mm,
      trim_width_mm: spec.trim_width_mm, gusset_mm: spec.gusset_mm, front_panel_mm: spec.front_panel_mm,
      wind_direction: spec.wind_direction, core_in: spec.core_in, vendor: spec.vendor, notes: spec.notes,
    } : null,
    colors,
    artwork,
    nfp,
    storage: storageEnabled(),
  };
}
