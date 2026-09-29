// Jake's Current Suppliers tracker as a CSV, rebuilt from the frozen fixture.
//
// verify-suppliers.mjs used to read the .xlsx out of one session's uploads
// folder — a path that existed on exactly one machine for exactly one
// conversation, so the check went red the day that session ended and stayed
// red for anyone else. The rows are already frozen in
// scripts/fixtures/supplier-tracker.json (the reconciliation checks read them);
// the import endpoint accepts CSV as readily as XLSX (readImportFiles matches
// on the extension), so this hands it the same six columns, quoted properly
// — the Contact cell carries commas.
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'supplier-tracker.json');
const COLUMNS = ['Vendor', 'Actively Using', 'Questionnaire Requested', 'Questionnaire Completed', 'Contact', 'Notes'];

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function trackerRows() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')).rows;
}

export function trackerCsv() {
  const rows = trackerRows();
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Writes the CSV to a temp file and returns its path (for a browser file input). */
export function trackerCsvFile() {
  const dir = mkdtempSync(join(tmpdir(), 'supplier-tracker-'));
  const path = join(dir, 'Current Suppliers.csv');
  writeFileSync(path, trackerCsv());
  return path;
}
