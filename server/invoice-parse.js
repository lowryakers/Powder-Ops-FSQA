// Reading an invoice or PO well enough to propose a ledger row.
//
// Pure and dependency-free so it can be tested without a server, and so the
// preview and the commit read the same file the same way.
//
// THE ONE THING THIS WILL NOT DO IS GUESS THE DIRECTION.
//
// On a two-way ledger, `receivable` (they owe us) and `payable` (we owe them)
// are the difference between being paid and paying. Getting it backwards on an
// import of twenty invoices moves five figures the wrong way and the reconcile
// screen reports it with total confidence. So direction is decided ONLY when
// the document actually says who issued it — a "Bill To" naming us with the
// partner as the vendor, or the reverse — and is left null otherwise for a
// person to set. A null the importer refuses to fill is not a gap; it is the
// one field worth stopping for.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Any date shape an invoice prints, as ISO. Returns null rather than guessing. */
export function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(m[1], m[2], m[3]);

  // Month-name forms are unambiguous, so they are tried before the numeric one.
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);

  // US month-first, which is what every invoice in this plant's drawer uses.
  // A day above 12 in the first position is the only proof of the other order,
  // and it is taken as such rather than being silently read as a month.
  m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    const A = Number(a), B = Number(b);
    if (A > 12 && B <= 12) return iso(y, B, A);
    if (A <= 12) return iso(y, A, B);
    return null;
  }
  return null;
}

function iso(y, mo, d) {
  const Y = Number(y), M = Number(mo), D = Number(d);
  if (!Y || M < 1 || M > 12 || D < 1 || D > 31) return null;
  return `${String(Y).padStart(4, '0')}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
}

/** A money figure, from "$1,234.56" / "1234.56" / "(1,234.56)" (negative). */
export function parseMoney(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const m = s.replace(/[(),]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const LABEL_VALUE = (labels, valueRe) => new RegExp(
  `(?:${labels})\\s*[:#]?\\s*(${valueRe})`, 'i');

// EVERY LABEL IS BOUNDED, and the bare forms need a separator after them.
//
// Three real mis-reads came from leaving those off, and all three would have
// shipped wrong numbers onto a ledger two companies settle against:
//   · `p\.?o\.?` matched the "Po" in "POwder Ops" and read the PO number as
//     "wder".
//   · `total` matched the tail of "SubTOTAL", so an invoice with tax on it
//     imported at its pre-tax figure.
//   · `invoice` with an optional suffix matched "Invoice Date:" and read the
//     invoice number as "Date".
// A bare "PO" or "Invoice" only counts as a label when a colon or # follows it.
const NUMBER_LABELS = '\\binvoice\\s*(?:no\\.?|number|#)|\\binvoice(?=\\s*[:#])'
  + '|\\binv\\.?\\s*(?:no\\.?|#)|\\bbill\\s*(?:no\\.?|#)|\\bdocument\\s*(?:no\\.?|number|#)';
const PO_LABELS = '\\bp\\.?o\\.?\\s*(?:no\\.?|number|#)|\\bpurchase\\s*order\\s*(?:no\\.?|number|#)?'
  + '|\\bp\\.?o\\.?(?=\\s*[:#])';
const DATE_LABELS = '\\binvoice\\s*date|\\bdate\\s*of\\s*invoice|\\bissue(?:d)?\\s*date|\\bbill\\s*date|\\border\\s*date|^date\\b';

// The total, most specific first. A plain "Total" is LAST on purpose: an
// invoice usually prints Subtotal, Tax and Total, and "Amount Due" / "Balance
// Due" is the figure that actually settles. Reading Subtotal as the total is
// how a ledger silently under-reports every invoice with tax on it.
const TOTAL_LABELS = [
  '\\bbalance\\s*due', '\\bamount\\s*due', '\\btotal\\s*due', '\\binvoice\\s*total',
  '\\bgrand\\s*total', '\\btotal\\s*amount', '\\bamount\\s*payable', '\\btotal\\b',
];

const MONEY_RE = String.raw`\(?\$?\s?-?[\d,]+(?:\.\d{2})?\)?`;

const readableLabel = (pattern) => String(pattern)
  .replace(/\\b/g, '').replace(/\\s\*/g, ' ').replace(/\\/g, '')
  .replace(/\s+/g, ' ').trim();

function findLabelled(lines, labels, valueRe) {
  const re = LABEL_VALUE(labels, valueRe);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m && m[1]?.trim()) return m[1].trim();
    // Table layouts put the label on one line and the value on the next — the
    // same shape the CoA reader deals with.
    //
    // But NOT when the next line is itself a labelled field. A "PURCHASE ORDER"
    // heading sitting above "PO Number: PO-9912" read the PO number as "PO" —
    // it took the next line's first token, which was the next label, not a
    // value. A line that carries its own label is answered by the pass above.
    if (new RegExp(`^(?:${labels})\\s*[:#]?\\s*$`, 'i').test(lines[i])) {
      const next = (lines[i + 1] || '').trim();
      if (next && !/^[A-Za-z][A-Za-z .#/-]{0,30}\s*[:#]\s*\S/.test(next)) {
        const nm = next.match(new RegExp(`^(${valueRe})`, 'i'));
        if (nm && nm[1]?.trim()) return nm[1].trim();
      }
    }
  }
  return null;
}

/**
 * Which way does this document point?
 *
 * Decided from who is billing whom, and ONLY when both sides are identifiable.
 * `us` and `them` are name fragments; the caller supplies the partner's name so
 * this stays a pure function.
 */
export function detectDirection(text, { usNames = [], partnerNames = [] } = {}) {
  const hay = String(text || '');
  const has = (names) => names.some(n => n && new RegExp(escape(n), 'i').test(hay));
  const usPresent = has(usNames);
  const partnerPresent = has(partnerNames);
  if (!usPresent || !partnerPresent) return { direction: null, reason: 'Both company names could not be found on the document.' };

  // "Bill To" / "Sold To" names the party who OWES. Whoever that is, the other
  // party issued the document.
  const billTo = hay.match(/(?:bill\s*to|sold\s*to|customer|invoice\s*to)\s*:?\s*([\s\S]{0,160})/i)?.[1] || '';
  const billToUs = has2(billTo, usNames);
  const billToPartner = has2(billTo, partnerNames);

  if (billToUs && !billToPartner) return { direction: 'payable', reason: 'The document bills Powder Ops, so we owe it.' };
  if (billToPartner && !billToUs) return { direction: 'receivable', reason: 'The document bills the partner, so they owe it.' };

  // Failing that, whichever name appears FIRST is usually the letterhead — the
  // issuer. Weak, so it is reported as a low-confidence read rather than
  // applied silently.
  const firstUs = firstIndex(hay, usNames);
  const firstPartner = firstIndex(hay, partnerNames);
  if (firstUs >= 0 && firstPartner >= 0 && firstUs !== firstPartner) {
    return firstUs < firstPartner
      ? { direction: 'receivable', reason: 'Powder Ops appears first, as the letterhead — read as us issuing it.', weak: true }
      : { direction: 'payable', reason: 'The partner appears first, as the letterhead — read as them issuing it.', weak: true };
  }
  return { direction: null, reason: 'Could not tell who issued this document.' };
}

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has2 = (hay, names) => names.some(n => n && new RegExp(escape(n), 'i').test(hay));
function firstIndex(hay, names) {
  let best = -1;
  for (const n of names) {
    if (!n) continue;
    const i = hay.search(new RegExp(escape(n), 'i'));
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * Everything readable from one invoice or PO.
 *
 * Every field can come back null. A null means "not found", and the review step
 * exists so a person fills it in — an invented invoice number or a guessed
 * amount on a ledger both companies settle against is worse than a blank.
 */
export function parseInvoice(text, { usNames = [], partnerNames = [], filename = '' } = {}) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);

  const isCredit = /credit\s*(?:memo|note)|\bcredit\b/i.test(text || '');
  const poNumber = findLabelled(lines, PO_LABELS, String.raw`[A-Za-z0-9][A-Za-z0-9._\/-]{1,30}`);
  const invNumber = findLabelled(lines, NUMBER_LABELS, String.raw`[A-Za-z0-9][A-Za-z0-9._\/-]{1,30}`);
  // A document that names a PO number and no invoice number, and calls itself
  // one, is a PO. Anything else is treated as an invoice — the common case, and
  // the type is a dropdown in the review step anyway.
  const looksPo = /purchase\s*order/i.test(text || '') && !invNumber;
  const doc_type = isCredit ? 'credit' : looksPo ? 'po' : 'invoice';

  let amount = null, amount_label = null;
  for (const label of TOTAL_LABELS) {
    const v = findLabelled(lines, label, MONEY_RE);
    if (v != null) {
      const n = parseMoney(v);
      // The label as a person would read it, not as the regex spells it — this
      // is shown in the review table so someone can tell "Total" from
      // "Balance Due" at a glance.
      if (n != null) { amount = Math.abs(n); amount_label = readableLabel(label); break; }
    }
  }

  const issued_date = parseDate(findLabelled(lines, DATE_LABELS, String.raw`[A-Za-z0-9][A-Za-z0-9,\/. -]{5,25}`) || '');
  const termsMatch = (text || '').match(/\bnet\s*(\d{1,3})\b/i);
  const terms_days = termsMatch ? Number(termsMatch[1]) : null;

  const dir = detectDirection(text, { usNames, partnerNames });

  return {
    doc_type,
    doc_number: (looksPo ? poNumber : invNumber) || invNumber || poNumber || null,
    reference: looksPo ? null : (poNumber && poNumber !== invNumber ? poNumber : null),
    issued_date,
    terms_days,
    amount,
    amount_label,
    direction: dir.direction,
    direction_reason: dir.reason,
    direction_weak: !!dir.weak,
    // Named so the review step can say what it could not find, per file, rather
    // than showing a row of empty boxes and leaving someone to work out why.
    missing: [
      !((looksPo ? poNumber : invNumber) || invNumber || poNumber) && 'document number',
      !issued_date && 'date',
      amount == null && 'amount',
      !dir.direction && 'direction',
    ].filter(Boolean),
    filename,
  };
}
