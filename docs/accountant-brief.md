# Powder Ops — moving the books off QuickBooks Online

**For:** our accountant
**From:** Lowry Akers, Powder Ops
**About:** what we've already built, what we'd need from you, and what we'd want
you to push back on

---

## The short version

We run an in-house system called ReadyDoc that already handles our FSQA records,
production, and — over the last few months — our accounts payable, accounts
receivable, expense reimbursements, and the netting arrangement we have with M4
Dynamics. We have now added **bank reconciliation**: statements import, most
lines match themselves against our own AP/AR records, and a month can only be
closed when the difference is zero and nothing is left unexplained.

That covers the operational side. What it does **not** cover is the general
ledger, the financial statements, and the year-end package — the part you rely
on. Before we go anywhere near that, we want your view.

We're not trying to eliminate you from the process. We're trying to stop paying
for bookkeeping-shaped work that our own system can do, and keep paying you for
the part that actually needs an accountant.

---

## What ReadyDoc does today

**Accounts payable and receivable.** Bills and invoices with vendor/customer,
dates, terms, amounts, and the document attached. Uploaded PDFs are OCR'd, so
searching finds a number printed inside the invoice, not just what was keyed in.

**Bank reconciliation.** We import the statement (CSV or OFX/QFX — or connect
the bank directly through an aggregator). Lines are matched against open AP/AR
items and reimbursements. Two rules we deliberately enforce:

- Nothing auto-matches on amount alone. The amount has to agree **to the cent**
  *and* a second identifier — the vendor name or the invoice number appearing in
  the bank description — has to agree too. Anything less is offered as a
  suggestion for a person to accept.
- A period cannot be closed while the difference is non-zero **or** while any
  line is unexplained. A "no document — this was a bank fee" answer is a valid
  explanation and is recorded with the reason; simply ignoring the line is not
  possible.

Closed periods are immutable: the transactions are stamped into them and stop
being editable. Reopening requires an admin, a written reason, and it has to be
done newest-first, because each period's opening balance is the prior period's
close.

**Reimbursements.** Personal-card spend with a photographed receipt, approved
and then marked paid against a specific payroll run.

**Partner netting (M4 Dynamics).** We and M4 invoice each other constantly. The
system nets both directions into one monthly figure, applies Net 30 to decide
what's in and what lands next month, and reports every excluded document with
the reason. M4 has a read-only portal showing the same number.

**Audit trail.** Every write is logged with who, when, before and after. Bulk
actions are logged per record as well as in summary.

---

## What we have NOT built, and would want your view on

This is the real question for you. Roughly in order of how nervous it makes us:

### 1. General ledger and chart of accounts
We recently cleaned up our chart of accounts and finished catching up our
reconciling, which is why this feels like the right moment to ask. But we have
no double-entry ledger, no journal entries, no period-close mechanics beyond the
bank reconciliation described above.

**Questions:** Is a true double-entry GL necessary for our situation, or is a
well-structured transaction log with a mapping to accounts enough for you to
produce statements from? If we build it, what do you need it to enforce?

### 2. Financial statements
P&L, balance sheet, cash flow. We can generate these mechanically, but what
matters is whether the output is in a form you can work from without redoing it.

**Questions:** What format do you actually want — a trial balance export, a
specific report set, a particular file type? Would you rather receive raw
transaction data and build the statements yourself?

### 3. Accrual vs cash, and period cutoffs
Today our AP/AR records carry invoice dates and due dates, which supports
accrual treatment, but nothing enforces a cutoff.

**Questions:** Which basis do we file on? What cutoff discipline do you need at
month and year end?

### 4. Things we know we're not touching
- **Payroll** — that stays in ADP.
- **Sales tax** — we'd want to understand our exposure before assuming this is
  out of scope.
- **1099s / contractor reporting** — we have the vendor data but no 1099 logic.
- **Fixed assets and depreciation** — not modelled at all.
- **Multi-currency** — not applicable to us today.

**Question:** Is anything on that list a reason not to leave QuickBooks?

---

## What we'd need from you

1. **The list of reports you actually open.** Not everything QuickBooks can
   produce — the ones you use. That's the single most useful thing you can give
   us, because it defines the scope.
2. **What you need at year end**, in the form you want it.
3. **Your honest view on the risk.** If moving our books into an in-house system
   creates a problem for a filing, an audit, a lender, or a future sale, we'd
   rather hear it now. We're capable of building this; that isn't the same as it
   being the right idea.
4. **Whether a staged move makes sense** — for example, running ReadyDoc and
   QuickBooks in parallel for a quarter and comparing the outputs before we
   switch off the subscription.

---

## Our proposed staging

| Stage | What | Status |
|---|---|---|
| 1 | AP, AR, reimbursements, partner netting | **Done and in use** |
| 2 | Bank feed + reconciliation | **Done; needs a real statement to prove out** |
| 2b | Read-only pull of the QuickBooks data | **Done; waiting on the API credentials** |
| 3 | Chart of accounts + general ledger | **Not started — needs your input first** |
| 4 | Financial statements + year-end package | **Not started — depends on 3** |
| 5 | Turn off QuickBooks | Only after a parallel period you're satisfied with |

Stage 2b is worth a note, because it changes the shape of this conversation. We
can now connect to QuickBooks read-only and **count every kind of record in the
company** — how many bills, invoices, journal entries, deposits, transfers and
so on, and the date range each covers. So the question "how much accounting is
actually happening in there" stops being a matter of opinion. If the journal
entry count comes back near zero, stage 3 is mostly a reporting exercise; if
it's large, that is exactly the judgement we'd want you to price. We'll send you
that report before asking you for an estimate.

The same connection pulls a full copy of the bills, invoices, chart of accounts,
vendors and customers into ReadyDoc — so a parallel period (your point 4 above)
doesn't require anyone to re-key anything.

We're deliberately stopping at the boundary of stage 3 until we've heard from
you. The bookkeeping we're comfortable owning. The accounting judgement we're
not, and we'd rather ask than discover the difference at year end.

---

*Happy to give you a live walkthrough of what's built, or a read-only login, if
that's more useful than a document.*
