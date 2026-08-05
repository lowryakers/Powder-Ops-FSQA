// Which document is this bank line?
//
// This is the piece that turns "download the statement and go through it" into
// "check the handful it wasn't sure about", which is the whole point of doing
// reconciliation here rather than paying for it.
//
// Pure functions: candidates in, ranked suggestions out. No Express, no
// database, no writes — so the scoring can be reasoned about and tested
// without standing anything up, the same rule as partner-recon.js.
//
// THE GOVERNING RULE: a wrong match is worse than no match. An unmatched line
// is visible and costs somebody thirty seconds; a confidently wrong one is
// invisible and ends up in a tax return. So the amount has to agree to the
// cent before anything is offered at all, and `AUTO_THRESHOLD` is set where a
// second, independent identifier also agrees.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ── Text ─────────────────────────────────────────────────────────────────── */

const STOP = new Set([
  'the', 'and', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'payment', 'pmt',
  'purchase', 'pos', 'ach', 'debit', 'credit', 'card', 'online', 'transfer',
  'deposit', 'withdrawal', 'check', 'bill', 'invoice', 'ref', 'id', 'des', 'indn',
]);

export function words(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

// How much of the document's own name shows up in the bank's description.
// Bank descriptions are shouty and truncated ("SQ *HOME DEPOT 4471 SAN"), so
// this is deliberately a containment score rather than a similarity one.
export function nameOverlap(description, name) {
  const target = words(name);
  if (!target.length) return 0;
  const hay = ` ${String(description || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hits = target.filter(w => hay.includes(` ${w} `) || hay.includes(w)).length;
  return hits / target.length;
}

// An invoice or check number appearing in the description is strong evidence —
// banks pass reference numbers through on ACH and check payments. Short
// numbers are ignored: a 3-digit "PO 12" matches by accident constantly.
export function referenceHit(description, reference) {
  const ref = String(reference || '').replace(/[^A-Za-z0-9]/g, '');
  if (ref.length < 4) return false;
  const hay = String(description || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return hay.includes(ref.toLowerCase());
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

// Beyond this, an obvious pair is applied without asking. It sits above what
// an exact amount alone can reach, so a lone coincidence of value can never
// auto-match — there has to be a name or a reference agreeing too.
export const AUTO_THRESHOLD = 0.9;

// How far apart a payment and its document may sit. A bill paid the day it was
// raised and one paid ninety days later are both ordinary; beyond that the
// coincidence of amount stops being evidence.
const MAX_DAYS = 120;

const daysBetween = (a, b) => {
  const d1 = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const d2 = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  return Math.round(Math.abs(d1 - d2) / 86400000);
};

/**
 * Score one candidate document against one bank transaction.
 *
 * `txn`       { posted_date, amount (signed), description }
 * `candidate` { type, id, label, amount (positive), date, direction: 'in'|'out',
 *               reference }
 *
 * Returns null when the pair is impossible — wrong direction, wrong amount, or
 * too far apart in time — rather than a low score. A suggestion list that
 * includes things that cannot be right is a list people stop reading.
 */
export function scoreCandidate(txn, candidate) {
  const moneyOut = Number(txn.amount) < 0;
  const wantOut = candidate.direction === 'out';
  if (moneyOut !== wantOut) return null;

  const txnAbs = round2(Math.abs(Number(txn.amount)));
  const candAbs = round2(Math.abs(Number(candidate.amount)));
  // To the cent. A near-miss on money is not a match, it is a different
  // transaction — partial payments are handled by splitting a match by hand,
  // not by loosening this.
  if (txnAbs !== candAbs || txnAbs === 0) return null;

  const gap = daysBetween(txn.posted_date, candidate.date);
  if (gap !== null && gap > MAX_DAYS) return null;

  // Amount agreeing exactly is the floor. It is deliberately below
  // AUTO_THRESHOLD: on its own it is a suggestion, never an answer.
  let score = 0.6;
  const reasons = ['the amount matches to the cent'];

  const overlap = nameOverlap(txn.description, candidate.label);
  if (overlap >= 0.6) { score += 0.25; reasons.push(`"${candidate.label}" appears in the bank description`); }
  else if (overlap >= 0.3) { score += 0.12; reasons.push('part of the name appears in the bank description'); }

  if (referenceHit(txn.description, candidate.reference)) {
    score += 0.25;
    reasons.push(`reference ${candidate.reference} appears in the bank description`);
  }

  if (gap !== null) {
    if (gap <= 3) { score += 0.1; reasons.push(gap === 0 ? 'same day' : `${gap} day${gap === 1 ? '' : 's'} apart`); }
    else if (gap <= 14) { score += 0.05; reasons.push(`${gap} days apart`); }
    else reasons.push(`${gap} days apart`);
  }

  return {
    ...candidate,
    score: Math.min(1, round2(score)),
    days_apart: gap,
    reasons,
  };
}

/**
 * Rank every candidate for one transaction.
 *
 * `auto` is true only when the best suggestion is confident AND clearly ahead
 * of the runner-up. Two documents for the same amount from the same vendor is
 * exactly the case a human has to settle — applying the first one because it
 * sorted higher is how a payment lands on the wrong invoice.
 */
export function suggestFor(txn, candidates, { autoThreshold = AUTO_THRESHOLD } = {}) {
  const scored = (candidates || [])
    .map(c => scoreCandidate(txn, c))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (a.days_apart ?? 999) - (b.days_apart ?? 999));

  const best = scored[0] || null;
  const runnerUp = scored[1] || null;
  const decisive = !!best && (!runnerUp || best.score - runnerUp.score >= 0.15);

  return {
    suggestions: scored.slice(0, 5),
    best,
    auto: !!best && best.score >= autoThreshold && decisive,
    // Said out loud so the screen can explain why it stopped short of matching
    // something that otherwise looks right.
    ambiguous: !!best && best.score >= autoThreshold && !decisive,
  };
}

/**
 * Run a whole statement. Returns a plan; writes nothing.
 *
 * A candidate already consumed by an auto-match is withdrawn from the pool, so
 * two identical bank lines can't both auto-match the same invoice.
 */
export function planMatches(transactions, candidates, opts = {}) {
  const pool = new Map((candidates || []).map(c => [`${c.type}:${c.id}`, c]));
  const plan = [];

  // Highest-confidence pairs first, so an obvious match claims its document
  // before a weaker contender for the same one is considered.
  const ranked = (transactions || []).map(t => ({ txn: t, ...suggestFor(t, [...pool.values()], opts) }))
    .sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0));

  for (const row of ranked) {
    // Re-score against what is still available.
    const fresh = suggestFor(row.txn, [...pool.values()], opts);
    if (fresh.auto && fresh.best) pool.delete(`${fresh.best.type}:${fresh.best.id}`);
    plan.push({ transaction_id: row.txn.id, ...fresh });
  }
  return plan;
}

/* ── Reconciling ──────────────────────────────────────────────────────────── */

/**
 * Does the account agree with the statement?
 *
 *   opening + everything cleared on or before the period end === statement
 *
 * `difference` is the number Jake is actually chasing, and it is reported
 * rather than absorbed: a reconciliation that closes with a difference is not
 * a reconciliation.
 */
export function reconcile({ openingBalance, statementBalance, transactions, periodEnd }) {
  const cleared = (transactions || []).filter(t =>
    !t.pending && String(t.posted_date).slice(0, 10) <= String(periodEnd).slice(0, 10));
  const clearedTotal = round2(cleared.reduce((sum, t) => sum + Number(t.amount || 0), 0));
  const computed = round2(Number(openingBalance || 0) + clearedTotal);
  const difference = round2(Number(statementBalance || 0) - computed);

  return {
    period_end: periodEnd,
    opening_balance: round2(openingBalance),
    cleared_total: clearedTotal,
    computed_balance: computed,
    statement_balance: round2(statementBalance),
    difference,
    balanced: difference === 0,
    transaction_count: cleared.length,
    // Anything still unaccounted for on or before the period end. A period
    // closed over these would be hiding the exact thing it exists to surface.
    unresolved: cleared.filter(t => t.status === 'unmatched').length,
  };
}
