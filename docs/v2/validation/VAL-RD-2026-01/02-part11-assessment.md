# Part 11 assessment — VAL-RD-2026-01-P11

Clause by clause, 21 CFR Part 11 subparts B and C, against the release named in the plan. **Meets** · **Partly** (an
open item in the summary report) · **N/A** (with the reason) · **Missing**. "Test" points to the IQ/OQ/PQ step that
proves the answer.

Prepared from the code and the 30 October check (`docs/v2/part11-assessment-2026-10-30.md`), after D-282 – D-284.

## 11.10 — Controls for closed systems

| Clause | Requirement (short) | ReadyDoc | Status | Test |
|---|---|---|---|---|
| 11.10(a) | Validation for accuracy, reliability, consistent performance, and the ability to tell invalid or altered records | This package. Signed records carry a SHA-256 fingerprint and read "changed since signed" if altered | Meets on approval of this package | IQ, OQ, PQ; OQ-08 |
| 11.10(b) | Accurate, complete copies in human-readable and electronic form, for inspection | PDFs of documents, training records, COAs, QMS records; CSV exports; Auditor View; audit log export | Meets | OQ-12 |
| 11.10(c) | Records protected so they can be retrieved accurately for the retention period | Nothing is pruned; signed records cannot be deleted; the database itself is copied off the server every night (30 daily + 12 monthly kept) with its fingerprint, and a quarterly restore test opens the copy and checks it (D-290); a weekly CSV export also goes to R2 | Meets once IQ-05/06 pass; hard-delete of some unsigned records remains (O-2) | IQ-05, IQ-06, PQ-07 |
| 11.10(d) | Access limited to authorized individuals | Named accounts; module access set per person in Settings; no access by default; guests limited to Messages; admin-only Settings | Meets once OQ-16 passes: a shared device signs out after 15 minutes without use, any other after 8 hours (D-291) | OQ-01, OQ-03, OQ-16 |
| 11.10(e) | Secure, computer-generated, time-stamped audit trail of create/modify/delete; changes don't obscure earlier entries; kept as long as the record; available for review and copying | `audit_log` written by the server with actor, role, time, before/after; the database refuses UPDATE and DELETE (D-283); never pruned; filter and export screen | Meets | OQ-04, OQ-05 |
| 11.10(f) | Operational checks enforcing the permitted sequence of steps | Sign-off refused until a form is complete (receiving, internal audits, mock recall, QMS); revisions need a draft, then approval; a CoC before receiving sign-off | Meets | OQ-10 |
| 11.10(g) | Authority checks: only authorized people sign, alter records, use the system | Role and department checks on every approval (QA, Document Control, supervisors, admins); signed records close to everyone but an admin; bots can never approve (D-279) | Meets | OQ-03, OQ-07 |
| 11.10(h) | Device checks for valid sources of data input | Kiosk QR pages use per-kiosk keys (off / warn / on) | Partly: kiosk keys ship **off**; turn on to "on" after the warn period | IQ-03 |
| 11.10(i) | People who develop, maintain or use the system have the education, training and experience | Users: ESIG-101 and module training in ReadyDoc. Developer: AI-assisted development under the system owner, with automated tests and code review on every change | Partly: ESIG-101 not yet assigned; developer qualification not documented | PQ-04 |
| 11.10(j) | Written policies holding people accountable for actions under their e-signatures | E-signature policy, draft 1 (attachment) | Partly: pending Document Control issue | PQ-04 |
| 11.10(k) | Control over system documentation: distribution, access, use; revision and change control | Change Register records every change and release; source history in git; this package controlled under SOP 444 | Meets | IQ-02 |

## 11.30 — Controls for open systems

**N/A.** ReadyDoc is a closed system: access is controlled by Powder Ops, which is responsible for the records. It
travels over the internet, but only over HTTPS to named accounts (IQ-01).

## 11.50 — Signature manifestations

| Clause | Requirement | ReadyDoc | Status | Test |
|---|---|---|---|---|
| 11.50(a)(1) | Printed name of the signer | Stored with every signature; the signer is the signed-in person, never a typed name | Meets | OQ-06 |
| 11.50(a)(2) | Date and time of signing | Stored to the second (UTC), shown and printed in plant time with the zone | Meets | OQ-08 |
| 11.50(a)(3) | Meaning (review, approval, responsibility, authorship) | Approved · Approved on paper · Trained and competent · Verified / Reviewed | Meets for documents and training; Partly elsewhere (see note) | OQ-08 |
| 11.50(b) | The same items shown in any human-readable form (screen and printout) | Document PDF prints each approval; training record PDF prints the sign-off | Meets for documents and training; Partly elsewhere | OQ-08 |

**Note on scope:** QA Review, QMS records, COAs, calibration and other modules already require the password at signing
(D-195, D-206). Their printouts were not changed in this release to print the meaning in words. The summary report
lists them as an open item.

## 11.70 — Signature/record linking

| Requirement | ReadyDoc | Status | Test |
|---|---|---|---|
| Signatures linked to their records so they can't be excised, copied or transferred to falsify a record | Signatures are stored on the record they sign, with a fingerprint of the signed content; the drawn, re-usable signature image is removed (D-282); editing cannot remove a signature; a withdrawal is a signed act that keeps the original | Meets for documents and training; Partly elsewhere (no fingerprint yet) | OQ-09 |

## 11.100 — General requirements

| Clause | Requirement | ReadyDoc | Status | Test |
|---|---|---|---|---|
| 11.100(a) | Unique to one person; never reused or reassigned | One account per person; unique sign-in names; accounts with history are deactivated, never deleted; bots cannot sign. A shared sign-in report finds a login used on several devices at once | Partly: renaming an account is possible, and is audited | OQ-02, OQ-13 |
| 11.100(b) | Identity verified before an e-signature is assigned | Accounts are created by the office for known employees (onboarding) | Partly: the identity check is a practice, not written into a procedure | PQ-04 |
| 11.100(c) | Certify to FDA that e-signatures are the legal equivalent of handwritten ones | Letter drafted (attachment), not sent | Missing until sent after the summary report is approved | — |

## 11.200 — Electronic signature components and controls

| Clause | Requirement | ReadyDoc | Status | Test |
|---|---|---|---|---|
| 11.200(a)(1) | At least two components: an ID and a password | Sign-in with name and password; each signature re-enters the password, bound to the signed-in ID | Meets | OQ-07 |
| 11.200(a)(1)(i) | Continuous session: the first signing uses all components, later ones at least one | Every signing asks for the password; the first signing of a session also asks for the sign-in name (D-292) | Meets once OQ-18 passes | OQ-07, OQ-18 |
| 11.200(a)(1)(ii) | Signings not in a continuous session use all components | An idle session signs out (D-291); the next signing is in a new session and asks for name and password | Meets once OQ-16 and OQ-18 pass | OQ-16, OQ-18 |
| 11.200(a)(2) | Used only by their genuine owners | Policy (attachment); passwords hashed, never shown; shared sign-in report | Meets once the policy is issued | OQ-13, PQ-04 |
| 11.200(a)(3) | Using someone else's signature would need two or more people to collaborate | Passwords are never visible to anyone. An admin reset gives a temporary password that opens only the change-password screen, cannot sign, expires in 3 days and signs the person out everywhere; the reset is audited (D-292) | Meets once OQ-17 passes | OQ-02, OQ-17 |
| 11.200(b) | Biometric signatures | Not used | N/A | — |

## 11.300 — Controls for identification codes and passwords

| Clause | Requirement | ReadyDoc | Status | Test |
|---|---|---|---|---|
| 11.300(a) | No two people have the same ID and password combination | Unique sign-in names; passwords hashed (scrypt) | Meets | OQ-01 |
| 11.300(b) | IDs and passwords checked, recalled or revised periodically | Passwords expire after 365 days with a 14-day warning; the access review lists who holds what | Meets | OQ-02 |
| 11.300(c) | Loss management: deauthorize lost or compromised credentials | Deactivating an account ends its sessions at once (D-072); password reset; API tokens revoked at once | Meets | OQ-02 |
| 11.300(d) | Safeguards against unauthorized use; detect and report attempts to management | Sign-in locks after 5 failed attempts for 15 minutes; signing rate-limited; every failure audited (`login_failed`, `signature_failed`) | Partly: failures are logged but nobody is told at the time | OQ-02 |
| 11.300(e) | Periodic testing of tokens and cards | No tokens or cards are used to sign | N/A | — |

## Summary

| Status | Clauses |
|---|---|
| Meets | 11.10(a)(b)(e)(f)(g)(k), 11.50 (documents, training), 11.70 (documents, training), 11.200(a)(1)(a)(2), 11.300(a)(b)(c) |
| Partly | 11.10(c)(d)(h)(i)(j), 11.50 and 11.70 for other modules, 11.100(a)(b), 11.200(a)(1)(i)(ii)(a)(3), 11.300(d) |
| Missing | 11.100(c), until the letter is sent |
| N/A | 11.30, 11.200(b), 11.300(e) |

Every Partly item is carried into the summary report as an open item with an owner and a date.
