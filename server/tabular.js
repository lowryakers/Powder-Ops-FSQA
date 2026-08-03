// Reads CSV / TSV / XLSX into plain rows, with no new dependencies.
//
// Everything the team wants to import from — Monday, Airtable, Google Drive,
// Slack, a desktop spreadsheet — exports one of these three. XLSX is a ZIP of
// XML, and adm-zip is already here for the Slack importer, so the whole format
// story is covered without pulling in a parser library. Fewer dependencies is
// worth a page of code in an app that has to stay auditable.

import AdmZip from 'adm-zip';

/* ── CSV / TSV ───────────────────────────────────────────────────────────── */

// RFC 4180: quoted fields may contain the delimiter, newlines, and "" escapes.
// Written as a character scan rather than a regex/split so a quoted address or
// a note with a comma in it doesn't silently shift every later column.
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, ''); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Pick the delimiter by counting candidates in the header line — a TSV renamed
// .csv is common enough to be worth handling silently.
function sniffDelimiter(text) {
  const head = text.slice(0, 4000).split('\n')[0] || '';
  const counts = [[',', 0], ['\t', 0], [';', 0]].map(([d]) => [d, head.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/* ── XLSX ────────────────────────────────────────────────────────────────── */

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

// Excel stores repeated strings once in sharedStrings.xml and references them
// by index from the cells.
function sharedStrings(zip) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = entry.getData().toString('utf8');
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(si => {
    // A styled cell splits its text across several <t> runs; join them all.
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return decodeXml(parts.map(p => p.replace(/<[^>]+>/g, '')).join(''));
  });
}

// Excel dates are serial numbers from 1899-12-30. Only applied when the caller
// asks for a date, so a genuine quantity like 45.36 is never mangled.
export function excelSerialToDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const colIndex = (ref) => {
  const letters = (ref.match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Sheet names in workbook order, so a caller can import a specific tab (the
// training log is one sheet per period, and the period is the only place the
// year comes from).
export function xlsxSheetNames(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const wb = zip.getEntry('xl/workbook.xml');
    if (!wb) return [];
    const xml = wb.getData().toString('utf8');
    return [...xml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(m => decodeXml(m[1]));
  } catch { return []; }
}

export function parseXlsx(buffer, sheetIndex = 0) {
  const zip = new AdmZip(buffer);
  const strings = sharedStrings(zip);
  const sheet = zip.getEntry(`xl/worksheets/sheet${sheetIndex + 1}.xml`);
  if (!sheet) return [];
  const xml = sheet.getData().toString('utf8');
  const rows = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const cells = rowXml.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || [];
    const out = [];
    for (const cell of cells) {
      const ref = (cell.match(/r="([A-Z]+\d+)"/) || [])[1];
      const idx = ref ? colIndex(ref) : out.length;
      const type = (cell.match(/t="([^"]+)"/) || [])[1];
      let value;
      if (type === 's') {
        const i = Number((cell.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        value = strings[i] ?? '';
      } else if (type === 'inlineStr') {
        value = decodeXml((cell.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      } else {
        value = decodeXml((cell.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      }
      while (out.length < idx) out.push('');
      out[idx] = value;
    }
    rows.push(out);
  }
  return rows;
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

// Returns { headers, rows } where rows are objects keyed by header. Leading
// title/banner lines above the real header (Monday exports have them) are
// skipped by finding the first row that looks like a header: several non-empty
// cells, mostly distinct.
export function readTable(buffer, filename = '') {
  const isXlsx = /\.xlsx$/i.test(filename) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  let grid;
  if (isXlsx) {
    grid = parseXlsx(buffer);
  } else {
    const text = buffer.toString('utf8');
    grid = parseDelimited(text, sniffDelimiter(text));
  }
  grid = grid.filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (!grid.length) return { headers: [], rows: [] };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const filled = grid[i].filter(c => String(c ?? '').trim() !== '');
    if (filled.length >= 3 && new Set(filled.map(s => String(s).trim().toLowerCase())).size === filled.length) {
      headerIdx = i;
      break;
    }
  }

  const headers = grid[headerIdx].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
  const rows = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    // Section banners inside a sheet ("NEWLY received") are a single filled
    // cell in a wide table — not data.
    if (r.filter(c => String(c ?? '').trim() !== '').length < 2) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = String(r[j] ?? '').trim(); });
    // A repeat of the header row (Monday puts one per section) isn't data.
    if (headers.every(h => obj[h] === h || obj[h] === '')) continue;
    rows.push(obj);
  }
  return { headers, rows };
}
