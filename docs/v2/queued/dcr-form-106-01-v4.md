# DCR draft — FORM 106-01 (Chemical Dilution Logbook): the two that are never done, and the one that isn't on it

**For Document Control (Daniela) and Quality (Maria). Drafted 16 September 2026. Nothing here is decided by
the app, and nothing in the code has been changed.**

Daniela asked Zuleika about the dilution tasks on her Operator View. Her answer named two chemicals she has
no formula for, and one she mixes daily that is on no form at all. Both halves check out against the
plant's own records, and neither is a software problem.

## The evidence

The paper Chemical Dilution Logbook is transcribed into ReadyDoc — seven scanned sheets, fourteen pages,
**126 days from 25 November 2025 to 30 June 2026**. Every one of the 464 checks on it was performed by
**ZN**. Counted from the records as filed:

| Chemical | Named on the 106-01 header | Daily task in ReadyDoc | Checks in 126 days | The formula the form gives |
|---|---|---|---|---|
| Sani-512 Sanitizer | yes | yes | **232** | 200–250 ppm, read off a test strip |
| Chlorine (Cloro) | yes | yes | **232** | 100–200 ppm, read off a test strip |
| Dawn Professional Heavy Duty | yes | yes | **0** | "1 tsp to 2.5 gal water" |
| Simple Green | yes | yes | **0** | "1:10 to 1:30" |
| **Lysol Power Clean** | **no** | **no** | **0** | **none — and it is mixed daily** |

**The two chemicals she has no formula for are the two that have never once been logged.** Not in the eight
months on file, and the transcription note taken at the time says the same of the three years of sheets it
was read from. ReadyDoc raises a daily task for each of them because the form's header names four
chemicals; the sheets say the plant checks two.

## What is asked

### 1. Are Dawn and Simple Green live checks, or header text?

The form names them. The log has never carried them. One of those two things should change, and only
Document Control can say which:

- **They are live checks** — then the plant is eight months behind on two daily verifications, the tasks
  ReadyDoc is already raising are correct, and what is missing is the training and the formula (below).
- **They are not** — then FORM 106-01 V4 drops them from the header, and the two daily tasks come out of
  ReadyDoc with them. A check on a controlled form that nobody has ever performed is an audit finding
  whichever way it is answered; it stops being one the moment the form and the practice agree.

The app will not decide this by quietly deactivating two schedules. A check that is never done is exactly
the thing a task list exists to keep visible.

### 2. "1:10 to 1:30" is a range, not a formula

Zuleika is right that she has no formula for Simple Green, and she would still be right holding the form.
`1:10` and `1:30` are three times apart in strength; the form does not say which to use, or for what. Dawn's
"1 tsp to 2.5 gal water" is a single instruction and does not have this problem.

**Asked:** either a single ratio, or two named ones with the job each belongs to (e.g. `1:10 for floors,
1:30 for general surfaces`). Whatever V4 says, the code takes verbatim — `shared/dilution-forms.js` is
transcribed and is not editable in the app, deliberately.

### 3. Lysol is diluted daily for the bathrooms and is on no form

Zuleika mixes it; that is confirmed. There is no ratio written down anywhere, no task, and no record. Three
Lysol products are on the approved chemical list, all `is_food_grade = 0`, scoped to bathrooms, warehouse and
the lunch room — **never a food-contact surface, and never the Chemical Station (QA-CL-004, Production)
where the other four are mixed.** Two of the three (the wipes and the toilet bowl gel) cannot be diluted at
all, so this is **Lysol Power Clean**.

Two honest homes for it, and they are genuinely different decisions:

- **(a) FORM 106-01 gains a fifth chemical.** It sits with the other dilutions and gets the same daily
  verification and QA counter-signature. But 106-01's four are food-contact sanitation at the Chemical
  Station, and Lysol is explicitly none of that — it would be the only non-food-contact entry on the form.
- **(b) The ratio goes on Restroom Daily Cleaning (Form 108, `QA-CL-002`).** That daily task already exists,
  already runs, and is where Lysol is actually used — but **it names no chemical and has no dilution step**
  today. Its six steps are clean the bowls, clean the sinks, refill toiletries, clean the mirrors, mop the
  floors, empty the trash. Adding "mix Lysol Power Clean to `<ratio>`" is a change to Form 108, which is its
  own DCR.

Either way **a ratio has to be written down by someone qualified to set it**, and that is Quality's, not the
app's and not the floor's. Until then Zuleika is mixing to memory and nothing records what she mixed.

## What changes in the code, and only after this is ruled on

- `shared/dilution-forms.js` — the `DILUTIONS` list and `FORM_REVISION`. Transcribed, never typed: a
  critical limit editable in a text box is what this file has always refused.
- `server/dilution-seed.js` — one schedule per chemical. Adding or removing one follows the list above it.
- `controlled.js` parks the change on deploy and the app **goes on serving V3** until Document Control
  approves it in Controlled Changes. Records filed under V3 keep saying V3; nothing is re-stamped.
- If the answer is (b), the change is to `server/cleaning-seed.js`'s Restroom Daily Cleaning steps and to
  Form 108, not to 106-01 at all.

**Nothing on this list has been done.** Sani-512 must not be renamed to Lysol to close the gap, and the two
never-logged tasks stay on the Operator View until somebody decides they should not be.
