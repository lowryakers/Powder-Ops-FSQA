# VAL-RD-2026-01 — ReadyDoc validation package

**The first validation carried out under SOP 444, Computer System Validation.** It answers NSF CAR 4990683-5
(finding 4.4.39, "electronic records are not validated"). The approved CAR commits to a five-part package; this folder
is that package, in that order.

| # | Document | ID | What it is | Signed by |
|---|---|---|---|---|
| 1 | [Validation plan](01-validation-plan.md) | VAL-RD-2026-01-VP | Intended use, GMP records held, scope, roles, approach, acceptance criteria | Quality approves **before** testing |
| 2 | [Part 11 assessment](02-part11-assessment.md) | VAL-RD-2026-01-P11 | 21 CFR 11.10, 11.30, 11.50, 11.70, 11.100, 11.200, 11.300, clause by clause | Reviewed with the plan |
| 3a | [Installation qualification (IQ)](03-iq.md) | VAL-RD-2026-01-IQ | Hosting, release, configuration, backup **and a restore test** | Executed and initialled |
| 3b | [Operational qualification (OQ)](04-oq.md) | VAL-RD-2026-01-OQ | Logins, access rights, audit trail, e-signatures, retention and retrieval, copies for inspection | Executed and initialled |
| 3c | [Performance qualification (PQ)](05-pq.md) | VAL-RD-2026-01-PQ | Two weeks of normal use, sampled and checked | Executed and initialled |
| 4 | [Requirement-to-test table](06-traceability.md) | VAL-RD-2026-01-TM | Each requirement, its Part 11 clause, the test that proves it | Reviewed with the report |
| 5 | [Summary report](07-summary-report.md) | VAL-RD-2026-01-SR | Results, deviations, open items, conclusion | **Quality approves** |

**Attachments** (not part of the five; referenced by them):
- [E-signature policy](attachments/esignature-policy.md): draft 1, pending Document Control. Set up as course ESIG-101.
- [FDA certification letter](attachments/fda-certification-letter.md): draft, **not sent**. It is sent after the summary
  report is approved.

## Order of work

1. **Quality approves the plan (1)** with the Part 11 assessment (2). Testing does not start before this.
2. **Execute the IQ (3a), then the OQ (3b)**, on the release named in the plan. Record each step's result as you go.
   A failure is a **deviation**: record it in the summary report and stop that test.
3. **Run the release in normal use for the PQ period (3c).**
4. **Complete the requirement-to-test table (4)** with the test results.
5. **Write the summary report (5).** Quality approves it. Approval releases ReadyDoc for GMP use under SOP 444, and
   management receives the approved package (the CAR's preventive action).

## Keeping this package and SOP 444 consistent

SOP 444 is being drafted separately, by the Quality bot. This package uses the terms and steps below. **Wherever the
SOP's draft says something different, the SOP wins.** Change this package to match it, under a deviation, before the
plan is approved.

| This package uses | SOP 444 should say the same about |
|---|---|
| Five parts: plan, Part 11 assessment, IQ/OQ/PQ, requirement-to-test table, summary report | The contents of a validation package |
| Package ID `VAL-<system>-<year>-<nn>`; document IDs `…-VP`, `-P11`, `-IQ`, `-OQ`, `-PQ`, `-TM`, `-SR` | Numbering of validation documents |
| Roles: **system owner** prepares and executes; **Document Control** reviews; **Quality** approves the plan and the report | Who prepares, reviews and approves |
| The plan is approved before any test runs | The approval sequence |
| A failed step is a **deviation**, recorded with impact and resolution; Quality decides on any retest | Deviation handling |
| Risk-based: GMP-critical functions (records, signatures, audit trail, access) are tested in full; others are covered by the automated suite | The level of testing |
| Automated tests (`npm run verify:*`) are evidence when their run is recorded: date, release, result | Use of automated testing |
| A software change after approval goes through the Change Register; Quality decides whether it needs retesting | Change control and revalidation |
| Records are kept as GMP records, for the life of the system | Retention of the package |

**Open question for SOP 444:** the approved CAR dropped "annual review of the validation" and "every release re-runs
the OQ". This package does not commit to either. If SOP 444 includes them, the plan's revalidation section changes to
match.
