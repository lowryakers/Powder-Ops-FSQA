# Reachability: where each "something to act on" lives, and who is told

*29 September 2026 (D-121). Roadmap item 6 of `scale-verification-and-next-steps.md`.*

The recurring defect of the last twenty decisions is not a wrong mechanism. It is a correct one on a
screen the person who has to act never opens (eleven of twenty — see `status-2026-09-29.md` §3). This
is the inventory that question produces when it is asked of every strip, banner and queue in the app.

Three questions per row. **Who acts** (a department or role, never a name). **Where it is shown** —
the screen that person's job takes them to, or one they reach only by a grant. **How they are told** —
a banner reaches whoever opens the screen; a DM or a bell line reaches the person. A row is *reached*
when the actor either lands on the screen daily or is told. A row is a *gap* when the actor has to know
to go and look.

| Mechanism | What it asks | Who acts | Where it is shown | How they are told | State |
|---|---|---|---|---|---|
| Scale checks due today (D-117) | Run this morning's 417-xx check | Batching / Filling / Kitting operators | Operator View strip, per team | The strip is on the screen the floor opens first; bell line for approvers after 09:00 | reached |
| **MMR reference on the run (D-133)** | Name the approved MMR on the schedule cell and the EOD line; turn the gate on | Production supervisors (the reference); admin (the gate) | The box on both forms; the gate strip on the Production Log for admins and QA, with the runs filed without one | The box is in the form, the refusal is on screen when the gate is on; the strip counts the warn-era runs — no DM, because the person who has to act is the one filing the form | reached |
| QA correction asked (D-083) | Amend your own entry | The filer | Production Log banner | DM + push at once; chased on each entry's own 24h clock; escalates past them once | reached |
| Missed end-of-day reports (D-085) | File the report | Shift supervisors | Production Log bar (supervisors, QA, admins) | DM to the supervisor | reached |
| 72-hour / dirty / no-record re-clean | Clean the room, swab it | Cleaning | A task on the cleaner's own list | The task IS the notice; Sanitation strip for QA | reached |
| ATP reading owed (D-112, D-116) | Enter the reading | Whoever completes the clean | The completion form, both doors | The box is in the form | reached |
| **Pre-Op / changeover clean (D-125)** | Clean, swab, file Form 117.21 at the start of a run | Cleaning / the line | Sanitation → New record (Pre-Op, the room) | Was: a DAILY card, raised whether or not anything ran, so it sat N/A or missed. **The card is retired; nothing prompts the clean when a run starts** — that is OBL-22 | **gap — OBL-22** |
| QA record backfill | File the checks done as tasks | QA leadership | QA Inspections + Sanitation strips | DM every third day while a pile exists | reached |
| Sanitation area strays (D-118) | Fold the spellings, retire the strays | QA | Sanitation strip | Banner only — the one-off is assigned (Job 5); QA opens Sanitation daily | reached |
| Training assigned (D-105) | Do the course | The assignee | Their task list, if they hold one | DM + push naming where to look; chased every other day; the assign screen names who will not see it | reached |
| Pay review actions (D-057, D-097) | Decide / chase / assign | The office | Pay Tracking strip | Bell + DM every third day | reached |
| Employee documents (D-077) | Sign it | The employee | A card wherever they are | DM on send, every other day unsigned | reached |
| Supplier disposition / questionnaire chase | Decide; chase the form | Quality; Purchasing | Suppliers register | DM every third day, two numbers stated separately | reached |
| Supply standing lists (D-106) | Tick what is low | The office | Supply Orders → Standing lists | DM on the day due, chased every third day | reached |
| Cleanup Review pile (D-084) | Close pre-launch work | Admin | Settings → Cleanup Review | Biweekly digest | reached |
| Equipment setup gaps | Schedule, LOTO, design, course, WI | Maintenance / QA / DC by step | Equipment row badges | Bell lines routed by department | reached |
| Controlled change parked | Approve the deployed definition | Document Control | Controlled Changes; Doc Control Review | DCR raised + DM to DC | reached |
| Document past review / drafts / open DCRs | Review, issue, decide | Document Control | Doc Control Review Center | The center is DC's own screen | reached |
| Specification release gate (D-063) | Clear a held lot | QA | Lab Requests strip | Bell lines `coa-held`, `coa-gaps` | reached |
| EMP results | Enter, act on | QA | Quality Schedules → EMP results | Bell lines `emp-action`, `emp-pending` | reached |
| Calibration overdue / not in use (D-114) | Calibrate | QA / Maintenance | Calibration header, five counted figures | Bell line; Monday expiry digest | reached |
| **BP&G zone drift (D-104)** | Re-issue FORM 431-01 with the changed zones | Document Control | QA Inspections → Zones & items strip | Was: nothing. **Now a source on the Doc Control Review Center; "open" lands on the Zones & items view** | **fixed D-121** |
| **Form-numbering worklist (D-092)** | Rule on a number, or renumber | Document Control | Controlled Documents → Forms tab | Was: nothing — **and the Forms tab was not rendered for any non-admin** (its visibility defaulted to a grant nobody can be given). **Now a source on the Review Center, and the tab rides the sops grant as its comment always claimed** | **fixed D-121** |
| **Draft COA specifications (spec-seed)** | Approve or discard the starter specs | QA | COA → Specifications tab strip | Was: banner only, on a tab QA rarely opens. **Now a bell line `coa-draft-specs`** | **fixed D-121** |
| Equipment repair banners (D-010: split task text, duplicates, schedules-from-tasks) | Run a reviewed repair once | Admin (Maintenance for the task text) | Equipment list, top | Banner only, shown only while there is something to repair | run by hand 29 Sep (Job 2); one-off, self-clearing — **left as is** |
| Products: draft realign, colour conflicts, Data health | Catalogue corrections | Product management (Lowry) | Products catalogue and Data health | Banner only | actor owns the screen — left as is |
| Sensory spec approval (D-050) | Approve a product's draft spec | A QA lead | Organoleptic log strip | Banner; the first test DMs QA to taste | reached through the tasting DM |
| "Used up" restock suggestions | Add to orders | The office | Supply Orders strip | Was: banner only. **Now a bell line `supply-suggestions` for admins, counted by item from the strip's own `openSuggestions()`** | **fixed D-124** |
| Spec-sheet completeness (D-128) | Fill the named fields, or block the SKU with a reason and an owner | Whoever owns the product data (Lowry, Matt, Shaun) | Products → Completeness | None — a derived punch list, read where the product data is kept. A block names its owner in words, not an account, so nobody is messaged | reported, not wired: a block's owner is not told |
| Obligations register (`docs/v2/obligations.json`) | Close the 23 open obligations | Whoever runs V2 | The repository | `npm run check:obligations` | not an app mechanism — its reader reads the repo. Left as is |

## The two rules this pass adds

1. **A pile derived on one screen is a source on the review center of whoever acts on it.** Doc Control
   Review and QA Review are the two registries; a source is a `count` and a `pending`, an optional
   `action`, and now an optional `view` — the tab inside the module where the work is done. A link that
   lands on a module's first tab and leaves the person to find the right one is half a link.
2. **A hub tab that "rides" another grant has to say so in its `visible`.** `ModuleHub` defaults a
   tab's visibility to `canViewModule(user, tab.id)`; a tab whose id is not a grantable module is
   therefore invisible to every non-admin, and reads as present to every admin who tests it.

## How to run the question again

For a new strip, banner, queue or nudge: add a row here **when it ships**, with the three answers. If
"how they are told" is *banner only* and "where it is shown" is not the actor's daily screen, that is
the gap — put it on their review center, their bell, or their DM before shipping, not after the plant
reports it. `verify:reach` asserts the three fixes above end to end.
