# Queued for `main` — grade the ATP reading against PC #1's 35 RLU

**Status: designed and half-built · not deployed · 24 August 2026**

Punch-list item 2 of `preventive-control-walk.md`, and the pilot for architecture move 03 (limits out
of code and into documents). Scope decision, 24 Aug: **do the record and the limit now; the per-run
trigger leg waits** for move 05.

---

## Why this one first

Protocol 003 V4 states PC #1 as a number — *no more than 35 RLU* — and that number lives in exactly
one place in the whole system: the plain text of a PDF. `sanitation_records.atp_reading` is captured,
rendered on the log, shown in the Operator View in both languages, and exported to the Auditor View.
**Nothing compares it to anything.** A 60 RLU reading files with `result = 'pass'` and no mechanism
objects.

It is the ideal pilot for move 03 because *the limit is already owned by an approved document
revision*. Nothing has to be moved out of code — it was never in code.

---

## What is built, and where it lives

**`server/atp-limits.js` — done, on the Track B branch.** New construction, so it is Track B's by
D-005. Exports `ATP_LIMIT`, `atpSource()`, `gradeAtp()`, `applyGrade()` and `atpControlledEntry()`.
16 assertions pass. Four rules are written into the file itself and are the load-bearing part:

1. **Not user-editable.** Registered with `controlled.js` so a change to the deployed number is parked
   until Document Control approves it — the same gate a scale tolerance passes through.
2. **The grade can FAIL a record, never PASS one.** A scale verification is wholly defined by its three
   readings, so `gradeReadings()` decides the result outright. A clean is not: it can fail visual
   inspection while its swab reads 12 RLU. So over-limit forces `fail`, and in-limit leaves the filer's
   own answer alone. A cleaner who swabbed 12 and still marked `reclean` because the guard was cracked
   is telling the truth, and a grader that overruled them would file a false record.
3. **A missing reading is a gap, not a failure.** Blank grades to `null` and changes nothing — the same
   rule `env-limits.js` applies to an unparseable temperature. Most cleans in the log carry no reading
   at all, and back-dating a failure onto them would be inventing history.
4. **The limit travels with the record.** A record graded against 35 goes on saying 35 after Document
   Control issues 30 — the rule receiving checklists and scale verifications already follow.

---

## What is NOT built, and why

Everything below touches live shared code, which **D-005 puts on Track A, on `main`, in one pass**.
Written out exactly rather than half-applied, so it can be reviewed now and landed in one go.

### 1. `server/db.js` — one column

```js
addColumnIfMissing('sanitation_records', 'atp_limit', 'REAL');
```

Placed **immediately after the `sanitation_records` CREATE**, per the migration-ordering rule — an
`ALTER TABLE` before its table exists throws, and only a fresh DB shows it.

Nothing back-fills it. A record filed before the limit was enforced was graded against nothing, and
writing 35 onto it retroactively would claim a check that never happened.

### 2. `server/controlled.js` — one line in `registry()`

```js
import { atpControlledEntry } from './atp-limits.js';
// …
export function registry() {
  return [...qmsEntries(), ...scaleEntries(), atpControlledEntry()];
}
```

**Expect the first boot after this to record a baseline silently, not park a change** — that is
`syncDefinitions`' never-seen-before branch, and it is the single most important rule in that file.

### 3. `server/api/sanitation.js` — the write paths

Both `POST /sanitation` and `PUT /sanitation/:id` destructure `atp_reading` already. After that, and
before the INSERT/UPDATE:

```js
const grade = gradeAtp(atp_reading);
const decided = applyGrade(result, grade);
// …store decided.result and grade?.limit ?? null
```

`decided.reason` goes on the response so the filer is told *why* their pass became a fail, naming the
document — the platform's own rule that every refusal explains itself and names the way forward
(O5). It must **not** be a 400: the record is honest and should be stored, it is the *result* that the
limit decides.

**The QA Review sign path needs no change.** It calls `verifySanitationRecord`, which touches the
verification columns and not the result — so a queue signature stays byte-for-byte the module's own.

### 4. `src/components/compliance/SanitationPanel.jsx` + `OperatorView.jsx` — live feedback

The ATP input shows in-limit / over-limit as it is typed, the way `ScaleKiosk` does. Over-limit says
the corrective action the plan states — *re-clean line* — because a refusal that does not name the
next step is an obstacle. Operator strings go in `i18n/operatorStrings.js` in **both** languages; a
safety limit shown only in English is a limit half the shift cannot read.

### 5. `shared/form-registry.js` — nothing

Deliberately. FORM 111-01 is `where: keychain` and that is correct (D-013). This change gives the
ReadyDoc cleaning record a graded limit; it does not move a form number.

---

## The follow-up this does not do

**`production_entries.cleaning_events[].atp_swab` is a boolean recording the same fact** — swab
yes/no, no number. It is the second home for one fact, and until it is collapsed the plant still has
two answers to "was this line clean". The fix is to add `atp_reading` to the cleaning event and derive
the boolean from it, which is a change to `api/production.js`, the Batching entry form and the day log
— a wider diff than this one, in a screen Bernardo uses every shift.

Doing it in the same pass is defensible; doing it *first* is not. Queued as its own item so the small
change can land while the plant is asked about the bigger one.

---

## How to verify before landing

- Boot a **fresh** DB (`DB_PATH=` a new path) — the production volume will not show a migration
  ordering fault.
- File a clean with `atp_reading = 60` and `result = 'pass'`; it must store `fail`, `atp_limit = 35`,
  and return the reason naming Protocol 003 V4.
- File one at exactly 35 — passes.
- File one with no reading — stores exactly what the filer chose, `atp_limit` null.
- File one at 12 marked `reclean` — stays `reclean`.
- Change `ATP_LIMIT.max` in the source and reboot: the change must be **parked**, and the app must go
  on grading against the approved 35 until Document Control approves it. That is the test that proves
  the limit is owned by a document rather than by a deploy.
