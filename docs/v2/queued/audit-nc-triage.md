# NSF audit nonconformances — what technology solves, and what it cannot

**Preliminary reports, audit 24–26 Aug 2026 · auditor Sonya Hess · triage drafted 27 Aug 2026**

Two audits, one visit. **Zero critical, zero major, twelve minor.**

| Audit | Scope | Critical | Major | Minor |
|---|---|---|---|---|
| 4990682 · GMP for Sport | NSF 306 §6.2 | 0 | 0 | **3** |
| 4990683 · NSF/ANSI 455-2 | GMP for Dietary Supplements | 0 | 0 | **9** |

Both reports are marked DRAFT and have not been through technical review. The final report and
corrective action report arrive in NSF Connect within 10 business days.

---

## The headline, and it decides the plan

**Eleven of the twelve findings are phrased as a document or a record that does not exist, or was not
available.** Read them in the auditor's own words:

> *"…are not established"* ×4 · *"was not available"* ×3 · *"were not conducted"* ·
> *"not prepared"* · *"not provided at the time of the audit"* · *"evidence … was not available"*

Only one — **4.2.9, street shoes in GMP areas** — describes something the plant *does* that it should
not. Everything else is the plant doing work whose evidence is missing, or a procedure nobody has
written down yet.

**That is precisely the failure mode this platform exists to prevent**, and it is the same finding the
preventive-control walk reached from the other direction: work that happens and does not accumulate a
record. It also means the honest split is not "software vs. people". It is three buckets.

### The three buckets

| | |
|---|---|
| **A — ReadyDoc is the fix** | The missing thing *is* a record, a gate or a program. Build it and the nonconformance closes. |
| **B — ReadyDoc makes it stick** | A person must do the work. ReadyDoc raises the obligation, catches the result, and makes a miss visible instead of silent. **Most findings are here.** |
| **C — Outside ReadyDoc** | A document to write, a study to run, a behaviour to change. ReadyDoc can hold the outcome; it cannot produce it. |

---

## GMP for Sport — 3 minor, all one subject

All three are the banned/prohibited substances requirements, and all three have the same root: **the
procedure does not exist.** The plant already has a draft — `SOP-DRAFT-BSC`, *Banned and Prohibited
Substance Control Program*, sitting in the registry unnumbered and unapproved.

**This was predicted.** Red-line finding **FSP-28** raised exactly these three sections from the GMP for
Sport Audit Guide on file, before the reports arrived. It is now promoted to MUST.

### §6.2.2 — procedures prohibiting banned substances · **C, then B**
*Operating procedures prohibiting Banned/Prohibited Substances from being manufactured, received, or
warehoused are not established.*

Writing the SOP is Document Control's job (**C**). Once written, ReadyDoc versions it, trains against
it and evidences the training (**B**) — `training_courses.sop_id` and `retrain_on_doc_change` already
do this. The procedure must cite the four lists by name: **NSF 306 Annex C, NFL/NFLPA, MLB, WADA**.

### §6.2.3.1 — documented annual review of the lists · **B**
*Procedures to review annually at minimum … are not established.*

Two halves, and the second is ours. The procedure is a document (**C**); **the review actually
happening every year is a program that generates dated work and a record** — which is the exact shape
`quality_schedules` already provides for tap water and the EMP swabs. One seeded annual schedule, one
record per review, and the question "when did you last review the WADA list" has an answer with a date
and a name on it.

### §6.2.3.2 — purchased materials checked against the lists · **A**
*Procedures ensuring all materials purchased are not on the Banned/Prohibited Substances lists are not
established.* Note the requirement's own wording: *"and **document execution** of those procedures."*

**A record per receipt is what this asks for, and there is already a form that catches every receipt.**
FORM 204-01, the Receiving Inspection Checklist, is worked at the truck and refuses sign-off on a blank
answer. One added line — *"Materials checked against the banned/prohibited substance lists"* — closes
this with a dated, signed record per arrival, and the escalation machinery already exists for a YES.

That is a small, contained change to `server/receiving-checklist.js`, and it is a **Document Change
Request first**: the checklist is not user-editable by design.

---

## NSF/ANSI 455-2 — 9 minor

### 4.4.39 — Electronic records are not validated · **A · this one is ours**
*While software applications ReadyDoc and MRP Easy utilize functional compliance features such as
unique user logins and audit trails, formal documentation demonstrating validation of the systems was
not available.* [21 CFR 11]

**The only finding that names ReadyDoc directly, and the auditor's wording is generous — the features
are there, the documentation is not.** Note that 21 CFR Part 11 is a normative reference for 455-2
(NSF/ANSI 455 Certification Policies), which red-line **FSP-27** flagged as *consider*. It is now a
live nonconformance and is promoted to MUST.

What is missing is a **validation package**, not features:

- **Intended use and scope** — which records ReadyDoc holds that are GMP records.
- **A Part 11 gap assessment** — audit trail, e-signature components, record retention and retrieval,
  access control, copies for the agency. Much of this already exists and simply has never been written
  down as a claim with evidence: append-only `audit_log` with actor, role and department; signature
  revocation; records retired rather than deleted; signed records closed to edit.
- **IQ/OQ/PQ for the system** — installed as specified, functions as specified, performs in use.
- **Test scripts with recorded results**, approved by Quality.
- **Change control over the software**, which is also finding 4.3.9 below.

This is a real project and it is the single highest-value technology deliverable on the list, because
it protects every record ReadyDoc holds. **MRPEasy's half is not ours** — that is the vendor's
documentation, and the plant is migrating off it (D-004).

### 4.3.1 — Supplier qualification questionnaires missing · **A**
*The Supplier Qualification Questionnaire required per SOP 404 was not available for: Mill Haven Foods
(Whey Protein), M4 Dynamic (Potassium Citrate, B12), Bay State Milling (Cinnamon).*
[21 CFR 117.405 & 117.410]

**The SOP exists; the records do not.** FORM 404-1 and 404-2 are in the Master Index marked
`where: keychain` and, per D-021, producing nothing. This is exactly the state that walk predicted.

**A supplier qualification module is a real ReadyDoc build** and a well-understood one: supplier,
ingredient, risk evaluation, qualification activity determined by risk, certificate on file with an
expiry that generates a task, the approval decision with a signature, and ongoing performance review.
The expiring-certificate pattern already exists in `certifications`, and the approval pattern in
`qms_records`.

### 4.3.6 — Specifications · **A for the forward half, C for the history**
*Specifications were not established prior to July 2026 … organoleptic evaluations were conducted to
verify identity for dietary ingredients which is not appropriate by itself … purity, strength,
composition specifications were not established … testing did not include assay.* [21 CFR 111.70]

Read the auditor's note carefully — **it is unusually favourable.** They record that the facility had
already identified specifications and testing as a gap, built templates, approved raw-material specs
on 7/9/26 and finished-product specs on 8/21/26, and submitted samples in August with results not yet
back. The finding is about the period *before* that, which no software can retroactively fix (**C**).

Forward, this is **A**: `coa_specifications` already grades a result against a spec per item and test,
and `spec-seed.js` already drafts the standard panel for the most-tested items. What is missing is
(1) **raw-material specifications as approved documents** covering identity, purity, strength,
composition and contaminants, and (2) **a release gate that refuses a lot with no active spec** — today
a test with no spec quietly passes, which is the same defect class as the ungraded ATP reading.

### 4.3.9 — Change control does not cover processes, software, utility, physical plant · **A + C**
*While requirements for equipment changes were defined per SOP 434, change control procedures that
include processes, software, utility, and physical plant changes were not established.* [111.130(e)]

The procedure is a document (**C**). But note what already exists: `controlled.js` is a **real change
control gate** — a changed form definition or acceptance criterion is parked until Document Control
approves it, and it raises a DCR automatically. That is narrower than this requirement asks and is the
right foundation to widen (**A**). The requirement adds one thing the current DCR flow does not
enforce: **QC approval on every change**.

**Note the interlock with 4.4.39:** software change control is named in *both* findings. Building it
once satisfies both.

### 4.5.8 — IQ/OQ/PQ not provided for any equipment · **B**
*…as required per SOP 421 … were not provided for any of the facility equipment; for example, mixers
and stick pack machines.* [21 CFR 111.30]

Performing the qualification is engineering work (**C**). Holding it is **B** and nearly free:
`equipment-readiness.js` already derives a per-machine checklist from records — PM schedule, team,
LOTO, hygienic design verification, course, work instruction. **Adding IQ/OQ/PQ as three more derived
steps, each satisfied by an attached protocol, makes "which machines are unqualified" answerable on a
screen instead of at an audit.** The pattern, the roll-up and the badges already exist.

### 4.5.43 — No MMR per formulation and batch size · **A · the big one**
*A blank MMR template is established, 413-1 Packaging Batch Production Record; however, there is not an
MMR established and approved by Quality for each formula and batch size.* [21 CFR 111.205(a)]

This is the headline of `docs/SQF-NSF-gap-analysis.md`, confirmed by an auditor. Note the precise
finding: the **template** exists, the **per-formula approved masters** do not.

**Master manufacturing record** — per formulation and batch size: components with identity and
weight, theoretical yield, specifications at each control point, the written procedure for each step,
approved and signed by Quality *before use*. **Batch production record** — the executed version, with
actual weights, component lots, who performed and who verified each step at the time, in-process
results against spec, actual versus theoretical yield, and the release decision.

**Sequence matters:** the MMR is the smaller build and it is the finding. The BPR is the larger one and
depends on it. It should link to the Production Log rather than replace it — the same relationship
Flavor Approval and Organoleptic already have.

### 4.5.84 — The environmental monitoring program is not adhered to · **B**
*Surface testing results were not available … as testing had not been conducted as established per SOP
604 - Environmental Monitoring Program - V2 - 6/29/26.*

**The walk found this from the software side and reached the same place.** FORM 604-01 is transcribed
in full, six quality schedules are seeded from it, and **a quality-schedule completion files no
record** — so a swab that never happened and a swab whose result went nowhere look identical.

ReadyDoc cannot swab a surface (**C**). What it can do is make the miss loud: an **environmental result
record** with its site, its limit, its pass/fail and its trend, so *"testing had not been conducted"*
is visible on a dashboard in week one rather than at an audit in month three. **This is punch-list
item 9 of the walk and it just acquired a nonconformance.**

### 4.2.9 — Street shoes in GMP areas · **C, with B behind it**
*Gaps in hygienic practices/procedures were observed … street shoes were worn in GMP areas without
covers or appropriate cleaning.* [21 CFR 111.10(b)]

**The only finding about behaviour rather than paperwork.** No software prevents it. What ReadyDoc can
add is the thing the red-line already lists as absent: a **GMP observation record** — the routine
walk-through where somebody checks gowning, hairnets, jewellery, handwashing and footwear, and signs
it. That turns a recurring behaviour into a trend somebody owns, and it is the record an auditor asks
for after making this observation.

The dormant `checklist_templates` engine (typed `gmp` already) is the natural home.

### 4.6.21 — Shelf life not supported by data · **C**
*Product bears an expiration date however, evidence that shelf life is supported by data was not
available.*

A stability study is laboratory work over real time and nothing about it is a software problem.
ReadyDoc's part is afterwards: hold the study, and link each product's expiry to the study that
justifies it — so the answer to *"why 24 months?"* is a document rather than a convention. Small, and
it waits on the study.

---

## The plan, by bucket

### A — ReadyDoc is the fix · 5 findings
| | Finding | Size |
|---|---|---|
| **1** | **4.4.39 · Part 11 validation package for ReadyDoc** | Large · protects every record in the system |
| **2** | **4.5.43 · MMR per formulation and batch size** (then the BPR) | Large · the standing headline gap |
| **3** | **4.3.1 · Supplier qualification module** | Medium · patterns already exist |
| **4** | **4.3.6 · Raw-material specs as documents + a release gate** | Medium · extends `coa_specifications` |
| **5** | **§6.2.3.2 · One line on FORM 204-01** | Small · closes a finding outright |

### B — ReadyDoc makes it stick · 4 findings
| | Finding | What ReadyDoc adds |
|---|---|---|
| **6** | **4.5.84 · EMP** | An environmental result record, so a miss is visible in week one |
| **7** | **4.3.9 · Change control** | Widen `controlled.js` beyond form definitions; add QC approval |
| **8** | **4.5.8 · IQ/OQ/PQ** | Three derived steps on the equipment readiness checklist |
| **9** | **§6.2.3.1 · Annual list review** | One annual quality schedule and its record |

### C — Outside ReadyDoc · 3 findings
| | Finding | Who |
|---|---|---|
| **10** | **§6.2.2 · Write and approve the banned-substance SOP** | Document Control — the draft already exists |
| **11** | **4.2.9 · Footwear control in GMP areas** | Operations, today. A GMP observation record follows. |
| **12** | **4.6.21 · Stability study** | Quality + the lab, over real time |

### The order I would take them in

**This week, before anything is built:** items 10 and 11. The banned-substance SOP is a draft away from
closing three nonconformances, and the footwear finding is the only one that is about product safety
right now rather than evidence.

**Then item 5** — one line on the receiving checklist, closing §6.2.3.2 with a dated record per arrival.

**Then item 1, the Part 11 validation package**, because it is the one that names ReadyDoc and because
every other record the platform holds rests on it.

Items 2 and 3 are quarter-sized projects and should be planned rather than started.

---

## Interlocks worth knowing before scheduling any of it

- **4.4.39 and 4.3.9 both require software change control.** Build it once.
- **§6.2.2, §6.2.3.1 and §6.2.3.2 are one SOP with three obligations.** One document, one schedule, one
  checklist line — not three projects.
- **4.5.43 (MMR) and D-021 are the same fact from two directions.** FORM 413-1 is the plant's own number
  for the batch production record, it is on paper in MRPEasy today, and the auditor has now recorded
  that the per-formula masters do not exist. The "absorb or API-connect" decision is no longer
  open-ended.
- **4.3.6 and the ATP work share a defect class.** A test with no active specification quietly passes,
  exactly as a 60 RLU swab quietly passed before `atp-limits.js`. The fix is the same shape: grade
  against an approved value, and refuse to record a pass without one.

## Progress against this list — 1 September 2026

**0 of 12 closed. 1 with work landed.**

### 4.3.1 · Supplier qualification questionnaires — REGISTER BUILT, FINDING STILL OPEN

Built and on `main`: a Supplier Qualification register (there was no supplier record in ReadyDoc of any
kind before it), 75 suppliers reconciled between Purchasing's tracker and the document archive — which
disagreed about 48 of them — 938 documents stored and searchable by the text inside each PDF, expiry
dates read from the filenames (ten certificates on file had already expired and nothing knew), and the
annual review raising its own work order 30 days ahead. Nothing was imported as qualified.

**It did not close the finding, and this is the part to say out loud before an auditor does.** NSF named
three suppliers. Checked against the archive as loaded: **Mill Haven Foods** has two documents on file
and both are specification sheets, not a questionnaire; **M4 Dynamic** and **Bay State Milling** have no
folder in the archive at all. All three gaps are still open. What changed is that they are now provable
rather than unknown.

Register-wide: 43 suppliers actively used with no approved disposition — **22 that can be dispositioned
today** (evidence already on file, now queued in-app with each supplier's documents beside the decision)
and **21 with no questionnaire to decide against**. The second pile, and the three NSF named, are a
purchasing chase. No software can ask a supplier for a questionnaire.

### The other eleven

Not started. Tracked in `docs/v2/obligations.json`; a finding is marked closed here only when the
corrective action is complete and its evidence can be produced on request.
