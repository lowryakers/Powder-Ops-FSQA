# The weekly bill pay process (the payment run)

How a bill gets from someone's inbox to paid, how ProDough pays Powder Ops for materials and production each week,
and who does what. This describes ReadyDoc as of 18 November 2026 (decisions D-360 to D-365).

The one rule underneath all of it: **ReadyDoc never pays anything and never writes to QuickBooks.** People pay in
QuickBooks, the bank and Bill Pay, as they do today. ReadyDoc keeps the list, runs the checks, gets Danny's approval
and records what was done, so nothing paid is left open and nothing open is forgotten.

---

## Who does what

| Person | Role in the process |
|---|---|
| **Anyone at the plant** | Drops a bill into **AP Drop** (Accounting → AP Drop) or forwards it to ap@powder-ops.com. |
| **The office (whoever works the AP queue)** | Triages each bill, enters it in QuickBooks, records the QBO bill number, confirms each bill's class. Records closed MOs and shipped orders for production invoices. |
| **Lowry** | Keeps the must-pay list. Types the bank balance, unless the bank feed supplies it. Checks the run before it goes to Danny. Is told about every failed check and every held production order. |
| **Danny (ProDough)** | Approves the run on a texted link. Sends the transfer and says so on the same page. |
| **The Controller** (named in the payment run settings) | Confirms the transfer landed. Records how each bill was paid. Creates the Deposit invoice and the production invoices in QuickBooks and records their numbers. Closes the run. |
| **An admin** | Can do anything the Controller can. Chooses the settings: who is the Controller, who is notified, Danny's number, the price list column. |

Bots can read most of this but cannot confirm a class, prepare or send a run, approve, record a payment, record a
production order or close anything. Each of those is a person's act, with their name on it.

---

## The week at a glance

```
Mon–Wed  Bills arrive → AP Drop → triaged → entered in QBO → class confirmed
         Closed MOs / shipped orders recorded → production invoices created in QBO
Run day  8 AM (Thursday) or noon (Friday in a payroll week): the run is frozen and Lowry is asked to check it
         Lowry checks → "Send to Danny" → Danny gets a text with a link
         Danny approves → sends the transfer → taps "I've sent $X"
Fri 10AM One reminder to Danny if he has not approved
After    Controller confirms the transfer landed → records each bill paid → Deposit invoice → closes the run
Monday   8 AM digest: any run not yet closed, held production orders, invoices not yet created in QBO
```

**Run day.** A normal week runs on **Thursday**. A payroll week runs on **Friday at noon**. Payroll is every two weeks,
starting Monday 23 November 2026.

---

## Step 1: A bill comes in (AP Drop)

1. **Someone drops the PDF into AP Drop** or forwards it to ap@powder-ops.com. ReadyDoc stores the file and its
   fingerprint **before** it reads anything, so an upload that cannot be read is still filed.
2. **ReadyDoc reads the bill.** It fills in blank fields only: vendor, number, date, due date, total. It never
   overwrites something a person typed, and it shows the line on the bill each value came from.
3. **Duplicates are flagged, never deleted.**
   - The same file within 30 days is marked a possible duplicate.
   - A near-duplicate is also flagged: same vendor, same number, same amount within $1, within 24 hours.
4. **M4 bills go to Partner Reconciliation,** not the payment run. A bill naming M4 Dynamics is routed to that ledger.
5. **The office triages the bill:** new → triaged → **in QBO**.
   - A bill reaches **in QBO** only with its **QuickBooks bill number** recorded. Only bills entered in QuickBooks can
     be paid through the run.

---

## Step 2: The payment run list builds itself (Accounting → Payment run)

Until the run is frozen, the list is worked out fresh every time the page opens. Every **in QBO** bill with a QBO bill
number is on it. Anything earlier in AP Drop is counted as "not in QuickBooks yet" and is not payable.

### Each bill is either a ProDough material or a Powder Ops expense

ReadyDoc suggests the class from the vendor's last confirmed class, the supplier type and the PO. **Only a person's
confirmation counts.** A bill with no confirmed class cannot be paid this week.

- **ProDough material:** ProDough pays it back at cost through the weekly Deposit invoice.
- **Powder Ops expense:** Powder Ops pays it. If our bank balance does not cover the expenses, the difference is the
  **shortfall**, and ProDough covers that too.

### The checks every bill goes through

All of these live in one place, so the page, the run and the messages always agree.

**Keep the bill off the run (it fails):**
- No confirmed class.
- No amount.
- Not addressed to Powder Ops.
- A duplicate.
- **Bank details on the bill differ from the ones on file.** Changed bank details are how invoice fraud works.
  An admin can record new details only after calling the vendor on a number already on file. The admin notes the
  call and enters their password.

**Flag the bill but keep it on the run.** Highlighted flags come first:
- **Highlighted:**
  - A new vendor.
  - More than 10% over the PO.
  - Three times the usual amount.
  - Addressed to ProDough.
  - Bill-to could not be read.
  - Overdue.
  - A possible duplicate with no number.
  - A line quantity more than 20% over the PO.
  - A unit price more than 10% over the PO.
  - Bank details printed but none on file.
- **Noted:**
  - 2–10% over the PO.
  - No due date.
  - The same amount as an earlier bill but its own number (often a repeat delivery).
  - A line quantity under the PO (a part delivery).
  - A unit price 2–10% over the PO.
  - A line that is not on the PO.

When a bill first fails, Lowry and the bill's owner get one ReadyBot message saying why. These failures are also the
weekly score, by the week each was logged.

### Must-pays

Lowry keeps a **must-pay** list (rent, payroll-related, utilities and the like). A must-pay is always on the run and
locked. It skips the PO and receiving checks, and Danny cannot untick it. It is retired with a reason, never deleted.

---

## Step 3: The run is frozen and Lowry checks it

On run day (8 AM Thursday, or noon Friday in a payroll week) ReadyDoc **freezes** the run. It copies the bills, their
flags and the totals into a fixed record. Correcting a bill after that does not change what Danny sees. To change it,
cancel the run and prepare it again.

**What ProDough owes** is worked out once and shown to everyone the same way:

```
ProDough owes = Deposit (materials at cost)
              + open production invoices (Step 6)
              + shortfall (Powder Ops expenses − our bank balance, only if above zero)
```

For example: *"ProDough owes Powder Ops $46,900: materials $31,480 + 2 production runs $15,420."*

- **The bank balance** is typed by Lowry on the run, or earlier in the week. If a bank account is linked, the page
  offers "Use the bank feed: $X" instead. A run cannot be sent without a balance.
- **Lowry checks it.** While "check before sending" is on (the default), he is asked to look at the frozen run.
  Pressing **"Checked: send to Danny"** is the check and the send in one.
- If that setting is off, the run goes to Danny by itself, provided a bank balance was entered that week.

An **urgent run** works the same way. An admin picks the bills, which can include bills not due yet, and gives a reason.

---

## Step 4: Danny approves on his phone

1. **Danny gets a text with a link.** It works like a flavor approval: a page with the details and one button.
   - The link works once and expires in five days.
   - Sending again, or the reminder, issues a new link and kills the old one.
   - If Twilio is not set up, the link is shown so someone can text it by hand.
2. **On the page he sees** what ProDough owes first, then each bill with its flags first. Must-pays are locked. He can
   untick any other bill.
3. **He types his name and approves.** The ticked bills move to **in payment run**. Unticked bills go back on next
   week's list.
4. **He sends the transfer and taps "I've sent $X".** Lowry and the Controller are told. They are also told if the
   amount sent is not the amount approved.
5. **No approval by Friday 10 AM** (or four hours after a later send): one reminder text to Danny with a new link, and
   one note to Lowry.

Every step he takes is logged with his name, address and device.

---

## Step 5: Closing out the run (Controller)

Each approved run has a **close-out** section. It shows what is done and what is still open, in this order:

1. **Confirm the transfer landed.** A person confirms it. The bank feed can only offer matching deposits: money in,
   within a cent, since the day before Danny said he sent it. Nothing matches itself. No bill can be marked paid until
   this is done.
2. **Pay each bill, the way we pay today,** then record how it was paid:
   - **How:** QBO Bill Pay ACH, Powder Ops debit card (Billtrust / QBO link), check, or other.
   - **Date and reference.**
   - **Proof** (a PDF or photo). It is stored once and fingerprinted.
   - **The QBO payment number**, once it is marked paid in QuickBooks.

   Recording it moves the bill to **paid** in AP Drop.
   - **A bill that cannot be paid this week** is sent back with a reason. It returns to "in QBO" and appears on next
     week's list.
3. **The Deposit invoice.** Create the week's Deposit invoice to ProDough (the materials total) in QuickBooks and
   record its number here.
   - **Transfer mode** (the default): the confirmed transfer pays the Deposit.
   - **Manual mode:** a person marks it paid. This setting can be switched while the accountants decide.
4. **Production invoices on this run** (Step 6) are paid the same way: by the transfer in transfer mode, or marked
   paid one by one in manual mode.
5. **The shortfall** is booked.
6. **Close.** The run will not close while anything is open, and the refusal names each item.

**Every Monday at 8 AM** the notify list and the Controller get one message listing every approved run not yet closed
and what is left on each. It is quiet when nothing is open.

---

## Step 6: Production invoices to ProDough

When Powder Ops finishes a production run for ProDough, ProDough is invoiced once for that order. The Deposits it has
already paid come off.

**ReadyDoc does not read MRPEasy.** When an MO closes or a customer order ships, someone records it on the payment run
page under **Production invoices**. They enter:

- the MO number (or order number) and the date;
- **ProDough's PO number**;
- each SKU, its quantity, and the unit price printed on ProDough's PO.

### Held or ready

ReadyDoc prices each line from the price list column an admin has chosen (FOB unit or wholesale unit). The order is
**held, never invoiced**, and Lowry is told why, when any of these is true:

- There is no ProDough PO.
- No price list column has been chosen yet. **Until one is, every order is held.**
- A SKU is not in the catalog.
- The SKU has no price on the price list.
- A quantity or the PO price is missing.
- **ProDough's PO price differs from our price list** by half a cent or more.

**"Check again"** re-reads the price list. It also takes a corrected PO number or corrected lines.

### One invoice per PO

A ProDough PO can be invoiced **once**. "PD-501" and "pd 501" count as the same PO. A second invoice for the same PO
is refused, and the refusal names the first one. The only way to free a PO is to **void** the invoice. A void needs a
reason, is done by the Controller or an admin, and is refused once the invoice is paid or is on a live run.

### Creating it in QuickBooks

The Controller creates the invoice in QuickBooks, sends it to ProDough, and records here:

- **the QBO invoice number**;
- **which paid Deposits to take off.** Each Deposit comes off whole, and only once. The Deposits picked cannot add up
  to more than the invoice.

```
Final bill = invoice total − Deposits taken off
```

If the Deposits cover the whole total, nothing is owed and the invoice is paid by the Deposits.

### Getting paid

Whatever is still owed rides **Danny's next run** ("2 production runs $15,420" in his sentence). It is paid by his
transfer, or marked paid in manual mode. If that run is cancelled, the invoice goes back on the next one. A run will
not close while one of its production invoices is unpaid.

The Monday digest also lists **held orders** and **invoices not yet created in QuickBooks**.

---

## Status of a bill, start to finish

```
AP Drop:   new → triaged → in_qbo ──(on a run, approved)──→ in_payment_run ──(recorded paid)──→ paid
                              ↑                                    │
                              └──────── sent back with a reason ───┘
```

## Status of a production invoice

```
held ──(fixed, check again)──→ to_invoice ──(QBO number + deposits)──→ invoiced ──(paid by transfer / marked)──→ paid
                                                         └──(deposits cover it all)──────────────────────────→ paid
any state except paid or on a live run ──(void, with reason)──→ void   (frees the PO)
```

---

## What cannot be undone or deleted

- Payment runs, their lines, payments, Deposits and production invoices **cannot be deleted**. A trigger in the
  database refuses it.
- The run's event log cannot be edited either.
- Must-pays and vendor bank details are **retired**, never deleted.
- A frozen run's contents do not change. Cancel and prepare again instead.

---

## Settings (Accounting → Payment run → Settings, admin)

| Setting | What it does |
|---|---|
| Controller | The person who closes runs and creates the QBO invoices. |
| Notify list | Who gets the failure notices, held orders and Monday digest (Lowry by default). |
| Bill owner | Who else is told when a bill fails. |
| Danny's phone | Where the approval link is texted. |
| Check before sending | On by default. Lowry checks the run before Danny is texted. |
| Deposit invoice | Materials at cost, weekly. |
| Deposit payment | **Transfer** (the confirmed transfer pays it) or **manual** (a person marks it paid). |
| **Production price list** | **FOB unit or wholesale unit. Not chosen yet, so every production order is held until it is.** |

---

## Still open

1. **Which price list column is ProDough's price,** FOB unit or wholesale unit. Nothing is invoiced until it is chosen.
2. **Whether a bot should be able to record closed MOs.** Today only a person can.
3. **Deposits come off production invoices whole, and the Controller picks which ones.** Confirm that is how you want it.
4. **Whether ProDough should be charged for materials at all.** Chris said "figure out later". The setting stays
   "materials at cost" until then.
5. **Whether the Deposit is paid by the transfer or marked by hand.** The accountants are deciding. It is a switch in
   settings.
