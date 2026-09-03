# DCR draft — FORM 602-01 V2 (Organoleptic Sensory Test) and the Flavor Approval scoring step

**For Document Control (Daniela). Drafted 3 September 2026. Nothing here is decided by the app.**

ReadyDoc now carries FORM 602-01 V2 exactly as the plant's document reads it: APPEARANCE · ODOR · TASTE ·
COLOR · TEXTURE, each with a SPECIFICATION, a RESULT (what was seen) and P / F. There is no 1–5 anywhere on the
form, so there is none in the app. Two things need Document Control's hand.

## 1. Approve the parked change on the two QMS forms

On the live database, `controlled.js` parks the new field lists as **pending** and keeps serving the V1 forms
(1–5 selects) until approved — the app is coherent on V1 until then. Controlled Changes → approve:

- **Organoleptic Sensory Test (Form 602-01 V2)** — the five V2 attributes replace appearance / texture /
  aroma / flavor / overall (1–5). Filed V1 records stay readable as filed; nothing is re-graded.
- **Flavor Approvals** — QA's scoring step adopts the same five attributes checked against the same product
  specification, so the Organoleptic record it files is a copy, not a mapping. "Overall" is dropped: deciding
  is the approver's job, not QA's. **This is a change to a second controlled document** and is Document
  Control's call, not the app's. If the Flavor Approval form is to stay 1–5, reject that one change and the
  sync between the two forms must be switched off (it would otherwise file nothing, which is the safe default).

## 2. The Forms Master Index

`controlled_forms` row **FORM 602-01** reads **V1** and is Document Control's to edit (the register is
insert-only from code). The code's own register reads V2. DCR log entry 0114 filed V1 on 03/20/2025; the V2
revision needs its own DCR number.

## What the product specification is, and who owns it

- One specification per **product**, in words, five attributes. The **first test** of a product with none on
  file writes the DRAFT from what QA describes; a **QA lead** (a supervisor in QA, or an admin) approves it —
  a deliberate act with a name and a date; after that it is locked. A correction is a new decision.
- Every test stores the specification text it was graded against and whether it was approved at the time
  (`sensory_spec` on the record) — the same rule as `sanitation_records.atp_limit`.
- No specification is seeded. Top SKUs get specs first because top SKUs get tested first.
