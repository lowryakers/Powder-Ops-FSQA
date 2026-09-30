# NSF Connect note — CAR 4990683-7 (NSF/ANSI 455-2, clause 4.5.43)

**Where it goes:** NSF Connect → audit 4990683 → CAR 7 → add a note (do not edit the approved response;
D-056). **Who posts it:** Carol Pierce. **Date it the day it is posted.** Plain English, no app vocabulary
(the ReadyDoc rule for anything that leaves the plant). Written 30 September 2026 under D-130.

**Before posting, confirm the one date in it.** The note commits the run-scheduling requirement to
14 October 2026 (roadmap C2). If that has not shipped by the day the note goes in, change the date to one
that is true, or post the note after it ships. A note that names a date the plant then misses is the
defect the note exists to correct.

---

## The note

**Clarification to our approved corrective action plan — where the master manufacturing record is held**

Our approved response for this finding stated that each master manufacturing record is held as a
controlled document in ReadyDoc. That is not where the record will live, and we are correcting it here
so the plan on file matches what the auditor will see at the next visit.

**Correction.** The master manufacturing record for each formula at each batch size is held in Keychain,
the manufacturing system that is replacing MRP Easy. Until Keychain is live for a product, the approved
master record is the controlled form FORM 413-1, held under Document Control. In either place the record
is one formula at one batch size, with a revision and Quality approval, and the batch production record
for each run is generated from the approved master.

**What ReadyDoc does.** ReadyDoc is the plant's compliance and scheduling system. It does not hold the
master record. It enforces the preventive action in the approved plan: from 14 October 2026 a production
run cannot be scheduled in ReadyDoc without the identifier and revision of the approved master record the
run is made to, and that reference is kept on the run's record. This is how "a copy of the approved MMR
will be required to sign off a work order before starting a run" is put into effect.

**Procedure.** SOP 413 will be revised by 31 October 2026 to state where the master manufacturing record
is held, the approval it carries, and the master record review checklist referred to in our response to
CAR 4990683-9.

**Nothing else in the approved plan changes.** The root cause, the content of the master record, the
Quality approval of each record and the review checklist stand as submitted.

Responsible: Maria Servin, Quality Manager; Carol Pierce, Quality Technical Support Manager.

Evidence available at the next visit: approved master manufacturing records in Keychain or on
FORM 413-1; production run records in ReadyDoc showing the master record reference on each run;
SOP 413 as revised.

---

## Why the note reads this way (for us, not for NSF)

- **D-059 stands and D-129's recommendation was overruled (D-130).** The master record is a formula at a
  batch size with a bill of materials; Keychain will hold the formula, raise the manufacturing order and
  consume the BOM. A master record in ReadyDoc would put one fact in two systems from day one.
- **The gate is on an approved master record, not on Keychain.** The plant is not blocked on an ERP
  go-live to satisfy the CAR: FORM 413-1 is the approved record until Keychain is.
- **`check:ncstatus` keeps asserting that no MMR table exists in ReadyDoc**, as a permanent statement now.
- **What has to be true before the visit:** `mmr_ref` on the schedule assignment and the EOD MO line
  (roadmap C2, Lowry, 14 Oct); the SOP 413 revision (Daniela, 31 Oct); this note posted (Carol).
