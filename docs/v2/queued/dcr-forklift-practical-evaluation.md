# DCR draft — Forklift Operator Practical Evaluation (new form)

**Status:** drafted, not issued. Records filed in ReadyDoc today are stamped **DRAFT-1**.
**Raised by:** ReadyDoc, 21 September 2026.
**For:** Daniela Servin, Document Control Manager.
**Quality owner:** Maria Servin (Quality Manager / SQF Practitioner).
**Operational owner:** Adam Bliss (Production Manager), with warehouse supervision.

---

## What this asks for

A **form number and a revision** for a practical evaluation of a powered-industrial-truck
operator, and a decision on whether the wording below is adopted as drafted.

## Why it is being raised

The plant's forklift training in ReadyDoc was a **written test only** — the twenty-question
bilingual quiz already in use, transcribed from the plant's own signed document. Passing it
filed a training completion and every screen then read "trained".

29 CFR 1910.178(l)(2)(ii) requires training to consist of three things:

1. formal instruction,
2. practical training (demonstrations by the trainer and practical exercises by the trainee), and
3. **evaluation of the operator's performance in the workplace**.

and 1910.178(l)(6) requires the employer to **certify that each operator has been trained and
evaluated**, with the certification carrying the operator's name, the date of the training, the
date of the evaluation, and the identity of the person(s) performing the training or evaluation.

So the app was recording one of the three as though it were all of them. The evaluation is
understood to be happening on the floor; it had nowhere to be filed.

## What has been built, and what it is stamped

- A practical evaluation is now its own record (`training_practical_evaluations`), signed by a
  named evaluator through the password gate, with each task graded
  **Competent / Needs practice / Not evaluated**.
- A certification is **derived** from the pair — a passed written test and a signed passing
  evaluation — and is not stored, so it cannot go stale.
- The printable certificate carries the four facts (l)(6) names, plus the truck type and the
  re-evaluation date, and is **refused** while somebody is not certified.
- **Every record is stamped `DRAFT-1`** and every screen that shows the form says so.

## The three decisions for Document Control

1. **Is a form number issued for this?** There is nothing in the Master Index that covers a
   practical evaluation of a truck operator. FORM 702-01 (Daily Forklift Inspection) is the
   machine, not the operator. Once a number is issued, the code takes it, `controlled.js` parks
   the change for approval, and records already filed under DRAFT-1 are never re-stamped.

2. **Is the drafted wording adopted?** The items below were **drawn from the standard's own topic
   list at 1910.178(l)(3)**, not written from scratch and not transcribed from a plant form,
   because no plant form was supplied. **If the plant already has a practical evaluation sheet,
   send it and it will be transcribed verbatim instead** — that is the preferred outcome and the
   mechanism was built to make the swap cheap.

3. **Does the pallet jack get one too?** PJ-101 (Electric Pallet Jack Safety) is a powered
   industrial truck under the same rule and carries the same 36-month cadence, but it has no
   written test — none was supplied — and no evaluation form has been drafted for it. Deliberately
   not assumed either way.

## The drafted items (DRAFT-1)

Graded per item: **Competent · Needs practice · Not evaluated**. Any "needs practice" fails the
evaluation and the failing tasks are named. "Not evaluated" requires a reason and is **printed on
the certificate by name**, so what was and was not observed is on the face of the document.

### Pre-use inspection
- Completes the daily inspection before use and records it
- Checks fluids, tyres, forks, chains and the mast for damage
- Checks brakes, steering, horn, lights and the seat belt
- Takes the truck out of service and reports any defect before use

### Starting and controls
- Mounts and dismounts using three points of contact, never jumping
- Fastens the seat belt and keeps all body parts inside the truck
- Starts, accelerates, steers and stops smoothly and under control

### Travelling
- Travels with the forks low, 2 to 4 inches off the floor, and tilted back
- Keeps to a safe speed for the surface and the load
- Travels in reverse when the load blocks the view forward
- Sounds the horn and slows at corners, doorways and blind spots
- Yields to pedestrians and keeps a safe distance from people and racking

### Load handling
- Checks the load against the data plate and does not exceed capacity
- Squares up, sets fork width, and enters the pallet fully
- Keeps the load centred and stable; does not lift or lower while moving
- Stacks and destacks squarely, with the mast vertical at height

### Ramps, docks and trailers
- On a ramp, travels with the load upgrade and does not turn on the grade
- Confirms the trailer is chocked or restrained before entering
- Checks the dock plate and the trailer floor before driving on

### Parking, shutdown and charging
- Parks clear of aisles and exits, forks fully lowered
- Neutral, brake set, key removed before leaving the truck
- Follows the refuelling or battery-charging procedure, with PPE

**The Spanish is a draft too.** Each item carries a Spanish line in
`server/practical-evaluations.js`. The forklift quiz's Spanish is the plant's own wording and was
never machine-translated; this form's Spanish was drafted alongside its English and should be read
by a Spanish-speaking supervisor before the form is issued.

## Not claimed

That the evaluation items are the complete set for this facility. 1910.178(l)(3)(ii) makes the
workplace-related topics site-specific — ramp grades, aisle widths, the surfaces actually driven
on, hazardous locations — and a walk of the building by whoever runs the evaluations may add items
or drop ones that do not apply here. That is exactly the review this DCR is asking for.
