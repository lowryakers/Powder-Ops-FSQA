# 06 — Shared sign-ins, and cleaning up (21 CFR 11.100(a), 11.300)

**Requirement:** a password signature is only valid if one person knows the password. ReadyDoc reports the signs of a
shared sign-in so they can be followed up.

**Who:** Lowry. **Time:** 5 minutes.

| # | Step | Expected result | Pass / Fail | Initials |
|---|---|---|---|---|
| 6.1 | Sign in as Lowry on a second device (a phone) without signing out of the first. | Both work. | | |
| 6.2 | Settings → Data backup → **Shared sign-ins** → Run the report. | Lowry is listed as "signed in on 2 different devices at the same time", with both devices. | | |
| 6.3 | Sign out on the phone. Run it again. | Lowry is no longer listed. | | |
| 6.4 | Note any other account listed and ask that person about it. | Each listed account is explained (or the password changed). | | |

**Note:** sessions opened before this release say "device not recorded"; the report becomes complete as people sign
in again.

## Cleaning up the test records

- TEST-P11-01: **No longer in use**, reason `Part 11 validation test record`. Its approvals and history stay readable.
- The training records: withdraw any signature still on them (reason `Part 11 validation test record`).
- Nothing is deleted. The audit trail of the test is the evidence.
