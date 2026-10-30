# Part 11 validation pack — password signatures (D-282 – D-284)

What this proves: ReadyDoc's document approvals and training sign-offs meet the five 21 CFR Part 11 points we
checked (`docs/v2/part11-assessment-2026-10-30.md`), plus the shared sign-in check.

**How to use it**

1. Run each page's test in the **live app**, in order. Each page says who does it (you need two people:
   **Lowry** (admin) and **Daniela** (Document Control)), what to click, and what you should see.
2. Tick Pass or Fail on each step and initial it. A Fail: write what you saw and stop; tell Claude.
3. Fill in **[07-results.md](07-results.md)** and both sign it.
4. Keep the printed, signed pages with the validation package (CAR 4990683-5, SOP 444).

**The tests make real records**, all named `TEST-P11`, so anyone can see what they are. Leave them in place: they
are the evidence that the test was run. Page 06 says how to retire them at the end.

**Automated check (run by Claude or a developer, not in the live app):** `npm run verify:part11` runs the same
checks against a fresh test database, 33 assertions. Its last run is recorded on the results page.

| Page | Requirement | Part 11 |
|---|---|---|
| [01](01-unique-signer.md) | One person per signature, never a typed name, nobody signs their own | 11.100(a), 11.300 |
| [02](02-name-time-meaning.md) | Name, date and time, and meaning on the record and the printout | 11.50 |
| [03](03-password-at-signing.md) | Password at the moment of signing; a group is one password | 11.200(a) |
| [04](04-signature-locked.md) | Signature locked to the record; not removable by editing | 11.70 |
| [05](05-audit-trail.md) | Audit trail users can't change, kept with the record | 11.10(e) |
| [06](06-shared-signins.md) | Shared sign-in report; cleaning up the test records | 11.100(a), 11.300 |
| [07](07-results.md) | Results — signed by Lowry and Daniela | |

Also here: [the e-signature policy](esignature-policy.md) (draft 1, set up as course ESIG-101) and
[the FDA certification letter](fda-certification-letter.md) (draft — **not sent**).
