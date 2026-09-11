# Accounting in ReadyDoc — review pack for Lowry and Jake (11 September 2026)

One document for the process review: what is built, how it is meant to be used, what is and is not
connected to QuickBooks, and the decisions that are now ours to make. Nothing here is a proposal to build
more; it is a description of what exists so the process can be decided around it.

## 1. The map: where a money document lives

| Screen | What it holds | Who uses it | Since |
|---|---|---|---|
| **AP Drop** (own nav entry) | Every finance PDF or photo anybody hands in — vendor invoice, credit memo, remittance, M4 invoice pack. The queue the office works it through. | Anyone drops. The office (admin, office supervisors, or the *AP Drop → Edit* grant) works the queue. | 10 Sep |
| **Accounting → Accounts Payable** | One row per vendor bill: vendor, invoice #, PO, dates, amount, paid, status (draft → awaiting approval → approved → scheduled → paid / void). Files attached and searchable inside. | Jake / office. Grant `accounts-payable`. | Aug |
| **Accounting → Accounts Receivable** | One row per customer invoice: customer, invoice #, CO #, amount, received, status (unbilled → sent → partial → paid / void). | Office. Grant `accounts-receivable`. | Aug |
| **Accounting → Partner Reconciliation** | The M4 Dynamics netting: one ledger, both directions, one number both companies settle against. M4 sees it on a public link (`/partner/<token>`) and can upload their own documents as drafts and raise disputes — never approve, settle or void. | Office; M4 by link. | Aug |
| **Accounting → Reimbursements** | Personal-card spend: photograph the receipt, say what it was, the office approves and marks it paid in a payroll run. | Everyone files their own; office decides. | Aug |
| **Accounting → Banking** | Bank accounts, statement import (CSV / OFX), matching lines to AP/AR, closing a month only when the difference is zero and nothing is unexplained. | Office / admin. Grant `banking`. | Aug |
| **Accounting → QuickBooks** (admin) | The read-only bridge: a live API sync *when configured*, and the report-export importers that loaded the books without it. | Admin. | Aug |
| **Supply Orders** (Office) | Purchasing for the office: orders, partial receipts by quantity, invoices with the total read off the PDF and the line it came from. | Marnee / office. | Aug, extended 31 Aug |

Three things that are *not* accounting but touch it: **Receiving** (goods in, inspection # and PO on every
line), **Pay / Time Tracking** (hours to ADP; not in scope here), and the **COA lab submissions** (CTLA
invoices arrive as vendor bills like any other).

## 2. What shipped recently

- **10 Sep — AP Drop.** One intake for every finance document, from anyone, with a queue and statuses
  (`new → triaged → matched → in QuickBooks → in payment run → paid / closed`, plus `needs info`,
  `possible duplicate`, `not finance` — each of those three requires a reason). The file is stored and
  hashed first; the reader fills blank fields (vendor, invoice #, dates, total, PO/CO) from the document and
  shows the line each value came from; a typed field is never overwritten. The same file dropped twice in
  30 days is flagged as a duplicate and linked, not silently dropped. **11 Sep:** a paper invoice can be
  photographed straight from the phone (camera or camera roll), like a reimbursement receipt.
- **31 Aug — Supply Orders.** Partial receipt by quantity ("1 of 3 arrived", corrections as negative
  entries with a reason); invoice totals read off the uploaded PDF, offered to the order rather than applied.
- **27 Aug — M4 settlement wording.** The settlement line reads the way it is explained aloud: *they owe us
  X (less manufacturing credit C) = Y − we owe them Z = net*. Same arithmetic, regrouped; each row carries
  its category and description.
- **18–19 Aug — Partner ledger.** Real line summaries on each document, an amount cross-check against the
  file, reminder nudges, and the whole thing usable on a phone.
- **17 Aug — the foundation:** AP/AR ledgers, Partner Reconciliation + M4 portal, Reimbursements, Banking &
  Reconciliation, the QuickBooks read-only sync, and the QuickBooks report importers.

## 3. How the system is designed to work — the flows

**A vendor invoice (AP).**
1. It arrives — emailed to somebody, forwarded to `ap@powder-ops.com`, or on paper.
2. Whoever has it **drops it** (AP Drop: drag the PDF, or photograph the paper). It lands in the queue as
   `new` with whatever the reader could pull off it. Duplicates are flagged.
3. The office **triages** it: confirm vendor / number / amount / due date, match it to a PO or CO, or mark
   it `needs info` (with the question) or `not finance` (with why).
4. The bill is **entered in QuickBooks by the Controller, outside ReadyDoc** — ReadyDoc never creates a
   QuickBooks bill. The QuickBooks bill id is written back onto the drop (`in QuickBooks`).
5. It goes into a **payment run**, then `paid`. The drop is closed; the file, the activity log and every
   status change stay as the record.

Today the AP *ledger* (Accounts Payable tab) is a separate table populated from QuickBooks exports and
by hand. **AP Drop does not create an AP ledger row.** Whether it should — or whether the ledger goes —
is decision 1 below.

**A customer invoice (AR).** Raised outside ReadyDoc (QuickBooks / Shopify / M4 pack); recorded on the AR
tab by hand or by import; marked sent → partial → paid as money lands; matched from the bank statement in
Banking. An M4 invoice is instead a document on the Partner ledger, where it nets.

**The M4 netting (monthly).** Both companies' invoices go on one ledger (`receivable` = they owe us,
`payable` = we owe them). A document counts only once it is approved as **final**; a **dispute** takes one
row out without blocking the rest; Net-30 decides what is *due* this period. One number comes out, with the
report of everything left out and why. **Settling** freezes the exact set of documents — immutable.

**A reimbursement.** Photograph the receipt → say what it was → office approves → paid in a payroll run
with the period and reference stamped. A missing receipt never blocks the claim; it shows amber until added.

**Bank reconciliation (monthly).** Import the statement → lines auto-match to AP/AR only when the amount
*and* a second identifier agree (vendor or invoice # in the description) → everything else is matched or
explained by hand ("bank fee") → the period closes only at a zero difference with nothing unexplained.
Closed periods are frozen; reopening needs an admin, a reason, and newest-first.

## 4. QuickBooks — what is and is not connected

| Thing | State | Notes |
|---|---|---|
| **Live API sync** | **Not connected.** | Built and tested against a stand-in company; read-only by construction (there is no code that writes to QuickBooks). Needs the four `QBO_*` credentials on the server, which means an Intuit app that passed review. |
| **Intuit app review** | **Rejected once, on relevance.** | A description problem, not an app problem — the resubmission wording is drafted in `docs/quickbooks-app-assessment.md`. |
| **Report-export imports** | **Working; used once.** | 164 accounts, 370 vendors, 31 customers, 737 bills, 160 invoices back to 2022 loaded from QuickBooks' own reports. AP matched the aging report to the cent ($112,012.56 open across 5 bills). Re-running is idempotent. |
| **Writes to QuickBooks** | **None, by design.** | AP Drop stores `qbo_bill_id` / `external_ref` when the Controller links one. No bill, payment or journal is ever created from ReadyDoc. |
| **Bank feed (Plaid)** | **Not connected.** | Statement import works without it and is the intended path until decided otherwise. |
| **MRPEasy → QuickBooks journal feed** | **Dead since 30 April 2026.** | 568 of the 592 journal entries since 2022 were MRPEasy's inventory/WIP/COGS postings. Nothing has posted them since. The plant is moving to Keychain. |
| **`ap@powder-ops.com`** | **Not read by ReadyDoc.** | AP Drop records `source = email` for a row that came that way, but nothing ingests the mailbox yet. Somebody forwards or drops. |

**What ReadyDoc does not do, and is not pretending to:** no general ledger, no financial statements, no
depreciation, no fixed-asset register, no payroll journal, no bill pay. Stage 3 in the accountant brief
stops exactly here until the accountant's four questions are answered.

## 5. Who can do what

| Action | Who |
|---|---|
| Drop a finance document, see their own drops | Anyone set up in Settings |
| Work the AP Drop queue (statuses, corrections, `not finance`) | Admins, office/admin supervisors, or the `AP Drop → Edit` grant ("the finance flag") |
| Read / edit the AP and AR ledgers | The `accounts-payable` / `accounts-receivable` grants (view or edit) |
| Approve a partner document as final, settle a period, issue an M4 link | Admins and office supervisors only |
| Approve and pay reimbursements | Admins and office supervisors only |
| Match bank lines, close a period | Admins and office supervisors; reopening is admin-only with a reason |
| QuickBooks tab, imports, sync | Admins only |

## 6. Decisions for the review

1. **The AP / AR ledger tabs.** With AP Drop as the intake and QuickBooks still the book of record, does
   the AP ledger earn its place? Options: (a) retire both tabs; (b) keep them as the QuickBooks mirror only
   (fed by import/sync, never typed); (c) have a drop create the AP row when it reaches `in QuickBooks`.
   Nothing in ReadyDoc depends on the ledgers except Banking's matching, which can match against drops
   instead. *Jake's call on whether he uses them.*
2. **Who holds the finance flag.** Jake, Marnee, Carol? Everybody else can drop and see their own.
3. **The `ap@` inbox until it is ingested.** Who reads it and drops what arrives — or does it forward to
   the Controller bot? Building mailbox ingestion is a separate piece of work.
4. **The status vocabulary.** `triaged → matched → in QuickBooks → in payment run → paid` was written to
   match a Controller-bot process. Does it match Jake's actual week? Rename before people learn it.
5. **QuickBooks API: resubmit or stay on exports.** Exports cost a monthly download and a click; the API
   costs the Intuit review and a paid production key, and buys the bills arriving on their own.
6. **Bank feed.** Same shape: Plaid (paid, automatic) vs statement CSV monthly (free, manual).
7. **What the Controller bot is expected to do.** It can poll `audit log → ap_drop / create` for new
   drops and write back the QuickBooks bill id. Anything more (auto-triage, payment runs) is undesigned.
8. **Inventory and COGS since 30 April.** Not a ReadyDoc question, but the biggest open accounting
   question on the table: where is it happening now, and what does Keychain change?
9. **Reimbursement cadence.** Which payroll run picks them up, and who presses Pay.
10. **The M4 monthly close.** Who approves documents as final, who settles, and whether M4 gets the portal
    link now.

## 7. Where the detail is

`docs/accountant-brief.md` (the accountant email and the staging table), `docs/quickbooks-api-setup.md`,
`docs/quickbooks-app-assessment.md`, and in `docs/v2/decisions.md` D-073 (AP Drop). The verifications that
prove each module: `verify:apdrop`, `verify:apdropui`, `verify:reimbursements`, and the partner / banking /
QuickBooks assertions recorded in `CLAUDE.md` under their sections.
