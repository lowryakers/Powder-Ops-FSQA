# The weekly bill pay process (the payment run)

How a bill gets from someone's inbox to paid, how ProDough pays Powder Ops for materials and production each week,
and who does what. This describes ReadyDoc as of 20 November 2026 (decisions D-360 to D-366).

The one rule underneath all of it: **ReadyDoc never pays anything and never writes to QuickBooks.** Payments are
made in QuickBooks, the bank and Bill Pay. The **Controller bot (Grok Bot)** has its own QuickBooks user and does
that bookkeeping there. ReadyDoc keeps the list, runs the checks, gets Danny's approval and records what was done,
so nothing paid is left open and nothing open is forgotten.

---

## Who does what

Every step, and whether a person or the bot does it. **The Controller is a bot, Grok Bot:** its own ReadyDoc token
holding the "Payment run: Controller bot" grant, and its own QuickBooks user. Lowry, as an admin, can do every bot
step by hand when the bot cannot.

| Step | Who | Person or bot |
|---|---|---|
| Drop a bill into AP Drop (or forward it to ap@powder-ops.com) | Anyone at the plant | Person |
| Triage the bill | **Jake** | Person |
| Enter the bill in QuickBooks and record its QBO bill number | **Grok Bot** | Bot |
| Suggest a bill's class (ProDough material or Powder Ops expense) | Grok Bot | Bot (a suggestion only) |
| **Confirm a bill's class** | **Jake** (admins as backup) | **Person only** |
| Keep the must-pay list | **Lowry** | **Person only** |
| Record the bank balance | Grok Bot (or Lowry) | Bot |
| Prepare the run (or let run day freeze it) | The office / Lowry | Person |
| **Check the run and send it to Danny** | **Lowry** | **Person only** |
| **Approve the run** | **Danny** | **Person only** |
| **Send the transfer and tap "I've sent $X"** | **Danny** | **Person only** |
| Confirm the transfer landed, **with evidence** | Grok Bot | Bot |
| Schedule each payment (QBO Bill Pay, card or check) | Grok Bot | Bot |
| Record each payment paid, with proof and the QBO payment number | Grok Bot | Bot |
| Send a bill back to next week, with a reason | Lowry | **Person only** |
| Create the Deposit invoice in QuickBooks and record its number | Grok Bot | Bot |
| Mark a Deposit or production invoice paid by hand (manual mode only) | Lowry | **Person only** |
| Book the shortfall | Lowry | **Person only** |
| Close the run | Grok Bot (or Lowry) | Bot |
| Record a closed MO or shipped order, read from MRPEasy | Grok Bot (or the office) | Bot |
| Create the production invoice in QuickBooks and record its number | Grok Bot | Bot |
| **Void a production invoice** | **Lowry** (an admin) | **Person only** |
| **Verify changed vendor bank details** (after calling the vendor) | **Lowry** | **Person only** |
| Act on the Monday task: everything the bot cannot do | **Lowry** | **Person only** |

**A bot never:**
- approves a run, or presses "I've sent";
- verifies changed bank details;
- changes the must-pay list;
- voids an invoice;
- confirms a bill's class.

ReadyDoc refuses each of these to a bot, whatever its token holds.

---

## The week at a glance

```
Mon–Wed  Bills arrive → AP Drop → Jake triages → Grok Bot enters in QBO → Jake confirms the class
         Grok Bot records closed MOs / shipped orders → creates production invoices in QBO
Run day  8 AM (Thursday) or noon (Friday in a payroll week): the run is frozen and Lowry is asked to check it
         Lowry checks → "Send to Danny" → Danny gets a text with a link
         Danny approves → sends the transfer → taps "I've sent $X"
Fri 10AM One reminder to Danny if he has not approved
After    Grok Bot confirms the transfer landed (with evidence) → schedules and pays each bill → Deposit invoice → closes the run
Monday   8 AM task to Lowry: what only a person can do, what is still waiting on the bot, held production orders
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
5. **Jake triages the bill:** new → triaged.
6. **Grok Bot enters it in QuickBooks** and moves it to **in QBO** with its **QuickBooks bill number**. A bill
   reaches in QBO only with that number. Only bills entered in QuickBooks can be paid through the run.

---

## Step 2: The payment run list builds itself (Accounting → Payment run)

Until the run is frozen, the list is worked out fresh every time the page opens. Every **in QBO** bill with a QBO bill
number is on it. Anything earlier in AP Drop is counted as "not in QuickBooks yet" and is not payable.

### Each bill is either a ProDough material or a Powder Ops expense

ReadyDoc suggests the class from the vendor's last confirmed class, the supplier type and the PO. Grok Bot may add
its own suggestion with a reason, shown beside the bill. **Only Jake's confirmation counts** (an admin can confirm
if he is away). A bill with no confirmed class cannot be paid this week.

- **ProDough material:** ProDough pays it back at cost through the weekly **Deposit** invoice.
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
  Only Lowry (an admin) can record new details, after calling the vendor on a number already on file. He notes the
  call and enters his password. A bot never can.

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

- **The bank balance** is recorded by Grok Bot (or typed by Lowry) on the run or earlier in the week. If a bank
  account is linked, it can use the bank feed instead. A run cannot be sent without a balance.
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
4. **He sends the transfer and taps "I've sent $X".** Lowry and the Controller bot are told. They are also told if the
   amount sent is not the amount approved.
5. **No approval by Friday 10 AM** (or four hours after a later send): one reminder text to Danny with a new link, and
   one note to Lowry.

Every step he takes is logged with his name, address and device. The page also shows the **ProDough deposit
balance**: Deposits already paid, waiting to come off the next production invoices.

---

## Step 5: Closing out the run (Grok Bot)

Each approved run has a **close-out** section. It shows what is done and what is still open. Each open item says
whose it is: the bot's, a person's, or Danny's.

1. **Confirm the transfer landed (bot).** Grok Bot must attach **evidence**: either the matching bank-feed line, or a
   file such as a statement or screenshot. The file is stored and fingerprinted on the run. Without evidence it is
   refused. No bill can be scheduled or marked paid until this is done.
2. **Schedule each payment (bot):** QBO Bill Pay, debit card or check, the date, and the Bill Pay reference.
   Rescheduling keeps the earlier schedule on file. A scheduled bill is still open until it is paid.
3. **Record each bill paid (bot):**
   - **How:** QBO Bill Pay ACH, Powder Ops debit card (Billtrust / QBO link), check, or other.
   - **Date and reference.**
   - **Proof** (a PDF or photo), stored once and fingerprinted.
   - **The QBO payment number.**

   Recording it moves the bill to **paid** in AP Drop.
   - **A bill that cannot be paid this week** is sent back with a reason **by Lowry** (never the bot). It returns to
     "in QBO" and appears on next week's list.
4. **The Deposit invoice (bot).** Create the week's Deposit invoice to ProDough (the materials total) in QuickBooks
   and record its number.
   - **Transfer mode** (the default): the confirmed transfer pays the Deposit.
   - **Manual mode:** Lowry marks it paid. This setting can be switched while the accountants decide.
5. **Production invoices on this run** (Step 6) are paid the same way: by the transfer in transfer mode, or marked
   paid by Lowry in manual mode.
6. **The shortfall** is booked by Lowry.
7. **Close (bot).** The run will not close while anything is open, and the refusal names each item.

**Every Monday at 8 AM Lowry gets one task message.** For every approved run not yet closed, it lists:
- what only a person can do;
- what is still waiting on the bot (which he can also do himself);
- anything waiting on Danny.

It also lists held production orders and invoices not yet created in QuickBooks. It is quiet when nothing is open.

---

## Step 6: Production invoices to ProDough

When Powder Ops finishes a production run for ProDough, ProDough is invoiced once for that order. **The invoice is
the full all-in price of the finished product, materials included.** It is never a labour or machine-time charge.
The Deposits ProDough has already paid then come off it.

```
Weekly:       Deposit invoice = the ProDough material bills on that week's run, at cost
MO closes:    Production invoice = all-in price × quantity − deposit balance (oldest first)
```

**ReadyDoc does not read MRPEasy.** Grok Bot reads it and records each closed MO or shipped order on the payment run
page under **Production invoices** (the office can too):

- the MO number (or order number) and the date;
- **ProDough's PO number**;
- each SKU, its quantity, and the unit price printed on ProDough's PO.

### Held or ready

ReadyDoc prices each line at the **all-in price** from the price-list column an admin has chosen. The order is
**held, never invoiced**, and Lowry is told why, when any of these is true:

- There is no ProDough PO.
- **No price-list column has been chosen yet. Until one is, every order is held.** Jarvis is confirming which column
  holds the all-in price. "All-in price to ProDough" is a new box on each product (Products → Pricing), offered first.
  FOB unit and wholesale unit stay as options.
- A SKU is not in the catalog.
- The SKU has no price in that column.
- A quantity or the PO price is missing.
- **ProDough's PO price differs from our price list** by half a cent or more.

**"Check again"** re-reads the price list. It also takes a corrected PO number or corrected lines.

### One invoice per PO

A ProDough PO can be invoiced **once**. "PD-501" and "pd 501" count as the same PO. A second invoice for the same PO
is refused, and the refusal names the first one. The only way to free a PO is to **void** the invoice. A void needs a
reason, is done **by Lowry (an admin), never a bot**, and is refused once the invoice is paid or is on a live run.

### The deposit balance

ReadyDoc keeps **one running ProDough deposit balance**: every **paid** Deposit, less whatever has already been taken
off a production invoice.

- A Deposit that has been invoiced but **not yet paid** is shown beside the balance and **does not count**.
- **The balance comes off automatically, oldest Deposit first.** Nobody picks which Deposits.
- A Deposit can be used **in part**. For example, a $31,480 Deposit against a $15,420 invoice leaves $16,060 on the
  balance for the next one.
- **The balance is shown on the run page and on Danny's page.** Each production invoice shows how much of the
  balance it used.
- **A void puts its amounts back** on the balance. The record stays, marked released.

### Creating it in QuickBooks

Before the invoice is created, each ready order shows what will happen:

```
Final bill = all-in total − deposit balance taken off (oldest first)
```

Grok Bot creates the QuickBooks invoice **for that final amount**, sends it to ProDough, and records the QBO
invoice number. The balance is taken off at that moment. If the balance changed in between, so the amount no longer
matches, ReadyDoc refuses and gives the new amount. The QuickBooks invoice is then corrected first. If the deposit
balance covers the whole total, nothing is owed and the invoice is paid by the Deposits.

### Getting paid

Whatever is still owed rides **Danny's next run** ("2 production runs $15,420" in his sentence). It is paid by his
transfer, or marked paid by Lowry in manual mode. If that run is cancelled, the invoice goes back on the next one. A
run will not close while one of its production invoices is unpaid.

---

## Status of a bill, start to finish

```
AP Drop:   new → triaged → in_qbo ──(on a run, approved)──→ in_payment_run ──(recorded paid)──→ paid
                              ↑                                    │
                              └──────── sent back with a reason ───┘
```

## Status of a production invoice

```
held ──(fixed, check again)──→ to_invoice ──(QBO number; balance taken off)──→ invoiced ──(paid by transfer / marked)──→ paid
                                                         └──(balance covers it all)─────────────────────────────→ paid
any state except paid or on a live run ──(void by Lowry, with reason)──→ void   (frees the PO, puts the deposits back)
```

---

## What cannot be undone or deleted

- Payment runs, their lines, payments, scheduled payments, Deposits, deposit applications and production invoices
  **cannot be deleted**. A trigger in the database refuses it.
- The run's event log cannot be edited either.
- Must-pays and vendor bank details are **retired**, never deleted.
- A frozen run's contents do not change. Cancel and prepare again instead.

---

## Settings (Accounting → Payment run → Settings, admin)

| Setting | What it does |
|---|---|
| Controller bot | The bot account (Grok Bot) that does the bookkeeping. It must hold a token, and that token needs the "Payment run: Controller bot" grant (Settings → Bot API tokens). |
| Notify list | Who gets the failure notices, held orders and the Monday task (Lowry by default). |
| Bill owner | **Jake.** Confirms each bill's class, and is told when a bill fails. |
| Danny's phone | Where the approval link is texted. |
| Check before sending | On by default. Lowry checks the run before Danny is texted. |
| Deposit invoice | Materials at cost, weekly. |
| Deposit payment | **Transfer** (the confirmed transfer pays it) or **manual** (a person marks it paid). |
| **Production price list** | **The all-in price column: "All-in price to ProDough", FOB unit or wholesale unit. Not chosen yet, so every production order is held until it is.** |

---

## Still open

1. **Which price-list column holds the all-in price.** Jarvis is confirming. Nothing is invoiced until an admin
   chooses it. If it is the new "All-in price to ProDough" box, it needs filling in for each SKU.
2. **Whether ProDough should be charged for materials at all.** Chris said "figure out later". The setting stays
   "materials at cost" until then.
3. **Whether the Deposit is paid by the transfer or marked by hand.** The accountants are deciding. It is a switch in
   settings.
4. **Setting up Grok Bot:** give its account AP Drop edit (so it can record QBO bill numbers), mint its token, tick the "Payment run: Controller bot" grant, then name it Controller bot
   in the payment run settings. Then name Jake the bill owner.
