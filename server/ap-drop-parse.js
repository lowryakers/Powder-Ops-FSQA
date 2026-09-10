// Reading what an AP Drop needs off the text of a finance PDF.
//
// PURE — text in, candidates out, no Express and no database — and IT
// SUGGESTS, IT NEVER SETS. Every field comes back with the LINE it was read
// from, so whoever triages the drop can check the number against the document
// without opening it. Builds on `invoice-figures.js`, which already reads the
// total and the invoice date for supply invoices; this adds the rest of what
// a queue row needs (vendor, invoice number, due date, PO/CO references,
// currency, bill-to) under the same rules:
//
//  * NOTHING LABELLED YIELDS NULL, never the most plausible-looking string.
//    An invoice number the parser could not find is a blank somebody fills in
//    by looking; one it guessed wrong is a blank nobody notices.
//  * The parse status is DERIVED from what was found (`parseStatus`), so the
//    queue can say "partial" and mean exactly which fields are missing.
import { findTotal, findInvoiceDate, findDateIn } from './invoice-figures.js';

// Our own names, so the vendor guess never returns the bill-to party. Add a
// trading name here rather than special-casing a caller.
export const OUR_NAMES = /\b(?:powder\s*ops|prodough|pro\s*dough|m4\s*dynamics?)\b/i;

const INVOICE_NO = [
  /\binvoice\s*(?:no\.?|number|num\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
  /\binv\.?\s*(?:no\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
  /\bcredit\s+(?:memo|note)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
];
// "Invoice Date" would match INVOICE_NO with "Date" as the number.
const NOT_A_NUMBER = /^(?:date|no|number|num|total|amount|due|to|from|for|the)$/i;

const PO_REF = /\b(?:P\.?O\.?|purchase\s+order)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{1,})/gi;
const CO_REF = /\b(?:C\.?O\.?|customer\s+order)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{1,})/gi;

const CURRENCY = [
  { re: /\b(?:CAD|C\$)\b/, code: 'CAD' },
  { re: /\b(?:EUR)\b|€/, code: 'EUR' },
  { re: /\b(?:GBP)\b|£/, code: 'GBP' },
  { re: /\b(?:MXN)\b/, code: 'MXN' },
  { re: /\bUSD\b|\$/, code: 'USD' },
];

const lines = (text) => String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/** The invoice (or credit memo) number, with its line. */
export function findInvoiceNumber(text) {
  for (const line of lines(text)) {
    for (const re of INVOICE_NO) {
      const m = line.match(re);
      if (m && !NOT_A_NUMBER.test(m[1]) && /\d/.test(m[1])) return { value: m[1].replace(/[.,:;]+$/, ''), evidence: line };
    }
  }
  return null;
}

/** The due date: a line that says "due" and carries a date. Net terms are not a date and are left alone. */
export function findDueDate(text) {
  for (const line of lines(text)) {
    if (!/\bdue\b/i.test(line) || /\bamount\s+due\b|\bbalance\s+due\b|\btotal\s+due\b/i.test(line) && !/\bdate\b/i.test(line)) continue;
    const iso = findDateIn(line);
    if (iso) return { value: iso, evidence: line };
  }
  return null;
}

/** Every PO / CO reference on the page, deduplicated, with the first line each was seen on. */
export function findOrderRefs(text) {
  const out = [];
  const seen = new Set();
  for (const line of lines(text)) {
    const hits = [];
    for (const [re, kind] of [[PO_REF, 'PO'], [CO_REF, 'CO']]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const v = m[1].replace(/[.,:;]+$/, '');
        if (NOT_A_NUMBER.test(v) || !/\d/.test(v)) continue;
        hits.push({ at: m.index, kind, value: v, evidence: line });
      }
    }
    // In the order they appear on the page, whichever kind each is.
    for (const h of hits.sort((a, b) => a.at - b.at)) {
      const key = `${h.kind}:${h.value.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: h.kind, value: h.value, evidence: h.evidence });
    }
  }
  return out;
}

/**
 * The vendor: the first line that reads like a company name and is not us.
 *
 * Deliberately weak. A letterhead is the top of the page, so the first
 * "namey" line is usually right and is offered AS A SUGGESTION with its line;
 * anything with a money figure, a date or a label in it is skipped, and our
 * own names are never the vendor (they are the bill-to party).
 */
export function findVendor(text) {
  for (const line of lines(text).slice(0, 25)) {
    if (line.length < 3 || line.length > 60) continue;
    if (OUR_NAMES.test(line)) continue;
    if (/\d{3,}|\$|:|\b(?:invoice|bill\s+to|ship\s+to|remit|date|due|total|page|www\.|@)\b/i.test(line)) continue;
    if (!/[A-Za-z]{3,}/.test(line)) continue;
    return { value: line.replace(/\s{2,}/g, ' '), evidence: line };
  }
  return null;
}

/** Who the document is addressed to, when a "Bill To" block is present. */
export function findBillTo(text) {
  const ls = lines(text);
  const i = ls.findIndex(l => /\b(?:bill(?:ed)?\s+to|sold\s+to|customer)\b\s*:?/i.test(l));
  if (i < 0) return null;
  const same = ls[i].replace(/^.*?\b(?:bill(?:ed)?\s+to|sold\s+to|customer)\b\s*:?\s*/i, '').trim();
  const value = same || ls[i + 1] || '';
  return value ? { value: value.slice(0, 80), evidence: ls[i] } : null;
}

export function findCurrency(text) {
  const t = String(text || '');
  for (const c of CURRENCY) if (c.re.test(t)) return c.code;
  return null;
}

/** ok when the three facts a queue row is built on were all read; partial when some were; failed when nothing was. */
export function parseStatus(fields) {
  if (!fields) return 'failed';
  const core = [fields.vendor, fields.invoice_number, fields.total].filter(v => v != null && v !== '');
  const any = Object.values(fields).some(v => v != null && v !== '' && !(Array.isArray(v) && !v.length));
  if (core.length === 3) return 'ok';
  return any ? 'partial' : 'failed';
}

/** Everything readable, each with its evidence. Nothing is applied here. */
export function parseFinanceDocument(text) {
  const t = String(text || '');
  if (!t.trim()) return { status: 'failed', fields: null, evidence: {}, reason: 'no readable text' };
  const total = findTotal(t);
  const date = findInvoiceDate(t);
  const due = findDueDate(t);
  const no = findInvoiceNumber(t);
  const vendor = findVendor(t);
  const billTo = findBillTo(t);
  const refs = findOrderRefs(t);
  // A letterhead guess is only worth offering beside something financial. On
  // a page with no total, no number and no date, "the first namey line" is
  // just the first line — and calling that a partial parse would put a
  // thank-you note in the queue with a vendor on it.
  const anyFact = total || no || date || due || refs.length;
  const fields = {
    vendor: anyFact ? (vendor?.value ?? null) : null,
    invoice_number: no?.value ?? null,
    invoice_date: date?.date ?? null,
    due_date: due?.value ?? null,
    total: total?.amount ?? null,
    currency: findCurrency(t),
    order_refs: refs.map(r => `${r.kind} ${r.value}`),
    bill_to: billTo?.value ?? null,
  };
  const evidence = {
    vendor: anyFact ? (vendor?.evidence ?? null) : null,
    invoice_number: no?.evidence ?? null,
    invoice_date: date?.evidence ?? null,
    due_date: due?.evidence ?? null,
    total: total?.evidence ?? null,
    order_refs: refs.map(r => r.evidence),
    bill_to: billTo?.evidence ?? null,
  };
  return { status: parseStatus(fields), fields, evidence, reason: null };
}
