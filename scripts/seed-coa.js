import { readFileSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../server/db.js';

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split(' ')[0];
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})[/-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  return null;
}

function parseInvoice(raw) {
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

const statusMap = { 'PASS': 'pass', 'FAIL': 'fail', 'HOLD': 'hold', 'RE-TEST': 're_test', 'N/A': 'na', 'NA': 'na' };

const mondayFile = process.argv[2];
const csvFile = process.argv[3];

if (!mondayFile && !csvFile) {
  console.log('Usage: node scripts/seed-coa.js <monday.json> [csv.json]');
  process.exit(1);
}

const db = getDb();

// Ensure CTLA lab exists
let ctlaLab = db.prepare("SELECT id FROM coa_labs WHERE name = 'CTLA'").get();
if (!ctlaLab) {
  const labId = uuid();
  db.prepare("INSERT INTO coa_labs (id, name) VALUES (?, 'CTLA')").run(labId);
  ctlaLab = { id: labId };
  console.log('Created CTLA lab');
}

const insert = db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_sent, tat_days, expected_results_date, date_of_results, date_sent_to_customer, requested_by, invoice_amount, retest_required, notes, source, source_ref, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const seen = new Set();
let imported = 0;
let skipped = 0;
let dupes = 0;

const tx = db.transaction(() => {
  // Monday.com data first (newer, more complete)
  if (mondayFile) {
    const data = JSON.parse(readFileSync(mondayFile, 'utf-8'));
    for (const r of data) {
      const itemNum = String(r.item_number || '').trim();
      const desc = String(r.item_description || '').trim();
      const lot = String(r.lot_number || '').trim();
      if (!itemNum || !desc) { skipped++; continue; }

      const key = `${itemNum}||${lot}`;
      if (seen.has(key)) { dupes++; continue; }
      seen.add(key);

      const status = statusMap[String(r.status || '').trim().toUpperCase()] || 'pending';
      const labName = String(r.lab_name || 'CTLA').trim();

      insert.run(
        uuid(), itemNum, desc, lot,
        r.product_expiration || null,
        String(r.tests_requested || 'Unknown').trim(),
        status,
        labName === 'CTLA' ? ctlaLab.id : null,
        labName,
        r.date_sent || null,
        r.tat_days || null,
        r.expected_results_date || null,
        r.date_of_results || null,
        null,
        r.requested_by || null,
        null,
        r.retest_required ? 1 : 0,
        null,
        'import_monday',
        `monday_${itemNum}_${lot}`,
        'system'
      );
      imported++;
    }
    console.log(`Monday.com: ${imported} imported, ${skipped} skipped (missing data), ${dupes} dupes`);
  }

  // Old CSV data (check for duplicates against Monday data)
  if (csvFile) {
    const csvImported = { count: 0 };
    const csvSkipped = { count: 0 };
    const csvDupes = { count: 0 };

    const data = JSON.parse(readFileSync(csvFile, 'utf-8'));
    for (const r of data) {
      const itemNum = String(r.item_number || '').trim();
      const desc = String(r.item_description || '').trim();
      const lot = String(r.lot_number || '').trim();
      if (!itemNum || !desc) { csvSkipped.count++; continue; }

      const key = `${itemNum}||${lot}`;
      if (seen.has(key)) { csvDupes.count++; continue; }
      seen.add(key);

      const status = statusMap[String(r.status || '').trim().toUpperCase()] || 'pending';
      const labName = String(r.lab_name || 'CTLA').trim();

      insert.run(
        uuid(), itemNum, desc, lot,
        null,
        String(r.tests_requested || 'Unknown').trim(),
        status,
        labName === 'CTLA' ? ctlaLab.id : null,
        labName,
        parseDate(r.date_sent),
        r.tat_days || null,
        null,
        parseDate(r.date_of_results),
        parseDate(r.date_sent_to_customer),
        null,
        parseInvoice(r.invoice_amount),
        0,
        r.notes || null,
        'import_csv',
        `csv_${itemNum}_${lot}`,
        'system'
      );
      csvImported.count++;
    }
    console.log(`Old CSV: ${csvImported.count} imported, ${csvSkipped.count} skipped, ${csvDupes.count} dupes (already in Monday data)`);
  }
});

tx();
console.log(`\nTotal: ${imported + (csvFile ? 0 : 0)} records imported to coa_requests`);
const total = db.prepare('SELECT COUNT(*) as c FROM coa_requests').get();
console.log(`Database now has ${total.c} COA requests`);
