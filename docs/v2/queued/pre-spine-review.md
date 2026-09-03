# Pre-spine review — every open defect, by class

**2 September 2026 · verified against `main` at `320af18` · items 01–05 fixed the same day (marked inline).** Six sweeps, each one a class of bug this
session actually found and fixed, run over the whole codebase to find the other instances. Every entry
carries a `file:line` that was checked; nothing here is a hunch. Nothing in this document has been fixed —
it is the list to work from before the single-spine push, so the push does not carry these into V2.

**Why by class and not by module.** Every bug this week was one of six shapes, and each shape had
siblings nobody had looked for. A module-by-module review finds what the reviewer happens to notice; a
class-by-class review finds what the last bug predicts.

| ID | Class | What it looks like | Instances |
|---|---|---|---|
| **A** | One label, wrong column | "QA Verified" rendered `rinse_verified` | 3 |
| **B** | A picker that cannot offer what the system stores | Area select lacked `Chemical Verification`; the retired-rooms trap | 7 |
| **C** | One nullable column, two readings | `module_access = NULL` meant full access here and none there | 9 |
| **D** | A write path that bypasses the one definition | Task path skipped `canonicalArea()` | 9 |
| **E** | A date computed from *now* instead of from the fact | `createNextWorkOrder` scheduled from `new Date()` | 5 |
| **F** | Vacuous truth | `Object.keys({}).every(…)` is `true` | 10 |
| **G** | A mirror written directly, or a source moved without its mirror | Knife status, product readiness | 16 |
| **H** | A wide table with no card layout on a phone | Right-hand columns unreachable at 360px | 5 clipped + 10 wide |

---

## Fix these first — compliance record or release gate affected

These are the ones where a filed record is wrong, a signature is weaker than it looks, or a control that
the NC triage says exists does not exist on one of its doors.

### D1 · The ATP reading taken on a TASK is never graded — and OBL-01 says grading "landed"
**FIXED 2026-09-02** — `fileQaInspectionRecord` grades with the form door's three lines, stores reading + limit, raises the re-clean on the second failure. OBL-32 landed. `npm run verify:atp`, 20 assertions, control fails 6.
`server/api/pm.js` has **zero** references to `atp`. `src/components/compliance/OperatorView.jsx:774-777`
captures `readings.atp_reading` with the live `AtpLimitHint` beside it on Production Line Pre-Op and
changeover cleans; `complete-and-recur` files the record through `fileQaInspectionRecord` (`pm.js:116`),
whose INSERT has no `atp_reading` or `atp_limit` column. A 200 RLU swab entered on the floor files as
whatever the visual answer was; the number lands only in `work_orders.readings` JSON, invisible to the log,
the exports, the swab-stock count and the consecutive-failure chain. `POST /sanitation` and `PUT /sanitation/:id`
are the only graded doors. **OBL-01 is `landed` for one door of two.** Split it (the OBL-01/OBL-27 rule).

### D3 · The QMS module's own Approve button skips the signature password and overwrites signatures
**FIXED 2026-09-02** — both approve doors go through `signQmsApproval` behind `gateSignature`; bulk checks the password once before the loop. `npm run verify:qmssig`, 18 assertions, control fails 7.
`server/api/qms.js` `POST /:type/:id/approve` writes `approvals[key] = {name…}` inline with **no
`gateSignature`**, **no already-signed refusal**, and no `paper_record` skip — all three of which
`signQmsApproval` (`qms.js:1155`) provides and QA Review uses. Signing a deviation from QA Review asks for
the password; signing the identical deviation from the Deviations screen does not. `gateSignature` has
exactly four callers and this is not one of them. Bulk-approve has the same shape.

### C1 · A nothing-assigned account can write QMS records
**FIXED 2026-09-02** — `requireType` reads the map through `moduleLevel()`: NULL is nothing, View may file, Edit may change. `npm run verify:qmsgate`, 11 assertions, control fails 5.
`server/api/qms.js:101`: `if (ma != null && !Array.isArray(ma) && ma[cfg.moduleId] !== 'edit')` — a
**NULL map passes**, and so does a legacy array. Every other module reads NULL as *nothing* and refuses
even GETs. `/api/qms` is mounted at `server.js:1855` **outside `requireModuleWrite`**, so this line is the
only gate on QMS writes. The `module_access` bug from Settings, on the server, still live.

### D4 · A third completion door files no record
**FIXED 2026-09-02** — `PUT /work-orders/:id` refuses `completed` and `not_applicable` and names their doors; the dead completion side-effects are gone from it. `npm run verify:doors`, 12 assertions, control fails 4.
`PUT /pm/work-orders/:id` with `status: 'completed'` (`pm.js:767-803`) writes `completed_at`/`completed_by`
and never calls `fileQaInspectionRecord` / `fileDilutionRecord`, skips `resolveBackdate`, and skips the
food-contact step gate. The comment at `pm.js:1113` names this exact defect for `batch-complete` — "two
ways to finish a task is two chances for the record to go unwritten" — and a third way was left uncovered.

### F1 · An empty scale form grades as PASS with zero readings
**FIXED 2026-09-02** — `gradeReadings` returns `empty`, never complete, never pass; `controlled.js` never applies `points: []`; the caller names the real problem. `npm run check:scale`, 7 assertions, control fails 1.
`server/scale-forms.js:211-212`: `complete = readings.every(r => r.value !== null)` and
`result: complete && readings.every(r => r.pass) ? 'pass' : 'fail'` — both `true` on `[]`. Reachable:
`server/controlled.js:88` applies `form.points = snap.points` whenever `Array.isArray(snap.points)`, and
`[]` is an array. The guard at `scale-verification.js:42` degenerates to "All 0 weight readings are required."

### G1 · Returning your own knife leaves the master row `issued` forever
`server/api/qms.js:271-311` `POST /qms/mine/checked-out/:id/return` closes the log record and never calls
`syncKnifeStatus`. `knife-state.js:12-17` documents this as the fixed bug — "an operator standing at the
scanner could not sign out a knife that was physically on the rack" — and this is the door the floor
actually uses (`CheckedOutPanel.jsx:38`). Bulk-delete (`qms.js:1006`) and CSV import (`qms.js:1292`) skip
the sync too.
**FIXED 2026-09-02** — the self-return, bulk-delete and CSV import all move the master row through `syncKnifeMaster` / `syncAllKnifeStatuses`; `knife_sign_out` gained the `csv.map` it never had. `npm run verify:knife`, 13 assertions, control fails 2.

### G2 · A production amendment can contradict its own `mo_lines`
`server/api/production.js:876-880` `AMENDABLE` lets `product_name`, `mo_number`, `lot_number`, `room`,
`start_time`, `end_time`, `quantity_completed` be patched directly, and the mirror block at `:951` yields
to them. On a multi-MO entry the scalar and line 0 can disagree inside a QA-signed record. Separately,
`room`, `start_time` and `end_time` are never re-derived when `mo_lines` is amended.
**FIXED 2026-09-02** — on a multi-MO entry the seven mirrored scalars refuse a direct patch (400, naming them) unless the lines travel in the same request; room and the shift window are re-derived whenever the lines or cleans change. `npm run verify:prodmirror`, 16 assertions, control fails 5.

### B1 · Editing a withdrawn SOP silently returns it to Draft
`src/components/compliance/DocumentRegistry.jsx:273` filters `archived` out of the status select. The edit
form loads `status='archived'`, the value is not among the options, the browser picks the first — `draft`.
Fixing a typo on a retired document puts it back in the active registry. The retired-rooms trap, on the
controlled-document registry.
**FIXED 2026-09-03** — the server refuses both crossings on PUT: a withdrawn document cannot be given another status (use Reinstate), a live one cannot be set to archived by an edit (use Withdraw, which takes the reason); the form disables the select and says why. `npm run verify:docwithdraw`, 13 assertions, control fails 4.

### E1 · A daily checklist completed late loses the days in between
`server/api/checklists.js:170` and `:192` call `calcNextDueDate(template.frequency)` — the helper
**already takes a `fromDate`** (`:7`) and neither caller passes `instance.due_date`, which is in scope.
This is `createNextWorkOrder` before its fix, unrepaired, on both the complete and the skip path.
**FIXED 2026-09-03** — both the complete and the skip path hand `calcNextDueDate` the instance's own due date; `per_shift` keeps the clock, since a bare date carries no hours. Covered by `npm run verify:cadence` (19 assertions, control fails 7 across E1–E3).

### E2 · Document review stamps today and ratchets the anniversary earlier every cycle
`server/api/documents.js:56-62` `recomputeDocumentReview` sets `last_reviewed = date('now')` — while
`backdate.when` is live eight lines away at the caller (`pm.js:1079`) — and `review_due = date('now', +N)`
rather than from the existing `review_due`. Tasks are raised 30 days early, so reviewing on the day the
task appears moves the anniversary a month earlier, permanently, every cycle.
**FIXED 2026-09-03** — `server/review-cadence.js` is the one rule: done early, the next is measured from the DUE date; done late, from the day it was DONE. `recomputeDocumentReview` takes the performed day from the task's back-date and anchors on `review_due`. `npm run check:cadence` (17, pure) + `verify:cadence`.

### E3 · Supplier annual review has the same ratchet
`server/api/suppliers.js:404` `next_review_due = date('now', '+1 year')`; the qualification row with its
existing `next_review_due` is selected at `:394` and unused. Same 30-day-early task, same drift, on SOP 404's
anniversary.
**FIXED 2026-09-03** — the disposition anchors on the supplier's latest `next_review_due` through the same rule. Covered by `verify:cadence`.

### A1 · The Auditor View's training table shows no names
`src/components/compliance/AuditorView.jsx:247` and `:267` render `r.person_name || r.user_name` — neither
column exists on `training_records`; the column is `employee_name` (`db.js:591`). Every person reads `—`
on screen and the exported CSV ships a blank Person column, on the one screen built to hand records to an
auditor. Copied from the certifications section where `person_name` is real.
**FIXED 2026-09-03** — one column list (`src/lib/auditorTraining.js`) renders the table and the CSV; `npm run check:auditor` walks each column with a recording proxy and asserts every property it reads exists on the table or the endpoint's joins. 24 assertions, control fails 6.

---

## Then these — user-visible, wrong on screen, or a control weaker than it looks

### Class A — one label, wrong column
- **A2** `AuditorView.jsx:251` "Trainer" falls back to `verified_by`, which does not exist on `training_records` — dead today, and names counter-signature under a delivery label.
- **A3** `AuditorView.jsx:249` "Completed" reads `completed_at || completion_date`; only the second exists.

### Class B — a picker that cannot offer what is stored
- **B2** `ProductsPanel.jsx:339` `artwork_status` omits `rejected`, which `artwork.js:327` writes. Editing anything else on a rejected product clears the rejection.
- **B3** `TrainingPanel.jsx:568` method select has no blank option; historical rows are NULL, so editing one fabricates `in_person`.
- **B4 (systemic)** `GET /structure/lists/:key` returns active options only, and no managed-list select uses `keepCurrent` — `SanitationPanel.jsx:439` (area; and `canonicalArea` deliberately leaves unrecognised values as filed, which this select can then never offer, so correcting an unrelated field forces a re-assignment), `ReceivingLogPanel.jsx:351,362`, `CustomFields.jsx:26`, `QMSRecordsPanel.jsx:641`, `ProductionLog.jsx:383`, `VisitorKiosk.jsx:305`.
- **B5** `PMSchedulesPanel.jsx:77` task_group offers no `document_control`/`office`; `pm.js:750` writes `document_control`. Blank fallback → work orders route to `warehouse`.
- **B6** `MeetingsPanel.jsx:45-49` writes `office`/`sanitation`/`production` into `work_orders.task_group`; `PMPanel.jsx:934-943` has no tab for any of them. A meeting action assigned to Office (the default) reaches no team's list.
- **B7** `SanitationPanel.jsx:472` equipment select drops the link for retired equipment on save.

**B2–B7 FIXED 2026-09-03** — `src/lib/managedList.js` `withCurrent()` appends the stored value when the list no
longer offers it, labelled so nobody picks it for a new record; every managed-list select (sanitation area and
equipment, receiving UOM and release status, custom fields, QMS record fields, EOD answers, meeting types) goes
through it. `shared/task-groups.js` is the one team list: Task Center's tabs are derived from it, Meetings and
Recurring Schedules import it, and Office is a tab. Products offers `rejected`; the training method has a blank.
`npm run check:managed`, 29 assertions, control (helper never appends) fails 4.

### Class C — one nullable column, two readings
- **C2** `compliance.js:380` and `:492` INNER JOIN `equipment` — the documented LEFT-JOIN fix covered four queries and not these two; document-review, meeting, chat and public-report tasks vanish from the dashboard's upcoming list and the lubricant extract.
- **C3** `loto_required` is nullable (`db.js:3098`); `equipment-types.js:86` reads NULL as *needs LOTO*, `compliance.js:392,559` and `loto.js:165` read `= 1` so NULL is *excluded*. The checklist can demand a procedure the badge refuses to count.
- **C4** `forms.js:147` groups `sanitation_records` by raw `record_group` without `COALESCE`; NULL forms its own bucket and one area appears as two rows.
- **C5** `facility.js:33-38` computes `last_clean` over all groups while `reclean_status` on the same tile uses sanitation-group only; the two numbers on one tile disagree by construction.
- **C6** `forms.js:48` checks a `'form-registry'` grant that is not in `ALL_MODULE_IDS` and cannot be granted — dead branch, same class as the documented `canBuildLogs` one.
- **C7** `src/utils/permissions.js:37-46` vs `server/module-access.js:81` — the server gives an admin `edit` unconditionally; the client respects an admin's restriction map. A module un-ticked for an admin is hidden in the nav and writable through the API.
- **C8** `asset_kind` NULL: `COALESCE(...,'machine')` in one reader, `!= 'zone'` in three — unreachable today (NOT NULL), noted so the constraint is never relaxed.
- **C9** `qa-review.js:108` `AND qa_waived_at IS NULL AND qa_waived_at IS NULL` — duplicated predicate, harmless.

**C2–C7, C9 FIXED 2026-09-03** — the two dashboard joins are LEFT JOINs; `loto_required` NULL is closed off at boot
and every SQL reader COALESCEs it the way `needsLoto()` reads it; the form register and the facility tile read
`COALESCE(record_group, 'sanitation')`; the dead `form-registry` grant is the document-control hub's edit grant;
the server honours an admin's restriction map exactly as the client does (Settings can never be taken away); the
duplicated predicate is gone. `npm run check:onereading`, 30 assertions incl. server/client agreement on twenty
cases, control fails 12. C8 stays a note — the constraint must not be relaxed.

### Class D — a write path that bypasses the one definition
- **D2** `qa-record-backfill.js:139-152` inserts `recordAreaForTask()`'s output raw — the *bulk* path re-creates the `Restroom`/`Restrooms` split months at a time. One line: `canonicalArea(p.area) || p.area`.
- **D5** `products.js:845` `POST /` and `:455` `bottle-drafts` insert `spec_id`/`artwork_status` without `stampReadiness`, so `readiness_basis` is NULL and the *next* unrelated write stamps the post-write facts as the baseline — a GTIN corrected after creation can never make the artwork step stale. `rename` and `realign` leave the `sku` step describing the old code. The docblock at `products.js:53-57` names "the barcode upload" as a caller and it is not one.
- **D6** `cleaning-seed.js:70` seeds `'Restroom'`, the one seed row that differs from what `canonicalArea` would produce.
- **D7** `checklists.js:243-252` and `loto.js:132-136` take `verified_by` **from the request body** with no role check and no `gateSignature` — the two defects `verifySanitationRecord`'s docblock says were fixed on the sanitation route.
- **D8** `documents.js:862` `PUT /:id` snapshots the *new* state into `sop_versions`; `applyRevision:484` snapshots the *previous* one. The column means two things. And PUT owns `training_revision`, which `applyRevision` never touches — a revision applied through the upload worklist never triggers retraining. `reference-seed.js:114` and `banned-substance-sop-seed.js:86` write no baseline version.
- **D9** `SCOPE_TABLES` declares `qms`, `supply_order`, `disposal` custom-field scopes; no route calls `coerceCustomData` for any of them — a custom field defined on those records is silently dropped on save. `retention.js:234` and `reimbursements.js:181,293` discard the `errors` array.

**D2, D5–D9 FIXED 2026-09-03** — the backfill and the cleaning seed file the canonical area; checklist and LOTO
verification are a signature by the caller behind `gateSignature` (the LOTO verifier must differ from the person
who locked out, and the browser prompt is gone); `applyRevision` snapshots the document as it now stands and
moves `training_revision`, the seeds write a baseline version (and the reference-library seed had been dying on
its first row — six standards seed now); product POST, bottle-drafts, rename and realign all call
`stampReadiness`; the `qms:*`, `supply_order` and `disposal` scopes are no longer offered until a route reads
them, and retention / reimbursements answer a required-field error with a 400. `npm run check:canonical` (18,
control fails 14) and `npm run verify:writedoors` (22 live, control fails 12).

### Class E — a date from *now*
- **E4** `quality-schedules.js:61` stamps the generated work order `due_date = date('now')` while the schedule correctly advances from `s.next_due`; a check that came due on the 1st and was raised on the 4th reads as on time.
- **E5** `sanitation.js:169` treats a production-log clean as 23:59 of its day — a data-model limit (the entry has no time), not an oversight; noted, not a fix.

**E4 FIXED 2026-09-03** — see the class G note; `due_date` is `s.next_due`.

### Class F — vacuous truth
- **F2** `COAPanel.jsx:476,506` `g.tests.every(...)` unguarded — latent, groups are hardcoded.
- **F3** `check-product-readiness.mjs:40` asserts `.every(done)` with no length check.
- **F4** `check-supplier-archive.mjs:81`, `check-supplier-reconcile.mjs:79`: `t('nothing was written', true)` — a hardcoded pass.
- **F5** `verify-kiosk-isolation.mjs:279` VK-33 `Object.keys(opts).every(...)` — the exact original bug in a test.
- **F6** `verify-kiosk-isolation.mjs:175` VK-14 `!look.length ||` makes zero rows an explicit pass and prints "0 rows" beside PASS.
- **F7** `verify-kiosk-isolation.mjs:65,72` VK-05/06 assert `[]` without `r.ok`; VK-07 beside them does.
- **F8** `verify-suppliers.mjs:121-125` three `.every()`s over filters that may be empty; the counts are printed and never asserted.
- **F9** `check-reclean-titles.mjs:77` a negated regex over `?.description || ''` passes when the task was never raised.
- **F10** `verify-supplier-storage.mjs:223,298` the commit response is assigned and never asserted; both follow-ups are no-change assertions.

**F3–F10 FIXED 2026-09-03** — each asserts the positive fact first: the pure module imports nothing that can write, the seeded Admin is a row to inspect, both supplier gaps are non-empty and equal their summary counts, the no-clean task exists before its description is read, and the import commit's own count is what the register gained. Every touched suite re-run green.
- **Residual** every `LIKE` guard is `if (q)` not `if (q.trim())`; a whitespace query yields `LIKE '% %'`. `coa.js:474` prepares `IN ()` one line before its guard.

### Class G — mirrors
- **G3** `sanitation.js:700` `closeRecleanTasksFor` completes a work order without clearing `rework_required` — the card reads completed + Rework forever.
- **G4** `equipment.js:88-89` `syncTaskGroupToPM` re-routes every open work order on an asset by `equipment_id`, overriding the `qa` tagging `tagQaInspectionTasks` applied — QA inspection tasks silently leave QA's list until the next restart.
- **G5** `pay.js:270-272, 392, 708-710, 729` read `pay_employees.name`/`is_supervisor` directly, bypassing `withLinkedNames`/`isSupervisorRow` — stale names in assignments, history and the reviewer DMs. The authority gates at `:300,348` are correct; only presentation drifts.
- **G6** `office.js:275` lets `qty` be edited with no re-derivation; status moving *away* from `received` leaves the count at full. "Received" beside "3 of 10 arrived."
- **G7** `onboarding.js:188` creates a user with **no `username`** — a new starter cannot sign in until the next restart runs `backfillUsernames`. (Same omission for ReadyBot at `comms.js:490`.) **Introduced by this week's fold; mine to fix.**
- **G8** `users.js:340` the rename-follow test `existing.username === deriveUsername(existing.name)` fails for any username `uniqueUsername` disambiguated ("Jose Garcia 2"), so those sign-in names freeze silently.
- **G9** `sanitation.js:512` `POST /areas/normalize` rewrites `area` without `recordGroupFor` — contained by the SELECT's scope, not by design.
- **G10** `products-seed.js:74,120` writes `products.nfp_version` with no `nfp_versions` row — latent, the CSV column is empty.
- **G11** `seed.js:22` inserts equipment without `asset_kind`/`loto_required` — latent, no zone types in seed data.
- **G12** `submit.js:148` writes the knife master directly before re-deriving — cosmetic, the sync corrects it.
- **G13** `products.js:787` comment says `nfp_version` is "deliberately left WRITABLE" — the opposite of the code and the paragraph under it. Doc bug in the paragraph other modules cite.

**G3–G11, G13 and E4 FIXED 2026-09-03** — the re-clean close clears `rework_required`; reassigning a machine leaves
QA's inspections on QA's list; assignments, reviews and the nudge read the linked name and role through
`withEmployeeFacts`; a supply order refuses a quantity below what arrived and refuses leaving `received` while the
count is full (a negative receipt is the door), and a changed quantity moves the status with it; ReadyBot is
created with a username; a disambiguated username still follows a rename; the area normalizer writes
`record_group`; the products seed never writes the NFP mirror; the equipment seed classifies what it inserts;
the NFP paragraph says what the code does; a raised quality check is due when the schedule said. **G12 stays as
noted** (cosmetic; the sync corrects it). `npm run check:mirrors` (15, control fails 14) and the supply-order
section of `verify:writedoors` (27 live).

### Class H — mobile
`src/index.css:64` sets `body { overflow-x: hidden }`, so a wide table with no scroller does not pan — it
**clips**, and the columns past the fold are unreachable. 29 logs already have the UsersSection card
pattern (`hidden md:block` table + `md:hidden` cards from shared cell components), including Sanitation,
QA Inspections, Production Log, Receiving, LOTO, Chemicals, Disposals, Retention and Calibration
Instruments. `DataGrid` has a card mode. These do not:

**Clipped — columns unreachable:**
- `COAPanel.jsx:167` COA lot-check result — Status and Date are the clipped columns, and they are the answer
- `COAPanel.jsx:321` COA extracted-results edit form — the Pass/Fail column falls off
- `TrainingPanel.jsx:1511` Training › Due — the status pill clips
- `COAPanel.jsx:997` COA request detail results
- `RetentionSamplesPanel.jsx:454` Retention import preview

**Wide with a scroller only, floor/QA-facing, in likely-phone order:**
`CalibrationPanel.jsx:570` (Records — the Instruments tab beside it has cards) · `TrainingPanel.jsx:1576, 1469`
(Records, Matrix) · `DocumentRegistry.jsx:1149` (SOPs / WIs / JDs / Reference — four tabs, 8 columns) ·
`PMSchedulesPanel.jsx:224` (Recurring Schedules, `min-w-[46rem]`) · `VisitorLogPanel.jsx:154` (the Signed-out
action is the far-right column) · `RetentionSamplesPanel.jsx:571` · `ProductionLog.jsx:1263` (anomaly review) ·
`SafetyPanel.jsx:291` · `TimeTrackingPanel.jsx:476` (Stats — Entries has cards) · `DisposalsPanel.jsx:273`.

**FIXED 2026-09-03 (the clipped five and the floor-facing ten)** — `src/components/common/RecordCards.jsx` is the
card pattern once; each log renders `<RecordCards>` from the same row array and the same handlers as its
table (`hidden md:block`), so the two layouts cannot offer different buttons on one record. The three grids
of inputs / previews (COA extracted-results edit, COA request results, Retention import preview) pan in a
scroller instead — a form is not a log. **The Training Matrix keeps its scroller on purpose**: a matrix is
wide by definition and its sticky first column is the right idiom. `npm run verify:mobile` seeds one record
into each log, opens every screen at 360×740 in a real browser and asserts nothing sticks past the viewport
and the cards are on screen with the table hidden — 37 assertions; with the components reverted 19 fail,
including the Training Due table measured at 370px in a 360px viewport.

Laptop-facing, same shape, lower priority: `SuppliersPanel.jsx:198`, `ProductsPanel.jsx:590`,
`ProductBarcodes.jsx:125`, `TeamActivityPanel.jsx:81`, `ProductionDashboard.jsx:176`, `COAPanel.jsx:2346`,
and the thirteen `AuditorView` sections.

---

## Proposed order

1. **D1, D3, C1, D4, F1** — the five that change what a compliance record or a signature *is*. Each is small. D1 also splits OBL-01.
2. **G1, G2, B1, E1, E2, E3, A1** — wrong on a filed record or on the auditor's screen.
3. **The test assertions, F4–F10** — before anything else is built, because they are why the rest went unnoticed. Cheap, and every later fix gets a real control.
4. **B4 systemic** — one `keepCurrent` on the managed-list select component fixes seven screens.
5. **Class H clipped five**, then the ten floor-facing wide tables through the existing card pattern.
6. **The rest of D, C, G** in listed order.
7. **G7** goes in with the onboarding module's first real use, whichever comes first.

Each fix carries a check that fails on the old code — the control is the deliverable, not the patch.
