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
  every screen listed in §1. Its run on the release is recorded as evidence (IQ-08).

## 4. Roles

The roles are SOP 444 § 5.0's, confirmed by Lowry on 30 Oct 2026. **Nobody approves a report on tests they executed** (SOP 444 § 6.8), so the person who
built ReadyDoc prepares the package and supports the tests but does not execute them.

| SOP 444 role | Person | Here |
|---|---|---|
| Approver (management) | Lowry Akers | Approves this plan and the summary report; releases ReadyDoc for use |
| Reviewer / Quality lead | Carol Pierce, Quality Technical Support Manager | Reviews this plan, the test results and the summary report |
| QA approver of the summary report | Maria Servin, Quality Manager / SQF Practitioner | Signs the summary report for Quality; decides on deviations |
| System owner and system administrator / developer | Lowry Akers | Prepares the package; keeps the system documentation and change history; supports the tests; **does not execute them** |
| Test executor | Daniela Servin, Document Control Manager | Runs the IQ, OQ and PQ exactly as written; records results, initials and dates each step when done |
| Document Control | Daniela Servin | Files the package as controlled documents |
| Users (PQ) | QA, supervisors, Document Control | Normal use during the PQ period |

Where a step needs two people (a second account, a phone and a computer), the executor names who helped.

## 5. Approach

Risk-based, as SOP 444 sets out:
1. **Part 11 assessment** (VAL-RD-2026-01-P11): each clause marked Meets, Partly, Not applicable or Missing, with evidence.
2. **IQ:** the system is installed and configured as described in §2, and a backup restores.
3. **OQ:** each GMP-critical function works as required, tested in the live app with records named `TEST-VAL`.
4. **PQ:** the system performs in normal use for two weeks.
5. **Requirement-to-test table:** every requirement traces to a test, and every test to a requirement.

**Test environment** (SOP 444 § 6.2 item 6): the live system, with every test record named `TEST-VAL` so it can never
be mistaken for a GMP record, and retired at the end of the OQ (OQ-15). The automated suite runs against a fresh test
database, never the live one.

## 6. Acceptance criteria

- Every IQ, OQ and PQ step passes, or has a deviation that the QA approver has accepted.
- Every Part 11 clause is Meets or Not applicable. A clause marked Partly needs an open item with an owner and a date
  in the summary report, and Quality accepts it.
- The automated suite passes on the release under test.

## 7. Deviations

A step that does not give the expected result is a **deviation**. The tester writes what happened, stops that test,
and records it in the summary report. Quality decides the impact, the fix and whether to retest.

## 8. Interim controls until the summary report is approved

ReadyDoc is in use today (SOP 444 § 6.2 item 7). Until the summary report is approved:
- Records keep being made in ReadyDoc; nothing goes back to paper.
- Approvals and sign-offs made **before** the release under test (drawn signatures, typed approvers, unsigned competence
  statements) are kept as filed and read as history. They are not re-signed or back-dated.
- The FDA certification letter is not sent.

## 9. Change control and revalidation (SOP 444 § 6.11, decided 30 Oct 2026)

After approval, every change to ReadyDoc goes through the **Change Register** (Document Control → Change Register),
which also records every software release by commit. Each change is assessed before it goes live.

**A change that touches any of these four is a revalidation change:**
1. **Signing** — who can sign, how a signature is given, what it records or prints, its fingerprint.
2. **Records** — how a GMP record is created, changed, kept, retired or printed, or a new GMP record type.
3. **The audit trail** — what is logged, or how the log is protected.
4. **Access** — sign-in, passwords, sessions, roles, module access, tokens.

For a revalidation change, Quality records which rows of the requirement-to-test table it affects, and the OQ tests for
those rows are **run again and recorded** before the change is used for GMP records (at minimum; Quality may add more).
The automated suite runs on every release regardless. Replacing the hosting or the database, or a restore that loses
records or audit trail, is a full revalidation under SOP 444 § 6.11.

A change that touches none of the four (a screen layout, a report, a new non-GMP feature) is recorded in the Change
Register with the decision **"no revalidation needed"** and the reason.

**Annual review** (SOP 444 § 6.12): once a year, and after any significant incident, Quality completes the one-page
review in [08-annual-review.md](08-annual-review.md). A gap it finds starts a revalidation change.

## 10. Deliverables and retention

The five parts of VAL-RD-2026-01 (see the package index), the executed test records, and the attachments. They are kept
as controlled documents in ReadyDoc **and** as a copy outside ReadyDoc (the Quality shared drive), so the package that
validates ReadyDoc does not depend only on ReadyDoc (SOP 444 § 6.13). Kept for the life of the system plus the record
retention period of 21 CFR 111.605(a).

## Approval of this plan

Approved **before** any test is run (SOP 444 § 6.2 item 8).

| Role | Name | Signature | Date |
|---|---|---|---|
| Prepared by (system owner) | Lowry Akers | | |
| Reviewed by (Quality lead) | Carol Pierce | | |
| **Approved by (management)** | **Lowry Akers** | | |
