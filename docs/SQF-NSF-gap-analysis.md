# ReadyDoc vs. SQF and NSF/ANSI 455-2 — gap analysis

**Status:** internal working assessment, 2026-08-04.
**Author:** generated from the ReadyDoc codebase as deployed.

---

## Read this first

**The standards themselves were not supplied.** No copy of the SQF Food Safety Code for Food
Manufacturing or of NSF/ANSI 455-2 was available when this was written, so:

- **Clause and section numbers below are from general knowledge and are NOT verified.** Treat every
  number as "look this up in your copy", not as a citation. The *substance* of each requirement is
  stated in plain words so the gap is still meaningful even where a number is wrong.
- **21 CFR Part 111 is the exception.** It is public regulation and the subpart structure used here
  (H — master manufacturing record, I — batch production record, and so on) is reliable. NSF/ANSI
  455-2 is a certification scheme built on 111, so the 111 findings carry directly.
- Anything ReadyDoc *does* is stated from the code, not from a claim. Where this says "there is no
  module for X", that means no table, endpoint or screen exists — not that the plant doesn't do X on
  paper.

**The distinction that matters throughout:** an auditor does not ask whether you have a program. They
ask for the **record** the program produces, on a date they choose. A requirement met by a binder
nobody has opened since the last audit is a finding waiting to happen; a requirement met by a record
the app generates every day is not. So each gap below is graded by *whether a record exists*, not by
whether a practice exists.

---

## The headline finding

**ReadyDoc has no master manufacturing record and no batch production record in the 21 CFR 111 sense.**

The Production Log is an *end-of-day report*: product, MO, lot, quantity, people, times, plus the
team's EOD survey, filed once per shift and countersigned by QA. That is a good operational record and
it is more than many plants have. It is not what Subparts H and I ask for:

- **Subpart H (master manufacturing record)** wants, for each unique formulation and batch size: the
  complete list of components with identity and weight/measure, a statement of theoretical yield,
  the specifications at each point requiring control, and the written procedure for each step —
  approved and signed by quality before use.
- **Subpart I (batch production record)** wants the *executed* version: the actual weights taken, the
  identity of each component and its lot, who performed and who verified each step **at the time it
  was performed**, in-process results against their specification, actual yield versus theoretical,
  and the quality unit's release decision on that batch.

The plant's own Form 403-01 asks this directly, three times — "Batch production record is present and
fill out at the time of performance" under Dosing, Molding and Packaging. That question currently has
no answer inside ReadyDoc.

This is the single largest gap, and it is also the largest build. Everything else on this list is
smaller than it.

---

## Part 1 — Covered, with a record

These have a module, a table, and records that accumulate without anyone remembering to file them.

| Requirement | Where it lives |
|---|---|
| Document control, revisions, approval, review dates | Controlled Documents + Document Change Requests + `sop_versions`; review scheduling generates Doc-Control tasks |
| Change control on forms and acceptance criteria | Controlled Changes — a deployed change is parked until Document Control approves it |
| Training records, competency, retraining on revision | Training Records; courses keyed to document number (WI001…WI021), tests with answer keys, completion matrix |
| Internal audits | Internal Audits (Form 403-01), findings raise CARs, monthly schedule seeded |
| Management review and food safety team meetings | Meetings — attendance marked, minutes approved, actions become tracked tasks |
| Corrective and preventive action | CAPA register, with source type; internal-audit CARs land here |
| Deviations, non-conformances, holds, disposals | Quality Events + Disposals, multi-party e-signature approvals |
| Customer complaints | Complaints, linked to CAPAs |
| Sanitation program and verification | Sanitation records, master schedule, QA verification, 72-hour idle re-clean rule |
| Chemical control, SDS, food-grade segregation | Chemicals register + Sign In/Out with a mandatory use specification |
| Glass and brittle plastic control | QA Inspections (Form 431-02), 17 zones on schedule, item lists per zone |
| Calibration | Calibration Management + daily Scale Verification (417-01…05) with tolerance grading |
| Preventive maintenance | Task Center + Equipment, PM schedules per asset |
| Incoming material inspection | Receiving Log, inspection numbers per arrival, status of release |
| Finished-product testing and certificates | COA / Lab Testing — specs per item and test, auto-grading, facility COA with QA e-signature |
| Traceability exercise | Mock Recall |
| Temperature and humidity monitoring | QA Inspections (Form 110-04), with an alert to QA below the procedure limit |
| Records: retention, legibility, audit trail | Every write is audited (`audit_log`), records are retired not deleted, signed records close to edits |
| Approved supplier list — chemicals only | Approved Chemicals register (RV3) |

---

## Part 2 — Partial: something exists, but not the record an auditor asks for

**1. HACCP / food safety plan — definitions without monitoring records.**
`haccp_ccps` holds each CCP's critical limits, monitoring procedure, frequency, corrective action and
verification procedure, and links it to equipment, PM schedules and instruments. What does not exist
is the **monitoring log**: the reading taken at the stated frequency, by whom, against the limit, with
the corrective action when it deviated. A CCP with a documented limit and no monitoring record is the
classic major non-conformance. *(The plant runs an X-ray, not a metal detector — per the July audit —
so X-ray challenge/verification records are the concrete case.)*

**2. Specifications — finished product only, and only for tested items.**
COA Specifications cover item + test limits, and the new starter drafts extend that to the 50
most-tested items. Missing: **raw material specifications** as approved documents (identity,
purity, allergen status, supplier), and **packaging/label specifications**. `coa_material_specs`
exists but is thin.

**3. Approved supplier program — chemicals are covered, ingredients are not.**
There is a chemicals register and a procurement vendor list. There is no supplier *approval record*:
the questionnaire, the certificate on file with its expiry, the risk rating, the ongoing performance
review, and the decision to approve — with a signature and a date. Form 403-01 asks for exactly this
("All vendors have been qualified and approved by Quality", "There's a list of approved vendors").

**4. Environmental monitoring — one schedule, not a program.**
Monthly tap water testing is seeded as a Quality Schedule. A program needs a **site map with zones**,
a sampling plan per zone, results trended over time, and an investigation/corrective-action path when
a site trends up. Form 403-01 asks for "a schedule for the equipment and sites to check" and "testing
specifications are outline" — neither exists as data.

**5. Product release — implicit rather than a decision on the record.**
COA requests roll up to pass/fail and QA e-signs the certificate; on-hold records exist. There is no
single **positive release** record per lot: "this lot is released for distribution, by this person, on
this date, on the basis of these records." Release is currently inferred from several places.

**6. Personnel hygiene and GMP compliance — trained, but not inspected on a record.**
GMP training is recorded. Form 403-01 checks "Employees follow GMPs" in eight separate sections, and
Sanitary Audits covers facility condition — but there is no routine **GMP observation record** (the
walk-through where someone notes hairnets, jewellery, hand-washing, and it is signed and dated).

**7. Allergen control — nothing beyond a test.**
"Allergens" exists as a COA test type and now as a starter specification. There is no allergen
program: the ingredient allergen matrix, the segregation and scheduling rules, the changeover
cleaning validation, and the label-declaration check.

---

## Part 3 — Not covered: no module, no table, no record

Ranked by how quickly it comes up in an audit.

1. **Batch production records (see the headline finding).** 21 CFR 111 Subparts H and I; SQF's process
   control and record sections; Form 403-01 asks three times.
2. **CCP monitoring log.** See Part 2 item 1 — listed separately here because the *record* is entirely
   absent, not partial.
3. **Retention (retain) samples.** Form 403-01: "Retain samples are kept according to proper storage
   conditions", "Retention logs are available". No table exists. Straightforward to build: sample per
   lot, location, retention period, disposal date.
4. **Pest control.** No module. Form 403-01 asks that the program is "monitored and logged" and
   "effective". Typically the contractor's service reports plus a device map and trend — at minimum,
   the service reports need somewhere to live with a due date.
5. **Visitor and contractor control.** Form 403-01: "Visitor Policy is enforced", "Visitor log book is
   completed for each visitor". No module; there is a kiosk pattern (`ScaleKiosk`, `ComponentKiosk`)
   that a lobby sign-in would fit exactly.
6. **Shipping / outbound load inspection.** Form 403-01: "Trailers are inspected", "BOLs and COAs are
   part of the out going material". Receiving is covered; despatch is not.
7. **Rework.** Form 403-01 has a whole section. No module — rework identity, traceability back to the
   parent lot, and the sanitary/GMP conditions of the rework.
8. **Food defense and food fraud (VACCP / TACCP).** Vulnerability assessment, mitigation, and the
   review cycle. SQF requires both; NSF's scheme expects food defense.
9. **Crisis management / business continuity.** The written plan, the contact list, and the annual
   test of it.
10. **Waste management.** Segregation, removal frequency, and the record.
11. **Water safety beyond tap testing.** Potable-water certificate, backflow prevention, and the
    plumbing schematic SQF asks for.
12. **Equipment and utensil sanitary design sign-off at purchase.** Hygienic Design exists as a module
    — worth checking whether it covers new-equipment approval or only assessment of existing kit.

---

## Part 4 — 21 CFR 111 subpart-by-subpart (the NSF/ANSI 455-2 backbone)

| Subpart | Requirement in one line | ReadyDoc |
|---|---|---|
| B — Personnel | Qualified, trained, hygienic | **Partial** — training solid; no hygiene observation record |
| C — Physical plant | Grounds, construction, sanitation, pest, water, waste | **Partial** — sanitation strong; pest, waste, water program absent |
| D — Equipment & utensils | Design, cleaning, calibration | **Covered** — Equipment, PM, Calibration, Scale Verification |
| E — Production & process control system | The overarching quality system | **Partial** — most elements present, the batch record is not |
| F — Quality control operations | An independent QC function reviewing and approving | **Covered in substance** — QA Review Center, signature rules, revoke-to-correct |
| G — Components, packaging, labels | Receipt, identity verification, holding, approval | **Partial** — receiving covered; component identity testing and label control are not |
| H — **Master manufacturing record** | Formula, procedures, specs, approved before use | **Missing** |
| I — **Batch production record** | The executed record with weights, lots, verifiers, yield | **Missing** |
| J — Laboratory operations | Methods, lab controls, contract lab qualification | **Partial** — COA flow strong; contract-lab qualification records absent |
| K — Manufacturing operations | Sanitation during production, cross-contamination control | **Partial** — sanitation and room status exist; allergen/changeover control does not |
| L — Packaging & labeling | Label reconciliation, verification | **Missing** |
| M — Holding & distributing | Storage conditions, distribution records | **Partial** — hold records exist; despatch does not |
| N — Returned dietary supplements | Assessment and disposition of returns | **Missing** |
| O — Product complaints | Review, investigation, QA involvement | **Covered** |
| P — Records & recordkeeping | Retention (111.605: 1 year past shelf life, or 2 years past distribution), legibility, availability | **Covered mechanically**; no explicit retention policy or purge rule in the app |

---

## Part 5 — If you only do three things

1. **Batch production records.** Biggest gap, most audit exposure, and the plant's own internal audit
   already asks for it three times. This is a real build — master formula per product/batch size, then
   an executed record with per-component weights, lot numbers, a performer and a verifier at each step,
   and yield reconciliation. It should link to the Production Log rather than replace it, the same way
   Flavor Approval and Organoleptic are two linked records.
2. **CCP monitoring log.** Small build, large finding avoided. `haccp_ccps` already holds the limits
   and the frequency; what's needed is the reading record against them, generated on schedule like
   every other recurring check, with a mandatory corrective action on a deviation.
3. **Retain samples, pest control, and visitor log.** Three small logs, each one an explicit line on
   Form 403-01 with nowhere to answer it today. Together they are less work than either item above and
   they close three checklist questions outright.

After those: approved supplier records, allergen program, environmental monitoring as a program, and
positive release.

---

## What to verify before acting on this

- Get the current **SQF Food Safety Code for Food Manufacturing** and **NSF/ANSI 455-2** and check the
  clause numbering; this document deliberately argues from substance rather than citation.
- Confirm which processes are actually **CCPs vs. preventive controls** in the current food safety
  plan — the build in Part 5 item 2 depends on that answer.
- Confirm whether the plant is pursuing **SQF certification, NSF/ANSI 455-2, or both**, and at what
  date. The ordering above assumes both and no fixed deadline.
