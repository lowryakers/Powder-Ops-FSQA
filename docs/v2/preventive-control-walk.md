# The preventive control walk — D-006

**Status: frame complete, walk blocked on two documents · started 24 August 2026 · Track B**

D-006 asks for the punch list of controls that do not resolve to a program, a form and a record.
This file is that walk. It is written to be resumed by a cold session: the method is stated, the
half that could be completed from the repository is complete, and the half that needs the two plan
documents says exactly what it needs and where it will go.

> **The test, from D-002.** Every preventive control named in the Food Safety Plan should resolve to
> a program that generates dated work and a numbered form that catches the record.

---

## 1. The test, made operational

A control passes only if all three legs are present. Each leg has to be evidenced by something in
the system, not by somebody's recollection that it happens.

| Leg | What counts as evidence | Where it lives |
|---|---|---|
| **Program** | Something that produces a dated obligation without anyone remembering to. A cadence (`pm_schedules`, `quality_schedules`) or a **trigger** (a truck arrives, a blade is signed out, a lot goes on hold). | L2 |
| **Form** | A number in the Forms Master Index, and a match rule that resolves a task or record to it. | L1 |
| **Record** | A row that accumulates in a queryable log, written **by completing the work**. | L4 |

**Two refinements the walk needed, both learned from the repository rather than assumed.**

*A program does not have to be a cadence.* Receiving inspection, knife sign-out, film inspection and
disposal are event-driven and correctly so — a calendar entry for "a truck might arrive" would be
noise. The leg is satisfied by a trigger that cannot be skipped, not by a frequency. What fails the
leg is a control that depends on somebody deciding to start it.

*The work order is the universal fallback record, and it is not always enough.* Completing a task
always writes `completed_by`, `completed_at`, readings, step ticks and notes onto `work_orders`. For
an equipment PM that genuinely is the record. It is **not** enough where the control answers to a
numbered log an auditor asks for by number, because a work order is not retrievable by form number,
is not on any module's log, and does not pass through QA Review. So "the task was completed" and
"the record exists" are two different findings, and this walk keeps them apart.

### The four verdicts

| Verdict | Meaning |
|---|---|
| **Wired** | Program, form and record all present, and completing the work writes the record. |
| **Running, unrecorded** | The work happens on a schedule and closes, but no record accumulates in a log. A finding waiting to happen — the plant is doing the work and cannot prove it. |
| **Elsewhere** | Resolved outside ReadyDoc by decision (Keychain, or still on paper). Not a gap, but it owes an answer to *how is this retrieved during an audit*. |
| **Absent** | No control object at all: nothing generates it, no number answers to it, nothing accumulates. |

---

## 2. What could be walked, and what could not

**The plan-side half is blocked.** The Food Safety Plan and the Food Defense Plan are not in the
repository — no PDF, no transcription, no registry seed. Searched: `docs/`, `public/forms/`,
`server/assets/`, every seeder, and the whole tree for the phrases. What exists is second-hand:
Carol Rojas's AIB Food Defense Coordinator certificate, Adam Bliss's and Carol's PCQI certificates,
and the plant's own Form 403-01, whose 104 questions are a good proxy for what the plant audits
itself against but are **not** the plan's control list.

So the walk cannot yet say *which controls the plan names*, and that is the only thing it cannot say.

**The app-side half is complete and is in section 3.** Which programs generate dated work, which
forms are numbered and matched, and which completions write a record are all facts in the code, and
they do not change when the plans arrive. The plans decide which rows of section 3 are preventive
controls and add any that are named in the plan and appear nowhere here — which is the most
interesting bucket and the one that is still empty.

### The unresolved question underneath all of this

**Is the plan written as a 21 CFR 117 preventive-controls plan, or as a HACCP plan with CCPs?** The
gap analysis of 4 August raised it and it is still open. It decides the vocabulary of the whole walk:
a 117 plan names process / food allergen / sanitation / supply-chain preventive controls plus a
recall plan; a HACCP plan names CCPs with critical limits. The plant holds both PCQI and HACCP
certificates, and `haccp_ccps` is modelled for the HACCP shape. **This must be answered from the plan
itself, not inferred** — and it is the first question to ask when the documents arrive.

---

## 3. The app side, completely

### 3.1 The Forms Master Index, by where the form is worked

Counted from `shared/form-registry.js`: **52 forms**.

| Where | Count | Forms |
|---|---|---|
| **readydoc** | 40 | worked in the app; every one carries a match rule, so no ReadyDoc form is listed without a way to resolve a task or record to it |
| **keychain** | 7 | 111-01 Cleaning Log Checklist · 404-1 Supplier Qualification Questionnaire · 404-2 Raw Material Questionnaire · 405-1 Product Release · 405-02 Product Release Waiver · 413-1 Batch Production Record · 413-1 (X-Ray) X-Ray Operation Record |
| **paper** | 4 | 100-01 Material Verification Checklist · 402 QA Incoming Raw Materials, Labels and Component Sampling · 413-2 Finished Product Specification · 438-01 Employee Grievance |
| **retired** | 1 | 111-02 Chemical Sign Out (superseded by 703-01) |

### 3.2 Wired — all three legs, and the completion writes the record

These are the ones to point an auditor at. Verified in code, not assumed: the record is written by
`fileDilutionRecord` / `fileQaInspectionRecord` in `api/pm.js`, driven by `recordAreaForTask` in
`qa-records.js`, which is the authoritative task-title → record-area map.

| Control | Program | Form | Record |
|---|---|---|---|
| Chemical dilution verification | daily PM schedule | 106-01 | `sanitation_records`, graded against the form's own limits |
| Brittle plastic & glass | 17 zone schedules | 431-02 (+ 431-01 diagram as a controlled document) | `sanitation_records` |
| Light inspection | per-room schedules | 110-01 / 110-02 | `sanitation_records` |
| Temperature & humidity | per-location schedules | 110-03 **(number disputed — see 3.5)** | `sanitation_records`, plus an out-of-range alert to QA |
| Restroom cleaning | daily schedule | 108-1 | `sanitation_records` |
| Breakroom / lobby / office cleaning | daily schedule | 108-2 | `sanitation_records` |
| Warehouse & grounds cleaning | daily schedule | 202-01 | `sanitation_records` |
| Production line pre-op / changeover | schedule | 108-03 | `sanitation_records` |
| Scale verification | daily, five scales | 417-01…05 | `scale_verifications`, QA counter-signed |
| Receiving inspection | trigger: arrival | 204-01 | `receiving_checklists` + `receiving_log`, sign-off refused on blanks |
| Internal audit | monthly quality schedule | 403-01 | `internal_audits` + items, findings raise CARs |
| Knife / blade accountability | trigger: sign-out | 440-01 / 440-02 | `qms_records` |
| Equipment / tool / chemical sign-out | trigger: sign-out | 703-01 | `qms_records` |
| Component warehouse sign-out | trigger: pull | 418-02 | `qms_records` |
| Approved chemical list & incidents | register | 700-01 / 700-02 | `approved_chemicals` |
| Film / pouch inspection | trigger: film lot | 418-01 | `film_pouch_inspections` |
| Deviation · non-conformance · on hold · disposal · CAPA · complaint · organoleptic | trigger: the event | 442-01 · 408-1 · 424-01 · 411-1 · 408-2 · 419-01 · 602-01 | `qms_records`, `disposals`, `capas`, `complaints` |
| Document control & change | review-due schedule | 406-1 | `sop_documents`, `sop_versions`, DCRs, Controlled Changes |
| Training & retraining on revision | requirements + revision trigger | 409-1 / 409-02 | `training_records` |
| Crisis contacts · evacuation · first aid | drill cadence / trigger | 501-01 · 501-02 · 502-01 | `evacuation_headcounts`, `first_aid_injuries` |

### 3.3 Running, unrecorded — the core of the punch list

The work is scheduled and gets closed. Nothing accumulates in a log.

**1. Environmental monitoring — eight schedules, no result record.** `FORM 604-01` is transcribed in
full (`emp-site-list.js`) with every site, test, frequency and alert/action limit, and eight
quality schedules are seeded from it. But `quality_schedules` work is completed through the ordinary
task path, and that path files a record only for dilution and the three QA inspections
(`api/pm.js` → `recordAreaForTask`). So swab and water results live in `work_orders.readings` as free
text. **There is no environmental result record with its site, its limit, its pass/fail and its
trend, and no investigation path when a site trends up.** This is the largest wired-looking gap in
the app: the program is genuinely excellent and the evidence leg is missing entirely.

**2. Tap water, settle plate and compressed air testing.** Same mechanism, same consequence. These go
to an outside lab; the lab report has no record to be filed against, only a task to be attached to.

**3. CCP monitoring.** `haccp_ccps` holds each CCP's critical limits, monitoring procedure, frequency,
corrective action and verification procedure, and links to equipment, PM schedules and instruments.
**There is no seeder and no monitoring-record table.** On a fresh deployment the table is empty, and
`audit-readiness.js` already reports that as a warning. A CCP with a documented limit and no
monitoring record is the classic major non-conformance, and the X-ray is the concrete case — its
operation record (`413-1 (X-Ray)`) is assigned to Keychain, so ReadyDoc holds neither the limit's
monitoring nor its verification.

**4. Daily forklift inspection (702-01).** The form is matched on any task title containing
"forklift", and the seeded PM schedules do match — but a PM completion files no log record, so the
daily inspection an auditor asks for by number resolves to a work order, not to a log.

**5. Calibration.** `calibration_records` accumulate and instrument due dates drive notifications, so
the record leg is genuinely present. What is missing is a **form number**: no entry in the Master
Index answers to calibration. Two of three legs.

**6. Mock recall.** `mock_recalls` is a strong record and 415-1 is matched. The annual cadence is
*reported* by `GET /status`, not generated — nothing raises the obligation. Two of three legs, and
the missing one is the program.

### 3.4 Elsewhere — resolved outside ReadyDoc by decision

This bucket did not exist when the walk started and it changes two conclusions from the 4 August gap
analysis. **Supplier approval and product release are not absent — they are assigned to Keychain**
(404-1, 404-2, 405-1, 405-02), as are the batch production record and the X-ray operation record
(413-1 and 413-1 X-Ray), and the cleaning log checklist (111-01, number terminated, attaching to the
BPR in Keychain).

That is a legitimate answer to the D-002 test and it still owes two things:

- **Retrieval.** L6's rule is that nothing is prepared for the audit. A record in Keychain satisfies
  the control and fails the retrieval test unless someone can produce it on a date the auditor picks.
  Whether that is acceptable is a decision, and it has not been made in writing.
- **A date.** Keychain is mid-migration (D-004). A form marked `keychain` that is not yet live in
  Keychain and no longer on paper is a control with no record at all in the interval. **Which of the
  seven are live today is not knowable from this repository** and needs confirming.

Four forms remain on paper — 100-01, 402, 413-2, 438-01 — of which 402 (QA incoming raw materials,
labels and component sampling) is the one that touches a preventive control directly, and the Master
Index itself queries whether it is still in use.

### 3.5 Two disagreements already detected by the app

`GET /api/forms` reports where a `qms-config.js` form code disagrees with the Master Index, and
neither side is silently rewritten because only Document Control can rule. Currently standing:
Non-Conformance (`Form 408-01` vs `FORM 408-1`), Knife (`Form 440-01 / 440-02` vs `FORM 440-01`),
and **Temperature & Humidity, which the Master Index numbers 110-03 where the app showed 110-04**.
The last one matters to this walk because temp/humidity is a live monitoring control and its records
would be retrieved by the wrong number.

### 3.6 Absent — no control object at all

Nothing generates it, no number answers to it, nothing accumulates. Confirmed against the full table
list in `db.js`, so these are absences of schema, not of screens.

| Control area | Evidence it is expected |
|---|---|
| **Allergen control** — ingredient matrix, segregation and scheduling rules, changeover validation, label declaration check | A 117 plan requires it as a named preventive control; SQF requires the program. Only an "Allergens" COA test type exists. |
| **Pest control** — device map, contractor service reports, trend | Form 403-01 §Sanitation and Pest Control asks that it is "monitored and logged" and "effective" |
| **Visitor and contractor control** | Form 403-01 asks for the visitor log book. `auditor_passes` is a different thing — it lets an auditor read the binder. |
| **Rework** | Form 403-01 has a whole section |
| **Shipping / outbound load inspection** | Form 403-01: trailers inspected, BOLs and COAs with outgoing material |
| **GMP observation walk-through** | Form 403-01 checks "Employees follow GMPs" in eight sections; training is recorded, observation is not |
| **Food defense / vulnerability assessment (VACCP · TACCP)** | The Food Defense Plan itself, and a certified Food Defense Coordinator on staff. **No table, no module, no form number in the index.** |
| **Waste management** | 21 CFR 111 Subpart C |
| **Water safety beyond tap testing** — potable certificate, backflow, plumbing schematic | Subpart C; the EMP covers sampling, not the program |
| **Returns** | Subpart N |
| **Label reconciliation** | Subpart L |

**The Food Defense Plan's absence is the sharpest line in this section.** The plan exists as a
document (there is a trained coordinator), the walk's second half is entirely about it, and the app
has no object of any kind that a food defense control could resolve to — not a program, not a form
number, not a record. Every control in that plan will land in the `Absent` bucket unless the plan
turns out to delegate them to controls already listed above.

### 3.7 One dormant mechanism worth knowing about

`checklist_templates` / `checklist_instances` / `checklist_submissions` exist with a full API
(`api/checklists.js`), typed `pre_op | operational | sanitation | gmp | custom`, with responses,
pass/fail and a `verified_by`/`verified_at` pair. **It has no nav entry and nothing seeds it.** It is
close to the shape several absent controls need — GMP observation especially. Noting it as an
existing asset, not recommending it: it carries no form-number linkage and no schedule linkage, so
adopting it would mean giving it both legs, and that is a build to plan, not a shortcut.

---

## 4. The provisional punch list

Ranked by audit exposure per unit of work. Everything here is derived from the app side and stands
independently of the plans; the plans can only add to it.

1. **An environmental monitoring result record.** The program is already exemplary and the evidence
   leg is missing outright. Smallest build with the largest single gap closed.
2. **A CCP monitoring record**, and populate `haccp_ccps` from the plan. Blocked on the plan, and it
   is the classic major non-conformance.
3. **Confirm which of the seven Keychain forms are live today**, and decide in writing how a Keychain
   record is retrieved during an audit. No build; a decision and a fact.
4. **Rule on the three form-number disagreements**, temp/humidity first.
5. **A food defense control object.** Cannot be specified before the plan is read; will be the whole
   of the walk's second half.
6. **Give calibration a form number, and mock recall a generator.** Two single-leg fixes.
7. **Decide the record leg for 702-01 forklift**: either it is adequately answered by the work order
   and the Master Index should say so, or it needs a log.
8. **Allergen control, pest control, visitor log, GMP observation.** Four absent programs, each one
   an explicit line on the plant's own Form 403-01 with nowhere to answer it today.

---

## 5. What is needed to finish, and where it goes

**Attach the Food Safety Plan and the Food Defense Plan** (any legible form — the EMP master site
list and the Form 403-01 checklist were both transcribed from supplied documents, so a PDF is
enough). With them, the walk is mechanical:

1. Answer the 117-vs-HACCP question from the plan's own structure (§2).
2. List every control the plan names, verbatim, in the plan's own wording — the same doctrine as
   `audit-checklist.js` and `emp-site-list.js`, typos included, because a control an auditor cannot
   find by its own name has not been answered.
3. Match each to section 3 and assign one of the four verdicts.
4. The rows that match nothing in section 3 are the real punch list; sections 3.3 and 3.6 are its
   floor, not its whole.

The finished walk belongs in this file — sections 3 and 4 are updated in place, because they are a
reading of the code at a date rather than a decision. **Anything decided while doing it goes in
`decisions.md` as a new `D-nnn`**, never here.

---

## 6. Corrections to the 4 August gap analysis

`docs/SQF-NSF-gap-analysis.md` predates this walk and three of its statements have moved. It is left
as written — the same rule as a superseded decision — and corrected here.

- **"Retention samples: no table exists."** Built since. `retention_boxes` / `retention_samples` with
  a paper-log importer. The log may still be empty, which is a different finding.
- **"Approved supplier program: no supplier approval record."** Assigned to Keychain (404-1, 404-2),
  not absent.
- **"Product release: no positive release record."** Assigned to Keychain (405-1, 405-02).

The headline finding stands with one amendment: the batch production record is **not missing from the
plant** — it is FORM 413-1, assigned to Keychain. It is missing from ReadyDoc, deliberately. Whether
that survives contact with an auditor is item 3 of the punch list.

---

## 7. One question this walk raised and did not answer

D-002's test has three legs. The spine has seven nodes, and **verification (L5) is not one of the
three.** Several controls above are wired end to end and never counter-signed; several others pass
through QA Review and are. Whether verification is a fourth leg of the test — and if so, which
controls genuinely need a second pair of eyes and which do not — is a decision, not a reading, and
it is adjacent to the role question left open in D-007 ("QA performing a check and QA verifying it
are different jobs"). Recorded here so it is not lost; it belongs in `decisions.md` when someone
rules on it.
