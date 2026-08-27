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

*Status note: the test below stands. Its implied reading that a program means a cadence is
superseded by D-011, and its three-verdict list gained a fourth, `elsewhere`, in D-008.*

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
## D-013 · 2026-08-24 · decided — How the D-006 walk is conducted, and the four verdicts

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

## D-014 · 2026-08-24 · resolved 2026-08-24 — The two plans were not in the repository; both have since been supplied

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

**Resolved the same day.** Protocol 003 V4 and Protocol 001 V2 were supplied, and question 2 is
answered: the plan is a 21 CFR 117 preventive-controls plan by structure, though the plant's own
documents also use HACCP/CCP vocabulary. Kept rather than deleted, because the *shape* of the block —
the app side can be walked without the plans, the plan side cannot — is the reusable part.

---

## D-015 · 2026-08-24 · open — Is verification a fourth leg of the D-002 test?

Surfaced by the walk and deliberately not answered inside it. D-002's test names program, form and
record; the spine has seven nodes and **verification (L5) is not among the three**. Several controls
are wired end to end and never counter-signed; others pass through QA Review and are.

Whether verification becomes a fourth leg — and if so which controls genuinely need a second pair of
eyes — is a decision, not a reading. It is adjacent to the role question D-007 left open, that QA
performing a check and QA verifying it are different jobs, and the two are best settled together
while the plans are being rewritten anyway.

---

## D-016 · 2026-08-24 · decided — Track B rebases on `main` periodically, not at the end

D-005 keeps the two tracks from colliding by rule: new construction in Track B, refactors of shared
code in Track A on `main`. **Small collisions are not no collisions.** Track A keeps merging to `main`,
so the Track B branch drifts behind from the day it is cut, and a branch that only meets `main` at the
end is the big-bang merge D-003 and D-005 both exist to prevent — arriving as a merge conflict instead
of a cutover.

**So: rebase the Track B branch on `main` on a regular beat, and treat a rebase that is getting hard
as information.** Two consecutive painful rebases means Track B is touching shared code, which is
Track A's job by D-005 — the fix is to move that change to `main` and rebase again, not to push
through the conflict.

Current Track B branch: `claude/food-safety-preventive-controls-8y6mu2`. The beat is weekly, or
immediately after any Track A change to `shared/`, `server/db.js` or the form registry.

---

## D-017 · 2026-08-24 · decided — A form number is the PLANT's; `where` says which system produces the record

Corrects a misreading in the first pass of the preventive control walk, which treated the seven forms
marked `where: keychain` as *assigned to* Keychain — as though the migration had taken the paperwork
with it, and as though somebody still owed a decision about who owns those numbers.

**Not so, and the distinction is load-bearing.** Every number in the Forms Master Index existed before
Keychain and belongs to Powder Ops. **FORM 413-1 is the plant's own number for the MMR / Manufacturing
Record / Batch Production Record.** The plant is not borrowing Keychain's paperwork; Keychain is
currently generating the plant's form. `shared/form-registry.js` already says this in its own comment —
"`where` says what is true of the form *today*" — and the walk over-read it.

So the form leg of the D-002 test is satisfied by a number in the index, full stop. **Which system
produces the record is a separate fact, and it is allowed to change without the number changing.** That
is the same doctrine the codebase already applies to a SKU (`legacy_sku` is never cleared, because a
code that changes must still resolve on a two-year-old PO) and to a retired form number (retired, never
reissued, so a record filed under it still resolves).

**The two exits, and they are not exclusive.** Until either lands, Keychain generates any record for
work Keychain handles, and that is a legitimate answer to the record leg:

1. **Absorb** — build the function into ReadyDoc so it produces FORM 413-1 directly.
2. **Connect** — an API into Keychain so ReadyDoc can retrieve what Keychain generated.

**What is actually open is narrower than "where do the records live":** which of the seven are
producing records *today*. A form no longer on paper and not yet producing in Keychain is a control
with no record at all in the interval, and that is the only real exposure here. It is a list of seven
to check.

Relation to D-004, which holds the ERP question open pending counts: this is the same question scoped
to one form. FORM 413-1 can be answered ahead of the whole-ERP decision, and answering it is cheap
evidence for that larger one.

---

## D-018 · 2026-08-24 · decided — Work is QUEUED before it is pushed; `docs/v2/queued/` is where it waits

Stated directly while reviewing the walk's punch list: *no updates yet — let's have things like this
queued, so we can explore, improve, and have it in a great state before we push anything.*

That is a working rule, not a one-off, and it fits the two tracks rather than fighting them:

- **`docs/v2/queued/` holds a change that is designed and reviewed but deliberately not landed.** Each
  file states the scope, what is already built and where, what is *not* built and why, the exact diff
  for the parts that touch live code, and how to verify before landing.
- **The split follows D-005 exactly.** New construction is built on the Track B branch and can sit
  there safely. Anything touching live shared code is **written out, not half-applied**, and lands on
  `main` in one pass when the plant is ready.
- A queued item is not a backlog ticket. It is finished thinking with an unfinished deploy, and the
  test is whether somebody could land it in one sitting from the file alone.

First two entries: `atp-35-rlu.md` (punch-list item 2, with `server/atp-limits.js` already built and
tested on Track B) and `dcr-protocol-003.md` (item 4, for Document Control — no code at all).

---

## D-019 · 2026-08-24 · decided — PC #1: do the record and the limit now, the per-run trigger later

The walk found PC #1 failing two legs at once: no per-run **program**, and a **record** whose critical
limit nothing enforces. Both were on the punch list. They are now deliberately split.

**Now — the record and the limit.** `sanitation_records.atp_reading` gets graded against the 35 RLU
that Protocol 003 V4 states, and the limit it was graded against is stamped on the record. Contained,
reviewable, and it closes the finding an auditor can reach on their own: *a stated critical limit that
nothing enforces.*

**Later — the trigger.** Nothing in the platform fires at the beginning of a production run, because
there is no object for "a run" to hang an obligation off (D-009). That is architecture move 05, which
`architecture.md` defers until after the audit, and this entry does not move it up. The clean stays on
its daily cadence in the meantime.

**Why the split is honest rather than convenient.** The record leg is what an auditor asks for — *show
me the reading, and show me the limit the system used*. The trigger leg changes when the obligation
appears, which is a scheduling improvement, not evidence. Shipping the second without the first would
produce a task nobody could fail; shipping the first without the second produces a graded record on a
slightly loose cadence, which is the better half to have.

Recorded because a future session finding a graded ATP reading on a daily schedule should read it as a
deliberate half-step, not an oversight.

---

## D-020 · 2026-08-24 · decided — PC #1's 35 RLU is the pilot for architecture move 03

Move 03 — *limits out of code and into documents* — was written as a project without a first case.
It has one now, and it is unusually clean: **the limit was never in code to begin with.** It lives in
Protocol 003 V4 and nowhere else, so the pilot is not a migration, it is a first connection.

Everything it needs already exists: `gradeReadings()` in `scale-forms.js` as the working precedent,
`controlled.js` as the gate that parks an unapproved change to an acceptance criterion, and the
written doctrine that a reading outside tolerance can never be filed as a pass.

**One rule this pilot adds that the scale case did not need.** A scale verification is *wholly*
defined by its readings, so the grade decides the result outright. A clean is not — it can fail visual
inspection while its swab reads 12 RLU. So the ATP grade is **asymmetric: it can fail a record, never
pass one.** An over-limit reading forces `fail`; an in-limit reading leaves the filer's own answer
alone. Any future limit attached to a record that has independent reasons to fail should follow the
same rule, and any limit attached to a record fully defined by its readings should follow the scale's.

`architecture.md` Revision 2 names this pilot under move 03. The build is queued in
`docs/v2/landed/atp-35-rlu.md`.

---

## D-021 · 2026-08-24 · decided — The seven Keychain forms are on PAPER today; `where` conflates present state with intent

Confirmed by the plant, 24 Aug 2026: **none of the seven forms marked `where: keychain` is producing
anything in Keychain.** Production runs the old manual paper process, logged in MRPEasy. So the
records for all four preventive controls — the batch production record, the cleaning log checklist
that rides on it, and the X-ray operation record — are **on paper**.

**This is the good version of the answer, and it closes an exposure rather than opening one.** Punch
list item 1 was raised to catch a form that had left paper before its replacement was ready — a
control with no record at all in the interval. That did not happen. Nothing left paper early, which
is how a migration is supposed to be run.

**What it does expose is a vocabulary fault, and it is one this project exists to find.**
`form-registry.js` defines `keychain` as *"moving to Keychain; not in ReadyDoc and not expected to
be"* — so a single field carries two different facts at once: **where the record is produced today**
and **where it is intended to go**. For these seven those answers differ, and the one an auditor asks
for is the first. It read to a careful reader (this session, twice) as "Keychain is handling it".

The fix is Track A and small — either a second field, or `where: paper` with the intent in `note`.
Recorded rather than done, because it changes a shared file the walk is not otherwise touching, and
because Document Control should decide how the register says it.

**One consequence worth naming, because it strengthens the queued ATP work rather than weakening it.**
PC #1 now demonstrably has **two** records and neither carries its critical limit: the paper cleaning
log checklist attached to the BPR, and ReadyDoc's own `sanitation_records` row with an ATP field that
is empty and ungraded. One control, two homes, and the number it turns on in neither. That is the
recurring defect of this codebase stated at its sharpest, on a preventive control.

---

## D-022 · 2026-08-24 · decided — Preventive controls are TRANSCRIBED from the document, not typed into the app

Reverses advice given earlier in this project, which was that QA could enter the four preventive
controls into `haccp_ccps` by hand. **That was wrong by the plant's own doctrine and would have
undone a rule the codebase already enforces everywhere else.**

`scale-forms.js` tolerances are deliberately not editable in Settings because the number *is* the
compliance decision. The scale forms' revision is disabled in the form register for the same reason.
PC #4's critical limit is `NFe 2mm Fe 2mm Stainless Steel 4mm Ceramic 2mm Glass 2mm` — five figures
and five materials, which is five chances to mistype a critical limit into a text box with nothing
checking it, and no way afterwards to tell a typo from a decision.

So the four controls are transcribed from Protocol 003 V4 in `server/preventive-controls.js`, verbatim
and irregularities included, exactly as `audit-checklist.js` holds Form 403-01 and `emp-site-list.js`
holds Form 604-01. Insert-only, keyed on the CCP name, so a row somebody edits by hand is never undone
by a redeploy.

**Two halves, split by D-005.** The transcription and the seeder are new construction and live on the
Track B branch. The two things that make the limits actually safe — the `server.js` call and an edit
guard in `api/haccp.js` refusing document-owned fields — touch live code and are queued for `main`
(`docs/v2/queued/preventive-controls-seed.md`).

**In the meantime `ccpDrift()` makes a divergence visible rather than preventing it**, which is the
honest half that can be built without touching Track A. A stored row that no longer matches the
document is reported field by field, naming both values.

**The transcription is a faithful draft until Document Control confirms the wording.** Three lines
carry a `sourceNote` flagging where the PDF's text layer split a table cell — PC #4's monitoring line
renders as *"Product passes through r- ray"* in the extraction, which is *x-ray* broken across a cell
boundary. Lowry, Daniela and Carol are checking all four against the PDF. A correction goes in
`preventive-controls.js`, never in the database.

---

## D-023 · 2026-08-25 · decided — Decision numbers are allocated on `main`; Track B renumbers on rebase

The collision D-016 predicted happened on the first rebase, and faster than weekly. Track A and Track B
both appended to this file and **both started at D-008**, so nine numbers described two different
decisions each. One pair was the same decision found twice: Track A's **D-009** (a program may be a
trigger, not a cadence) and Track B's entry of the same name, raised by the plan walk.

**The rule, so this is mechanical next time.** `main` is where decision numbers are allocated. A Track B
entry is provisional until it rebases, and **renumbering on rebase is expected work, not damage**. Three
things travel with the renumber:

1. **A duplicate is dropped, not merged.** Track B's trigger entry was removed in favour of Track A's
   D-009, which already credits the walk. Two numbers for one decision is the defect this repository is
   about, and a decisions file is the last place it should appear.
2. **Cross-references are remapped in the same commit** — the walk, `architecture.md`, the queued
   documents and `CLAUDE.md`. A decision file whose numbers are right and whose citations point at the
   wrong entries is worse than one that is simply behind.
3. **Renumbering only applies to entries that never reached `main`.** Once an entry is on the trunk its
   number is permanent and the append-only rule takes over — a wrong one gets a superseding entry, never
   a rewrite.

**And a note on how it was resolved, because the temptation was real.** The rebase conflicted on this
file and the fast fix was to take one side. Both sides were kept instead: Track A's findings about
duplicate programs and PM checklists are not less true for having been written the same week, and the
walk's entries are not less true for arriving second.

---

## D-024 · 2026-08-25 · decided — Hub and spoke: values propagate, obligations are raised, TEXT IS NEVER AUTO-WRITTEN

Asked directly: with the Food Safety documents as the "bible", will editing them automatically update
the SOPs, WIs and JDs beneath them? **Yes to the hub, and the spokes carry obligations, not edits.**
Three tiers, and only two of them are automatic.

**Tier 1 — values propagate automatically, and already do.** A limit, a frequency, a tolerance, a form
number is read from the document *at the moment it is used*. `scale-forms.js` and now `atp-limits.js`
are the working examples: change the approved revision and every grading decision follows, because
there is no second copy. This is L1's rule and architecture move 03.

**Tier 2 — obligations are raised automatically.** Re-issue a document and everything referencing it
gets a task: *the parent changed — does this still say the right thing?* One spoke already works —
`retrain_on_doc_change` supersedes completed training records for courses linked to a revised document.
`docs/v2/queued/document-reference-graph.md` generalises it from training to every document.

**Tier 3 — the text of another controlled document is NEVER written by the system.** This is the rule
that keeps the other two safe, and it is not a limitation to be engineered away later:

- **An auto-generated SOP has no author and no approver**, which is what "controlled" means. Its change
  record would say the change was made by nobody.
- **It would fire retraining on text nobody wrote** — staff retrained against a machine's paraphrase.
- **There is usually nothing to propagate.** PC #1's monitoring reads "Procedure as outline in cleaning
  SOP": the plan *points at* the SOP rather than containing it, so generating the SOP from the plan
  would be inventing content the plan never held.

So the spoke delivers **a task with a name on it**. Document Control still decides whether a child
document changes and how — they simply never have to *discover* that it might need to.

---

## D-025 · 2026-08-25 · decided — Both plans are red-lined as one reviewable list, not edited in place

`docs/v2/queued/plan-redline.md` — 68 findings across Protocol 003 V4 and Protocol 001 V2: 19 must-fix,
39 should-fix, 10 consider. **Nothing was changed in either document**, and that is the point: a plan
quietly improved by software is a plan nobody approved. Each finding is numbered so it can be accepted,
rejected or deferred on its own, and the path is review → decide → DCR → Document Control publishes
V5 and V3 → the team adopts.

**Three rules the review follows, worth keeping for the next one.**

1. **Cite only what is on file.** The NSF/ANSI 455 Certification Policies, the NSF 306 guideline and
   the GMP for Sport Audit Guide are in `server/assets/reference/` and are cited by section. **NSF/ANSI
   455-2 itself and the SQF code are not**, so findings resting on them are argued from substance and
   marked unverified — the same rule `docs/SQF-NSF-gap-analysis.md` set.
2. **Separate an extraction artefact from a document error.** Both plans were read from a PDF text
   layer that splits table cells. Anything that might be an artefact is marked *[verify in source]*
   rather than asserted — a red-line that cries wolf about the PDF is one nobody finishes reading.
3. **A wording finding and a standards finding are different things**, kept in separate sections. The
   fourteen grammar corrections in Protocol 003 are individually trivial; together they are what an
   auditor reads as a document that was not proof-read, in a plan whose authority is that it was
   written carefully.

**The four findings grounded in a normative reference, because they are the ones that will surprise
people.** The Policies document lists 455-2's normative references as 21 CFR 111, 117, **11**,
**Part 1 Subpart L** and **Part 1 Subpart O**. Neither plan mentions FSVP (Subpart L), sanitary
transportation (Subpart O), electronic records (Part 11), or the banned-substance lists that NSF GMP
for Sport §6.2.2 wants embedded in operating procedures.

---

## D-026 · 2026-08-26 · decided — The fan-out obligation is a REVIEW TASK; the DCR is what a "yes" produces

Settled from the two candidates in `document-reference-graph.md`. When a parent document is re-issued,
each document that cites it receives a **doc-review task**, not a Document Change Request.

**Why the lighter object is the correct one.** The question the fan-out asks is *"the parent changed —
does this still say the right thing?"*, and the usual honest answer is *"yes, no change needed"*. A DCR
raised per citation would open a formal change request against documents that turn out not to change,
and a register full of DCRs closed with "no change required" teaches an auditor the wrong thing about
how this plant manages change — it makes a real change request harder to find, not easier.

**The DCR is the outcome, not the trigger.** A review task whose answer is *yes, this needs to change*
raises one. That keeps the DCR register meaning what it has always meant: a change somebody actually
intends to make.

It also fits an existing shape rather than inventing one. `doc-review.js` is already a registry of
sources, and a source declares an `action` only when it genuinely has one — documents past their review
date do, a parked controlled change does not. "Affected by a revised parent" has a real action (mark
reviewed, no change needed), so it is batchable and belongs there as a fifth source.

---

## D-027 · 2026-08-26 · decided — The plans name no other document, so the hub-and-spoke build waits on a plan revision

The coverage check for `document-reference-graph.md` was run on 26 Aug 2026 and produced a result that
reorders the work.

**Two measurements. The second is the finding.**

1. **The seeded registry holds 6 documents**, 3 of them reviewable (reference documents are excluded by
   design). The mechanism runs; the sample is meaningless. The real coverage figure needs the
   production database, where Document Control's ~100 imported documents live.
2. **Neither plan cites a single other controlled document by number.** The extractor was run over the
   full text of both — 27,059 characters of Protocol 003 and 15,607 of Protocol 001 — and found only
   each document's own number in its own footer, which the extractor correctly skips as a
   self-reference. The one reference of any kind is the phrase **"cleaning SOP"** in PC #1's monitoring
   column, in words. Protocol 001 names no other document at all.

**So the graph would be built and find nothing.** Not a weak parser — the hub does not name its spokes.

**The consequence is an ordering rule, and it generalises.** *Build the mechanism after the data it
reads exists, not before.* A fan-out over an empty graph is a working mechanism producing no
obligations, which from the outside is indistinguishable from a broken one — precisely the failure that
let QA inspections go unrecorded for three months against a list nobody was watching. So:

> **Land the plan revision that adds Scope and Normative References sections first. Then build the
> graph.**

Red-line finding **X-04** is promoted from *consider* to **must** on this basis, and the eleven
documents each plan already describes but does not name are listed in `document-reference-graph.md` —
so the section is a transcription job for Document Control, not a research one.

---

## D-028 · 2026-08-27 · decided — The audit confirms the failure mode, and sorts the work into three buckets

Two NSF audits in one visit, 24–26 Aug 2026: **zero critical, zero major, twelve minor** — 3 on GMP for
Sport, 9 on NSF/ANSI 455-2. Triaged in `docs/v2/queued/audit-nc-triage.md`.

**The finding that decides how to respond: eleven of the twelve are phrased as a document or a record
that does not exist or was not available** — *"are not established"* ×4, *"was not available"* ×3,
*"were not conducted"*, *"not prepared"*, *"not provided at the time of the audit"*, *"evidence … was
not available"*. Only 4.2.9 (street shoes in GMP areas) describes something the plant *does* that it
should not.

That is the same defect the preventive control walk found from the other direction, now stated by an
auditor: **work that happens and does not accumulate a record.** So the response is not "software
versus people" but three buckets — **A** ReadyDoc is the fix (5), **B** ReadyDoc makes it stick (4),
**C** outside ReadyDoc (3). Most sit in B, which is the honest place: software does not swab a surface
or wear a shoe cover, but *"not adhered to"* and *"not available at the time of the audit"* are exactly
what a system prevents.

**Two red-line findings were promoted on the audit's evidence, and neither was withdrawn.**

- **FSP-28** raised the three banned-substance sections from the GMP for Sport Audit Guide already on
  file, *before the reports arrived*. The auditor raised exactly those three. → MUST.
- **FSP-27** flagged 21 CFR Part 11 as a normative reference for 455-2. **Finding 4.4.39 names ReadyDoc
  directly**, and the wording is generous: the compliance features are there, the validation
  documentation is not. → MUST, and it is the highest-value technology deliverable on the list, because
  every record the platform holds rests on it.

**Two interlocks worth carrying forward.** Software change control is required by 4.4.39 *and* 4.3.9 —
build it once. And 4.3.6 (a test with no established specification) is the same defect class as the
ungraded ATP reading: grade against an approved value, refuse to record a pass without one.

---

## D-029 · 2026-08-27 · decided — The registry is reviewed by RULE; the slow red-line is reserved for control-bearing documents

Asked whether the plan red-line should now be repeated for every SOP and WI. **Yes, but not the same
way**, and the arithmetic is the argument: two documents produced 68 findings, so ~100 documents
produce something near 3,400 — which is not a review anybody finishes, and which would bury the twenty
findings that matter under three thousand that do not.

**Sort the 68 by what kind of thing should have noticed them and the method falls out.** Roughly fifty
are **mechanical** (spelling, grammar, a page numbered beyond the page count, two sections lettered D)
or **structural** (an approved document with a blank signature block, a registry revision disagreeing
with the document's own footer, a retention period never specified, a document citing nothing by
number). Both classes are findable by rule, and **a rule costs the same over 100 documents as over 2**.
Only the remaining third — the Rework row describing a metal detector the plant does not have, the ATP
limit stated in a unit only its verification produces — needs a person who knows the plant.

**So:** extend `doc-consistency.js`, which is already this instrument for four rules, and make its
output a queue with dismissals rather than a document — the same shape as the form-registry coverage
report. Then reserve the full red-line for documents that **state a limit, define a control, or have
been touched by a nonconformance**.

**And the audit named the first four.** SOP 404 (supplier qualification), SOP 421 (IQ/OQ/PQ), SOP 434
(change approval) and SOP 604 (environmental monitoring) are each cited in a nonconformance with their
revision and effective date — every one an SOP whose requirements outran the plant's ability to meet
them. That is a better second project than "all the SOPs": it is **the D-002 test applied one SOP at a
time**, and it is tied to corrective actions already due.

---

## D-030 · 2026-08-27 · resolved 2026-08-27 — The SQF Food Safety Code was in the Reference Library, which this session could not read

*Resolved the same day: the file was attached and the pass is done — see D-031. The working lesson
below is the part worth keeping.*

The SQF code Edition 9 was added to ReadyDoc's Reference Library so the plan red-line could be checked
against it. **The Reference Library is the production database.** This repository holds only what
`reference-seed.js` bundles — the NSF/ANSI 455 Certification Policies, the NSF 306 guideline and the
GMP for Sport Audit Guide — and a Track B session has no route to the live data.

**So the SQF pass has not been done, and the red-line says so** rather than implying a coverage it does
not have. This is the same honesty rule `docs/SQF-NSF-gap-analysis.md` set when the standards were
first unavailable.

**The general lesson, which will recur:** *adding a document to the app does not make it available to
this work.* Anything a Track B session must read has to be in the repository or attached to the
conversation. Worth remembering before the next "I've put it in ReadyDoc" — attaching the file makes it
a mechanical second pass; leaving it in the Library makes it invisible.

---

## D-031 · 2026-08-27 · decided — The SQF pass adds 22 findings, corrects one, and answers the vocabulary question

The **SQF Food Safety Code: Food Manufacturing, Edition 9** was supplied, closing D-030. Part 5 of
`plan-redline.md` holds **22 new findings cited by clause**; the red-line stands at **90 findings, 36
must / 47 should / 7 consider**. Additive throughout — nothing in Parts 1–4 was withdrawn or reworded.

**Three results worth recording beyond the findings themselves.**

**1. The vocabulary question is answered, and not the way it was framed.** Clause **2.4.3.17**: where
regulation prescribes a methodology other than Codex, the plan *"shall … meet **both** Codex and food
regulatory requirements."* SQF requires Codex HACCP (2.4.3.1, twelve steps); FDA prescribes 21 CFR 117
preventive controls. **So Protocol 003 carrying preventive-control structure and CCP language may be
exactly right rather than sloppy.** FSP-34's ask survives — be deliberate, say so under Scope — but the
resolution is a sentence, not a purge. Supersedes the assumption behind D-014's framing that one
vocabulary had to win.

**2. One earlier finding was wrong and is corrected in place by a new one.** FDP-24 recorded the Food
Defense Plan's annual review as *stricter than required*, true against Part 121's three-year reanalysis.
**Clause 2.7.1.4 requires the plan to be reviewed AND TESTED at least annually**, and Protocol 001
commits to a mock incident every **two** years — half the required frequency. SQF-20 states the
correction rather than editing FDP-24, so the reasoning behind the original stays visible.

**3. The plant's two plans each do something the other does not.** The Food Defense Plan has a
documented risk matrix; the Food Safety Plan has no methodology for determining hazard significance
(2.4.3.8). The Food Defense Plan has a product/process description; the Food Safety Plan has none
(2.4.3.4). **Neither plan needs a new capability — each needs what the other already demonstrates.**

**And a scoping caveat raised rather than assumed:** this is the *Food Manufacturing* Code and its own
cover refers dietary supplements to a related manufacturing code. Every clause cited is a general
System Elements clause, but **which code Powder Ops is certified against should be confirmed with the
certification body** before the plan cites clause numbers in print.

The largest single gap: **food fraud (2.7.2) is its own Mandatory clause** with its own plan, training
and annual review-with-corrective-actions. Protocol 001 carries the substance — eleven ingredients
assessed for substitution and dilution — inside the food defense plan, without the structure the Code
requires.

---

## D-032 · 2026-08-27 · decided — One obligations register, and a check that stops a finding being lost

Asked directly: *are all these gaps, critical limits and fixes wired in, so that when we push V2 it will
all be included?* **The honest answer was no**, and it is worth recording why, because the shape of the
problem was familiar.

**Recorded is not wired.** 115 findings sat across four documents — the plan red-line, the audit
triage, the walk's punch list and five queued builds — plus 31 decisions. Every one was written into
the repository, which is the thread and does survive a session. **Nothing reconciled them.** No list
said "this is what must be true before V2", nothing could report how much was done, and nothing would
notice a finding added to a document and never acted on.

**Worse, the same obligation was named in several places under different names.** The ATP limit is a
walk punch-list item, a red-line finding, an SQF clause and a queued build. Environmental monitoring is
a walk item, a nonconformance and an SQF clause. **That is a fact existing in more than one place —
the exact defect this whole architecture is a response to — and it had started happening in our own
prep work.** Six months on, somebody would have closed one and believed they had closed all four.

**So: `docs/v2/obligations.json` gives each obligation exactly one owner** and lists under `sources`
every finding that points at it. 115 findings collapse to **26 obligations**, which is the number that
actually matters and is small enough to work.

**And `scripts/check-obligations.mjs` is what stops it drifting**, wired into `npm run check` and CI:

- a finding declared in a document and claimed by no obligation **fails the build**;
- a register entry citing a finding no document declares **fails the build**;
- a finding claimed by two obligations **fails the build** — each gets one owner, or the register
  reproduces the defect it exists to prevent.

Verified by adding a deliberately unclaimed finding and watching CI reject it. The first run found
three genuine duplicate claims, which is the check earning its keep on day one.

**Grouping stays hand-maintained on purpose.** Deciding that four findings are one obligation is
judgement, not parsing. Only the *reconciliation* is mechanical — the same split as the form registry,
where the matching rules are code and the facts are Document Control's.

**The status line is deliberately blunt.** With nothing landed, the check prints *"Nothing is landed.
Every obligation is still ahead of you."* A register that reads like progress when nothing has shipped
is worse than no register.

Current state: **1 queued · 1 built · 5 drafted · 19 open · 0 landed.**

---

## D-033 · 2026-08-27 · decided — The Dietary Supplement code is the one that applies; the Part 5 citations survive it

The scoping caveat raised in D-031 was right, and it resolved well. The **SQF Food Safety Code: Dietary
Supplement Manufacturing, Edition 9** was supplied — that is the code this facility is certified
against, and the *Food Manufacturing* code Part 5 was first read against is a different book whose own
cover refers supplements elsewhere.

**Both are now in the reference registry**, `REF-SQF-DSC-9` alongside `REF-SQF-FSC-9`, because the
audit reports cite NSF/ANSI 455-2, the plant's documents cite SQF, and a reader comparing a clause
needs to see which book it came from. The Food Manufacturing entry's description was corrected — it
claimed to cover *"Food Manufacturing including Dietary Supplements"*, which is what made reading the
wrong one easy.

**Every clause cited in Part 5 was re-verified.** Of 26 clauses: **24 word-for-word or differing only
in punctuation**, and the System Elements numbering is identical between the codes (2.1.1 … 2.9.2) —
**so all 22 original findings hold at the same clause numbers.**

**That identical numbering is the trap worth recording.** Two books, one numbering scheme, and a
citation from the wrong one is indistinguishable from a citation from the right one until somebody
looks it up. It is the same defect the codebase keeps finding — one identifier meaning two things —
and the reason both codes are kept rather than the wrong one being deleted.

**Two clauses differ substantively, and both add obligations rather than removing them:**

- **SQF-23 · 2.2.3.3** — the supplements code adds a sentence the other does not have: *"Software
  programs and electronic data and records shall be backed-up on hard drives or cloud remote from the
  site's system."* **A new obligation that lands on ReadyDoc**, folded into the Part 11 validation
  package (OBL-04) rather than made a separate project. The control plausibly exists; nothing states it.
- **SQF-24 · 2.2.3.3** — the supplements code **drops the "or established by the site if no shelf-life
  exists" fallback**. Retention is anchored to shelf life with no alternative basis, and NSF finding
  4.6.21 records that the shelf life is not supported by data. The retention period rests on a number
  under a nonconformance, and the code offers nothing else to rest it on (OBL-14).

**One refinement worth having:** the supplements code's 2.4.3.17 reads *"food safety **and/or dietary
supplement** regulations"*, which brings 21 CFR 111 explicitly inside the both-Codex-and-regulatory
rule of SQF-13. The conclusion is unchanged and now rests on wording written for this industry.

**And one difference that changes nothing, recorded so nobody re-derives it:** 2.5.1.1 opens *"shall
validate"* in one code and *"shall ensure"* in the other. SQF-06 does not depend on it — the
requirement it rests on is 2.4.3.11, identical in both.

Red-line now 92 findings, 37 must / 48 should / 7 consider. OBL-25's SQF half is answered.

---

## D-034 · 2026-08-27 · decided — Cleaning ships in two waves, and the first one does not wait for the plan revision

Asked when updates to cleaning start. The dependency was checked rather than assumed, and it splits.

**Wave 1 — the record and its limit. Nothing blocks it.** `OBL-01` is queued and verified end to end
against a fresh database. Three things that look like blockers are not:

- **The DCR does not block it.** FSP-04 may move the ATP swab from the verification leg to monitoring.
  That changes the plan's wording, not the grading — the code compares a reading to the approved value
  either way.
- **SQF-06 does not block it.** The critical limit must be validated, and that is a QA activity running
  in parallel. Grading against the value the approved document states today is correct today.
- **The plan revision does not block it.** X-04 and SQF-01 add the Scope section, which the *reference
  graph* waits on (D-027). The cleaning record does not.

**Wave 2 — the rest of the cleaning spine — does wait.** The per-run trigger is deferred by D-019, and
the SOP number the plan must cite does not exist in citable form until Protocol 003 is re-issued.

**But cleaning is not the most urgent thing on the branch, and saying so is the point of checking.**
The audit corrective actions are, and the honest recommendation is to land Wave 1 **in the same pass**
as the receiving-checklist line that closes §6.2.3.2 — both are small, both are queued, and one of them
answers a nonconformance. Landing cleaning alone first would be following the plan rather than the
plant.

---

## D-035 · 2026-08-27 · decided — The V2 explainer leads with what does NOT change

`docs/v2/v2-vs-today.artifact.html` is the picture for the team. Three figures: today's three writers
and three stores for one fact, the spine with every screen as a lens on it, and the same 60 RLU reading
before and after.

**It opens by saying this is not a rebuild** — same app, same screens, same login, nobody learns a new
system — because that is the first thing anybody on the floor wants to know and the thing most likely
to be misheard. D-001 is the decision; this is how it gets communicated.

**The figures show mechanism, not labels.** The "today" diagram is not an architecture drawing; it is
one real question — *was the line clean before the run?* — traced through three doors into three
tables, with the seam marked where the same fact lands twice ungraded. A reader can point at the
problem. That is the test a diagram has to pass to be worth drawing.

**And it ends with a per-person table**, because "what changes" is a different question for an operator
than for Document Control. The honest answer for most of them is *almost nothing*, and for Document
Control it is *the biggest change of anyone's* — re-issuing a document starts moving things by itself.

## D-036 · 2026-08-27 · decided — Wave 1 landed on `main`, and `queued/` gets a counterpart

**Decision.** The ATP grading work shipped to `main` as `6f54afc`. Its design file moved from
`docs/v2/queued/` to a new `docs/v2/landed/`, and `landed` became a status the obligations register
actually uses.

**Why the directory move rather than a status line in the file.** D-018 defines `docs/v2/queued/` as
work designed and deliberately NOT landed — that is the whole meaning of the directory, and it is what
tells a reader that everything in it is still ahead of them. Leaving a shipped item there, marked
"landed" in its header, would make the directory mean two things and put the burden on whoever reads it
to check each file. That is the recurring defect this project exists to remove, appearing in our own
documentation for the second time (the first was the obligations register itself, D-032). A file moves
when its state changes.

**What actually landed, and what deliberately did not.** The grading, the asymmetry, the stored limit,
the two-failed-swabs escalation, the live operator hint, and a fix to `closeRecleanTasksFor` that was
not in the design at all. What did not land is **the number's validation** — SQF 2.4.3.11 and
2.5.1.1(ii) require evidence that 35 RLU is right for these surfaces and this instrument, re-validated
annually, and no software can produce that. It was split out of OBL-01 as **OBL-27**, owned by QA,
because an obligation half-discharged and marked done is worse than one still open. Naming the ATP test
method in the plan (SQF-09) moved to OBL-15, where Protocol 003 is reissued.

**The escalation rule is the plant's, not the standard's.** One failed swab asks for a re-clean and a
second swab; two consecutive failures raise the work order. The reasoning is about what a single
reading can mean — an ATP swab has real false positives, so one failure could be the swab rather than
the line, and a task raised on every stray reading is one people learn to dismiss. Two in a row is the
line. Recorded here because it is a judgement about how much evidence justifies interrupting somebody's
day, and the next person to touch `atpEscalation()` should know it was decided rather than assumed.

**Track B rebased on the new `main` the same hour** (D-016). The rebase dropped the Track B WIP commit
as already upstream, which is the correct outcome: Wave 1 is `main`'s now, not Track B's.

## D-037 · 2026-08-27 · decided — Wave 2 is the D-002 test, because the wording review is blocked

**The situation.** The method (`document-review-at-scale.md`) named the four SOPs the auditor read and
found wanting — 404, 421, 434, 604 — as the second review project after the two plans. **None of the four
is in the repository**, and D-030 already says why that matters: the Reference Library is the production
database, and adding a document to the app does not make it available to this work.

**Decision: run the review anyway, on the half that is answerable, and say plainly which half that is.**
`docs/v2/queued/wave-2-sop-review.md` is the D-002 test applied one SOP at a time — *does this SOP require
something that has no program, no form and no record behind it?* — resting on two sources we do have: the
auditor's own words about each document, and ReadyDoc's tables. It produced **19 findings**, and it is
explicit at the top that nobody has read the four documents here and that this is not a wording red-line.

**The blocked half turned out not to be the valuable half, which is worth recording.** The auditor read all
four and found the same thing in each: the document requires something the plant cannot produce. That is a
gap between a document and a record, which is what this project is for. A grammar pass would have found
none of the nineteen.

**Four findings came from the change log, not from any SOP** — and they are the most immediately
actionable in the review. **SOP 421 and SOP 434 have no row at all in the 159-row DCR log** (W2-01), and
**SOP 404 is V4 with a widened title in practice and V3 under the old title in the log** (W2-02). The
structural cause is W2-04: the DCR log imports into the QMS register while documents live in
`sop_documents`, and **nothing reconciles the two in either direction**. The recurring defect of this
codebase, at the level of the document register itself.

**The 19 findings are registered.** `wave-2-sop-review.md` was added as a fourth source to
`scripts/check-obligations.mjs`, which promptly failed with all 19 unclaimed — the check doing its job.
They now sit under six existing obligations (OBL-05, 07, 08, 13, 18, 26), two of which had no sources at
all until now. **No new obligation was invented**: every Wave 2 finding sharpened an obligation the audit
triage had already created, which is the register working rather than a gap in it.

**Build order, decided by the same test.** SOP 604 first — it is the only one of the four where the program
and the form are already right and the single missing leg is the record, and Wave 1 proved that exact
pattern three days ago on the ATP limit. Then SOP 421 (three derived steps on `equipment-readiness.js`).
SOP 404 is a module, not a field, and SOP 434's software half is the same build as § 4.4.39's software
change control — neither should start before its document is in hand.

**One correction made in passing:** the audit triage said eight quality schedules are seeded from
FORM 604-01. **Six are**; the other three predate the transcription and cite neither the form nor its
limits — which is itself finding W2-18, so the error and the defect were the same fact.

## D-038 · 2026-08-27 · decided — the four SOPs arrived, and the wording review confirmed the D-002 test rather than replacing it

**What happened.** All four Wave 2 SOPs were supplied as .docx the same day D-037 recorded that they were
missing. The wording review that D-037 called blocked is now done: **W2-20 to W2-46, 27 further findings,
46 in total.** `wave-2-sop-review.md` was updated in place rather than forked, so there is one document per
project — the same rule as one owner per fact.

**The finding that matters most is about method, not about any one SOP.** Every D-002 finding held. What
the documents added was worse than the tables suggested, in one repeated way: **where ReadyDoc has no
record, the SOP usually has no form number either.** SOP 421 lists eight kinds of record and numbers none.
SOP 434 requires a form that has no number and shares its name with the SOP. SOP 604 requires two forms,
one of which is never even named. SOP 404 cites a FORM 404-3 that has never been issued.

So the software did not fall behind the documents — **both are thin in the same places**, which is a
stronger argument for the spine than either half alone. A wording red-line run first, without the D-002
test, would have read these as clerical omissions rather than as the same defect twice.

**Three findings an auditor would reach in ten minutes, none of them about software.** **None of the four
documents is signed** — both approval blocks empty, four for four. **Every one disagrees with its own
revision history about its current revision date**, SOP 434 by ten months. And **the SOP 404 file contains
two complete revisions**, V3 and V4 one after the other, with nothing saying which is in force. These are
now the two highest-yield rules for the mechanical sweep (OBL-26), evidenced rather than argued.

**Two findings change what gets built and in what order.**
- **W2-31.** SOP 421's own scope is "all **new and significantly modified** facilities and equipment", so
  read strictly it does not require what the auditor found missing on machines already in service. That is
  not a defence — 21 CFR 111.30 does not care what the scope says — but it decides how the CAPA is written,
  and no IQ/OQ/PQ checklist should be derived across 183 machines until somebody has settled it.
- **W2-40.** SOP 604 states a **monthly** cadence for zones 2–4 while deferring frequency to FORM 604-01,
  which says semi-annual, annual and quarterly. The six seeded EMP schedules follow the form. **If the SOP
  is right, every zone schedule is at the wrong frequency**, and building a result record on top of them
  would file correct records against a wrong cadence. It is a question, not a build, and it comes first.

**The most serious single finding is a typo.** Four cross-references inside SOP 604's OOS escalation point
one section too high, including 5.3.5 citing itself — so the Zone 1 product-contact positive procedure
instructs the reader to follow the Zone 1 procedure, and the water procedure is sent to Zone 1 instead of
to the general escalation. A pathogen positive is the most serious result that programme can produce and
its procedure does not resolve. Ten minutes to fix, and nothing but reading the document would have found
it.

**Two earlier `[verify in source]` markers resolved cleanly, which is the marker working.** W2-14: SOP 434
*does* make the QA/QC Manager the final approver, so the document is fine and ReadyDoc's DCR flow is the
gap. W2-15: SOP 434 and SOP 700 do not conflict — 434 is the approval process and FORM 700-01 is the list
it maintains — though 434 never cites it by number.

**And the reference graph may not have to wait.** D-027 stopped OBL-18 because Protocol 003 and Protocol
001 cite **no** other document by number. **These SOPs do**: SOP 604 cites SOP 600 and SOP 601, SOP 404
cites SOP 607. The registry's SOPs are a usable corpus even while the plans are not, which reopens a
sequencing question D-027 had closed.

**On the water sampling.** The plant confirmed the tap water testing is being done and logged in Quality
Schedules. W2-18 was updated rather than withdrawn: the work is real and **the record is not**. A completed
schedule is a work order that can carry an attached lab report; it cannot say "Total Coliforms, potable
water, March, absent, within the Present/100 mL action limit" in a form anything can read — and SOP 604
§ 5.6 and § 5.7 require exactly that to be tracked, trended and reviewed annually. The obligation buys the
evidence, not the work.

## D-039 · 2026-08-27 · decided — the supplier module is designed, and OBL-08 splits at the laboratory line

**Decision.** `docs/v2/queued/supplier-qualification.md` designs the supplier register that W2-05 found
missing, and **OBL-08 splits**: the supplier half stays there and is buildable now; the laboratory half
becomes **OBL-28** and waits on the document.

**Why the split.** Wave 2 put SOP 404 last on the build order on the strength of W2-25 — the laboratory
programme being two sentences. Re-reading the document, **that is true of the laboratory half only.** The
supplier half of § V is the best-specified thing in the whole Wave 2 set: pre-assessment steps, seven named
risk criteria, three named dispositions with their full definitions, the QVL, emergency vendors, monitoring
and disqualification. It can be built from the document as it stands. Keeping both halves under one
obligation would have blocked a buildable module behind a paragraph somebody has to write — the same error
as marking an obligation done when only part landed, in the other direction.

**Almost none of this is new machinery, and that is the point.** The spreadsheet importer, the zip
importer, the R2 file path, the expiring-certificate pattern and the approval-with-a-signature pattern all
exist. **What does not exist is a supplier.** Jake's spreadsheet is one `TARGETS` entry in `imports.js`.
The per-vendor archive is the scanned-tests pattern with **the path doing the work the filename did** —
`vendor / year / kind / file` parses the same way `DATE (TOPIC) NAME.pdf` did, and the same rules apply: a
path that yields no supplier, year or kind is reported and skipped, never guessed; the vendor name is
suggested for a human to confirm rather than created blind; preview writes nothing.

**Two boundaries that must not be crossed, and both are the same mistake in different clothes.**
- **A vendor's spec sheet is evidence, not a specification.** `coa_specifications` is *our* approved
  acceptance criteria, and NC 4.3.6 is about those not having existed. Letting a supplier's own document
  become the criterion it is graded against is the wrong direction and would be a finding in itself. The
  spec sheet files as evidence; a specification may *cite* it.
- **A vendor CoA is not a COA request.** `coa_requests` is a test we commission on our lot; the CoA in the
  vendor folder is the certificate they shipped, which SOP 404 § V.C.A.II requires at qualification. It
  carries an optional lot number so it also resolves from the receiving record, rather than being copied
  there.

**The archive is too big for any path that exists** — `media.js` caps a non-video file at 25 MB and the
training zip importer holds 400 MB in memory. So the parser is built and tested against **a path listing**,
which is a few hundred KB of text and is everything it needs, and the bytes go in **per vendor or per year**
through the app once the module exists. Sending the archive into a session would fail on size and would be
the wrong place for it anyway (D-030).

**A gap nothing had named until this design.** `coa_specifications` is keyed on `item_number` and has **no
supplier link at all**; `coa_requests` records a laboratory but never a vendor. So ReadyDoc cannot today
answer *"which supplier's material failed this test"* — which is the question SOP 404 § V.E vendor
monitoring is entirely built on. `supplier_materials` is that join, and it is a reason to build this module
before the ones that look larger.
