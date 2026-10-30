# Summary report — VAL-RD-2026-01-SR

**System:** ReadyDoc · **Release:** commit ________ · **Procedure:** SOP 444 · **CAR:** 4990683-5 (4.4.39)
**Testing took place:** ________ to ________ (actual dates, SOP 444 § 6.8) · **Executed by:** Daniela Servin

## 1. What was done

| Part | Document | Executed | Result |
|---|---|---|---|
| Plan | VAL-RD-2026-01-VP | Approved on ________ | |
| Part 11 assessment | VAL-RD-2026-01-P11 | Reviewed on ________ | See §3 |
| IQ | VAL-RD-2026-01-IQ | ________ | __ of 8 passed |
| OQ | VAL-RD-2026-01-OQ | ________ | __ of 15 passed |
| PQ | VAL-RD-2026-01-PQ | ________ to ________ | __ of 8 passed |
| Requirement-to-test table | VAL-RD-2026-01-TM | ________ | __ of 21 requirements met |

**Automated evidence (IQ-08):** `npm run verify` and `npm run verify:all` on the release commit, ________ (date),
______ passed, ______ failed. `npm run verify:part11`: 43 checks; last run 30 Oct 2026 on the branch, 43 passed,
0 failed. A control run with the password check removed fails it, which shows the tests can catch the fault.

## 2. Deviations

| # | Test step | What happened | Impact on GMP records | Resolution | Retest | Quality decision |
|---|---|---|---|---|---|---|
| | | | | | | |

## 3. Open items (Part 11 "Partly" and "Missing")

Found by the assessment before testing. Each needs an owner and a date, and the QA approver accepts each one for release.
**Approved 30 Oct 2026 for the release after this one:** O-1 (daily full backup off the server, 30 daily + 12 monthly,
quarterly restore test), O-3 (idle sign-out: 15 minutes on shared floor devices, 8 hours otherwise), O-7 (meaning
printed on QA Review, QMS, COA and calibration printouts), O-8 (name and password on the first signature of a session),
O-9 (a reset gives a temporary password that cannot sign). Each is a revalidation change (plan §9): its OQ tests are
re-run and recorded before it is used.

| # | Clause | Item | Proposed action | Owner | Due | Accepted (Quality initials) |
|---|---|---|---|---|---|---|
| O-1 | 11.10(c) | No scheduled full-database backup; the weekly export is CSV and only 8 are kept | Schedule `npm run backup` (or turn on Railway volume backups) and keep backups for the retention period | Lowry | | |
| O-2 | 11.10(c) | An admin can still hard-delete some unsigned records (audited) | Retire instead of delete for GMP records | Lowry | | |
| O-3 | 11.10(d), 11.200(a)(1)(ii) | Sessions last 30 days with no idle sign-out on shared floor devices | Sign out after a period of no use on shared devices | Lowry | | |
| O-4 | 11.10(h) | Kiosk QR keys are off by default | Move kiosk keys to warn, then on | Lowry | | |
| O-5 | 11.10(i), 11.100(b) | ESIG-101 not yet assigned; identity check before an account is created is not written down; developer qualification not documented | Assign ESIG-101; add the identity check and the developer's qualification to SOP 444 or the onboarding SOP | Maria / Carol | | |
| O-6 | 11.10(j) | E-signature policy is a draft | Document Control issues it | Daniela | | |
| O-7 | 11.50, 11.70 (other modules) | QA Review, QMS, COA and calibration signatures ask for the password, but their printouts don't yet print the meaning in words, and they carry no fingerprint | Extend the D-282 pattern to those records | Lowry | | |
| O-8 | 11.200(a)(1)(i) | The first signing of a session asks for the password only | Ask for sign-in name and password on the first signature of a session | Lowry | | |
| O-9 | 11.200(a)(3) | One admin can reset a password and sign as that person | Notify the person when their password is reset; a reset can't be followed by a signature until the person has set their own password | Lowry | | |
| O-10 | 11.300(d) | Failed sign-ins and signatures are logged but nobody is told at the time | ReadyBot alert to Quality after repeated failures | Lowry | | |
| O-11 | 11.100(a) | Accounts can be renamed (audited) | Rename only through a recorded change | Daniela | | |
| O-12 | 11.100(c) | FDA certification letter not sent | Send after this report is approved and O-5 / O-6 are closed | Maria | | |

## 4. Conclusion

Tick one (SOP 444 § 6.8):

- [ ] **Validated for intended use.** All tests passed or their deviations are resolved; the open items above are
      accepted with owners and dates. ReadyDoc is released for creating, signing and keeping the GMP records listed
      in the plan.
- [ ] **Validated with stated conditions.** Released, on these conditions: ________________________________.
- [ ] **Not validated.** Not used for GMP electronic records except under the plan's interim controls (plan §8) until
      the deviations are resolved and retested.

After approval, every change to ReadyDoc goes through the Change Register. A change touching signing, records, the
audit trail or access re-runs its OQ tests before use; the rest are recorded "no revalidation needed" (plan §9). The
validation is reviewed once a year on [08-annual-review.md](08-annual-review.md).
Management receives this approved package, and that copy triggers implementation (CAR 4990683-5, preventive action).
The release for use is recorded and signed by Lowry Akers below.

## 5. Approval

Neither approver executed the tests (SOP 444 § 6.8).

| Role | Name | Signature | Date |
|---|---|---|---|
| Prepared by (system owner) | Lowry Akers | | |
| Tests executed by | Daniela Servin, Document Control Manager | | |
| Reviewed by (Quality lead) | Carol Pierce, Quality Technical Support Manager | | |
| **Approved by (Quality — QA approver)** | **Maria Servin, Quality Manager / SQF Practitioner** | | |
| **Approved and released for use (management)** | **Lowry Akers** | | |
