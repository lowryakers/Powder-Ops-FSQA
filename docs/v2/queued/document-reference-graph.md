# Queued — the document reference graph, and the fan-out on re-issue

**Status: designed, not built · 25 August 2026 · Track B (new construction)**

The "hub and spoke" question, answered as a build: revise Protocol 003 and have every document that
depends on it land in Document Control's queue with a reason, instead of relying on somebody
remembering the dependency.

---

## The rule this implements — three tiers, and only two of them are automatic

**Tier 1 — values propagate automatically, and already do.** A limit, a frequency, a tolerance, a form
number is read from the document *at the moment it is used*. `atp-limits.js` and `scale-forms.js` are
the working examples; change the approved revision and every grading decision follows, because there is
no second copy. Nothing in this document changes that.

**Tier 2 — obligations are raised automatically. This is the build.** Re-issue a document and every
document, program and form that references it gets a task saying *the parent changed — does this still
say the right thing?* One spoke already works: `retrain_on_doc_change` supersedes completed training
records for courses linked to a revised document. This generalises that from training to everything.

**Tier 3 — text is NEVER auto-written, and this must not become a way to do it.** An SOP whose wording
was generated because a plan changed has no author and no approver, which is what "controlled" means.
Its change record would say the change was made by nobody, it would fire retraining on text nobody
wrote, and often there is nothing to propagate anyway — PC #1's monitoring says *"Procedure as outline
in cleaning SOP"*, so the plan **points at** the SOP rather than containing it. **The spoke delivers a
task with a name on it, never an edit.**

---

## What already exists, and it is most of the hard part

`server/doc-consistency.js` already finds document-to-document citations: it scans each document's body
for `SOP 401` / `WI-007` / `FORM 431-02` style references, normalises them (`normalizeDocNumber` folds
`WI 007`, `WI-007` and `WI7` to one number), and reports which point at documents the registry has
never heard of. It is read-only and writes nothing.

**Finding the references is solved. What is missing is storing them and acting on them.**

---

## The build

### 1. `document_references` — the graph, derived and rebuilt, never hand-maintained

```sql
CREATE TABLE IF NOT EXISTS document_references (
  id TEXT PRIMARY KEY,
  from_doc_id TEXT NOT NULL,          -- the document doing the citing
  to_doc_id TEXT,                     -- NULL when the citation resolves to nothing
  to_doc_number TEXT NOT NULL,        -- always kept: an unresolved citation is a finding
  kind TEXT NOT NULL DEFAULT 'cites', -- cites | supersedes | implements
  source TEXT NOT NULL DEFAULT 'body',-- body | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_doc_id) REFERENCES sop_documents(id),
  UNIQUE (from_doc_id, to_doc_number, kind)
);
```

**Derived, not stored as a fact somebody maintains.** Rebuilt from the bodies whenever a document is
saved — the same doctrine as derived readiness and the form registry. A hand-added link (`source =
'manual'`) is the escape hatch for a dependency the text does not state, and is the only kind a rebuild
must not delete.

**`to_doc_number` is kept even when `to_doc_id` is NULL.** A document citing a number the registry does
not hold is exactly what `doc-consistency.js` reports today, and the graph must not quietly drop it.

### 2. The fan-out, on **material** revision only

`api/documents.js` already computes `materialChange` and already uses it to trigger retraining. Hang
the fan-out on the same flag — a typo fix must not put twelve documents in Daniela's queue.

For each document citing the revised one, raise **one** obligation carrying the parent's number, its
new revision and its change summary. Not a copy of the change: a pointer and a question.

**Three rules that keep this from becoming noise:**

- **One open obligation per (child, parent) pair.** Revising Protocol 003 three times in a week must
  produce one task that says "three revisions since you last looked", not three tasks. Same rule as
  `flag_key` on the 72-hour re-clean.
- **Routed to the child document's owner**, not to Document Control as a pile. `sop_documents.owner`
  already exists.
- **Withdrawn documents are skipped.** A document `archived` / "no longer in use" cannot need updating.

### 3. What the obligation *is* — decide before building

Two candidates, and this needs Document Control's answer rather than a guess:

- **A Document Change Request** (FORM 406-1, `qms_records`) — heavier, already the controlled route,
  and produces the record an auditor recognises.
- **A doc-review task** (the mechanism the review-due cadence already uses) — lighter, and the honest
  shape when the answer is usually "still correct, no change needed".

**Recommendation: the review task**, with raising a DCR as its outcome when the answer is "yes, this
needs to change". A DCR per citation would raise a formal change request for documents that turn out
to need no change, and an auditor reading a register full of DCRs closed with "no change required"
learns the wrong thing about how the plant manages change.

### 4. `doc-review.js` gains a source

The Doc Control Review Center is already a registry of "what do I owe today" with four sources. This is
a fifth: **Affected by a revised parent**. It has a real `action` (mark reviewed, no change needed) and
so is batchable, unlike the parked-change and open-DCR tabs.

---

## The limit worth knowing before it is built

**The graph only sees documents whose body text is in ReadyDoc.** An SOP held as an attached PDF with
an empty `description` has no citations to find, so it appears in the graph as a leaf — nothing cites
it, and it cites nothing. That is not a bug in the graph; it is the state of the registry.

`doc-consistency.js` already reports these as **`empty_shells`** — active documents with no body and no
file. **Run that report before building this** and treat its count as the coverage figure: a fan-out
across a registry that is half empty shells will look like it works and will silently miss half the
plant's documents. That is the same failure mode as the QA records that filed for three months against
an empty list.

If coverage is poor, the fix is not a cleverer parser. It is Document Control's existing project —
bringing the ~100 documents up to date from the finalised paper, which `RevisionUploadModal` and
`POST /documents/propose-revisions` already support.

---

## Track split

| Piece | Track | Why |
|---|---|---|
| `document_references` table + rebuild + graph API | **B** | New construction, new file |
| Fan-out on material revision | **A**, queued | Touches `api/documents.js`, live |
| `doc-review.js` fifth source | **A**, queued | Touches a live registry |
| The obligation-shape decision | **Neither** | Document Control's call, needed before the fan-out is written |

## How to verify

- A document citing `SOP 401` in its body produces one `document_references` row; correcting the body
  to cite `SOP 402` leaves exactly one row, not two.
- A citation to a number the registry does not hold is stored with `to_doc_id` NULL and shows in the
  consistency report.
- A **minor** revision raises nothing. A **material** one raises exactly one obligation per citing
  document, routed to that document's owner.
- Revising twice before the first is actioned leaves one open obligation, not two.
- A withdrawn document raises nothing and receives nothing.
- A manually-added link survives a rebuild; a body-derived one that no longer appears in the text does
  not.
