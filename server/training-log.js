// Reading the plant's Training Log spreadsheet.
//
// It is not a table — it's a MATRIX, one sheet per period (October 2022 …
// March-April 2026), employees down the side and trainings across the top,
// and a cell means "this person did this training". Three and a half years of
// history that already answers the question a scanned filename can't: who took
// which training, and when.
//
// The cells are real-world messy, so the parser is deliberately forgiving and
// the pipeline shows you what it found before anything is written:
//
//   "2/7/2023 AB"  a date and the trainer's initials in one cell
//   44847          the same date as an Excel serial
//   "AB"           initials only — the date lives in the sheet's period
//   a URL          a video link, evidence rather than a completion
//   ""             not trained
//
// Each training occupies TWO columns — the training and an "Initial" column —
// but people filled either one, so both are read and merged.

import { parseXlsx, xlsxSheetNames, excelSerialToDate } from './tabular.js';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// Column headers that are not trainings.
const NOT_A_COURSE = /^(employee|initial|initials|trainer|trainer name|trainer signature|date|notes?|comments?)$/i;

/** Month names → the first of that month, so a sheet's period can date a cell. */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/**
 * A sheet named "April-July 2023" or "January-February 2026" → the START of
 * that period. Used only when a cell records a training with no date of its
 * own: the period is the most precise thing that is actually known, and
 * inventing a more exact date would be worse than an honest approximation.
 */
export function periodOf(sheetName) {
  const s = String(sheetName || '').toLowerCase();
  // "April2026" (no space) must read as 2026, but "20204" — a real typo in the
  // log's tab names — must NOT read as 2020. So: exactly four digits, with no
  // digit either side. Recovering the first is worth having; guessing the
  // second would put a wrong year on someone's training history.
  const year = (s.match(/(?<!\d)(20\d{2})(?!\d)/) || [])[1];
  if (!year) return null;
  const month = MONTHS.findIndex(m => s.includes(m.slice(0, 3)) && new RegExp(`\\b${m.slice(0, 3)}`).test(s));
  const mm = month >= 0 ? String(month + 1).padStart(2, '0') : '01';
  return `${year}-${mm}-01`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Pull a date out of a cell however it was written. */
export function cellDate(raw) {
  const v = clean(raw);
  if (!v) return null;
  if (ISO.test(v)) return v;
  // Excel serial. Bounded so a score or a quantity is never read as a date.
  const n = Number(v);
  if (Number.isFinite(n) && n >= 20000 && n <= 80000) {
    const d = excelSerialToDate(n);
    return d ? String(d).slice(0, 10) : null;
  }
  const m = v.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!m) return null;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  const mo = String(Number(m[1])).padStart(2, '0');
  const da = String(Number(m[2])).padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(da) < 1 || Number(da) > 31) return null;
  return `${yr}-${mo}-${da}`;
}

/** Whatever letters are left once the date is taken out — the trainer. */
export function cellInitials(raw) {
  const v = clean(raw);
  if (!v || /^https?:/i.test(v)) return null;
  const rest = v
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/[^A-Za-z. ]/g, ' ')
    .trim();
  if (!rest || rest.length > 24) return null;
  return rest;
}

const isLink = (raw) => /^https?:/i.test(clean(raw));

/**
 * One sheet → completion rows.
 *
 * Returns { period, courses, rows, links } where each row is
 * { employee, course, date, dated, trainer, source }.
 * `dated` says whether the date came from the cell (true) or from the sheet's
 * period (false) — the preview shows it, because "we assumed the month" is
 * something a person should see before it becomes a training record.
 */
export function parseSheet(rows, sheetName) {
  const period = periodOf(sheetName);
  const headerIdx = rows.findIndex(r => /^employees?$/i.test(clean(r?.[0])));
  if (headerIdx < 0) return { period, courses: [], rows: [], links: [] };
  const header = rows[headerIdx];

  // Walk the header: a column is either a new training or the "Initial"
  // column belonging to the one before it.
  const columns = [];
  let current = null;
  for (let c = 1; c < header.length; c++) {
    const name = clean(header[c]);
    if (!name) { if (current) current.cols.push(c); continue; }
    if (/^initials?$/i.test(name)) { if (current) current.cols.push(c); continue; }
    if (NOT_A_COURSE.test(name)) { current = null; continue; }
    current = { course: name, cols: [c] };
    columns.push(current);
  }

  const out = [];
  const links = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const employee = clean(rows[r]?.[0]);
    if (!employee || /^(employee|trainer|total|notes?)\b/i.test(employee)) continue;
    for (const col of columns) {
      const cells = col.cols.map(c => rows[r]?.[c]).filter(v => clean(v) !== '');
      if (!cells.length) continue;
      if (cells.every(isLink)) { links.push({ employee, course: col.course, url: clean(cells[0]) }); continue; }
      const date = cells.map(cellDate).find(Boolean) || null;
      const trainer = cells.map(cellInitials).find(Boolean) || null;
      // A cell with neither a date nor initials is a stray mark, not a record.
      if (!date && !trainer) continue;
      out.push({
        employee,
        course: col.course,
        date: date || period,
        dated: !!date,
        trainer,
        source: sheetName,
      });
    }
  }
  return { period, courses: columns.map(c => c.course), rows: out, links };
}

/** The whole workbook. Matrix/summary tabs are skipped — they restate the periods. */
export function parseTrainingLog(buffer) {
  const names = xlsxSheetNames(buffer);
  const sheets = [];
  const all = [];
  const links = [];
  const courses = new Set();
  names.forEach((name, i) => {
    if (/matrix|summary/i.test(name)) return;
    let rows;
    try { rows = parseXlsx(buffer, i); } catch { return; }
    const parsed = parseSheet(rows, name);
    if (!parsed.rows.length && !parsed.courses.length) return;
    sheets.push({ name, period: parsed.period, completions: parsed.rows.length, courses: parsed.courses.length });
    parsed.courses.forEach(c => courses.add(c));
    all.push(...parsed.rows);
    links.push(...parsed.links);
  });
  return { sheets, courses: [...courses].sort(), rows: all, links };
}
