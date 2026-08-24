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
