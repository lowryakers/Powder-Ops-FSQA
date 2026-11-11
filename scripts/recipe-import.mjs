// Import product recipe lines from an MRPEasy bill-of-materials export
// (A-20261111-004 PR C, D-340). Admin-run, never at boot, never by a route.
//
//   DB_PATH=/data/readydoc.db node scripts/recipe-import.mjs <bom.csv|xlsx>            # dry run (default)
//   DB_PATH=/data/readydoc.db node scripts/recipe-import.mjs <bom.csv|xlsx> --apply    # writes
//   … --system keychain     the part numbers' system (default: mrpeasy)
//
// The export's columns are read by name, any of these spellings, case aside:
//   product: sku | product sku | product number | product no | product # | product code | product
//   part:    part number | part no | part # | item number | item no | component | component number | part
//   description, quantity (qty), unit (uom)
// THE 10/21 EXPORT WAS NOT AVAILABLE WHEN THIS WAS WRITTEN. Run the dry run on
// it first: an unrecognised column is reported, and nothing is guessed.
//
// RULES:
//   - A product is matched by SKU, then legacy SKU, then mrp_formula_id — and
//     only when mrp_formula_id is a real identifier. "Yes" is reported, never
//     treated as one. An unmatched product is reported, never created.
//   - A line already on file with the same part number and a different
//     quantity, unit or description is a CONFLICT: reported, not overwritten.
//   - A line on file and absent from the export is reported and left alone.
//   - Part numbers come from the file only; nothing is invented.
//   - The dry run writes nothing. --apply backs up first, writes in ONE
//     transaction, audits one row per product, and is idempotent.
//   - formula_source_system is filled only where it is blank, formula_synced_at
//     is stamped, and mrp_formula_id is never touched.
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { randomUUID as uuid } from 'crypto';
import { pathToFileURL } from 'url';
import { readTable } from '../server/tabular.js';
import { SOURCE_SYSTEMS } from '../shared/supplier-documents.js';

const ACTOR = { name: 'recipe-import (MRPEasy BOM export, D-340)' };
const COLS = {
  product: ['sku', 'product sku', 'product number', 'product no', 'product #', 'product code', 'product'],
  part: ['part number', 'part no', 'part #', 'item number', 'item no', 'component number', 'component', 'part'],
  description: ['part description', 'component description', 'item description', 'description', 'part name', 'name'],
  qty: ['quantity', 'qty'],
  uom: ['unit of measure', 'unit', 'uom'],
};
const NOT_AN_ID = /^(yes|no|y|n|x|true|false|-|n\/a|na)$/i;

function columnsOf(headers) {
  const lower = headers.map(h => String(h).trim().toLowerCase());
  const found = {};
  for (const [k, names] of Object.entries(COLS)) {
    const i = names.map(n => lower.indexOf(n)).find(x => x >= 0);
    if (i !== undefined) found[k] = headers[i];
  }
  return found;
}
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

/** What the import would do. Reads only. */
export function plan(db, table, system = 'mrpeasy') {
  if (!SOURCE_SYSTEMS.includes(system)) throw new Error(`--system is one of ${SOURCE_SYSTEMS.join(', ')}.`);
  const cols = columnsOf(table.headers || []);
  const report = { system, columns: cols, unrecognised_columns: (table.headers || []).filter(h => !Object.values(cols).includes(h)),
    products: [], unmatched: [], not_an_id: [], add: 0, same: 0, conflict: 0, kept: 0, skipped_rows: 0 };
  if (!cols.product || !cols.part) { report.error = 'The export needs a product column and a part-number column (see the header of this script).'; return report; }

  const bySku = db.prepare('SELECT sku, mrp_formula_id, formula_source_system FROM products WHERE sku = ? OR legacy_sku = ?');
  const byFormula = db.prepare('SELECT sku, mrp_formula_id, formula_source_system FROM products WHERE mrp_formula_id = ?');
  for (const p of db.prepare("SELECT sku, mrp_formula_id FROM products WHERE mrp_formula_id IS NOT NULL AND TRIM(mrp_formula_id) != ''").all()) {
    if (NOT_AN_ID.test(String(p.mrp_formula_id).trim())) report.not_an_id.push({ sku: p.sku, mrp_formula_id: p.mrp_formula_id });
  }
  const existing = db.prepare('SELECT * FROM product_recipe_lines WHERE sku = ? AND part_source_system = ? AND retired_at IS NULL');

  const groups = new Map();
  (table.rows || []).forEach((row, i) => {
    const productRef = String(row[cols.product] ?? '').trim();
    const part = String(row[cols.part] ?? '').trim();
    if (!productRef || !part) { report.skipped_rows++; return; }
    if (!groups.has(productRef)) groups.set(productRef, []);
    groups.get(productRef).push({ part, description: cols.description ? String(row[cols.description] ?? '').trim() || null : null,
      qty: cols.qty ? num(row[cols.qty]) : null, uom: cols.uom ? String(row[cols.uom] ?? '').trim() || null : null, line: i + 2 });
  });

  for (const [ref, lines] of groups) {
    let p = bySku.get(ref, ref);
    if (!p && !NOT_AN_ID.test(ref)) p = byFormula.get(ref);
    if (!p) { report.unmatched.push({ product: ref, lines: lines.length }); continue; }
    const onFile = new Map(existing.all(p.sku, system).map(l => [l.part_number, l]));
    const seen = new Set();
    const out = { sku: p.sku, from: ref, add: [], same: 0, conflicts: [], kept: [] };
    lines.forEach((l, idx) => {
      if (seen.has(l.part)) return;   // a part listed twice in one product's BOM is filed once
      seen.add(l.part);
      const cur = onFile.get(l.part);
      if (!cur) { out.add.push({ ...l, sort: idx }); return; }
      const differs = (cur.qty ?? null) !== (l.qty ?? null) || (cur.uom ?? null) !== (l.uom ?? null)
        || ((cur.description ?? null) !== (l.description ?? null) && l.description);
      if (differs) out.conflicts.push({ part: l.part, on_file: { qty: cur.qty, uom: cur.uom, description: cur.description }, in_file: { qty: l.qty, uom: l.uom, description: l.description } });
      else out.same++;
    });
    for (const [part] of onFile) if (!seen.has(part)) out.kept.push(part);
    report.add += out.add.length; report.same += out.same; report.conflict += out.conflicts.length; report.kept += out.kept.length;
    report.products.push(out);
  }
  return report;
}

/** Write the ADD lines. One transaction, one audit row per product. */
export function applyPlan(db, logAudit, table, system = 'mrpeasy', importRef = null) {
  const report = plan(db, table, system);
  if (report.error) throw new Error(report.error);
  const ins = db.prepare(`INSERT OR IGNORE INTO product_recipe_lines
    (id, sku, part_source_system, part_number, description, qty, uom, sort, source, import_ref)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let written = 0;
  db.transaction(() => {
    for (const p of report.products) {
      if (!p.add.length) continue;
      for (const l of p.add) written += ins.run(uuid(), p.sku, system, l.part, l.description, l.qty, l.uom, l.sort, 'bom_import', importRef).changes;
      db.prepare(`UPDATE products SET formula_source_system = COALESCE(NULLIF(TRIM(formula_source_system), ''), ?),
        formula_synced_at = datetime('now') WHERE sku = ?`).run(system, p.sku);
      logAudit(ACTOR, 'product_recipe_imported', 'product', p.sku,
        { system, import_ref: importRef, added: p.add.map(l => l.part), conflicts: p.conflicts.map(c => c.part), kept: p.kept }, null, null, p.sku);
    }
  })();
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const si = args.indexOf('--system');
  const system = si >= 0 ? String(args[si + 1] || '').toLowerCase() : 'mrpeasy';
  const files = args.filter((a, i) => a !== '--apply' && a !== '--system' && !(si >= 0 && i === si + 1));
  if (files.length !== 1) { console.error('Usage: node scripts/recipe-import.mjs <bom.csv|xlsx> [--system mrpeasy] [--apply]'); process.exit(1); }
  const dbPath = process.env.DB_PATH;
  if (!dbPath || !existsSync(dbPath)) { console.error('DB_PATH must name an existing database.'); process.exit(1); }
  const table = readTable(readFileSync(files[0]), files[0]);
  const { default: Database } = await import('better-sqlite3');
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const r = plan(ro, table, system);
  if (r.error) { ro.close(); console.error(r.error); console.error(`Columns read: ${JSON.stringify(table.headers)}`); process.exit(1); }
  console.log(`Columns: ${JSON.stringify(r.columns)}${r.unrecognised_columns.length ? `  (not read: ${r.unrecognised_columns.join(', ')})` : ''}`);
  for (const p of r.products) {
    console.log(`${p.sku.padEnd(18)} from ${String(p.from).padEnd(14)} add ${p.add.length}  same ${p.same}  conflict ${p.conflicts.length}  on file, not in export ${p.kept.length}`);
    for (const c of p.conflicts) console.log(`    CONFLICT ${c.part}: on file ${JSON.stringify(c.on_file)} · export ${JSON.stringify(c.in_file)} — left as on file`);
  }
  for (const u of r.unmatched) console.log(`UNMATCHED product "${u.product}" (${u.lines} line(s)) — no SKU, legacy SKU or formula id matches; nothing created`);
  for (const n of r.not_an_id) console.log(`NOT AN ID: ${n.sku} has mrp_formula_id "${n.mrp_formula_id}", which is not a formula identifier; it was not used to match`);
  console.log(`\nProducts matched: ${r.products.length} · lines to add: ${r.add} · already on file: ${r.same} · conflicts: ${r.conflict} · unmatched products: ${r.unmatched.length} · rows skipped (blank): ${r.skipped_rows}`);
  if (!apply) { ro.close(); console.log('\nDRY RUN — nothing written. Run again with --apply to add the lines.'); process.exit(0); }
  if (!r.add) { ro.close(); console.log('\nNothing to add. No backup taken and nothing written.'); process.exit(0); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-recipe-import-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);
  const { getDb, logAudit } = await import('../server/db.js');
  try { console.log(`APPLIED: ${applyPlan(getDb(), logAudit, table, system, path.basename(files[0]))} line(s) added.`); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
