# 05 — Audit trail users can't change (21 CFR 11.10(e))

**Requirement:** a computer-generated, time-stamped audit trail of who created, changed or deleted a record. Nobody
can edit it, and it is kept as long as the record.

**Who:** Lowry. **Time:** 5 minutes.

| # | Step | Expected result | Pass / Fail | Initials |
|---|---|---|---|---|
| 5.1 | System → Audit Log. Filter or search for `TEST-P11` (or the two people's names, today). | Entries for every step above: created, approved, edited, withdrawn, each with the person, role, date and time. | | |
| 5.2 | Open the approval entry for V2. | It shows who approved, the meaning "Approved", and `signature_verified: true, verified_via: password`. | | |
| 5.3 | Open the training edit from 4.3. | It shows what changed (notes) with the before and after values. | | |
| 5.4 | Look for any button to edit or delete an audit entry. | There is none. | | |
| 5.5 | (Developer, on a copy of the database) Try `UPDATE audit_log …` and `DELETE FROM audit_log …`. | Both refused by the database: "audit_log is append-only". (Also run automatically; see the results page.) | | |

**Retention:** the audit log is never pruned. It is in every backup (Settings → Data backup → automatic backups, and
the R2 copy). Records and their audit trail are kept for the life of the system; the dietary-supplement minimum is 1
year past the shelf-life date, or 2 years past distribution of the last batch when there is no shelf-life date
(21 CFR 111.605). Restoring a backup brings the trail with it.
