# What is unused, what to remove, and the rest of the single spine — 26 October 2026

Measured on `main @ 94f97b7`. No production data was read. "Unused in code" below was found by
looking at what imports what. Whether people use a screen can only be answered from the live
database, so `npm run report:usage -- <copy of the db>` now answers it (read-only, D-214).

## 1. Fix first: two leftovers from the demo build

**a. Boot writes invented maintenance history.** `server.js` (the "Backfill 4 months of completed work
order history" block) runs whenever a database has no completed task. It writes thousands of
"completed" PM tasks under Adam B., Ricardo A. and Spencer R., with random times and notes like
"Cleaned and lubricated". A fresh database gets **1,955** of them. On the live database it ran once,
at the first deploy, and is inert now. The rows it wrote are still there unless someone removed them.
`server/backfill-history.js` is a hand-run copy of the same thing. The "Fix technician names" block
after it rewrites `audit_log.actor`, which an audit trail must never do.

- Run the report on a copy. Its "Invented maintenance history" line counts completed tasks under those
  names that have no audit entry by an account. A real completion always has one.
- If any are found, **retire them** (cancel with a reason, never delete). Team Activity counts them
  today, and an auditor shown "Adam B. lubricated the dehumidifier on 3 March" is being shown a
  fabricated record.
- Remove both blocks from `server.js` and delete `server/backfill-history.js`. Verifies that need
  completed tasks should file their own.

**b. Demo accounts with known PINs.** The same boot block creates Admin (PIN 1234), Adam B. (1111),
Ricardo A. (2222), Spencer R. (3333), QA Tech (4444), Cleaning Tech (5555) and Auditor (9999). An
active account that still has a PIN and no password can be claimed through `/set-password` by anyone
who knows the PIN. The PINs are in a repository. The report lists any such account by name. The fix
is to deactivate it or give it a password. In code: a fresh database should get one admin with a setup
code, not seven PIN accounts.

## 2. Code nothing uses (safe to delete)

| What | Size | Why it is dead |
|---|---|---|
| `LedgerPanel`, `BankingPanel`, `QuickBooksPanel`, `QuickBooksSetupCard` | ~1,500 lines | Hidden since D-075; no file imports them any more. |
| `/api/finance`, `/api/banking`, `server/quickbooks.js`, `bank-feed.js`, `bank-match.js`, `bank-formats.js` | ~2,000 lines | They serve only those panels. QuickBooks stays the book of record (D-075). |
| `/api/checklists` + `checklist_templates/instances/submissions` | 275 lines | The original checklist module. No screen calls it; PM checklists replaced it. |
| `app_requests` tables | — | The Request button was removed; nothing reads or writes them. |
| `MOLegend.jsx`, `utils/moColors.js`, `utils/parseSheet.js` | ~250 lines | Nothing imports them. |
| `server/backfill-history.js` | 124 lines | See 1a. |

**Recommendation:** delete the code and keep the tables. A table costs nothing, and dropping one loses
history. CLAUDE.md's note that the finance tabs are "reversed by one HUB_TABS entry" is no longer
true, so the honest choice is to retire them outright. If QuickBooks is ever replaced, that is a new
project, and git still has the code.

## 3. Built, waiting on someone else (leave, but say so)

- **Text-to-AI SMS**: waiting on Twilio approval.
- **ADP push**: waiting on credentials. The office keys packets into RUN by hand (D-076), which works.
- **Plaid bank feed**: goes with Banking above.
- **Retention Samples**: built and empty. It needs the box sheets transcribed. Either load one box
  or hide it until then. An empty log an auditor opens reads as "we keep no retains".

## 4. Probably unused — decide from the report

These are working modules that may have no regular user. Run the report first, then decide per row:
**keep** (in use), **hide** (remove from the nav, keep the code and data), or **retire**.

| Module | Likely status | Suggested if the report says unused |
|---|---|---|
| Newsletter | occasional | Keep if an issue went out since July; otherwise hide. |
| Danny's List | one user | Keep if Danny uses it; otherwise retire it. Messages and the flavor link cover the same ground. |
| Procurement & Demand | data imported, little use | Hide until the Keychain move settles what it is for. |
| People (candidates) | one user | Keep; it is small and private. |
| Log Builder studio (Document Control) | likely never | Hide the studio; keep the Settings editor. |
| Production KPIs | read-only | Keep; reading leaves no audit trail, so the report cannot see it. |
| Facility Map, Org Chart | read-only | Same as above. |
| Film / pouch inspection, Shipping inspection | check | Keep if the dock files them; otherwise ask Juan. |
| Hygienic Design | check | Required by CAR -6; keep even if empty. Empty is a finding to act on, not a reason to remove. |

**Do not remove** a module that is empty because the plant has not started the work an audit
commitment requires. Change Register, Mock Recall, Stability, Suppliers, Internal Audits and Food
Safety Culture all fall here. Empty there is the finding, not a reason to remove.

## 5. The single spine — what is left

Order from the architecture: (01) one signature service, (02) one record interface, (03) limits in
documents, then (04) one retrieval screen. 05 and 06 wait.

| Move | Done | Left |
|---|---|---|
| 01 Signatures | All QA sign-offs, plus five more acts (D-206). | Nothing structural. New signing routes must use `gateSignature`. |
| 02 Record interface | Sanitation, scale, every QMS form (D-207, D-210). | **Check records** (EMP, GMP walk, list/management/food-defense reviews, culture checks — one adapter over `fileCheckRecord`) · **production entries** · receiving checklist · calibration records · training records · COA requests · disposals. Do check records next: one writer already, five record types for one adapter. |
| 03 Limits in documents | ATP, temp/humidity, EMP, scale tolerances, receiving checklist. | **Mock recall criteria** (99.5–100.5 %, 4 hours, SOP 414) · **FORM 106-01 dilution targets** · the internal audit checklist (403-01). The fill-weight tolerances are the plant's own rules, not a document's. |
| 04 Retrieval | The API exists (`GET /api/records`) with no screen. | An "everything about lot L / equipment E / person P" screen over it. It turns the mock recall into a lookup. Build it after check records and production entries join, or it misses the two biggest record types. |

**Suggested order:** 1a and 1b (small, and the most important) → section 2's deletions in one
pass → move 02 for check records, then production entries → move 04 screen → move 03 mock recall and
106-01 → decide section 4 from the report.
