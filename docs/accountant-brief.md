# Powder Ops — email to the accountant

Short on purpose. The long version of this conversation is a meeting, not a document.

---

**Subject:** Moving our bookkeeping in-house — four questions

Hi [name],

We've built our accounts payable, receivable, expense reimbursements, the M4
netting and bank reconciliation into ReadyDoc, our own system. It's live and in
use. QuickBooks is still the system of record and nothing has changed on your
side.

Before going further I pulled the Journal, all dates, and counted it. Of **592
journal entries since 2022, 568 are MRPEasy** — the automated inventory, WIP and
COGS postings, which stop at **30 April 2026** when the integration came out.
The genuine accounting is **24 entries in four years**: year-end depreciation,
the intercompany reclasses to Prodough and Matt, and a handful of corrections.
Trial balance ties at $11.8m.

So the bookkeeping looks like something we can own, and the accounting doesn't.
That's the split we'd like to formalise — stop paying for the first, keep paying
you for the second.

**Four questions:**

1. **Which reports do you actually open?** Not what QuickBooks can produce — the
   ones you use. That defines what we'd have to reproduce.
2. **What do you need at year end**, in the form you want it?
3. **Does anything here worry you** — a filing, an audit, a lender, a future
   sale? We're able to build this; that isn't the same as it being wise.
4. **Since the MRPEasy feed came out on 30 April, where is the inventory and
   COGS accounting happening now?** Nothing has posted WIP or cost of goods
   since. We're also moving off MRPEasy to Keychain, so whatever the answer is,
   we'd rather design for it than rebuild the old link.

If it's easier, a 30-minute call beats a reply.

Thanks,
Lowry

---

## Backup — if he asks for detail

**What ReadyDoc already does.** AP and AR with the documents attached and OCR'd
so search finds a number printed inside a PDF. Expense reimbursements. The M4
Dynamics netting, computed one way for both companies. Bank reconciliation:
statements import, lines match against our own AP/AR, and a month can only close
when the difference is zero and nothing is unexplained. Closed periods are
immutable; reopening takes an admin, a written reason, and has to be done
newest-first.

**What it does not do.** No general ledger, no financial statements, no
depreciation schedules, no fixed asset register, no payroll journal. That's the
part in question.

**What we have loaded already**, from QuickBooks report exports: 164 accounts,
370 vendors, 31 customers, 737 bills and 160 invoices back to 2022. AP shows
$112,012.56 open across 5 bills, matching the aging report to the cent. Nothing
outstanding on AR.

**Two things he may spot.** One bill is dated 09/22/2002 (Canyon Overhead Doors,
$1,244.75) — almost certainly a 2022 typo, imported as-is rather than silently
corrected. And the same supplier appears as both "M4 Dynamic" and "V00301 M4
Dynamic" depending on the report.

**Our proposed staging.**

| Stage | What | Status |
|---|---|---|
| 1 | AP, AR, reimbursements, M4 netting | Done, in use |
| 2 | Bank reconciliation | Done |
| 2b | Books copied out of QuickBooks | Done |
| 3 | Chart of accounts + general ledger | Needs his answers, and the inventory/COGS question |
| 4 | Financial statements + year-end | Depends on 3 |
| 5 | Turn off QuickBooks | Only after a parallel period he's happy with |

We're stopping at the edge of stage 3 until we've heard back.
