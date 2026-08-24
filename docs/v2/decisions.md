# V2 decisions

The running record of what has been **decided** about V2, and why. `architecture.md` describes the
target; this file records the choices made on the way there, including the ones that closed off an
option.

**How to use it.** A new session reads `architecture.md` for the target and this file for the state.
Append; never rewrite. A decision that turns out to be wrong gets a **superseding entry** that says so —
the original stays, because the reasoning that led to it is usually still worth having. This is the same
rule the codebase follows for records: nothing is deleted, things are retired.

**Format.** `D-nnn · date · status` — status is `decided`, `open`, or `superseded by D-nnn`.

---

## D-001 · 2026-08-21 · decided — Do not rebuild

V2 is a **target to refactor toward, not a system to start over on**. The platform holds 7,662 live FSQA
records, encodes years of the plant's own vocabulary, and the most valuable asset in the repository is
not the code but the accumulated record of why each rule is shaped the way it is (`CLAUDE.md`, and the
comments in the modules themselves).

Consequences that follow and are binding unless a later entry overturns them:

- Every V2 move must be adoptable **module by module**, with the old and new shapes coexisting.
- Any move requiring a data migration is deferred until after certification and planned separately.
- A move that would delete an exception the plant genuinely relies on is rejected, not worked around.

---

## D-002 · 2026-08-24 · decided — "The spine" is the record lifecycle, not the Food Safety Plan

Raised directly: does "a single spine" mean the Food Safety Document / Food Defense Plan?

**No — but they are the top of it.** The spine is the record lifecycle: controlled document → program →
obligation → work → record → verification → retrieval. The Food Safety Plan and Food Defense Plan are
documents at **node 01**. They are where the spine starts; every branch below inherits from them.

The useful consequence is a test for the plan revamp:

> Every preventive control named in the Food Safety Plan should resolve to a program that generates
> dated work and a numbered form that catches the record.

Walk the plan with that test and each control is one of three things: wired (good), running but
unrecorded (a finding waiting to happen), or described but not actually done (worse). `GET /api/forms`
already reports part of this — the active schedules and record areas that map to no form number.

---

## D-003 · 2026-08-24 · decided — Flip vocabulary at once; flip records and habits one control at a time

The stated preference was to build V2 alongside the running system and switch over in one night, clean
and fully trained.

**Split verdict.**

*Vocabulary flips at once.* Room names, form numbers, team names, what "complete" means, what "verified"
means. These cannot be half-migrated — the schedule and the Production Log once kept separate room lists
long enough that a shift could be scheduled in a room it could not be reported in.

*Records and habits do not.* A parallel system that isn't the system of record is a system nobody keeps
current — and that state is exactly where things fall through the cracks. The precedent is in this
codebase: QA inspections fell through for three months and the cleaning logs had the identical gap, and
neither surfaced because a process caught it. Someone noticed a list was empty.

**So: flip one spine at a time, not one system at a time.** Take a single control — cleaning is the
obvious candidate, daily and universal — all the way from the revised SOP through the program, the form,
the record, the verification and the auditor view. Everyone learns the *shape* once, on work they
already do every morning. The second control is then a variation, not a new system. This is also the
training story: you train the spine, not fifty modules.

A long-lived V2 fork **is** the big-bang cutover wearing engineering clothes. See D-005.

---

## D-004 · 2026-08-24 · open — ERP (Keychain) is out of scope until it is counted

Question raised: should ReadyDoc absorb what Keychain does, saving ~$30k/yr?

**Recommendation: not the whole thing, and the $30k is not the number that decides it.** The build isn't
the cost; owning a financial system of record forever is. An FSQA bug is caught by an audit finding; an
inventory-valuation bug compounds silently into the books.

Evidence already on hand:

- 568 of 592 journal entries came from MRPEasy, and the accountant removed that integration **because it
  was inaccurate**. Nothing has posted WIP or COGS since 30 April 2026. A bought ERP already got the hard
  part wrong here.
- A large share of what an ERP does for this plant, ReadyDoc already holds: MOs, lots, quantities, rooms,
  cleaning events, QA decisions, receiving keyed to PO and inspection number, retention samples. That is
  the **traceability half**, and it is the half the audit cares about.

**Before deciding anything, run the discovery that already exists.** `discoverQuickBooks()` counts every
entity *without downloading it*, and the most valuable line in that report was the zero — a feature with
no records is a feature the replacement needn't carry. Point the same technique at Keychain.

Working prediction, to be tested rather than believed: purchasing, on-hand, MOs/BOMs and lot genealogy
are used heavily; the costing engine barely at all. If so the project shrinks from "an ERP" to
"purchasing + on-hand + BOM".

Timing: the plant is mid-migration to Keychain. Let it land, measure a quarter, then decide.

**Status is `open` deliberately** — this is a decision waiting on counts, not a closed question.

---

## D-005 · 2026-08-24 · decided — Two tracks, and the rule about who touches shared code

V2 work runs in its own session and branch, alongside continuing maintenance.

- **Track A — maintenance.** Keeps the plant running: audit prep, bugs, small features. Ships to `main`,
  Railway deploys.
- **Track B — V2 foundation.** Its own branch and session.

> **New construction happens in Track B. Refactors of existing shared code happen in Track A, on `main`,
> in one pass.**

This is the rule that stops the tracks fighting, and it follows from D-001 and D-003. Most of the six
recommended moves are refactors of live code — "one signature service" touches 34 files. If Track B did
that on a long-lived branch while Track A kept shipping to `main`, the merge would never finish, and the
result would be the big-bang cutover D-003 rejects.

Track B's real work is what is genuinely **new**: the record interface, the vocabulary layer, the
document→program binding. New files, few collisions.

**Sessions are disposable; the repository is the thread.** A new session starts cold and reads
`CLAUDE.md` and `docs/v2/`. Anything decided in conversation and not written here is lost.

---

## D-006 · 2026-08-24 · decided — The first V2 project is a document project, not code

Before any of the six moves: walk the Food Safety Plan and the Food Defense Plan against the D-002 test
and produce the punch list of controls that do not resolve to a program, a form and a record.

Reasons this goes first:

- It is node 01 of the spine. Everything below inherits from it, so a wired plan makes moves 02 and 03
  concrete instead of theoretical.
- It needs no migration, no branch discipline and no deploy, so it cannot destabilise anything.
- It is what Daniela and Carol are already blocked on, and every improvement reaches staff immediately.
- It produces the artefact an auditor asks for directly: *show me your program for X.*

---

## D-007 · 2026-08-24 · decided — Team structure changes very little; two real findings stand

Question raised: does V2 require reorganising the team?

**Mostly no.** The architecture is deliberately designed so roles map onto what people already do. Two
things did come out of looking, and neither is a software change:

1. **Verification concentration.** Check whether production QA sign-off has more than one trained pair of
   eyes. If one person signs everything, the queue ages whenever they are out — or somebody signs who has
   not been doing it.
   *(An earlier figure quoted here came from a seeded development database, not the live roster, and has
   been withdrawn. Confirm against live before acting.)*
2. **One named owner per layer**, which is not a new org chart. Vocabulary/L1 → Document Control.
   Programs/L2 → Maintenance lead. Verification/L5 → QA. Presentation/L6 → the platform owner. The value
   is that "who decides what a room is called" has an answer, so it stops being decided accidentally by
   whoever last edited a dropdown.

One genuine role question worth deciding deliberately rather than inheriting: **QA performing a check and
QA verifying it are different jobs.** Today the same department does both for several record types. Fine
for some, not for others — and a good thing to settle while the plans are being rewritten anyway.

The standing single point of failure is that one person owns the software. No architecture fixes that;
the mitigations are the boring ones — the CI that exists, written-down decisions (this file and
`CLAUDE.md`), and eventually a second person who can deploy.

---

## D-008 · 2026-08-24 · decided — Promote move 06 (mirror columns) above move 05, and widen it

`architecture.md` ranks the six moves with "collapse the four schedule generators" at 05 and "audit every
mirror column" at 06, both deferred until after certification. **Move 06 comes first, and it is bigger than
the file describes.**

Three instances of the same defect surfaced in one week of maintenance, all found by measurement rather
than by reading code, and none of them a *column*:

1. **`batch-complete` filed no record.** Completing tasks in bulk closed the work order and never wrote
   the sanitation or QA inspection record. The fix for "completing a QA inspection must file its record"
   had been applied to `complete-and-recur` and never carried across. Restroom, breakroom, light
   inspection and temp/humidity checks ticked off in bulk left their logs empty.
2. **The backfill strip was on the wrong screen.** A missing *cleaning* record was reported on QA
   Inspections, which the cleaning team never opens, while the Sanitation log showed nothing.
3. **The 72-hour re-clean rule read the wrong table.** `lastCleanByArea` read `sanitation_records` only,
   while the production floor records room cleans as `cleaning_events` on the production entry — the
   deliberate "a clean is an EVENT, not a shift attribute" decision. So every production room read
   `no_clean_on_record` forever and the rule had **never fired**: eighteen rooms tracked, zero flagged,
   zero tasks ever generated.

**What this changes about the move.** "Audit every mirror column" is too narrow a name for the problem.
The unit is not a column, it is **a fact with more than one writer or more than one reader**:

- a fact written in two places (`sanitation_records` vs `production_entries.cleaning_events`);
- a fact read by a rule that knows only one of its sources (the 72-hour clock);
- a fact acted on by two code paths where only one was fixed (the two completion paths);
- a fact reported on a screen the people who own it never open (the backfill strip).

So the move becomes: **for every derived fact, enumerate its writers and its readers, and make the set
complete.** That is a survey, not a refactor, and it can begin immediately — it needs no migration and no
branch. Its output is a list, which is exactly what Track B can produce without touching live code.

**Why above 05.** The schedule-generator collapse is a large change to live scheduling that moves data.
This one finds defects that are already costing compliance records today, and each fix is small and local.
Value per unit of risk is not close.

**Method that worked, worth repeating.** Every one of the three was found by querying the
production-scale copy and comparing what a screen shows to what the tables hold — never by reading the
code and reasoning about it. Two of them looked like configuration problems (a missing module grant, a
paused schedule) until measured. **Measure before asserting a cause**; the first plausible explanation was
wrong in both cases.

## D-009 · 2026-08-24 · decided — A program may be a trigger, not a cadence

Raised by Track B while walking the preventive controls: D-002's test assumes every control resolves to a
**cadence** ("a program that generates dated work"). That is wrong for a whole class of them. Receiving,
sign-outs, film inspection and disposal are **event-driven** — they happen when a truck arrives, when
somebody takes a knife, when a pallet is rejected — and no schedule should be inventing dated work for
them.

So the D-002 test reads, corrected:

> Every preventive control named in the Food Safety Plan should resolve to a program — a **cadence** or a
> **trigger** — that produces dated work or a dated record, and a numbered form that catches it.

This also refines `architecture.md` L2, which currently says "cadence bound to a controlled procedure".
A program binds a controlled procedure to **an obligation-raising rule**, and a cadence is only one kind.
The 72-hour re-clean is the worked example of the other kind, and D-008 is what happens when a trigger's
inputs are incomplete: the obligation is simply never raised, silently, forever.

**Do not "fix" this by giving event-driven controls a fake cadence.** A monthly schedule for "receiving
inspection" would generate work nobody owes and mask the real question, which is whether every arrival
produced a record.

---

## D-010 · 2026-08-25 · decided — A repair without a cause fix is a repair that gets undone

Fourth instance of D-008's defect, reported from the floor rather than found by survey: Bernardo's
**Forklift Sit Down daily task listed far more work than the Equipment list shows under Daily.**

The fact — a machine's written maintenance tasks — is copied down a three-link chain:
`equipment.maintenance_tasks` → `pm_schedules.procedure_steps` → `work_orders.procedure_steps`. Three
code paths write the middle link. Two of them wrote **per cadence**. The third, `syncMaintenanceTasksToPM`
(which runs on any equipment save), **flattened every cadence into every schedule** — the whole list under
`Daily:` / `Weekly:` / `Annual:` headings, written identically to the daily, weekly and annual schedules.

Measured on the real forklift: Equipment list reads Daily 11 · Weekly 9 · Monthly 6 · Quarterly 5 ·
Annual 3. Creating schedules from those tasks produces exactly those counts. **One save of the equipment
record — changing nothing — takes every schedule to 39 lines.** So a daily check asked for the annual load
test, and the two screens disagreed with nothing on either saying which was right.

**The new lesson, and the reason this gets its own entry.** A repair for the *symptom* already existed:
`POST /pm/schedules/:id/split-steps`, built to pull a multi-cadence checklist apart, with a review strip on
the Equipment panel. It had been written, tested and shipped. The **cause was never found**, so every
repair was silently undone by the next equipment save. Worse, the repair reconstructs cadences from the
*headings* rather than from the machine's own task list, so run on this shape it left the daily schedule at
26 steps instead of 11 — a repair that reports success and leaves the record wrong.

So D-008's survey needs a second column beside "writers and readers": **for every derived fact that already
has a repair tool, ask what the repair is repairing and whether that thing still happens.** A repair tool is
evidence of an unfixed cause, not evidence that a problem is handled. Where both exist, the cause fix comes
first and the repair is re-checked against real data afterwards — ours had to be replaced, not re-run.

**Two rules from the fix that generalise.** A cadence with nothing written is **left alone, not blanked** —
blanking would erase a hand-typed procedure and, on a food-contact machine, remove the very steps the
completion gate requires to be ticked, turning a formatting bug into a task nobody can close. And **not all
disagreement is the bug**: on the 19 August copy, ten checklists across seven machines carry *more* steps
than are written (the flattening), while **120 carry fewer**, which is usually deliberate. A repair that
treated every difference the same would have put back work somebody removed on purpose. Distinguish the
directions and default to the one that is definitely wrong.

**Measurement note, added to D-008's method.** One reading in this investigation was a **false zero** — a
scratch database copied without its `-wal` lost every `maintenance_tasks` value, so the survey reported
"nothing out of step" on data that had plenty. It was caught only because it contradicted a measurement
taken minutes earlier. A false negative is the dangerous direction for this survey: it closes a question
that is still open. **Every "zero found" needs a positive control** — a case known to be broken that the
same query does find.

---

## D-011 · 2026-08-25 · open — Two programs claiming one activity

Reported alongside D-010 and deliberately **not** fixed in code, because it is a question about programs
rather than a defect: the plant's scales are checked daily **twice**. Once through **Scale Verification
(FORM 417-01 … 417-05)** — three certified weights, graded against tolerance, filing a controlled record —
and once through a generic **Daily PM** on each scale in the equipment register, which raises a work order,
names no controlled form and files no record. The operator sees both and does the work once.

This is a **different shape from D-008 and D-010**, and the distinction matters for the survey. Those are
one fact with several writers. This is **one obligation claimed by two programs** — a duplicate at the
level D-002 and D-009 are about, not at the data level. It is invisible to a mirror-column audit and would
be invisible to the writers-and-readers survey too, because neither program is wrong on its own terms.

The test that catches it, and which the Track B document walk should apply:

> For every recurring obligation, name the **one** program that owns it and the **one** numbered form that
> catches it. Where two programs raise work for the same activity, one of them is not a program — it is a
> duplicate, and the one to keep is the one that produces the controlled record.

Applied here: Scale Verification owns the daily accuracy check and produces the record an auditor asks for;
the generic Daily PM produces nothing and should be retired at that cadence. **Weekly, monthly, quarterly
and annual scale PMs are genuinely different work** — cleaning, cabling, load cell, the annual calibration
— and stay. The scales themselves stay in the equipment register, which calibration and the surviving PMs
both depend on. Nothing is deleted; the daily schedules are paused.

Left **open** because the same question almost certainly has other answers in this plant and nobody has
looked. Candidates to check by the same test: temperature and humidity (QA inspection vs any equipment PM
on the same room), light inspection, and anything with both a numbered form and an equipment-derived PM.
Note that the scale assets are also prominent in D-010's over-carrying list, which is how the two findings
surfaced in the same conversation — worth remembering that a duplicated program and a corrupted checklist
present to the operator as the same complaint: "there is more here than there should be."

*Partly resolved by D-012 — the scale case is settled; the survey stays open.*

---

## D-012 · 2026-08-25 · decided — Retiring a duplicate program is two acts, not one

**Done by the plant, not by this repository.** All Daily Scale PM schedules — Batching, Filling and
Kitting — are **paused**, on the grounds that the check already happens daily in Scale Verification. That
settles the scale case in D-011 and confirms its test in practice: where two programs raise work for one
activity, the one to keep is the one that produces the controlled record (FORM 417-01 … 417-05).

Deliberately not done, and the boundary is the point: the scales **stay in the equipment register**, which
calibration and the surviving PMs both depend on; the **weekly, monthly, quarterly and annual scale PMs
stay**, because cleaning, cabling, load cell and the annual calibration are genuinely different work from
the daily accuracy check; and nothing is deleted — a paused schedule keeps its history and can be resumed.

**The general lesson, which is what Track B should carry forward.** Pausing is only half of retiring a
program. `PUT /pm/schedules/:id` sets `is_active = 0` and **cascades nothing** — verified in the code: the
only cascade on that handler is `task_group`, added so a reassignment reaches tasks already raised.
Work orders the schedule generated before the pause stay `open` / `missed` indefinitely. Nobody will ever
complete them, because the work is now being recorded somewhere else. They go on dragging PM completion
down and go on appearing in the operator's Overdue bucket — **which is the exact symptom the pause was
meant to remove.** A retirement that leaves its own residue looks, from the floor, like the retirement
never happened.

So: **stopping a program from raising new work and closing what it already raised are two separate acts,
and only the first has a button.** The second is Cleanup Review — closed as `cancelled` with a reason,
audited, never deleted, because a deleted task is indistinguishable from one that never existed.

This belongs on the survey's checklist for every duplicate D-011 turns up, not just this one. Worth
considering as a small Track A change later: a paused schedule that still has open work orders should say
so where it is paused. Zero such leftovers existed on the 19 August copy, but that copy predates this
decision, so the count today is unmeasured — **treat that as an open question, not as a zero.** (D-010's
false-zero note applies: an unmeasured number and a measured zero must not be written down the same way.)
## D-008 · 2026-08-24 · decided — How the D-006 walk is conducted, and the four verdicts

D-006 said *do the walk*. This records **how**, so a cold session resumes it rather than re-deciding
it. The walk itself lives in `docs/v2/preventive-control-walk.md`; that file is a reading of the code
at a date and is updated in place. Decisions taken while walking come here.

**Three legs, and both refinements are load-bearing.** A control passes only with a *program* (a dated
obligation nobody has to remember), a *numbered form*, and a *record that accumulates in a log*.

1. **A program may be a trigger rather than a cadence.** Receiving, sign-outs, film inspection and
   disposal are event-driven and correctly so. What fails the leg is a control that depends on
   somebody deciding to start it — not one without a frequency.
2. **The work order is the universal fallback record, and it is not always enough.** Completing any
   task writes actor, time, readings and step ticks onto `work_orders`. For an equipment PM that is
   the record. It is not enough where the control answers to a numbered log, because a work order is
   not retrievable by form number, is on no module's log, and does not pass QA Review. "The task was
   completed" and "the record exists" are therefore kept as separate findings.

**Four verdicts, not three.** D-002 anticipated wired / running-unrecorded / described-not-done. The
Master Index's `where` field forced a fourth: **`elsewhere`** — resolved outside ReadyDoc by
decision. Seven forms are assigned to Keychain, including the batch production record, supplier
qualification and product release. That is a legitimate answer to the test and it still owes two
things, and both are now punch-list items rather than assumptions: *which of the seven are live in
Keychain today*, and *how a Keychain record is retrieved on a date an auditor picks* — because L6's
rule is that nothing is prepared for the audit.

**Consequence for the 4 August gap analysis.** Three of its findings move: supplier approval and
product release are `elsewhere`, not absent, and retention samples have been built since. That
document is left as written and corrected in §6 of the walk — the same rule this file follows.

---

## D-009 · 2026-08-24 · open — The two plans are not in the repository, and the walk is blocked on them

The app side of the D-006 walk is complete (`preventive-control-walk.md` §3). The plan side cannot
start: **neither the Food Safety Plan nor the Food Defense Plan exists in the repository** in any
form — searched `docs/`, `public/forms/`, `server/assets/`, every seeder and the whole tree. What is
on file is second-hand: PCQI and HACCP certificates, an AIB Food Defense Coordinator certificate, and
Form 403-01, whose 104 questions are a proxy for what the plant audits itself against but are not the
plan's control list.

Two things are needed, and the second is the one that shapes everything:

1. **The two documents**, in any legible form. `emp-site-list.js` and `audit-checklist.js` were both
   transcribed from supplied documents; a PDF is enough.
2. **Is the Food Safety Plan written as a 21 CFR 117 preventive-controls plan, or as a HACCP plan
   with CCPs?** Raised in the 4 August gap analysis and still unanswered. It decides the vocabulary of
   the whole walk — process / allergen / sanitation / supply-chain controls, or CCPs with critical
   limits — and `haccp_ccps` is currently modelled for the second. **Answer it from the plan itself.**
   The plant holds both PCQI and HACCP certificates, so inference from the certificates is not an
   answer.

Recorded as `open` rather than left in conversation, because this is the single input the first V2
project waits on.

---

## D-010 · 2026-08-24 · open — Is verification a fourth leg of the D-002 test?

Surfaced by the walk and deliberately not answered inside it. D-002's test names program, form and
record; the spine has seven nodes and **verification (L5) is not among the three**. Several controls
are wired end to end and never counter-signed; others pass through QA Review and are.

Whether verification becomes a fourth leg — and if so which controls genuinely need a second pair of
eyes — is a decision, not a reading. It is adjacent to the role question D-007 left open, that QA
performing a check and QA verifying it are different jobs, and the two are best settled together
while the plans are being rewritten anyway.
