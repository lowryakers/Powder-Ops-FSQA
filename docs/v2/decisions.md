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

## D-040 · 2026-08-27 · decided — the supplier sheet is good, and the number it cannot say is the finding

**Jake's list was read with the repo's own `readTable()`, unchanged.** 67 vendors, one sheet, six real
columns. It is accurate, current and small enough to trust, which is why it is brought over rather than
replaced.

**The finding is a number the sheet cannot produce: 24.** Forty-three vendors are actively used and
nineteen have a completed questionnaire, so **twenty-four are being bought from without one** — and SOP 404
§ V.A says *"Components ordered for Powder-Ops will be done through qualified vendors ONLY."* The auditor
sampled three; **Mill Haven and M4 Dynamic are both among the 24**. So NC 4.3.1 is not three vendors, it is
twenty-four with three named, and nobody could see that because the sheet holds the two halves in separate
columns and never crosses them. **The derived state — actively using AND not qualified — is the single most
valuable thing the module adds**, and it is a `WHERE` clause.

**Bay State Milling, the auditor's third vendor, is not in the sheet at all.** Recorded as a question for
Jake rather than resolved: either they are no longer used, or the list is incomplete, and those have very
different consequences.

**One column carries no information and it looks like it does.** `Questionnaire Requested` is set for
exactly the 43 active vendors and no others — the two sets match exactly. It is a duplicate of
`Actively Using` wearing a different name, which is this project's recurring defect in its smallest form.
It becomes a **date**, because "when did we ask" is the only version that tells anybody to chase.

**Completing a questionnaire is not approval.** SOP 404 § V.C.III requires a disposition — Approved,
Conditionally Approved, Not Approved — decided by Quality after the seven-criterion risk evaluation. The
questionnaire is an input to that decision. The sheet has no column for the decision, which is why 19
"completed" reads as 19 qualified and is not.

**Decided against: inferring contact roles at import.** Tested against the real addresses — only **4 of
179** are recognisably quality or regulatory, **64 of 67 vendors have no obvious quality address**, and 143
are named people whose role cannot be read from the address. So the import splits the 179 addresses into
rows and **marks no roles**. The quality contact is learned the way `bank_rules` are: whoever sends FORM
404-1 marks the address they sent it to. **A guessed role on a compliance contact is worse than a blank
one**, and asking somebody to fill in 179 dropdowns is how a module stops being used.

## D-041 · 2026-08-27 · decided — the archive has three subjects, not two, and the third one is the manufacturer

**My first guess at the folder structure was wrong, and asking for real folders rather than designing
against an imagined layout is what caught it.** D-039 assumed `vendor / year / kind / file`. AIFI and Mill
Haven, walked in full, are `vendor / year / <file or a nested zip named after its subject>` — there is no
kind level, the classification is in the filename, and **the walk has to recurse into nested zips.**

**Two corrections to D-039.**
- **There are no COAs in the archive.** Not one file in either vendor. The folders hold *qualification
  evidence* — certificates, statements, specifications, SDS, HACCP plans, audit reports. The rule about
  vendor CoAs still stands for when one appears; it is not what is in there.
- **There are three subjects, not two,** and the third is the one nothing had allowed for: the **manufacturer
  behind the material**. Prayon makes the dipotassium phosphate, Daffodil Pharmachem the potassium citrate,
  Dainty Foods the brown rice flour. **AIFI is a distributor.**

**SOP 404 anticipated exactly this and we had read past it.** § III.A: *"This may be a broker or agent, or
the actual manufacturer of the packaging or starting raw material."* **The quality-system evidence that
qualification turns on — the BRC, SQF and FSSC audit certificates — belongs to the manufacturers, not to
the vendor we buy from.** So `supplier_materials` gains `manufacturer_name` and certificates attach there.
Without it, *"is this material from a qualified source?"* is answered by looking at AIFI's W9 when the
thing that matters is Daffodil's BRC certificate.

**`server/supplier-archive.js` is built, pure, and tested against the plant's own folder names** —
`scripts/check-supplier-archive.mjs`, 18 assertions, against a fixture that is the **real 84-entry listing**
(paths only, no file contents) so the parser stays honest to the real names rather than ones we invented.
A **fixed date** is passed in rather than read from the clock: a parser whose report moves overnight cannot
be tested.

**One assertion failed on the first run and the code was right — I was wrong.** I had eyeballed two expired
certificates from the filenames; the parser found **five**, and re-reading confirmed it. Recorded because
the instinct to "fix" a parser that disagrees with a hand count is how a wrong hand count gets encoded.

**What it can now say that nothing could before.** Five certificates on file have expired — Daffodil
Pharmachem's **BRC Audit Certificate 13 months ago**, and four Kosher/Halal certificates. All five are in
the **2025** folder, and **neither Potassium Citrate nor Dipotassium Phosphate has a 2026 folder at all**,
while Brown Rice Flour was refreshed. Two materials' evidence has lapsed with no replacement on file. That
is precisely the state an annual review exists to catch (W2-29) and Jake's sheet has no way to show.

**And the parser reproduces NC 4.3.1 from the folder structure alone:** Mill Haven has no questionnaire and
an empty 2025 folder. Jake's sheet says the same thing from the other side, which is the first time two
independent sources in this project have agreed on a finding without either being derived from the other.

**Five of 79 files came back unknown and all five genuinely need a person** — two "Powder Ops LOG.pdf",
AIFI's own "Document Expiration.pdf" (which may already answer the five lapses above), and Mill Haven's two
spec sheets, whose filenames say only `425007-01, Inst WPI SF, GF`. **Reported, never guessed**, which at
6% is the rate that keeps an importer trusted.

**One for a human, not a rule:** `Dipotassium Phosphate.zip` contains `Disodium Phosphate Ingredient
Composition.pdf`. Different chemical. Either a mis-filed document or a filename typo, and the difference
matters.

## D-042 · 2026-08-27 · decided — build the supplier register the best way, and the archive says what that is

**The brief was explicit: best possible, not a mirror of how it is done today.** Recording what that means
concretely, because "best possible" is otherwise a phrase everybody agrees with and nobody can check.

**The unit of qualification is (material × manufacturer), not the vendor.** AIFI supplies three materials
made by three different companies, so qualifying "AIFI" says nothing about whether the potassium citrate
came from a qualified source — that answer is Daffodil Pharmachem's BRC certificate, expired 13 months. A
vendor-level register mirrors the folders and inherits their blind spot. SOP 404 § V.C.E already requires a
new risk evaluation per material even from an already-qualified vendor.

**Forty-one of seventy-nine files are the same twenty questions asked again per material** — gluten, GMO,
vegan, organic, allergen, Prop 65, country of origin, kosher, halal, heavy metals, sewage sludge, food
fraud, lot code, recall, shelf life. **Mirroring makes those 41 documents to file; the right design makes
them ~20 attributes on the material, each carrying the file that evidences it.** That is the single biggest
gain and it is invisible if you reproduce the folder structure: it turns "which materials have no allergen
statement?" from impossible into a filter, and answering a customer questionnaire from a scavenger hunt
into an assembly. It is also a pattern the plant already trusts — `equipment-readiness.js` derives ten
steps per machine from records rather than storing a checklist. **Nothing is ticked by hand; an attribute
is answered because its evidence exists.**

**A certificate is a dated obligation, not a PDF.** Five have lapsed unnoticed. `certifications` already
does expiry-generates-work for people and `calibration_instruments` for instruments; the pattern has simply
never been pointed at suppliers.

**It has to reach the dock or it is still a filing cabinet.** SOP 404 § V.A says components are ordered
through qualified vendors ONLY, and nothing checks that where it matters. FORM 204-01 is already worked at
the truck and already escalates, so it gains a **derived** line naming a lapsed or absent qualification.
**It warns and records; it never refuses** — the pallet is already on the dock, and a receiver blocked by a
paperwork gap they cannot fix goes around the system rather than through it. Same asymmetry as the ATP
grading: it can raise a fail, never quietly pass.

**Three things deliberately not built.** Not a second Drive — evidence goes to R2 once, and after that
arrives as a side effect of filing a qualification, not as an upload chore. Not a controlled-document
register — these are the supplier's documents, they carry no revision of ours, and an auditor asking for
our register must not be handed Prayon's Prop 65 statement. And not the folder taxonomy reproduced: 2025 /
2026 / Customer Documents is how the evidence arrived, not how the questions get asked.

**On the full archive: it is not needed and should not be sent.** Every fact the design turns on is in the
filenames — the expiry dates included — so a path listing answers the whole question at ~100 KB. The bytes
matter only when they are being stored, which happens through the app. Disk here is not the constraint
(30 GB free); relevance is.

## D-043 · 2026-08-27 · decided — the supplier register landed, and OBL-08 split three ways

**Landed on `main` as `ff384ca`.** The second thing this project has shipped, and the first whole module:
five tables, the archive parser, the pure reconciliation, the import pipeline, the SOP transcription and
the screen. `npm run check:suppliers` joined `npm run check`, so the rules are guarded for whoever touches
this next.

**OBL-08 split rather than being marked done, and the split is the honest part.** What landed is the
RECORD; what did not land is the WORK and the DOCUMENT.
- **OBL-08 → landed**: the register exists (FSP-25, FSP-31, W2-05, W2-07).
- **OBL-29 → open**: collecting the 22 missing questionnaires and dispositioning the 21 that already have
  their evidence. **NSF/ANSI 455-2 § 4.3.1 does not close until that happens** — ReadyDoc can raise the
  obligation and catch the result; it cannot ask a supplier for a questionnaire. W2-29 rides with it:
  `next_review_due` now records when an annual review is due and **nothing yet generates work from it**,
  which is precisely the piece that stops this register going quiet the way the tracker did.
- **OBL-30 → open**: SOP 404's own defects, none of them software. FORM 404-3 is required by § V.C.B.II,
  cited by § VI, and has never been issued.

**The headline number was split during the build, and that was the most useful change made.** After
importing the real data the register read "42 buying without qualification" — true under § V.A and useless.
It lumped a vendor whose questionnaire and certificates are all on file and merely lacks a recorded
disposition together with one that has nothing at all. **21 awaiting a disposition** (Quality, a short job)
and **22 with no questionnaire document on file** (Purchasing, weeks) are different work for different
people, and they partition the active set.

**The register counts EVIDENCE, not claims** — a tracker tick with no document behind it counts as no
questionnaire, because "show me the questionnaire" is what an auditor asks. That is why the register says
22 where the reconciliation said 16: the reconciliation accepted either source. It is a deliberate choice
and a one-line change if the plant disagrees.

**Track B rebased the same hour** (D-016). Every supplier commit dropped as already upstream, which is the
correct outcome: the module is `main`'s now.

## D-044 · 2026-08-27 · decided — a review that falls due raises its own work, a first qualification does not

**Landed on `main` as `8d16b97`.** `next_review_due` had been recorded since the register shipped and
nothing watched it. That is the defect this project keeps finding — the 72-hour re-clean that waited for a
supervisor to press Assign, the QA inspection whose task completed and filed no record, the certificate
that lapsed thirteen months ago in a folder.

**The decision worth recording is the SPLIT, not the generator.** Two states look similar on the register
and are different work:
- **A review that has come due raises a work order.** Nobody is looking for an annual date, so it has to
  land in a list.
- **A supplier that has never been qualified is nudged and NOT tasked.** On the real data that is 22
  vendors, and raising 22 work orders on the first boot is a queue nobody asked for — the same reasoning
  that stops one stray ATP reading raising a re-clean. It is also not the same job: a review is a recurring
  obligation with a date; a first qualification is a chase. The screen already counts them, the nudge
  reaches QA, quality and **purchasing**, and the message says explicitly that no task was raised for the
  second so nobody assumes one is sitting somewhere.

**Idempotence is (qualification, due date)** on a `supplier_qualification_id` column — the shape
`quality_schedule_id` and `pm_schedule_id` already use, rather than a generic key column or a side table
like `reclean_actions`. **The due date being part of the key is the whole trick**: recording a review stamps
next year's date, so next year's task is a NEW one instead of being suppressed as a duplicate of this
year's. Both that and "a second run raises nothing" are asserted, because both fail silently.

**Only the latest period per supplier can come due.** An older year's review is superseded by the one that
replaced it, and raising work for both would put two tasks on one vendor for one obligation.

**OBL-29 split again:** W2-29 became **OBL-31, landed**; what stays in OBL-29 is the work itself —
collecting the 22 questionnaires and dispositioning the 21 whose evidence is already on file. ReadyDoc now
raises the obligation, catches the result and chases every third day. **It cannot ask a supplier for a
questionnaire**, and the register should not pretend otherwise.

## D-045 — One branch. The two-track split had already collapsed, and it cost a wrong status doc

**Supersedes D-005 and makes D-016 moot.** The reasoning in D-005 was right and is worth keeping: a
long-lived V2 fork IS the big-bang cutover wearing engineering clothes. What it did not anticipate is
that the discipline it prescribed — new construction on the branch, refactors on `main` — would resolve
itself by everything simply landing on `main`. The ATP grading, the supplier register, the annual
review, the document storage, the disposition queue: all shipped to `main`. Track B ended up holding
only documents.

**A branch that holds only the record of what we decided, while the work happens elsewhere, is the
worst possible version of this.** It is the same fact in two places, which is the defect this entire
project exists to remove, occurring inside the project's own governance.

It cost something concrete on 2 September. The audit status document published from Track B reported
four of the twelve NSF findings as "not started" when `main` already carried:

- `banned-substance-sop-seed.js` — a full draft of the Banned & Prohibited Substance Control Program,
  seeded as a draft awaiting Document Control. That is the document all three GMP for Sport findings
  hang on.
- `emp-site-list.js` — FORM 604-01 transcribed with its alert and action limits, and six EMP quality
  schedules seeded. That is 4.5.84.
- `audit-readiness.js` — an audit-readiness review computed from records.
- `signature.js` — a signature service covering 21 CFR 11.200, used by four routers.

The status was built from `docs/v2/obligations.json` rather than from the code. **A register that is
not derived from what it describes goes stale exactly as the supplier tracker did**, and for the same
reason.

There were also **two triage documents for the same twelve findings** — `docs/audit-2026-08-findings.md`
on `main` and `docs/v2/queued/audit-nc-triage.md` on Track B — with different classification schemes and
two published artifact URLs. Whoever read one did not read the other.

**So: one branch, one session, one document per subject.** `docs/v2/` stays as the home of the
architecture and the decisions, on `main`, where the code it describes lives. The obligations register
stays, but its claims about what is built are now checked against the repository rather than asserted.

**What does not change:** D-001 (do not rebuild), the spine order in `architecture.md`, and the rule
that a decision gets a superseding entry rather than an edit. This entry is that rule working.

## D-046 — A reading that repeats the previous check's is questioned, never refused

**2 September 2026.** Maria recorded yesterday's temperature and humidity against today's Temp &
Humidity task. Nothing caught it, so today held a record carrying yesterday's numbers and yesterday
held no record at all. The mechanism to prevent it already existed — the completion form asks *"when
was this done?"* — and defaults to today, which is exactly the answer somebody transcribing
yesterday's sheet does not stop to change.

**The rule is a QUESTION, and that is the decision.** A stable room genuinely reads 68°F and 35% two
mornings running, so a rule that refused identical readings would block correct work and be switched
off inside a week. The server refuses the submission **once**, with a machine-readable flag naming the
record it matched and who filed it, and accepts the identical body back with
`confirm_duplicate_readings`. The operator answers a question only they can answer — *is this today's
check, or yesterday's?* — instead of being told they are wrong.

Three limits keep it from becoming wallpaper:
- **Only the immediately preceding check on the same schedule.** A room that has read 68/35 all month
  is not filing a duplicate every day; the failure being caught is specifically "the last check's
  numbers went into this one".
- **A blank reading never matches.** Most tasks record no readings at all, and two empty sets matching
  would fire on every one of them. Same rule as the ATP limit: a missing reading is a gap, not a
  finding.
- **File path only, never the edit path.** Correcting a typo next week must not re-ask a question that
  was answered when the record was filed — the asymmetry the ATP escalation and the lab-test alert
  already draw.

Asked in **EN and ES on the floor screen**, from the structured facts rather than the server's English
prose: a question shown only in English is one half the shift cannot answer.

`completeWorkOrder()` in `src/lib/` is the one client path, so the Operator View and the Task Center
cannot ask two different questions about the same rule — a check only one screen applies is a check
people work around by using the other screen.

**Also decided here:** `apiFetch` now attaches the whole error body as `err.data` rather than lifting
one flag at a time. `signatureRequired` was this same need solved once, narrowly; copying a new field
up on every refusal that carries facts is how one of them gets forgotten.

**Verified:** 15 assertions on the pure module and **14 executed against a live server on a fresh
database**. The live half earned its keep immediately — it caught `priorCheck` selecting a
`work_orders.performed_on` column that does not exist, which the pure test could never see. The
control matters: disabling the guard fails 8 of the 14, including the two that reproduce the original
bug exactly (*the task completes* and *1 record filed*).

## D-047 — A completion advances the schedule from the day the work was DONE

**2 September 2026.** Reported as "there's no Temp & Humidity task for today". Reproduced end to end
before touching anything, and the cause is not the one the report suggests.

Maria completed the daily Temp & Humidity task on the 2nd, correctly recording in the form's
*"when was this done?"* field that the check was performed on the 1st. **The record was right** —
`performed_at` said the 1st and `entered_late` was set, which is why re-dating it (the repair first
suggested here) turned out to be unnecessary and wrong. What was broken is what happened next:
`createNextWorkOrder` computed the next due date from `new Date()`, so the next task fell due on the
**3rd**, and the **2nd never got a task at all**. Nobody could take that day's readings and nothing
anywhere reported a gap.

**One fact, one owner: the day a completion satisfies is the day it was PERFORMED.** The schedule now
advances from `backdate.when` rather than from the moment Complete was pressed. On an ordinary
completion those are the same date, so this is a **no-op for every non-back-dated completion** — which
is the property that makes it safe to ship into a live plant.

A resulting due date in the past is correct and deliberate. Those days genuinely had no check, and a
task that arrives already missed says so; one quietly scheduled for tomorrow does not.

**Also added: never two live tasks for one schedule on one day.** Back-dating can land the next task on
a date that already holds one, and a duplicate is worse than late — two cards for one check, and
whichever is completed leaves the other outstanding for ever. `createNextWorkOrder` returns the
existing task instead, flagged `existing: true`.

**The rework path was a workaround, not the fix**, and it is worth saying so: sending the task back for
rework does restore a card for today (verified), but it does it by reopening a task that was legitimately
completed, and it leaves the review history claiming work was rejected when it was not. With this
change no rework is needed.

**Verified:** 11 assertions against a live server on a fresh database (`npm run verify:backdate`),
including that an ordinary completion is bit-for-bit unchanged and that a weekly check done yesterday
falls due in six days rather than seven. **The control matters — reverting the one argument fails 6 of
the 11.** One assertion in the first draft was vacuous (`t(..., true)`); it now reads the filed
sanitation record, and the fixture carries a title `recordAreaForTask()` actually recognises so the
record path really runs.

## D-048 — New-hire onboarding folded onto main from a disconnected branch

**2 September 2026.** `claude/adp-onboarding` carried a complete feature that existed nowhere on `main`
— onboarding a new hire inside ReadyDoc (personal details, direct deposit, W-4 inputs, emergency
contact) and handing the result to RUN Powered by ADP. Seven files, none of them referenced in
CLAUDE.md, invisible from every screen. Found by comparing branch TREES rather than commit
reachability: four branches share **no merge base** with `main`, so "N commits ahead" says nothing.

Folded rather than rewritten (D-001). Seven files, one table (`onboarding_records`), two mounts, one
public path and five client wires. All three module dependencies — `server/module-access.js`,
`custom-fields.js`, `links.js` — were already on `main`.

**The design decision worth keeping, which is the branch's and not mine:** without
`ONBOARDING_ENC_KEY`, the SSN and bank fields are **not collected at all**. The portal hides the
inputs and says the office will take those details directly. A plaintext SSN in a database backup is a
worse outcome than a form with two fewer fields. `adp.js` degrades the same way — no credentials, a
503, and the rest of the module works.

**A vacuous assertion, caught by tightening it.** The first version of the check asserted only that the
SSN was *not stored in clear* — which is trivially true of a record that stored nothing at all, and
that is exactly what was happening, because the test ran with no encryption key. It now asserts the
submission **landed** before asserting what it does not contain, and runs both ways: with a key
(encrypted, last-4 readable) and without (nothing sensitive stored, the rest of the form still saves).

**Verified:** 15 assertions with a key and 14 without, against a live server on a fresh database
(`npm run verify:onboarding`), covering the mount, the module guard refusing an operator, the public
portal answering with no session, a bad token 404ing, and ADP degrading.

**Still blocked on a person, not on code:** RUN's APIs are reached through the ADP Marketplace — there
is no self-serve API key on the RUN plan. Someone has to register a developer account at
developers.adp.com and an application as a data connector. `docs/adp-run-onboarding.md` is the
step-by-step. Until then the module works end to end and the ADP submission 503s.

## D-049 — Review by class of defect before the spine push; 602-01 goes P/F against a per-product spec

**2 September 2026.** Every bug this week was one of six shapes — one label on the wrong column, a picker
that cannot offer a stored value, a nullable column read two ways, a write path that skips the one
definition, a date computed from *now*, and vacuous truth on an empty collection — plus the recurring
mirror defect and the mobile card pattern. Each shape had siblings nobody had looked for. So the review
is **by class, not by module**: a class predicts its other instances, a module review finds what the
reviewer happens to notice. The register is `docs/v2/queued/pre-spine-review.md`: 64 verified findings,
every one with a `file:line`, ordered so the five that change what a compliance record *is* go first.

**OBL-01 is split** (OBL-32). ATP grading landed on the Sanitation form door and never on the task door —
`server/api/pm.js` has no reference to `atp` while the Operator View captures the reading. The rule from
OBL-01/OBL-27 applies to itself: an obligation half-discharged and marked done is worse than one open.

**Three decisions on FORM 602-01 V2** (`docs/v2/queued/organoleptic-v2.md`):
1. **P/F against a written spec, not a 1–5.** The plant offered to change the form to a scale instead;
   declined, because a scale with no spec is an opinion, a scale with one is redundant, graders cannot be
   calibrated without reference samples, and P/F is what an auditor can check and what releases product.
2. **The spec is per product and the first test writes it.** No finished-goods organoleptic spec exists;
   rather than an authoring project across 118 SKUs, a product tested with nothing on file has its draft
   spec written by that test, approved once by a QA lead, then locked. `form-607-specs.json` already holds
   exactly this shape for raw materials.
3. **The Flavor Approval adopts the same five attributes and P/F** so `syncFlavorOrganoleptic` remains a
   copy and not a mapping; a new flavour's approval drafts its spec. "Overall" goes — it was the approver's
   job. Raised for Document Control; not decided here.

**The trap recorded so it is not walked into:** `controlled.js` snapshots `{fields, logColumns, formCode}`
only. The deploy that introduces V2 parks both forms at V1 while `passFail`, `shared/sensory.js`, the syncs
and the client switch immediately. Eight second copies of the five-key shape exist outside
`shared/sensory.js`; the most dangerous fails to five nulls on the public approval page.

## D-050 — FORM 602-01 V2 is built: pass/fail against a per-product specification the first test writes

**3 September 2026.** D-049 decided the shape; this records what landed and the one trap it had to
respect. `product_sensory_specs` holds one specification per product (five attributes, in words), drafted
by the first test of a product with none on file, approved once by a QA lead, then locked. Every test
stores the spec text it was graded against (`sensory_spec`), so a record goes on saying what it was
checked against after the spec moves — the `atp_limit` rule. A "does not match" anywhere fails the test
and raises the draft disposal; the Flavor Approval's QA scoring step is the same block against the same
spec, so the Organoleptic record it files is a copy, not a mapping.

**The retired keys are never reused.** `aroma`, `flavor` and `overall` hold data on 123 filed records
and stay readable as V1 (`sensoryShape()` decides from the VALUES, because `appearance` and `texture`
are keys in both shapes). Relabelling history as answers to a question nobody asked is the one thing a
form change must never do.

**The controlled-change trap is respected rather than dodged.** `controlled.js` snapshots a QMS form's
`fields`; on an existing database the deploy parks V2 as pending and keeps serving V1. Every reader —
validation, the result rule, the FA scoring step, the texted approval page, the sync, the PDF — keys off
the SERVED definition (`formIsV2(cfg.fields)`), so the app is coherent on V1 until Document Control
approves and coherent on V2 the moment it does. The eight second copies of the shape the dependency map
found are gone; `check:sensory` asserts that and was written to fail at import on V1 code.

**Not the app's to decide:** the DCR for 602-01 V2, whether the Flavor Approval form (a second
controlled document) adopts the same shape, and the register row's revision. `docs/v2/queued/dcr-form-602-01-v2.md`.

## D-051 — The fresh scan before the spine push: what it found, and the two halves of the foundation

**3 September 2026.** With the register worked through, the codebase was swept again by the same eight
classes, and every check was run: `npm run check` (lint, build, fresh boot, every list endpoint and
eighteen pure checks) plus **`npm run verify:all`**, new — every live verify in one run, each on a fresh
database against a real server with the stand-ins it needs. Those two commands are the foundation's
definition from here: green on both is what "clean" means.

**Found by the sweep, fixed:** releasing a lockout and deciding a hygienic-design verification both took
the signer's name from the request body (the D7 shape, two doors the review missed); they are the
caller's signed act now, and only the person who locked out can release. Five test assertions ran
`.every()` over lists that could be empty. **Found by a check, not by reading:** the Artwork-Proofing
feed (`master.csv`) had been answering *Not authenticated* since the NULL-map rule tightened — the
module guard refuses a session-less request before the router's public handler runs — and the proofer
caches and reports nothing, so nothing said. Mounted ahead of the guard now (D-050's sibling lesson: a
public door needs its own mount, not a public path inside a guarded router).

**A test premise went stale, not the code:** `verify-qms-signature` created its QA users with no module
map, which review 03 made an empty account. The users carry their grants now. The lesson is the reason
`verify:all` exists — a live verify that is not re-run after the rule it leans on changes is a claim.

**Left as notes, deliberately:** the laptop-facing wide tables (they scroll; nothing is unreachable),
the typed approver on document activation, the org chart and the NFP in-app decision (a regulatory
name that legitimately differs from the operator keying it, all three documented as such), and the
Operator View's tab strip (a deliberate scroller).

## D-052 — The Shipping Truck Inspection ships as a DRAFT form, stamped as one, until Document Control issues it

**Date:** 3 September 2026. **Asked for by:** the warehouse (via Lowry): "a truck inspection list for
warehouse to fill out when they are doing a shipment — mirror the receiving inspection list, two tabs
(receiving + shipping), and the ability to add photos of product on the truck before the shipment goes out."

**The conflict.** Every checklist in ReadyDoc is transcribed verbatim from a controlled form (D-013's
doctrine, FORM 204-01, 403-01, 415-1). There is no controlled outbound truck inspection form: the Forms
Master Index has none, SOP 205 (Shipping) describes the process and issues no form, and the plant has not
been working one on paper. Building it meant either inventing a form and presenting it as the plant's, or
refusing the warehouse a record it needs now.

**Decided.** Build it, and make the record say what it is. `server/shipping-checklist.js` carries
`form_code: null` and `CHECKLIST_REVISION = 'DRAFT-1'`; every filed inspection is stamped DRAFT-1 forever,
the screen carries an amber note on every record, and the questions were drafted from three named sources
(SOP 205, the pre-load half of FORM 204-01 turned around, and what an SQF outbound transport check asks)
rather than from taste. When Document Control issues the number, the code takes that number and revision,
`controlled.js` parks the change, and records filed afterwards carry the issued revision. Records filed
under DRAFT-1 are never re-stamped. The DCR draft is `docs/v2/queued/dcr-shipping-truck-inspection.md`.

**Why not wait.** A truck that leaves with no record is worse than a truck that leaves with a record
honestly marked as predating its form. The alternative — the warehouse photographing loads into a chat
channel — is the film-inspection failure D-013 already recorded once.

**Mechanics that follow the receiving form exactly, on purpose** (one dock learns one form): get-or-create
on the number, answers saved as tapped, escalations DERIVED from the answers and sent on the triggering
answer, sign-off refused while anything is blank. The escalation targets are the receiving form's own QA
people under a different subject line; the `Item`/`ItemNotes` renderers are imported from the receiving
screen, not copied. Numbering is `S-100-####` from its own table alone, so it can never collide with the
three-table `A-100` counter.

**The one new rule: the photo claim is checked against the photos.** "Photos of the loaded product taken
before the doors closed — Yes" with no photograph attached is a claim with nothing behind it, which is
precisely what the form exists to prevent. Sign-off refuses it and names the fix. Photos are refused on a
signed-off record (revoke, attach, sign again). Verified: `verify:shipping` (35, live), `verify:warehouseui`
(20, real browser at 1280 and 360).

**Also in this change, the People module** gained `tags` (a category somebody can be called from: the
plant's teams from `shared/task-groups.js` plus `Temp / 1099`, kept apart from the free-text `areas`) and
`candidate_files` (a résumé on the person, deleted with the person, same office/HR-only door). No
decision of doctrine there; recorded so the session is not the thread. `verify:people` (26, live).

## D-053 — The W-4 and I-9 are completed and signed in the onboarding wizard; the finish gate is one derived list

**Date:** 3 September 2026. **Asked for by:** Lowry, after testing the wizard: "there's no requirement for
them to enter the SSN before moving forward" and "can we have them complete W4's, I9 docs through this as
well — attach pictures of documents, attach voided check?"

**Decided.** Yes to all of it, with two rules. (1) **Nothing finishes half done**: `missingToFinish()` is
the one list of what the forms still need, derived on every read and read by the wizard, the office row and
the finish endpoint alike. (2) **A signature is a legal name typed under the form's own perjury statement,
with the time, address and device recorded**; the employee's two signatures are refused under any other
name or without the attestation, and the employer's I-9 Section 2 goes through the password gate like every
other signature in ReadyDoc. Pictures (ID documents, voided check) ride the shared media path.

**Deliberately not claimed.** That the packet PDF is the retained Form I-9. Electronic I-9 systems have
their own federal rules (8 CFR 274a.2) that nobody has reviewed this against, and a compliance claim the
app cannot back is the fabricated-record refusal in a new place. The guide and the panel both say the
office completes the official I-9 from the packet — in ADP, which has its own I-9 flow, or on paper —
until HR decides otherwise. The employer must still examine the originals in person.

**The bug the no-key run caught.** The wizard re-sends the secret keys as empty strings after every save;
the server refused the whole page in no-key mode. A blank is "nothing to store". Both runs of
`verify:onboarding` stay for this reason.

## D-054 · 2026-09-05 · decided — The four preventive controls are in the database, and the limit is closed to the text box

OBL-02 lands: `seedPreventiveControls` runs at boot after the equipment seed, `PUT /haccp/:id` refuses a
change to any field `preventive-controls.js` owns (and to the name, which is the seeder's identity key)
with `400 PC_OWNED`, and the CCP editor locks those fields and says why. `ccpDrift()` is read by the
readiness review, so a row that wanders from the document is a visible amber line rather than a silent
one. The description stays open — it is where "the record for this control is on paper today" is written
(D-021), which is a fact about the plant, not about the plan.

**Landed ahead of the wording check, deliberately, and the check is its own obligation now (OBL-33).**
The Pulse comparison on 5 September put Manage CCPs = "No CCPs defined yet" on the P0 list, and the
honest empty state had been standing for twelve days waiting on a reading nobody had scheduled. The
seeder is insert-only, so a wording correction costs one line in source plus one deleted row — cheaper
than the empty state was costing. Splitting rather than marking OBL-02 done on the strength of the half
that has not happened is the rule the register already has (the OBL-01 / OBL-27 split).

**Expected side effect, stated so nobody rediscovers it:** the compliance bell's HACCP line checks every
CCP for linked equipment and in-date instruments. PC #1–#3 link nothing, so the line reads amber with
"no equipment/instruments linked" from the first boot after this. That is the truth — those controls'
records are on paper — and it should stay amber until D-021's `where` question is answered, not be
silenced by linking a machine for the sake of the colour.

## D-055 · 2026-09-05 · decided — A paused schedule reports the work it left behind

The small Track A change D-012 asked for. Pausing cascades nothing; the tasks a schedule raised before
the pause stay open or missed, nobody completes them because the work is recorded elsewhere, and from
the floor the retirement looks like it never happened. The 5 September comparison found exactly that:
three Daily Scale PM cards overdue since 24 August, the day the schedules were paused.

`GET /pm/schedules` now carries `open_work` per schedule (open, in progress, overdue AND missed — the
old client-side count fetched `status=open` and left every missed task out), the pause response and its
audit entry carry the count left behind, and Recurring Schedules names the paused schedules still
carrying work with the way out (Cleanup Review, one click for an admin). **One owner for the number:**
the client no longer counts for itself, so the strip, the row and the pause message cannot disagree.
Pausing still closes nothing — closing is a decision with a reason (D-012), and the strip exists to make
sure it gets taken rather than to take it.

## D-056 · 2026-09-08 · decided — The official audit reports change nothing in the triage and everything in the calendar

The official documents arrived through NSF Connect on 4 September: the GMP for Sport audit report
(4990682: Not Acceptable 0, Critical 0, Major 0, Minor 3) and the Corrective Action Reports for both
audits. **Every finding's wording is identical to the preliminary reports**, so the twelve-entry triage,
its three buckets and its order stand as written. The 455-2 audit report itself has not been supplied;
its CAR report carries the findings in full.

**What is new is two dates.** The nine NSF/ANSI 455-2 CARs (4990683-1 … -9) are due **18 September
2026**; the three GMP for Sport CARs (4990682-1 … -3) are due **4 October 2026**. The nearer date carries
the larger set, and it is ten days from this entry.

**The doctrine for the responses is the repository's own doctrine, restated for NSF Connect.** A
response claims only what exists and can be produced on request; nothing is closed and no response says
otherwise. Each answer is a plan with a named person and a date, in NSF's six parts (root cause,
corrective action, preventive action, responsible person, completion date, evidence). NSF's instructions
name the root causes that get a response returned — restating the finding, "unaware of the requirement",
"employee did not follow procedure" — and the actions that do — "SOP will be updated", "Not applicable".
A returned response is answered by adding a dated reply, never by overwriting the first; the same rule as
a QMS record. Evidence is attached wherever it already exists (the supplier register for 4.3.1; the
Authentication and Access Control Verification V1 the auditor read for 4.4.39; the specification documents
the auditor listed by number for 4.3.6).

**The auditor read the executed verification report and wrote 4.4.39 anyway.** That settles what the
Part 11 package has to be: not more test scripts, but scope, a gap assessment against Part 11's
controls, protocols named and approved by Quality as validation, and change control over the software
(which is also 4.3.9). The evidence machinery exists; the document that calls it validation does not.

The PDFs are not committed: the report pages are marked NSF Confidential and the instructions are
reproducible only with NSF's permission. They go in the Reference Library beside `REF-NSF-GMP-AUDIT`.

## D-057 · 2026-09-09 · decided — A pay-review item leaves the office's list only when the act that clears it has happened

Lowry's ask: the ReadyBot notes on Pay Tracking must not go away until he or Marnee has actually done
something. The failure they were describing is real and specific: the office reminder listed overdue
assignments and unassigned people, but **a submitted evaluation waiting on a rate decision was not in it at
all** — the one item that is entirely the office's to act on could be read once in a DM and lost.

`payActions(db)` in `api/pay.js` is the one list, derived on every read and stored nowhere: **decide** (an
open review — cleared by applying a rate, which resolves the reviews, or by closing them as held flat with a
reason), **chase** (an assignment past its date — cleared by the reviewer delivering or the assignment being
cancelled) and **assign** (clock run out, nobody asked, nothing submitted — cleared by assigning, a review
arriving, a rate, or marking reviewed). The screen strip, the every-third-day ReadyBot reminder and the
admin's bell badge all read this function, so none can clear while another still shows something.

**There is deliberately no dismiss.** "I saw it" is not an action, and a dismiss button is how a list
like this stops meaning anything. If a genuine "not now" case appears (someone on leave), it becomes a
recorded reason with a date, not a hide.

Recipients are `pay_action_recipients` in `app_settings` when the plant has chosen, and otherwise every
active admin plus the office, HR and admin departments — never nobody. Editable on the strip itself.

Verified: `verify:payactions`, 31 assertions live and in the browser, relative to the seeded baseline (a
fresh database already has people past the clock, which the first cut of the test wrongly called empty).

## D-058 · 2026-09-09 · decided — FORM 404-1 is completed and signed on a link, and the signed form files itself

Lowry's ask: a URL any supplier can open to fill in, sign and submit the Supplier Qualification
Questionnaire instead of receiving a Word file, printing it, signing it, scanning it and emailing it back
— secure, simple, phone or desktop. The finding behind it is 4.3.1 (CAR 4990683-2): the questionnaire
"was not available" for three suppliers, and the reason it was not available is the loop it had to go
round. 22 actively used vendors never returned one.

**The link is the plant's own form, word for word** (`server/supplier-questionnaire.js`, transcribed from
FORM 404-1 V2 — 41 questions, the five header lines, the instruction naming Purchasing's address, the
footer). Nothing was reworded and nothing was added; a question the plant did not put on the controlled
form is a Document Change Request, the `receiving-checklist.js` rule. The form's "For internal use only"
block — risk evaluation and quality disposition — is deliberately **not** on the link: that decision is
taken in the register under SOP 404 § V, where the seven criteria and three dispositions already live,
and a second copy of it on the questionnaire page is the two-owners defect. **Noted for Document Control:
the form's internal block asks four risk questions where SOP 404 § V lists seven.** The module follows
the SOP for the decision and the form for the questions; which document is right is theirs to say.

**The mechanism is the NFP approval link, reused rather than reinvented.** A token issued once, stored as
SHA-256, returned in clear once, one live link per supplier (sending again withdraws the previous one),
revocable, single-use once submitted. The supplier needs no account. Answers save as they are tapped —
this is filled in by someone who may be interrupted, on a phone — and validation belongs at submit, which
is where it is: the still-needed list is derived on every read and the same list refuses the submission.

**A signature is a typed name under the form's own statement, with title, time and address**, and the
name must be the person the header says completed the form. An approval-style record with nobody's name
on it is not a record; the same rule the onboarding W-4 and the NFP link follow.

**Submitting files the record.** The signed answers render to a PDF stored against the supplier as a
`questionnaire` document, the answers are its searchable text, the attachments the form asks for (audit
report, organization chart, MMR and BPR examples, SOP table of contents) file beside it, this year's
qualification period records the request and receipt dates, and Quality and Purchasing are told through
ReadyBot. So the register's "no questionnaire on file" clears the moment the supplier presses Submit, and
the supplier moves to "awaiting a disposition" — Quality's queue, which is where the finding always said
the decision had to be made.

**What this does not do:** it does not qualify anyone. The disposition is still a person's decision under
§ V, and a returned questionnaire is evidence for it, never it (the D-nnn rule the register was built on).
It also does not chase: the link is sent by a person, to a named recipient, and the every-third-day
nudge already covers the follow-up.

Verified: `verify:supplierq`, 40 assertions live and in a real browser at 390px — the register before
and after, one live link, the 403 for a purchasing operator without the grant, every refusal on the public
side, the stored PDF downloading through our own origin, the ReadyBot DM, the audit under the supplier's
own name, and the office seeing the submission on the record.

## D-059 · 2026-09-09 · decided — The master manufacturing record lives in Keychain, not ReadyDoc

Lowry: "I think the MMR issue is going to be solved in Keychain, not within ReadyDoc." CAR 4990683-7
(4.5.43) is therefore answered with the ERP that is replacing MRP Easy: one approved master record per
formula and batch size, batch production records generated from it, enforced there once it is live. The
CAR response text now says so; ReadyDoc's part is nothing beyond what the preventive-control walk already
recorded (D-021: the four controls resolve to the batch record, which is a Keychain document). This
supersedes the roadmap line that had the MMR as a ReadyDoc controlled-document type. `check:ncstatus`
still asserts no MMR table exists here, which is now the intended state rather than a gap.

## D-060 · 2026-09-09 · decided — A scheduled check declares what it files, and one interface files it

Three CARs asked for the same thing in three vocabularies: an environmental result record (4.5.84), a GMP
observation record (4.2.9), a documented list review (6.2.3.1). Each is a scheduled check whose completion
used to write readings onto a work order and file nothing — the defect `fileQaInspectionRecord` closed for
the QA inspections, recurring. Rather than a fourth private hook in `pm.js`, **a check declares what its
completion must carry** (`shared/check-forms.js`: the kind, the fields, and `missingForCheck`, which both the
form and the server call) **and the server files the record that spec implies** (`server/check-records.js`,
inside the completion's own transaction). Adding a program is one kind in the spec and one branch in the
filer; the completion handler, the Operator View and the Task Center do not change again. This is move (2)
of the order that matters — a record interface before a record table — applied where the audit pointed.

Decisions inside it:
- **The EMP record is one row per site × test, filed at sampling with the result pending.** The laboratory
  answers days later; a task held open for a week reads as overdue work, while a record reading "awaiting
  result" is the true state and is what the bell and the readiness review count. Limits are frozen onto
  the row when it is graded (the `atp_limit` rule). An action level raises one CAR, idempotent on the
  sample; an unreadable result is refused rather than filed pending.
- **The GMP walk-through checklist is DRAFTED, not transcribed, and every record says DRAFT-1** — there is
  no controlled form, and the five items are the plant's own words in the CAR response, nothing added.
  The same item not compliant on two consecutive walks raises the CAR; a single miss is a correction on
  the spot. The plant's wording in the response ("a repeated problem"), and the two-swab shape of D-036.
- **The list review's record IS the log of editions in use** — the latest review, derived on read. A
  second "editions" table would be the two-owners defect on day one.
- **Batch-complete skips these**, as it skips food-contact work: the record needs what only the person who
  did the check can say.
- **CARs go through one helper** (`server/capa-raise.js`); internal audits now use it too, so a CAR from a
  Zone 2 positive is byte-for-byte the record a CAR from an audit is.

**Found on the way: no quality-schedule task had been generated since 17 August.** a6882a8 added
`procedure_steps` to the generator's INSERT column list and not to its VALUES, so every run threw *8 values
for 9 columns* inside its transaction, rolled back, and logged one warning line. Tap water, the EMP swabs
seeded on 27 August and the monthly internal audit produced no task for three weeks — which is the
mechanism behind "testing had not been conducted as established" in the finding, wearing software
clothes. Fixed in this pass; the verify would have caught it on day one, which is the argument for a live
verify on every generator. On the next deploy each schedule raises one task (the generator's idempotence
and calendar advance are unchanged), not a backlog.

Verified: `verify:checkrecords`, 49 assertions live and in the browser (the refusals, the four rows from
two sites, ok/alert/action grading with one CAR, the corrective-action gate, the repeated-walk CAR, the
list review as editions in use, the readiness sections and the bell reading the rows, the Task Center form
holding Complete until a site is ticked).

## D-061 · 2026-09-09 · decided — A stability pull is a row from the day the study is filed

CAR 4990683-9 asks for pulls scheduled against the retention samples so a missed pull is visible, and for
each product's expiration date to be linked to its justification or study. Both are held here; neither is
the study, which is laboratory work over real time and is not shortened by software.

- **Every pull is pre-created when the study is filed** (`planPulls`, pure). A missed pull is therefore a
  row past its due date with nothing pulled — `pullState()` on read, never a stored flag — and nothing has
  to remember to raise it. The task for a pull is raised 14 days ahead by housekeeping, idempotent on the
  pull's own `work_order_id` (the annual-vendor-review shape), and completes through the check-record
  interface (D-060) with what was pulled and where it went. The result is entered on the study when the
  laboratory reports; a **fail raises one CAR** (a product on the shelf whose date may not hold).
- **A pull that cannot be taken is skipped with a reason**, cancelling its task, rather than left to read as
  missed forever — the difference between a record of a decision and a hole.
- **The basis in force for a SKU is the most recent justification naming it, derived on read.** The first
  cut superseded the whole earlier row when one SKU got a newer basis, which silently unsaid the basis for
  the rest of the family — caught by the verify. Nothing is edited or flagged; the rows are the history and
  `current_for` says which SKUs each still speaks for. (`superseded_at` exists on the table and is unused;
  left rather than migrated away.)
- **Coverage is derived from the catalogue** — active products with a study or a justification naming
  their SKU — so the count of "products whose expiration date rests on nothing recorded" is true the day a
  SKU is added. It sits on the Stability tab and in the readiness review.

Verified: `verify:stability`, 33 assertions live and in the browser.

## D-062 · 2026-09-09 · decided — One change register, and Quality signs twice

CAR 4990683-4 (21 CFR 111.130(e)) found change control covering equipment only. What existed was better
than that and narrower than the rule: `controlled.js` parks a deployed form or limit change until Document
Control approves it, and the DCR covers documents. The gap was everything else the rule names — process,
software, utility, physical plant — and the one thing neither flow enforced: Quality's approval on every
change, before it is made.

`change_requests` is that register. A change is raised by anyone (a change request comes from anywhere;
gating who may raise one only pushes changes back into email). It **cannot go to Quality until the impact
assessment is complete** — product safety, quality, validation/qualification, documents affected, training
affected, risk — because an approval against an empty assessment is a rubber stamp. **Quality approves with
a password signature** (the same `gateSignature` every QA signature uses), a change **cannot be marked
implemented before that approval**, and it **cannot close** without an effectiveness check and a second
signature. Those refusals are the control; the register would otherwise be a list.

**Parked controlled definitions stay in their own table and are listed on the register**, not copied into
it: `controlled_definitions` is what gates them, and a second row would be the two-owners defect on the
mechanism built to prevent it.

**A software release is recorded when the deployed commit first boots** (`recordRelease`, from
`RAILWAY_GIT_COMMIT_SHA`; nothing is recorded where there is no commit, because a made-up release id is a
fact nobody can check). A release with no change request against it is counted in the register, the
readiness review and the audit response. That is the honest half of software change control — the app can
prove what ran and when; whether a change was raised for it is the register's question. It is also the leg
of 4.4.39 that the validation package will cite.

**Found on the way:** a nav item carrying its own `visible(user)` predicate (Doc Control Review, Controlled
Changes, Log Builder) was shown in the sidebar by that predicate and resolved by the module map — so a
person without the grant saw the item and clicking it fell back to the first module they could see. One
loop now adds and removes such items from `effectiveModules` by the same predicate that shows them.

Verified: `verify:changes`, live and in the browser.

## D-063 · 2026-09-09 · decided — A lot is released against a complete specification, and the gate opens in warn mode

CAR 4990683-3 (21 CFR 111.70): specifications were not established before July 2026, and identity was
confirmed by a look, smell and taste. The history is C — no software fixes it. The forward half was the
same defect as the ungraded ATP reading: `coa.js` graded a result against a spec when one existed, and a lot
whose item had no specification at all went out as `pass` with nothing on the record saying so.

`shared/spec-coverage.js` is the one definition: five categories from the rule (identity, purity, strength,
composition, limits on contaminants), a test placed in a category by name from the plant's own test
vocabulary — a name nothing matches is recorded as unplaced, never guessed — and `releaseGate()` returning
the gaps a release would carry. `coa.js` applies it at **every door a lot leaves by**: the roll-up when the
last result lands, Mark Pass, a bulk pass, and signing the certificate. One door left ungated is the whole
gate sidestepped, which is the lesson of the ATP edit path.

**Three modes, and it ships in WARN, not ON.** In warn mode the release goes through and the record carries
the gaps it went out under (`release_gaps`, stamped at the moment of release, the `atp_limit` rule). The
specification program is catching up — the response dates the full set for 31 October and the release check
for 30 November — and enforcing on deploy would hold every lot in the plant to prove a point, which is how a
control gets switched off in its first week. The count of releases carrying gaps is the number Quality works
down; **the admin switches to enforcing from the strip once it reaches zero for the active items**, and the
switch is audited. `off` records nothing about coverage and reads red in the readiness review.

**Identity is confirmed by a result, not a specification.** An item can carry an FTIR specification and the
lot still has no identity result; the gate holds on the result, and an organoleptic pass is named as exactly
that ("identity confirmed by organoleptic test only"). The identity METHOD is Quality's decision (CAR item 2),
not the software's — the gate accepts any identity-category result.

What this does not do: write a specification. Coverage is computed from `coa_specifications`; approving the
missing ones is QA's work in the Specifications tab, and the strip lists the items still short so that work
has a punch list.

Verified: `verify:specgate`, 30 assertions live and in the browser, including all four doors refusing in
enforcing mode and the same lot releasing with no gaps once an identity result is filed.

## D-064 · 2026-09-09 · decided — Qualification is held as an attached protocol, and a form revision deploys parked

Two findings closed at the "hold it" level, on two existing mechanisms rather than two new ones.

**IQ/OQ/PQ (CAR 4990683-6, SOP 421 V2).** The qualification is engineering work the app cannot do. What it
can do is make "which machines are unqualified" a screen: three more steps on the equipment setup checklist,
each satisfied by an **executed protocol attached to the machine** under its own kind
(`equipment_files.kind` = iq / oq / pq). A file is a record; a tick is not. The steps are owed by
food-contact machines and by the instruments that measure — the SOP's criteria are Quality's to apply, so a
machine the SOP exempts is **waived with a reason and a name** (the existing waiver), and a machine outside
the rule can still carry its protocols. A protocol describes THIS installation of THIS model, so a changed
model number makes the step **stale**, not done — the same dependency edge as LOTO. One protocol attached to
a twin machine satisfies the twin, because attaching is the author saying it names both. Maintenance and
Quality both get the gap on the bell; the readiness review rolls it up per machine.

**FORM 204-01 V2 (CAR 4990682-3, NSF 306 §6.2.3.2).** One line on the receiving checklist gives the
"document execution" the requirement asks for, and the checklist is deliberately not user-editable — so the
line is a **code change that must not take effect by being deployed.** `controlled.js` already gates a
changed definition behind Document Control, but only for a definition it had seen before: a NEW definition
was recorded as its own baseline, silently, which would have issued V2 by deploying it. An entry may now
declare a **`baseline()`** — what the plant's approved document actually says — and on first sight the
engine records that as approved and parks the code as pending, raising the DCR. The receiving checklist is
the first such entry: V2 ships, **V1 is served**, and every checklist stamps the revision in force
(`CHECKLIST.revision`, never the constant). Document Control's approval in Controlled Changes puts the line
in force with no restart; a NO on it escalates to Quality on the spot and the sign-off waits for that.
The DCR draft for Daniela is `docs/v2/queued/dcr-form-204-01-v2.md`.

Rejected: making the receiving checklist user-editable so Document Control could "just add the line". An
editable checklist is a checklist whose questions nobody can prove; the whole value of the record is that
the app asked exactly what the approved form asks.

Verified: `verify:equipqual`, 28 assertions live and in the browser, including the fresh-database boot
parking V2 with V1 in force and a checklist started before approval keeping its V1 stamp.

## D-065 · 2026-09-10 · decided — ADP goes through API Central and Applicant Onboard V2

The onboarding hand-off was written against ADP's older event-style call and the Marketplace partner
route, which carries a weeks-long review. Signed in on developers.adp.com the plant is offered **API
Central** — the route for an ADP client reaching its own company's data — whose New Hire Onboarding
template exposes `POST /hcm/v2/applicant.onboard`. That is a different body (`applicantOnboarding` with
personal, worker and payroll profiles) and it **requires an onboarding template code that only RUN can
supply**, so the integration is not "on" with credentials alone: `adpConnected()` (four credentials) lets
the office read `…/applicant.onboard/meta` from Settings → Integrations, and `adpEnabled()` (plus
`ADP_ONBOARDING_TEMPLATE_CODE`) is what turns Submit to ADP on. A template code guessed here would be a
400 on the first real hire; read from RUN it is a fact.

The mapping is pure (`applicantOnboardPayload`, `check:adp`) and follows ADP's v2 guide as far as it could
be read from outside ADP's portal — the field names are the best available reading, not a tested contract.
The first live send is the test, against `/meta` and ADP's own refusal text, and the runbook says so. The
runbook artifact and `docs/adp-run-onboarding.md` are revised for API Central; the Marketplace steps are
gone.

## D-066 · 2026-09-11 · decided — the ADP payload is rebuilt from RUN's own guide, and six field names were wrong

D-065 said the field names were "the best available reading, not a tested contract", and that the first
live send would be the test. ADP publishes an **"Applicant Onboard V2 API Guide for RUN Powered by ADP"**
(45 pages, last modified 19 Apr 2026) whose Chapter 7 is a complete data dictionary for this exact payload.
Reading it turned six inferences into six defects, none of which had ever been sent, because there are
still no credentials. Every one would have been a 400 on the first real hire, discovered one field at a
time.

| ReadyDoc sent | RUN's guide says |
|---|---|
| `birthName` | `legalName` |
| `communication/mobiles/formattedNumber` | `dialNumber` |
| `legalAddress/subdivisionCode: "UT"` | an **object** carrying the code |
| `hourlyRateAmount/amountValue` | `amount` |
| `payFrequencyCode` | `payCycleCode` (Pay schedule) |
| `applicantWorkerProfile/jobTitle` | no such field in RUN |

Two more came off the same inference and are gone: a payroll group code RUN has no field for, and
`onboardingStatus`. **A full middle name is a 400** — RUN allows one letter — so it is cut to an initial.

**`ADP_ONBOARDING_TEMPLATE_CODE` IS NOT A RUN FIELD, AND IT WAS HOLDING THE DOOR SHUT.** D-065 made it the
thing that turns Submit to ADP on. It appears nowhere in the RUN guide's data dictionary, so `adpEnabled()`
gated the integration on a variable RUN never asks for and could never have been satisfied honestly. It is
now the four credentials and nothing else; the variable is still sent if deliberately set, in case `/meta`
says otherwise for this account.

**THE PRODUCT QUESTION IS SETTLED THE OTHER WAY.** A theory held for about an hour — that API Central's
Workforce-Now-flavoured guide meant RUN has no such API — was wrong. ADP's API Explorer filtered to RUN
lists Applicant Onboarding, both paths are confirmed verbatim, and the guide states the API "is supported
for the all RUN Powered by ADP bundles". What is still open is only **how a RUN client gets credentials**:
the guide says the two canonical scopes must be added to the **Consumer Application Registry** for the
subscription, and API Central refuses the RUN administrator's sign-in. That is a question for ADP.

**WHAT RUN REQUIRES AND READYDOC CANNOT SUPPLY IS NAMED, NEVER FILLED** — `missingForAdp()`, derived on
every read, refused at the submit endpoint with the list rather than sent for ADP to reject one field at a
time. Gender is required for an employee and the wizard has never asked. Worker type, pay type and the
work-location state are company-level codelist values and are env (`ADP_WORKER_TYPE_CODE`,
`ADP_PAY_TYPE_CODE`, `ADP_WORK_LOCATION_STATE`), because a fabricated pay type is a wrong payroll record
and worse than a refusal. Department and pay schedule are held as free text where RUN wants one of its own
codelist codes; the gap is reported rather than guessed at.

**`pay_frequency` conflates two facts** — it holds either a schedule (weekly, biweekly) or the word
"hourly", which is a pay TYPE. RUN's `payCycleCode` wants the schedule, so "hourly" is reported missing
rather than filed as a pay cycle nobody runs.

**The code object key is `codeValue`, on the API's own evidence.** The guide's dictionary writes the path
as `.../nameCode/code` while its codelist sample and every 400 message the live service generates say
`codeValue`. The error text is produced by the running service, so it wins; it is one helper, so a first
refusal proving otherwise is a one-line change.

**The old check passed 12/12 while asserting the opposite of most of this**, because it was written from
the same inference as the code — a test derived from the implementation only proves the implementation is
self-consistent. `check:adp` is 28 assertions now, each citing the guide, and the control was run: putting
`birthName` and `formattedNumber` back fails it immediately.

## D-067 · 2026-09-11 · recorded — ADP's answer: the API integration route is Workforce Now, not RUN

ADP replied to the access question. Verbatim: *"we have applicant tracking/integrated onboarding options with
our HR Pro plan. You may check this option instead of the integration. If you would prefer an integration
with outside onboarding system, we have this via WFN platform which provides true 360 degree data flow."*

So the front-line answer is that a client-built integration means **moving from RUN to Workforce Now**, and
the alternative offered is ADP's own onboarding on an **HR Pro** upgrade. Neither is the thing that was
asked for.

**THIS IS IN TENSION WITH ADP'S OWN PUBLISHED GUIDE AND THAT IS WORTH ONE PUSH BACK, NOT MORE.** The
*Applicant Onboard V2 API Guide for RUN Powered by ADP* says in Chapter 1 that the API "is supported for the
all RUN Powered by ADP bundles", their API Explorer lists Applicant Onboarding under RUN, and both endpoint
paths are published for RUN. A support reply and a product guide disagree; the guide is a document and the
reply may be a sales-shaped answer from someone who reads "integration" as "WFN". Ask once, citing the guide
and the two canonical scopes. If the answer holds, it holds.

**THE RECOMMENDATION IS TO DO NOTHING FURTHER**, and the reason is arithmetic rather than defeat. The plant
hires rarely. The packet is already complete, signed, bilingual and printable, and keying it into RUN takes
the office a few minutes per hire. Moving RUN → WFN is a payroll migration; HR Pro means the new hire fills
in ADP's wizard instead of ReadyDoc's, which duplicates what was built and loses the packet. Both cost more
than the keying they remove.

**NOTHING BUILT IS WASTED, AND THIS IS THE PART THAT MATTERS.** Onboarding works end to end today without
ADP: the wizard, the encrypted SSN and bank details, both signatures, the photographs, the packet PDF,
Section 2, and now EN/ES and the install hand-off. Only the last keystroke is manual. `server/adp.js` is
finished and correct against RUN's own data dictionary (D-066), gated off by four absent credentials and
degrading exactly like `quickbooks.js` and `storage.js` — so if access ever opens, or the plant moves to
WFN for its own reasons, it is four variables and a test hire rather than a build.

**Do not re-derive this from the guide.** The guide says RUN is supported; ADP's service desk says it is
not. That contradiction is the finding, and it is recorded here so the next reader does not spend another
afternoon proving the first half.

## D-068 · 2026-09-10 · decided — the ADP hand-off is PARKED, and the code stays switched off and finished

ADP's final answer, verbatim: *"Our Sales team advised that they are unable to assist with enabling or
provisioning this integration. At this time, if you would like to use the Applicant Onboard V2 API Guide for
RUN Powered by ADP, you will need to follow the process outlined in the guide. Upon review that is a 3rd
party product, you may select help center at the bottom of the page > then select get help."*

**Read together with D-066 and D-067, this resolves the contradiction rather than continuing it.** The API is
real and documented for RUN — that was never in doubt after the guide. What ADP is saying is that **RUN's
service desk cannot provision it**, and that the route is "the process outlined in the guide". That process
is one sentence in Chapter 2: the two canonical URIs *"need to be added in the Consumer Application Registry
(CAR) for the subscription"*. The CAR is ADP's **partner/ISV registration**, not a client setting. Calling it
"a 3rd party product" is the same statement from the other side: ADP expects the thing calling this API to
be a registered third-party application, and ReadyDoc would be registering as a partner in order to
integrate with itself.

So the original Marketplace route — removed at D-065 on the belief that API Central replaced it — was the
right shape all along for a *third party*, and API Central is for clients whose product line offers it.
That is why the administrator's sign-in was refused: not a broken session, not an entitlement somebody
forgot to tick.

**THE DECISION IS TO STOP, AND IT IS ARITHMETIC.** One more ticket at developers.adp.com's own Help Center
is cheap and worth sending, because it is a different desk from RUN's and it is the desk ADP named. After
that, the only remaining door is a partner registration with weeks of review, for an application only this
plant will ever use, to remove a few minutes of keying per hire from a plant that hires rarely. That is
disproportionate and nobody should spend it on this.

**NOTHING IS WASTED AND THE CODE IS NOT A STUB.** `server/adp.js` is finished and correct against RUN's own
data dictionary (D-066), `check:adp` holds it at 28 assertions, and it degrades exactly like
`quickbooks.js` and `storage.js` — four absent credentials and it is simply off. `missingForAdp()` already
names what RUN would refuse. If access ever opens, or the plant moves to Workforce Now for its own reasons,
this is four environment variables and one test hire, not a build.

**And the onboarding module never needed ADP to be worth having.** The wizard, the encrypted SSN and bank
details, both signatures, the photographs, the packet PDF, I-9 Section 2, EN/ES, the install hand-off and
the pay-roster seeding all work today. The office reads a finished packet and keys the last step. That is
the whole cost of ADP saying no.

**Do not re-open this on the strength of the guide alone.** The guide says RUN is supported; that is true
and it is not the blocker. The blocker is who is allowed to register an application. A future session that
finds Chapter 1 and gets excited should read this entry first.

## D-069 · 2026-09-10 · supersedes D-068 in part — API Central is a PRODUCT YOU BUY, and that is why sign-in failed

ADP's own Help Center page settles what four support replies could not. Under **ADP Clients** it offers two
cards, and the second reads: *"If you're an ADP client who purchased a North American product and are having
trouble implementing ADP APIs and **have not purchased ADP API Central**, visit ADP Customer Service &
Support."* Below both: *"Not already using ADP API Central as a North American ADP client? **Learn more**"*.

**ADP API Central is a paid add-on, not an entitlement somebody forgot to tick.** Powder Ops has not bought
it. That single fact explains every dead end in D-065 through D-068: the administrator's sign-in was refused
because there is no subscription behind it; RUN's service desk "cannot enable or provision" it because it is
sold, not switched on; and "a 3rd party product" meant API Central is a separate product from RUN, not that
ReadyDoc is an ISV.

**D-068'S CONCLUSION IS WRONG ON ITS MATERIAL POINT and is corrected here rather than edited.** It said the
only remaining door was an ADP Marketplace partner registration. There is a third, ordinary door: **buy API
Central.** The Consumer Application Registry step the guide describes is what API Central does on your
behalf once you have it — which is why the guide states it as a precondition without saying how a client
performs it.

**What is still unknown, and must not be guessed:** the price, and whether ADP sells API Central for a **RUN**
account at all. The doubt is not idle — the Quick Start Guide's own project dialog is subtitled *"for ADP
Workforce Now®"* and its last chapter is Workforce Now permissions. Both questions are answered by the
"Learn more" link and by ADP Customer Service & Support, which is the route that page names for a client in
exactly this position.

**This is now a purchase decision, not an access mystery, and that is a much better problem.** The thing
being bought removes a few minutes of keying per hire from a plant that hires rarely. If API Central is a
modest annual figure it may still be worth it for the other integrations it would open; if it is priced as
an enterprise add-on it is plainly not. Get the number, then decide — and the decision belongs to the plant,
not to this document.

**Nothing about the code changes.** `server/adp.js` remains finished, correct against RUN's own data
dictionary and switched off by four absent credentials. If API Central is purchased, it is four environment
variables and one test hire.

## D-070 · 2026-09-10 · the price, and why it does not pay for the onboarding hand-off alone

ADP's cart, seen 10 September: **ADP® API Central for ADP Workforce Now® and ADP…** — *Unlimited Users
(included) $0.00*, *Employees — Usage based — **$2.50 / employee / month***.

**THE CHARGE IS PER EMPLOYEE ON PAYROLL, NOT PER PERSON USING THE API.** "Unlimited Users" is the free line
and it is the one that looks like the meter; the meter is the headcount. Reading it the other way round —
"only one of us will use it, so it will be nearly nothing" — inverts the two, and it is the natural reading
of that panel. At the plant's rough headcount of 80 that is **~$200 a month, ~$2,400 a year**. `Due now
$0.00` is not "free", it is "nothing billed until employees are counted".

**Against that, what it buys for onboarding is a few minutes of keying per hire at a plant that hires
rarely.** Ten hires a year at ten minutes each is under two hours. Two hours a year does not cost $2,400,
so **the onboarding hand-off alone does not justify the subscription** and nobody should buy it on that
basis. It becomes a reasonable purchase only if other integrations are worth the money on their own —
worker sync, pay data, time — and that is a separate case somebody should make deliberately rather than
arrive at sideways.

**AND THE PRODUCT NAME STILL DOES NOT SAY RUN.** It is sold as *"for ADP Workforce Now® and ADP…"*. That is
the same doubt that has run through D-065 to D-069, now attached to a payment. **Get it in writing that this
subscription enables Applicant Onboard V2 for a RUN Powered by ADP account before any money moves** — the
cart also has an "Enter additional information required" step still outstanding, which is the natural place
to ask.

The recommendation is unchanged from D-068 and stands on arithmetic rather than on any difficulty with ADP:
onboarding is complete without this, the office keys the last step, and `server/adp.js` is finished and
switched off until there is a reason to turn it on.

## D-071 · 2026-09-10 · corrects D-070's headcount — and moves the case for API Central off onboarding

**35 on the ADP payroll, not 80.** D-070's figure came from the training log, which resolved 94 written
names to 80 real people across three years — that is everybody who has passed through, not who is on payroll
now. The correct arithmetic is **35 × $2.50 = $87.50 a month, ~$1,050 a year.**

That does not change D-070's conclusion about onboarding and it does change what the decision is about.
$1,050 is an ordinary line item rather than an obvious no, so the question stops being "is it too
expensive" and becomes **"what else does it turn off".**

**AND THE ONBOARDING HAND-OFF IS THE WEAKEST CASE FOR IT, NOT THE BEST ONE.** It saves a few minutes per
hire at a plant that hires rarely — under two hours a year. The strongest case is sitting one module away:
**Pay Data Input.** ADP's API Explorer lists it under RUN Powered by ADP, and Time Tracking already carries
the shape of the job it would remove — `time_adjustments.adp_status` moves *pending → In ADP* with
`adp_entered_by` stamped, and the Hours tab produces the per-period totals somebody then keys into RUN by
hand. That is **26 pay periods a year, forever**, not ten hires.

Nobody has costed that keying and it should be costed before this is decided, because it is the number the
subscription actually stands on. If reconciling and keying a period takes the office an hour, that is ~26
hours a year against ~$1,050 — a real argument. If it takes ten minutes, it is not.

**What does not change:** the RUN question. The product is still sold as *"for ADP Workforce Now® and
ADP…"*, and confirmation in writing that a RUN account gets these APIs must come before any money moves.
Buying it for Pay Data Input and discovering it only covers Workforce Now would be the worst outcome of the
three.

**Nothing here is a reason to build anything yet.** `server/adp.js` stays finished and switched off, and no
Pay Data Input work should start on the strength of a maybe.

## D-072 · 2026-09-10 · a revocation has to reach the sessions it already opened

**Context.** A sweep for the class of bug behind the pay-roster and time-adjustment fixes ("a fact that
exists in more than one place") turned up its cousin in access control: *an account switched off in one
table and still live in another.* The auth middleware refuses a deactivated account on the next request,
and that correctness hid three holes. Deactivating in Settings never deleted the session rows, so a
reactivated account came back signed in on every phone it had ever used. Revoking an auditor pass set
`revoked_at` on the pass and nothing else — `resolvePass` runs only on redeem — so for a visitor already
signed in the button did nothing. And a one-day pass minted the ordinary thirty-day session, which made
the `days` on the pass decorative past the first redeem. Sockets were checked at handshake only, and push
subscriptions survived deactivation.

**Decision.** One helper, `revokeSessions()` in `api/sessions.js`, owns "cut this account off": delete the
rows, drop the push subscriptions when the account itself is being switched off, disconnect the live
sockets (`disconnectUser`). Every door calls it — Settings deactivation, `end-access`, the auditor-pass
revoke, and the reactivation path a new pass takes. A self-service password change signs out every OTHER
device and keeps the one making the change. An auditor-pass session is capped at the pass's expiry
(`issueSession(..., { notAfter })`). `pushToUser` never pushes to a deactivated account.

**Why the helper and not five fixes.** These were five doors doing the same thing four different ways, and
the middleware's correctness meant none of the gaps produced a visible failure — exactly the shape that
lets a sixth door get it wrong too. `verify:sessions` (21) proves each door.

**Also from the sweep, fixed:** training supersede matched on the name only although `employee_user_id`
exists (a renamed person kept two "current" completions); the reimbursement people picker listed a renamed
person twice. **Found and NOT fixed here**, because each needs a schema migration and a backfill:
`work_orders.assigned_to` / `completed_by` carry no person id at all (Team Activity splits a renamed
operator into two people; a renamed operator's own screen stops showing their tasks; the delete guard in
`users.js` under-counts to zero), `certifications.person_name` and `first_aid_injuries.employee_name`
likewise, and `production_entries.submitted_by` drives the QA-correction banner by string equality. Those
are one project — add the id column beside the name, backfill by `personKey`, read the id first — and are
queued rather than half-done.

## D-073 · 2026-09-10 · AP Drop: one intake for every finance PDF, and a queue that is not the ledger

**Context.** The office's accounting rework (specified outside ReadyDoc) wanted one place any employee can
hand in a finance document — a vendor invoice forwarded to the wrong person, a credit memo, a remittance,
an M4 invoice pack — and one queue the Controller works it through, with `ap@powder-ops.com` as the
parallel front door. The AP/AR ledger may be slimmed or retired once this exists.

**Decision.** `ap_drops` + `ap_drop_events`, `server/api/ap-drop.js`, `server/ap-drop-parse.js` (pure),
`ApDropPanel.jsx`, its own nav entry `ap-drop` (not an Accounting tab, so it survives that hub going).
Three rules:

1. **The file is the record.** Stored and hashed first; the row exists before the reader runs; a parse
   that fails still leaves a row reading `failed`. The same bytes within 30 days files as
   `duplicate_suspect` linked to the first row — never silently dropped, because the second submitter's
   note is information.
2. **The parser suggests.** `ap-drop-parse.js` builds on `invoice-figures.js` and returns every value WITH
   the line it was read from; the reader fills BLANK fields only and never overwrites a typed one. A
   letterhead guess is offered only beside something financial, so a thank-you note cannot become a
   partial parse with a vendor on it.
3. **Nothing leaves ReadyDoc.** No QuickBooks bill, no email, no payment. `logAudit` writes
   `ap_drop` / `create` with `event: 'ap_drop.created'` in the details, which is what the Controller's
   tooling polls (`GET /api/audit?entity_type=ap_drop&action=create`); `qbo_bill_id` / `external_ref` are
   written back by hand or by that tooling.

**Access.** Mounted without `requireModuleWrite` (the QMS-filing arrangement) so dropping is open to
whoever is holding the invoice; the nav item is visible to anyone set up in Settings (a NULL map is still
an empty account, and an auditor never sees it). Working the queue — reading all of it, moving a row past
`new`, correcting fields, `not_finance` — is admin, the `ap-drop` **edit** grant (the finance flag), or an
office/admin supervisor, the reimbursements `canSettle` shape. Everyone else sees their own drops.

**Where the spec was adapted.** Money is `amount REAL`, not `amount_cents`, because every other money
column here is (`ap_invoices`, `partner_documents`, `reimbursements`) and a second convention is a
reconciliation bug waiting to happen. `parse_status` has a transient `pending` while a slow OCR finishes
after the upload has answered. The email door is a `source` value and nothing more — no ingestion is built.

Verified: `check:apdrop` (20, pure), `verify:apdrop` (45, live), `verify:apdropui` (18, real browser at
1280 and 360 — which is where the FileList-copied-too-late bug was caught: the picker looked like it worked
and the form said nothing was attached).

## D-074 · 2026-09-10 · the four name-keyed tables get an account id (closes D-072's open list)

**Context.** D-072 named four tables that identified a person by the name string alone —
`work_orders.assigned_to` / `completed_by`, `certifications.person_name`, `first_aid_injuries.employee_name`,
`production_entries.submitted_by` — so a rename in Settings split their history: Team Activity grew a phantom
colleague, the renamed operator's own screen stopped showing the tasks assigned under the old spelling, the
delete guard under-counted to zero, a re-seed filed a second certificate, and QA's correction request never
reached the renamed submitter.

**Decision.** Each carries an id column beside the name (`server/person-links.js`). The name stays — it is the
label and the historical record. Three mechanisms:

1. **SQLite triggers resolve the id from the name** on every insert, and again when the name changes and the
   caller did not set the id in the same statement. One place, so a write path added later cannot forget it (the
   FTS sync triggers are the precedent). **A name two accounts share resolves to NULL** — nothing is guessed, and
   the name still matches for that row.
2. **A one-time backfill** for rows that predate the columns, guarded in `app_settings.person_ids_linked`, exact
   case-insensitive and unambiguous only. It skips quietly while `app_settings` does not yet exist (fresh boot).
3. **Reads go id-first, name-fallback** (`personMatch`: `id = ? OR name = ?` — the name clause is what keeps a
   filter typed as the OLD name, a pre-column row and an ambiguous row all working), and **display the account's
   current name** with the stored one as `<col>_renamed_from` (`withCurrentNames`). Team Activity keys people on
   `personOf(r)` in `activity-metrics.js`, used by the table AND the drill-down, and the client narrows on the
   row's `key`, never its display name.

**The trap that cost a run:** `work_orders` is DROPPED and RENAMED further down `runMigrations` to widen its
CHECK constraints, and a rebuilt table loses its triggers. Installed at the certifications CREATE, the
work-order triggers were gone before the seeds wrote a row while the other three tables' triggers survived —
which is exactly the kind of partial success that reads as "working". The install is the LAST statement of
`runMigrations` now, and `verify:names` inserts through the API and asserts the id landed.

**Deliberately not touched:** the snapshot columns — `audit_log.actor`, every `performed_by` / `verified_by`,
signatures, LOTO. Those record who did a thing at the time and must not follow a rename; the verify asserts
`audit_log` gained no such column.

Verified: `verify:names` (29, live, in `verify:all`) — rename mid-test, then one Team Activity row under the
new name whose drill-down reconciles, the Operator View still listing her old-name tasks, the Task Center
filter finding them by either name, the delete guard still refusing, the certificate and the injury reading
under the new name with `renamed_from`, search by the new name reaching old-name rows, and the QA-correction
door opening for her and only her.
