# 04 — Signature locked to the record (21 CFR 11.70)

**Requirement:** a signature can't be removed, copied or moved to another record by editing. A correction is a new
signed act that keeps the original.

**Who:** Lowry. **Time:** 10 minutes.

| # | Step | Expected result | Pass / Fail | Initials |
|---|---|---|---|---|
| 4.1 | Open the training record from page 01 (step 1.4) → Edit. | The competence tick is greyed out and reads "Signed by Lowry. A signed sign-off cannot be changed by editing." | | |
| 4.2 | Change the **Employee** to someone else and Save. | Refused: "This sign-off was signed by Lowry. The employee name … cannot change while it is signed". | | |
| 4.3 | Change only the **Notes** and Save. | Saved. The signature still reads "password signature" (not "changed since signed"). | | |
| 4.4 | Open TEST-P11-01 → Edit. Try to change the text or the revision of the approved version. | Refused: an approved document's text and number do not change; a new revision is needed. | | |
| 4.5 | Back on the training record: **Withdraw signature…**, reason `TEST-P11 withdrawal check`, Lowry's password. | The record keeps "A signature by Lowry (date, time) was withdrawn by Lowry on (date, time): TEST-P11 withdrawal check". The record goes back to In progress. Nothing is deleted. | | |
| 4.6 | Print the record again. | The printout shows the withdrawal line. | | |

**What protects the record outside the app:** every signature stores a fingerprint (SHA-256) of exactly what was
signed. If a signed fact were changed in the database directly, the screen and the printout say "changed since signed"
(tested automatically; see the results page).
