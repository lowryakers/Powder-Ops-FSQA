// A product's recipe lines, and the supplier documents they reach (A-20261111-004
// PR C, D-340). READ-ONLY on the product: the documents stay where they were
// filed — on the supplier and its ingredient — and this JOINS to them. There is
// no product copy of a supplier document, and nothing here writes one.
//
//   recipe line (sku, system, part_number)
//     → supplier_material_parts (system, part_number)  — one part may come from
//       several suppliers (a manufacturer and a distributor)
//     → supplier_materials → suppliers
//     → supplier_files for that ingredient, and the supplier-level documents
//       (GMP certificate, letter of guarantee, COI, W-9 …), labelled as such.
//
// procurement_boms is NOT this. That table is the Procurement planning seed,
// keyed by product_number; this is the compliance recipe keyed by products.sku.

import { FILE_KIND_LABEL, SUPPLIER_LEVEL_KINDS } from '../shared/supplier-documents.js';

export const EXPIRING_DAYS = 30;

const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** current / expiring / expired / no_date — one rule for the drawer and the pack. */
export function docStatus(expiresOn, today) {
  if (!expiresOn) return 'no_date';
  if (expiresOn < today) return 'expired';
  if (expiresOn <= plusDays(today, EXPIRING_DAYS)) return 'expiring';
  return 'current';
}
export const DOC_STATUS_LABEL = { current: 'Current', expiring: 'Expiring soon', expired: 'Expired', no_date: 'No expiry on file', missing: 'Missing' };

export function recipeLines(db, sku) {
  return db.prepare(`SELECT * FROM product_recipe_lines WHERE sku = ? AND retired_at IS NULL
    ORDER BY sort, part_number`).all(sku);
}

const shapeDoc = (f, today, scope) => ({
  id: f.id, kind: f.kind, kind_label: FILE_KIND_LABEL[f.kind] || f.kind, filename: f.filename,
  expires_on: f.expires_on, status: docStatus(f.expires_on, today), stored: !!f.storage_key,
  lot_number: f.kind === 'coa' ? f.lot_number : null, scope, supplier_id: f.supplier_id,
});

/**
 * The rollup for one SKU. Every document appears once per supplier, by its file
 * id; a file is never copied. A line whose part number reaches no ingredient on
 * any supplier says so (`suppliers: []`) rather than disappearing.
 */
export function recipeRollup(db, sku, today = new Date().toISOString().slice(0, 10)) {
  const lines = recipeLines(db, sku);
  if (!lines.length) return { sku, lines: [], suppliers: [] };
  const matsFor = db.prepare(`SELECT m.*, s.name AS supplier_name, s.actively_using, s.status AS supplier_status
    FROM supplier_material_parts p
    JOIN supplier_materials m ON m.id = p.material_id
    JOIN suppliers s ON s.id = m.supplier_id
    WHERE p.system = ? AND p.part_number = ? AND m.is_active = 1
    ORDER BY s.name COLLATE NOCASE`);
  const filesFor = db.prepare(`SELECT id, supplier_id, material_id, kind, filename, expires_on, lot_number, storage_key
    FROM supplier_files WHERE material_id = ? ORDER BY kind, expires_on DESC, filename`);
  const supplierLevel = db.prepare(`SELECT id, supplier_id, material_id, kind, filename, expires_on, lot_number, storage_key
    FROM supplier_files WHERE supplier_id = ? AND material_id IS NULL
      AND kind IN (${SUPPLIER_LEVEL_KINDS.map(() => '?').join(',')})
    ORDER BY kind, expires_on DESC, filename`);
  const suppliers = new Map();
  const out = lines.map(l => {
    const mats = matsFor.all(l.part_source_system, l.part_number);
    return {
      id: l.id, part_source_system: l.part_source_system, part_number: l.part_number, description: l.description,
      qty: l.qty, uom: l.uom, sort: l.sort,
      suppliers: mats.map(m => {
        if (!suppliers.has(m.supplier_id)) {
          suppliers.set(m.supplier_id, {
            id: m.supplier_id, name: m.supplier_name, actively_using: !!m.actively_using, status: m.supplier_status,
            documents: supplierLevel.all(m.supplier_id, ...SUPPLIER_LEVEL_KINDS).map(f => shapeDoc(f, today, 'supplier')),
          });
        }
        return {
          supplier_id: m.supplier_id, supplier_name: m.supplier_name, material_id: m.id,
          material: m.item_description, manufacturer_name: m.manufacturer_name,
          documents: filesFor.all(m.id).map(f => shapeDoc(f, today, 'ingredient')),
        };
      }),
    };
  });
  return { sku, lines: out, suppliers: [...suppliers.values()] };
}
