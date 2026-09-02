# Foundation to Spire — ARCH-001

**Revision 2 · 24 August 2026 · Scope: FSQA (office excluded) · Status: exploration, not a change request**

*What changed in Revision 2.* The Food Safety Plan (Protocol 003 V4) and Food Defense Plan (Protocol
001 V2) have now been walked against the test in §1 — `docs/v2/preventive-control-walk.md`. Four
changes follow, all of them evidence rather than opinion: L2's load-bearing rule now admits a
**trigger** as well as a cadence (§2, D-009); §5 gains the preventive-control reading; §6 gains the
sharpest instance of the recurring defect the whole document is about; and moves **03** and **05**
in §7 gain the concrete cases the walk supplied. Revision 1's argument is unchanged — the walk
supported it rather than moved it.

What a food-safety and quality system should look like if it were built from the ground up, and an
honest reading of where Powder Ops FSQA already stands against it.

There is a styled reading copy of this document as an artifact. **This file is the authority** — the
artifact is a rendering of it. If they disagree, this file is right, and the artifact should be
re-published from it. Its HTML source is kept beside this file as `foundation-to-spire.artifact.html`,
so a cold session can update the published page without re-reading it; republish that file to the
existing artifact URL rather than creating a second one.

---

## 1. The thesis

Almost every compliance platform is built as a **collection of logs**. That is the wrong primitive,
and it is the source of nearly every recurring defect in this codebase.

A plant does not run on logs. It runs on a claim — *this is how we make food safely* — and on evidence
that the claim was honoured, every shift, by named people, on dated equipment, against written limits.
A log is just one view of that evidence. When logs are the primitive, each one grows its own table, its
own signature column and its own idea of what "done" means, and the system's job quietly becomes
keeping dozens of near-identical mechanisms in agreement with each other.

The right primitive is **a single spine**: a controlled statement of how the plant works, an obligation
generated from it, work performed against that obligation, a record produced *by* that work, and a
signature that closes it. Everything a user sees — a log, a queue, a dashboard, an auditor's binder — is
a lens onto that one spine.

> ### The test that decides the architecture
>
> Ask of any fact in the system: **how many places could disagree about it?** If the answer is more than
> one, that is not a bug waiting to happen — it is a bug that has already happened and simply hasn't
> been noticed yet.

**Note on the word "spine".** It means the record lifecycle below, not the Food Safety Plan or the Food
Defense Plan. Those documents sit at node 01 of the spine — they are where it starts, not what it is.
See `decisions.md`, D-002.

---

## 2. Foundation to spire — the layers

Seven courses, each resting on the one below. **A layer may only depend downward** — that is the reason
the tower stands. Read from the bottom.

### L0 — Foundation: identity, subject, time

Who did it, what it was done to, and when. The bedrock every record above stands on, and the only layer
with no upstream dependency.

*People & grants · equipment / area / room · product / lot / MO · event time vs entry time · append-only audit*

> **Load-bearing rule.** Event time and entry time are two different facts and both are always stored. A
> check done Monday and recorded Thursday is a Monday record that says it was written on Thursday.

### L1 — The controlled word: document control

SOPs, work instructions, forms, specifications, tolerances, limits, cadences. Versioned, approved,
effective-dated, withdrawn — never edited in place.

*Document registry · revisions · form register · acceptance criteria · change control · training linkage*

> **Load-bearing rule.** Every limit the software enforces is a **value owned by a document revision**,
> not a constant in code. Changing a tolerance is a document change, and the system must make that
> literally true.

> **Corollary, added in Revision 2.** A **form number belongs to the plant, not to the system that
> produces the record.** FORM 413-1 is the plant's number for the batch production record and predates
> Keychain; which system generates it today is a separate fact, allowed to change without the number
> changing. Same doctrine as a renamed SKU keeping `legacy_sku`, and a retired form number never being
> reissued. See D-017.

### L2 — Program: what must happen, and how often

Cadence bound to a controlled procedure and a responsible team. PM, sanitation, QA checks, calibration,
EMP, internal audit, recall drills.

*Schedules · obligation generator · ownership · missed-work rules*

> **Load-bearing rule.** A schedule carries no wording of its own. It **references** the document that
> defines the work, so re-issuing the document changes the work everywhere at once.

> **Load-bearing rule, added in Revision 2.** A program may be a **trigger** rather than a cadence.
> Three of the Food Safety Plan's four preventive controls fire per production run — "at the beginning
> of every run", "at the end of every run", "at the beginning of every machine start up" — and every
> generator in the platform today is a calendar. A control that fires per run and one that fires per
> week are the same obligation. What fails this layer is a control that depends on somebody *deciding*
> to start it. See D-009.

### L3 — Execution: work

The obligation reaches a person. One task object for every kind of work: scheduled, ad-hoc, corrective,
or raised from a conversation.

*One task object · assignment & routing · offline capture · evidence requirements · EN/ES*

> **Load-bearing rule.** One completion path. Three ways to finish a task is three chances for the
> record it should have produced to go unwritten.

### L4 — Evidence: the record

What survives the shift. One record shape: form number and revision, actor, event time, entry time,
readings, attachments, signatures, exceptions.

*Record spine · signature service · attachments · deviation → CAPA · late-entry honesty*

> **Load-bearing rule.** A record is created by **completing work**, never by typing into a log. Direct
> entry exists only as a named exception — back-dated, reasoned, and visibly marked.

### L5 — Assurance: verification & review

The second pair of eyes. Counter-signature, trending, internal audit, management review, effectiveness
checks.

*QA counter-signature · review cadence · trending · internal audit · management review*

> **Load-bearing rule.** Verification is a **state on the record**. Every queue is a query over that
> state — never a separate list that can drift from it.

### L6 — Presentation: the spire

What an auditor, a customer or a certification body is shown. Retrieval, process maps, printable
controlled copies, the traceability walk.

*Auditor view · record retrieval · process maps · mock recall walk · controlled printing*

> **Load-bearing rule.** The auditor view is the same records under a different lens — never a report
> assembled for the audit. If it needs preparing, the layers beneath it failed.

### Cross-cutting, every layer

Identity & access · audit trail · notification & routing · offline / edge capture · bilingual surface ·
search & retrieval.

These six are **not modules**. They are services every layer calls, and each one is a place where a
second implementation quietly appears if nobody owns it.

---

## 3. The spine, end to end

One path from a written procedure to an auditor's question. Every module in the plant is a
specialisation of this — not a parallel version of it.

```
01 Controlled document   Defines the work, the limits and the form it is recorded on.
      ↓
02 Program               Binds that document to a cadence and an owning team.
      ↓
03 Obligation            A dated instance: this, by this team, by this date.
      ↓
04 Work                  A person does it and captures what the form asks for.
      ↓
05 Record                Written by the completion itself, stamped with form and revision.
      ↓
06 Verification          A second pair of eyes signs, or sends it back.
      ↓
07 Retrieval             Found by date, lot, equipment, person or form number.
```

**Out of spec, at any step:**

```
Exception raised → Investigation → Product disposition → Corrective action → Effectiveness check
```

> **One exception spine, not one per module.** A failed tasting, an out-of-tolerance scale, a
> temperature excursion, a rejected receipt and a contaminated line are the same shape of event:
> something was outside the written limit, product may be affected, and somebody must decide. Building
> that path five times produces five subtly different definitions of "closed".

---

## 4. Requirements, by the three jobs it has to do

A compliance system serves three audiences who want opposite things. These are written as **tests** —
each one either passes or it doesn't.

### Train — new hire · cross-training · retrain on revision

| # | Test |
|---|------|
| T1 | Every task links to the document that teaches it, in one tap, in the reader's language. |
| T2 | Competency is a record, not a spreadsheet: person × document revision × date × evidence. |
| T3 | Re-issuing a document raises retraining for everyone qualified on the old revision — automatically. |
| T4 | The system knows when work is assigned to somebody untrained on it, and says so before the shift, not after the audit. |
| T5 | A new hire can be productive on day one from the task list alone, without a person beside them. |

### Operate — floor, supervisors, QA, every shift

| # | Test |
|---|------|
| O1 | One screen answers "what do I owe today", per person, on a phone. |
| O2 | A routine record takes under sixty seconds, gloves on, and never asks twice for the same fact. |
| O3 | Capture works with no signal; approvals deliberately do not queue. |
| O4 | Reporting an exception is faster than hiding one. |
| O5 | Every refusal explains itself and names the way forward. |
| O6 | Nothing that needs a human's attention lives only on a screen that human never opens. |

### Present — SQF / NSF auditor, customer, regulator

| # | Test |
|---|------|
| P1 | Any record retrievable in under thirty seconds by date, lot, equipment, person or form number. |
| P2 | Every figure on a dashboard opens the rows behind it, and they reconcile exactly. |
| P3 | A gap is visible as a gap — never silently absent, never quietly back-filled. |
| P4 | Each record names the form and revision it was made against, and keeps it when the form moves on. |
| P5 | A mock recall runs end to end from live data inside the drill's own time limit. |
| P6 | Nothing is prepared for the audit. The preparation is the operating discipline. |

---

## 5. Where the platform stands today

Measured, not estimated — counted from the running schema and the source tree on 21 Aug 2026, FSQA
scope only.

| Metric | Count |
|---|---|
| FSQA tables | 57 |
| FSQA records held | 7,662 |
| FSQA modules in nav | ~50 |
| API routes | 764 |
| **Files that write a signature** | **34** |

That last figure is the architecture, stated as a number. A signature is the most consequential write in
a compliance system — a person asserting they reviewed something — and today it is implemented in
thirty-four places. Each is defensible on its own. Together they are why "two mechanisms disagreeing"
keeps appearing in the defect history.

The layer-by-layer reading is genuinely mixed, and more of it is strong than the raw counts suggest.

| Layer | Today | What is already right | What is missing |
|---|---|---|---|
| **L0** Foundation | Strong | One identity per person, granular module grants, append-only audit with actor/role/department, event-time vs entry-time honoured with reasons. | Subject identity is split — equipment, instruments, rooms and areas are four vocabularies for overlapping things. |
| **L1** Controlled word | Partial | Registry, revisions, withdrawal with reason, form register, and a real change-control gate that parks unapproved definition changes. | Most limits still live in code (tolerances, temp/humidity, cadences). Change control covers some, not all. Documents don't yet own the values the software enforces. |
| **L2** Program | Partial | PM, sanitation, quality and document-review schedules all generate work; missed-work handling is thought through. | Four independent generators with four cadence models. A schedule holds its own step text rather than referencing a document. |
| **L3** Execution | Strong | `work_orders` is genuinely one task object — 2,230 rows covering PM, cleaning, QA checks, document review and chat-raised work. Offline capture, bilingual floor strings, one operator screen. | Three completion paths, one of which cannot satisfy the evidence gate. Quality schedules sit outside the task object. |
| **L4** Evidence | **Fragmented** | The QMS spine is the proof the pattern works: ten record types, one table, one config, one editor, one permission rule. | Everything outside it has its own shape — sanitation, production, COA, scale, receiving, audit items. Signatures in 34 files. Completion writing a record was retrofitted, and had to be back-filled once already. |
| **L5** Assurance | Strong | QA Review is exactly the right shape — one queue, seven sources, and signing calls each module's own function rather than writing columns itself. | Counts are computed per source; badge and queue have already disagreed once. Trending is thin. |
| **L6** Presentation | Partial | Auditor view with process maps, form numbers derived at read time, drill-downs that reconcile to their headline figures. | No single retrieval surface across record types — "show me everything for lot L-101692" means visiting several modules. |

### The preventive controls, specifically  *(added in Revision 2)*

The table above reads the platform by layer. The plan walk reads it by **control**, which is the
reading an auditor actually takes, and it is harder.

| | Control | Program | Form | Record |
|---|---|---|---|---|
| **PC #1** | ATP / pathogens · limit **35 RLU** | Daily clean, not per run | 111-01 → Keychain; 108-03 in app | Column exists, **never graded, empty in every seeded row** |
| **PC #2** | Allergen swab · no residual | Nothing fires at end of run | 111-01 → Keychain | Boolean only |
| **PC #3** | Screens · 50/70 mesh | Nothing fires at machine start-up | Observations on BPR → Keychain | None |
| **PC #4** | X-ray · NFe 2 mm, Fe 2 mm, SS 4 mm | Nothing generates the challenge or the 2–3 hourly check | 413-1 (X-Ray) → Keychain | None |

**`haccp_ccps` holds zero rows**, and neither X-ray machine is linked to a CCP, though both are in the
equipment registry. The table is modelled almost field-for-field for the plan's own chart.

The form leg is fine — those are the plant's numbers and always were (D-017). It is the **record** leg
that is empty in ReadyDoc for all four, and the **program** leg that has nothing to hang a per-run
obligation off. That is the state of L2 and L4 stated at the altitude the audit asks about.

---

## 6. The diagnosis

**The defect history is the architecture review.** Read the recurring bugs together and they are one bug.

QA inspections completing without filing their record. Cleaning logs with the same gap. Task titles and
record areas using different vocabularies for one check. A knife's status column disagreeing with its
sign-out log. Badge counts disagreeing with the queue they summarise. Two screens disagreeing about
whether a task exists. A weekly checklist carrying the annual work. A cancelled task counted as a missed
one, so tidying up lowered the completion rate.

**And the sharpest instance of all, found by the plan walk in Revision 2:** the cleanliness of a
food-contact line before a run is recorded in two places — `sanitation_records.atp_reading`, a number
nothing grades, and `production_entries.cleaning_events[].atp_swab`, a boolean. The plan states the
control as **≤ 35 RLU**. Neither mechanism carries that limit, so a 60 RLU reading files as a pass and
a swab that was never read files as a tick. One fact, two homes, and the number that decides it lives
in neither — a preventive control, not a badge count.

Every one is **a fact that exists in more than one place**. Not carelessness — the predictable
consequence of a module-shaped architecture, where each module reasonably implements the parts it needs
and the seams between them are where the truth splits in two.

> **What follows from that.** The valuable refactors are not features. They are **consolidations**: take
> a fact currently written in many places and give it exactly one owner. The codebase already does this
> well in five places — the QMS spine, QA Review, the form registry, derived readiness, and now
> `pm-completion.js`. Those are the pattern to extend, not a new pattern to invent.

---

## 7. Recommended moves, in order

Ranked by value per unit of risk. The first three are worth doing regardless of anything else; the last
two only once the audit is behind us.

### 01 — One signature service  ·  *contained · no migration · highest value*

A single module owns "person P asserts S about record R at time T", including revocation and the rule
about who may sign what. The thirty-four call sites become one. **Do this first:** it is contained, it
touches no schema, and every future consolidation gets easier once signatures have one shape.

### 02 — A record interface, before a record table  ·  *incremental · no migration · unblocks L6*

Don't merge the tables — define what every record module must implement: **file, sign, revoke, retrieve,
describe**. Adopt it module by module. This buys the cross-cutting retrieval surface and the honest
counts without a single migration, and it is what makes a shared table optional later rather than urgent.

### 03 — Move limits out of code and into documents  ·  *medium · extends change control · audit-facing*

Every tolerance, temperature limit, humidity threshold and cadence becomes a value owned by a document
revision, read at grading time. Change control already exists for a subset — extend it rather than
duplicating it. The audit question this answers is the sharpest there is: *show me the approved document
that says 78°F, and show me that the system used it.*

> **The pilot, named in Revision 2: PC #1's 35 RLU.** It is the ideal first case because the limit is
> *already* owned by an approved document revision — Protocol 003 V4 — so nothing has to be moved out
> of code. It was never in code. `gradeReadings()` in `scale-forms.js` is the working precedent, the
> doctrine is written down ("a reading outside tolerance can never be filed as a pass"), and
> `controlled.js` is the gate that already parks an unapproved change to an acceptance criterion. The
> same pass collapses the boolean `cleaning_events.atp_swab` into the graded reading, so move 06 gets
> a mirror column retired for free.
>
> **It lands on `main`, not on the V2 branch.** It changes `server/api/sanitation.js`, which is live
> shared code, and D-005 puts that on Track A in one pass.

### 04 — One retrieval surface  ·  *follows 02 · auditor-facing*

A single query across every record type by date, lot, equipment, person and form number — one screen
that answers "everything about lot L-101692" without knowing which module holds it. Falls out almost
free once move 02 lands, and turns the mock recall from an exercise into a lookup.

### 05 — Collapse the four schedule generators into one  ·  *larger · touches live schedules · after the audit*

PM, quality schedules, document review and sanitation re-cleans each generate work their own way. One
generator, one cadence model, schedules referencing documents rather than carrying their own step text.
Worth real planning — this one moves live data.

> **What the walk added, and it does not move this up the list.** One cadence model is not enough. All
> four generators are calendars, and three of the plan's four preventive controls fire **per production
> run** — so the one generator has to grow a second kind of trigger, and there is currently no object
> in the system for "a run" to hang one off. The nearest thing, a `production_entries` row, is filed at
> the *end* of the shift, after both run-boundary controls should already have fired.
>
> This is the platform's highest-consequence work sitting behind its most-deferred move, which is worth
> knowing and is not an argument for doing it sooner. The record leg of those controls (move 03, above)
> is what an auditor asks for and is contained; the trigger leg is the refinement, and it waits.

### 06 — Audit every mirror column, then delete or derive it  ·  *ongoing · low risk*

A standing sweep rather than a project: find each column that duplicates a fact held elsewhere, and
either derive it at read time or make one writer own it. Knife status, NFP version and the product
readiness fields have each already produced this bug once, and the pattern for fixing it is established.

---

## 8. What not to do

**Do not rebuild.** That is the most important sentence in this document.

This blueprint describes a target to refactor toward, not a system to start over on. The platform holds
7,662 live FSQA records, encodes several years of the plant's own vocabulary, and is close to a
certification audit. A rewrite would trade a working system with known seams for a clean architecture
with unknown ones — and would lose the single most valuable asset in the codebase, which is not the code
at all but the accumulated record of **why** each rule is shaped the way it is.

Three further cautions, each learned here rather than imported:

- **Don't generalise a module that only has one instance.** A record interface earns its keep across
  eight record types; a framework for one is a second thing to maintain.
- **Don't consolidate a screen that is working.** Modules that already print their form number, or
  already reconcile their counts, are finished. Touching them before an audit buys nothing.
- **Don't let the architecture erase the exceptions.** Half the rules in this system exist because the
  plant genuinely works that way — one tasting producing two records, a knife's state living in the log
  and not the row, a clean recorded per event rather than per shift, an evacuation reason that is two
  things at once. A cleaner model that cannot express those is a worse model.

> **The order that actually matters.** Signatures, then a record interface, then limits into documents.
> Everything else can wait, and moves 05 and 06 should wait. If only one thing happens this quarter,
> make it the first.
>
> *Revision 2 qualifies this in one place only.* The walk found a preventive control whose limit is
> unenforced today, and move 03's pilot for it is small, contained and already has its document. If
> the audit lands before the signature service does, do that pilot first — not because the ordering is
> wrong, but because a stated critical limit that nothing enforces is the one finding on this list an
> auditor can reach on their own.
