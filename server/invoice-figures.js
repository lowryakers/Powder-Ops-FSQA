// Reading the total, the supplier and the date off an invoice — from the text
// that is already extracted for search.
//
// IT SUGGESTS, IT NEVER SETS. Every value comes back with the LINE it was read
// from, and the caller shows both so a person accepts or corrects it. An OCR
// figure written silently onto a financial record is a number nobody checked
// carrying the authority of one somebody typed — the same refusal
// `compareManualToTasks` makes about a machine's maintenance procedure.
//
// PURE. Text in, candidates out: no Express, no database, no writes. The
// arithmetic that decides what an order cost should be checkable on its own.

/** Money as it is actually written on invoices: $1,234.56, 1234.56, 1.234,56. */
const MONEY = String.raw`\$?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?|\$?\s*\d+(?:\.\d{2})?`;

/**
 * The labels that mean "this is what you owe", strongest first.
 *
 * ORDER IS THE WHOLE ALGORITHM. An invoice carries several money figures —
 * subtotal, tax, shipping, amount due — and picking the largest is how you end
 * up recording a total that includes the previous balance on a statement. So
 * the most specific label wins, and a bare "total" is the weakest match rather
 * than the first one found.
 */
const TOTAL_LABELS = [
  { re: /\b(?:total\s+amount\s+due|amount\s+due|balance\s+due|please\s+pay|pay\s+this\s+amount)\b/i, rank: 0 },
  { re: /\b(?:invoice\s+total|order\s+total|grand\s+total)\b/i, rank: 1 },
  { re: /\btotal\b/i, rank: 2 },
];

// Lines that carry money but are NEVER the total. Checked before the labels, so
// "Subtotal" can never be read as a "total" by the weak third pattern.
const NOT_TOTAL = /\b(?:sub[\s-]?total|tax|vat|gst|shipping|freight|handling|discount|previous\s+balance|paid|credit)\b/i;

export function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[$\s]/g, '');
  if (!s) return null;
  // 1.234,56 — a comma decimal. Only when the comma is the LAST separator and
  // has exactly two digits after it, or "1,234" becomes 1.234.
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * The total, with the line it came from.
 *
 * Returns null rather than a guess when nothing on the page is labelled as a
 * total. An invoice whose total cannot be read is a gap somebody fills in by
 * looking at it — which is what they were doing anyway.
 */
export function findTotal(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const found = [];
  for (const line of lines) {
    if (NOT_TOTAL.test(line)) continue;
    const label = TOTAL_LABELS.find(l => l.re.test(line));
    if (!label) continue;
    const money = line.match(new RegExp(MONEY, 'g')) || [];
    // The figure on a total line is the LAST one — "Total 3 items $412.00".
    const amount = parseMoney(money[money.length - 1]);
    if (amount == null) continue;
    found.push({ amount, line, rank: label.rank });
  }
  if (!found.length) return null;
  // Best label wins; among equals the LAST occurrence, because a running total
  // appears before the final one on a multi-page document.
  found.sort((a, b) => a.rank - b.rank);
  const best = found.filter(f => f.rank === found[0].rank);
  return { amount: best[best.length - 1].amount, evidence: best[best.length - 1].line };
}

const DATE_PATTERNS = [
  // 2026-08-31
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, iso: (m) => `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` },
  // 08/31/2026 — US order, which is what the plant's suppliers send.
  { re: /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/, iso: (m) => `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` },
  // 31 Aug 2026 / Aug 31, 2026
  { re: /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})\b/i,
    iso: (m) => `${m[3]}-${MONTHS[m[2].toLowerCase().slice(0, 3)]}-${String(m[1]).padStart(2, '0')}` },
  { re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i,
    iso: (m) => `${m[3]}-${MONTHS[m[1].toLowerCase().slice(0, 3)]}-${String(m[2]).padStart(2, '0')}` },
];
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/**
 * The invoice date.
 *
 * A line LABELLED as the invoice date is preferred over any date on the page —
 * an invoice also carries a due date, a ship date and a printed-on date, and
 * the earliest or first one is not reliably the one wanted.
 */
export function findInvoiceDate(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const labelled = lines.filter(l => /\b(?:invoice\s+date|date\s+of\s+invoice|order\s+date|date)\b/i.test(l)
    && !/\bdue\b/i.test(l));
  for (const line of [...labelled, ...lines]) {
    for (const p of DATE_PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        const iso = p.iso(m);
        // A date that does not parse is not a date. Guards a month index that
        // came back undefined from a mangled OCR month name.
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso))) {
          return { date: iso, evidence: line };
        }
      }
    }
  }
  return null;
}

/** Everything readable, each with its evidence. Nothing is applied here. */
export function readInvoiceFigures(text) {
  const total = findTotal(text);
  const date = findInvoiceDate(text);
  return {
    total: total?.amount ?? null,
    total_evidence: total?.evidence ?? null,
    invoice_date: date?.date ?? null,
    invoice_date_evidence: date?.evidence ?? null,
    // Said plainly so the caller can show "nothing readable" rather than an
    // empty form that looks like it failed.
    readable: !!(total || date),
  };
}
