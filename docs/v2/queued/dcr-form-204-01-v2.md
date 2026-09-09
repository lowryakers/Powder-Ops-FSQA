# DCR draft — FORM 204-01 Receiving Inspection Checklist, V1 → V2 (one added line)

**For Document Control (Daniela). Drafted 9 September 2026. Nothing here is decided by the app.**

NSF GMP for Sport finding §6.2.3.2 (CAR 4990682-3, due 4 October 2026): *procedures ensuring all
materials purchased are not on the Banned/Prohibited Substances lists are not established* — and the
requirement asks the plant to **document execution** of the check. FORM 204-01 is worked at every truck and
ReadyDoc refuses to sign it off while any line is blank, so one added line gives a dated, signed record of
the check per arrival.

## What is asked

1. **Issue FORM 204-01 V2** with one line added to the POST-Unload section, after the allergen question:

   > **Material checked against the Banned/Prohibited Substance lists (NSF 306 Annex C, NFL/NFLPA, MLB, WADA)**
   > — YES / NO / N-A. *If NO, place on hold and notify Quality.*

   Correct the wording as Document Control sees fit; the correction goes into `server/receiving-checklist.js`
   (item `banned_substance_check`) **before** approval, so the record and the paper say the same thing.
2. **Approve it in ReadyDoc** — Document Control → Controlled Changes → *FORM 204-01 Receiving Inspection
   Checklist — questions*. The line is already built and deployed, and **ReadyDoc is still serving V1**:
   the change-control engine recorded V1 as the approved revision and parked V2 with a Document Change
   Request the day it deployed. Approving puts the line in force immediately, with no restart.

## What happens on approval

- Every checklist started after approval is stamped **V2** and cannot be signed off with the line blank.
- A **NO** sends a ReadyBot message and a phone push to Adam and Maria at the moment it is tapped
  (subject: *Receipt on hold: banned/prohibited substance check*), and the record keeps who was told and when.
  The sign-off is refused until that escalation has gone.
- Checklists started under V1 keep saying V1; nothing filed is rewritten.

## What this does not do

- It does not check the material against the lists — the receiver does, against the editions the annual
  list review (CAR 4990682-2) records as current. The line is the record that the check was made.
- It does not qualify the material at approval time (SOP 404). That is item (a) of the CAR response and
  lives on the supplier record, not on the receiving form.
