import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

// Seeds procurement reference data from Jake's two workbooks so he starts from
// exactly where his spreadsheets are today:
//
//   Jake's COMBINED BOMs      → procurement_boms   (parts demand explosion)
//   Parts, Samples and Pricing → procurement_parts + procurement_samples
//
// Each table seeds only when it's empty, so this never fights with edits made
// in the app. Re-importing a newer export is a deliberate act (clear the table
// first), not something a restart does behind his back.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (name) => {
  try { return JSON.parse(readFileSync(path.join(__dirname, 'seed-data', name), 'utf8')); }
  catch { return null; }
};

const isEmpty = (db, table) => {
  try { return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c === 0; } catch { return false; }
};

export function seedProcurement(db) {
  let boms = 0, parts = 0, samples = 0, demand = 0;

  if (isEmpty(db, 'procurement_boms')) {
    const data = read('procurement-boms.json');
    if (data?.rows?.length) {
      const ins = db.prepare(`INSERT INTO procurement_boms
        (id, bom_number, bom_name, product_number, product_name, group_number, group_name,
         part_no, part_description, uom, bom_qty, fill_weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // A handful of lines in the workbook have no quantity against them (the
      // ProDough scoop on the whey SKUs). They're kept so the BOM is complete,
      // with a zero quantity that shows up as "needs a number".
      db.transaction(() => {
        for (const r of data.rows) {
          const row = r.map(v => (v === undefined ? null : v));
          // The workbook has section-header rows ("STICK PACKS ONLY") with no
          // product or part on them — not BOM lines, so skip them.
          if (!row[2] || !row[6]) continue;
          row[9] = row[9] ?? 0;
          row[10] = row[10] ?? 1;
          ins.run(uuid(), ...row);
          boms++;
        }
      })();
    }
  }

  if (isEmpty(db, 'procurement_parts')) {
    const rows = read('procurement-parts.json') || [];
    const ins = db.prepare(`INSERT INTO procurement_parts
      (id, part_no, description, vendor, price, current_price, moq, lead_time_days, priority,
       mrp_updated, last_checked, link, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const r of rows) {
        ins.run(uuid(), r.part_no, r.description, r.vendor, r.price, r.current_price ?? null,
          r.moq, r.lead_time_days, r.priority, r.mrp_updated ? 1 : 0, r.last_checked ?? null,
          r.link ?? null, r.notes);
        parts++;
      }
    })();
  }

  if (isEmpty(db, 'procurement_samples')) {
    const rows = read('procurement-samples.json') || [];
    const ins = db.prepare(`INSERT INTO procurement_samples
      (id, item_name, vendor, status, viable, qc_approved, quality_rank, demand_qty, price, moq,
       lead_time, notes, ordering_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const r of rows) {
        ins.run(uuid(), r.item_name, r.vendor, r.status, r.viable, r.qc_approved, r.quality_rank,
          r.demand_qty, r.price, r.moq, r.lead_time, r.notes, r.ordering_notes);
        samples++;
      }
    })();
  }

  // The live demand plan: one row per finished good, carrying the quantity his
  // sheet last had against it.
  if (isEmpty(db, 'procurement_demand')) {
    const rows = read('procurement-demand.json') || [];
    const ins = db.prepare('INSERT INTO procurement_demand (id, scenario_id, product_number, product_name, requested_qty) VALUES (?, NULL, ?, ?, ?)');
    db.transaction(() => {
      for (const r of rows) { ins.run(uuid(), r.product_number, r.product_name, r.requested_qty || 0); demand++; }
    })();
  }

  if (boms || parts || samples || demand) {
    console.log(`[seed] Procurement: ${boms} BOM lines, ${parts} parts, ${samples} sample quotes, ${demand} demand products`);
  }
}
