# Document Change Request — Protocol 003, Food Safety Plan V4

**Draft for Document Control (Daniela Servin) · raised 24 August 2026 · FORM 406-1**

Three internal contradictions found by walking Protocol 003 V4 against the software that has to
implement it. **None is a software change and none should be fixed in the software** — a control the
plan states two ways cannot be wired one way, and picking a reading without Document Control is the
app quietly deciding a food safety question.

Each item below gives the two conflicting passages verbatim, why it matters, and a recommendation
Document Control is free to overrule. Nothing has been changed in ReadyDoc on account of any of them.

---

## Item 1 — Screens: monitored at start-up, or at start *and end* of every batch?

**Preventive Control Chart, PC #3, Monitoring:**
> "What: All product passes through a 50 or 70 mesh size screen. How: Raw ingredients are sifted prior
> going into the super sack. **Freq: at the beginning of every machine start up.** Who: Qualified line
> operator."

**Process Description, "Screens":**
> "Screens are used to prevent physical contaminants from being potentially introduced to the blend.
> The mesh size (50 mesh or 70 mesh) is recorded as well as the condition of the screen **at the
> beginning and at the end of each batch**."

**Why it matters.** These are different controls, not different wordings. The Process Description is
stricter — it doubles the frequency and names two facts the chart does not: the **mesh size used** and
the **condition of the screen**. A screen that was intact at start-up and torn at the end is exactly
the finding this control exists to catch, and only the second reading catches it.

It also decides what a record has to hold. Today ReadyDoc records `sifter_no` — *which* sifter — and
neither mesh size nor condition, so whichever reading is correct, the record is currently short of it.

**Recommendation.** Adopt the Process Description's wording into the chart: start **and** end of each
batch, recording mesh size and screen condition. It is the stricter of the two, it is what the plant
already describes itself as doing, and the chart's "Record Keeping" column already says *observations
on batch record*, which can carry both.

---

## Item 2 — The Rework row still references metal detection

**Hazard Analysis, "Rework", justification column:**
> "P- Pieces of metal may be present in raw material or introduced during the process from equipment
> used. … **Metal detection at the metal detection process step during tub filling.** X ray is
> inspected finished good."

**Revision History, V3, 11/19/2025:**
> "**Removed any Magnetic Detection information**, changed formatting."

**Why it matters.** The plant runs an X-ray, not a metal detector — confirmed at the July audit — and
V3's own revision note says this content was removed. The sentence is residue of the V1 change that
added magnets ("Add magnets to prevent metal contamination", 09/24/2024). An auditor reading the plan
will ask to be shown the metal detection step at tub filling, and there isn't one.

This is the sharpest of the three, because it describes a control the plant does not have.

**Recommendation.** Strike the metal-detection sentence. The remaining wording — X-ray inspection of
finished good — already states the control that is actually applied, and PC #4 defines it properly.

---

## Item 3 — PC #1 states its limit in RLU but names the ATP swab as *verification*, not monitoring

**Preventive Control Chart, PC #1:**
> Critical Limit: **"No more than 35 RLU"**
> Monitoring: "What: Application of cleaning. **Visual inspection prior to set up.** How: Procedure as
> outline in cleaning SOP. Freq: At the beginning of every run. Who: Qualified quality assurance
> specialist."
> Verification: **"ATP swabs and visual inspection."**

**Why it matters.** The critical limit is a number in RLU. **RLU is what the ATP swab produces** —
nothing else in the process yields one. So the plan sets a numeric limit, then monitors the control by
eye and puts the instrument that reads the number on the verification leg.

The practical consequence is direct: whichever leg carries the number is the leg the software can
enforce. ReadyDoc can grade a reading against 35 RLU and refuse to file an over-limit swab as a pass —
it cannot grade a visual inspection. As written, the plan's own critical limit is not attached to its
monitoring step.

It also affects who does what: monitoring and verification are meant to be separable activities, and
Item 3 has the same qualified QA specialist doing both, using the same instrument.

**Recommendation.** Move the ATP swab onto the **monitoring** leg, where the 35 RLU limit is read and
recorded at the beginning of every run, and leave visual inspection as verification. This is the
smallest change that makes the stated critical limit enforceable, and it matches what the Process
Description already says: *"Product contact surfaces are swabbed using ATP swabs prior the start of a
production run to verify that the contact surface is cleaned."*

If Document Control prefers the current split, that is a legitimate decision — but then the plan
should state the limit on the leg that carries it, or the number has no monitoring step to belong to.

---

## Not part of this DCR, listed so it is not lost

- **The plan's signature block is unsigned** on all three lines (SQF Practitioner, PCQI, Plant
  Manager) while the document is *Approved / Effective* in ReadyDoc.
- **Carol Pierce / Carol Rojas.** Protocol 003's PC team lists "Carol Pierce, QA/QC Manager"; Protocol
  001 lists "Carol Rojas, Quality, Plan Coordinator", and the certificate on file is in the name Carol
  Rojas. One person under two names, or two people — either way both plans should agree.
- **"Preventive control" vs "CCP".** Protocol 003 is a 21 CFR 117 preventive-controls plan by
  structure, its V2 revision note says "Added X-ray as a **CCP**", and Policy 002 calls the approach
  "HACCP-based". All three can be defensible; they should be deliberate. This is the first item of the
  vocabulary pass.
