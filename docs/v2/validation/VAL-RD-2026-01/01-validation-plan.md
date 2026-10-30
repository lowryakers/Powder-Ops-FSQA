# Validation plan — VAL-RD-2026-01-VP

**System:** ReadyDoc, Powder Ops' quality and compliance system (web application).
**Procedure:** SOP 444, Computer System Validation (first execution).
**Reason:** NSF CAR 4990683-5 (finding 4.4.39), and 21 CFR 111 records kept electronically under 21 CFR Part 11.

## 1. Intended use

ReadyDoc is where the plant creates, reviews, signs and keeps its GMP records, in place of paper. People sign in with
their own account, from computers, tablets and phones on the floor and in the office.

**GMP records held in ReadyDoc** (in scope):

| Area | Records |
|---|---|
| Document control | SOPs, work instructions, job descriptions, forms register, revision history and approvals |
| Training | Training records and sign-offs, test attempts, course and document revision links |
| Production | End-of-day production entries, QA sign-offs, production runs |
| Sanitation | Cleaning and pre-op records, ATP and allergen swab results, 72-hour re-clean tasks |
| Quality records | Deviations, non-conformances, on-hold, disposals, CAPAs, internal audits, mock recalls, management review |
| Receiving and shipping | Receiving inspections (FORM 204-01), certificates of compliance, lab-test requests, truck inspections |
| Lab | COA requests, results, specifications, certificates of analysis |
| Equipment | PM work orders, calibration records, daily scale verifications, LOTO, hygienic design |
| Suppliers | Supplier qualification, questionnaires, certificates |

**Out of scope:** MRP Easy (validated separately; the CAR commits to checking its logins, audit trail and access
controls); the Messages chat (not a GMP record); office finance screens.

## 2. System description

| Item | Detail |
|---|---|
| Type | Custom web application, built in-house (GAMP 5 category 5) |
| Hosting | Railway (cloud), one service with a persistent volume; HTTPS at app.powder-ops.com |
| Database | SQLite on the persistent volume |
| File storage | Cloudflare R2 (attachments, signed copies, backups) |
| Clients | Current browsers on computers, tablets and phones; installable as an app |
| Source code | GitHub repository `lowryakers/Powder-Ops-FSQA`; every release recorded by commit |
| Time | Server clock in UTC; the plant's time zone (America/Denver) shown on records and printouts |

## 3. Scope of this validation

- **Release:** the release that contains D-282 – D-284 (password signatures, locked audit trail). Commit: ________.
- **Functions tested in full** (GMP-critical): sign-in and passwords, access rights, the audit trail, electronic
  signatures (document approvals, training sign-offs, QA Review, QMS records), record retention and retrieval, copies
  for inspection, backup and restore.
- **Functions covered by the automated suite** (`npm run verify:all`: 175 entries, run against a fresh test database; plus `npm run check`, 49 pure checks): the module-level behaviour of
  every screen listed in §1. Its run on the release is recorded as evidence (OQ-14).

## 4. Roles

| Role | Person | Responsibility |
|---|---|---|
| System owner | Lowry | Prepares the package, executes the IQ and OQ, writes the summary report |
| Document Control | Daniela Servin, Document Control Manager | Reviews the package; second tester for the signature tests |
| Quality | Maria Servin, Quality Manager / SQF Practitioner | Approves this plan, decides on deviations, approves the summary report |
| Users (PQ) | QA, supervisors, Document Control | Normal use during the PQ period |

## 5. Approach

Risk-based, as SOP 444 sets out:
1. **Part 11 assessment** (VAL-RD-2026-01-P11): each clause marked Meets, Partly, Not applicable or Missing, with evidence.
2. **IQ:** the system is installed and configured as described in §2, and a backup restores.
3. **OQ:** each GMP-critical function works as required, tested in the live app with records named `TEST-VAL`.
4. **PQ:** the system performs in normal use for two weeks.
5. **Requirement-to-test table:** every requirement traces to a test, and every test to a requirement.

## 6. Acceptance criteria

- Every IQ, OQ and PQ step passes, or has a deviation that Quality has accepted.
- Every Part 11 clause is Meets or Not applicable. A clause marked Partly needs an open item with an owner and a date
  in the summary report, and Quality accepts it.
- The automated suite passes on the release under test.

## 7. Deviations

A step that does not give the expected result is a **deviation**. The tester writes what happened, stops that test,
and records it in the summary report. Quality decides the impact, the fix and whether to retest.

## 8. Change control and revalidation

After approval, any change to ReadyDoc goes through the **Change Register** (Document Control → Change Register),
which also records every software release. Quality decides whether a change needs retesting, and which tests.

## 9. Deliverables

The five parts of VAL-RD-2026-01 (see the package index), plus the attachments. They are kept as GMP records.

## Approval of this plan

| Role | Name | Signature | Date |
|---|---|---|---|
| Prepared by (system owner) | Lowry | | |
| Reviewed by (Document Control) | Daniela Servin | | |
| Approved by (Quality) | Maria Servin | | |
