// X − Y = Z, and the paper trail for how we got there.
//
// Powder Ops and M4 Dynamics invoice each other constantly — flavours moving
// both ways, production run for each other — and it had stalled because each
// company was adding up its own emails and getting a different answer. This
// module is the single arithmetic: given the ledger, what is the one number
// owed at the end of a month, and exactly which documents made it.
//
// Everything here is a pure function of rows in / numbers out. It does not
// touch Express and it does not write. That is deliberate: the number is the
// thing both companies have to trust, so it should be possible to check it
// without standing up a server.

/* ── Signing ──────────────────────────────────────────────────────────────── */

// A credit note is the same document type pointing the other way: a credit in
// the receivable direction REDUCES what they owe us. Storing it as a positive
// amount with a type, rather than a negative amount, keeps "how much was this
// credit" answerable without reading a minus sign.
export const signedAmount = (d) => (d.doc_type === 'credit' ? -1 : 1) * Number(d.amount || 0);

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ── Due dates ────────────────────────────────────────────────────────────── */

// Net terms decide INCLUSION, not much else — which is the honest answer to
// "does this simplified view nullify Net 30". It doesn't: an invoice raised on
// the 28th isn't owed at month end, and sweeping it into this month's payment
// would be asking for money early. It sits out and lands next period, and the
// report says so by name.
export function dueDateFor(issued, termsDays) {
  const day = String(issued || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const n = Number.isFinite(Number(termsDays)) ? Number(termsDays) : 30;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ── Why a document is or isn't in the number ─────────────────────────────── */

export const EXCLUSION = {
  draft: 'Not finalised yet — the work behind it isn\'t confirmed done.',
  disputed: 'Disputed. It stays out of the number until it\'s agreed or corrected.',
  void: 'Voided.',
  not_due: 'Not due yet under the agreed terms — it lands in a later settlement.',
  settled: 'Already settled in an earlier payment.',
};

// One place decides eligibility, so the total and the report can never tell
// different stories about the same row.
export function classify(doc, asOf) {
  if (doc.settlement_id) return { included: false, reason: 'settled' };
  if (doc.status === 'void') return { included: false, reason: 'void' };
  if (doc.status === 'disputed') return { included: false, reason: 'disputed' };
  if (doc.status !== 'final') return { included: false, reason: 'draft' };
  const due = doc.due_date || dueDateFor(doc.issued_date, doc.terms_days);
  // No date at all means nothing can say it isn't owed yet — treat it as due
  // rather than silently parking money nobody is tracking.
  if (due && asOf && due > asOf) return { included: false, reason: 'not_due', due };
  return { included: true, due };
}

/* ── The number ───────────────────────────────────────────────────────────── */

// `asOf` is the settlement date — normally the last day of the month. Anything
// final and due on or before it counts; everything else is reported, not hidden.
export function reconcile(docs, asOf) {
  const included = { receivable: [], payable: [] };
  const excluded = [];

  for (const d of docs || []) {
    const c = classify(d, asOf);
    const row = { ...d, signed: round2(signedAmount(d)), due_date: c.due || d.due_date || null };
    if (c.included) included[d.direction].push(row);
    else excluded.push({ ...row, exclusion: c.reason, exclusion_note: EXCLUSION[c.reason] });
  }

  const sum = (rows) => round2(rows.reduce((t, r) => t + r.signed, 0));
  const receivable_total = sum(included.receivable);   // X — what they owe us
  const payable_total = sum(included.payable);         // Y — what we owe them
  const net_amount = round2(receivable_total - payable_total); // Z

  return {
    as_of: asOf,
    receivable_total,
    payable_total,
    net_amount,
    // Said in words as well as sign, because a negative number in a column
    // labelled "net" is the kind of thing two companies read differently.
    owed_to: net_amount > 0 ? 'us' : net_amount < 0 ? 'them' : 'nobody',
    amount_due: round2(Math.abs(net_amount)),
    documents: {
      receivable: included.receivable,
      payable: included.payable,
      excluded,
    },
    counts: {
      receivable: included.receivable.length,
      payable: included.payable.length,
      excluded: excluded.length,
      total: (docs || []).length,
    },
    // Grouped so the report can say "three disputed, two not due yet" without
    // the client re-deriving the same buckets.
    excluded_summary: ['disputed', 'draft', 'not_due', 'settled', 'void'].map(reason => {
      const rows = excluded.filter(r => r.exclusion === reason);
      if (!rows.length) return null;
      return {
        reason,
        note: EXCLUSION[reason],
        count: rows.length,
        receivable: sum(rows.filter(r => r.direction === 'receivable')),
        payable: sum(rows.filter(r => r.direction === 'payable')),
      };
    }).filter(Boolean),
  };
}

/* ── The credit facility ──────────────────────────────────────────────────── */

/**
 * WHAT A CREDIT MAY ABSORB, and the one rule that keeps it honest.
 *
 * A document is eligible only when it says so. `category` is nullable and is
 * never guessed from a description — a facility that covers production runs and
 * explicitly not the raw materials M4 buys would otherwise be drained by an
 * ingredient invoice that happened to mention a product name. Uncategorised is
 * NOT manufacturing; it is uncategorised, and it stays outside the credit until
 * somebody says what it is.
 *
 * Direction matters too: a credit granted against what they owe us cannot
 * reduce what we owe them.
 */
export function creditEligible(doc, credit) {
  if (!credit || credit.status !== 'active') return false;
  if (doc.direction !== credit.direction) return false;
  if (doc.doc_type === 'credit') return false;      // a credit note is not work to absorb
  return String(doc.category || '') === String(credit.applies_to || '');
}

/**
 * Draw the credit down across this period's eligible documents.
 *
 * PURE, and derived from `applied` rather than from a stored balance. Two
 * mechanisms describing one number is how a balance and its list of draws start
 * disagreeing, and on a $200,000 facility that argument is expensive.
 *
 * A document is absorbed in full or in PART: when only $3,000 of headroom is
 * left against a $10,000 run, the credit takes $3,000 and the remaining $7,000
 * is still owed. Rounding to cents each step, so the parts always sum to the
 * whole.
 */
export function applyCredit(result, credit, appliedToDate = 0) {
  const opening = round2(Number(credit?.amount || 0) - Number(appliedToDate || 0));
  const draws = [];
  let remaining = Math.max(0, opening);

  if (credit && credit.status === 'active' && remaining > 0) {
    const pool = credit.direction === 'payable' ? result.documents.payable : result.documents.receivable;
    for (const d of pool) {
      if (remaining <= 0) break;
      if (!creditEligible(d, credit)) continue;
      // `signed` is negative for a credit note; only positive work draws down.
      if (d.signed <= 0) continue;
      const take = round2(Math.min(remaining, d.signed));
      if (take <= 0) continue;
      draws.push({
        document_id: d.id, doc_number: d.doc_number, description: d.description,
        amount: take, covered_in_full: take >= d.signed, document_total: d.signed,
      });
      remaining = round2(remaining - take);
    }
  }

  const drawn = round2(draws.reduce((t, x) => t + x.amount, 0));
  // The credit reduces the side it was granted against, so the net moves toward
  // whoever holds it.
  const sign = credit?.direction === 'payable' ? 1 : -1;
  const net_after = round2(result.net_amount + sign * drawn);

  return {
    credit_id: credit?.id || null,
    label: credit?.label || null,
    applies_to: credit?.applies_to || null,
    direction: credit?.direction || null,
    facility: round2(Number(credit?.amount || 0)),
    applied_to_date: round2(Number(appliedToDate || 0)),
    opening_balance: opening,
    drawn_this_period: drawn,
    // What is left AFTER this period settles — the running balance the card shows.
    remaining_balance: round2(Math.max(0, opening - drawn)),
    draws,
    net_before_credit: result.net_amount,
    net_amount: net_after,
    owed_to: net_after > 0 ? 'us' : net_after < 0 ? 'them' : 'nobody',
    amount_due: round2(Math.abs(net_after)),
    // Named so the report can say why an eligible-looking document was not
    // absorbed, rather than leaving somebody to work it out from the totals.
    ineligible: (credit?.direction === 'payable' ? result.documents.payable : result.documents.receivable)
      .filter(d => !creditEligible(d, credit) && d.signed > 0)
      .map(d => ({
        document_id: d.id, doc_number: d.doc_number, description: d.description, amount: d.signed,
        // The current value travels with the row so the screen can offer to
        // change it in place, rather than sending someone to find the document.
        category: d.category || null,
        reason: !d.category ? 'uncategorised' : `category is ${d.category}`,
      })),
  };
}

/* ── Month boundaries ─────────────────────────────────────────────────────── */

// Settlement is monthly: "who owes what at the end of each month".
export function endOfMonth(dateish) {
  const d = dateish ? new Date(`${String(dateish).slice(0, 10)}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
