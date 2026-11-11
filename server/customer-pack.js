// A customer's document pack for one or more SKUs (A-20261111-004 PR C, D-340).
//
// READ-ONLY. It joins each SKU's recipe to the supplier documents already on
// file (recipeRollup) and writes a summary sheet; the zip carries COPIES of the
// stored files for sending. Nothing is inserted anywhere — no supplier_files
// row, no product file, no audit of a "pack" record. The sheet names each file
// it bundles so a reader can find it.
//
// Whole Foods' natural-flavor request is the first preset. Its columns are the
// v2 gap-list shape. A column that has no document KIND (GRAS, non-GMO, origin)
// lists files on record whose NAME says so — a reading of the name shown as a
// filename, never stored as a kind.

import { recipeRollup, DOC_STATUS_LABEL } from './product-recipes.js';

export const PRESETS = {
  'whole-foods-natural-flavor': {
    label: 'Whole Foods — natural flavor',
    columns: ['sku', 'flavor_name', 'status', 'ingredient', 'part_number', 'supplier', 'natural_flavor_stmt', 'coa', 'coa_lot',
      'spec', 'allergen', 'gras', 'non_gmo', 'origin', 'certificates', 'expiry_status', 'missing'],
    // What the preset asks for, per ingredient line, in order.
    required: ['natural_flavor_stmt', 'coa', 'spec'],
  },
};

const NAME_COLUMNS = {
  gras: /\bgras\b/i,
  non_gmo: /non.?gmo/i,
  origin: /\b(country\s*of\s*)?origin\b|\bcoo\b/i,
};
const KIND_COLUMNS = {
  natural_flavor_stmt: ['natural_flavor'],
  coa: ['coa'],
  spec: ['specification'],
  allergen: ['allergen'],
  certificates: ['certificate', 'audit_certificate', 'gmp_certificate'],
};
const WORST = ['expired', 'expiring', 'no_date', 'current'];

/** Rows for the sheet, and the files the zip bundles (each once, by id). */
export function buildPack(db, skus, presetKey = 'whole-foods-natural-flavor', today = new Date().toISOString().slice(0, 10)) {
  const preset = PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown preset "${presetKey}". Presets: ${Object.keys(PRESETS).join(', ')}.`);
  const rows = [];
  const files = new Map();
  const product = db.prepare('SELECT sku, flavor, status FROM products WHERE sku = ?');
  const missingSkus = [];
  for (const sku of skus) {
    const p = product.get(sku);
    if (!p) { missingSkus.push(sku); continue; }
    const roll = recipeRollup(db, sku, today);
    if (!roll.lines.length) {
      rows.push({ sku, flavor_name: p.flavor, status: p.status, missing: 'no recipe on file' });
      continue;
    }
    for (const l of roll.lines) {
      const supplierDocs = (sid) => roll.suppliers.find(s => s.id === sid)?.documents || [];
      const sups = l.suppliers.length ? l.suppliers : [null];
      for (const s of sups) {
        const docs = s ? [...s.documents, ...supplierDocs(s.supplier_id)] : [];
        const pick = (pred) => docs.filter(pred);
        const row = {
          sku, flavor_name: p.flavor, status: p.status, ingredient: s?.material || l.description || '',
          part_number: `${l.part_source_system}:${l.part_number}`, supplier: s?.supplier_name || '',
        };
        for (const [col, kinds] of Object.entries(KIND_COLUMNS)) {
          const hit = pick(d => kinds.includes(d.kind));
          row[col] = hit.map(d => d.filename).join(' | ');
          if (col === 'coa') row.coa_lot = hit.map(d => d.lot_number).filter(Boolean).join(' | ');
          hit.forEach(d => files.set(d.id, d));
        }
        for (const [col, re] of Object.entries(NAME_COLUMNS)) {
          const hit = pick(d => re.test(d.filename));
          row[col] = hit.map(d => d.filename).join(' | ');
          hit.forEach(d => files.set(d.id, d));
        }
        const used = docs.filter(d => files.has(d.id));
        const worst = WORST.find(w => used.some(d => d.status === w));
        row.expiry_status = worst ? DOC_STATUS_LABEL[worst] : '';
        const missing = [];
        if (!s) missing.push('no supplier ingredient carries this part number');
        else for (const col of preset.required) if (!row[col]) missing.push(col.replace(/_/g, ' '));
        row.missing = missing.join('; ');
        rows.push(row);
      }
    }
  }
  return { preset: presetKey, label: preset.label, columns: preset.columns, rows, files: [...files.values()], missing_skus: missingSkus };
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function packCsv(pack) {
  return [pack.columns.join(','), ...pack.rows.map(r => pack.columns.map(c => csvCell(r[c])).join(','))].join('\n') + '\n';
}
