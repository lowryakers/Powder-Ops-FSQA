// Reading a lab Certificate of Analysis that is laid out as a TABLE.
//
// The original reader wanted "Label: value" on one line and a test name with
// its result beside it. Neither exists in a real CoA, which is why CTLA's
// report came back with readable text and not one field extracted. What pdfjs
// actually hands back for their report is this:
//
//     CTLA ID:
//     Date Received:
//     Sample Name:
//     Lot Number:
//     Customer:
//     173943
//     6/24/2026
//     Flavor (Natural Cream Cheese)
//     10142
//     Powder Ops 281 E 1600 N, Vineyard, UT 84059
//
//     Analysis SpecificationMethod ResultMDL Units
//     ReportUSP <2021> <100Total Aerobic Microbial Count (USP) 100 cfu/g
//     ReportBAM CH. 4
//     (MOD)
//     <10Total Coliforms (BAM) (MOD) 10 cfu/g
//     AbsentE.Coli BAM (MOD)
//
// Two structural facts, and this module is built on exactly those two:
//
//  1. THE LABEL COLUMN AND THE VALUE COLUMN ARE SEPARATE BLOCKS. Every label
//     ends in a colon and they arrive together, followed by their values in the
//     same order. So they are paired by POSITION, not by looking for a colon
//     mid-line — and a run is only trusted when the counts line up, because
//     pairing five labels to four values would put the lot number in the date.
//
//  2. THE RESULT IS GLUED TO THE FRONT OF THE TEST NAME. `<100Total Aerobic…`,
//     `AbsentSalmonella`, `0.008Arsenic`. There is no separator at all — the
//     Result cell simply abuts the Analysis cell — so a pattern anchored on the
//     test name at the start of a line can never match. The seam is the giveaway
//     and is what this scans for: a result token immediately followed by a
//     capital letter.
//
// Note CTLA's own Specification column reads "Report" for every test: they
// report the number, the CUSTOMER supplies the limit. So this extracts values
// only — grading is done afterwards against the plant's approved specification
// (server/coa-grade.js). That separation is not incidental; a lab report has no
// opinion about whether the plant's product passes.

// Result values as they are actually printed.
//
// The bound marker is OPTIONAL and separate from the digits. Folding them
// together (requiring `<` before a number, with a bare `.\d+` as the only other
// route) silently read "0.008Arsenic" as ".008" — the leading zero fell off,
// and a heavy-metal result off by a factor of ten is the worst possible
// rounding error to ship.
const NUMBER = String.raw`(?:[<>]=?\s?)?(?:\d[\d,]*(?:\.\d+)?|\.\d+)`;
const WORD = String.raw`Absent|Present|Not\s*Detected|Non\s*Detected|Negative|Positive|ND|None\s*Detected|No\s*Growth`;
const RESULT = `(?:${NUMBER}|${WORD})`;

// result token, then a capital letter starting the test name, then optionally
// the MDL and units cells at the end of the row.
const ROW_RE = new RegExp(
  `(${RESULT})([A-Z][A-Za-z0-9&.,'()/+\\-\\s<>]*?)` +
  `(?:\\s+(\\.?\\d[\\d.]*)\\s+([A-Za-z%µ][A-Za-z%µ/]*))?\\s*$`,
);

// The Specification and Method cells that precede the seam on the same line.
// Stripped before matching so "USP <2021>" can't be mistaken for a result.
const PREFIX_RE = /^(?:Report|Result|Spec(?:ification)?)?\s*(?:USP\s*<[^>]*>|BAM\s*CH\.?\s*[\d.]*(?:\s*\(MOD\))?|AOAC[\w\s.-]*|ISO[\w\s.-]*|[A-Z]{2,6}\s*<[^>]*>)?\s*/;

const SECTION_RE = /^(complete\s+micro|micro(?:biology|biological)?|heavy\s*metals?|chemistry|composition|identity|physical|nutritional|allergens?)\b/i;

// Lines that are furniture, not data: the lab's address, the disclaimer, page
// numbers, the signature block.
const NOISE_RE = /(certificate of analysis|specifications provided by|does not constitute|method detection limit|not\s+to be altered|page \d+ of|^\(?\d{3}\)?[\s-]?\d{3}-\d{4}|quality manager|^date$|^analysis\b.*\bunits?$|^sample information$)/i;

const LABELS = {
  'ctla id': 'lab_reference',
  'lab id': 'lab_reference',
  'sample id': 'lab_reference',
  'report number': 'lab_reference',
  'date received': 'received_date',
  'received': 'received_date',
  'sample name': 'item_description',
  'product name': 'item_description',
  'product': 'item_description',
  'description': 'item_description',
  'lot number': 'lot_number',
  'lot': 'lot_number',
  'batch number': 'lot_number',
  // "Customer" on a CoA is US — the lab's customer is Powder Ops. It is NOT the
  // supplier of the material, which is what the request's `supplier` field
  // means (Sensapure, on the report that raised this). Mapping it across would
  // overwrite the real vendor with our own name and address on a compliance
  // record. Read for reference; never offered as a field to apply.
  'customer': 'lab_customer',
  'client': 'lab_customer',
  'supplier': 'supplier',
  'vendor': 'supplier',
  'manufacturer': 'supplier',
  'manufacturer lot': 'manufacturer_lot',
  'vendor lot': 'vendor_lot',
  'item number': 'item_number',
  'item #': 'item_number',
  'product code': 'item_number',
  'date reported': 'date_of_results',
  'report date': 'date_of_results',
  'date of results': 'date_of_results',
  'date completed': 'date_of_results',
  'expiration': 'product_expiration',
  'expiration date': 'product_expiration',
  'origin': 'origin',
  'country of origin': 'origin',
};

const normalizeLabel = (s) => String(s || '').replace(/[:\s]+$/, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Pair a run of "Label:" lines with the run of values that follows.
 *
 * ONLY when the two runs are the same length. A label block of five against a
 * value block of four means a cell was empty or wrapped, and pairing them by
 * position would slide every value up one — putting the customer's name in the
 * lot number field of a compliance record. Better to extract nothing from that
 * block and let a person type it.
 */
function pairLabelBlocks(lines) {
  const out = {};
  let i = 0;
  while (i < lines.length) {
    if (!/:\s*$/.test(lines[i])) { i++; continue; }
    const labels = [];
    while (i < lines.length && /:\s*$/.test(lines[i])) { labels.push(lines[i]); i++; }
    const values = [];
    while (i < lines.length && values.length < labels.length
           && !/:\s*$/.test(lines[i]) && !NOISE_RE.test(lines[i]) && !SECTION_RE.test(lines[i])) {
      values.push(lines[i]); i++;
    }
    if (values.length !== labels.length) continue; // ambiguous — take nothing
    for (let k = 0; k < labels.length; k++) {
      const key = LABELS[normalizeLabel(labels[k])];
      const val = values[k].trim();
      if (key && val && !out[key]) out[key] = val;
    }
  }
  return out;
}

/**
 * Test rows, found at the seam where the Result cell abuts the Analysis cell.
 *
 * A row may be split across lines when the Method cell wraps ("BAM CH. 4" /
 * "(MOD)"), but the result and the test name are always together — they are
 * adjacent columns — so each line is judged on its own and the wrapped method
 * lines simply match nothing.
 */
function parseRows(lines) {
  const results = [];
  const seen = new Set();
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || NOISE_RE.test(line)) continue;
    if (SECTION_RE.test(line) && line.length < 40) { section = line; continue; }

    const body = line.replace(PREFIX_RE, '').trim();
    if (!body) continue;
    const m = body.match(ROW_RE);
    if (!m) continue;

    const result_value = m[1].replace(/\s+/g, '');
    const test_type = (m[2] || '').replace(/\s+/g, ' ').trim();
    // A name has to look like one. Anything shorter is a stray fragment, and a
    // fabricated test on a CoA is far worse than a missed one.
    if (test_type.length < 3 || !/[A-Za-z]{3}/.test(test_type)) continue;

    const key = test_type.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      test_type,
      result_value,
      unit: m[4] || null,
      mdl: m[3] || null,
      section,
      // Deliberately null. CTLA's Specification column says "Report" for every
      // test — the lab reports the number and the customer owns the limit — so
      // there is no lab verdict to carry. Grading happens against the plant's
      // approved specification.
      pass_fail: null,
    });
  }
  return results;
}

/** Dates print as 6/24/2026 here; store ISO, keep anything else as written. */
function toIso(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return String(s || '').trim() || null;
  let [, mo, d, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE_KEYS = ['received_date', 'date_of_results', 'product_expiration'];

/**
 * Read a columnar CoA. Returns the same shape as the pattern reader so the two
 * are interchangeable to the caller.
 */
export function parseColumnarCoa(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const header = pairLabelBlocks(lines);
  for (const k of DATE_KEYS) if (header[k]) header[k] = toIso(header[k]);

  const test_results = parseRows(lines);

  // The report's own date, printed under the signature rather than labelled.
  if (!header.date_of_results) {
    const tail = lines.slice(-6).find(l => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(l));
    if (tail) header.date_of_results = toIso(tail);
  }

  return { ...header, test_results };
}

/** Did this reader actually find anything? Used to decide whether to try AI. */
export function foundSomething(parsed) {
  return !!(parsed?.test_results?.length);
}
