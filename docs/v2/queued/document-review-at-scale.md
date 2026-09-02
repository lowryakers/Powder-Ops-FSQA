# Red-lining the rest of the registry — how to do ~100 documents without doing 100 red-lines

**Method note · 27 August 2026 · answers "do we now do this for every SOP and WI?"**

Yes — but **not the same way**, and the arithmetic says why.

Two documents produced **68 findings**. At that rate ~100 documents produce something like 3,400, which
is not a review anybody finishes. Worse, it would bury the twenty findings that actually matter under
three thousand that do not. The plan-level red-line was the right instrument for two hub documents and
is the wrong one for a registry.

**Three changes make it tractable.**

---

## 1. Split the 68 findings by who should find them

Sort the plan red-line by *what kind of thing noticed it*, and a pattern appears:

| Class | Examples from the 68 | Who should find it at scale |
|---|---|---|
| **Mechanical** | "Peices", "intended used", "a escort", subject/verb, missing hyphen, "05/202025", "Page 10 of 9", two sections lettered D, numbering that jumps 3→6 | **A script, over every document at once** |
| **Structural** | Blank signature block on an approved document · registry revision disagreeing with the document's own footer · retention "for a specified period" never specified · no citation of any regulation · no document cited by number | **A script**, as a rule per document type |
| **Judgement** | The Rework row describing a metal detector the plant does not have · the ATP limit stated in a unit only its verification produces · the internal audit named as verification of a plan it does not cover | **A person who knows the plant** |

**Roughly fifty of the sixty-eight are the first two rows.** They are findable by rule, and a rule that
runs over the whole registry costs the same for 100 documents as for 2.

Only the third row needs the slow read — and it is the row that produced every finding an auditor would
actually have raised.

## 2. Extend the report that already exists, rather than writing a new one

`server/doc-consistency.js` is already this instrument for four rules: duplicate document numbers, one
title on two numbers, references to documents not in the registry, and empty shells. It is read-only,
derived, and reports what was *observed* rather than what to do — the right doctrine.

**The rules worth adding, each one generalised from a finding in the plan red-line:**

- **Approved but unsigned** — an `active` document whose body contains an unfilled signature line.
- **Revision disagreement** — `sop_documents.revision` against the revision written in the document's
  own body or footer. *(This caught FDP-04: the registry says 1.0, the document says V2.)*
- **No effective date** on an active document. *(Already in `audit-readiness.js`; belongs here too.)*
- **Cites nothing** — a document of a type that should reference others and references none by number.
  *(This is the finding that stopped the hub-and-spoke build: D-027.)*
- **Unspecified retention** — the phrase "specified period", "as required", "as applicable" with no
  value. *(FDP-06.)*
- **Section and page arithmetic** — repeated section letters, numbering that skips, a page number
  beyond the page count. *(FDP-01, 02, 03.)*
- **Spelling**, against a dictionary plus a plant vocabulary list, so *cGMP*, *ATP*, *RLU*, *NFe* and
  the plant's own terms are not flagged forever.

**The output is a queue, not a document.** Each hit is a row somebody accepts or dismisses with a
reason — the same shape as the form-registry coverage report and its `form_gap_dismissals`, so a
deliberate exception is recorded once rather than re-reported every run.

## 3. Reserve the slow read for documents that carry a control — and the audit just named the first four

A full red-line is worth its cost on a document that **states a limit, defines a control, or has been
touched by a nonconformance**. That is not a hundred documents; it is closer to a dozen.

**Start with the four SOPs the auditor read and found wanting.** They are named in the nonconformance
reports, with their revisions and effective dates, which means an auditor has already compared each one
to practice:

| Document | Named in | What the auditor found |
|---|---|---|
| **SOP 404** — Supplier and Laboratory Qualification, V4, 8/4/26 | 455-2 · 4.3.1 | The questionnaire it requires was not available for three named suppliers |
| **SOP 421** — Design/Qualification of Facility/Equipment (IQ, OQ, PQ), V2, 8/11/26 | 455-2 · 4.5.8 | The IQ/OQ/PQ it requires were not provided for any equipment |
| **SOP 434** — Chemical, Equipment and Services Approval, V2, 6/25/26 | 455-2 · 4.3.9 | Covers equipment changes only; process, software, utility and physical-plant changes are not covered |
| **SOP 604** — Environmental Monitoring Program, V2, 6/29/26 | 455-2 · 4.5.84 | Surface testing was not conducted as the SOP establishes |

**Every one of these is a document whose requirements outran the plant's ability to meet them**, which
is a specific and useful thing to red-line for: not "is the wording right" but *"does this SOP ask for
something that has no program, no form and no record behind it?"* — the D-002 test, applied one SOP at
a time.

That is a better second project than "all the SOPs", and it is directly tied to corrective actions that
are already due.

## The order

1. **The two plans** — in flight. `plan-redline.md`.
2. **The four SOPs the auditor named** — the D-002 test applied to each. Small, urgent, tied to CAPAs.
3. **The mechanical sweep over the whole registry** — build the rules into `doc-consistency.js`, work
   the queue. Runs in the background from then on, and never has to be repeated as a project.
4. **The remaining control-bearing documents**, worked as they come up for review rather than as a
   campaign — the review-due cadence already schedules them.
5. **Everything else: never, as a project.** A JD with a typo is not worth a red-line. It is worth being
   in the mechanical sweep.

## What makes this repeatable

The red-line format itself is the reusable part, and three things in it are what made it usable:

- **Three severities, applied strictly.** MUST is *wrong as a matter of fact*; SHOULD is *undermines the
  document*; CONSIDER is *a judgement call the owner may decline*. If everything is a MUST nobody
  triages.
- **Numbered findings.** Accepted, rejected and deferred one at a time — a document-wide "approve all"
  is how a bad suggestion gets adopted.
- **`[verify in source]`.** A PDF text layer mangles tables, and a review that cries wolf about
  extraction artefacts is one nobody finishes. Separating *"the document is wrong"* from *"the
  extraction may be wrong"* is what keeps the reader trusting the other sixty findings.
