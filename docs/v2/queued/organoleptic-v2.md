# FORM 602-01 V2 — the organoleptic test becomes a check against a specification

**2 September 2026 · design, decisions and the complete dependency map. Nothing built yet.**

## What the form says

FORM 602-01 V2 (the plant's own document, read from the PDF):

```
ATTRIBUTE   |  SPECIFICATION  |  RESULT  |  CIRCLE P/F
APPEARANCE  |                 |          |    P / F
ODOR        |                 |          |    P / F
TASTE       |                 |          |    P / F
COLOR       |                 |          |    P / F
TEXTURE     |                 |          |    P / F
PERFORMED BY / DATE · VERIFIED BY / DATE
```

**There is no 1–5 anywhere.** The app follows the form.

| V1 (built today) | V2 (the form) |
|---|---|
| appearance 1–5 | APPEARANCE — same |
| texture 1–5 | TEXTURE — same |
| aroma 1–5 | **ODOR** — renamed |
| flavor 1–5 | **TASTE** — renamed |
| overall 1–5 | **dropped** |
| — | **COLOR** — new |

The renames get **new keys**; `aroma` and `flavor` hold data on every filed record and are retired, not
reused. Reusing `flavor` for `taste` would relabel history as answers to a question nobody asked.

## Decision 1 — P/F against a written spec, not 1–5

The plant offered to change the form to a 1–5 instead. Recommendation: **keep P/F, and here is why.**

- A 1–5 with no spec is an opinion. A 1–5 *with* a spec is redundant — if it matches, it passes; what is a 3?
- A 1–5 needs calibration between graders (one person's 4 against another's), which needs reference
  samples, which do not exist.
- P/F against a written spec is what an auditor can audit. *"Does it match 'light tan, free-flowing, no
  clumps'?"* is checkable. *"Is it a 4?"* is not.
- P/F is what releases product. A FAIL already raises the draft disposal.
- The existing 1–5 has never been graded against anything. It is the ATP reading, captured and never graded.

Where a scale genuinely helps is trending — and you cannot trend an uncalibrated opinion; trending needs
the spec first anyway.

**The simple version of the form:** each attribute row shows the product's spec in plain words and two
buttons — **Matches** / **Doesn't match** — with a "what you saw" note required only on a fail. Five taps
for a pass.

## Decision 2 — the spec belongs to the product, and the first test writes it

Agreed: the specification is per product, written once, rendered read-only, and **the record stores the
spec text it was graded against** (the `sanitation_records.atp_limit` rule — the limit travels with the
record, so a record graded under one spec goes on saying that spec after the spec moves).

**No per-product organoleptic spec exists today for finished goods.** So there is no separate authoring
project. **The first test of a product with no spec writes the draft spec.** When QA tests a product with
nothing on file, the form asks *"describe what a good one looks like"* per attribute; that becomes the
product's DRAFT spec; a QA lead approves it (a deliberate act, with a name and a date); it is then locked
and read-only on every later test.

- Top SKUs get specs first because top SKUs get tested first. No cutover — it is per product.
- A product with no approved spec still tests; its test drafts the spec. A product with an approved spec
  grades against it.
- Draft-until-approved is the guard against the first batch being a bad one — `spec-seed.js` files COA
  specs as drafts for the same reason, and `controlled.js` records a first sight as the baseline.
- **The V2 shape already exists in this codebase for raw materials:** `server/data/form-607-specs.json`
  holds specs keyed Appearance / Odor / Taste / Color / Texture with a spec string each, and
  `COAPanel.jsx:64-74` renders a similar block. That is the precedent to build on — and the two organoleptic
  vocabularies should be reconciled deliberately rather than left to diverge.

So the answer to *"build the place they live, get QA filling it for the top SKUs, switch over when
ready"* is **yes, minus the middle step** — the place is a `product_sensory_specs` table, and it gets
filled by testing, not by a spreadsheet.

## Decision 3 — the Flavor Approval form

It is a **different act**: someone decides whether a batch is acceptable, often remotely by text. It is
not a spec conformance check. But `syncFlavorOrganoleptic` files the organoleptic record *from* it, and
that only works if the two forms carry the same shape — the note in CLAUDE.md says so in as many words:
*"the FA carries the same sensory keys and 1–5 scale as the ORG form, so the linked record is a copy
rather than a mapping."*

Recommendation:
- The FA keeps its own decision (approve / deny) and **adopts the same five attributes with P/F against the
  product's spec** for the QA scoring step, so the sync stays a copy.
- For a **new flavour** with no spec, the QA scoring step drafts it, and the approval decision approves it
  in effect — approving the flavour approves what it should look and taste like.
- The texted approval page shows the five P/F results plus the batch adjustment instead of pips. The
  approver decides. **"Overall" goes** — it was always the approver's job, not QA's.
- If the FA is left at 1–5 while 602-01 moves, `syncFlavorOrganoleptic` must **file nothing** — the same
  refusal it already makes when scores are missing — rather than invent a spec.

This is Document Control's call on a second controlled document; it is raised here, not decided here.

## The trap that will fire on deploy

`server/controlled.js:53` snapshots only `{fields, logColumns, formCode}`. On the deploy that introduces
V2, **both** `organoleptic` and `flavor_approval` park as pending and the app keeps serving the V1 field
list — **while `passFail`, `shared/sensory.js`, both sync functions and every client component switch to
V2 immediately.** Half the app grades V2 and the form still shows V1 dropdowns. That is the worst possible
half-migration and it happens by default.

Plan for it: the shape change ships behind Document Control's approval as a unit, or `passFail` and the
sensory shape join the controlled snapshot so they park together.

## The complete dependency map — every place the V1 shape lives

`shared/sensory.js` is the one definition, imported by exactly three files (`api/qms.js:19`,
`FlavorPanel.jsx:5`, `ApprovePage.jsx:3`). **Eight second copies** do not import it and will drift:

| # | Where | What | Breaks if left |
|---|---|---|---|
| 1 | `server/api/submit.js:217-221` | The five keys typed out by hand for the public approval page's data | **Fails to five nulls, not an error.** `ApprovePage` then renders no QA panel (`if (!s.overall) return null`) and the approver decides on a blank. The door the plant actually uses. |
| 2 | `server/qms-config.js:401` | `passFail.fields` — fourth copy of the keys, and **not in the controlled snapshot** | Flips to V2 on deploy while `fields` stays parked at V1 |
| 3 | `server/qms-config.js:390-394, 513-517` | ORG and FA field lists — two independent copies of keys and `['1'..'5']` | Nothing ties them to each other or to `SENSORY_KEYS` |
| 4 | `QMSRecordsPanel.jsx:73-78` + `api/qms.js:651-653` + `api/qms.js:1350-1353` | **Three implementations** of the pass/fail threshold math | Result badge, red-row flagging, the Result filter, the PDF result line and the auto-disposal all go dark for V2 records — silently |
| 5 | `FlavorPanel.jsx:191` | A local `complete = SENSORY.every(...)` beside the imported `sensoryComplete` | Agree today only because both walk the same array |
| 6 | `api/qms.js:420, 455, 750` | Three user-facing strings enumerating the five V1 attribute names | QA is told to score fields that no longer exist |
| 7 | `COAPanel.jsx:64-69` | `ORGANOLEPTIC_ATTRIBUTES` (Appearance/Color/Odor/Flavor + spec) — a *separate* organoleptic vocabulary | Two shapes in one app unless reconciled |
| 8 | `shared/form-registry.js:197` + `form-registry-seed.js:29` | Revision `V1`, seeded insert-only | Bumping the code does **not** update an existing database; the register says V1 forever unless Document Control edits it |

Everything else that must move with the form:

**Server** — `sensoryComplete` (a full V2 record reads *incomplete* → approvals become unsendable and the
sync files nothing) · `POST /qms/flavor_approval/:id/sensory` (400s a V2 payload) · `syncFlavorOrganoleptic`
(copies keys the ORG form no longer has; the idempotent merge preserves stale V1 keys forever) ·
`syncOrganolepticDisposal` (`parseInt` on "PASS" → a FAIL raises **no disposal**) · `notifySensoryNeeded`
(re-nags QA forever) · the PDF (`Result:` line prints nothing; field loop prints `(1–5)` labels) · the CSV
importer (V2 columns import as blank, no error) · `qms-seed.js:6` DCR log row ends at V1 · `forms.js:98`
compares form *code*, not revision, so V1/V2 mismatch is undetected.

**Client** — `ApprovePage.jsx:20-58` pips + `n/5` numeral · `FlavorPanel.jsx:176-255` five-button
scoring modal, placeholder naming "aroma", the `rowAction` gate (*Text for approval* never appears again) ·
`QMSRecordsPanel` result badge/filter/sort/red-row · `DisposalsPanel.jsx:264` "auto-created from an
organoleptic FAIL" banner · `PageInfo.jsx:107-111` help text · `FormChip` displays V1 until the registry moves.

**Docs and tests** — `CLAUDE.md:988-1046` two sections describing the 1–5 and the copy-not-mapping claim
· `src/data/processFlows.js:39-48` the **Auditor View process map** says "1–5 scale" and "below 3 raises a
disposal" — shown to auditors · `docs/v2/queued/audit-nc-triage.md:178` · `docs/SQF-NSF-gap-analysis.md:191`
· **no script anywhere asserts the sensory shape** — 47 check/verify scripts, none reference it. Nothing
will fail loudly on a partial migration. Add one before starting.

## Order of work

1. `product_sensory_specs` — draft/approved, who/when, the five attributes, spec text. Insert-only per
   product; approve once; locked after.
2. A check script that asserts the sensory shape end to end, written **against V1 first** so it fails
   when V2 lands half-way.
3. `shared/sensory.js` → V2, with V1 keys kept as legacy for rendering filed records.
4. Collapse the eight second copies onto the import.
5. The form, the FA scoring step, the approval page, the syncs, the PDF, the process map, the registry
   revision — in one pass, gated by `controlled.js`.
6. The DCR for 602-01 V2 (and the FA form, if Document Control agrees) — the app change is parked until
   it is approved.
