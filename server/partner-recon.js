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

/* ── Month boundaries ─────────────────────────────────────────────────────── */

// Settlement is monthly: "who owes what at the end of each month".
export function endOfMonth(dateish) {
  const d = dateish ? new Date(`${String(dateish).slice(0, 10)}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
