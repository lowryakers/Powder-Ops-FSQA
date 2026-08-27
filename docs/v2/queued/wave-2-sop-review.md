# Wave 2 — the four SOPs the auditor named

**Draft for review · 27 August 2026 · 19 findings · nothing changed in any document**

| | Must fix | Should fix | Consider | Total |
|---|---|---|---|---|
| Document control, across all four | 2 | 2 | 0 | **4** |
| SOP 404 — Supplier and Laboratory Qualification | 2 | 1 | 1 | **4** |
| SOP 421 — Design/Qualification of Facility/Equipment | 1 | 1 | 1 | **3** |
| SOP 434 — Chemical, Equipment and Services Approval | 2 | 2 | 0 | **4** |
| SOP 604 — Environmental Monitoring Program | 3 | 1 | 0 | **4** |
| | **10** | **7** | **2** | **19** |

Same rules as the plan red-line: three severities applied strictly, every finding numbered so it can be
accepted, rejected or deferred one at a time, and `[verify in source]` on anything that needs the
document in front of you before it can be called wrong.

---

## Read this part first — half of this review is blocked, and it is the half you would expect

**None of the four SOPs is in the repository.** Not the text, not a PDF, not a seeded body — checked
across the working tree and all 104 commits of history. The Reference Library holds the six external
standards and nothing of the plant's own (D-030: adding a document to the app does not make it
available to this work).

So this is **not** a wording red-line like the one on the two plans, and it should not be presented as
one. Nobody has read these four documents here.

**What this is instead is the D-002 test, which is the test the method actually calls for at this
stage** — not *"is the wording right"* but ***"does this SOP ask for something that has no program, no
form and no record behind it?"*** That question is answerable from two things we do have: the
auditor's own words about each SOP, and ReadyDoc's tables. Every finding below rests on one or both,
and each says which.

**It also turned out that the blocked half is not the valuable half.** The auditor has already read all
four and found the same thing in each: *the document requires something the plant cannot produce.* That
is a gap between a document and a record, and a gap between a document and a record is exactly what
this project is for. Re-reading the prose for grammar would not have found any of the nineteen findings
below.

**To unblock the wording review, attach these four files** (PDF is fine — the same route the plans
took):

| | As the auditor cited it |
|---|---|
| SOP 404 | Supplier and Laboratory Qualification · **V4** · 8/4/26 |
| SOP 421 | Design/Qualification of Facility/Equipment (IQ, OQ, PQ) · **V2** · 8/11/26 |
| SOP 434 | Chemical, Equipment and Services Approval · **V2** · 6/25/26 |
| SOP 604 | Environmental Monitoring Program · **V2** · 6/29/26 |

---

## Part 1 — Document control, found without reading a single one of them

These four came out of comparing the auditor's citations against the plant's own **Document Change
Request log** — 159 rows, seeded verbatim in `server/qms-seed.js`. They need no SOP text and they are
the most immediately actionable findings in this review.

### W2-01 · Neither SOP 421 nor SOP 434 appears anywhere in the Document Change Request log · **MUST**

The auditor read both, and cited each by revision and effective date. The plant's own change log — every
new document and every revision since May 2025 — has **no row for either**. Not a *New Document* row,
not a *New Revision* row. (Verified by reading all 159 rows; the only occurrences of "421" and "434"
anywhere in that file are coincidental digits inside a phone number and a product code.)

There are only two explanations and both matter. Either the two documents were issued outside the DCR
process, which is a document-control nonconformance waiting to be written the next time somebody looks;
or the log is incomplete, which means the log cannot be relied on to answer the question it exists to
answer. **An auditor who asks "show me the change history for SOP 434" gets nothing today.**

*This is the finding I would fix first, because it costs a morning and it is the kind an auditor finds
in five minutes.*

### W2-02 · SOP 404 is at V4 in practice, V3 in the log, and its title has changed · **MUST**

DCR **0005** records `SOP 404 · Supplier Qualification · V3 · New Revision · 05/20/2025`. The auditor
read `SOP 404 · Supplier **and Laboratory** Qualification · **V4** · 8/4/26`.

So between those dates a revision was issued **and the document's scope widened to cover laboratories**,
and no change request records either. The scope change is the part that matters: adding laboratory
qualification to an SOP is a substantive change to what the plant has committed to do, and it happened
without a DCR row.

Same class as FDP-04 in the plan red-line (registry says 1.0, document says V2) — a document's identity
recorded in two places that disagree.

### W2-03 · SOP 604's effective date is eight months after its last change request · **SHOULD**

DCR **0050** records `SOP 604 · Environmental Monitoring Program · V2 · New Revision · 10/17/2025`. The
auditor read `V2 · 6/29/26`. **Same revision, two dates eight months apart.**

Softer than the two above, because a change-request date and an effective date are legitimately
different things, and a document can be re-dated at review without a revision. But if V2 became
effective in June 2026 and its change request was raised in October 2025, the document should say why.
`[verify in source — the SOP's own footer settles this]`

### W2-04 · Nothing reconciles the change log against the document registry · **SHOULD**

The DCR log is imported into the **QMS register** as `document_change_request` records. The document
registry is `sop_documents`, a **different table**, populated by upload. Nothing compares them, in
either direction.

That is why W2-01 and W2-02 survived: a document can exist in the registry with no change history, or
have a change history and never reach the registry, and no screen in ReadyDoc reports either. **The
recurring defect of this codebase — a fact in more than one place with no owner — at the level of the
document register itself.**

This belongs in the mechanical sweep (step 3 of the method), as two rules: *in the log, absent from the
registry* and *in the registry, absent from the log*. It is cheap and it runs forever after.

---

## Part 2 — SOP 404 · Supplier and Laboratory Qualification

> **The auditor:** *"The Supplier Qualification Questionnaire required per SOP 404 was not available for:
> Mill Haven Foods (Whey Protein), M4 Dynamic (Potassium Citrate, B12), Bay State Milling (Cinnamon)."*
> — NSF/ANSI 455-2 § 4.3.1 · 21 CFR 117.405 & 117.410

| The D-002 test | |
|---|---|
| **Program** | The SOP exists. Its coverage cannot be assessed without the text. |
| **Form** | FORM 404-1 *Supplier Qualification Questionnaire* V2, FORM 404-2 *Raw Material Questionnaire* V1 — both in the Master Index, both `where: keychain`, and per D-021 **neither is producing anything**. |
| **Record** | **Absent entirely.** |

### W2-05 · There is no supplier record in ReadyDoc of any kind · **MUST**

Not a thin one — none. `approved_chemicals` holds chemicals. `certifications` holds **people**
(`person_name NOT NULL`). `supply_orders` and `supply_invoices` are office purchasing. `coa_requests`
holds lab work. **Nothing anywhere holds a supplier, an ingredient it supplies, a risk evaluation, a
qualification decision, an approver, or a certificate with an expiry date.**

So the auditor's finding is not "the questionnaire was misfiled". There is no system it could have been
filed in. Three named suppliers of three named ingredients, and the answer to "show me their
qualification" is a question about somebody's folders.

### W2-06 · The laboratory half of SOP 404 has no record at all, and the code already assumes otherwise · **MUST**

`coa_requests.lab_name` is a **free-text field**. There is no laboratory record, no accreditation, no
scope, no expiry — the string `17025` appears nowhere in the codebase.

Worse, ReadyDoc already leans on an accreditation it does not hold. `server/coa-grade.js` carries this
comment, deciding how a lab result is graded:

> *"The lab's own verdict wins. It is the accredited party and it applied the …"*

That is a correct principle resting on a fact nothing records. An auditor asking *"how did you qualify
CTLA, and against what scope?"* gets a text field somebody typed. Given the SOP's title now explicitly
covers laboratories (W2-02), this is squarely in scope and squarely missing.

### W2-07 · The expiring-certificate pattern exists but is bound to a person, and that decision needs making now · **SHOULD**

`certifications` already does most of what supplier certificate management needs — issuer, number,
issued and expiry dates, the file itself, and an expiry that generates work. But `person_name` is
`NOT NULL`, so an organic certificate, a kosher certificate, a GFSI certificate or an allergen statement
**cannot be filed against a company** without either widening that table or creating a second one.

Decide that before building, not during: it is the difference between supplier qualification being a new
module and being an extension of one that already works. *(My reading is a new table — a supplier
carries a risk evaluation and an approval decision that a person's certificate does not — but the
certificate half should reuse the expiry machinery rather than growing a second copy of it.)*

### W2-08 · FORM 404-1 and 404-2 exist and produce nothing; settle where they will live before building · **CONSIDER**

Both are numbered, revised (404-1 is at V2, DCR 0022) and real. They are two of the seven forms D-021
found marked `where: keychain` while in fact being worked on paper. Building a supplier module without
deciding whether these two forms are its screens — or whether Keychain keeps them and ReadyDoc holds the
qualification decision — produces a third place the same fact can live. **That is a decision for
Daniela, not a build decision.**

---

## Part 3 — SOP 421 · Design/Qualification of Facility/Equipment (IQ, OQ, PQ)

> **The auditor:** *"…as required per SOP 421 … were not provided for any of the facility equipment; for
> example, mixers and stick pack machines."* — NSF/ANSI 455-2 § 4.5.8 · 21 CFR 111.30

| The D-002 test | |
|---|---|
| **Program** | The SOP exists. Not in the DCR log (W2-01). |
| **Form** | **None.** No 421-series form appears in the Master Index or the change log. |
| **Record** | **Absent entirely.** |

### W2-09 · "IQ", "OQ" and "PQ" appear nowhere in ReadyDoc · **MUST**

Searched across the server and the client: no installation qualification, no operational qualification,
no performance qualification, in any spelling.

`server/equipment-readiness.js` derives **ten** steps for every machine — PM schedule, assignee,
maintenance tasks, LOTO, hygienic design verification, training course, training material, work
instruction, calibration, HACCP CCP. **Qualification is not one of them.** So *"which machines are
unqualified?"* is not a question the application can be asked, which is precisely why the answer
arrived at an audit instead of on a screen.

### W2-10 · No form number exists for a qualification protocol · **SHOULD**

The auditor asked for IQ/OQ/PQ "for any of the facility equipment" — meaning the SOP requires a
deliverable per machine. Whatever that deliverable is called, the Master Index has no number for it, so
a completed protocol has no controlled identity to be filed under.
`[verify in source — SOP 421 may name its own forms, in which case the finding is that they are missing
from the index rather than that they do not exist]`

### W2-11 · This is the cheapest of the four to close, and the pattern is already built · **CONSIDER**

Three more derived steps in `equipment-readiness.js`, each satisfied by an attached protocol, and the
roll-up, the per-machine panel and the list badges all follow with no new machinery — that is how the
existing ten steps work. It does not perform the qualification, which is engineering work and outside
ReadyDoc. It makes the gap visible and countable, which is the difference between a finding you discover
and one you are already working.

---

## Part 4 — SOP 434 · Chemical, Equipment and Services Approval

> **The auditor:** *"While requirements for equipment changes were defined per SOP 434, change control
> procedures that include processes, software, utility, and physical plant changes were not
> established."* — NSF/ANSI 455-2 § 4.3.9 · 21 CFR 111.130(e)

| The D-002 test | |
|---|---|
| **Program** | The SOP exists, and the auditor says its scope is too narrow. Not in the DCR log (W2-01). |
| **Form** | FORM 700-01 *Approved Chemical List* covers the chemical third. Nothing covers equipment or services. |
| **Record** | **One third present** — `approved_chemicals` is a real approval record. |

### W2-12 · The SOP's title names three things and ReadyDoc records one · **MUST**

`approved_chemicals` is genuinely good: category, manufacturer, product code, SDS number, food-grade
flag, NSF rating, approved applications, maximum concentration, required contact time, **`approved_by`,
`approved_at` and a `review_due`**. That is an approval record with a name and a date on it.

There is **no equipment approval record and no services/contractor approval record at all.** The
auditor's finding is about scope, and the same scope gap exists in the software — which is worth saying
plainly, because it means closing the document half alone will leave the finding half-answered the next
time someone asks for the evidence.

### W2-13 · `controlled.js` is a real change-control gate, over a very narrow slice · **MUST**

This is the good news and the exact size of it. `server/controlled.js` parks a changed **QMS form
definition**, a changed **scale tolerance**, and — since Wave 1 — the **ATP limit**, serving the last
approved version until Document Control approves the new one, and raising a DCR automatically.

That is a working change-control mechanism with an approval gate and an audit trail. It is also the
*whole* of it: it does not see a process change, a utility change, a physical-plant change, or a
software deployment. Widening it is the buildable half of this nonconformance.

**Note the interlock:** software change control is named in **both** § 4.3.9 and § 4.4.39 (electronic
records validation). Building it once answers both, and § 4.4.39 is the finding that names ReadyDoc
directly.

### W2-14 · 111.130(e) requires QC approval on every change, and the DCR flow does not enforce one · **SHOULD**

The current flow routes a parked change to **Document Control**. The regulation requires quality-control
approval, which is a different signature by a different person for a different reason. Today one
approval closes the gate.
`[verify in source — SOP 434 may already require both, in which case the software is the gap and not the
document]`

### W2-15 · SOP 434 and SOP 700 may both govern chemical approval · **SHOULD**

DCR 0027 records `SOP 700 · Food Grade and Non Food Grade Chemicals · V2`, and DCR 0056 records
`FORM 700-01 · Approved Chemical List`. SOP 434 is titled *Chemical*, Equipment and Services Approval.

**Two SOPs may be governing the approval of the same chemicals** — a fact in two places, with the usual
consequence that they will drift and nobody will notice which one is current. Worth ten minutes with
both documents open. `[verify in source]`

---

## Part 5 — SOP 604 · Environmental Monitoring Program

> **The auditor:** *"Surface testing results were not available … as testing had not been conducted as
> established per SOP 604 — Environmental Monitoring Program — V2 — 6/29/26."*
> — NSF/ANSI 455-2 § 4.5.84

| The D-002 test | |
|---|---|
| **Program** | The SOP exists; six quality schedules are seeded from its form and generate work orders. |
| **Form** | **FORM 604-01 V1** *Master Site List (EMP)* — transcribed in full in `server/emp-site-list.js`, limits and all. The best-served of the four. |
| **Record** | **Absent.** A quality-schedule completion writes no result. |

### W2-16 · Completing a quality schedule files no record · **MUST**

`server/api/quality-schedules.js` writes exactly two tables: `work_orders` and `quality_schedules`.
There is no result record — no site, no test, no number, no pass or fail, no lab report tied to a
requirement.

**So a swab that was never taken and a swab whose result went nowhere are indistinguishable.** That is
the auditor's finding stated in software terms, and it is the same defect that put QA's Light Inspection
and Brittle Plastic records months behind: the task completed, and the controlled record it existed to
produce was never filed.

### W2-17 · The form's alert and action limits are transcribed, and nothing is graded against them · **MUST**

`emp-site-list.js` carries the real numbers, faithfully: potable water TAB alert `>500 CFU/mL` / action
`>1000`; total coliforms `Present/100 mL`; free chlorine `>2.0 ppm`; Zone 1 surfaces TAB alert `>300` /
action `>1000 CFU/cm²`, yeast and mould `>150` / `>500`; Salmonella and Listeria action `Present in
sample` across Zones 2, 3 and 4.

**No code compares anything to any of them, because there is no result to compare.**

This is the ATP 35 RLU state exactly as it was three days ago — a critical number living correctly in
one place and enforcing nothing. The difference is that the fix now has a working precedent: a result
record, graded against the limit that the form owns, with the limit stored on the record it graded.
**Wave 1 is the template for this, and that is the strongest argument for doing SOP 604 next.**

### W2-18 · Two of the form's four sections have no schedule derived from them · **MUST**

`EMP_SCHEDULES` seeds **six** schedules: compressed air, Zone 1 equipment surfaces, Zone 1 room
surfaces, Zone 2, Zone 3, Zone 4. That is the air-compressed row and all four surface zones.

**The water section is not among them.** FORM 604-01 requires monthly potable water testing —
Total Aerobic Bacteria Count, Total Coliforms and Free Chlorine, each with its own limits, and a
specified chlorine sample point near where water enters the building. No EMP schedule generates it.

A monthly **"Tap Water Testing"** schedule does exist and the work may well be happening — but it was
seeded before the form was transcribed, it **names none of the three tests, cites none of the limits,
and does not reference FORM 604-01 at all.** Its steps say "record pass/fail" against a specification it
never states. The same is true of the form's *room air* row, served by a pre-existing annual "Air
Testing (Settle Plate)" schedule that likewise predates and never cites it.

**So the program has two mechanisms for the same requirement, one of which is tied to the controlled
form and one of which is not.** That is reliably how one of them goes quiet — and going quiet is the
nonconformance.

### W2-19 · SOP 604 is a hub over three other SOPs, and the four have drifted apart · **SHOULD**

The change log shows the environmental programme spread across four documents that move independently:

| | | Log |
|---|---|---|
| SOP 604 | Environmental Monitoring Program | V2 · 10/17/2025 |
| SOP 600 | Air Monitoring | V1 · 10/17/2025 |
| SOP 601 | Microbial Surface Testing | V1 · 10/17/2025 |
| SOP 608 | Surface ATP Swab Testing | **V4** · 03/04/2026 |

SOP 608 went V1 → V4 over ten months while the programme document that ought to govern it stayed at V2
and the other two stayed at V1. Nothing in the register says whether 604 was checked when 608 moved.

**This is the hub-and-spoke case the document reference graph was designed for**, and after the two
plans it is the clearest candidate in the registry: one governing document, three governed, an obvious
question on every revision. `[verify in source — 604 may cite the other three by number, which is what
the graph needs and what neither plan turned out to do]`

---

## What each one needs from you

| | Decision needed | From |
|---|---|---|
| **W2-01, W2-02** | Were SOP 421 and 434 issued outside the DCR process, or is the log incomplete? Then raise the missing rows. | **Daniela** |
| **W2-03** | Check SOP 604's footer against DCR 0050. | **Daniela** |
| **W2-07** | Supplier qualification: new table, or widen `certifications`? | **Adam** (with me) |
| **W2-08** | Do FORM 404-1 and 404-2 become ReadyDoc screens, or stay with Keychain? | **Daniela** |
| **W2-14, W2-15** | Does SOP 434 already require QC approval? Does it overlap SOP 700? | **Daniela + Adam** |
| **W2-18** | Is monthly potable water testing actually happening against FORM 604-01's three tests? | **Adam** |
| **All four** | Attach the SOPs so the wording review can be done. | **Daniela** |

## What I would build first, and why

**SOP 604.** It is the only one of the four where the program and the form are already right and the
single missing piece is the record — which means it is the smallest build with the largest effect, and
Wave 1 just proved the exact pattern on the ATP limit three days ago. It also closes punch-list item 9
of the walk (OBL-07) and a live nonconformance at the same time.

**Then SOP 421**, because three derived steps on an existing checklist is a day's work and turns a
recurring audit finding into a badge.

**SOP 404 is the largest of the four** — it is a module, not a field — and **SOP 434's software half
waits on the § 4.4.39 software change-control build**, which is the same build. Neither should start
before their documents are in hand.

---

## Corrections made to earlier documents

- **`audit-nc-triage.md` said "eight quality schedules are seeded from [FORM 604-01]".** Six are
  (`EMP_SCHEDULES`). Three others — Tap Water Testing, Air Testing (Settle Plate) and Internal Audit —
  are seeded separately and predate the transcription, which is itself finding W2-18. Nine schedules
  exist on a fresh database, six of them from the form. Corrected in place.
