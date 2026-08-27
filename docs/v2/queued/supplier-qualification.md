# Supplier & Laboratory Qualification — the module, the seed, and the two importers

**Design · 27 August 2026 · nothing built · answers "can this be seeded, run on the V2 spine, and carry
the files?"**

**Short answer: yes, and almost none of it is new machinery.** The spreadsheet importer exists, the zip
importer exists, the R2 file path exists, the expiring-certificate pattern exists, the approval-with-a-
signature pattern exists. What does not exist is **a supplier** — W2-05 — and that is the whole build.

**One correction to what Wave 2 said.** That review put SOP 404 last on the build order because W2-25 found
the laboratory half unwritable. **That is true of the laboratory half only.** The *supplier* half of SOP 404
V4 is the best-specified of the four Wave 2 documents: § V gives the pre-assessment steps, the seven risk
criteria, three named dispositions, the QVL, emergency vendors, monitoring and disqualification. **The
supplier module can be built from the document as it stands. Only the laboratory register waits on
W2-24/W2-25.** Split the obligation rather than blocking both on one paragraph.

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

### The zip → the scanned-tests pattern, applied to paths instead of filenames

`server/api/training.js` already reads a zip with `adm-zip`, parses each entry's **name** into a record,
previews what it would create, and attaches the file as evidence on commit. **The supplier zip is the same
shape with the path doing the work the filename did:**

```
Mill Haven Foods/2026/Completed Questionnaire/FORM 404-1 signed.pdf
└── supplier ───┘ └yr┘ └──── kind ─────────┘ └──── the file ────┘
```

`parseSupplierPath()` returns `{ supplierName, periodLabel, kind, filename }`. Everything else follows the
importer rules this repo already enforces:

- **Nothing is invented.** A path that yields no supplier, no year, or no recognisable kind is **reported
  with the reason and skipped**, never guessed. Same rule as the scanned tests, and the reason that
  importer is trusted.
- **The supplier name is matched, not created blind.** Exact match on a normalised key wins outright;
  anything else is a **suggestion** ranked by bigram similarity with the whole list available for
  hand-mapping — because "Mill Haven Foods" and "Mill Haven Foods, Inc." are the same vendor and only a
  person can say so. Unmapped vendors are skipped and counted, mappable on a later run.
- **Idempotent** on `supplierKey + period + kind + filename`, stored as `source_path`. Re-importing a
  corrected folder updates in place rather than doubling it, and `already_imported` is counted **separately
  from** `repeated_in_file`.
- **Preview writes nothing.** A supplier register bulk-written from a zip nobody checked stops being the
  thing that answers "show me their qualification".

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

| | Why |
|---|---|
| **The path listing** (text, not the archive) | To write and test the parser against real folder names, and to report unreadable paths before any upload |
| **Jake's spreadsheet** | It decides identity: one row per vendor, or one per vendor-material? |
| **A decision on FORM 404-3** (W2-26) | Vendor audits are required by § V.C.B.II and IV.B and the form has never been issued. The module can hold the audit; it cannot number the form. |
| **Nothing else** | The supplier half of SOP 404 is specified well enough to build from as it stands |

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
