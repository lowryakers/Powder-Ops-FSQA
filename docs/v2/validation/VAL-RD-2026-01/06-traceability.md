# Requirement-to-test table — VAL-RD-2026-01-TM

Every requirement traces to the tests that prove it; every test traces back to a requirement. The source of each
requirement is the Part 11 clause, the approved CAR 4990683-5 (OQ list), or the plan's intended use.
Fill in **Result** from the executed IQ/OQ/PQ.

| ID | Requirement | Source | Assessment | Tests | Automated | Result |
|---|---|---|---|---|---|---|
| R-01 | ReadyDoc runs on the described hosting, over HTTPS, as a closed system | Plan §2; 11.30 | N/A (closed) | IQ-01 | — | |
| R-02 | The release in use is the release tested, recorded by commit | 11.10(k); CAR "software change control" | Meets | IQ-02, IQ-07 | — | |
| R-03 | Configuration is as described, including the plant time zone | Plan §2 | — | IQ-03, IQ-04 | — | |
| R-04 | Records can be backed up and restored | 11.10(c); CAR IQ "backup and a restore test" | Partly | IQ-05, IQ-06, PQ-07 | `verify:prodcopy` | |
| R-05 | The automated suite passes on the release | Plan §3 | — | IQ-08 | `verify`, `verify:all` | |
| R-06 | Each person signs in with their own account and password | 11.10(d), 11.300(a); CAR OQ "logins" | Meets | OQ-01 | `verify-auth.mjs` | |
| R-07 | Passwords are protected, expire, lock out after failures, and lost credentials can be stopped | 11.300(b)(c)(d); 11.200(a)(3) | Meets / Partly | OQ-02 | `verify-auth.mjs`, `verify:sessions` | |
| R-08 | People reach only what they are granted; only authorized roles approve | 11.10(d)(g); CAR OQ "access rights" | Partly (idle sign-out) | OQ-03, OQ-14 | `verify:accesssources`, `check:modaccess`, `verify:botnoapprove` | |
| R-09 | Every create, change and delete is in the audit trail, with who, when, before and after | 11.10(e); CAR OQ "audit-trail completeness" | Meets | OQ-04 | `verify:useractivity` | |
| R-10 | The audit trail cannot be edited or deleted | 11.10(e); CAR OQ "protection from editing" | Meets | OQ-05 | `verify:part11` | |
| R-11 | The signer is the signed-in person; nobody signs their own competence | 11.50(a)(1), 11.100(a) | Meets | OQ-06 | `verify:part11` | |
| R-12 | The password is re-entered at each signing; a group is one signing | 11.200(a)(1); CAR OQ "password re-entry" | Meets / Partly (first signing of a session) | OQ-07 | `verify:part11`, `verify-signatures.mjs` | |
| R-13 | Each signature shows name, date and time, and meaning on screen and on printouts | 11.50; CAR OQ "e-signature display" | Meets (documents, training) | OQ-08, PQ-01, PQ-02 | `verify:part11` | |
| R-14 | A signature cannot be removed, copied or moved; a change under it is detected | 11.70, 11.10(a) | Meets (documents, training) | OQ-09, PQ-08 | `verify:part11` | |
| R-15 | Steps happen in the permitted order | 11.10(f) | Meets | OQ-10 | `verify:docrevisions`, `verify:receivingcoc` | |
| R-16 | Records are kept and can be retrieved for the retention period | 11.10(c); CAR OQ "retention and retrieval" | Partly | OQ-11, IQ-06 | — | |
| R-17 | Accurate copies can be given for inspection | 11.10(b); CAR OQ "copies for inspection" | Meets | OQ-12 | — | |
| R-18 | Shared sign-ins are detected | 11.100(a), 11.200(a)(2) | Meets | OQ-13, PQ-05 | `verify:part11` | |
| R-19 | People who sign are trained on, and bound by, the e-signature policy | 11.10(i)(j), 11.100(b) | Partly | PQ-04 | `verify:part11` (course exists) | |
| R-20 | Signatures work in normal use | Plan §5 (PQ) | — | PQ-01 – PQ-08 | — | |
| R-21 | FDA is told that e-signatures are binding | 11.100(c) | Missing until sent | — (summary report) | — | |
| R-22 | Training from an outside trainer is signed by the person recording it, with its own meaning, and its certificate is required and fingerprinted | 11.50(a)(3), 11.70; plan §1 (training) | Meets | OQ-06 (5–6), OQ-08 (5), PQ-02 | `verify:part11` | |

**Coverage check:** every IQ, OQ and PQ test appears above at least once (IQ-01 – 08, OQ-01 – 15, PQ-01 – 08).
OQ-15 retires the test records and proves no requirement.

## SOP 444 Appendix A, row by row

SOP 444 § 6.3 has the plan copy its Appendix A and fill in the evidence. Same rows, same order. The SOP's own proposed
test numbers (OQ-02 … OQ-18, DR-01 … DR-10) were placeholders; the column on the right gives this package's tests that
answer each row. A row with nothing that answers it is **Not met** and is in the summary report §3.

| SOP 444 row | Answered by | Assessment | Open item |
|---|---|---|---|
| 11.10(a) validation; invalid or altered records discernible | This package (VP, TM, SR); OQ-09, PQ-08 (fingerprints); R-14 | Meets (documents, training) | O-7 (other modules) |
| 11.10(b) accurate and complete copies | OQ-08 (printouts), OQ-12 (audit export, data backup) | Meets | — |
| 11.10(c) protection and retrieval for the retention period | IQ-05, IQ-06 (restore incl. audit trail), OQ-11, PQ-07 | Partly | O-1, O-2 |
| 11.10(d) access limited to authorized individuals | OQ-01, OQ-02, OQ-03; IQ-03 (user list) | Partly | O-3 |
| 11.10(e) audit trail: complete, time-stamped, not editable, retained | OQ-04, OQ-05; IQ-06 | Meets | — |
| 11.10(f) sequencing checks | OQ-10 | Meets | — |
| 11.10(g) authority checks; tokens cannot sign | OQ-03, OQ-14; IQ-03 (token list) | Meets | — |
| 11.10(h) device checks | IQ-03 (kiosk key mode) | Partly | O-4 |
| 11.10(i) training of users, developers and maintainers | PQ-04 | Partly | O-5 |
| 11.10(j) written e-signature accountability policy | PQ-04; attachment E-signature policy | Partly | O-6 |
| 11.10(k) control of system documentation | IQ-02, IQ-07; plan §9 (Change Register) | Meets | — |
| 11.50 name, date and time, meaning, on screen and printouts | OQ-08, PQ-01, PQ-02 | Meets (documents, training) | O-7 |
| 11.70 signature linked to its record | OQ-09, PQ-08 | Meets (documents, training) | O-7 |
| 11.100(a) unique, never reused or reassigned | OQ-01, OQ-13, PQ-05 | Partly | O-11 |
| 11.100(b) identity verified before a signature is established | — (procedural) | Missing | O-5 |
| 11.100(c) certification to FDA | — (summary report) | Missing until sent | O-12 |
| 11.200(a)(1) two components; series rule | OQ-07 | Partly | O-8 |
| 11.200(a)(2) used only by their owners | OQ-02, OQ-13 | Meets | — |
| 11.200(a)(3) misuse needs two people | OQ-02 (step 4) | Partly | O-9 |
| 11.200(b) biometrics | Not applicable: none used | N/A | — |
| 11.300(a) unique ID and password | OQ-01 | Meets | — |
| 11.300(b) periodic check, password aging | OQ-02 (step 5) | Meets | — |
| 11.300(c) loss management | OQ-02 (step 3) | Meets | — |
| 11.300(d) safeguards; attempts detected and reported | OQ-02 (steps 1–2) | Partly | O-10 |
| 11.300(e) token or card testing | Not applicable: no tokens or cards sign | N/A | — |

**SOP 444 § 9 item 14 (combined-batch rule) — decided:** a QA Review batch or a group training session is one act and
asks for the password once (OQ-07 steps 4 and 6). Until O-8 lands, the first signature of a session asks for the
password only; the sign-in name comes from the open session.
