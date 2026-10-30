# 07 — Results

**System:** ReadyDoc, release containing D-282 – D-284 · **Commit:** ______________ · **URL:** app.powder-ops.com

## Automated check

`npm run verify:part11` — fresh test database, 33 assertions. **Last run by Claude, 30 Oct 2026: 33 passed, 0 failed.**
It also proves what can't be done by hand in the live app: a signed fact changed in the database reads "changed since
signed"; the database refuses UPDATE and DELETE on the audit log; a group's records are each fingerprinted separately.
A control run (password check removed) fails, which shows the test can catch the fault.

## Live-app tests

| Page | Requirement | Result (Pass / Fail) | Deviations / notes |
|---|---|---|---|
| 01 | One person per signature | | |
| 02 | Name, date and time, meaning | | |
| 03 | Password at the moment of signing | | |
| 04 | Signature locked to the record | | |
| 05 | Audit trail | | |
| 06 | Shared sign-ins | | |

**Conclusion** (tick one):

- [ ] All tests passed. Password signatures on document approvals and training sign-offs are fit for use as
      21 CFR Part 11 electronic signatures.
- [ ] Not all tests passed. See deviations; not released for use until they are resolved and re-tested.

**Scope note:** this covers document approvals and training sign-offs. Other signatures in ReadyDoc (QA Review, QMS
records, COAs, calibration, etc.) already ask for the password at signing; their printouts are validated separately.

## Signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| Tested and reviewed by (system owner) | Lowry | | |
| Reviewed and approved by (Document Control) | Daniela Servin | | |
