# The preventive control walk — D-006

**Status: walked · 24 August 2026 · Track B**

D-006 asks for the punch list of controls that do not resolve to a program, a form and a record.
This is that walk, done against the plant's own two documents:

- **Protocol 003 — Food Safety Plan, V4**, effective 2026-06-25, owner Daniela Servin. Revision
  history: V0 07/08/2024 new · V1 09/24/2024 added magnets · V2 10/13/2025 **added X-ray as a CCP** ·
  V3 11/19/2025 **removed magnetic detection** · V4 03/04/2026 updated SQF Practitioner.
- **Protocol 001 — Food Defense Plan, V2**, effective 2026-06-15, owner Daniela Servin, approved by
  Carol Rojas 03/04/2026, reviewed by Adam Bliss.
- **Policy 002 — Food Safety Policy Statement, V2**, effective 2026-06-25, signed Danny Augustyn.

> **The test, from D-002.** Every preventive control named in the Food Safety Plan should resolve to
> a program that generates dated work and a numbered form that catches the record.

---

## 1. The headline

**The Food Safety Plan names four preventive controls. None of them resolves to a record in ReadyDoc.**

All four name their record as the batch production record or a document attached to it — "Cleaning log
Checklist in batch production record" (PC #1, PC #2), "Observations on batch record" (PC #3), "X-ray
Operation Record" (PC #4). In the Forms Master Index those are FORM 111-01, FORM 413-1 and FORM 413-1
(X-Ray), and **all three are marked `where: keychain`**.

**Read that field correctly — see D-017.** `where` says which system *produces* the record today. It
says nothing about who owns the number. **FORM 413-1 is the plant's own form number for the MMR /
Manufacturing Record / Batch Production Record, and it predates Keychain**, as every number in the
index does. The plant is not borrowing Keychain's paperwork; Keychain is currently generating the
plant's form.

So the finding is narrower than it first looks, and more actionable. The form leg is **not** missing —
it has been answered since before the migration started. What is true is that **ReadyDoc holds none of
the evidence for any preventive control in the plan.**

**And the live question is now answered: none of the seven Keychain-marked forms is producing
anything** (confirmed 24 Aug 2026). Production runs on the old manual paper process, logged in
MRPEasy. So the records for all four preventive controls are **on paper today** — not in Keychain, not
in ReadyDoc.

That is a legitimate answer to the record leg. Paper is a record, and a plant mid-migration running
paper is doing the safe thing rather than the negligent one. Two consequences follow, and they are the
real content of this finding:

1. **The registry reads as though Keychain were already handling these.** `where: keychain` means
   *moving to* Keychain in `form-registry.js`'s own vocabulary — it conflates where a record is
   produced **today** with where it is **intended** to go, and for these seven those are different
   answers. See D-021.
2. **PC #1 now has two records and neither carries its limit.** The paper cleaning log checklist rides
   on the BPR, while ReadyDoc's own cleaning record (108-03, `sanitation_records`) exists alongside it
   with an ATP field that is empty and ungraded. One control, two records, and the number the control
   turns on is in neither. That is the same defect the whole architecture is about, and it is the
   argument for the queued ATP work rather than against it.

**And one limit is worse than absent — it is contradicted.** PC #1's critical limit is **35 RLU**.
`sanitation_records.atp_reading` exists as a REAL, the Sanitation form asks for it and the Operator
View asks for it in both languages ("ATP Reading (RLU)"). **Nothing anywhere grades it.** A 60 RLU
reading can be filed with `result = 'pass'` and no mechanism objects. Meanwhile
`production_entries.cleaning_events[].atp_swab` records the same fact as a **boolean** — swab yes/no.
Two mechanisms for one control, neither carrying the number the plan makes it turn on.

---

## 2. The test, made operational

A control passes only if all three legs are present, each evidenced by something in the system.

| Leg | What counts as evidence | Where it lives |
|---|---|---|
| **Program** | Something that produces a dated obligation without anyone remembering to. A cadence (`pm_schedules`, `quality_schedules`) or a **trigger** (a run starts, a truck arrives, a blade is signed out). | L2 |
| **Form** | A number in the Forms Master Index, and a match rule that resolves a task or record to it. | L1 |
| **Record** | A row that accumulates in a queryable log, written **by completing the work**. | L4 |

Two refinements, both learned from the code and both now load-bearing — see **D-009**, which records
the first as superseding the cadence reading implied by D-002:

1. **A program may be a trigger rather than a cadence.** The plan proves this rather than merely
   allowing it: three of the four preventive controls are triggered by a production run
   ("at the beginning of every run", "at the end of every run", "at the beginning of every machine
   start up"), not by a calendar. A control that fires per run and a control that fires per week are
   the same leg. What fails the leg is a control that depends on somebody deciding to start it.
2. **The work order is the universal fallback record, and it is not always enough.** Completing a
   task writes actor, time, readings and step ticks onto `work_orders`. For an equipment PM that is
   the record; for a control answering to a numbered log it is not, because a work order is not
   retrievable by form number, is on no module's log, and does not pass QA Review. "The task was
   completed" and "the record exists" stay separate findings throughout.

### The four verdicts

**Wired** — all three legs, and completing the work writes the record.
**Running, unrecorded** — the work happens and closes; nothing accumulates in a log.
**Elsewhere** — the record is *produced* in another system today (Keychain, or paper). The form number
stays the plant's either way (D-017). Owes an answer to *how is this retrieved on a date the auditor
picks*, not to who owns the form.
**Absent** — no control object at all.

---

## 3. The Food Safety Plan, walked

### 3.1 The Preventive Control Chart — four controls, verbatim

The plan's own wording, kept as written.

| | Step | Hazard | Critical limit | Monitoring | Corrective action | Record keeping | Verification |
|---|---|---|---|---|---|---|---|
| **PC #1** | Packaging Powder Filling and Rework | Pathogens | **No more than 35 RLU** | Application of cleaning; visual inspection prior to set up. Per cleaning SOP. **At the beginning of every run.** Qualified QA specialist. | Re-clean line | Cleaning log Checklist in batch production record | ATP swabs and visual inspection |
| **PC #2** | Packaging Powder Filling and rework | Allergens | **No residual allergenic material from previous production line** | Allergen swab testing. **At the end of every run.** Qualified QA specialist. | Re-clean line | Cleaning log Checklist in batch production record | Allergen swabs |
| **PC #3** | Screens | Metal | No metal fragments nor other foreign materials that would cause injury or choking in product passing the screen | All product passes a **50 or 70 mesh** screen; raw ingredients sifted prior to going into the super sack. **At the beginning of every machine start up.** Qualified line operator. | Segregate all product produced in that room that day and hold; investigate disposition; identify the source and fix damaged equipment | Observations on batch record | Review of BPR |
| **PC #4** | X-ray | Foreign material | **NFe 2 mm · Fe 2 mm · Stainless steel 4 mm · Ceramic 2 mm · Glass 2 mm** | Product through a calibrated x-ray that auto-rejects. **At the beginning of every run and every 2–3 hours after.** Qualified QA specialist. | 100 % inspection of all product from the last good check | X-ray Operation Record | X-ray reading |

### 3.2 The verdict on each

| | Program | Form | Record | Verdict |
|---|---|---|---|---|
| **PC #1** ATP / pathogens | **Partial.** Nothing fires per run. The closest is the pre-op / changeover clean schedule, which is a *daily* cadence, not a per-run trigger. | 111-01 → Keychain. In ReadyDoc the clean answers to 108-03. | **Present but empty and ungraded.** `sanitation_records.atp_reading` is asked for and never graded against 35 RLU; **0 of 1,189 seeded records carry a reading**. A second boolean lives on `cleaning_events.atp_swab`. | **Running, unrecorded** |
| **PC #2** allergen swab | **Partial**, same reason — and the plan puts this at the *end* of a run, where nothing in the app fires at all. | 111-01 → Keychain. | Boolean `cleaning_events.allergen_swab` only. No swab result, no site, no pass/fail against "no residual". | **Running, unrecorded** |
| **PC #3** screens / sifter | **Absent as a control.** `mo_lines[].sifter_no` and `cleaning_events.sifter_no` record *which* sifter. Nothing asks for mesh size or screen condition, and nothing fires at machine start-up. | None. "Observations on batch record" → Keychain. | None. | **Elsewhere / Absent** |
| **PC #4** X-ray | **Absent.** Both machines are in the equipment registry (*X-Ray Inspection Machine Mech2*, *X-Ray Rejection Box Mech2 Swing Arm*) and **neither is linked to a CCP** — `equipment.haccp_ccp_id` is null on every row. Nothing generates the start-of-run challenge or the 2–3 hourly check. | 413-1 (X-Ray) → Keychain. | None. | **Elsewhere / Absent** |

**`haccp_ccps` holds zero rows.** The table is modelled exactly for this — name, hazard type, critical
limits, monitoring procedure, monitoring frequency, corrective action, verification procedure, record-
keeping requirements — and links to equipment, PM schedules and calibration instruments. The plan's
four rows would populate it almost field for field. Nobody has entered them, and `audit-readiness.js`
already reports that as a warning nobody has acted on.

### 3.3 Three places the plan disagrees with itself

Found by walking it rather than reading it, and each one is a Document Change Request, not a code
change. **Raise these with Document Control before the plan is revised**, because a control the plan
states two ways cannot be wired one way.

1. **Screens: beginning only, or beginning and end?** The PC chart says monitoring is "at the
   beginning of every machine start up". The Process Description says "The mesh size (50 mesh or 70
   mesh) is recorded as well as the condition of the screen **at the beginning and at the end of each
   batch**." The second is stricter and names two facts the chart doesn't (mesh size, condition).
2. **Rework still references metal detection.** The Rework row's justification reads "Metal detection
   at the metal detection process step during tub filling. X ray is inspected finished good." V3's own
   revision note says magnetic detection was removed, and the plant runs an X-ray, not a metal
   detector. This is residue of the removed V1 magnet content.
3. **PC #1's monitoring and its verification are the same activity.** Monitoring is "application of
   cleaning; visual inspection prior to set up"; verification is "ATP swabs and visual inspection".
   The ATP swab is what produces the 35 RLU reading the critical limit is stated in — so the reading
   is named as verification while the limit is monitored by eye. Whichever way Document Control rules,
   the software can only enforce the limit on whichever leg carries the number.

### 3.4 What the plan describes that the app does not know about

These come from the Process Description rather than the PC chart, so they are practices rather than
preventive controls — but each is a claim an auditor can test.

- **Allergen scooping order and full-room clean.** "Raw material allergens are scooped at the end of
  the batch… After every allergen is measured, a full clean of the room is performed and the clean is
  verified by an allergen swab." The clean is recordable (`cleaning_events`, with level and scope);
  the *ordering rule* and the swab verification are not.
- **Allergen storage segregation.** "Ingredients containing allergens are labeled with the specific
  allergen and stored in a specific allergen location." Nothing in the app knows which materials are
  allergens or where the allergen location is.
- **Rework as a controlled activity.** The plan gives rework its own process step, its own hazard row
  and three applied controls. **ReadyDoc has no rework object of any kind.**
- **Gowning without pockets, hairnets, beard nets, mouth covering, handwash before entry.** Trained
  (GMP-101) and never observed on a record.
- **COA-on-arrival, else quarantine.** "If COA was not provided upon arrival, the ingredient is placed
  on hold in quarantine area floor until COA is received." FORM 204-01 asks "Certificate of Analysis
  present"; the *hold* it implies is a separate manual act in the On Hold log with nothing linking them.

---

## 4. The Food Defense Plan, walked

Eight sections carry obligations: preventive measures (§6), monitoring (§7), corrective actions (§8),
verification (§9), record keeping (§10) and continuous improvement (§11). Walked against the same test.

| Control the plan states | Program | Form | Record | Verdict |
|---|---|---|---|---|
| **Receiving — inspect shipments for tampering, PO-only receipt, verify credentials** (§6B1) | Trigger: arrival | **204-01** | `receiving_checklists` — asks *Seal intact & correct*, *Truck exterior appears intact*, *Matches PO*, *Does PO # match assigned # in system* | **Wired** |
| **Food defense training + refreshers** (§6C3, §10.4) | `training_requirements`, 12-month retrain | 409-02 | `training_records` — course **FD-101 Food Defense & Intentional Adulteration**, with a test | **Wired** |
| **Incident investigation** (§8.1) | Trigger: the incident | 442-01 / 408-1 / 408-2 | Quality Events + CAPA | **Wired** |
| **Product recall** (§8.2) | Annual, *reported not generated* | 415-1 | `mock_recalls` | **Partial — no generator** |
| **Internal audit of the food defense plan** (§9.1) | Monthly internal-audit schedule | 403-01 | `internal_audits` — but **Form 403-01's 19 sections contain no food defense section**, so the audit that exists cannot verify this plan | **Running, unrecorded** |
| **Annual review of the vulnerability assessment** (§11.1) | Document review cadence (`review_due` 2027-06-15) generates a Doc Control task | 406-1 for the change | `sop_documents` + `sop_versions` | **Wired, if Document Control rules the doc review *is* the assessment review** |
| **Visitor sign-in and escort** (§6C2, §5) | — | — | — | **Absent** |
| **Access logs — maintain, review, investigate unauthorised attempts** (§7.2, §10.2) | — | — | — | **Absent** |
| **Surveillance — verify cameras function and cover critical areas** (§7.1) | — | — | — | **Absent** |
| **Surveillance footage retention** (§10.1) | — | — | — | **Absent** |
| **Employee background screening and periodic re-screen** (§6C1) | — | — | — | **Absent** |
| **Shipping security — tamper-evident seals, all outgoing shipments recorded** (§6B4, §5) | — | — | — | **Absent** |
| **Random / AQL inspection of finished product** (§6B3) | — | — | — | **Absent** |
| **Supplier audits and agreements** (§5.1 — highest-scored risk, 12) | — | 404-1, 404-2 → Keychain | — | **Elsewhere** |
| **Ingredient authenticity testing** — identity/purity for the 11 named ingredients (§3A) | Trigger: receipt | — | `coa_requests` + `coa_specifications` | **Partial — no form number** |
| **Mock incident, at least once every two years** (§9.2) | — | — | — | **Absent** |

**Two things stand out.**

*The plan's own highest-risk items are the least wired.* §4's risk matrix scores five vulnerabilities
at 12 or above: supplier non-compliance (12), contamination during ingredient dosing (15), production
line contamination (15), intentional adulteration by an employee (15), regulatory changes (12). Of the
five, supplier non-compliance is in Keychain, two are the sanitation/allergen preventive controls
already found unrecorded in §3, and **intentional adulteration by an employee** — the joint-highest
score, mitigated by "require employees to never work alone and adequate monitoring of footage" — has
no record of any kind. Nothing in ReadyDoc knows whether anyone worked alone.

*The mock incident is the plan's own verification of itself, and it has never had anywhere to go.*
Every two years, testing the response. The mock recall module is the right shape and the wrong drill —
415-1 is a traceability exercise, not a food defense response test. This is the cleanest small build
on the list: it is `mock_recalls` with a different checklist.

---

## 5. The punch list

Ranked by audit exposure per unit of work. Items 1–4 need a decision, not a build.

1. **Answered, 24 Aug 2026 — all seven are on paper, logged in MRPEasy.** What remains is the exit,
   and the two are not exclusive: **(a)** build the function into ReadyDoc so it produces FORM 413-1
   directly, or **(b)** connect to Keychain by API so ReadyDoc can retrieve what Keychain generates.
   The interval-with-no-record exposure this item was raised to catch **did not happen** — nothing
   left paper before its replacement was ready, which is the right way to run a migration. What is
   left is a bookkeeping fix (D-021) so the registry stops implying otherwise, and a decision about
   which exit, which can be made for FORM 413-1 alone ahead of the whole-ERP question in D-004.
2. **Grade the ATP reading against 35 RLU, or move the limit.** The reading has a home, the home is
   empty, and nothing enforces the number. This is `gradeReadings()` in `scale-forms.js` applied to a
   second control — the precedent, the doctrine ("a reading outside tolerance can never be filed as a
   pass") and the change-control gate all already exist. Also collapse the boolean
   `cleaning_events.atp_swab` into it, or the plant keeps two answers to one question.
3. **Enter the four preventive controls into `haccp_ccps`, and link the two X-ray machines.** Data
   entry, not a build; the table's columns already match the plan's chart. It turns
   `audit-readiness.js`'s standing warning green and gives every later record something to point at.
4. **Raise the three internal contradictions in §3.3 as a Document Change Request** before the plan is
   revised.
5. **A food defense mock incident**, every two years. `mock_recalls` with a different checklist — the
   plan's own verification of itself, currently absent.
6. **Add a food defense section to Form 403-01.** Nineteen sections, none of them food defense, so the
   internal audit cannot verify the plan that names it as verification.
7. **Visitor log.** Named in the Food Defense Plan twice and on Form 403-01. The kiosk pattern
   (`ScaleKiosk`, `ComponentKiosk`) fits a lobby sign-in exactly.
8. **A per-run trigger for pre-op and post-run controls.** PC #1 fires at the beginning of every run
   and PC #2 at the end of one; every generator in the app is a calendar. This is the one genuine
   architectural gap the walk found, and it is L2's business — see §7.
9. **An environmental monitoring result record.** FORM 604-01 is transcribed in full with every site,
   limit and frequency, and eight schedules are seeded from it — but a quality-schedule completion
   files no record, so swab and water results live in `work_orders.readings` as free text. Excellent
   program, no evidence leg.
10. **Rework, allergen program, GMP observation, pest control.** Four absent programs, each named in
    the plan or on the plant's own Form 403-01, none with anywhere to answer today.
11. **Two single-leg fixes:** give calibration a form number; give mock recall a generator.

---

## 6. The app side, for reference

### 6.1 The Forms Master Index

52 forms, all of them the plant's own numbers regardless of which system produces the record (D-017):
**40 readydoc** (every one carries a match rule), **7 keychain** (111-01 · 404-1 · 404-2 · 405-1 ·
405-02 · 413-1 · 413-1 X-Ray), **4 paper** (100-01 · 402 · 413-2 · 438-01), **1 retired** (111-02).

### 6.2 The existing coverage report is already clean

`GET /api/forms` reports which live schedules and record areas map to no form number. **Run on a fresh
seeded database on 24 Aug 2026: 42 of 42 schedules mapped, 37 of 37 record areas mapped, zero
unmapped.** Two disagreements stand — Non-Conformance (`Form 408-01` vs `FORM 408-1`) and Knife
(`Form 440-01 / 440-02` vs `FORM 440-01`); the temperature/humidity 110-03 vs 110-04 disagreement
noted earlier no longer appears.

So that report **is no longer the first draft of the gap list** — it has been worked down to zero. It
answers one leg (form) over two surfaces (cleaning/QA schedules, sanitation record areas), and the
things this walk found are all outside both. **Re-run it against the live database to confirm**: the
plant may hold hand-created schedules the seed does not.

### 6.3 Controls wired end to end

Point an auditor at these. Verified in code: the record is written by `fileDilutionRecord` /
`fileQaInspectionRecord` in `api/pm.js`, driven by `recordAreaForTask` in `qa-records.js`.

Chemical dilution (106-01) · brittle plastic & glass (431-02) · light inspection (110-01/02) ·
temperature & humidity (110-03) · restroom (108-1) · breakroom/lobby/office (108-2) · warehouse &
grounds (202-01) · production pre-op/changeover (108-03) · scale verification (417-01…05) · receiving
inspection (204-01) · internal audit (403-01) · knife accountability (440-01/02) · equipment & chemical
sign-out (703-01) · component sign-out (418-02) · approved chemicals (700-01/02) · film & pouch
(418-01) · deviation, NCR, on-hold, disposal, CAPA, complaint, organoleptic · document control (406-1) ·
training (409-1/409-02) · crisis contacts, evacuation, first aid (501-01/02, 502-01).

### 6.4 Absent — no control object at all

Confirmed against the full table list in `db.js`, so these are absences of schema, not of screens:
allergen program · pest control · visitor and contractor control · rework · shipping / outbound load
inspection · GMP observation walk-through · food defense vulnerability record · waste management ·
water safety beyond tap testing · returns · label reconciliation · employee screening · access logs ·
surveillance verification.

### 6.5 One dormant mechanism

`checklist_templates` / `checklist_instances` / `checklist_submissions` exist with a full API
(`api/checklists.js`), typed `pre_op | operational | sanitation | gmp | custom`, with responses,
pass/fail and a `verified_by`/`verified_at` pair. **No nav entry, nothing seeds it.** Close to the
shape several absent controls need — GMP observation especially. Noted as an existing asset, not
recommended: it carries no form-number linkage and no schedule linkage, so adopting it means giving it
both legs.

---

## 7. What the walk changed about the architecture

**One genuine architectural finding, and it is L2's.** Every generator in the system is a calendar —
`pm_schedules`, `quality_schedules`, document review, sanitation re-clean. The Food Safety Plan's
controls are not: three of four fire **per production run**, at its start or its end. There is no
object in the system for "a run", so there is nothing for a per-run obligation to hang off; the
closest is a `production_entries` row, which is filed at the *end* of the shift, after both controls
should already have fired.

This lands squarely on recommended move **05 — collapse the four schedule generators into one**,
which `architecture.md` defers until after the audit. The walk does not move it up: it records that
the one cadence model has to grow a second kind of trigger when it is done, and that the plant's
highest-consequence controls are the ones that need it.

**Nothing else here is new architecture.** Items 2, 3 and 9 of the punch list are consolidations of
the kind §6 of `architecture.md` describes — a fact given exactly one owner — and item 2 is
recommended move **03** (limits out of code and into documents) with the wrinkle that this limit was
never in code either.

---

## 8. Names, and one vocabulary finding

Recorded because vocabulary flips at once (D-003) and these will bite when it does.

- The Food Safety Plan's PC team lists **Carol Pierce, QA/QC Manager**. The Food Defense Plan lists
  **Carol Rojas, Quality, Plan Coordinator**, and the certificate on file is *carol-rojas-food-defense-
  coordinator-aib-2024*. `db.js` names "Carol Pierce" in the auditor-pass comment. Two spellings of
  one person, or two people — Document Control's call, and it needs making before either plan is
  reissued.
- **Maria Servin** is SQF Practitioner; **Daniela Servin** owns both plan documents and is Document
  Control. Two people, easily conflated.
- The Food Safety Plan's signature block has three unsigned lines (SQF Practitioner, PCQI, Plant
  Manager) while the document is `Status: Approved / Effective` in ReadyDoc. The policy statement is
  signed by the CEO **11/05/2025** and carries an effective date of **2026-06-25**. Neither is
  necessarily wrong; both are the kind of thing an auditor asks about.

---

## 9. Still open

- **D-014** is answered on the format question: the plan is a **21 CFR 117 preventive-controls plan**
  — the hazard analysis is the standard PCHF table and the control categories are the 117 ones
  (process including CCPs, allergen, sanitation, supply chain). The policy statement calls it "a
  validated HACCP-based approach" and V2's revision note says "Added X-ray as a **CCP**", so both
  vocabularies are in use across the plant's own documents. `haccp_ccps` is modelled for the second
  and its columns fit the first. **Not a blocker any more; a vocabulary item for step 3.**
- **D-015** — whether verification is a fourth leg of the test. The plan makes this concrete rather
  than theoretical: every one of its four preventive controls names a verification distinct from its
  monitoring, and PC #1 names the same activity as both (§3.3).
- ~~Which of the seven Keychain forms are producing records today.~~ **Answered 24 Aug 2026: none.
  Paper, logged in MRPEasy.**
- Which exit is taken for the BPR — absorb into ReadyDoc, or API-connect to Keychain (D-017). D-004
  says decide the ERP question on counts after the migration lands; this is the narrower version of
  the same question and can be answered for FORM 413-1 alone, ahead of it.
