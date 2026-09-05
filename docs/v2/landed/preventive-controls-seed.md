# Landed on `main` — seed the four preventive controls, and guard their limits

**Status: LANDED. On `main`, 5 September 2026.** The seeder call, the `api/haccp.js` edit guard and the
readiness drift line all shipped in one pass; `haccp_ccps` holds the four controls from first boot.
**Written 24 August · landed 5 September**

> **This file was written in `docs/v2/queued/` and moved here when it shipped.** `queued/` means work
> designed and deliberately NOT landed (D-018); leaving a landed item in it would make the directory
> mean two things, which is the defect this whole project is about. The design below is unchanged.
> **What is still open is the wording check against the PDF** — that is OBL-33 now, split out so the
> landed half is not marked done on the strength of the half that is not. See D-054.

Punch-list item 3 of `preventive-control-walk.md`. `haccp_ccps` holds zero rows, so the plan's four
preventive controls exist in the app in no form at all, and neither X-ray machine is linked to
anything. `audit-readiness.js` already reports that as a warning nobody has acted on.

---

## Why this is a transcription, not data entry

Earlier advice in this project was "QA can type these in today". **That was wrong by the plant's own
doctrine.** `scale-forms.js` tolerances are deliberately not editable in Settings because the number
*is* the compliance decision; PC #4's limit is `NFe 2mm Fe 2mm Stainless Steel 4mm Ceramic 2mm Glass
2mm`, which is five chances to mistype a critical limit into a text box with nothing checking it.

So the values come from the document, in code, the same way FORM 604-01 and FORM 403-01 already do.

## What is built — `server/preventive-controls.js`, on the Track B branch

New construction, so Track B's by D-005. 13 assertions pass; lints clean.

- `PREVENTIVE_CONTROLS` — the chart's four rows, verbatim, in the chart's own order.
- `seedPreventiveControls(db, { uuid })` — **insert-only, keyed on the CCP name**, and links PC #4 to
  both X-ray machines only where the machine has no CCP already. A row somebody edited by hand is a
  decision a redeploy must never undo.
- `ccpDrift(db)` — which stored rows no longer match the document, field by field, plus any control
  the database has never heard of.

Tested: seeds 4, links 2, leaves the conveyor alone, re-seed creates nothing and relinks nothing, a
hand-edited critical limit **survives a redeploy and is reported as drift naming both values**, and a
deleted control is reported as missing.

## What is NOT built

### 1. `server.js` — one call

```js
import { seedPreventiveControls } from './server/preventive-controls.js';
// …after the equipment seeds, so the X-ray machines exist to link to:
seedPreventiveControls(db, { uuid });
```

**Ordering matters and has bitten this codebase before.** Run it *after* equipment is seeded or the
link silently finds nothing on a fresh database — the same class of bug as
`tagQaInspectionRecords()` needing to run after the cleaning seeds. `missingEquipment` is returned
rather than swallowed so a fresh boot says so.

### 2. `server/api/haccp.js` — the edit guard

`haccp_ccps` is writable by admins, supervisors and QA (`canManageCcps`). Once these rows exist, a
critical limit can be changed in the app without a Document Change Request, which is exactly what
`scale-forms.js` refuses to allow.

The guard: `PUT /:id` refuses to change any field `preventive-controls.js` owns on a seeded row, and
says why — *"This limit comes from Protocol 003 V4. Changing it is a Document Change Request."* The
descriptive fields stay editable. Same shape as `products.js` 400ing on `NFP_OWNED`, and the same
doctrine as the disabled scale-revision field in the form register.

**Until that lands, `ccpDrift()` makes a divergence visible rather than preventing it** — the half
that can be built without touching live code. Worth surfacing in `audit-readiness.js`'s HACCP section
in the same pass.

### 3. `audit-readiness.js` — the HACCP section gets something to say

Today: *"0 CCPs defined."* After seeding it reads 4, and should also report drift, so the review keeps
answering the question rather than going quiet once rows exist.

---

## Before this lands: the wording needs checking against the PDF

Lowry, Daniela and Carol have agreed to do this. The transcription came from the PDF's text layer,
which splits table cells across columns. Three lines carry a `sourceNote` and are the ones to read
first:

1. **PC #4's monitoring line — check this one first.** The text layer renders it as *"Product passes
   through r- ray"*, which is the word *x-ray* split across a cell boundary. Transcribed as `x-ray`.
   The five limits also run together in the source with no separators: confirm each figure and its
   material.
2. **PC #3's frequency.** Transcribed as the chart states it — *at the beginning of every machine
   start up*. The Process Description says *beginning and end of each batch* and also asks for mesh
   size and screen condition. That disagreement is DCR item 1 and is Document Control's to rule on;
   this file follows the chart until it does.
3. **PC #2's step capitalisation** differs from PC #1 in the source (`rework` / `Rework`). Kept as
   written.

If any wording is wrong, fix it in `preventive-controls.js` — not in the database. `ccpDrift()` will
then name every row that needs re-seeding.

---

## Where these records actually are, as of 24 August 2026

**None of the seven Keychain-marked forms is producing anything.** Production runs on the old manual
paper process, logged in MRPEasy. So all four preventive controls' records are on **paper** today, and
`recordToday` on each control says so.

That is a legitimate answer to the record leg — paper is a record — and it is *not* what the form
registry appears to say. See D-021.
