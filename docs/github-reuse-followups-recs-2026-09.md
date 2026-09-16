# GitHub reuse follow-ups — read-for-ideas recommendations, September 2026

Read-only sitting. **Nothing in `Powder-Ops-FSQA` or `Artwork-Proofing` was changed to produce this
document** beyond this file itself — `Artwork-Proofing`'s `proof_engine.py` and `readydoc.py` were cloned
and read directly (public repo, read-only clone) to ground section 2 in the actual pipeline rather than in
assumption; no code there was touched, and any Artwork-Proofing work below is explicitly for a later
Artwork-Proofing sitting.

---

## 1. Atlas CMMS / OpenMES mobile work-order UX vs. Operator View / `missingStepTicks` / Task Center

### ⚠️ License warning — read first
`grashjs/cmms` ("Atlas CMMS") is **AGPL-3.0, dual-licensed with a paid commercial tier**; `Mes-Open/OpenMes`
is **AGPL-3.0 core + AFL-3.0 modules**. Neither may be forked, embedded, vendored, or run as a network
service alongside ReadyDoc. Everything below is a description of an interaction *pattern*, in prose — no
code, template, or asset from either repository is copied or referenced by path.

### Pattern observed
Both products build their mobile work-order screen around the same shape: a checklist with a live
**progress count** ("3 of 5 done"), a **Complete** action that stays disabled until every item is answered,
and a distinct **overdue** bucket that reads differently from "in progress." OpenMES additionally frames
itself as "tablet-first… deploy on an old office PC" — a stated performance discipline for exactly the
hardware a plant floor actually has, not a desk workstation.

### How ReadyDoc differs
- `missingStepTicks()` already enforces "ticked before complete," but **narrower and more deliberate** than
  a blanket CMMS rule: it applies only to food-contact work (`equipment.is_food_contact`), a task with no
  procedure steps stays completable, and headings ending in `:` are never counted as steps. This is a
  considered scope decision, not an oversight — a rule that gates everything becomes the floor-wide blocker
  CLAUDE.md's own history explicitly warns against.
- ReadyDoc draws a distinction neither product's public description mentions: **"not recorded" is not
  "not done."** `stepsRecorded` renders an empty `step_results` as "what this task called for" (plain
  bullets, no false zero), rather than a checklist that reads as though the technician skipped everything.
  This is a real advantage over the generic pattern, not a gap to close.
- Task Center's colored group/frequency chips are filters on one list, not navigation between screens —
  already deliberately kept **out** of the `ModuleTabs` consolidation for exactly that reason. Not a
  density problem; a considered choice already made.

### Concrete next steps (non-AGPL, buildable without touching either repo)
| Priority | Idea |
|---|---|
| P0 | Render a visible "N of M ticked" progress affordance directly on the Operator View's in-progress task card (not only computed server-side and shown elsewhere) — the completion-count-on-the-card idiom both reference products share, and a small, presentational, no-schema addition. |
| P1 | Check whether `stepsRecorded`'s "not recorded vs. not done" distinction is visible on the Operator View's *own* card while a task is being worked, not only on the QA-facing `WorkDone`/`ClearanceCard` account after the fact — worth a targeted read of `OperatorView.jsx`'s in-progress rendering, not a redesign. |
| P1 | Borrow OpenMES's stated performance target ("runs on an old office PC / tablet") as a **benchmark to test against**, not a feature to build: run the Operator View on a genuinely low-end Android tablet and confirm it holds up, since that is the actual environment referenced. |
| P2 | OpenMES's "walk the operator through one step at a time" pattern (vs. a flat step list) is worth a UX note for a future Operator View sitting — flagged here, not attempted now; it would be a real interaction change, not a presentational one. |

---

## 2. Robotoff / Open Food Facts detect-then-OCR vs. `proof_engine.py`'s locate → crop → vision

### ⚠️ License warning — read first
`openfoodfacts/robotoff` and `openfoodfacts/off-nutrition-table-extractor` are both **AGPL-3.0**; the
extractor is additionally **archived and frozen since 26 May 2023**. Neither may be imported, called, or
embedded as a dependency or network service. Everything below describes a **sequencing idea** — locate
before you read — implementable with what `proof_engine.py` already has (Tesseract's own output, or a
second Claude Vision call), not a line of code or a model weight taken from either repository.

### Pattern observed
Both the archived extractor and its successor Robotoff run **two separate stages**: first, a dedicated
model *localizes* the nutrition panel's region on the page (an SSD detector in the archived version;
LayoutLMv3 framed as token classification over the page's own OCR tokens in the current one) — with nothing
read yet, just a bounding box and a confidence score. Only then is that region **cropped**, and OCR/value
extraction runs on the small crop, not the whole page.

### How Artwork-Proofing differs — read directly from `proof_engine.py`
**There is no localization stage today.** The pipeline is genuinely single-stage: Tesseract OCRs the whole
page first (cheap), and `_ocr_needs_vision()` decides whether to escalate based on an **anchor-word and
regex heuristic** on that OCR text — counting hits on words like `calorie`, `protein`, `serving size`, and
checking for value-shaped patterns like `calories?\s+\d{2,3}\b`. If the read looks incomplete,
`_claude_vision_ocr()` sends the **entire label image**, explicitly capped at "~1.1MP (the vision API's...)"
per the code's own comment, to Claude Sonnet in **one call** that returns everything at once — raw text,
front-callout badges, NFP values, allergens, the eyemark, and panel dimensions — as one structured JSON
response. No bounding box or crop happens anywhere in that path.

This means on a large-format sheet (a full pouch die-line, a long stick-pack repeat) where the actual
Nutrition Facts panel is a small fraction of the page, the panel's own digits get only a small fraction of
that fixed ~1.1MP budget — the opposite of what a locate-then-crop pipeline buys you, which is spending the
same pixel/token budget entirely on the region that matters. `fill_weight_g` (ReadyDoc's D-093 field, fed in
as `fill_weight_g` and reconciled in `_check_net_weight`) sits downstream of all of this and is correctly
untouched by anything below — it's already designed right; the question here is only about what feeds
`panel` before that comparison runs.

### Concrete next steps (non-AGPL, buildable with tools the pipeline already has)
| Priority | Idea |
|---|---|
| P0 | Ask Tesseract for **word-level bounding boxes** (`pytesseract.image_to_data`, if not already how the current OCR pass is called) on the first pass, find roughly where the anchor words that *did* read landed, and crop a generous margin around that region **before** the Claude Vision call — instead of sending the full page. This is Robotoff's two-stage *sequencing* (locate cheaply, then read the crop at effectively higher resolution for the same pixel budget), built from a tool `proof_engine.py` already calls, with zero new dependencies. |
| P1 | Where even the anchor-word locate fails (the no-anchors "outlined / mirror-printed" case `_ocr_lacks_nutrition` already names), consider a cheap first Claude Vision call that asks only for the panel's approximate bounding box, then a second call on the crop — measure this against the current one-shot cost and accuracy before committing to it; flagged P1 specifically because it needs a real before/after comparison, not an assumption that two smaller calls beat one big one. |
| P1 | Widen `_ocr_needs_vision`'s anchor-word/regex vocabulary the same disciplined way `TOTAL_LABELS` was widened in this sitting's Part A — a documented, tested word list rather than an inline regex a future edit can silently narrow without anyone noticing the escalation rate changed. |
| P2 | Robotoff's LayoutLMv3-as-token-classifier framing (classify each of the page's own OCR tokens as "belongs to the nutrition panel" or not, rather than counting anchor words) is a genuinely different technique and could, in principle, be trained later on Powder Ops's own label corpus specifically. Flagged as a larger, separate research item for a future Artwork-Proofing sitting — not attempted here, and not a reason to touch `proof_engine.py` in this one. |

---

## Non-goals of this document
- No code changed in `Artwork-Proofing`.
- No AGPL dependency added, referenced by import, or vendored anywhere.
- No claim that Robotoff, Atlas CMMS, or OpenMES were run, tested, or benchmarked against ReadyDoc/Artwork —
  every comparison above is read from each project's own public documentation and, for section 2, from
  `proof_engine.py`/`readydoc.py`'s actual current source.
