# Annual review — VAL-RD-<year>-AR

**System:** ReadyDoc · **Validation in force:** VAL-RD-2026-01 · **Procedure:** SOP 444 § 6.12 · **Plan:** §9
**Review period:** ________ to ________ · **Done by:** ________ (Quality) · **Date:** ________

One page, once a year, and after any significant incident. Each line is answered from a screen, not from memory.
A **No** is a gap: write it in the last column and open a change in the Change Register.

| # | Question | Where to look | Yes / No | Gap → change # |
|---|---|---|---|---|
| 1 | Every software release in the period is in the Change Register, and each one touching **signing, records, the audit trail or access** has its OQ re-run recorded. The rest say "no revalidation needed" with a reason. | Document Control → Change Register → software releases | | |
| 2 | No deviation from the last validation or review is still open. | Summary report §2; this page last year | | |
| 3 | The open items in the summary report §3 are closed, or still accepted with a new date. | Summary report §3 | | |
| 4 | Every active account belongs to one person who still works here, with the access their job needs. Nobody left has an active account. | Settings → Users; Settings → Data backup → Accounts that share a name | | |
| 5 | No account was shared: every name on the shared sign-ins report has been explained. | Settings → Data backup → Shared sign-ins | | |
| 6 | Every bot token reads "can approve: no", and no approval on file was made by a bot. | Settings → Bot API tokens → Check | | |
| 7 | An audit-trail sample of 10 records (documents, training, QA Review) shows who, when, before and after, and each signature reads "signed", not "changed since signed". | System → Audit Log; the records' signature lines | | |
| 8 | Backups ran every day of the period, and the quarterly restore tests passed (records **and** audit trail). | Settings → Data backup; the restore test records | | |
| 9 | Password and lockout rules are unchanged (8+ characters, 365-day expiry, lockout after 5 failures, idle sign-out). Failed sign-ins and signatures were looked at. | System → Audit Log, filter `login_failed`, `signature_failed` | | |
| 10 | Everyone who signed something in the period completed ESIG-101, and the e-signature policy is current. | Training → matrix, ESIG-101; Document Control | | |
| 11 | Nothing about how ReadyDoc is used has changed the intended use or the list of GMP records in the plan §1. | Plan §1 | | |

**Conclusion** (tick one):
- [ ] The validation still stands. No revalidation needed.
- [ ] Gaps found (changes listed above). The validation stands while they are worked.
- [ ] Revalidation needed under SOP 444 § 6.11 (a Part 11 control no longer works, records or audit trail were lost, or
      the intended use changed).

| Role | Name | Signature | Date |
|---|---|---|---|
| Reviewed by (Quality) | | | |
| Approved by (management) | Lowry Akers | | |
