import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse the Monday.com Excel export and old CSV into a unified format for the /api/coa/import endpoint

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // ISO datetime from Excel: "2026-02-02 00:00:00"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split(' ')[0];

  // d/m/yyyy format from old CSV
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // m-dd/yyyy or other oddities like "3-29/2023"
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // m-dd-yyyy
  const mdy2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy2) {
    const [, m, d, y] = mdy2;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function parseInvoice(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[$,]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Parse Monday.com Excel (already converted to JSON by the caller) ──
function parseMondayData(rows) {
  return rows.map(r => ({
    item_number: String(r.item_number || '').trim(),
    item_description: String(r.item_description || '').trim(),
    lot_number: String(r.lot_number || '').trim(),
    product_expiration: parseDate(r.product_expiration),
    tests_requested: String(r.tests_requested || 'Unknown').trim(),
    status: String(r.status || '').trim(),
    lab_name: String(r.lab_name || 'CTLA').trim(),
    date_sent: parseDate(r.date_sent),
    tat_days: r.tat_days ? parseInt(r.tat_days) || null : null,
    expected_results_date: parseDate(r.expected_results_date),
    date_of_results: parseDate(r.date_of_results),
    requested_by: r.requested_by || null,
    retest_required: r.retest_required ? 1 : 0,
    notes: null,
    source_ref: `monday_${r.item_number}_${r.lot_number}`,
  }));
}

// ── Parse old CSV ──
function parseCSVData(rows) {
  return rows.map(r => ({
    item_number: String(r.item_number || '').trim(),
    item_description: String(r.item_description || '').trim(),
    lot_number: String(r.lot_number || '').trim(),
    product_expiration: null,
    tests_requested: String(r.tests_requested || 'Unknown').trim(),
    status: String(r.status || '').trim(),
    lab_name: String(r.lab_name || 'CTLA').trim(),
    date_sent: parseDate(r.date_sent),
    tat_days: r.tat_days ? parseInt(r.tat_days) || null : null,
    expected_results_date: null,
    date_of_results: parseDate(r.date_of_results),
    date_sent_to_customer: parseDate(r.date_sent_to_customer),
    requested_by: null,
    invoice_amount: parseInvoice(r.invoice_amount),
    retest_required: 0,
    notes: r.notes || null,
    source_ref: `csv_${r.item_number}_${r.lot_number}`,
  }));
}

// ── Read and parse Excel using openpyxl-compatible JSON ──
// Since we can't use xlsx in a script easily, we'll parse via a Python helper
// This script outputs the JSON payload for the import API

async function main() {
  const mondayFile = process.argv[2];
  const csvFile = process.argv[3];

  if (!mondayFile && !csvFile) {
    console.log('Usage: node scripts/import-coa-data.js [monday.json] [csv.json]');
    console.log('');
    console.log('First, convert sources to JSON:');
    console.log('  python3 scripts/excel-to-json.py <excel-file> > monday.json');
    console.log('  python3 scripts/csv-to-json.py <csv-file> > csv.json');
    console.log('');
    console.log('Then run: node scripts/import-coa-data.js monday.json csv.json');
    process.exit(1);
  }

  const allEntries = [];

  if (mondayFile) {
    const data = JSON.parse(readFileSync(mondayFile, 'utf-8'));
    const parsed = parseMondayData(data);
    console.error(`Parsed ${parsed.length} records from Monday.com export`);
    allEntries.push(...parsed);
  }

  if (csvFile) {
    const data = JSON.parse(readFileSync(csvFile, 'utf-8'));
    const parsed = parseCSVData(data);
    console.error(`Parsed ${parsed.length} records from old CSV`);
    allEntries.push(...parsed);
  }

  // Filter out entries without item_number
  const valid = allEntries.filter(e => e.item_number && e.item_description);
  console.error(`Total valid entries: ${valid.length}`);

  // Output as JSON for the import API
  console.log(JSON.stringify({ entries: valid, source: 'import' }, null, 2));
}

main().catch(console.error);
