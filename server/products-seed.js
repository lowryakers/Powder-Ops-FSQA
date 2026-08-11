// Load the finished-goods catalogue from the audited CSVs.
//
// Idempotent and non-destructive: it only INSERTs rows that are absent, so a
// second run changes nothing and an edit made in the app is never overwritten
// by a redeploy. That matters more here than in most seeds — this table is the
// master list, and a seed that clobbered a hand-corrected GTIN would be worse
// than no seed at all.
//
// Source: the normalised output of the ProDough audit (118 products, 5 specs,
// 312 colour slots). The codes are the CURRENT ones, deliberately — the
// standardised scheme is applied by rename, later and on purpose.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getDb } from './db.js';
import { gtinValid } from './api/products.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-data');

// Minimal CSV reader — the audit writes RFC4180 with quoted fields only where
// a comma or quote appears, which is all this needs to handle.
function readCsv(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(v => v !== ''));
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const num = (v) => (v === '' || v === undefined ? null : Number(v));
const bool = (v) => (String(v).toUpperCase() === 'TRUE' ? 1 : 0);

const PACK = { Stick: 'STK', Box: 'BOX', Cup: 'CUP' };
const PROTEIN = { 'Whey Protein': 'Whey', 'Beef Protein': 'Beef', 'Plant Protein': 'Plant' };

function packOf(row) {
  if (row.format === 'Pouch') return row.spec_id === 'SPEC-POUCH-SM' ? 'PSM' : 'PLG';
  return PACK[row.format] || 'PLG';
}

export function seedProducts() {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  if (existing > 0) return { skipped: true, products: existing };

  const specs = readCsv('packaging_specs.csv');
  const products = readCsv('products.csv');
  const colors = readCsv('sku_colors.csv');

  const insSpec = db.prepare(`INSERT OR IGNORE INTO packaging_specs
    (spec_id, name, format, material_structure, zipper, print_process, trim_length_mm,
     trim_width_mm, gusset_mm, front_panel_mm, wind_direction, core_in, dieline_required,
     vendor, last_unit_cost, vendor_spec_string, notes)
    VALUES (@spec_id, @name, @format, @material_structure, @zipper, @print_process, @trim_length_mm,
            @trim_width_mm, @gusset_mm, @front_panel_mm, @wind_direction, @core_in, @dieline_required,
            @vendor, @last_unit_cost, @vendor_spec_string, @notes)`);

  const insProduct = db.prepare(`INSERT OR IGNORE INTO products
    (sku, gtin, gtin_valid, category, protein_type, pack, flavor, base_flavor, status,
     spec_id, eyemark_color, dieline_required, shopify_sku, shopify_variant_id,
     mrp_formula_id, formula_rev, artwork_version, artwork_status, nfp_version, notes, created_by)
    VALUES (@sku, @gtin, @gtin_valid, @category, @protein_type, @pack, @flavor, @base_flavor, @status,
            @spec_id, @eyemark_color, @dieline_required, @shopify_sku, @shopify_variant_id,
            @mrp_formula_id, @formula_rev, @artwork_version, @artwork_status, @nfp_version, @notes, 'seed')`);

  const insColor = db.prepare(`INSERT OR IGNORE INTO product_colors
    (id, sku, slot, pms, hex, pms_valid, hex_valid)
    VALUES (@id, @sku, @slot, @pms, @hex, @pms_valid, @hex_valid)`);

  const load = db.transaction(() => {
    for (const s of specs) {
      insSpec.run({
        spec_id: s.spec_id, name: s.spec_name, format: s.format,
        material_structure: s.material_structure || null, zipper: s.zipper || null,
        print_process: s.print_process || null,
        trim_length_mm: num(s.trim_length_mm), trim_width_mm: num(s.trim_width_mm),
        gusset_mm: num(s.gusset_mm), front_panel_mm: num(s.front_panel_mm),
        wind_direction: s.wind_direction || null, core_in: s.core_in || null,
        dieline_required: bool(s.dieline_required),
        vendor: s.vendor || null, last_unit_cost: num(s.last_unit_cost),
        vendor_spec_string: s.vendor_spec_string || null, notes: s.notes || null,
      });
    }

    for (const p of products) {
      insProduct.run({
        sku: p.sku,
        gtin: p.gtin || null,
        // Recomputed rather than trusted from the CSV: this column is what the
        // readiness check and the SKU list badge read, so it has to be ours.
        gtin_valid: gtinValid(p.gtin) ? 1 : 0,
        category: p.product_line,
        protein_type: PROTEIN[p.product_line] || null,
        pack: packOf(p),
        flavor: p.flavor,
        base_flavor: p.base_flavor,
        status: (p.status || 'Active').toLowerCase().replace(/\s+/g, '_'),
        spec_id: p.spec_id || null,
        eyemark_color: p.eyemark_color || null,
        dieline_required: bool(p.dieline_required),
        shopify_sku: p.shopify_sku || null,
        shopify_variant_id: p.shopify_variant_id || null,
        mrp_formula_id: p.mrp_formula_id || null,
        formula_rev: p.formula_rev || null,
        artwork_version: p.artwork_version || null,
        artwork_status: p.artwork_status && p.artwork_status !== 'Unknown' ? p.artwork_status : null,
        nfp_version: p.nfp_version || null,
        notes: p.notes || null,
      });
    }

    const known = new Set(products.map(p => p.sku));
    for (const c of colors) {
      if (!known.has(c.sku)) continue;   // an orphan colour row would fail the FK
      insColor.run({
        id: uuid(), sku: c.sku, slot: Number(c.slot),
        pms: c.pms || null, hex: c.hex || null,
        pms_valid: bool(c.pms_valid), hex_valid: bool(c.hex_valid),
      });
    }
  });

  load();

  const counts = {
    specs: db.prepare('SELECT COUNT(*) n FROM packaging_specs').get().n,
    products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
    colors: db.prepare('SELECT COUNT(*) n FROM product_colors').get().n,
  };
  console.log(`[seed] products ${counts.products} · specs ${counts.specs} · colour slots ${counts.colors}`);
  return { skipped: false, ...counts };
}
