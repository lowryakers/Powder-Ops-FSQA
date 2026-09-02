# Landed on `main` — Supplier & Laboratory Qualification

**Status: LANDED. On `main` as `ff384ca`, 27 August 2026.**
**Designed 27 August · built 27 August · landed the same day**

> **Written in `docs/v2/queued/` and moved here when it shipped** (D-036). `queued/` means work designed
> and deliberately NOT landed; leaving a shipped item in it would make the directory mean two things.

**What shipped:** the five tables, `supplier-archive.js` (the folder parser), `supplier-reconcile.js` and
`supplier-import.js` (both pure), `supplier-sop.js` (the SOP's values, transcribed), `api/suppliers.js`
and `SuppliersPanel.jsx`. `npm run check:suppliers` is part of `npm run check`.

**What did NOT ship, and is not pretending to:**

| | |
|---|---|
| **Collecting the questionnaires** | **OBL-29.** The register makes the gap visible and countable — 21 awaiting a disposition, 22 with no questionnaire on file. It cannot ask a supplier for one. NC 4.3.1 does not close until they are collected. |
| **The annual review generating work** | **OBL-29.** `next_review_due` records when one is due and nothing yet raises it. That is the piece that stops this register going quiet the way the tracker did. |
| **SOP 404's document defects** | **OBL-30.** FORM 404-3 is cited by § VI and has never been issued; V4's footer still carries the old title; QVS is named and never defined. None is a software gap. |
| **The laboratory register** | **OBL-28.** SOP 404's laboratory programme is two sentences naming no standard and no expiry. Building against it would encode "ISO certification" as a requirement, which is not one. |

**Two things the build changed about the design below.** The archive's real shape killed four assumptions
(§ 3b), and the headline number had to be **split in two** — "buying without qualification" lumped
Quality's short sign-off queue together with Purchasing's weeks-long chase list, and one number told
neither person what to do.

**The design as written stands otherwise**, including every rule in § 0 and § 4.
---

## 0 · Best possible, not a better folder

**The brief is explicit: build this the best possible way, not a mirror of how it is done today.** So this
section is the part that would be missing if we simply put a database in front of Drive. Every move below
is argued from the two real archives, not from taste.

### 0.1 · The unit of qualification is a MATERIAL from a MANUFACTURER — not a vendor

AIFI supplies three materials made by three different companies. **Qualifying "AIFI" tells you nothing
about whether the potassium citrate came from a qualified source** — that answer lives in Daffodil
Pharmachem's BRC certificate, which is currently 13 months expired.

A vendor-level register mirrors the folders and inherits their blind spot. The unit that means something
is **(material × manufacturer)**, with the vendor as the commercial relationship on top. That is also what
SOP 404 § III.A says — *"a broker or agent, **or the actual manufacturer**"* — and what § V.C.E means when
it requires a **new risk evaluation per material** even from an already-qualified vendor.

### 0.2 · Forty-one of seventy-nine files are the SAME twenty questions, asked again per material

Counted from the archive: gluten (3), GMO/bioengineered (5), vegan (2), organic (2), allergen (2), Prop 65
(2), country of origin (3), kosher (2), halal (2), heavy metals/pesticides (2), sewage sludge (2), food
fraud (1), lot code/traceability (5), recall (2), shelf life (1) — plus HACCP (7), specification (3), SDS
(3), audit certificates (4).

**Mirroring turns those into 41 documents to file. Best-possible turns them into ~20 attributes on the
material, each carrying the file that evidences it.**

That one move changes what the system can answer:

| Today | With attributes |
|---|---|
| *"Is the potassium citrate gluten free?"* → open the folder, find the PDF, read it | a field |
| *"Which materials have no allergen statement on file?"* | a filter — **impossible today** |
| *"A customer sent us a questionnaire"* → a scavenger hunt across 43 folders | assembled from what is already held |
| *"What is missing before this material is qualified?"* | the blanks, listed |

**And it is the same pattern the plant already trusts** — `equipment-readiness.js` derives ten steps per
machine from records rather than storing a checklist. This is that, for a material. **Nothing is ticked by
hand: an attribute is answered because its evidence exists.**

### 0.3 · A certificate is a dated obligation, not a PDF in a folder

**Five have already lapsed and nobody knew** — including the BRC audit certificate of the company that
makes the potassium citrate. That is the whole argument. A certificate with an expiry becomes a row with a
due date that **raises work before it lapses**, exactly as `certifications` already does for people and
`calibration_instruments` for instruments. The pattern exists; it has simply never been pointed at
suppliers.

**The expiry is read from the filename where the filename states it** (eight of AIFI's do), and is
otherwise **blank and asked for** — never inferred from the year folder it happens to sit in.

### 0.4 · A disposition, not a checkbox

Jake's sheet records *questionnaire completed: 1*. SOP 404 § V.C.III requires **Approved / Conditionally
Approved / Not Approved**, decided by Quality against seven named criteria. Nineteen "completed" currently
reads as nineteen qualified, and it is not. **The decision is the record; the questionnaire is evidence for
it.**

### 0.5 · It has to reach the dock, or it is still a filing cabinet

**This is the move that separates "best possible" from "a much better list."**

SOP 404 § V.A: *"Components ordered for Powder-Ops will be done through qualified vendors ONLY."* Today
nothing checks that at the moment it matters. **FORM 204-01 is already worked at the truck**, already
refuses sign-off on a blank answer, and already escalates to named people — so the receiving checklist
gains a **derived** line: *this material's supplier qualification has lapsed / has no questionnaire on
file.*

**It warns and records; it never refuses.** The pallet is already on the dock, and a receiver blocked by a
paperwork gap they cannot fix will find a way around the system rather than through it. Same asymmetry as
the ATP grading: it can raise a fail, it can never quietly pass, and the escalation is the honest record
that somebody was told.

### 0.6 · The year folder becomes a review cycle

`vendor/2025` and `vendor/2026` are already an annual review — SOP 404 § IV.B requires one and nothing
schedules it (W2-29). A qualification carries `next_review_due` and generates work. **Brown Rice Flour was
refreshed in 2026; Potassium Citrate and Dipotassium Phosphate were not.** That distinction is invisible in
Drive and is the first thing a review cycle would have raised.

### 0.7 · What NOT to build

- **Not a second Drive.** The evidence goes to R2 **once**, in bulk, and after that new files arrive as a
  side effect of filing a qualification — not as a separate "upload documents" chore. Same reasoning as
  artwork versions being a side effect of the proofing run.
- **Not a controlled-document register.** These are the *supplier's* documents. They have no revision of
  ours, they do not pass through our DCR, and putting them in `sop_documents` would mean an auditor asking
  for our register gets Prayon's Prop 65 statement.
- **Not the folder taxonomy, reproduced.** "2025 / 2026 / Customer Documents" is how the evidence arrived.
  It is not how the questions get asked.

### 0.8 · What this costs, honestly

The mirror is a table and an importer — days. **Best-possible is that, plus the attribute model, plus the
certificate clock, plus the receiving hook.** The sequencing that lands value earliest:

1. **Suppliers + materials + files + the archive import.** The register exists; NC 4.3.1 has somewhere to
   live; the 24 unqualified vendors become visible.
2. **The certificate clock.** Smallest piece, immediate payoff — the five lapses stop being invisible.
3. **The attribute model.** The biggest usability gain, and it can be backfilled from files already
   imported without re-uploading anything.
4. **The receiving line.** Last, because it touches a screen the warehouse depends on, and it should not
   move until the register behind it is trustworthy.

---

## 1 · Where it sits on the spine

| Leg | Today | After |
|---|---|---|
| **Program** | SOP 404 V4 § V — complete for suppliers, two sentences for laboratories (W2-25) | Unchanged. The module implements the SOP; it does not restate it. |
| **Form** | FORM 404-1 V2 (questionnaire), 404-2 V1 (raw material), **404-3 never issued** (W2-26) | 404-1 and 404-2 become the record's own sections; **404-3 must be issued before vendor audits can be filed** |
| **Record** | **Nothing** (W2-05) | `suppliers` + `supplier_qualifications` + `supplier_files` |

**This is the D-002 test passing for the first time on a Wave 2 SOP**, and it closes NSF/ANSI 455-2 § 4.3.1
— the questionnaires that "were not available" for Mill Haven Foods, M4 Dynamic and Bay State Milling.

**The folder structure already encodes something the SOP requires and ReadyDoc does not schedule.**
`vendor / 2025 / …` and `vendor / 2026 / …` is an **annual qualification period**, and SOP 404 § IV.B
requires "annual vendor reviews and reports" with no schedule behind it (W2-29). The years in the zip are
the evidence that the annual review is already being done; the module turns them into a cadence.

---

## 2 · Schema — three tables, and the vocabulary is transcribed, not invented

Same doctrine as `preventive-controls.js` and `scale-forms.js`: **where SOP 404 names a value, the value is
the SOP's, verbatim, and is not editable in a text box.**

```
suppliers                      -- WHO. One row per vendor, for ever.
  id, name, legacy_names (JSON), vendor_type, contact_*, address,
  status              -- 'qualified' | 'conditionally_qualified' | 'not_qualified' | 'disqualified'
  status_reason, status_set_by, status_set_at
  on_qvl              -- mirror of status IN ('qualified','conditionally_qualified'), never typed
  notes, created_*, updated_*

supplier_qualifications        -- WHEN, and on what evidence. One row per vendor per period.
  id, supplier_id, period_label          -- '2025', '2026' — the folder name, kept as written
  period_start, period_end
  disposition         -- SOP § V.C.III: 'approved' | 'conditionally_approved' | 'not_approved'
  disposition_notes   -- required for conditional and not-approved: the SOP says deficiencies are named
  risk_criteria (JSON)-- the SOP's SEVEN, transcribed; each yes/no/na + a note
  questionnaire_received_at, raw_material_questionnaire_received_at
  audit_performed_at, audit_summary_form   -- FORM 404-3, once it exists
  decided_by, decided_at, signature_image  -- the same signature path COA and NFP use
  next_review_due     -- drives the annual quality schedule
  source              -- 'import' | 'in_app' | 'paper'

supplier_materials             -- WHAT they supply. The join the COA module has never had.
  id, supplier_id, item_number, item_description,
  raw_material_questionnaire_at, risk_notes, is_active

supplier_files                 -- THE EVIDENCE. R2, via the shared media.js + putStream path.
  id, supplier_id, qualification_id (nullable), material_id (nullable)
  kind                -- 'questionnaire' | 'raw_material_questionnaire' | 'spec_sheet'
                      -- | 'coa' | 'audit_summary' | 'certificate' | 'other'
  period_label, lot_number (nullable), item_number (nullable)
  filename, storage_key, content_type, size,
  extracted_text, text_status,             -- searched, never shipped (equipment-manual rule)
  source_path         -- the path inside the zip, verbatim. Provenance.
  uploaded_by, created_at
```

**The seven risk criteria are the SOP's own** (§ V.C.B.I): quality system developed and implemented;
facilities acceptable; order-processing controls exist; manufacturing controls in place; CAPA actively
used; documentation and configuration controls implemented; no unaddressed compliance discrepancies.
Transcribed into a constants file with `ccpDrift()`-style reporting, so a criterion cannot quietly wander
from the document.

**The three dispositions are the SOP's own** (§ V.C.III.A–C), including the full text of what
*Conditionally Approved* means. A fourth value is a Document Change Request, not a dropdown edit.

---

## 3 · Two importers, both of which already exist as patterns

### Jake's spreadsheet → one `TARGETS` entry

`server/api/imports.js` already does analyze → preview → commit → provenance, over CSV/TSV/XLSX, with
column aliasing and a natural key. **Adding suppliers is one entry**, exactly like `receiving_log`:

```js
suppliers: {
  label: 'Suppliers', table: 'suppliers', module: 'suppliers',
  fields: [ { key: 'name', required: true, aliases: ['vendor','supplier','company','vendor name'] },
            { key: 'vendor_type', aliases: ['type','category'] },
            { key: 'status', aliases: ['status','approval','qualified'] },
            … ],
  identity: ['name'],
}
```

Two traps this codebase has already paid for and that apply here:

- **`insertDefaults` is a FUNCTION called per row**, not an object. The object form throws at commit while
  the preview looks perfect.
- **Identity is the whole natural key, not the obvious column.** For suppliers `name` probably *is* enough
  — a vendor appears once — but if Jake's sheet is one row per vendor **per material**, identity becomes
  `name + item_number` and the vendor row is derived. **The sheet decides this, not I.**

### The archive → `server/supplier-archive.js`, **built and tested 27 Aug**

**My first guess at the structure was wrong, which is why I asked for real folders instead of designing
against an imagined layout.** I assumed `vendor / year / kind / file`. The plant's actual archives — AIFI
and Mill Haven, walked in full — look like this:

```
AIFI/2025/RM VQ-filled-PTC.pdf                              ← loose file; the KIND is in the name
AIFI/2025/Potassium Citrate.zip                             ← a nested zip named after a MATERIAL
AIFI/2025/Potassium Citrate.zip/Daffodil Pharmachem BRC Audit Certificate exp 7-27-2025.pdf
AIFI/2025/Customer Documents.zip                            ← a nested zip about the VENDOR
Mill Haven/2025/                                            ← an empty year, which is itself a fact
```

**There is no `kind` folder level.** The third segment is either a document or a **container named after
what it is about**, and the classification comes from the filename either way. And there are **nested
zips**, so the walk has to recurse.

**Two corrections to what this document said before the archives arrived:**

- **There are no COAs.** Not one file in either vendor is a certificate of analysis. The folders hold
  **qualification evidence** — certificates, statements, specifications, SDS, HACCP plans, audit reports.
  The rule about vendor CoAs in § 4 still stands for when one appears, but it is not what is in there.
- **There are THREE subjects, not two.** The documents are about the **vendor** (AIFI's W9, FDA
  registration, FSVP statement), the **material** (Potassium Citrate specification, SDS, allergen matrix),
  and — the one nothing had allowed for — **the manufacturer behind the material**. Prayon makes the
  dipotassium phosphate, Daffodil Pharmachem the potassium citrate, Dainty Foods the brown rice flour.
  **AIFI is a distributor.**

> **This is the finding that changes the schema, and SOP 404 anticipated it.** § III.A: *"This may be a
> broker or agent, **or the actual manufacturer** of the packaging or starting raw material."* The
> quality-system evidence qualification actually turns on — the BRC, SQF and FSSC audit certificates —
> **belongs to the manufacturers, not to the vendor we buy from.** So `supplier_materials` gains
> `manufacturer_name`, and certificates attach there. Without it, "is this material from a qualified
> source?" is answered by looking at AIFI's W9 when the thing that matters is Daffodil's BRC certificate.

**What the parser does, and the four rules in it.** `readSupplierArchive(entries, { today })` takes a flat
list of paths — which is all a zip walk or a `find` produces — and returns `{ files, skipped, expired,
vendors }`. It is **pure**: no Express, no database, no zip library.

1. **The expiry is READ from the filename, never guessed.** Eight of AIFI's certificates carry it —
   `exp 7-11-2027`, `exp. 01-11-2027`, `exp 10-31-2025`. A certificate whose name carries no date gets no
   expiry, because an invented one puts a supplier's approval on a clock nobody chose.
2. **A blank form is never evidence of a completed one.** `Raw Material Questionnaire Form.pdf` (the blank)
   and `RM VQ-filled-PTC.pdf` (the returned one) sit in the same folder. Filing the first as a completed
   questionnaire is exactly how 24 unqualified vendors would read as qualified.
3. **A folder that is not a year is refused**, not assumed to be a period.
4. **An unrecognised filename is reported with its path, never guessed.** Five of 79 came back unknown, and
   all five genuinely need a person.

**The manufacturer is deliberately NOT parsed out.** Prayon, Daffodil Pharmachem and Dainty Foods are
legible in those filenames, but reading a company name out of a filename is a guess, and attaching a BRC
certificate to the wrong manufacturer is a qualification record that is quietly false. The importer offers
the distinct leading phrases as **candidates for a person to confirm** — the same rule the scanned-tests
importer follows for people's names.

### Verified — `npm run` `node scripts/check-supplier-archive.mjs`, 18 assertions, all passing

Against `scripts/fixtures/supplier-archive-listing.json`, **the real 84-entry listing of both archives**
(paths only, no file contents), with a fixed date so "expired" means the same thing on every run.

| | AIFI | Mill Haven |
|---|---|---|
| Files classified | 77 | 2 |
| Materials, from the container zips | Potassium Citrate, Dipotassium Phosphate, Brown Rice Flour | — |
| Questionnaire on file | **yes** (`RM VQ-filled-PTC.pdf`) | **no** |
| Empty year folders | — | **2025** |

**Mill Haven has no questionnaire and an empty 2025 — the parser reproduces NC 4.3.1 from the folder
structure alone**, and Jake's sheet says the same thing from the other side.

**Five certificates on file have already expired**, and this is the first time anything has been able to
say so:

| Expired | Whose | What |
|---|---|---|
| 2025-07-27 | Daffodil Pharmachem | **BRC Audit Certificate** — 13 months ago, and this is the potassium citrate manufacturer's food-safety certification |
| 2025-10-31 | Prayon – Augusta | Halal Certificate |
| 2026-01-31 | Prayon | Dipotassium Phosphate Kosher Certificate |
| 2026-01-31 | Daffodil Pharmachem | Kosher Certificate |
| 2026-02-08 | Daffodil Pharmachem | Halal Certificate |

**And note where they are: all five are in the 2025 folder, and neither Potassium Citrate nor Dipotassium
Phosphate has a 2026 folder at all.** So those two materials' evidence has lapsed with no refresh on file,
while Brown Rice Flour was refreshed in 2026. That is precisely the state an annual review exists to catch
and the sheet has no way to show.

### The five it could not read, and what they probably are

| Path | Likely |
|---|---|
| `AIFI/2025/Powder Ops LOG.pdf`, `AIFI/2026/…` | AIFI's own log of what they have sent us — needs a name |
| `AIFI/2025/Customer Documents.zip/AIFI Document Expiration.pdf` | AIFI's own register of what expires when. Worth reading — it may already answer the five above. |
| `Mill Haven/2026/425007-01, Inst WPI SF, GF (1).pdf` | A product specification for Instant Whey Protein Isolate — **the material NC 4.3.1 names for Mill Haven** |
| `Mill Haven/2026/Grassfed IWPI w-SFL  (1).pdf` | The same, grass-fed. Note the double space in the filename. |

**One to check by eye, not by rule:** `Dipotassium Phosphate.zip` contains
`Disodium Phosphate Ingredient Composition.pdf`. Disodium phosphate is a **different chemical** from
dipotassium phosphate. Either a mis-filed document or a typo in the filename, and the difference matters.
`[for Jake or Adam]`

## 3a · Jake's sheet, read — 67 vendors, and what it can and cannot say

**Read 27 Aug with the repo's own `readTable()`, which handled it unchanged.** One sheet, 67 vendors, six
real columns (`Actively Using`, `Vendor`, `Contact`, `Questionnaire Requested`, `Questionnaire Completed`,
`Notes`) plus 21 empty ones Excel appended. **It is a good list** — accurate, current, and small enough to
be trusted, which is why it should be brought over rather than replaced.

### What it says

| | |
|---|---|
| Vendors | **67** |
| Actively using | **43** |
| Questionnaire requested | **43** |
| Questionnaire completed | **19** |
| **Actively using, questionnaire NOT completed** | **24** |

**That last number is the finding, and the sheet cannot show it.** SOP 404 § V.A: *"Components ordered for
Powder-Ops will be done through qualified vendors ONLY."* **Twenty-four vendors are being bought from
without a completed questionnaire** — a state the SOP forbids. The auditor sampled three; **Mill Haven and
M4 Dynamic are both on that list of 24**, so NC 4.3.1 is not three vendors, it is twenty-four with three
named.

> **Bay State Milling — the auditor's third vendor — is not in the sheet at all.** Either they are no
> longer used, or the list is incomplete. `[for Jake]`

### Three columns that are not carrying what they look like they carry

1. **`Questionnaire Requested` is identical to `Actively Using`** — verified, the two sets match exactly,
   43 for 43. It records nothing independent. It should become **`questionnaire_requested_at`, a date**,
   because "when did we ask" is the only version of that fact that tells you whether to chase.
2. **`Questionnaire Completed` is a 1, and completing a questionnaire is not approval.** SOP 404 § V.C.III
   requires a **disposition** — Approved, Conditionally Approved, or Not Approved — decided by Quality after
   a risk evaluation. A received questionnaire is an input to that decision, not the decision.
3. **`Notes` has two entries and neither is a note.** *"pinged Lowry for contact info 8/6"* is a follow-up
   with a date; *"COAs received. Need questionnaire"* is a status. Both deserve to be the thing they are.

### The contact cell

**179 email addresses in 67 cells**, up to eight in one (Talus, GWI), 50 vendors with more than one, and a
trailing-comma typo on HPS. Splitting them into rows is obvious and cheap.

**What is NOT worth building: automatic role classification.** Tested against the real addresses — only
**4 of 179** are recognisably quality or regulatory (`regulatory@`, `documents@`, `techdata@`), **64 of the
67 vendors have no obvious quality address at all**, and 143 of the 179 are named people whose role cannot
be read from the address. So the import splits the emails and **marks no roles**, and the quality contact
is learned the way `bank_rules` are learned: **whoever sends FORM 404-1 marks the address they sent it to.**
The app finds out by watching the work being done, rather than asking somebody to fill in 179 dropdowns.

### The mapping

| Jake's column | Becomes | Why |
|---|---|---|
| `Vendor` | `suppliers.name` + `legacy_names` | "Mill Haven" here, "Mill Haven Foods" in the NC report. The join must survive both. |
| `Actively Using` | `suppliers.actively_using` | **Kept, and it stops meaning "qualified".** Two different facts that this sheet conflates. |
| `Contact` | `supplier_contacts` rows | 179 addresses, one per row, no invented roles |
| `Questionnaire Requested` | `questionnaire_requested_at` **(date)** | A boolean cannot tell you to chase |
| `Questionnaire Completed` | `questionnaire_received_at` **(date)** + the file | The PDF is in the vendor's folder |
| `Notes` | `notes`, and a follow-up where it is one | |
| — | **`disposition`** (the SOP's three values) | The decision the sheet has no column for |
| — | **`risk_criteria`** (the SOP's seven) | § V.C.B.I, and the basis of the disposition |
| — | **`vendor_type`** | An ingredient supplier, a packaging supplier and a laboratory are not the same obligation. Eight of the 67 are plainly packaging or supplies. |
| — | **`supplier_materials`** | Which ingredient. The auditor named one per vendor; the sheet names none. |
| — | **`next_review_due`** | SOP 404 § IV.B annual reviews (W2-29) |
| — | **derived: buying without qualification** | The 24. The number the whole list exists to surface, and the one thing it cannot say today. |

**Nothing is dropped.** `Questionnaire Requested` is the only column that carries no information, and even
it becomes a date rather than disappearing.

## 3b · The whole archive, parsed — and the tracker and the folders disagree about half the roster

**836 files, 62 vendor folders, run 27 Aug against the full listing.** The two sample vendors had already
corrected the design twice; the full set corrected it twice more.

### What the full archive changed about the parser

| Assumption | Reality |
|---|---|
| Every file sits under a year folder | **228 of 836 do not**, and 31 of 66 folders have never used one. Undated is a **state**, not an error — refusing them threw away a quarter of the archive. |
| A container zip is named after a material | It is named after a material, a **manufacturer** (`DAFFODILPC.zip`, `KINGDOMWAY.zip` — GWI alone has nine), an **item number** (`23000002 Documents.zip`), a **questionnaire**, or nothing (`OneDrive_1_5-19-2025.zip`). The container is a **label**; what it labels is a suggestion for a person. |
| A certificate says "certificate" | **52 do not.** `Kosher Exp. 12.31.2025.pdf`, `IM Non-GMO (Exp 8.20.25).pdf`, `BRCGS EN (Exp 7.2.2025).pdf`. |
| An expiry is written one way | **Six ways**: `exp 7-11-2027`, `Exp. 12.31.2025`, `EXP 01.26.26`, `exp 12-31-25`, `Exp 18 Apr 2025`, `Exp 12.2024`. |
| Vendors send per-material evidence | Some send **their entire quality system** — Bio-Cat 30 files of SOPs and manuals, Monk Fruit 31, GSO 29. That needs its own kind (`vendor_qms_document`) or it drowns everything else. |

**Classification: 793 files, 268 unknown (34%), reported and never guessed.** Many of the unknowns are
genuinely unreadable from a filename (`PGYS_DB261441.pdf`, product codes, a Chinese-titled pesticide
report), and **40 nested zips are unexpanded in a filesystem listing**, so their contents are not counted
at all — AIFI's one zip alone holds 79 files.

### The finding: the tracker and the evidence disagree for 30 of 56 matched vendors

Matching on name containment (`GNT` ↔ `Exberry-GNT`, `Talus` ↔ `Aceto-Talus`) gives **56 matched pairs, 6
folders with no sheet row, 11 sheet rows with no folder.**

| | |
|---|---|
| **Tracker says NOT done, a questionnaire is in the folder** | **27 vendors — 8 of them ACTIVE**: A&B Ingredients, Forte Flavors, GF Harvest, National Measures, Pacific Bridge, Sabinsa, Stauber, UniChem Supply |
| **Tracker says done, no questionnaire found** | **3, all ACTIVE**: Dutch Valley Foods, Scoular (no unexpanded zips — genuinely absent), Mak Wood (one unexpanded zip, so probably a false negative) |
| **Folder, no sheet row** | 6 — **Bio-Cat (30 files)**, Valrhona Selection, BioNeutra, Balchem, FlexPak, Pyure |
| **Sheet row, no folder** | 11, **10 of them ACTIVE** — Boxt Packaging, GloryBee, HPS, **M4 Dynamic**, Phlex Proteins, Relsus, Stryka, The Cary Company, Vivion, Webstaurant |

**So the sheet's "24 active vendors without a completed questionnaire" is wrong in both directions.** Eight
of those 24 have a questionnaire sitting in their folder that nobody ticked off. Ten more active vendors
have no folder at all, so there is nothing to check. **Neither source alone is right, and no one could have
known** — which is the argument for the register in one sentence.

> **M4 Dynamic — one of the three vendors NC 4.3.1 names — is active, has no completed questionnaire on
> the tracker, and has no folder in the archive at all.** That one is real.

### Two things this changes about the build

1. **Importing the archive is a reconciliation, not a load.** The preview must show, per vendor, what the
   sheet says and what the folder holds, and let a person resolve the 30 disagreements — the same shape as
   the training-log importer's course mapping, where ~30 human decisions replaced 3,639.
2. **`Signed-Completed Supplier Questionnaires/` is a 46-file folder that is not a vendor.** Completed
   questionnaires for several vendors are filed there rather than under the vendor, so "does this vendor
   have one?" cannot be answered from the vendor folder alone. The importer must read it and attribute each
   file — by filename, with a human confirming.

---

## 4 · Four rules that are load-bearing

**1 · A vendor's spec sheet is EVIDENCE, not a specification.** `coa_specifications` is *our* approved
acceptance criteria per item and test, and NC 4.3.6 is precisely about those not having existed. A supplier's
own spec sheet is an input to writing one. **Letting a vendor document become the acceptance criterion it is
graded against is the wrong direction and would be a finding in itself.** So the spec sheet files as
`kind = 'spec_sheet'` against the supplier, and `coa_specifications` gains an optional link to the
`supplier_files` row it was *derived from* — a citation, never a merge.

**2 · A vendor CoA is not a COA request.** `coa_requests` is a test **we commission** from an outside
laboratory on **our** lot. A CoA in the vendor folder is the certificate **they** shipped — SOP 404 § V.C.A.II
requires one at qualification. Different fact, different owner. It files as `kind = 'coa'` with an optional
`lot_number`, **so it also resolves from the receiving record** (`receiving_log.vendor_lot`) without being
duplicated there.

**3 · `on_qvl` is a MIRROR, never an input.** Same doctrine as `knife_accountability.status` and
`products.nfp_version`: the Qualified Vendor List is what the disposition says it is, written in the same
transaction as the decision and nowhere else. A vendor cannot be put on the QVL by ticking a box.

**4 · A qualification is never rewritten; a new period supersedes it.** SOP 404 runs annual reviews, so the
2026 row supersedes the 2025 row and both stay. Correcting a signed disposition is revoke → correct → sign
again, all three audited — the rule QA Review, meetings and the NFP already follow.

---

## 5 · The upload is the hard part, and the answer is not to send the zip here

**Two years of COAs and spec sheets for every vendor is plausibly several gigabytes.** The ceilings that
matter:

| | Limit |
|---|---|
| `media.js` non-video file | **25 MB** |
| `media.js` video | 200 MB |
| The training zip importer | 400 MB, held **in memory** |
| This conversation | far smaller, and D-030 applies — a file in the app is not a file I can read |

So a multi-gigabyte zip does not go through any existing path, and building one that streams a 5 GB archive
through R2 is a real piece of work that should not be invented on the way to a supplier module.

**What actually works, in order:**

1. **Send me a path listing, not the files.** `find . -type f | sort > supplier-files.txt` from the top of
   the extracted archive (or `unzip -l` / `zip -sf` output). A few hundred KB of text, and it is
   **everything the parser needs** — the path *is* the record, exactly as the filename was for the scanned
   tests. I build and test `parseSupplierPath()` against your real folder names, and report which paths it
   cannot read **before** anybody uploads a byte.
2. **Send Jake's spreadsheet.** Small, and it decides the schema's identity question.
3. **The bytes go in through the app**, once the module exists — **per vendor or per year**, which keeps
   every upload inside the existing limits and means a failure costs one vendor rather than the whole
   archive. The importer is admin-only and idempotent, so re-running a batch is safe.

**A question worth settling before step 3, not after:** the per-lot COAs are the bulk of the archive, and
they are receiving evidence as much as qualification evidence. Filing two years of them against the supplier
loses nothing — it is where they live today — but if the volume is large, the qualification record only
genuinely needs **the sample CoA the SOP asks for at qualification**, and the rest can follow later against
their lots. Worth a look at the listing before deciding.

---

## 6 · What I need from you

| | Status |
|---|---|
| ~~Jake's spreadsheet~~ | **Received 27 Aug.** Read, and § 3a is what it says. Identity is **one row per vendor** — `name` is enough. |
| **The path listing** (text, not the archive) | **Still needed.** To write and test the parser against real folder names, and to report unreadable paths before any upload. |
| **A decision on FORM 404-3** (W2-26) | Vendor audits are required by § V.C.B.II and IV.B and the form has never been issued. The module can hold the audit; it cannot number the form. |
| **A question for Jake** | Bay State Milling — cited in NC 4.3.1 for Cinnamon — is not in the sheet. No longer used, or missing? |

## 7 · What this closes

- **NSF/ANSI 455-2 § 4.3.1** — supplier qualification questionnaires not available. Directly.
- **W2-05** — no supplier record of any kind.
- **W2-29** — the annual vendor review with no schedule; `next_review_due` feeds `quality_schedules`.
- **Part of W2-08** — FORM 404-1 and 404-2 stop being `where: keychain` producing nothing.
- **A gap nothing has named yet:** `coa_specifications` is keyed on `item_number` and **has no supplier
  link at all**, and `coa_requests` records a lab but never a vendor. So today ReadyDoc cannot answer *"which
  supplier's material failed this test"* — the question vendor monitoring in SOP 404 § V.E is built on.
  `supplier_materials` is that join.

**Not closed, and deliberately so:** the laboratory register (W2-24, W2-25). SOP 404's laboratory programme
is two sentences naming no standard, no scope and no expiry. Building a register against it would encode
"ISO certification" as a requirement, which is not one. **That half waits for the document.**
