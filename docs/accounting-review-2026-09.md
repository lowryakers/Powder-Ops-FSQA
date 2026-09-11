# Accounting in ReadyDoc — review pack for Lowry and Jake (11 September 2026)

One document for the process review: what is built, how it is meant to be used, what is and is not
connected to QuickBooks, and the decisions that are now ours to make. Nothing here is a proposal to build
more; it is a description of what exists so the process can be decided around it.

## 1. The map: where a money document lives

| Screen | What it holds | Who uses it | Since |
|---|---|---|---|
| **AP Drop** (own nav entry) | Every finance PDF or photo anybody hands in — vendor invoice, credit memo, remittance, M4 invoice pack. The queue the office works it through. | Anyone drops. The office (admin, office supervisors, or the *AP Drop → Edit* grant) works the queue. | 10 Sep |
| ~~Accounting → Accounts Payable~~ | **Hidden 11 Sep (decision 1, settled).** It duplicated QuickBooks. The table and screen still exist in the code behind no tab. | — | Aug–11 Sep |
| ~~Accounting → Accounts Receivable~~ | **Hidden 11 Sep**, same reason. | — | Aug–11 Sep |
| **Accounting → Partner Reconciliation** | The M4 Dynamics netting: one ledger, both directions, one number both companies settle against. M4 sees it on a public link (`/partner/<token>`) and can upload their own documents as drafts and raise disputes — never approve, settle or void. | Office; M4 by link. | Aug |
| **Accounting → Reimbursements** | Personal-card spend: photograph the receipt, say what it was, the office approves and marks it paid in a payroll run. | Everyone files their own; office decides. | Aug |
| ~~Accounting → Banking~~ | **Hidden 11 Sep.** Bank reconciliation is QuickBooks' job, and this matched against the ledgers being retired. | — | Aug–11 Sep |
| ~~Accounting → QuickBooks~~ | **Hidden 11 Sep.** No sync and no report import into ReadyDoc any more; QuickBooks stays the book of record. | — | Aug–11 Sep |
| **Supply Orders** (Office) | Purchasing for the office: orders, partial receipts by quantity, invoices with the total read off the PDF and the line it came from. | Marnee / office. | Aug, extended 31 Aug |

Three things that are *not* accounting but touch it: **Receiving** (goods in, inspection # and PO on every
line), **Pay / Time Tracking** (hours to ADP; not in scope here), and the **COA lab submissions** (CTLA
invoices arrive as vendor bills like any other).

## 2. What shipped recently

- **11 Sep — One drop, scanned, routed.** An M4 document dropped into AP Drop is recognised (vendor,
  bill-to, what the submitter typed, or the filename) and becomes a **draft** on the Partner Reconciliation
  ledger with its own copy of the file. The drop stays in the queue with an M4 chip and names the ledger
  document. A document that only *mentions* M4 in its text is parked as `needs info` "M4 Dynamics partner?"
  and the office answers with one button. The same file twice, or the same number and amount already on the
  ledger, links the existing document rather than filing a second. Nothing is approved, settled or voided
  by this; that stays on the ledger. Jake's re-keying step is gone.
- **11 Sep — The ledger tabs are hidden.** Accounts Payable, Accounts Receivable, Banking and QuickBooks
  are off the Accounting hub, their grants off Settings, and the QuickBooks / Plaid rows off Integrations.
  Nothing pulls from QuickBooks into ReadyDoc any more. The code stays; putting a tab back is one line.
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

**AP Drop is where it stops.** There is no AP ledger row and no QuickBooks bill created from ReadyDoc;
the bill is entered in QuickBooks outside, and its id is written back onto the drop.

**An M4 document (either direction).** Dropped like any other → the reader recognises M4 on the vendor or
bill-to line, in what was typed, or in the filename → a **draft** is filed on the Partner Reconciliation
ledger with the same file (payable when M4 billed us, receivable when we billed them) → the drop stays on
the queue and says which ledger document it became → on the ledger the office approves it as final when the
work behind it happened, disputes it, or lets it net. A mention of M4 in the text alone asks "M4 partner?"
on the queue instead of filing anything.

**A customer invoice (AR).** Raised and collected outside ReadyDoc (QuickBooks / Shopify). The AR tab is
hidden; an M4 invoice is a document on the Partner ledger, where it nets.

**The M4 netting (monthly).** Both companies' invoices go on one ledger (`receivable` = they owe us,
`payable` = we owe them). A document counts only once it is approved as **final**; a **dispute** takes one
row out without blocking the rest; Net-30 decides what is *due* this period. One number comes out, with the
report of everything left out and why. **Settling** freezes the exact set of documents — immutable.

**A reimbursement.** Photograph the receipt → say what it was → office approves → paid in a payroll run
with the period and reference stamped. A missing receipt never blocks the claim; it shows amber until added.

**Bank reconciliation.** Done in QuickBooks. ReadyDoc's Banking tab is hidden.

## 4. QuickBooks — what is and is not connected

| Thing | State | Notes |
|---|---|---|
| **Live API sync** | **Not connected, and no longer offered.** | Decided 11 Sep: nothing pulls from QuickBooks into ReadyDoc. The code exists with no door; the Intuit app review is moot. |
| **Report-export imports** | **Withdrawn 11 Sep.** | Used once in August (the books to 2022 loaded to the cent). The importer code stays; the QuickBooks tab that offered it is hidden. |
| **Writes to QuickBooks** | **None, by design.** | AP Drop stores `qbo_bill_id` / `external_ref` when the Controller links one. No bill, payment or journal is ever created from ReadyDoc. |
| **Bank feed (Plaid)** | **Not connected; Banking hidden.** | Bank reconciliation stays in QuickBooks. |
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
| Answer "M4 partner?" on a drop, or route a drop to the ledger by hand | The same people who work the queue |
| Approve a partner document as final, settle a period, issue an M4 link | Admins and office supervisors only |
| Approve and pay reimbursements | Admins and office supervisors only |

## 6. Decisions for the review

1. **The AP / AR ledger tabs.** ~~Does the AP ledger earn its place?~~ **Settled 11 Sep: (a), retired.**
   Both ledger tabs, Banking and the QuickBooks tab are hidden. AP Drop is the intake and stops there;
   QuickBooks is the book of record. M4 documents route themselves to the Partner ledger as drafts.
2. **Who holds the finance flag.** Jake, Marnee, Carol? Everybody else can drop and see their own.
3. **The `ap@` inbox until it is ingested.** Who reads it and drops what arrives — or does it forward to
   the Controller bot? Building mailbox ingestion is a separate piece of work.
4. **The status vocabulary.** `triaged → matched → in QuickBooks → in payment run → paid` was written to
   match a Controller-bot process. Does it match Jake's actual week? Rename before people learn it.
5. **QuickBooks API: resubmit or stay on exports.** **Settled 11 Sep: neither.** Nothing is pulled from
   QuickBooks into ReadyDoc.
6. **Bank feed.** **Settled 11 Sep: not in ReadyDoc.** Bank reconciliation stays in QuickBooks.
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
