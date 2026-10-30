# VAL-RD-2026-01 — ReadyDoc validation package

**The first validation carried out under SOP 444, Computer System Validation.** It answers NSF CAR 4990683-5
(finding 4.4.39, "electronic records are not validated"). The approved CAR commits to a five-part package; this folder
is that package, in that order.

| # | Document | ID | What it is | Signed by |
|---|---|---|---|---|
| 1 | [Validation plan](01-validation-plan.md) | VAL-RD-2026-01-VP | Intended use, GMP records held, scope, roles, approach, acceptance criteria, interim controls, change control | Carol Pierce reviews, **Lowry Akers approves, before testing** |
| 2 | [Part 11 assessment](02-part11-assessment.md) | VAL-RD-2026-01-P11 | 21 CFR 11.10, 11.30, 11.50, 11.70, 11.100, 11.200, 11.300, clause by clause | Reviewed with the plan |
| 3a | [Installation qualification (IQ)](03-iq.md) | VAL-RD-2026-01-IQ | Hosting, release, configuration, backup **and a restore test** | Executed and initialled by the test executor |
| 3b | [Operational qualification (OQ)](04-oq.md) | VAL-RD-2026-01-OQ | Logins, access rights, audit trail, e-signatures, retention and retrieval, copies for inspection | Executed and initialled by the test executor |
| 3c | [Performance qualification (PQ)](05-pq.md) | VAL-RD-2026-01-PQ | Two weeks of normal use, sampled and checked | Executed and initialled by the test executor |
| 4 | [Requirement-to-test table](06-traceability.md) | VAL-RD-2026-01-TM | Each requirement, its Part 11 clause, the test that proves it; SOP 444 Appendix A row by row | Reviewed with the report |
| 5 | [Summary report](07-summary-report.md) | VAL-RD-2026-01-SR | Results, deviations, open items, conclusion | **QA approver, then Lowry Akers** (release for use) |
| — | [Annual review](08-annual-review.md) | VAL-RD-&lt;year&gt;-AR | One page, once a year and after an incident | Quality, then Lowry Akers |

**Attachments** (not part of the five; referenced by them):
- [E-signature policy](attachments/esignature-policy.md): draft 1, pending Document Control. Set up as course ESIG-101.
- [FDA certification letter](attachments/fda-certification-letter.md): draft, **not sent**. It is sent after the summary
  report is approved.

## Order of work

1. **Carol Pierce reviews and Lowry Akers approves the plan (1)** with the Part 11 assessment (2). Testing does not
   start before this.
2. **Execute the IQ (3a), then the OQ (3b)**, on the release named in the plan. Record each step's result as you go.
   A failure is a **deviation**: record it in the summary report and stop that test.
3. **Run the release in normal use for the PQ period (3c).**
4. **Complete the requirement-to-test table (4)** with the test results.
5. **Write the summary report (5).** The QA approver signs it, then Lowry Akers; nobody approves tests they executed.
   Approval releases ReadyDoc for GMP use under SOP 444, and management receives the approved package (the CAR's
   preventive action).
6. **After release:** every change goes through the Change Register (plan §9); the annual review (08) once a year.

## Keeping this package and SOP 444 consistent

Checked against the Quality bot's draft **SOP 444 Computer System Validation, V1 DRAFT, 10/30/2026**. **The SOP wins**;
this package was changed to match it before the plan is approved. What was changed:

| SOP 444 draft says | This package now |
|---|---|
| § 5.0 roles: Carol Pierce reviews, Lowry Akers approves the plan and the report; a QA approver signs the report for Quality | Plan §4 and every sign-off block use those roles |
| § 6.8: nobody approves a report on tests they executed | Lowry (developer, approver) no longer executes; **Daniela Servin is the test executor** (confirmed 30 Oct). Lowry supports but signs no test step |
| § 6.2 item 6: name the test environment | Plan §5: the live system with `TEST-VAL` records; automated tests on a fresh database |
| § 6.2 item 7: interim controls until the report is approved | Plan §8 |
| § 6.3: the plan copies Appendix A and fills in the evidence | Requirement-to-test table, second section, row by row |
| § 6.4: build id, user and token lists, restore checks the audit trail | IQ-02 (`/api/version`), IQ-03 (lists attached), IQ-06 (audit_log count) |
| § 6.8: conclusion wording; dates testing took place | Summary report §4 and header |
| § 6.11 change control and revalidation; § 6.12 periodic review | Plan §9 (decided 30 Oct: signing, records, audit trail, access ⇒ re-run their OQ tests) and the one-page annual review (08) |
| § 6.13: a copy outside the system being validated; retention per 111.605(a) | Plan §10 |

**Answered here, for the SOP to say the same** (its § 9 open decisions):

| § 9 item | Decision in this package | Source |
|---|---|---|
| 3 Signature approach | Password signatures, no drawn signature | Lowry, 30 Oct (D-282) |
| 10 Periodic review interval; revalidation trigger | Yearly, one page; any change touching signing, records, audit trail or access goes through change control and re-runs its OQ tests | Lowry, 30 Oct |
| 14 Combined-batch rule | One password for a QA Review batch or a group session | Lowry, 30 Oct |
| 15 Who reviews failed sign-ins and signatures | Quality, at the annual review (line 9) until O-10 alerts at the time | This package |

**Decided 30 Oct (Lowry):** item 1 — the number stays **SOP 444** (it is the number in the NSF corrective action);
item 5 — Daniela Servin executes the tests, Maria Servin is the QA approver, Carol Pierce reviews, Lowry Akers approves
and releases; item 2 — **one** e-signature policy document, taught by course ESIG-101, with its document number and the
authorization form's number issued by Daniela (FORM 438-01 is taken). Until then the package writes **FORM ___ (to be
issued)** and **SOP ___ (to be issued)**.

**Still open, for Carol and Lowry** (the package uses the proposal in italics until they decide): item 7 *(PQ: two weeks, samples as in PQ-01 – 08)*, item 8 *(closed
system)*, item 9 *(retention: life of the system plus 111.605(a); copy on the Quality shared drive)*, items 11–13, 16.

**The e-signature policy is one document** (decided 30 Oct): the attached policy is it, ESIG-101 is the course that
teaches it, and the SOP 444 draft's reference to SOP-438 should point at it once Daniela issues its number.
