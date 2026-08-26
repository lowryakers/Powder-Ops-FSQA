# Red-line review — Protocol 003 (Food Safety Plan V4) and Protocol 001 (Food Defense Plan V2)

**Draft for review · 25 August 2026 · 68 findings · nothing changed in either document**

| | Must fix | Should fix | Consider | Total |
|---|---|---|---|---|
| Protocol 003 — Food Safety Plan V4 | 9 | 21 | 4 | **34** |
| Protocol 001 — Food Defense Plan V2 | 9 | 17 | 4 | **30** |
| Both documents | 1 | 1 | 2 | **4** |
| | **19** | **39** | **10** | **68** |

Every finding is numbered so it can be accepted, rejected or deferred one at a time. Nothing here has
been applied. The intended path is: review this → decide each item → issue the DCR → Document Control
publishes V5 / V3 → the team approves and adopts.

---

## How to read this

**Severity**

| | Meaning |
|---|---|
| **MUST** | Wrong as a matter of fact, structure, or describes a control the plant does not have. An auditor finds these by reading. |
| **SHOULD** | Undermines a controlled document — spelling, grammar, an unfilled blank — or a gap against a standard normative reference. |
| **CONSIDER** | An improvement or a judgement call. Reasonable people can decline these. |

**What I checked against, and what I did not.** On file and used: the **NSF/ANSI 455 Certification
Policies** (2 Sept 2025), the **NSF 306 Certified for Sport guideline** (9 Jan 2026), and the **NSF GMP
for Sport Audit Guide**. The Policies document names 455-2's normative references, and that list is the
basis of several findings below:

> **NSF/ANSI 455-2** → 21 CFR Part 111, 21 CFR Part 117, 21 CFR Part 11, 21 CFR Part 1.5 Subpart L,
> 21 CFR Part 1.9 Subpart O.

**Not on file and therefore not cited by clause: NSF/ANSI 455-2 itself, and the SQF Food Safety Code.**
Where a finding rests on SQF, it is argued from substance and marked as unverified — the same rule
`docs/SQF-NSF-gap-analysis.md` follows. Get both documents and the clause numbers can be added.

**One caveat on the text.** Both plans were read from the PDF text layer, which splits table cells
across columns. Anything that could be an extraction artefact rather than a real error is marked
**[verify in source]**. Prose sections extracted cleanly; the hazard-analysis and preventive-control
tables did not.

---

# Part 1 — Protocol 003, Food Safety Plan V4

## 1A. Must fix

### FSP-01 · The company's own name is misspelled in the opening line
**Structure · Process Description, "Overview"**

> ~~Power-Ops~~ **Powder-Ops** is a contract manufacturing company that specializes in a variety of
> dietary supplement products.

The first sentence of the plan's substantive content. Nothing else in either document spells it this
way.

### FSP-02 · The Rework row describes a control the plant does not have
**Content · Hazard Analysis, "Rework"**

> ~~Metal detection at the metal detection process step during tub filling.~~ X ray is inspected
> finished good.

V3's own revision note reads *"Removed any Magnetic Detection information"*, and the plant runs an
X-ray, not a metal detector. This is residue of the V1 change that added magnets. An auditor reading
the plan will ask to be shown the metal-detection step at tub filling, and there is not one.
*Already DCR item 2.*

### FSP-03 · Screens: the chart and the Process Description state different controls
**Content · PC #3 vs Process Description, "Screens"**

Chart: *"Freq: at the beginning of every machine start up."*
Process Description: *"The mesh size (50 mesh or 70 mesh) is recorded as well as the condition of the
screen at the beginning and at the end of each batch."*

The second is stricter and names two facts the chart does not — **mesh size used** and **screen
condition**. A screen intact at start-up and torn at the end is precisely what this control exists to
catch, and only the second reading catches it. *Already DCR item 1.*

**Recommendation:** adopt the Process Description's wording into the chart.

### FSP-04 · PC #1's critical limit is stated in a unit only its verification step produces
**Content · PC #1**

Critical limit *"No more than 35 RLU"*; monitoring is *"Application of cleaning. Visual inspection
prior to set up"*; verification is *"ATP swabs and visual inspection."*

RLU is what an ATP swab reads — nothing else in the process produces one. So the plan sets a numeric
limit and then monitors the control by eye, with the instrument that reads the number on the
verification leg. Whichever leg carries the number is the leg software can enforce; as written, the
stated critical limit is not attached to its monitoring step. *Already DCR item 3.*

**Recommendation:** move the ATP swab to monitoring, leave visual inspection as verification. This
also matches the Process Description: *"Product contact surfaces are swabbed using ATP swabs prior [to]
the start of a production run."*

### FSP-05 · Three signature lines are blank on a document marked Approved / Effective
**Structure · Cover page**

> SQF Practitioner: ______ Date: ______
> Preventive Controls Qualified Individual: ______ Date: ______
> Plant Manager: ______ Date: ______

The document's status in ReadyDoc is *Approved / Effective* with an effective date of 2026-06-25. An
approved food safety plan with an unsigned approval block is one of the first things an auditor checks.
Either sign it, or the cover page should not carry blanks.

### FSP-06 · The QA/QC Manager is named differently in the two plans
**Consistency · Preventive Control Food Safety Team**

Protocol 003 lists **Carol Pierce, QA/QC Manager**. Protocol 001 lists **Carol Rojas, Quality, Plan
Coordinator**, and the AIB Food Defense Coordinator certificate on file is in the name **Carol Rojas**.
One person under two names, or two people. Both plans must agree.

### FSP-07 · The revision history uses two numbering schemes
**Structure · Revision History**

Row one is `0`; every row after is `V1`, `V2`, `V3`, `V4`. Make the first row **`V0`**, or restate it
as "Original issue".

### FSP-08 · The plan names records it does not say where to find
**Content · Preventive Control Chart, "Record Keeping"**

All four controls point at the batch production record or a document attached to it. **Those records
are on paper today, logged in MRPEasy** — not in Keychain, not in ReadyDoc. The plan should say where
its records are kept and for how long, because "Cleaning log Checklist in batch production record"
answers *what* but not *where*, and an auditor asks for a named record on a date they choose.

**Recommendation:** add a short **Records** section naming, per control, the record, the form number,
where it is held, and the retention period. See FSP-29.

## 1B. Spelling and grammar

### FSP-09 · "verifies" → "verify"; "allergen" → "allergens" *(two occurrences)*
**Hazard Analysis — Receiving/Incoming raw material, and Sampling/Raw material**

> Allergen swabs are used to ~~verifies~~ **verify** that the surfaces are free of
> ~~allergen~~ **allergens**.

### FSP-10 · "intended used" → "intended use" *(three occurrences)*
**Hazard Analysis — Receiving Packaging materials ×2, Sampling Packaging material**

> …a letter of guarantee from the manufacturer that states that all products are approved for their
> intended ~~used~~ **use**.

### FSP-11 · "Peices" → "Pieces"
**Hazard Analysis — Formulation/Blending**

> P – ~~Peices~~ **Pieces** of plastic from liner

### FSP-12 · "prior accepting" → "prior to accepting"
**Hazard Analysis — Receiving/Incoming raw material**

> All raw materials are checked against their COA **prior to** accepting them in the facility.

### FSP-13 · "prior the start" → "prior to the start"
**Process Description — Microbial Verification**

> …swabbed using ATP swabs **prior to** the start of a production run…

### FSP-14 · "as outline" → "as outlined"
**PC #1 — Monitoring**

> How: Procedure as ~~outline~~ **outlined** in cleaning SOP.

### FSP-15 · "prior going" → "prior to going"
**PC #3 — Monitoring**

> How: Raw ingredients are sifted **prior to** going into the super sack.

### FSP-16 · Subject/verb disagreement
**Process Description — Receive Packaging Material**

> All received packaging ~~material are~~ **materials are** inspected and compared to the vendor
> specification before release to manufacturing.

### FSP-17 · "personal hygiene" and "personnel hygiene" both used
**Hazard Analysis — Formulation/Weigh Up vs Rework**

Pick one. **"personnel hygiene"** matches the surrounding text ("environment and personnel hygiene
practices").

### FSP-18 · "X ray is inspected finished good"
**Hazard Analysis — Rework**

> ~~X ray is inspected finished good.~~ **The X-ray inspects finished goods.**

Also standardise on one spelling of **X-ray** throughout; the document currently uses *X-Ray*, *X-ray*
and *X ray*.

### FSP-19 · "before entering to weigh up and production areas"
**Process Description — GMP Controls**

> …and wash their hands before entering ~~to~~ **the** weigh-up and production areas.

Also **"mouth covering"** → **"mouth coverings"** in the same sentence.

### FSP-20 · "Add magnets" → "Added magnets"
**Revision History, V1**

Every other remark in the column is past tense.

### FSP-21 · "in quarantine area floor"
**Process Description — Receive Ingredients**

> …the ingredient is placed on hold **in the quarantine area** until the COA is received.

### FSP-22 · "start up" → "start-up"
**PC #3 — Monitoring.** Hyphenated when used as a noun.

## 1C. Content and standards

### FSP-23 · The plan cites no regulation anywhere · **SHOULD**
Neither plan contains the string "21 CFR". The hazard analysis is laid out in the standard 21 CFR 117
preventive-controls format and the plant holds PCQI certificates, so name the basis in a Scope section:
21 CFR Part 117 for the preventive controls, 21 CFR Part 111 for the dietary-supplement CGMP that
NSF/ANSI 455-2 is built on.

### FSP-24 · No reanalysis trigger other than the annual review · **SHOULD**
The plan should say when it is reanalysed **other than on a schedule**: a change in process, equipment,
supplier or product; a newly identified hazard; and after any failure of a preventive control. As
written, a new piece of equipment could arrive without anything requiring the plan to be revisited.

### FSP-25 · Foreign Supplier Verification is not addressed · **SHOULD**
**21 CFR Part 1 Subpart L is a normative reference for NSF/ANSI 455-2** (Policies, "Certification
Normative References"). Neither plan mentions FSVP or imported ingredients. If **any** ingredient is
imported, this is a named gap. If none is, one sentence saying so closes it.

### FSP-26 · Sanitary Transportation is not addressed · **SHOULD**
**21 CFR Part 1 Subpart O is also a normative reference for 455-2.** The Food Defense Plan discusses
transport as a *security* vulnerability; neither plan addresses transport as a *sanitation* control —
carrier requirements, temperature, cleanliness of the conveyance, records.

### FSP-27 · Electronic records are not mentioned · **CONSIDER**
**21 CFR Part 11 is a normative reference for 455-2**, and ReadyDoc is where a growing share of these
records live, with e-signatures, an append-only audit trail and revocation. The plan should say that
records may be maintained electronically and name the system. Silence invites the question at audit
rather than answering it.

### FSP-28 · Banned and prohibited substances are not referenced · **SHOULD**
NSF GMP for Sport **§6.2.2** requires that references to the NSF 306 Annex C, NFL/NFLPA, MLB and WADA
lists be *"incorporated as part of their applicable operating procedures"*, and **§6.2.3.1** requires a
documented **annual review** of those lists. A draft *Banned and Prohibited Substance Control Program*
already exists in the registry (`SOP-DRAFT-BSC`) — the plan should reference it once Document Control
assigns it a number.

### FSP-29 · Record retention is not stated · **SHOULD**
21 CFR 111.605 sets retention at one year past shelf life or two years past distribution, whichever is
longer. The plan names records and never says how long they are kept.

### FSP-30 · The allergen preventive control has no program behind it · **CONSIDER**
PC #2 and several hazard rows turn on allergen control, and the Process Description describes real
practice — scooping allergens at the end of the batch, gown changes, a full room clean verified by
swab, a dedicated allergen storage location. **None of that is a referenced document.** An allergen
control program (matrix, segregation, scheduling, changeover validation, label declaration) is what an
auditor asks for after reading PC #2.

### FSP-31 · Supply-chain controls are described but not categorised · **CONSIDER**
Several hazard rows justify a "No" on the strength of supplier qualification and letters of guarantee —
which is the reasoning behind a **supply-chain preventive control**, a category 117 names explicitly.
The chart has none. Either add one, or state in the justification why the control is not required.

### FSP-32 · "the amount of the missing ingredient" is ambiguous · **CONSIDER**
**Process Description — Rework.** *"Rework during blending operations is allowed if the amount of the
missing ingredient is known."* Read plainly this is about a spill, where what is lost must be
quantified. **"Spilled"** or **"lost"** would say it.

### FSP-33 · The process flow diagram is referenced but absent · **MUST** *[verify in source]*
The table of contents lists **Process Flow Diagram, page 4**, and the heading appears — with no diagram
beneath it. Either the diagram did not survive the PDF, or it is genuinely missing. A hazard analysis
without a process flow is a finding on its own.

### FSP-34 · "CCP" and "preventive control" are used interchangeably · **SHOULD**
The chart's columns say *Operational PC Step* and *Preventive Control*; V2's revision note says
*"Added X-ray as a **CCP**"*; Policy 002 calls the approach *"a validated HACCP-based approach"*. All
three are defensible and they should be deliberate. **This is the first item of the vocabulary pass.**

---

# Part 2 — Protocol 001, Food Defense Plan V2

## 2A. Must fix

### FDP-01 · Two sections are lettered "D"
**Structure · §3 Potential Vulnerabilities**

The sequence runs **A** Ingredient, **B** Facility, **C** Supply Chain, **D** Process, **E** Personnel,
**D** External. The second **D** should be **F**.

### FDP-02 · Numbering jumps inside §3E
**Structure · §3E Personnel Vulnerabilities**

Items run 1, 2, 3, then **6. Employee Practices**, **7. Sanitation**. Either items 4 and 5 were removed
without renumbering, or the last two belong in another section — *Sanitation* in particular reads as a
process vulnerability rather than a personnel one.

### FDP-03 · "Page 10 of 9"
**Structure · Footer.** The last page numbers itself beyond the total.

### FDP-04 · The revision number in ReadyDoc disagrees with the document
**Consistency · Document metadata**

ReadyDoc records the document as **Revision 1.0**. The document's own footer and revision history say
**V2**. A record filed against the wrong revision is exactly what the registry exists to prevent.

### FDP-05 · "work legibility" → "work eligibility"
**Content · §6C1 Background Checks**

> All employees are screened for work ~~legibility~~ **eligibility** before hiring.

The wrong word, in the sentence describing the control.

### FDP-06 · "a specified period" is never specified — four times
**Content · §10 Record Keeping**

Surveillance footage, access logs, inspection reports and training records are each to be kept *"for a
specified period"*, and no period is given anywhere in the plan. An auditor will ask, and the plan
cannot answer itself.

### FDP-07 · Name disagreement with Protocol 003
See **FSP-06**.

### FDP-08 · "05/202025" is not a date
**Structure · Revision History, V1.** Presumably 05/2025 or 05/20/2025.

## 2B. Spelling and grammar

### FDP-09 · Four e-mail addresses are missing their domain suffix
**§1 Food Defense Team**

`Jake@powder-ops`, `Maria@powder-ops`, `daniela@powder-ops`, `Lowry@powder-ops` → **`…@powder-ops.com`**,
matching Carol's and Adam's entries. A contact list that cannot be used is the one thing a food defense
plan must get right.

### FDP-10 · "Email: Powder-ops.com" is a website, not an e-mail address
**Facility header.** Either a real address, or relabel the line **Website**.

### FDP-11 · "contract manufacturer company"
**Facility Description** → **"contract manufacturing company"**, matching Protocol 003.

### FDP-12 · A stray comma splits one ingredient into two
**§2 Product/Process Description**

> …guar gum, ~~digestive, enzymes~~ **digestive enzymes**, stevia extract…

### FDP-13 · "non fat milk" → "nonfat milk"
**§2.** Also appears as "Non-fat Milk Powder" in §3A — standardise.

### FDP-14 · "Adults over 18-year olds"
**§2 Intended Consumers** → **"Adults aged 18 and over"**.

### FDP-15 · "a escort" → "an escort"
**§6C2 Visitor Management**

### FDP-16 · "access the manufacturing through keypad-controlled doors"
**§6A2 Access Control** → "access the manufacturing **area** through…"

### FDP-17 · The intended-use cell is garbled
**§2** *[verify in source]*

> Single serving dietary supplements/ food portable, mess free portion.

Reads as two phrases run together. Suggested: **"Single-serving dietary supplement and food products
in a portable, mess-free portion."**

### FDP-18 · Confirm the spelling of a team member's surname
**§1** — listed as **Lowry Akens**. Confirm against the roster.

### FDP-19 · Stray characters in a section heading
**§2** *[verify in source]* — extracts as `2. :C¿ Product/Process Description`.

### FDP-20 · The risk threshold symbol did not render
**§5** *[verify in source]* — extracts as `Risk Level "e 12`, presumably **≥ 12**.

## 2C. Content and standards

### FDP-21 · The plan does not cite the regulation it answers · **SHOULD**
The FDA Intentional Adulteration rule, **21 CFR Part 121**, is the basis of a food defense plan for a
registered facility. Naming it, and the facility's FDA registration number (which the plan already
carries), makes the plan self-evidently responsive.

### FDP-22 · "Actionable process step" is not used · **CONSIDER**
Part 121 turns on identifying **actionable process steps** and assigning **mitigation strategies** to
each, with monitoring, corrective actions and verification. The plan's §3–§7 do this in substance under
different names. Adopting the regulation's vocabulary makes the mapping obvious rather than
inferential.

### FDP-23 · No Food Defense Qualified Individual is named · **SHOULD**
Part 121 requires the vulnerability assessment and mitigation strategies be prepared by, or overseen
by, a qualified individual. **Carol Rojas holds an AIB Food Defense Coordinator certificate**, which is
on file — the plan lists her as *Plan Coordinator* without naming the qualification. State it.

### FDP-24 · The reassessment interval should be stated explicitly · **CONSIDER**
Part 121 expects reanalysis at least every three years, and on change. §11 commits to an **annual**
review, which is stricter and good — say so, so a reader can see the plan exceeds the requirement
rather than wondering whether it was considered.

### FDP-25 · The mock incident has no form and no record · **SHOULD**
§9.2 requires a mock incident **at least once every two years**. Nothing in the Forms Master Index
answers to it and no record exists. The plan's own verification of itself is the part with no evidence
behind it.

### FDP-26 · The internal audit named as verification cannot verify this plan · **MUST**
§9.1 makes internal audits a verification activity for the food defense plan. **Form 403-01 has 19
sections and none of them is food defense.** Either add a food defense section to 403-01, or name a
different verification activity here.

### FDP-27 · Banned and prohibited substances · **CONSIDER**
See **FSP-28**. NSF GMP for Sport §6.2.2 wants the prohibition embedded in operating procedures, and
preventing a banned substance from entering the facility is squarely a food defense control. A
cross-reference from §6B1 (Receiving Procedures) would do it.

### FDP-28 · Confirm the employee counts · **CONSIDER**
§ Facility header: 37 full-time, 1 part-time. Confirm these are current at re-issue; they are the kind
of number an auditor spot-checks against the roster.

### FDP-29 · The highest-scored mitigation has no record · **SHOULD**
§5.4 mitigates *intentional adulteration by an employee* — joint-highest risk at 15 — with *"Require
employees to never work alone and adequate monitoring of footage."* Nothing records whether anyone
worked alone, and nothing records that footage was reviewed. A mitigation strategy with no monitoring
record is the gap Part 121 is most pointed about.

### FDP-30 · The risk matrix has no scoring key · **SHOULD**
Likelihood and impact are scored 1–5 with no definition of what each value means. Two people scoring
the same vulnerability will disagree, and the reassessment in §11 cannot be compared to this one.

---

# Part 3 — Both documents

### X-01 · Neither plan says where its records are kept · **MUST**
See FSP-08 and FDP-06. This is the single most consequential omission across both documents, and it
became more pressing this week: the preventive-control records are on paper in MRPEasy, mid-migration,
and neither plan says so.

### X-02 · One vocabulary, chosen deliberately · **SHOULD**
*Preventive control* / *CCP* / *HACCP* across Protocol 003, Policy 002 and the revision history. See
FSP-34. Decide once, apply to all three documents in the same revision.

### X-03 · Approver and owner are the same person on Protocol 003 · **CONSIDER**
Protocol 003 records **Owner: Daniela Servin** and **Approved By: Daniela Servin**. Protocol 001 is
better — approved by Carol Rojas, reviewed by Adam Bliss. Independent approval is the norm an auditor
expects, and the plant already demonstrates it on the other plan.

### X-04 · Add a Scope and Normative References section to both · **CONSIDER**
Half a page naming what each plan covers, which regulations and schemes it answers (21 CFR 117 / 111 /
121, NSF/ANSI 455-2, SQF), and which documents it depends on. It is also exactly the section the
**document reference graph** would read to build the hub-and-spoke links — a plan that names its
dependencies gets them enforced.

---

# Part 4 — What I could not check

- **NSF/ANSI 455-2 itself** and the **SQF Food Safety Code** are not on file. Findings resting on them
  are argued from substance, not cited by clause.
- **The process flow diagram** (FSP-33) — whether it is missing from the document or only from the
  text extraction.
- **Anything held only in the tables' visual layout.** Merged cells, strike-throughs and any handwritten
  annotation do not survive text extraction.
- **Whether the practices described are what the plant actually does.** This is a review of two
  documents against each other, against the standards on file, and against what ReadyDoc holds. It is
  not a review of the floor.
