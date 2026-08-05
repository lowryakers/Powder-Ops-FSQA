// Reading a bank statement, whichever way it arrives.
//
// Two shapes cover every US bank worth caring about:
//
//   · OFX / QFX — what "Download to Quicken/QuickBooks" gives you. It is a
//     structured format with a stable transaction id per entry (FITID), which
//     is what makes re-importing an overlapping date range safe.
//   · CSV — what "Download to spreadsheet" gives you, and every bank lays it
//     out differently. Column names are sniffed rather than configured,
//     because asking somebody to map columns every month is how they stop
//     downloading the statement.
//
// The output is the same either way, and is signed the way a statement reads:
// **negative is money leaving the account.** Banks disagree about this — some
// give one signed Amount column, some give separate Debit and Credit columns,
// some give a positive Amount with a Type of DEBIT — so normalising it here is
// the whole job. Getting it backwards would put every payment on the wrong
// side of the reconciliation.

import { parseDelimited } from './tabular.js';
import { createHash } from 'crypto';

/* ── OFX / QFX ────────────────────────────────────────────────────────────── */

const ofxTag = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
};

// OFX dates are YYYYMMDD with an optional time and timezone glued on.
export function ofxDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseOfx(text) {
  const src = String(text);
  const blocks = src.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const transactions = blocks.map(b => {
    const amount = Number(ofxTag(b, 'TRNAMT'));
    // NAME is the counterparty, MEMO the free text. Banks populate one or the
    // other or both; the description keeps whatever there is.
    const name = ofxTag(b, 'NAME');
    const memo = ofxTag(b, 'MEMO');
    return {
      external_id: ofxTag(b, 'FITID'),
      posted_date: ofxDate(ofxTag(b, 'DTPOSTED')),
      // OFX is already signed correctly — a debit is negative.
      amount: Number.isFinite(amount) ? amount : 0,
      description: [name, memo].filter(Boolean).join(' — ') || null,
      counterparty: name || null,
      reference: ofxTag(b, 'CHECKNUM') || ofxTag(b, 'REFNUM') || null,
      type: ofxTag(b, 'TRNTYPE') || null,
    };
  }).filter(t => t.posted_date);

  // The closing balance, when the file carries one — it is what a
  // reconciliation is checked against, so it saves typing it off the paper.
  const ledger = src.match(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/i)?.[0] || '';
  const balAmt = Number(ofxTag(ledger, 'BALAMT'));

  return {
    format: 'ofx',
    transactions,
    statement: {
      account_mask: (ofxTag(src, 'ACCTID') || '').slice(-4) || null,
      balance: Number.isFinite(balAmt) ? balAmt : null,
      balance_date: ofxDate(ofxTag(ledger, 'DTASOF')),
    },
  };
}

/* ── CSV ──────────────────────────────────────────────────────────────────── */

const HEADERS = {
  date: [/^(posting|posted|transaction|trans|effective)?\s*date$/i, /^date$/i, /^post(ed|ing)?\s*date$/i],
  description: [/^description$/i, /^details?$/i, /^memo$/i, /^transaction$/i, /^narrative$/i, /^name$/i, /^payee$/i],
  amount: [/^amount$/i, /^transaction\s*amount$/i, /^value$/i],
  debit: [/^debit$/i, /^withdrawals?$/i, /^money\s*out$/i, /^payments?$/i, /^charges?$/i],
  credit: [/^credit$/i, /^deposits?$/i, /^money\s*in$/i],
  type: [/^type$/i, /^transaction\s*type$/i, /^debit\/credit$/i, /^dr\/cr$/i],
  balance: [/^balance$/i, /^running\s*balance$/i],
  reference: [/^(check|cheque)\s*(num|number|#)?$/i, /^reference$/i, /^ref$/i, /^transaction\s*id$/i],
};

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Money as banks write it: "$1,234.56", "(45.00)" for negative, "1.234,56" in
// no US export worth supporting, and a bare "-12.00".
export function parseMoney(v) {
  let s = norm(v).replace(/[$\s]/g, '').replace(/,/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Dates as banks write them. US month-first, because that is what the plant's
// banks export; an ISO date is recognised on its own shape.
export function parseDate(v) {
  const s = norm(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!us) return null;
  const mo = Number(us[1]), day = Number(us[2]);
  let yr = Number(us[3]);
  if (yr < 100) yr += 2000;
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mapColumns(headerRow) {
  const cells = headerRow.map(norm);
  const map = {};
  cells.forEach((cell, i) => {
    for (const [key, patterns] of Object.entries(HEADERS)) {
      if (map[key] === undefined && patterns.some(p => p.test(cell))) map[key] = i;
    }
  });
  return map;
}

// Some exports put a bank name and an address above the real header. Find the
// first row that looks like a header rather than assuming row 0.
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = mapColumns(rows[i]);
    if (map.date !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined)) {
      return { index: i, map };
    }
  }
  return null;
}

export function parseBankCsv(text) {
  const rows = parseDelimited(String(text));
  const header = findHeader(rows);
  if (!header) {
    return { error: 'Could not find a date column and an amount column. Export the statement as CSV or, better, as OFX/QFX ("download to Quicken").' };
  }
  const { map } = header;
  const at = (r, key) => (map[key] === undefined ? '' : norm(r[map[key]]));

  const transactions = [];
  for (let i = header.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some(c => norm(c))) continue;
    const posted_date = parseDate(at(r, 'date'));
    if (!posted_date) continue; // a total line, a footer, a blank

    // Three layouts, in order of how unambiguous they are.
    let amount;
    const debit = parseMoney(at(r, 'debit'));
    const credit = parseMoney(at(r, 'credit'));
    if (debit !== null || credit !== null) {
      // Separate columns: whichever is filled. A debit column holds a positive
      // number meaning money out, so it is negated.
      amount = (credit !== null && credit !== 0) ? Math.abs(credit) : -Math.abs(debit || 0);
    } else {
      amount = parseMoney(at(r, 'amount'));
      const type = at(r, 'type').toUpperCase();
      // A positive Amount with a DEBIT type is money out. Only flip when the
      // sign doesn't already say so, or a correctly-signed file gets inverted.
      if (amount !== null && amount > 0 && /^(DEBIT|DR|WITHDRAWAL|PAYMENT)/.test(type)) amount = -amount;
      if (amount !== null && amount < 0 && /^(CREDIT|CR|DEPOSIT)/.test(type)) amount = Math.abs(amount);
    }
    if (amount === null) continue;

    const description = at(r, 'description') || null;
    transactions.push({
      // A CSV has no stable transaction id, so one is derived from the fields
      // that identify the entry. Re-importing an overlapping range then updates
      // the same row instead of filing it twice — which is the single most
      // common way a reconciliation goes wrong.
      external_id: csvFingerprint(posted_date, amount, description, at(r, 'reference')),
      posted_date,
      amount,
      description,
      counterparty: null,
      reference: at(r, 'reference') || null,
      type: at(r, 'type') || null,
    });
  }

  if (!transactions.length) {
    return { error: 'No transactions could be read out of that file. Check it is the statement export and not a summary.' };
  }
  return { format: 'csv', transactions, statement: { account_mask: null, balance: null, balance_date: null } };
}

// Deterministic id for a CSV row. Includes an occurrence counter added by the
// caller — two identical coffees on the same day are two real transactions and
// must not collapse into one.
export function csvFingerprint(date, amount, description, reference) {
  return createHash('sha1')
    .update([date, amount.toFixed(2), norm(description).toLowerCase(), norm(reference)].join('|'))
    .digest('hex').slice(0, 24);
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

export function parseStatement(buffer, filename = '') {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  const isOfx = /<OFX>|<STMTTRN>|OFXHEADER/i.test(text.slice(0, 4000))
    || /\.(ofx|qfx)$/i.test(filename);
  const out = isOfx ? parseOfx(text) : parseBankCsv(text);
  if (out.error) return out;

  // Two identical rows on the same day are two real transactions. The
  // fingerprint is per-row content, so an occurrence index keeps them apart
  // while still letting a re-import recognise each one.
  const seen = new Map();
  for (const t of out.transactions) {
    const n = (seen.get(t.external_id) || 0) + 1;
    seen.set(t.external_id, n);
    if (n > 1) t.external_id = `${t.external_id}#${n}`;
  }
  return out;
}
