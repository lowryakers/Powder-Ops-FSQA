// The paper Chemical Dilution Logbook, transcribed.
//
// Seven scanned copies of FORM 106-01 V3 covering 25 Nov 2025 – 30 Jun 2026:
// 14 pages, 254 checks over 126 days. The scans carry no text layer — they are
// photographs of handwriting — so this was read page by page rather than
// parsed, and the transcription rules matter as much as the data.
//
// THE QA VERIFICATION DATE IS THE RECORD DATE, not the operator's Date/Initial
// column. That column repeats: "02-10-26" appears on eight consecutive rows
// whose QA dates run 2/10 to 2/13, because the operator dates the sheet rather
// than the row. Keying on it would file eight checks on one day and leave three
// days looking unchecked.
//
// NO ppm NUMBER IS EVER RECORDED. The "Result ppm" column is a printed
// *Pass / Fail* that gets circled — across all fourteen pages not one figure
// was written. So `concentration` carries the TARGET the check was made
// against, which is what the paper actually attests, and never an invented
// reading. (The live task was reverted to match; see shared/dilution-forms.js.)
//
// ONLY TWO CHEMICALS APPEAR. The form's header names four, but the plant logs
// Sani-512 and chlorine, twice a day, and Dawn and Simple Green appear nowhere
// in three years of sheets.
//
// NOTHING IS INVENTED AND NOTHING IS TIDIED. Where the sheet contradicts
// itself — a QA date struck through and rewritten, a QA date that precedes the
// operator's, a page comment saying a day was not worked when that day carries
// two verified rows — the row is filed as written and the discrepancy travels
// on the record in `notes`. A transcription that silently resolves the source's
// own disagreements is no longer a transcription.
//
// Entered as LATE ENTRIES, deliberately. These were performed up to eight
// months ago and are being typed in now; `entered_late` plus the reason is what
// makes that visible on every row, so none of them can be mistaken for a record
// filed on the day. Same rule as any other back-dated clean.

import { getDb } from './db.js';
import { recordGroupFor } from './qa-records.js';

export const PAGES = [
  {
    file: '11.25.25_to_01.15.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2025-12-12',
    comment: 'N/A',
    note: '* MS 12/05/25 MS',
    rows: [
    ['sanitizer', '2025-11-24', '2025-11-25', 'MJ'],
    ['chlorine', '2025-11-24', '2025-11-25', 'MJ'],
    ['sanitizer', '2025-11-24', '2025-11-26', 'MJ'],
    ['chlorine', '2025-11-24', '2025-11-26', 'MJ'],
    ['sanitizer', '2025-12-01', '2025-12-01', 'JG'],
    ['chlorine', '2025-12-01', '2025-12-01', 'JG'],
    ['sanitizer', '2025-12-01', '2025-12-02', 'JG'],
    ['chlorine', '2025-12-01', '2025-12-02', 'JG'],
    ['sanitizer', '2025-12-03', '2025-12-03', 'JG'],
    ['chlorine', '2025-12-03', '2025-12-03', 'JG'],
    ['sanitizer', '2025-12-03', '2025-12-04', 'MS'],
    ['chlorine', '2025-12-03', '2025-12-04', 'MS'],
    ['sanitizer', '2025-12-03', '2025-12-05', 'MS'],
    ['chlorine', '2025-12-03', '2025-12-05', 'MS'],
    ['sanitizer', '2025-12-08', '2025-12-08', 'MS'],
    ['chlorine', '2025-12-08', '2025-12-08', 'MS', 'QA date cell unclear on the scan; read as 12/08 because its sanitizer pair is 12/08 and the two are logged together on all 126 other days'],
    ['sanitizer', '2025-12-08', '2025-12-09', 'MS'],
    ['chlorine', '2025-12-08', '2025-12-09', 'MS'],
    ['sanitizer', '2025-12-08', '2025-12-10', 'MS'],
    ['chlorine', '2025-12-08', '2025-12-10', 'MS'],
    ['sanitizer', '2025-12-11', '2025-12-11', 'MS'],
    ['chlorine', '2025-12-11', '2025-12-11', 'MS'],
    ['sanitizer', '2025-12-11', '2025-12-12', 'MS'],
    ['chlorine', '2025-12-11', '2025-12-12', 'MS'],
    ],
  },
  {
    file: '11.25.25_to_01.15.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-01-15',
    comment: 'N/A',
    note: 'X 01-08-26 ZN (one sanitizer row struck through)',
    rows: [
    ['sanitizer', '2025-12-11', '2025-12-15', 'MJ'],
    ['chlorine', '2025-12-11', '2025-12-15', 'MJ'],
    ['sanitizer', '2025-12-11', '2025-12-16', 'JG'],
    ['chlorine', '2025-12-11', '2025-12-16', 'JG'],
    ['sanitizer', '2025-12-11', '2025-12-17', 'MS'],
    ['chlorine', '2025-12-11', '2025-12-17', 'MS'],
    ['sanitizer', '2026-01-05', '2026-01-05', 'MS'],
    ['chlorine', '2026-01-05', '2026-01-05', 'MS'],
    ['sanitizer', '2026-01-05', '2026-01-06', 'MS'],
    ['chlorine', '2026-01-05', '2026-01-06', 'MS'],
    ['sanitizer', '2026-01-05', '2026-01-07', 'MS'],
    ['chlorine', '2026-01-05', '2026-01-07', 'MS'],
    ['chlorine', '2026-01-05', '2026-01-08', 'MS'],
    ['sanitizer', '2026-01-05', '2026-01-08', 'MS'],
    ['sanitizer', '2026-01-08', '2026-01-09', 'MS', 'struck through on the sheet, footnoted X 01-08-26 ZN'],
    ['chlorine', '2026-01-08', '2026-01-09', 'MS'],
    ['sanitizer', '2026-01-08', '2026-01-12', 'MS'],
    ['chlorine', '2026-01-08', '2026-01-12', 'MS'],
    ['sanitizer', '2026-01-08', '2026-01-13', 'MS'],
    ['chlorine', '2026-01-08', '2026-01-13', 'MS'],
    ['sanitizer', '2026-01-14', '2026-01-14', 'MS'],
    ['chlorine', '2026-01-14', '2026-01-14', 'MS'],
    ['sanitizer', '2026-01-14', '2026-01-15', 'MS'],
    ['chlorine', '2026-01-14', '2026-01-15', 'MS'],
    ],
  },
  {
    file: '1.16.26_to_2.19.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-02-02',
    comment: 'N/A',
    note: '* 01-19-26 ZN',
    rows: [
    ['sanitizer', '2026-01-14', '2026-01-16', 'MS'],
    ['chlorine', '2026-01-14', '2026-01-16', 'MS'],
    ['sanitizer', '2026-01-19', '2026-01-19', 'MS'],
    ['chlorine', '2026-01-19', '2026-01-19', 'MS'],
    ['sanitizer', '2026-01-19', '2026-01-20', 'MS'],
    ['chlorine', '2026-01-19', '2026-01-20', 'MS', 'operator cell overwritten, footnoted * 01-19-26 ZN'],
    ['sanitizer', '2026-01-21', '2026-01-21', 'MS'],
    ['chlorine', '2026-01-21', '2026-01-21', 'MS'],
    ['sanitizer', '2026-01-21', '2026-01-22', 'MS'],
    ['chlorine', '2026-01-21', '2026-01-22', 'MS'],
    ['sanitizer', '2026-01-21', '2026-01-23', 'MS'],
    ['chlorine', '2026-01-21', '2026-01-23', 'MS'],
    ['sanitizer', '2026-01-21', '2026-01-26', 'MS'],
    ['chlorine', '2026-01-21', '2026-01-26', 'MS'],
    ['sanitizer', '2026-01-27', '2026-01-27', 'MS'],
    ['chlorine', '2026-01-27', '2026-01-27', 'MS'],
    ['sanitizer', '2026-01-27', '2026-01-28', 'MS'],
    ['chlorine', '2026-01-27', '2026-01-28', 'MS'],
    ['sanitizer', '2026-01-27', '2026-01-29', 'MS'],
    ['chlorine', '2026-01-27', '2026-01-29', 'MS'],
    ['sanitizer', '2026-01-27', '2026-01-30', 'MS'],
    ['chlorine', '2026-01-27', '2026-01-30', 'MS'],
    ['sanitizer', '2026-02-02', '2026-02-02', 'MS'],
    ['chlorine', '2026-02-02', '2026-02-02', 'MS'],
    ],
  },
  {
    file: '1.16.26_to_2.19.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-02-19',
    comment: '(1) MS 2/10/26  (2) MS 2/19/26',
    note: 'eight QA dates struck through and rewritten in the margin',
    rows: [
    ['sanitizer', '2026-02-02', '2026-02-03', 'MS'],
    ['chlorine', '2026-02-02', '2026-02-03', 'MS'],
    ['sanitizer', '2026-02-02', '2026-02-04', 'MS'],
    ['chlorine', '2026-02-02', '2026-02-04', 'MS'],
    ['sanitizer', '2026-02-05', '2026-02-05', 'MS'],
    ['chlorine', '2026-02-05', '2026-02-05', 'MS'],
    ['sanitizer', '2026-02-05', '2026-02-06', 'MS'],
    ['chlorine', '2026-02-05', '2026-02-06', 'MS'],
    ['sanitizer', '2026-02-05', '2026-02-09', 'MS'],
    ['chlorine', '2026-02-05', '2026-02-09', 'MS'],
    ['sanitizer', '2026-02-10', '2026-02-10', 'MS', 'QA date struck and rewritten 2/10/26'],
    ['chlorine', '2026-02-10', '2026-02-10', 'MS'],
    ['sanitizer', '2026-02-10', '2026-02-11', 'MS', 'QA date struck (was 2/10/26), corrected to 2/11/26'],
    ['chlorine', '2026-02-10', '2026-02-11', 'MS', 'QA date struck (was 2/10/26), corrected to 2/11/26'],
    ['sanitizer', '2026-02-10', '2026-02-12', 'MS', 'QA date struck (was 2/10/26), corrected to 2/12/26'],
    ['chlorine', '2026-02-10', '2026-02-12', 'MS', 'QA date struck (was 2/10/26), corrected to 2/12/26'],
    ['sanitizer', '2026-02-10', '2026-02-13', 'MS', 'QA date struck (was 2/10/26), corrected to 2/13/26'],
    ['chlorine', '2026-02-10', '2026-02-13', 'MS', 'QA date struck (was 2/10/26), corrected to 2/13/26'],
    ['sanitizer', '2026-02-10', '2026-02-17', 'MS'],
    ['chlorine', '2026-02-10', '2026-02-17', 'MS'],
    ['sanitizer', '2026-02-10', '2026-02-18', 'MS'],
    ['chlorine', '2026-02-10', '2026-02-18', 'MS'],
    ['sanitizer', '2026-02-19', '2026-02-19', 'MS'],
    ['chlorine', '2026-02-19', '2026-02-19', 'MS'],
    ],
  },
  {
    file: '2.20.26_to_2.27.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-02-27',
    comment: 'N/A',
    note: 'unused rows struck through and voided: N/A 02/27/26 MS',
    rows: [
    ['sanitizer', '2026-02-19', '2026-02-20', 'MJ'],
    ['chlorine', '2026-02-19', '2026-02-20', 'MS'],
    ['sanitizer', '2026-02-19', '2026-02-23', 'MJ'],
    ['chlorine', '2026-02-19', '2026-02-23', 'MJ'],
    ['sanitizer', '2026-02-19', '2026-02-24', 'MS'],
    ['chlorine', '2026-02-19', '2026-02-24', 'MS'],
    ['sanitizer', '2026-02-25', '2026-02-25', 'MS', 'new test strip lot 215724 EX06/26 from here'],
    ['chlorine', '2026-02-25', '2026-02-25', 'MS'],
    ['sanitizer', '2026-02-25', '2026-02-26', 'MS'],
    ['chlorine', '2026-02-25', '2026-02-26', 'MS'],
    ['sanitizer', '2026-02-25', '2026-02-27', 'MS'],
    ['chlorine', '2026-02-25', '2026-02-27', 'MS'],
    ],
  },
  {
    file: '2.20.26_to_2.27.26.pdf', page: 2,
    reviewed_by: null, reviewed_on: null,
    comment: 'whole page struck through and voided: N/A 2/27/26 MS',
    rows: [

    ],
  },
  {
    file: '3.02.26_3.31.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-03-31',
    comment: 'N/A',
    note: 'last row voided N/A 3/31/26',
    rows: [
    ['sanitizer', '2026-03-02', '2026-03-02', 'MS'],
    ['chlorine', '2026-03-02', '2026-03-02', 'MS'],
    ['sanitizer', '2026-03-02', '2026-03-03', 'MS'],
    ['chlorine', '2026-03-02', '2026-03-03', 'MS'],
    ['sanitizer', '2026-03-04', '2026-03-04', 'MS'],
    ['chlorine', '2026-03-04', '2026-03-04', 'MJ'],
    ['sanitizer', '2026-03-04', '2026-03-05', 'MS'],
    ['chlorine', '2026-03-04', '2026-03-05', 'MS'],
    ['sanitizer', '2026-03-04', '2026-03-06', 'MJ'],
    ['chlorine', '2026-03-04', '2026-03-06', 'MJ'],
    ['sanitizer', '2026-03-09', '2026-03-09', 'MS'],
    ['chlorine', '2026-03-09', '2026-03-09', 'MJ'],
    ['sanitizer', '2026-03-09', '2026-03-10', 'MS'],
    ['chlorine', '2026-03-09', '2026-03-10', 'MS'],
    ['sanitizer', '2026-03-09', '2026-03-11', 'MS'],
    ['chlorine', '2026-03-09', '2026-03-11', 'MS'],
    ['sanitizer', '2026-03-12', '2026-03-12', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-12', 'MS'],
    ['sanitizer', '2026-03-12', '2026-03-13', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-13', 'MS'],
    ['sanitizer', '2026-03-12', '2026-03-16', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-16', 'MJ'],
    ['sanitizer', '2026-03-12', '2026-03-17', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-17', 'MS'],
    ],
  },
  {
    file: '3.02.26_3.31.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-03-31',
    comment: 'N/A',
    note: 'unused rows voided N/A 3/31/26 MS',
    rows: [
    ['sanitizer', '2026-03-12', '2026-03-18', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-18', 'MS'],
    ['sanitizer', '2026-03-12', '2026-03-19', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-19', 'MS'],
    ['sanitizer', '2026-03-12', '2026-03-20', 'MS'],
    ['chlorine', '2026-03-12', '2026-03-20', 'MS'],
    ['sanitizer', '2026-03-23', '2026-03-23', 'MS'],
    ['chlorine', '2026-03-23', '2026-03-23', 'MS'],
    ['sanitizer', '2026-03-23', '2026-03-24', 'MS'],
    ['chlorine', '2026-03-23', '2026-03-24', 'MS'],
    ['sanitizer', '2026-03-23', '2026-03-25', 'MS'],
    ['chlorine', '2026-03-23', '2026-03-25', 'MS'],
    ['sanitizer', '2026-03-23', '2026-03-26', 'MS'],
    ['chlorine', '2026-03-23', '2026-03-26', 'MS'],
    ['sanitizer', '2026-03-23', '2026-03-27', 'MS'],
    ['chlorine', '2026-03-23', '2026-03-27', 'MS'],
    ['sanitizer', '2026-03-30', '2026-03-31', 'MS'],
    ['chlorine', '2026-03-31', '2026-03-31', 'MS'],
    ],
  },
  {
    file: '04.14.26_to_04.27.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-04-29',
    comment: 'N/A',
    rows: [
    ['sanitizer', '2026-04-14', '2026-04-14', 'MS', 'lot cell corrected on the sheet'],
    ['chlorine', '2026-04-14', '2026-04-14', 'MS'],
    ['sanitizer', '2026-04-14', '2026-04-15', 'MS', 'QA date unclear — reads 4.19.26 but sits between 4.14 and 4.15'],
    ['chlorine', '2026-04-14', '2026-04-15', 'MJ'],
    ['sanitizer', '2026-04-14', '2026-04-16', 'MS'],
    ['chlorine', '2026-04-14', '2026-04-16', 'MJ'],
    ['sanitizer', '2026-04-14', '2026-04-17', 'MS'],
    ['chlorine', '2026-04-14', '2026-04-17', 'MS'],
    ['sanitizer', '2026-04-20', '2026-04-20', 'MS'],
    ['chlorine', '2026-04-20', '2026-04-20', 'MS'],
    ['sanitizer', '2026-04-21', '2026-04-21', 'MS'],
    ['chlorine', '2026-04-21', '2026-04-21', 'MS'],
    ['sanitizer', '2026-04-21', '2026-04-22', 'MS'],
    ['chlorine', '2026-04-21', '2026-04-22', 'MJ'],
    ['sanitizer', '2026-04-21', '2026-04-23', 'MS'],
    ['chlorine', '2026-04-21', '2026-04-23', 'MJ'],
    ['sanitizer', '2026-04-21', '2026-04-24', 'MS'],
    ['chlorine', '2026-04-21', '2026-04-24', 'MS'],
    ['sanitizer', '2026-04-27', '2026-04-27', 'MS'],
    ['chlorine', '2026-04-27', '2026-04-27', 'MS'],
    ['sanitizer', '2026-04-27', '2026-04-28', 'MJ'],
    ['chlorine', '2026-04-27', '2026-04-28', 'MS'],
    ['sanitizer', '2026-04-28', '2026-04-29', 'MS'],
    ['chlorine', '2026-04-28', '2026-04-29', 'MS'],
    ],
  },
  {
    file: '04.14.26_to_04.27.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-05-01',
    comment: 'N/A',
    note: 'unused rows voided N/A 5/1/26 MS',
    rows: [
    ['sanitizer', '2026-04-27', '2026-04-30', 'MS'],
    ['chlorine', '2026-04-27', '2026-04-30', 'MS'],
    ['sanitizer', '2026-04-27', '2026-05-01', 'MJ', 'also written as the first row of the next sheet (5.1.26 p1) — one check recorded on two pages'],
    ['chlorine', '2026-04-27', '2026-05-01', 'MS', 'also written as the first row of the next sheet (5.1.26 p1) — one check recorded on two pages'],
    ],
  },
  {
    file: '5.1.26_to_5.29.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-05-18',
    comment: 'N/A',
    note: '* 05-04-26 ZN; margin notes (1) MS 5/15/26 (2) MS; last row voided N/A MS 5/29/26',
    rows: [
    ['sanitizer', '2026-04-27', '2026-05-01', 'MS'],
    ['chlorine', '2026-04-27', '2026-05-01', 'MS'],
    ['sanitizer', '2026-05-04', '2026-05-04', 'MS'],
    ['chlorine', '2026-05-04', '2026-05-04', 'MS'],
    ['sanitizer', '2026-05-04', '2026-05-05', 'MS', 'operator cell overwritten, footnoted * 05-04-26 ZN'],
    ['chlorine', '2026-05-04', '2026-05-05', 'MS'],
    ['sanitizer', '2026-05-04', '2026-05-06', 'MS'],
    ['chlorine', '2026-05-04', '2026-05-06', 'MS'],
    ['sanitizer', '2026-05-04', '2026-05-07', 'MS'],
    ['chlorine', '2026-05-04', '2026-05-07', 'MS'],
    ['sanitizer', '2026-05-11', '2026-05-08', 'MS', 'QA date precedes the operator date on the sheet'],
    ['chlorine', '2026-05-11', '2026-05-08', 'MS', 'QA date precedes the operator date on the sheet'],
    ['sanitizer', '2026-05-11', '2026-05-11', 'MS'],
    ['chlorine', '2026-05-11', '2026-05-11', 'MS'],
    ['sanitizer', '2026-05-11', '2026-05-12', 'MS'],
    ['chlorine', '2026-05-11', '2026-05-12', 'MS'],
    ['sanitizer', '2026-05-11', '2026-05-13', 'MS'],
    ['chlorine', '2026-05-11', '2026-05-13', 'MS'],
    ['sanitizer', '2026-05-11', '2026-05-14', 'MS'],
    ['chlorine', '2026-05-11', '2026-05-14', 'MS'],
    ['sanitizer', '2026-05-11', '2026-05-15', 'MS', 'QA date overwritten, margin note (1) MS 5/15/26'],
    ['chlorine', '2026-05-11', '2026-05-15', 'MS', 'margin note (2) MS'],
    ['sanitizer', '2026-05-18', '2026-05-18', 'MS'],
    ['chlorine', '2026-05-18', '2026-05-18', 'MS'],
    ],
  },
  {
    file: '5.1.26_to_5.29.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-05-29',
    comment: 'N/A',
    note: 'unused rows voided N/A 05/29/26 MS',
    rows: [
    ['sanitizer', '2026-05-18', '2026-05-19', 'MS'],
    ['chlorine', '2026-05-18', '2026-05-19', 'MS'],
    ['sanitizer', '2026-05-18', '2026-05-20', 'MS'],
    ['chlorine', '2026-05-18', '2026-05-20', 'MS'],
    ['sanitizer', '2026-05-18', '2026-05-21', 'MS'],
    ['chlorine', '2026-05-18', '2026-05-21', 'MS'],
    ['sanitizer', '2026-05-18', '2026-05-22', 'MS'],
    ['chlorine', '2026-05-18', '2026-05-22', 'MS'],
    ['sanitizer', '2026-05-26', '2026-05-26', 'MS'],
    ['chlorine', '2026-05-26', '2026-05-26', 'MS'],
    ['sanitizer', '2026-05-26', '2026-05-27', 'MS'],
    ['chlorine', '2026-05-26', '2026-05-27', 'MS'],
    ['sanitizer', '2026-05-26', '2026-05-28', 'MS'],
    ['chlorine', '2026-05-26', '2026-05-28', 'MS'],
    ['sanitizer', '2026-05-26', '2026-05-29', 'MS'],
    ['chlorine', '2026-05-26', '2026-05-29', 'MS'],
    ],
  },
  {
    file: '6.1.26_to_6.30.26.pdf', page: 1,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-06-17',
    comment: '06-12-26 no se trabajo (not worked)',
    rows: [
    ['sanitizer', '2026-06-01', '2026-06-01', 'MS'],
    ['chlorine', '2026-06-01', '2026-06-01', 'MS'],
    ['sanitizer', '2026-06-01', '2026-06-02', 'MS'],
    ['chlorine', '2026-06-01', '2026-06-02', 'MS'],
    ['sanitizer', '2026-06-01', '2026-06-03', 'MS'],
    ['chlorine', '2026-06-01', '2026-06-03', 'MS'],
    ['sanitizer', '2026-06-01', '2026-06-04', 'MS'],
    ['chlorine', '2026-06-01', '2026-06-04', 'MS'],
    ['sanitizer', '2026-06-01', '2026-06-05', 'MS'],
    ['chlorine', '2026-06-01', '2026-06-05', 'MS'],
    ['sanitizer', '2026-06-08', '2026-06-08', 'MS', 'new test strip lot 209726 EXP 1/2028 from here'],
    ['chlorine', '2026-06-08', '2026-06-08', 'MS'],
    ['sanitizer', '2026-06-08', '2026-06-09', 'MS'],
    ['chlorine', '2026-06-08', '2026-06-09', 'MS'],
    ['sanitizer', '2026-06-08', '2026-06-10', 'MJ'],
    ['chlorine', '2026-06-08', '2026-06-10', 'MJ'],
    ['sanitizer', '2026-06-11', '2026-06-11', 'MJ'],
    ['chlorine', '2026-06-11', '2026-06-11', 'MJ'],
    ['sanitizer', '2026-06-15', '2026-06-15', 'MJ'],
    ['chlorine', '2026-06-15', '2026-06-15', 'MS'],
    ['sanitizer', '2026-06-15', '2026-06-16', 'MJ'],
    ['chlorine', '2026-06-15', '2026-06-16', 'MJ'],
    ['sanitizer', '2026-06-15', '2026-06-17', 'MJ'],
    ['chlorine', '2026-06-15', '2026-06-17', 'MJ'],
    ],
  },
  {
    file: '6.1.26_to_6.30.26.pdf', page: 2,
    reviewed_by: 'Maria Fernandez', reviewed_on: '2026-07-01',
    comment: '06-18-26 no se trabajo / 06/24 & 06/25 no se trabajo ZN',
    note: 'unused rows voided N/A 07/01/26 MS. NOTE: the comment says 06/24 was not worked, but two rows are verified 06/24/26.',
    rows: [
    ['sanitizer', '2026-06-15', '2026-06-18', 'MS'],
    ['chlorine', '2026-06-15', '2026-06-18', 'MS'],
    ['sanitizer', '2026-06-22', '2026-06-22', 'MJ'],
    ['chlorine', '2026-06-22', '2026-06-22', 'MS'],
    ['sanitizer', '2026-06-23', '2026-06-23', 'MS'],
    ['chlorine', '2026-06-23', '2026-06-23', 'MJ'],
    ['sanitizer', '2026-06-24', '2026-06-24', 'MJ', 'the page comment says 06/24 was not worked'],
    ['chlorine', '2026-06-24', '2026-06-24', 'MS', 'the page comment says 06/24 was not worked'],
    ['sanitizer', '2026-06-29', '2026-06-29', 'MJ'],
    ['chlorine', '2026-06-29', '2026-06-29', 'MJ'],
    ['sanitizer', '2026-06-30', '2026-06-30', 'MS'],
    ['chlorine', '2026-06-30', '2026-06-30', 'MS'],
    ],
  },
];

// What the two logged chemicals are called, and what the form asks of each.
// The names match the approved-chemical registry so a record ties back to it.
const CHEMICALS = {
  sanitizer: { name: 'Sani-512 Sanitizer', target: '200-250 ppm' },
  chlorine: { name: 'Chlorine (Cloro)', target: '100-200 ppm' },
};

const AREA = 'Chemical Verification';
const OPERATOR = 'ZN';        // the initials on every Date/Initial cell
const FORM = 'FORM 106-01 V3';

// Deterministic id = idempotency with no extra column. A chemical is checked
// once a day, so the day and the chemical are the natural key; re-running the
// seeder inserts nothing rather than doubling seven months of records.
const idFor = (date, chem) => `dil-${date}-${chem}`;

export function seedDilutionLog(db = getDb()) {
  let created = 0, skipped = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sanitation_records
      (id, area, type, performed_by, performed_at, entered_at, entered_late, late_entry_reason,
       chemicals_used, concentration, result, verified_by, verified_at, record_group, notes)
    VALUES (?, ?, 'pre_op', ?, ?, datetime('now'), 1, ?, ?, ?, 'pass', ?, ?, ?, ?)`);

  const group = recordGroupFor(AREA);
  const tx = db.transaction(() => {
    for (const page of PAGES) {
      const source = `${page.file} page ${page.page}`;
      for (const [chem, opDate, qaDate, qaBy, rowNote] of page.rows) {
        const c = CHEMICALS[chem];
        if (!c) continue;
        const notes = [
          `${FORM}. Target ${c.target}; the form records Pass/Fail only, no ppm figure.`,
          `Performed ${opDate} by ${OPERATOR} (the sheet's Date/Initial); QA verified ${qaDate} by ${qaBy}.`,
          page.reviewed_by ? `Page reviewed by ${page.reviewed_by} on ${page.reviewed_on}.` : null,
          page.comment && page.comment !== 'N/A' ? `Page comment: ${page.comment}` : null,
          rowNote ? `Note: ${rowNote}` : null,
          `Transcribed from ${source}.`,
        ].filter(Boolean).join(' ');

        const info = insert.run(
          idFor(qaDate, chem), AREA, OPERATOR,
          // Noon, so a date-only value can never read as the previous evening
          // west of Greenwich — the same reason POST /sanitation does it.
          `${qaDate} 12:00:00`,
          `Transcribed from the paper Chemical Dilution Logbook (${source}).`,
          c.name, c.target, qaBy, `${qaDate} 12:00:00`, group, notes,
        );
        if (info.changes) created++; else skipped++;
      }
    }
  });
  tx();

  if (created > 0) {
    console.log(`[seed] Chemical Dilution Logbook: ${created} checks transcribed from ${PAGES.length} scanned pages`);
  }
  return { created, skipped, pages: PAGES.length, rows: PAGES.reduce((n, p) => n + p.rows.length, 0) };
}
