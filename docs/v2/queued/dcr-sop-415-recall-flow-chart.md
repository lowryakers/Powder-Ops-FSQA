# DCR draft — Recall Flow Chart (SOP 415), and withdrawal of the inherited one

**Status:** drafted, not issued. The map in ReadyDoc is a **reference**, carries no form number,
and nothing is stamped on a record from it.
**Raised by:** ReadyDoc, 25 September 2026.
**For:** Daniela Servin, Document Control Manager.
**Quality owner:** Maria Servin (Quality Manager / SQF Practitioner).

---

## What prompted this

A flow chart was handed over with the facility — `Mock_Recall_Flow_Chart.pdf`, twenty-eight
boxes, titled **"Arete Mock Recall Flow Chart"**. It is the previous owner's document.

Two things about it matter.

**It is a RECALL flow chart, not a mock recall one.** It opens at *Receive Complaint · Is there a
health hazard?* and closes at *Terminate Recall · Review Process*. That is the real response. A
mock recall is the annual rehearsal of the tracking half of it. The title is wrong on its own
document, which is exactly the kind of thing that gets a chart read as describing the drill.

**It routes through roles Powder Ops does not have.** *Notify Director of Operations*, *Notify
Ownership / Partners / Legal Counsel*, *Assemble Recall Team*. There is no Director of Operations
here; SOP 415 V3's own contact list names the **CEO**, the **Production Manager**, the **QA
Manager** and the **Office Manager**, and Powder Ops co-manufactures, so "ownership" for a given
product is usually the **brand owner**, not this company.

So a chart carrying another company's name and another company's escalation path is worse than no
chart: an auditor will test it against the records and against the people in the room.

## What is asked

1. **Confirm the inherited chart is withdrawn.** If any copy is posted, filed, or attached to
   SOP 415, it should come down. It has no number in the Master Index and no entry in the DCR log
   (SOP 415 appears at V1, V2 and V3; FORM 415-1 at V1 and V2 — there is no flow chart row), so
   this is a withdrawal of an uncontrolled document, not a revision.
2. **Decide whether Powder Ops wants a numbered flow chart at all.** ReadyDoc now carries the
   process as a reference map — see below — which covers the screen and the printed binder. A
   *controlled* wall copy is a separate decision, and if it is wanted it needs a number, a
   revision and an owner, like FORM 431-01.
3. **If it is wanted, the content below is offered for transcription.** It is a reading of
   SOP 415 V3 and nothing in it is new policy; check it against the SOP before issuing.

## What ReadyDoc carries today, and what it is not

Two process maps, in the Auditor View under *Process Maps* and on the **Mock Recall** module
itself:

- **Recall — problem found → product recovered → recall terminated** (15 steps)
- **Mock recall — the annual rehearsal of that path** (7 steps)

They are **display only**. They are derived from one definition in the application's own data,
carry no revision, are stamped on no record, and gate nothing. The screen says so in those words,
so nobody prints one and treats it as controlled. They are the same shape as the eight process
maps already in the binder (production, flavour approval, COA, sanitation, receiving, deviation,
document change, sign-out) — none of which is a controlled document either.

### The recall path as mapped

| # | Who | What | Recorded on |
|---|-----|------|-------------|
| 1 | Anyone | Something raises the question — a customer complaint, a lab result, an internal finding, or a supplier notice about an ingredient we used | Customer Complaint (419-01) · Deviation (442-01) · Non-Conformance (408-01) |
| 2 | QA Manager | Decides whether there is a reasonable probability of a health hazard, and how far it reaches | FORM 415-1 |
| — | QA Manager | *No health hazard: closed as an ordinary complaint or non-conformance; no recall opened* | Complaint Investigation Report (419-01) |
| 3 | QA Manager | Notifies the CEO and the Operations Manager; starts the action log | FORM 415-1 · Crisis Management Contact List (501-01) |
| 4 | Operations Manager | Stops production and shipment; holds what is on site | On Hold record (424-01) |
| 5 | QA Manager | Assembles the recall team; identifies the affected product and anything sharing the ingredient or the line | FORM 415-1 |
| 6 | CEO | Notifies the brand owner; takes legal advice where the recall reaches the public | — |
| 7 | QA Manager / Warehouse | Walks whichever of the four SOP 415 tracking procedures applies | SOP 415 tracking procedures |
| 8 | Warehouse | Isolates and quarantines; recovered stock returns to the same quarantine | On Hold record (424-01) |
| 9 | QA Manager | Notifies the FDA where reportable, then distributors and customers — who, how, when | FORM 415-1 · FDA 1-866-300-4374 |
| — | Purchasing / Production | *Arranges replacement ingredient and replacement product where supply is interrupted* | — |
| 10 | Warehouse / QA | Recovers and reconciles against what was produced and distributed — the mass balance | FORM 415-1 |
| 11 | QA Manager | Decides disposition of recovered product — destroyed, reworked or released — with the reason | Disposal record (411-1) |
| 12 | QA Manager | Judges effectiveness on what was recovered and how many accounts responded; terminates the recall | FORM 415-1 |
| 13 | QA / Management | Raises the corrective action; reviews how the recall ran | CAPA (408-2) · Management review minutes |

Rows marked **—** are paths that only run when they apply, and are drawn as branches rather than
folded into the main line. Arete's chart drew *Arrange for Replacement Ingredients* and *Arrange
for Replacement Product* as ordinary boxes; they are kept, as branches, because they are real and
because they are the half a co-manufacturer's customer asks about first.

### What was dropped from the inherited chart, and why

| Arete box | Disposition |
|---|---|
| Notify Director of Operations | **Replaced.** No such role here. Goes to the CEO and the Operations Manager, per SOP 415 V3's contact list. |
| Notify Ownership / Partners / Legal Counsel | **Rewritten.** Powder Ops co-manufactures: the brand owner is notified, and the decision to announce is rarely ours alone. |
| Gather Information / Develop Recall Strategy | **Merged** into identifying the affected product and walking the tracking procedure — the SOP's own wording for the same work. |
| Track Affected Product · Track Distribution / Shipments | **Merged.** SOP 415's four tracking procedures already cover both, and which one applies depends on what triggered it. |
| Notify Distributors · Notify Affected Clients | **Merged** with the FDA notification, which is one act recorded once with who / how / when. |
| Start Corrective Actions | **Moved to the end.** A CAPA raised before the product is recovered has no effectiveness check behind it. |

## The gap this exercise found, stated plainly and NOT built here

**SOP 415 covers a recall and its rehearsal. ReadyDoc records only the rehearsal.** The Mock
Recall module holds the drill; a real recall today would be run on paper FORM 415-1 alongside the
complaint, on-hold, disposal and CAPA records that already exist in the app.

That is not necessarily wrong — a recall is run on the phone, and a module nobody has ever opened
in anger is not obviously safer than a binder. But the plant should decide it rather than discover
it. If an action-log record for a live recall is wanted, it is a small build on the same table.

## Do not tidy this without telling Document Control

The wording above is a draft. Once a number is issued it belongs to Document Control, and a
correction goes through them, not through an edit to the application's data file.
