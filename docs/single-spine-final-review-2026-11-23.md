# Single Spine — final review of the 23 November merges

Reviewed: the fourteen PRs merged on 23 Nov 2026 (#175–#191, excluding the still-open #180, #184, #187),
starting from `cc7d207` (#191). Review only: no new features. Line numbers are from `main` at the time of
writing, after #192 (`e70b7f9`), #193 (`db3f2dc`) and #194 (`02751ec`) merged on 24 Nov.

## Summary

- **Tests:** `npm run check` passes. `verify:all`: 226 of 234 pass. Seven of the 8 failures were already red
  before the 23 Nov merges; the eighth (`verify-bpg-items`) is a test that #176 made flaky, not a product fault (§1).
- **One clear bug found and fixed:** ending access from an onboarding packet did not cancel the person's
  open training (#193, D-382, merged 24 Nov).
- **Moves 01–06:** all six are done for what they set out to cover. The remainders below are known and
  deliberate, not regressions.
- **A second fix, older than today:** `DELETE /disposals/:id` had no role check and could delete a
  password-signed disposal. Lowry decided to block disposal hard-delete for every role (#194, D-383).
- **Retention Samples:** stays in the nav as it is (D-381, #192). The rows in it were migrated from the old
  log; QA never carried on logging retains in ReadyDoc and still uses the old system (§4).

## 1. Test suite

Tip at the start of the review: `cc7d20785118875e0b171bbb2350dd1c474ec958` (#191). Every run below was
against that commit. #192 (docs only) and #193 merged afterwards; #193's own CI (`npm run check`) passed
and its changed test, `verify:spinep1a`, was run on its branch (24/24, control on main fails 2). #194 (disposal
delete blocked) passed `npm run check`, its new `verify:disposalnodelete` (16/16; control fails 14),
`verify-sign-gates` and `verify-record-interface` on its branch.

| Command | Result |
|---|---|
| `npm run check` | **passed** (exit 0). It already runs the pure checks, `check:fresh-boot`, `check:endpoints`, `check:mirrors`, `check:retired` and the COA verify. |
| `node scripts/verify-all.mjs` (all 234 entries) | **226 passed, 8 failed.** Each of the 8 fails the same way when run alone with nothing else running, so none is load. |

How it was run: the full run is longer than one background job may last, and the cloud machine restarted
twice during it (24 Nov), so it was run in parts — 24 entries, then 25, then the remaining 185 one entry
at a time with progress saved after each. No entry was skipped or edited.

**Scripts outside `verify:all`, on purpose:**
- `verify-coa.mjs` — runs inside `npm run check` (passed there).
- `verify-prod-copy.mjs` — **not run.** It needs a copy of the production database file, which this review
  does not have and must not touch (CLAUDE.md, "Boot against a copy of production"). Documented as not run,
  not as red.

`check:composer` and `check:reactions` are browser checks that `verify:all` already runs. Every `check-*.mjs`
in `scripts/` is wired into `package.json`.

**The 8 failures, and whether today caused them.** Each was also run on `da10930` — main just before the
first of today's merges (#176) — with a fresh build.

| Script | What fails | Before today (`da10930`) | Verdict |
|---|---|---|---|
| `verify-bpg-items` | "putting the area back brings the inspection back" — 64/65 | **passes** | Broken by **#176** (`d7434fd`, D-368), bisected. Test fault, not a product fault: the script opens its own database connection with no `busy_timeout` (`scripts/verify-bpg-items.mjs:40`), and since #176 the server runs its housekeeping sweep at boot (`startPmHousekeeping`, `server/api/pm.js:381`). The script's own sweep hits `database is locked`, which `periodically` logs and swallows (`server/housekeeping.js`), so no card is raised. Production has one connection with `busy_timeout = 5000` (`server/db.js:52`) and does not see this. **Medium**: a red test hides real regressions. Fix is one line in the script (`db.pragma('busy_timeout = 10000')`), not made here. |
| `verify-scroll` | Team Activity's sideways scrollbar sits below the screen with Messages docked at 1280px; Controlled Changes pans sideways at 390px (long change details do not wrap) | fails the same | Pre-existing. **Low** (layout). |
| `verify-supplier-materials` | 390px: the supplier screen pans sideways — 42/43 | fails the same | Pre-existing. **Low** (layout). |
| `verify-panel-provenance` | Products → Completeness view does not render at 1280px | fails the same | Pre-existing; cause not investigated. **Medium**. |
| `verify-mmr-gate` | "nothing was written to the product row"; the Completeness chip | fails the same | Pre-existing; not investigated. **Medium** — the first message may be a real write, worth a look. |
| `verify-po-grid` | the Purchase Orders grid never renders (30 s timeout) — 17/18 | fails the same | Pre-existing; not investigated. **Medium**. |
| `verify-coa-phase1` | "every signing source keeps its old shape (no `kind`)" — 99/100 | fails the same | **Stale test.** The calibration-findings pile (D-353, #158, 17 Nov) is an action pile carrying `kind`; the test's list of action piles (`scripts/verify-coa-phase1.mjs:191`) was never updated. **Low**. |
| `verify-merch-design` | expects merch status `Draft` — 24/25 | fails the same | **Stale test.** Statuses became slugs (`draft`) in #146 (12 Nov, D-342); `scripts/verify-merch-design.mjs:67` still expects `Draft`. **Low**. |

None of the 8 is a product regression from the 23 Nov merges. `verify:all` has had seven red entries since before
today, which is worth fixing on its own: a suite that is always partly red is one nobody reads.

## 2. Bug sweep of #175–#191

| # | Severity | Finding | Where | From |
|---|---|---|---|---|
| 1 | **fixed** | End access on an onboarding packet deactivated the account but left its training cards open. D-367 wired the cancel into Settings only. Now both doors call `closeTrainingTasksFor`. | `server/api/onboarding.js` (end-access), `server/api/users.js:515` | #175 `7b3f9dc` → fixed #193 |
| 2 | **fixed** (high, pre-existing) | `DELETE /disposals/:id` had no role or signature check: any account with the Disposals grant could hard-delete a disposal, including one approved with a password. Both delete routes now answer 403 for every role (D-383). | `server/api/disposals.js` | pre-existing → fixed #194 `02751ec` |
| 3 | medium (pre-existing) | `DELETE /receiving/:id` is admin-only but does not refuse a line whose inspection is signed off (#183 made that sign-off a password signature). | `server/api/receiving.js:844-853` | not today |
| 4 | low | Settings → Integrations description still says "QuickBooks", which #191 retired. | `src/components/compliance/SettingsPanel.jsx:143` | #191 `cc7d207` |
| 5 | low | The AI assistant's schema hint still names `checklist_submissions`, whose API #191 retired (the table stays). Harmless; the model may suggest a table nothing writes. | `server/ai.js:337` | #191 `cc7d207` |
| 6 | note | Pre-#183 receiving and disposal sign-offs read `not_recorded` for meaning and fingerprint until signed again. By design. | D-374 | #183 `ec5142b` |

Checked and found clean:
- **No destructive migrations.** No `DROP TABLE` or wipe of a record table in any of the fourteen; #191 removed
  code and left every table (`ap_invoices`, `ar_invoices`, `finance_files`, `qbo_*`, `checklist_*`) in place.
- **No new delete or void paths for records.** The three DELETE routes added today are signature *revokes*,
  each behind `gateSignature`: `server/api/disposals.js:202`, `server/api/production.js:1229`,
  `server/api/receiving.js:518`.
- **Bots never approve.** `tokenApproveGuard` (`server/middleware/no-token-approve.js:163`) refuses a bot
  account on every `APPROVE_ROUTES` match; `check:apitokens` scans every router.
- **No dead references to removed code.** No client file imports `LedgerPanel`, `QuickBooksPanel` or calls
  `/api/finance` / `/api/checklists`; `check:retired` pins it, and an unmounted `/api` path answers a JSON 404.
- **No TODO/FIXME added** by any of the fourteen PRs.

## 3. Single Spine moves 01–06

| Move | Status | Evidence |
|---|---|---|
| 01 one signature path | **done** | `gateSignature` `server/signature.js:176`; receiving sign-off/revoke `server/api/receiving.js:494,518`; disposal approve/revoke `server/api/disposals.js:194,202`; production sign-off/revoke `server/api/production.js:1238,1229`; bots refused at `server/middleware/no-token-approve.js:163`. |
| 02 one record interface | **done** | `RECORD_TYPES` `server/record-interface.js:188`; `retrieveRecords` `:377`; cap `MAX_ROWS = 500` `server/record-cap.js:12`, `truncated_types` `server/record-interface.js:413`; `lot` / `equipment` / `person` lookups uncapped (D-373). COA is read-only on the interface by design (D-372). |
| 03 limits in controlled docs | **done for what was moved** | Propose / QA review / approve in `server/controlled.js` and `server/api/controlled.js`; mock recall criteria and Form 403-01 moved in #186 (`recallControlledEntry`, `auditChecklistEntry`). Other limits remain where earlier decisions put them. |
| 04 one retrieval screen | **done** | Quality → Look up records, `src/App.jsx:178`, over `GET /api/records` (`RecordLookupPanel.jsx`). |
| 05 one schedule generator | **done** | `raiseWorkOrder` `server/raise-work.js:65`, called by quality schedules, PM, documents, sanitation (incl. ATP re-clean and re-clean assign), supplier review, stability and the run-start Pre-Op. Training stays person-only (`server/training-assign.js`). `GET /pm/work-orders` (`server/api/pm.js:896`) is a read; housekeeping runs on the tick (`:381`) and `POST /pm/housekeeping`. |
| 06 mirror sweep | **done** | `MIRRORS` `scripts/check-mirrors.mjs:67`; supply orders through `tagColumns` `server/supply-lists.js:148`. Nothing dropped, nothing backfilled. |

Honest remainders, still true: one-off work-order inserts stay off `raiseWorkOrder` on purpose — New Task
(`server/api/pm.js`), chat-to-task (`server/api/comms.js`), the kiosk (`server/api/submit.js`), meeting actions
(`server/api/meetings.js`) and the seeders; swab reorders write a supply order, not a work order.

## 4. Known open items

- **365 PM schedules have no SOP linked.** #189 added the Doc Control list and a one-at-a-time link; linking is
  a people job, and nothing links automatically.
- **#180 and #184 are open and conflict with main** only in `docs/v2/decisions.md` — both use D-373/D-374,
  which main has since used. #184 is built on #180's branch. Not merged or rebased here.
- **#187 (verify:scroll UI)** is open, unrelated, and merges cleanly.
- **Brandon Meredith (16) and Jose Ortiz (1) training cards** are hidden from assignments and overdue counts by
  #175 (`inactiveAssigneeSql`, `server/work-order-owners.js:18`), not cancelled. The cancel runs only on a new
  active-to-inactive change (`server/api/users.js:515`, and end-access since #193).
- **The records cap of 500** on an unfiltered `GET /api/records` is by design and named in the response.
- **Receiving and disposal sign-offs from before #183** read `not_recorded` until signed again. There is still
  no "acknowledge the miss and raise the next" path.
- **Retention Samples / Stability.** The pack expected option 2 (hide Retention Samples, give Stability its own
  nav entry). Lowry decided against it: **no change** (D-381, #192). Retention Samples is still a Quality nav
  item (`src/App.jsx:194`), Stability is still a tab inside it
  (`src/components/compliance/RetentionSamplesPanel.jsx:36,721-725`), and `/api/retention` and its data are
  untouched. **About the data:** the retain samples in the live system (536 at the pack's read) were migrated
  from the old retention log. QA never continued logging retains in ReadyDoc and still records them in the old
  system, so the module holds history, not current retains. Whether QA moves to ReadyDoc for retains is open
  and is QA's call; nothing in the app needs to change for either answer. Stability had 0 studies.

## 5. PRs from this review

| PR | What | State |
|---|---|---|
| #192 | D-381: Retention Samples stays in the nav as it is | merged 24 Nov (`e70b7f9`) |
| #193 | D-382: end access closes leftover training | merged 24 Nov (`db3f2dc`) |
| #194 | D-383: a disposal is never hard-deleted | merged 24 Nov (`02751ec`) |
| this PR | this report | open |
