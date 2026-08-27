# Wave 2 — the four SOPs the auditor named

**Draft for review · 27 August 2026 · 46 findings · nothing changed in any document**

| | Must fix | Should fix | Consider | Total |
|---|---|---|---|---|
| Document control, across all four | 5 | 3 | 0 | **8** |
| SOP 404 — Supplier and Laboratory Qualification | 5 | 4 | 2 | **11** |
| SOP 421 — Design/Qualification of Facility/Equipment | 3 | 3 | 1 | **7** |
| SOP 434 — Chemical, Equipment and Services Approval | 4 | 3 | 1 | **8** |
| SOP 604 — Environmental Monitoring Program | 7 | 5 | 0 | **12** |
| | **24** | **18** | **4** | **46** |

Same rules as the plan red-line: three severities applied strictly, every finding numbered so it can be
accepted, rejected or deferred one at a time, and `[verify in source]` on anything that still needs a
second pair of eyes.

---

## The documents arrived, and what that changed

**This review ran in two passes.** The first was the **D-002 test** — *does this SOP require something
that has no program, no form and no record behind it?* — answerable from the auditor's words and
ReadyDoc's tables alone, and it produced findings W2-01 to W2-19. The second pass, added 27 August after
all four documents were supplied, is the **wording review** the first pass could not do: W2-20 to W2-43.

**The second pass did not overturn the first.** Every D-002 finding held. What the documents added is
worse than what the tables suggested, in one specific and repeated way: **where ReadyDoc has no record,
the SOP usually has no form number either.** The gap is not that the software fell behind the documents.
It is that both are thin in the same places.

### Three things resolved by reading the documents

| Was | Now |
|---|---|
| **W2-03** SOP 604's dates disagree `[verify in source]` | **Confirmed, and it is not just 604.** All four documents disagree with themselves — see W2-21. |
| **W2-14** Does SOP 434 require QC approval? | **The document is fine.** § 9 makes the QA/QC Manager the final approver. **ReadyDoc is the gap** — its DCR flow routes to Document Control only. |
| **W2-15** Do SOP 434 and SOP 700 conflict? | **No conflict.** 434 is the approval *process*; § 10 says "update master list of approved chemicals", which is FORM 700-01, the *list*. They are complementary — but 434 never cites 700-01 by number. |

### And one piece of genuinely good news

**These SOPs cite other documents by number, which the two plans did not.** SOP 404 cites SOP 607; SOP 604
cites SOP 600 and SOP 601. D-027 stopped the document reference graph because Protocol 003 and Protocol 001
cite nothing at all. **The registry's SOPs are a better starting corpus for that graph than the plans
were** — which changes the sequencing question for OBL-18.

---

## Part 1 — Document control, found without reading a single one of them

These four came out of comparing the auditor's citations against the plant's own **Document Change
Request log** — 159 rows, seeded verbatim in `server/qms-seed.js`. They need no SOP text and they are
the most immediately actionable findings in this review.

### W2-01 · Neither SOP 421 nor SOP 434 appears anywhere in the Document Change Request log · **MUST**

The auditor read both, and cited each by revision and effective date. The plant's own change log — every
new document and every revision since May 2025 — has **no row for either**. Not a *New Document* row,
not a *New Revision* row. (Verified by reading all 159 rows; the only occurrences of "421" and "434"
anywhere in that file are coincidental digits inside a phone number and a product code.)

There are only two explanations and both matter. Either the two documents were issued outside the DCR
process, which is a document-control nonconformance waiting to be written the next time somebody looks;
or the log is incomplete, which means the log cannot be relied on to answer the question it exists to
answer. **An auditor who asks "show me the change history for SOP 434" gets nothing today.**

*This is the finding I would fix first, because it costs a morning and it is the kind an auditor finds
in five minutes.*

### W2-02 · SOP 404 is at V4 in practice, V3 in the log, and its title has changed · **MUST**

DCR **0005** records `SOP 404 · Supplier Qualification · V3 · New Revision · 05/20/2025`. The auditor
read `SOP 404 · Supplier **and Laboratory** Qualification · **V4** · 8/4/26`.

So between those dates a revision was issued **and the document's scope widened to cover laboratories**,
and no change request records either. The scope change is the part that matters: adding laboratory
qualification to an SOP is a substantive change to what the plant has committed to do, and it happened
without a DCR row.

Same class as FDP-04 in the plan red-line (registry says 1.0, document says V2) — a document's identity
recorded in two places that disagree.

### W2-03 · SOP 604's effective date is eight months after its last change request · **SHOULD**

DCR **0050** records `SOP 604 · Environmental Monitoring Program · V2 · New Revision · 10/17/2025`. The
auditor read `V2 · 6/29/26`. **Same revision, two dates eight months apart.**

Softer than the two above, because a change-request date and an effective date are legitimately
different things, and a document can be re-dated at review without a revision. But if V2 became
effective in June 2026 and its change request was raised in October 2025, the document should say why.
`[verify in source — the SOP's own footer settles this]`

### W2-04 · Nothing reconciles the change log against the document registry · **SHOULD**

The DCR log is imported into the **QMS register** as `document_change_request` records. The document
registry is `sop_documents`, a **different table**, populated by upload. Nothing compares them, in
either direction.

That is why W2-01 and W2-02 survived: a document can exist in the registry with no change history, or
have a change history and never reach the registry, and no screen in ReadyDoc reports either. **The
recurring defect of this codebase — a fact in more than one place with no owner — at the level of the
document register itself.**

This belongs in the mechanical sweep (step 3 of the method), as two rules: *in the log, absent from the
registry* and *in the registry, absent from the log*. It is cheap and it runs forever after.

---


### W2-20 · None of the four documents is signed · **MUST**

Every one of them carries an approval block, and in every one **the Dept. Approval and Q.A. Approval
signature and date fields are empty**:

```
Author: Matt Schramm 04/09/2024 | Dept. Approval Signature: Date | Q.A. Approval Signature Date
```

SOP 404 has no author filled in either, in **either** of the two revisions the file contains.

These are effective documents. The auditor read all four and cited them by revision. **A controlled
document that has never been signed has not, in the sense the standard means, been approved** — and this
is the generalisable rule the red-line method already proposed for the mechanical sweep ("approved but
unsigned"). Four for four says it is not an oversight on one document; it is how they are being issued.

### W2-21 · Every one of the four disagrees with itself about when its current revision took effect · **MUST**

Each document states its revision date twice — in the page header, and in its own revision-history table.
**They disagree in all four:**

| Document | Page header | Revision history | DCR log | The auditor read |
|---|---|---|---|---|
| SOP 404 **V3** | 06/25/2026 | 05/20/2025 | 05/20/2025 | — |
| SOP 404 **V4** | 08/04/2026 | 08/04/2026 ✓ | *absent* | 8/4/26 |
| SOP 421 V2 | 08/11/2026 | 06/25/2026 | *absent* | 8/11/26 |
| SOP 434 V2 | 08/11/2026 | 10/05/2025 | *absent* | 6/25/26 |
| SOP 604 V2 | 06/29/2026 | 05/20/2026 | 10/17/2025 | 6/29/26 |

Only SOP 404 V4 agrees with itself. **SOP 434 is out by ten months and SOP 404 V3 by thirteen.**

Two patterns are worth Daniela's eye. **SOP 421 and SOP 434 carry the identical header date, 08/11/2026** —
they appear to have been edited together and the header stamped on both. And **06/25/2026 appears three
times in three different roles**: as SOP 404 V3's header, as SOP 421's revision-history entry, and as the
date the auditor recorded for SOP 434 — which matches nothing in SOP 434's own file. Either 434 changed
after the audit, or the auditor was given a different copy. `[verify — this one needs the version that was
handed over during the audit]`

### W2-22 · The SOP 404 file contains two complete revisions of the document · **MUST**

The file supplied is named V3 and holds **V3 in full (8 pages) followed by V4 in full (8 pages)**, each with
its own headers, its own table of contents and its own revision-history table. The V4 half is separated from
the V3 half by a single line reading `V4`.

Whoever opens that file can read either revision, and nothing in it says which one is in force. That is the
same failure as a superseded copy left on the shared drive, except it is inside the controlled file.
**Supersede V3 and issue V4 as its own document.**

### W2-23 · Section numbering is wrong in three of the four · **SHOULD**

- **SOP 404** — the contents page numbers two different sections **VI** (*Record Keeping* and *References
  and related documents*), gives Record Keeping no page number at all, and the revision history is headed
  **XIII** in a document with six sections. V4 adds a section (Laboratory Qualification) and **does not
  appear in the contents at all**, nor does the page count change from 8.
- **SOP 434** — the revision history is headed **VI** in a document whose contents page lists five sections.
- **SOP 421** — heads it **V**, which is correct, and is the only one of the three that is.

Individually trivial. Together they are what an auditor reads as a document-control system that is not
being checked, and they are exactly what a mechanical rule catches for free across the whole registry.

## Part 2 — SOP 404 · Supplier and Laboratory Qualification

> **The auditor:** *"The Supplier Qualification Questionnaire required per SOP 404 was not available for:
> Mill Haven Foods (Whey Protein), M4 Dynamic (Potassium Citrate, B12), Bay State Milling (Cinnamon)."*
> — NSF/ANSI 455-2 § 4.3.1 · 21 CFR 117.405 & 117.410

| The D-002 test | |
|---|---|
| **Program** | The SOP exists. Its coverage cannot be assessed without the text. |
| **Form** | FORM 404-1 *Supplier Qualification Questionnaire* V2, FORM 404-2 *Raw Material Questionnaire* V1 — both in the Master Index, both `where: keychain`, and per D-021 **neither is producing anything**. |
| **Record** | **Absent entirely.** |

### W2-05 · There is no supplier record in ReadyDoc of any kind · **MUST**

Not a thin one — none. `approved_chemicals` holds chemicals. `certifications` holds **people**
(`person_name NOT NULL`). `supply_orders` and `supply_invoices` are office purchasing. `coa_requests`
holds lab work. **Nothing anywhere holds a supplier, an ingredient it supplies, a risk evaluation, a
qualification decision, an approver, or a certificate with an expiry date.**

So the auditor's finding is not "the questionnaire was misfiled". There is no system it could have been
filed in. Three named suppliers of three named ingredients, and the answer to "show me their
qualification" is a question about somebody's folders.

### W2-06 · The laboratory half of SOP 404 has no record at all, and the code already assumes otherwise · **MUST**

`coa_requests.lab_name` is a **free-text field**. There is no laboratory record, no accreditation, no
scope, no expiry — the string `17025` appears nowhere in the codebase.

Worse, ReadyDoc already leans on an accreditation it does not hold. `server/coa-grade.js` carries this
comment, deciding how a lab result is graded:

> *"The lab's own verdict wins. It is the accredited party and it applied the …"*

That is a correct principle resting on a fact nothing records. An auditor asking *"how did you qualify
CTLA, and against what scope?"* gets a text field somebody typed. Given the SOP's title now explicitly
covers laboratories (W2-02), this is squarely in scope and squarely missing.

### W2-07 · The expiring-certificate pattern exists but is bound to a person, and that decision needs making now · **SHOULD**

`certifications` already does most of what supplier certificate management needs — issuer, number,
issued and expiry dates, the file itself, and an expiry that generates work. But `person_name` is
`NOT NULL`, so an organic certificate, a kosher certificate, a GFSI certificate or an allergen statement
**cannot be filed against a company** without either widening that table or creating a second one.

Decide that before building, not during: it is the difference between supplier qualification being a new
module and being an extension of one that already works. *(My reading is a new table — a supplier
carries a risk evaluation and an approval decision that a person's certificate does not — but the
certificate half should reuse the expiry machinery rather than growing a second copy of it.)*

### W2-08 · FORM 404-1 and 404-2 exist and produce nothing; settle where they will live before building · **CONSIDER**

Both are numbered, revised (404-1 is at V2, DCR 0022) and real. They are two of the seven forms D-021
found marked `where: keychain` while in fact being worked on paper. Building a supplier module without
deciding whether these two forms are its screens — or whether Keychain keeps them and ReadyDoc holds the
qualification decision — produces a third place the same fact can live. **That is a decision for
Daniela, not a build decision.**

---


### W2-24 · V4 puts laboratories in the title and the procedure, and never in the Scope · **MUST**

V4's only substantive change is a new section G, *Laboratory Qualification*, and a new title. **Section II,
SCOPE, is untouched:**

> *"The procedure described here applies to all suppliers of raw materials and packaging that comes in
> contact with raw materials, in-process materials or final products."*

A laboratory supplies neither raw materials nor packaging. **So the document's stated scope excludes the
thing its title now promises**, and anyone applying the SOP as written is entitled to leave laboratories
out of it. Fixing the scope is one sentence, and it has to happen before the section below means anything.

### W2-25 · The entire laboratory qualification programme is two sentences · **MUST**

Verbatim, in full:

> *"Laboratories will be approved upon receipt of ISO certification.*
> *An audit report will be requested and kept on file to ensure continued improvement."*

That is the whole of it. It names:

- **no standard.** "ISO certification" is not a requirement — **ISO 9001 is a management-system
  certificate and is not evidence that a laboratory can run the test.** The one that matters for a testing
  laboratory is **ISO/IEC 17025**, and it matters *per scope of accreditation*: a lab accredited for heavy
  metals is not thereby accredited for Salmonella.
- **no scope check**, so nothing confirms the accreditation covers the tests we actually send.
- **no expiry and no re-approval**, though accreditations lapse — and the plant's own supplier half runs
  annual reviews (W2-29).
- **no owner, no form, no record.** "An audit report will be requested" — by whom, by when, and filed
  where is not stated.

This is the document half of **W2-06**, and it is the more serious half. ReadyDoc has no laboratory record;
so does the SOP. `coa-grade.js` decides how every lab result is graded on the reasoning that *"it is the
accredited party"* — and **this is the document that was supposed to establish that, and does not.**

### W2-26 · The SOP cites a form that does not exist · **MUST**

Section VI, References / Related Documents, lists three forms:

| | In the Master Index? |
|---|---|
| Vendor Qualification Questionnaire **FORM 404-1** | Yes, V2 |
| Vendor Raw Material Questionnaire **404-2** | Yes, V1 |
| **Vendor Audit Summary Form 404-3** | **No — absent from the Master Index and from all 159 rows of the DCR log** |

And Section V.C.A.I requires vendor audits, and IV.B makes QA responsible "to schedule and perform audits
of vendors". So the SOP requires an activity, names the form it is recorded on, and that form has never
been issued. **Either issue 404-3 or remove the requirement — but not neither.**

### W2-27 · V4's own footer still carries the old title · **SHOULD**

The header on every V4 page reads *SUPPLIER AND LABORATORY QUALIFICATION*. The footer on the same pages
reads *SOP 404 SUPPLIER QUALIFICATION*. The title change is half-applied **inside the document**, which is
the local version of W2-02: the registry, the log and the document itself all name it differently.

### W2-28 · Two systems are named and never defined, and one definition contradicts its own use · **SHOULD**

- **"QVS"** — section V.E.C: *"The Purchasing Manager or designee will enter vendor performance issues into
  the QVS."* Used once, defined nowhere, expanded nowhere. A procedure step nobody can follow.
- **"Qualified Supplier Database"** — section G/H.A. Named, never defined, and no such database exists.
- **"QVL"** is defined in III.B as *"Approved Supplier List"* and then used throughout as *"Qualified Vendor
  List"* (V.F.A spells it out that way). One acronym, two expansions.

### W2-29 · An annual vendor review is required and nothing schedules it · **SHOULD**

Section IV.B makes QA responsible for *"performing annual vendor reviews and reports"*, and V.F.A refers to
*"annual vendor monitoring"*. That is a recurring obligation with a stated cadence, and there is no quality
schedule, no work order and no record behind it — the same shape as the EMP obligations in W2-42.

Worth pairing with the supplier module when it is built: this is the "ongoing performance review" leg, and
`quality_schedules` already generates exactly this kind of dated work.

### W2-30 · Spelling and grammar · **CONSIDER**

Real, and few: **"Powder-may recommend"** (V.F.A — missing "Ops"); **"pre-assessed prior purchasing"** and
**"prior ordering"** (V.C.A, V.C.D.I — missing "to"); **"The manufactures quality systems"** (V.E.B.I.D —
should be *manufacturer's*); **"Q.A. Approval: Date:"** in the signature block (double colon).

## Part 3 — SOP 421 · Design/Qualification of Facility/Equipment (IQ, OQ, PQ)

> **The auditor:** *"…as required per SOP 421 … were not provided for any of the facility equipment; for
> example, mixers and stick pack machines."* — NSF/ANSI 455-2 § 4.5.8 · 21 CFR 111.30

| The D-002 test | |
|---|---|
| **Program** | The SOP exists. Not in the DCR log (W2-01). |
| **Form** | **None.** No 421-series form appears in the Master Index or the change log. |
| **Record** | **Absent entirely.** |

### W2-09 · "IQ", "OQ" and "PQ" appear nowhere in ReadyDoc · **MUST**

Searched across the server and the client: no installation qualification, no operational qualification,
no performance qualification, in any spelling.

`server/equipment-readiness.js` derives **ten** steps for every machine — PM schedule, assignee,
maintenance tasks, LOTO, hygienic design verification, training course, training material, work
instruction, calibration, HACCP CCP. **Qualification is not one of them.** So *"which machines are
unqualified?"* is not a question the application can be asked, which is precisely why the answer
arrived at an audit instead of on a screen.

### W2-10 · No form number exists for a qualification protocol · **SHOULD**

The auditor asked for IQ/OQ/PQ "for any of the facility equipment" — meaning the SOP requires a
deliverable per machine. Whatever that deliverable is called, the Master Index has no number for it, so
a completed protocol has no controlled identity to be filed under.
`[verify in source — SOP 421 may name its own forms, in which case the finding is that they are missing
from the index rather than that they do not exist]`

### W2-11 · This is the cheapest of the four to close, and the pattern is already built · **CONSIDER**

Three more derived steps in `equipment-readiness.js`, each satisfied by an attached protocol, and the
roll-up, the per-machine panel and the list badges all follow with no new machinery — that is how the
existing ten steps work. It does not perform the qualification, which is engineering work and outside
ReadyDoc. It makes the gap visible and countable, which is the difference between a finding you discover
and one you are already working.

---


### W2-31 · The SOP's own scope excludes the equipment the auditor asked about · **MUST**

Section I, verbatim:

> *"This SOP applies to all **new and significantly modified** facilities and equipment used in the
> production, packaging, and testing of dietary supplements."*

The document was issued 04/09/2024. The auditor's finding is that IQ/OQ/PQ *"were not provided for **any**
of the facility equipment; for example, mixers and stick pack machines"* — equipment that in the main is
neither new nor recently modified.

**Read strictly, the SOP does not require what the auditor found missing.** That is not a defence to run —
21 CFR 111.30 does not care what the SOP's scope says — but it is the thing that decides how the CAPA is
written. **Either the SOP gains a retrospective-qualification clause saying how equipment already in
service is qualified and by when, or the plant has to argue scope with a finding already on the record.**
The first is a paragraph; the second is a conversation with NSF.

**This is the single most consequential document finding in Wave 2**, and it is the kind that only reading
the document surfaces — nothing in the tables could have shown it.

### W2-32 · Eight kinds of record, not one form number · **MUST**

Section IV, RECORDS, lists what the SOP produces: User Requirement Specifications, Design Qualification
documents, qualification master plans, **IQ, OQ and PQ protocols and reports**, deviation reports, training
records, change control documentation, and periodic review reports.

**None of the eight carries a form number**, and no 421-series form exists in the Master Index or the DCR
log. This confirms W2-10 and makes it worse: it is not one missing form, it is a whole section of records
with no controlled identity. A completed IQ protocol has nothing to be filed under.

### W2-33 · Section 6 requires a second change-control system and does not cite the first · **SHOULD**

*"Implement a change control system to manage modifications to qualified facilities or equipment."*

SOP 434 is the plant's change-control SOP for equipment, and 421 never mentions it. Two documents
requiring change control over the same assets, neither referencing the other, is precisely the ambiguity
NC 4.3.9 is about — and it means **widening change control has to reconcile 421 and 434, not just widen
434.**

### W2-34 · Two approvers who do not exist, and a schedule with no interval · **SHOULD**

- Section 5 requires approvals from *"QA/QC, and Operations Manager"*. The Responsibilities section names
  a **Quality Assurance and Control Manager**, a **Production Manager** and a **Maintenance Manager**.
  There is no Operations Manager in the document.
- Section 8 requires *"a schedule for periodic review of qualification status"* and **states no interval**.
  A cadence that names no period cannot be scheduled, missed, or audited — the same defect the plan
  red-line raised as "retention for a specified period" never specified.
- The V2 revision-history remark is the entire Responsibilities section pasted into the Remarks cell.
  Harmless, but it is why nobody can tell from the history what actually changed.

## Part 4 — SOP 434 · Chemical, Equipment and Services Approval

> **The auditor:** *"While requirements for equipment changes were defined per SOP 434, change control
> procedures that include processes, software, utility, and physical plant changes were not
> established."* — NSF/ANSI 455-2 § 4.3.9 · 21 CFR 111.130(e)

| The D-002 test | |
|---|---|
| **Program** | The SOP exists, and the auditor says its scope is too narrow. Not in the DCR log (W2-01). |
| **Form** | FORM 700-01 *Approved Chemical List* covers the chemical third. Nothing covers equipment or services. |
| **Record** | **One third present** — `approved_chemicals` is a real approval record. |

### W2-12 · The SOP's title names three things and ReadyDoc records one · **MUST**

`approved_chemicals` is genuinely good: category, manufacturer, product code, SDS number, food-grade
flag, NSF rating, approved applications, maximum concentration, required contact time, **`approved_by`,
`approved_at` and a `review_due`**. That is an approval record with a name and a date on it.

There is **no equipment approval record and no services/contractor approval record at all.** The
auditor's finding is about scope, and the same scope gap exists in the software — which is worth saying
plainly, because it means closing the document half alone will leave the finding half-answered the next
time someone asks for the evidence.

### W2-13 · `controlled.js` is a real change-control gate, over a very narrow slice · **MUST**

This is the good news and the exact size of it. `server/controlled.js` parks a changed **QMS form
definition**, a changed **scale tolerance**, and — since Wave 1 — the **ATP limit**, serving the last
approved version until Document Control approves the new one, and raising a DCR automatically.

That is a working change-control mechanism with an approval gate and an audit trail. It is also the
*whole* of it: it does not see a process change, a utility change, a physical-plant change, or a
software deployment. Widening it is the buildable half of this nonconformance.

**Note the interlock:** software change control is named in **both** § 4.3.9 and § 4.4.39 (electronic
records validation). Building it once answers both, and § 4.4.39 is the finding that names ReadyDoc
directly.

### W2-14 · 111.130(e) requires QC approval on every change, and the DCR flow does not enforce one · **SHOULD**

The current flow routes a parked change to **Document Control**. The regulation requires quality-control
approval, which is a different signature by a different person for a different reason. Today one
approval closes the gate.
`[verify in source — SOP 434 may already require both, in which case the software is the gap and not the
document]`

### W2-15 · SOP 434 and SOP 700 may both govern chemical approval · **SHOULD**

DCR 0027 records `SOP 700 · Food Grade and Non Food Grade Chemicals · V2`, and DCR 0056 records
`FORM 700-01 · Approved Chemical List`. SOP 434 is titled *Chemical*, Equipment and Services Approval.

**Two SOPs may be governing the approval of the same chemicals** — a fact in two places, with the usual
consequence that they will drift and nobody will notice which one is current. Worth ten minutes with
both documents open. `[verify in source]`

---


### W2-35 · The scope gap the auditor found is exactly as stated, with nothing to interpret · **MUST**

Section I, in full: *"This SOP outlines the procedures for reviewing and approving new **chemicals,
equipment, and services** for use in a food or dietary supplement manufacturing facility."* The procedure
then has one approval path each for chemicals, equipment and services, and no other.

**Processes, software, utilities and physical plant appear nowhere in the document.** The auditor's finding
needs no argument — and note that closing it is a rewrite of this SOP's scope, not an addendum, because the
approval paths are written per subject.

### W2-36 · The SOP is titled as if it were the form, and the form has no number · **MUST**

The document is headed and footed **"SOP 434 CHEMICALS, EQUIPMENT AND SERVICES APPROVAL FORM"**. Its first
procedure step is *"Complete the Chemicals, Equipment and Services Approval Form."*

**So the SOP and the form it requires have the same name, and the form has no number.** No 434-series form
exists in the Master Index or the DCR log. A completed approval cannot say on its face whether it is the
procedure or the record, and there is no number to file it under. Issue the form with a number and drop
"FORM" from the SOP's title.

### W2-37 · Three identifiers are required and none of them has anywhere to live · **SHOULD**

The procedure requires: a **unique tracking number** on the request (§ 2), an **approval number** on
approval, and an **expiration date** on approval (§ 9).

`approved_chemicals` carries `approved_by`, `approved_at` and `review_due` — good, and close — but **no
approval number, no tracking number, and no expiry that generates work.** `review_due` is a date nothing
watches. So an approval that has expired looks exactly like one that has not, which is the state this whole
project keeps finding.

**Note this is the closest ReadyDoc comes to satisfying a Wave 2 SOP as written** — three columns short.

### W2-38 · Cost analysis is a required step in a GMP procedure · **CONSIDER**

Section 7 requires evaluating initial and ongoing costs, comparing them with benefits, and assessing the
impact on production costs — and Section IV lists the approval file as a record. **As written, a cost
analysis is a GMP record an auditor may ask to see**, and there is no reason to hand them one. Either move
the step out of the SOP, or say explicitly that the cost review is not part of the quality decision.

## Part 5 — SOP 604 · Environmental Monitoring Program

> **The auditor:** *"Surface testing results were not available … as testing had not been conducted as
> established per SOP 604 — Environmental Monitoring Program — V2 — 6/29/26."*
> — NSF/ANSI 455-2 § 4.5.84

| The D-002 test | |
|---|---|
| **Program** | The SOP exists; six quality schedules are seeded from its form and generate work orders. |
| **Form** | **FORM 604-01 V1** *Master Site List (EMP)* — transcribed in full in `server/emp-site-list.js`, limits and all. The best-served of the four. |
| **Record** | **Absent.** A quality-schedule completion writes no result. |

### W2-16 · Completing a quality schedule files no record · **MUST**

`server/api/quality-schedules.js` writes exactly two tables: `work_orders` and `quality_schedules`.
There is no result record — no site, no test, no number, no pass or fail, no lab report tied to a
requirement.

**So a swab that was never taken and a swab whose result went nowhere are indistinguishable.** That is
the auditor's finding stated in software terms, and it is the same defect that put QA's Light Inspection
and Brittle Plastic records months behind: the task completed, and the controlled record it existed to
produce was never filed.

### W2-17 · The form's alert and action limits are transcribed, and nothing is graded against them · **MUST**

`emp-site-list.js` carries the real numbers, faithfully: potable water TAB alert `>500 CFU/mL` / action
`>1000`; total coliforms `Present/100 mL`; free chlorine `>2.0 ppm`; Zone 1 surfaces TAB alert `>300` /
action `>1000 CFU/cm²`, yeast and mould `>150` / `>500`; Salmonella and Listeria action `Present in
sample` across Zones 2, 3 and 4.

**No code compares anything to any of them, because there is no result to compare.**

This is the ATP 35 RLU state exactly as it was three days ago — a critical number living correctly in
one place and enforcing nothing. The difference is that the fix now has a working precedent: a result
record, graded against the limit that the form owns, with the limit stored on the record it graded.
**Wave 1 is the template for this, and that is the strongest argument for doing SOP 604 next.**

### W2-18 · Two of the form's four sections have no schedule derived from them — and the water work is happening anyway · **MUST**

`EMP_SCHEDULES` seeds **six** schedules from FORM 604-01: compressed air, Zone 1 equipment surfaces, Zone 1
room surfaces, Zones 2, 3 and 4. That is the compressed-air row and all four surface zones.

**The water section is not among them.** The form requires monthly potable water testing — Total Aerobic
Bacteria Count, Total Coliforms and Free Chlorine, each with its own limits, and a chlorine sample point
*"close to where the water comes into the building"*. No EMP schedule generates it.

> **Confirmed by the plant, 27 Aug: the tap water testing IS being done, and the completions are in the
> Quality Schedules module.** So this is not missed work. The pre-existing monthly **"Tap Water Testing"**
> schedule is carrying it — and that is the whole point of the finding. That schedule was seeded before the
> form was transcribed; it **names none of the three tests, cites none of the limits, and never references
> FORM 604-01.** Its steps say "record pass/fail" against a specification it does not state, and the
> sampling points it names are the restrooms and the kitchen, not the incoming-water point the form
> specifies for chlorine. `[for Adam — which points are actually sampled?]`
>
> The form's *room air* row is the same story, served by a pre-existing annual settle-plate schedule that
> likewise predates and never cites it.

**So the work is real and the record is not.** A completed schedule is a `work_orders` row — it can carry
notes, readings and an attached lab report, and very likely does. What it cannot do is say *"Total
Coliforms, potable water, March, absent, within the Present/100 mL action limit"* in a form anything can
read. **SOP 604 § 5.6 requires this data to be tracked and trended, and § 5.7 requires an annual review of
the trend** — neither is possible against PDFs attached to tasks. That is W2-16 and W2-17 stated as the
plant's own requirement rather than as an auditor's.

### W2-19 · SOP 604 is a hub over three other SOPs, and the four have drifted apart · **SHOULD**

The change log shows the environmental programme spread across four documents that move independently:

| | | Log |
|---|---|---|
| SOP 604 | Environmental Monitoring Program | V2 · 10/17/2025 |
| SOP 600 | Air Monitoring | V1 · 10/17/2025 |
| SOP 601 | Microbial Surface Testing | V1 · 10/17/2025 |
| SOP 608 | Surface ATP Swab Testing | **V4** · 03/04/2026 |

SOP 608 went V1 → V4 over ten months while the programme document that ought to govern it stayed at V2
and the other two stayed at V1. Nothing in the register says whether 604 was checked when 608 moved.

**This is the hub-and-spoke case the document reference graph was designed for**, and after the two
plans it is the clearest candidate in the registry: one governing document, three governed, an obvious
question on every revision. `[verify in source — 604 may cite the other three by number, which is what
the graph needs and what neither plan turned out to do]`

---


### W2-39 · Four broken cross-references, all inside the OOS escalation · **MUST**

Section 5.3 tells whoever finds a pathogen positive what to do. **Four of its internal references point one
section too high, including one that points at itself:**

| At | It says | It means |
|---|---|---|
| 5.3.4.2.1 | *"retest results from section **5.3.5.1**"* | 5.3.4.1 |
| **5.3.5.1** | *"according to section **5.3.5** of this SOP"* | 5.3.4 — **it cites itself** |
| 5.3.6.2 | *"according to section **5.3.5**"* | 5.3.4 |
| 5.3.6.2.5 | *"the steps listed in section **5.3.5.3**"* | 5.3.4.3 |

Section 5.3.5 is *Surface Sites Zone 1* and 5.3.6 is *Water Sites*, and both are told to follow "5.3.5" —
so **the Zone 1 procedure instructs the reader to follow the Zone 1 procedure**, and the water procedure
sends them to Zone 1 rather than to the general escalation in 5.3.4.

**This is the highest-severity finding in Wave 2.** A Zone 1 product-contact positive is the most serious
result this program can produce, and the procedure for it does not resolve. It is also a ten-minute fix.

### W2-40 · The SOP states a sampling cadence that contradicts the form it defers to · **MUST**

Section 5.2.3.2 says sampling frequency *"[is] listed in the MSL form 604-01"*. Four subsections later,
5.2.3.6.1 states one itself: *"Sites are sampled on a **monthly** basis during active production shifts"*
— for zones 2, 3 and 4.

**FORM 604-01 says something else** for every one of those zones: Zone 2 *"at least once per twice a
year"*, Zone 3 *"at least once a year"*, Zone 4 *"at least once per quarter"*. And 5.2.3.6.6 introduces a
third word, *"the **weekly** allotment of samples"*.

So the same fact — how often a zone is swabbed — is stated in two documents and three places, and they do
not agree. **This matters immediately in ReadyDoc**: the six seeded EMP schedules take their cadence from
the form, so if the SOP's monthly is the intended rule, every zone schedule is running at a fraction of the
required frequency. **Decide which is right before anything is built on either.**

### W2-41 · Two required forms — one has no number, the other has no name · **MUST**

- The **OOS investigation form** is referred to only as *"the form"* (5.3.4.1.2, *"The Quality Department
  fills out the QA portion of the form"*). It is never named or numbered anywhere in the SOP.
- The **EMP Root Cause Analysis / Corrective Action Report** is named and even given a numbering scheme —
  `EMPRCA` + a three-digit serial + the year — but **has no controlled form number** and is not in the
  Master Index.

Both are the records that prove an OOS was handled. The SOP tells you to fill them in and gives you no way
to find them.

### W2-42 · "the Quality Manager and Quality Manager" · **MUST**

Section 5.5.1.2, verbatim: *"…the Quality Manager and Quality Manager, with possible help from the MRB,
decide what corrective actions will be taken."*

The same role twice, so **the SOP does not say who decides a corrective action**. Section 5.5.2.2 — the
preventative-measure twin — reads *"The **Plant Manager** and Quality Manager"*, which is almost certainly
what was intended. Small typo, and it lands on the decision authority for a pathogen corrective action.

### W2-43 · Roles are given work that the Responsibilities section never establishes · **SHOULD**

Section 4 defines three roles: Quality Manager/Director/Designee, Manufacturing Manager/Designee, and
Sanitation Supervisor/Designee. The procedure then assigns actions to a **Plant Manager** (5.2.1.4,
5.2.2.3, 5.5.2.2 — including deciding preventative measures), a **Laboratory Supervisor** (5.2.2.3.2), and
a **Quality Department** used as distinct from the Quality Manager throughout 5.3.

Three actors with duties and no definition. Add them to Section 4, or map them onto the roles that are
there.

### W2-44 · The annual verification is a "should" in one paragraph and a fact in the next · **SHOULD**

5.7: *"The EMP **should** be periodically verified … Intensive sampling (baseline mapping) **should** be
conducted annually and should consist of between 20-50 samples."* Then 5.8: *"The results from **the
annual** EMP verification are reviewed by the MRB."*

The second sentence assumes the first is a requirement. Make 5.7 *shall*. As written, the plant's own
verification of its monitoring program is optional — and SQF asks for verification of the program, not
just of the samples.

### W2-45 · Two recurring obligations, neither with a generator · **SHOULD**

5.6.3 requires OOS and overall trending to be **reviewed twice a year by the MRB**. 5.7 requires the
**annual baseline mapping** of 20–50 samples. Both have a stated cadence, an owner and an output, and
**neither exists as a quality schedule** — so a year can pass without either happening and nothing says so.
Two rows in `SEED_SCHEDULES`, once someone confirms the cadences.

### W2-46 · The hub cites two of its three spokes · **SHOULD**

W2-19 flagged that SOP 604 governs a programme carried out under SOP 600, SOP 601 and SOP 608, and asked
whether it cites them. **It cites SOP 600 (5.2.1.2) and SOP 601 (5.2.3.3) by number, and never mentions
SOP 608** — Surface ATP Swab Testing, the one document of the three that has moved four revisions while
604 stayed at V2.

It also relies on the **Material Review Board** throughout without citing SOP 412, which defines it.

**Good news, though:** two real outbound citations by number is more than Protocol 003 and Protocol 001
managed between them. Read the note above about what that means for OBL-18.

## What each one needs from you

**Everything below is a decision about a document. None of it is blocked on software.**

| Finding | Decision needed | From |
|---|---|---|
| **W2-20** | Sign all four, or say why they are in force unsigned. This is the one an auditor finds first. | **Daniela + Adam** |
| **W2-21** | Fix each header against its own revision history — and settle which date SOP 434's V2 actually carries, since the auditor recorded one that appears nowhere in the file. | **Daniela** |
| **W2-22** | Supersede SOP 404 V3 and reissue V4 as its own file. | **Daniela** |
| **W2-01, W2-02** | Raise the missing DCR rows for SOP 421, SOP 434 and SOP 404 V4. | **Daniela** |
| **W2-31** | **The big one.** Does SOP 421 gain a retrospective-qualification clause for equipment already in service, or does the plant argue scope with NSF? This decides how NC 4.5.8 is answered. | **Adam** |
| **W2-40** | **Monthly, or the form's frequencies?** The SOP and FORM 604-01 disagree for every zone, and the six seeded EMP schedules follow the form. Whichever is right, the other must change. | **Adam + Daniela** |
| **W2-39** | Renumber the four OOS cross-references. Ten minutes, and it is the most serious finding here. | **Daniela** |
| **W2-25** | Which ISO standard, over what scope, checked how often? ISO/IEC 17025 with a scope check is the answer for a testing laboratory; ISO 9001 is not. | **Adam** |
| **W2-26, W2-36, W2-41, W2-32** | Issue the missing form numbers: 404-3, the 434 approval form, the EMP OOS form and the EMPRCA report, and the 421 qualification protocols. | **Daniela** |
| **W2-18** | Which points are actually sampled for tap water — restrooms and kitchen, or the incoming-water point the form specifies for chlorine? | **Adam** |
| **W2-35, W2-24** | Two scopes to widen: SOP 434 to processes, software, utilities and physical plant; SOP 404 to laboratories. | **Daniela** |

## What I would build first — unchanged, and now better evidenced

**SOP 604** is still the one to build. The documents made the case stronger rather than weaker: the SOP
itself requires the data to be **tracked and trended** (§ 5.6) and the trend to be **reviewed twice a year
and verified annually** (§ 5.6.3, § 5.7). None of that is possible against lab reports attached to work
orders. **The plant is already doing the sampling** — W2-18 — so what an environmental result record buys
is not the work, it is the evidence, the grading against FORM 604-01's limits, and the trend the SOP
already demands. Wave 1's ATP grading is the pattern, one level up.

**One dependency that did not exist before this pass:** W2-40. If the SOP's monthly cadence is the intended
rule rather than the form's, the six seeded EMP schedules are all at the wrong frequency, and building a
result record on top of them would file correct records against a wrong cadence. **Settle W2-40 first — it
is a question, not a build.**

**Then SOP 421**, still three derived steps on `equipment-readiness.js` — but note W2-31 now sits in front
of it. There is no point deriving an IQ/OQ/PQ checklist across 183 machines until somebody has decided
whether the SOP reaches equipment already in service.

**SOP 404 is a module, not a field**, and W2-25 says the laboratory half needs writing before it can be
built at all. **SOP 434's software half is the § 4.4.39 software change-control build** — and W2-33 adds
that widening change control has to reconcile SOP 421 and SOP 434, which both claim it.

---

## Corrections made to earlier documents

- **`audit-nc-triage.md` said "eight quality schedules are seeded from [FORM 604-01]".** Six are
  (`EMP_SCHEDULES`). Three others — Tap Water Testing, Air Testing (Settle Plate) and Internal Audit — are
  seeded separately and predate the transcription, which is itself finding W2-18. Nine schedules exist on a
  fresh database, six of them from the form. Corrected in place.
- **This review's own first pass called SOP 404 "V4 · 8/4/26" throughout** on the auditor's authority. That
  is right for the revision in force, but the file supplied holds **both V3 and V4** — see W2-22 — so
  references to "SOP 404" in Part 1 mean V4 unless a finding says otherwise.
