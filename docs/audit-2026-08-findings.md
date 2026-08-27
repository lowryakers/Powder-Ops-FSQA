# NSF audits, 24–26 August 2026 — findings and where each one gets fixed

Two audits, one visit (4163051), auditor Sonya Hess. Both preliminary reports are marked DRAFT and
pending technical review; the final reports land in NSF Connect within ten business days and the
wording may change.

- **306GMP** (audit 4990682, GMP for Sport) — 3 Minor
- **455-2GMP** (audit 4990683, NSF/ANSI 455-2 Dietary Supplements) — 9 Minor

**0 Critical · 0 Major · 12 Minor · 0 Not Acceptable.** Every finding is a documentation or execution
gap. None is a product-safety failure.

The shareable triage:
<https://claude.ai/code/artifact/74d2080a-9df5-4bc1-9d27-1d9b4fbcaabc>

## The split

| Clause | Finding | Where it gets fixed |
|---|---|---|
| 4.5.84 | EMP not executed (SOP 604) | **Configure** — schedules already seeded |
| 6.2.3.1 | No annual banned-list review procedure | **Configure** + SOP text |
| 4.6.21 | Shelf life not supported by data | **Configure** + elapsed time |
| 4.4.39 | ReadyDoc/MRPEasy not validated (21 CFR 11) | **Build** — validation protocol |
| 4.3.1 | Supplier qualification questionnaires missing | **Build** — supplier register + gate |
| 4.5.43 | No MMR per formula × batch size | **Build** — largest item |
| 4.3.9 | Change control covers equipment only | **Build** — extend Controlled Changes |
| 6.2.3.2 | Purchased materials not screened vs banned lists | **Build** — screening record at receiving |
| 6.2.2 | No procedure prohibiting banned substances | **SOP text** — nothing to build |
| 4.3.6 | Specifications + identity/purity/strength testing | **Build** (release gate) + lab work |
| 4.5.8 | No IQ/OQ/PQ for any equipment | **Build** (readiness step) + engineering |
| 4.2.9 | Street shoes in GMP areas | **Off-system** — physical control |

## Notes that matter for the build

**4.4.39 is about us, and it is the cheapest win.** The auditor explicitly credits ReadyDoc's unique
logins and audit trail — she is saying nobody documented that they were *tested*. The executed-protocol
machinery already exists (`scripts/verify-auth.mjs`, `scripts/verify-kiosk-isolation.mjs`,
`scripts/lib/verification-doc.mjs`). A Part 11 protocol is that machinery aimed at: attributable unique
identity, audit-trail completeness and immutability, record retention/retrieval, e-signature
manifestation, and authority checks. It runs on demand and fails a build on regression, which is
stronger evidence than a one-time IQ/OQ binder.

**4.5.43 (MMR) and 4.3.6 (specifications) are one piece of work.** An MMR is a controlled document with
a revision, a QA approval and a scope of one formula at one batch size — the shape Controlled Documents
already enforces. The batch record must *derive* from the approved MMR rather than be typed beside it,
or the executed record and the master can disagree. Doing specifications first and MMRs second means
the MMR references specs that exist.

**4.3.9 (change control) includes ReadyDoc's own releases**, which ties it to 4.4.39. One coherent
answer covers both.

**4.3.6 has a release gate in it.** Specifications and auto-grading already exist per item and test.
What is missing is a *completeness* rule: a lot cannot be released unless its item has an active
specification covering identity, purity, strength and composition — and identity backed by organoleptic
evaluation alone does not satisfy it (the auditor called that out by name). Enforced at release, the
finding cannot recur.

**Two clocks cannot be shortened.** Equipment qualification (4.5.8) and stability data (4.6.21) both
need real elapsed time. Start them in parallel with everything else and expect them closed last.

**The auditor recorded the plant fixing 4.3.6 before being told to** — new specification formats
approved 9 July (raw materials) and 21 August (finished products), samples submitted in August with
results not yet back. Worth carrying into the corrective action response.

## Suggested order

1. Turn on environmental monitoring and the annual list review (4.5.84, 6.2.3.1) — configuration only,
   and evidence accrues with time.
2. Write the three banned-substance procedures (6.2.2, 6.2.3.1, 6.2.3.2).
3. Validate ReadyDoc against Part 11 (4.4.39).
4. Supplier qualification + the banned-list screen, both at receiving (4.3.1, 6.2.3.2).
5. Specification completeness at release (4.3.6).
6. Master Manufacturing Records, then change control (4.5.43, 4.3.9).
7. Start equipment qualification and stability (4.5.8, 4.6.21).

## Source files

Preliminary Nonconformance Summary Reports issued 27 August 2026. Not committed to this repository —
they are NSF DRAFT documents pending technical review. Re-attach them if the detail is needed.
