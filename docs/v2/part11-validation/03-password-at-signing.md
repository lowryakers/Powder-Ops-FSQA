# 03 — Password at the moment of signing (21 CFR 11.200(a))

**Requirement:** every signature asks for the signer's own password at the moment of signing, even when they are
already signed in. A group sign-off is one act, so it asks once.

**Who:** Daniela and Lowry. **Time:** 10 minutes.

| # | Step | Expected result | Pass / Fail | Initials |
|---|---|---|---|---|
| 3.1 | Daniela: TEST-P11-01 → Revisions → **Start revision**. | The label box suggests **V2**. Start it, change the text, **Approve**. A password box opens. | | |
| 3.2 | Enter a **wrong** password. | Refused with a message that the password is wrong; nothing is approved. | | |
| 3.3 | Enter Daniela's correct password. | V2 is approved; V1 shows as superseded. | | |
| 3.4 | Lowry: Training → **Group training**. Pick any course, tick two people (not Lowry), tick the competence statement, Save. | **One** password box opens for the whole group. After the password, both records are saved, each signed by Lowry. | | |
| 3.5 | Cancel a password box on any of the above (press Cancel). | Nothing is saved, and no error shows. | | |
| 3.6 | Check: is there anywhere to "draw" or "apply" a signature on a document? | No. The old "Sign this document" button is gone. Signatures drawn before this change are listed as history only. | | |
