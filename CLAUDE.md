# Powder Ops FSQA — working notes

## Flavor approvals via SMS (Danny)
`flavor_approval` QMS type + FlavorPanel ("Text for approval" row action) → magic link `/approve/<token>`
(public, single-use, ApprovePage.jsx) → decision updates the record + announces in #batching.
**SMS auto-send needs env:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `FLAVOR_APPROVER_PHONE`
(optional `APP_BASE_URL`, default start.powder-ops.com). Without them the link is shown for manual texting.
**Text-to-AI (BUILT, awaiting Twilio compliance approval):** `server/api/sms-inbound.js` →
`POST /api/sms/inbound` (public path, X-Twilio-Signature validated against the exact APP_BASE_URL webhook
URL; allowlist = FLAVOR_APPROVER_PHONE matched on last 10 digits; acks with empty TwiML, answers async via
REST using ai.js `answerQuestion`, audit-logged as `sms:Danny`). One-time console step once the number is
live: number → Messaging → "A message comes in" → HTTP POST `https://start.powder-ops.com/api/sms/inbound`.

## Deferred / future work — remind the user when relevant

### Phase 3: Team Activity / efficiency dashboard  (SHIPPED — user approved 2026-07-22)
Live as the admin-only "Team Activity" view (System group): `server/api/activity.js` (requireRole admin)
+ `TeamActivityPanel.jsx`. Metrics come from work-order timing (operational tables, NOT the audit log):
completed/on-time/overdue/avg-cycle KPIs, weekly trend, by-department and by-person tables over 30/90/365d.
Whole view is admin-gated, which satisfies the agreed sensitivity guard (per-person detail never shown to
non-admins). If it's ever opened to supervisors, re-apply aggregate-by-default with admin-only drill-down.

**Every figure on it now opens the tasks behind it** (`server/activity-metrics.js`, `GET /activity/tasks`,
`ActivityDrillDown.jsx`). "27 overdue in Quality" is not an answer, it is the start of a question, and
working out *which* twenty-seven meant rebuilding the filter by hand in Task Center — which nobody does.
- **The predicates moved OUT of the route into `activity-metrics.js` and both endpoints import them.** The
  moment a number is clickable, a drill-down built from a second copy of the rule is a list that disagrees
  with the figure above it, and whoever clicked cannot tell which is wrong. The tests assert reconciliation
  on every card, every department row and every person row, plus that the departments partition the total.
- **A rate is not a set, so a percentage drills to what a person MEANS by clicking it**: on-time% opens the
  ones completed *late* (the exceptions), completion% opens what has not been handled. `MEASURES.late` and
  `MEASURES.outstanding` exist for exactly this and have no card of their own.
- **`DUE_IN_WINDOW` LEFT JOINs equipment.** A task raised from a chat message has `equipment_id NULL`; an
  inner join would show 2 on the department row and return 0 rows when you clicked it — the same bug that
  made tasks appear in the Operator View and not the Task Center. Asserted with fixtures, since the seed
  has no such rows and the check would otherwise pass vacuously.
- A figure with nothing behind it renders as plain text, not a button that opens an empty drawer.
- `days_late`, `on_time` and `cycle_days` are computed SERVER-side and rendered as given — a drawer that
  re-decides what the server already decided is the second mechanism all over again.

### A long note must not restructure a log (`common/TextCell.jsx`)
Someone typed a two-sentence reason into a disposal and every row on the screen became a 400px ribbon.
**`max-width` on a `<td>` does nothing under the default `table-layout: auto`** — the browser gives the
column whatever width the row leaves and wraps to fifteen lines. The constraint has to go on a block
*inside* the cell. `<TextCell value width lines preLine />` clamps to two lines with the full text on
`title`; nothing is lost, because every one of these logs opens the record on row click and a table is for
scanning, not for reading a paragraph.
- Wired into the **generic QMS log** (`QMSRecordsPanel` — every `logColumns` cell, so deviations,
  non-conformances and on-hold records are all covered by one change), Disposals, LOTO executions and the
  office `DataGrid` (which only clamps string/number cells — a column returning its own chip or link is left
  alone). Short values are untouched; the clamp only bites when the text does not belong in a table.
- **`preLine` is the second, different cause**, found by measuring rather than reading: the disposal
  write-off cell is `whitespace-pre-line` holding several values on their own lines. Those newlines are
  meaningful, so they are kept — and clamped, because eight of them still wall off the row.
- The class name is **written out, never built** (`CLAMP[lines]`): Tailwind generates utilities by scanning
  source for literal names, so `line-clamp-${n}` yields a class in the markup and nothing in the stylesheet.
- Measured, not eyeballed: tallest Disposals row 177px → 77px against a 57px median.

### QA asking for a correction has to reach the person
`production_entries.qa_action_required` authorizes the filer to amend their own entry — but the ask lived
only on a banner at the top of the Production Log, so it worked only if they happened to open that screen.
Entries sat flagged for weeks while the QA Review queue aged around them (same failure as the 72-hour
re-clean badge the cleaner could not see).
- **`notifyQaAction()` in api/production.js** DMs the submitter through ReadyBot and pushes to their phone
  the moment the flag is set, carrying **QA's actual note** and naming the entry (date · team · MO) — "your
  entry needs a correction" with no note is an errand, not an instruction.
- Called from `signOffProductionEntry`, which both the Production Log and QA Review go through, so the
  notification cannot depend on which door QA used. **Fire-and-forget**: a comms outage must never fail a
  signature that is already written.
- **`qaActionNudges()`** (scheduled-jobs, flag `last_qa_action_nudge_at`) chases what nobody has fixed —
  every **other** day, and only asks at least **two days** old, so nobody is chased the morning after. The
  reminder reads as a reminder ("Still waiting — asked 5 days ago"), not as a fresh request. Resolving the
  entry stops it permanently.

### Comms → compliance-record crossover  (SHIPPED 2026-07-23)
"Create compliance record…" in the message 3-dot menu + mobile long-press sheet → picker
(Deviation / Non-Conformance / On Hold) → `POST /api/comms/messages/:id/to-record` creates a draft
qms_record pre-filled from the message (body → description/reason, author, timestamp), back-linked via
`data.source_message_id`/`source_channel_id` + a notes line, channel-access-checked. Extend
`CONVERT_TYPES` in comms.js to add more target types.

### Comms build phases (Phase 1 shipped)
- **Phase 1 (DONE):** `chat_*` schema + membership access layer (`server/api/comms.js`), `/api/comms` endpoints,
  `CommsView` UI + workspace toggle (Messages ↔ Compliance in `src/App.jsx`). Public/private channels, DMs,
  threads-ready (`parent_id`), reactions, edit/delete, unread counts, 4s poll refresh.
- **Phase 2 (in progress):** realtime via **socket.io** replacing 4s polling. Handshake auth reuses the
  session bearer token; socket joins per-channel rooms (access-checked); REST handlers emit message/edit/
  delete/reaction/channel events. Single Railway instance → in-memory adapter is fine (add Redis adapter
  only if we ever scale to multiple instances).
- **Phase 3 (DONE):** file uploads on **Cloudflare R2** (S3-compatible, zero egress) + FTS5 keyword search.
  `server/storage.js` wraps R2 via `@aws-sdk/client-s3` and degrades gracefully — `storageEnabled()` gates the
  paperclip UI and the upload endpoint (503 when off), same pattern as `aiEnabled()`. Uploads buffer in memory
  (25 MB/file, 10/msg) → R2; downloads use short-lived presigned GET URLs issued **only** after the channel
  access check. `chat_attachments` table; message delete purges the objects. FTS5 (`chat_messages_fts` + sync
  triggers, backfilled) powers `GET /api/comms/search`, access-filtered so private/DM content never leaks.
  **To enable R2, set env vars:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (optional `R2_ENDPOINT` override). Without them, chat still works; only uploads are hidden.
- **Phase 4 (DONE):** **Voyage AI** embeddings → semantic search + membership-scoped RAG "Ask".
  `server/embeddings.js` (voyageEnabled(), `embed()`, cosine, BLOB (de)serialize) degrades gracefully.
  `chat_message_embeddings` table; messages embed on create/edit (fire-and-forget), drop on delete;
  `backfillEmbeddings()` runs on startup (idempotent, batched, no-op unless configured). `/api/comms/search?mode=semantic`
  cosine-ranks within the caller's accessible channels; `POST /api/comms/ask` retrieves top-k accessible messages and
  synthesizes an answer via Haiku (`summarizeChat` in ai.js) — both membership-scoped. UI: search bar mode toggle
  Keyword / Smart / Ask (Smart shown when Voyage on, Ask when Voyage+Anthropic on) with an answer card + sources.
  **Env:** `VOYAGE_API_KEY` (optional `VOYAGE_MODEL` default voyage-3.5-lite, `VOYAGE_BASE_URL`); Ask also needs the
  existing `ANTHROPIC_API_KEY`. Note: cross-module *data* queries ("last lab tests for XYZ") are the existing
  admin **Ask AI** SQL assistant (`server/ai.js` answerQuestion); comms Ask is scoped to chat messages.
- **Phase 5 (mostly DONE):** EN/ES translate-on-display, @mentions, installable PWA, web push — all shipped.
  - **Translate:** `chat_message_translations` cache; per-message + channel auto-translate toggle (EN/ES); AI-gated.
  - **@mentions:** `chat_mentions`; server extracts by display-name match (access-scoped), composer autocomplete,
    highlight, targeted `mention` socket event.
  - **PWA:** `public/manifest.webmanifest` + `public/sw.js` (app-shell cache, offline fallback, push handlers),
    generated icons, `beforeinstallprompt` Install prompt. Installable / offline shell.
  - **Web push:** `server/push.js` (VAPID via `web-push`, degrades gracefully); `chat_push_subscriptions`;
    `/push/key|subscribe|unsubscribe`; pushes on @mention and DM; prunes dead subs on 404/410. Bell toggle in
    comms header. **Env:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate once with
    `npx web-push generate-vapid-keys`).
    **A subscription is bound to the VAPID key it was created under.** Change the keys and every older
    subscription starts failing with a 403 (`VapidPkHashMismatch`) while still looking healthy on the phone —
    which is how someone ends up silently getting nothing on every device. `chat_push_subscriptions` records
    `vapid_key` / `last_success_at` / `last_error`; `pushToUser` logs every failure and prunes on **403, 404
    and 410**; the client compares `sub.options.applicationServerKey` to `/push/key` on load and rebuilds the
    subscription when they differ. `GET /push/status` (per-device, in the bell → Notification status panel)
    and admin `GET /push/diagnostics` (Messages → Settings → Notifications, incl. accounts with **no** device
    registered) make "who isn't getting notifications" answerable without shell access.
    **NEVER send data-only ("silent") pushes** — every push must end in `showNotification()`, or Android
    Chrome shows a generic fallback notification (this was the 2026-07 "phantom notifications" bug: a
    cross-device dismiss push on channel read). Same-device notification clearing is done client-side via
    `registration.getNotifications()` in CommsView (`clearChannelNotifications`); cross-device clearing is
    not possible with web push.
  - **Capacitor** later only if App/Play Store listings are wanted (PWA covers install + push now).
  - **Auth (DONE):** replaced PIN with **passwords** (scrypt in `server/api/users.js`; `users.password_hash`).
    Login `{name,password}`; no password yet → `needs_password_setup`. `/set-password` (existing staff confirm
    current PIN as a bridge, then PIN is cleared; imported/PIN-less users set directly); admin
    `/:id/reset-password`. Biometric localStorage-credential replay removed. Min 8 chars.
  - **Slack importer (DONE):** `server/slack-import.js` (adm-zip) + admin `POST /api/comms/import/slack` +
    admin Upload button in the comms header. Maps authors to existing users **by display name** (creates
    missing as active/password-less), get-or-creates public channels by name (merges into existing), imports
    messages with threads (parent via `thread_ts`), reactions (common emoji shortcode→unicode, rest skipped),
    converts `<@U>`/`<#C|x>`/`<url|label>` to `@name`/`#x`/`label (url)`, skips bots/joins. Idempotent via
    `chat_messages.external_id` (Slack ts). Imported messages are FTS-searchable; embeddings backfill on next
    restart (if Voyage on). Verified on a synthetic export incl. re-import idempotency.

## Product management (Products · Artwork · the proofing loop)

Finished goods — what we sell, its codes, and the film it prints on. **Distinct from
`coa_specifications`, which is raw materials coming IN from vendors**; these are the products going out.
The only pre-existing `sku` in the codebase was `coa_specifications.sku_number` and it means something
else entirely. Modules `products` and `artwork`, in a "Product" nav group, both **granted rather than
role defaults** — the floor has no reason to see the catalogue, and a nav this long only stays usable if
new groups have to be asked for.

Origin: a standalone Fastify/Postgres app (`lowryakers/Product-Management`) that audited 118 real SKUs.
That repo still holds the audit, the normalised dataset, the SKU-standard analysis and the rename
runbook — `docs/01`–`docs/09`. Attach it when any of that matters; it is not duplicated here.

### `GET /api/products/master.csv` is a contract, not a convenience
It feeds the **Artwork-Proofing** service (`lowryakers/Artwork-Proofing`, Python/Flask), whose
`_fetch_sheet_rows()` matches on **sixteen specific lowercased headers** — `sku`, `gtin`, `flavor`,
`packaging type`, `material`, `zipper`, `print`, `trim length`, `trim width`, `gusset dimension`,
`front panel dimension`, `wind direction`, `pms spot colors`, `hex spot colors`, `eye mark color`,
`die line required`. **Rename a column here and proofing breaks silently over there**, because its parser
skips headers it does not recognise — it does not error, it just checks against nothing. Extra columns are
free; the sixteen are not. `sku` deliberately carries the CURRENT code, because that is what is printed on
today's artwork.
Public path, token compared as a hash, off entirely unless `PRODUCT_MASTER_TOKEN` is set. **Registered
before `/:sku`** — Express matches in declaration order and `/master.csv` is a perfectly good `:sku`.

### The proofing loop
`master.csv` out, `POST /api/artwork/ingest` back. Two env vars on the proofing service
(`READYDOC_URL`, `READYDOC_TOKEN`) and **one shared secret** — `READYDOC_TOKEN` is the same value as
`PRODUCT_MASTER_TOKEN`, because the two endpoints are two halves of one integration and a second secret to
rotate buys nothing.
Ingest is **not** behind `requireModuleWrite`: that guard rejects any non-GET without a `req.user`, and the
caller is a service holding a token, not a person. It is mounted separately at `/api/artwork/ingest`
**before** the guarded router, the same arrangement `partner-portal` uses. Getting this wrong turns every
post-back into a silent 401.
Idempotent on `(job_id, sku, component)`, one ingest **per file not per job** (a job can carry a pouch and
a stick — different products, different histories), and it resolves the product **by GTIN before SKU**
because a decoded barcode is the only unambiguous identification.

### Versions file themselves
Artwork history is a **side effect of the proofing run**, not an upload. Shaun keeps working in Google
Drive and changes nothing; the record accumulates because the check was already happening. Manual upload
exists only for files that never went through proofing. `pdftoppm` already rasterises page 1, so the
preview PNG that makes the board a grid of packs rather than a list of filenames is free.

### The NFP is approved on a signed link, and the file is the evidence
`nfp_versions` + `nfp_files` (db.js), `server/api/nfp.js`, `src/components/NfpApprovePage.jsx` (public
`/nfp/<token>`), `src/components/compliance/NfpPanel.jsx` (a **Nutrition panels** tab on Products plus the
section in the product drawer). Module grant is `products` — the panel is a product fact, not a new module.
- **`products.nfp_version` / `nfp_approved_at` are a MIRROR now, not inputs.** Those two columns ARE the
  artwork print gate, and while they were text boxes the gate opened by typing a date into one. They are
  written by `applyApproval()` in the same transaction as the decision and **nowhere else**;
  `products.js` PUT **400s** on either field (`NFP_OWNED`) rather than dropping them silently, or a client
  that used to send them looks like it saved and quietly didn't. Same doctrine as
  `knife_accountability.status` mirroring the sign-out log.
- **Answering "should the files live here too": yes, and it is the point.** Without the file, "NFP V3
  approved" is an assertion with nothing behind it — an auditor asking to see the panel that was approved
  and the artwork printed from it got a version number. It is **its own table, not an artwork version**: a
  panel is approved *before* artwork and referenced *by* it (`artwork_versions.nfp_version`), and one panel
  outlives several artwork revisions. R2 via the shared `media.js` + `putStream` path, same as manuals and
  comms attachments.
- **A link is refused when there is nothing to look at** — no file and no `drive_url` → 409. An approval
  given against a panel the approver could not see is a rubber stamp and the record would not say so.
- **The token is stored as SHA-256 and returned in clear exactly once** (partner-portal precedent), looked
  up by a single indexed hash query rather than the cleartext scan the flavor link does. Lost link ⇒ issue
  a new one, which invalidates the old. Cleared by the decision, so it is single-use. Revoke drops it and
  returns the panel to `draft` rather than leaving it reading "sent".
- **The approver types their own name and it is required.** The link cannot know who is holding it, the
  panel may have been handed to a colleague, and a regulatory approval with nobody's name on it is not an
  approval. `decided_via` records `link` / `in_app` / `paper`.
- **`decide()` is shared by the link and the in-app button**, so a decision is byte-for-byte the same record
  whichever door it came through — the same rule QA Review follows for signatures.
- **An approved panel is never rewritten**: no edit, no delete, no swapping its file, no new link. A
  correction is the next version, which supersedes the previous one and moves the product mirror.
- **Approving REPORTS print-ready artwork drawn against the older panel and changes nothing**
  (`strandedArtwork`). The film already printed is still what is on the shelf; silently superseding it
  would make the record wrong. But nobody should have to work out for themselves that approving V4 just
  stranded three packs on V3.
- **`source: 'paper'` is the door for the pre-ReadyDoc approvals** — it files as approved and takes the
  historical date, and it demands the two facts a typed date never carried: who approved it, and when.
- Verified end to end on a fresh DB: 63 API assertions, 22 more against a local S3 stand-in (the bytes an
  unauthenticated approver gets are the panel that was uploaded), and 28 in a real browser incl. the public
  page at 390px.

### Rules that are load-bearing
- **The seed is insert-only and skips once `products` has rows.** A redeploy must never overwrite a GTIN
  someone corrected by hand — that is worse than no seed at all.
- **`legacy_sku` is never cleared.** The SKU is the join key; a code that changes must still resolve on a
  two-year-old PO. `POST /products/:sku/rename` is its own endpoint rather than a field edit so rewriting a
  join key reads as a deliberate act in the audit log, and it is the only thing that sets `legacy_sku`.
- **`defer_foreign_keys` in that rename transaction.** `foreign_keys` is ON app-wide, so renaming the parent
  leaves `product_colors` dangling for the instant between the two statements. Scoped to the transaction,
  unlike `foreign_keys = OFF`, which would be a global switch flipped from inside a request handler.
- **A GTIN that fails its GS1 check digit is never stored, from any door.** `gtin_valid` is a stored column
  (the readiness check and the list badge read it) and every write path recomputes it.
- **Nothing reaches `print_ready`** with an open failing check, without an approved NFP, or against an NFP
  that is not the product's current one. Releasing supersedes the other live versions in the same component
  and updates the product row, so "current" cannot mean two things.
- **Dismissing a check is not a delete.** It keeps the row, demands a reason and records who waved it
  through — "we looked and it was fine" is the answer an auditor wants and a deleted row cannot give it.
  Released artwork cannot be deleted at all.
- **`readiness` is computed, not stored.** Nine steps (SKU, GS1, spec, formula, NFP, artwork, colours,
  Shopify, ShipHero) so "what is still missing" needs no side checklist. Adding a step is one row in
  `READINESS` in `api/products.js`. Expect most products to read incomplete — Shopify SKU, MRP formula and
  ShipHero are empty across all 118 seeded rows, which is the punch list working.

### Two traps this cost time on
- **`mediaUpload()` returns a multer instance, not middleware.** `.array('files', n)` is what a router can
  mount; passing the instance throws `argument handler must be a function` at boot.
- **The artwork board API returns `packs`, not `current`.** React's compiler treats a `.current` field
  access as a ref and refuses to memoize the consuming component — an eslint error, not a runtime one.

### GS1 numbers are finite and one block is nearly full
Every GTIN is a 12-digit UPC-A: 9-digit company prefix + 2-digit item + check digit, so **100 numbers per
prefix**. `850046726` is at 76/100. Allocation should prefer the roomiest prefix a line already uses and
warn under 25 free. All 118 existing check digits verify, which is the most expensive thing to get right
and is genuinely well maintained — the job is keeping it that way.

## Not built yet: the rest of product management

Built in this order deliberately — the destinations first, then the thing that feeds them. A triage screen
whose buttons have nowhere to land is worse than no triage screen.

1. **New product** — a new flavour needs a SKU and a GS1 barcode, and two different people make them
   (someone else invents the SKU, Lowry allocates the barcode). Suggests both, with the **reasoning and any
   warning shown** — 37 of 118 existing abbreviations disagree with plain initials, so a suggestion you
   cannot interrogate is one you should not accept. The SKU half goes out as a **share link** so whoever
   names them needs no account (same pattern as `/approve/<token>`). The suggester proposes the **new
   standard** (`WHY-PLG-BLM` — category · pack · flavour, no serial), not the legacy `PP-`/`PSP-` prefixes;
   see `Product-Management/docs/07`. The 67-flavour table belongs in the DB, append-only: a code that can
   change is a code you cannot print.
2. **Packaging orders** — **a PO is scoped to one packaging spec.** Sticks, LG pouch and SM pouch are always
   separate documents because one spec = one film = one price tier = one thing Mike quotes. The three real
   POs are exactly `SPEC-STICK-LG` (38 lines), `SPEC-POUCH-LG` (37), `SPEC-POUCH-SM` (11). So the builder is
   pick-a-spec-then-pick-SKUs, and the footer renders `vendor_spec_string` from the spec rather than being
   typed — which is the fix for "SKUs: 21" printing on a 38-line PO.
   `POLine.excluded` must keep a removed line visible while its money leaves every total: a note in a cell
   was a message to a human, a flag the sum respects is a control. Two of three real POs overstated by
   **$24,850** because of exactly this.
3. **Capture + six outcomes** — replaces the standalone app's inbox. Capture stays (ten seconds, almost no
   fields). What goes is the status queue: triage should ask **"what does this turn into?"** and make it —
   new product · artwork revision · RFQ to Mike · NFP revision · packaging order · archive. Each creates a
   real record with a real owner; the captured note becomes its origin and is **never edited**. "I get lost
   after triage" was a correct reading of a screen where nothing was produced.

### The SKU rename is a separate project, and it is not free
The new standard is adopted for **new products only**; the existing 118 are untouched. A full cutover is
costed in `Product-Management/docs/08`. The 3PL has confirmed the expensive half: scanning tolerates either
code, but **inventory locations and open order lines are keyed to the SKU**, and **Shopify snapshots the SKU
onto each order line at sale time**, so SKU-grouped sales reporting splits into two buckets at the cutover.
Order is ShipHero → Shopify, sync paused throughout, on-hand snapshot first. The ReadyDoc half is already
built and tested (`/products/:sku/rename`) — it is the easy one.

## Not every task has equipment (the "shows in Operator View but not Task Center" bug)
`/pm/by-frequency`, `/pm/search`, `/pm/completed-history` and `/pm/clearance-pending` all did
`JOIN equipment e ON wo.equipment_id = e.id` — an **inner** join. A task raised from a chat message has
`equipment_id NULL`, and so does any New Task created for a team rather than a machine, so every one of them
was silently dropped from the Task Center. The Operator View left-joins, which is why the same task existed
on one screen and not the other. All four are LEFT JOIN now; they group under `unscheduled`, since a task
with no PM schedule has no frequency. **`/pm/metrics`'s `byEquipment` roll-up keeps its inner join on
purpose** — "by equipment" means by equipment, and a task without any has nothing to group under.

## Chat message → Task Center task
`src/lib/taskIntent.js` decides if a message reads like an assignment: it needs **both** an @mention and
directive phrasing (EN + ES), and is suppressed for questions/thanks/acknowledgements — false prompts train
people to dismiss it. On send (supervisors/admins, non-DM channels only) `MessageToTaskModal` opens
pre-filled: title from `suggestTitle()` (mentions stripped), team from `teamForChannel()` (channel name →
task_group), assignee from the @mention, due tomorrow. `POST /comms/channels/:id/to-task` creates the work
order (original message kept as the description) and posts a ReadyBot note recording who assigned it and
when. **Bot message bold is `*text*`, not `**text**`** — the chat renderer isn't markdown.

## Comms composer: rich text + reliable focus + resizable split screen
**Formatting:** `renderBody()` is now block-aware — it splits into paragraphs and turns `- `/`* ` runs into a
bullet `<ul>` and `1. ` runs into a numbered `<ol>`, so the message body renders inside a `<div>` (a `<p>`
can't hold a list). Inline markers via `renderInline()`: `*bold*`, `_italic_`, `__underline__` (listed
before italic in the alternation so the two-underscore form wins), `~strike~`, `` `code` ``. Italic/underline
use lookbehind/lookahead `(?<![A-Za-z0-9_])…(?![A-Za-z0-9_])` so `snake_case` / `MO_4471_lot` don't italicize.
`<FormatBar>` (B/I/U/S + bullet/numbered, now `src/components/common/FormatBar.jsx`) sits above the channel
composer, the thread drawer reply, and the Threads-inbox reply; `wrapSelection()` / `prefixLines()`
(`src/lib/textFormat.js`) edit the textarea and the caller wires its own `writeDraft`.
`onMouseDown preventDefault` on each button preserves the textarea selection.
**Composer autofocus** (desktop only): a per-channel `wantFocusRef` re-attempts focus on open and again once
messages render (the old single timeout lost the race to the load+scroll), and stands down if the cursor is
already somewhere deliberate. ThreadPanel focuses its reply box on `parent.id` change.
**Split screen** (`App.jsx`): the docked `/chat` panel width is drag-resizable via a left-edge handle,
clamped 320–760px, persisted in `localStorage.dock_chat_w`; the iframe goes `pointer-events:none` mid-drag so
it doesn't eat the move events.

## Comms navigation: where you land, and what counts as "read"
**A channel is marked read when its conversation is ON SCREEN, not when its messages load.**
`loadMessages()` used to `POST /read` as a side effect. On a phone the app also picked an active channel at
launch (#general, else `list[0]`) while showing the channel LIST — so opening Messages loaded that channel,
marked it read, and the unread you came in for was gone before you saw a word of it. It could wipe a channel
you had deliberately marked unread the same way. `conversationOnScreen` (activeId + not threads/activity +
`!isCompactLayout || mobileThread`) drives a separate effect that does the marking.
**You land where you left.** `comms_last_channel` in localStorage: `openChannel()` remembers, `backToList()`
forgets. On launch, restore that channel if it still exists; otherwise the compact layout shows the **list**
and picks nothing (choosing for people is what made the landing feel random). Wide layouts still fall back to
#general so the pane isn't empty. `markUnread()` calls `backToList()` — staying in the conversation would let
the read-on-screen rule immediately undo it.
`isCompactLayout` tracks the same `md` breakpoint the markup uses, live, via matchMedia.

## Comms touch feel
- **A scroll must not also be a tap.** `Message`'s `onTouchMove` only cancelled the long-press timer; the
  click still fired, so flicking the list and lifting your finger over a message threw you into its thread.
  Movement past 12px now sets `suppressClick` too. Most of "comms feels twitchy" was this.
- **`src/lib/useSwipeBack.js`** — iMessage-style interactive back: drag right anywhere in the conversation and
  the pane follows your finger, committing past 70px or on a fast flick, snapping back otherwise. Distinct
  from `useEdgeSwipe`, which only fires from within ~28px of the screen edge and gives no feedback until it
  commits. The axis is decided once at 8px and then locked — an axis that flips mid-gesture is what makes a
  swipe feel like it's fighting you. Never starts on a control, a link, or a horizontally scrollable element.
  Only enabled on the compact layout, where there's actually something to go back to.

## Threads behave like their own channel
Thread replies are **excluded from channel unread** (`parent_id IS NULL` in *both* `channelUnread()` and the
channel-list query in `/channels` — they're separate queries, keep them in step) and counted per-thread
instead via `chat_thread_reads` + `threadUnread()`. `GET /threads` returns `unread` + `last_read_at` per
thread (drives the "N new" badge and the NEW divider), `GET /threads/unread` feeds the sidebar badge, and
`POST /threads/:parentId/read` clears one — fired by opening the ThreadPanel, by Mark read / Mark all read,
and by replying. Unread threads sort first. **`threadUnread()` falls back to the channel's `last_read_at`
when there's no per-thread read row** — otherwise a thread you'd never opened counted its entire history
(hundreds of replies on imported threads), the "phantom huge number" bug. So once you've caught up on the
channel, old thread replies don't linger as unread; only replies since count.
**But a reply that @mentions you is measured against the THREAD marker alone — never the channel's.**
Applying the fallback to a mention meant an @ inside a thread cleared itself the moment you opened the
channel: off the thread badge, off the channel's `@N` badge and out of Activity at once, without the one
message actually addressed to you ever being seen. The rule splits by kind — ordinary replies keep the
fallback, mentions don't (`MENTIONS_ME` in the `threadUnread` CASE, the same split in the `/channels`
mention count and in `activityMarker()`, so the feed and the badges can't disagree). `/read-all` stamps
`chat_thread_reads` for the caller's mention threads, or "Mark all read" could never clear one.
**"Threads that involve me" includes being mentioned in a REPLY, not just the parent** — the inbox query
checked `chat_mentions` on the parent only, so a thread where someone @'d you three replies deep never
appeared in your Threads list at all. In the inbox, **read threads dim (opacity-75) and collapse to a
one-line summary** (parent preview + "N replies · last from X", Expand to reopen) while unread stay open with
the ring + "N new"; a thread you've replied to shows a muted "Replied" chip — so the list is scannable for
what still needs you.

## One taste test, two records (Flavor Approval → Organoleptic)
The plant does a single tasting and it is simultaneously a flavor approval (a decision about a batch) and an
organoleptic evaluation (a rated sensory test). `syncFlavorOrganoleptic` in api/qms.js files the second
record from the first, hooked onto the same create/update points as `syncOrganolepticDisposal`.
- **Two records, not one.** They are separate controlled forms with their own numbering, and an auditor
  asking for the Organoleptic log must get organoleptic records — same reasoning as keeping 440-02 and
  703-01 apart in Sign In/Out.
- **Fires only on a decision** (`approved`/`denied`). A pending approval is a batch waiting to be tasted.
- **Linked both ways and idempotent**: the FA holds `organoleptic_record_id`, the ORG holds
  `source_flavor_approval_id`, and a re-save UPDATES that record rather than filing a second one. A signed
  organoleptic record is never rewritten — it's history, and the log says so instead.
- The FA carries the same sensory keys and 1–5 scale as the ORG form, so the linked record is a copy rather
  than a mapping. `batch_adjustments` records what was changed to get approval ("added sweetener") — a
  different fact from "approved as batched".
- A failed tasting still raises the draft disposal, because the sync calls `syncOrganolepticDisposal` on the
  record it just created.
- **Both write paths re-read the row before responding** — the sync writes back to the record (the
  back-link), so returning the pre-sync object would omit it.
- `mo_number` on both forms uses the same key as `production_entries.mo_number`.
  `GET /qms/flavor-approvals/by-mo` returns a map (one request, not a query per row) that the Production
  Log's expanded detail uses to show the flavor decision and any batch adjustments against a run.
- **Adding these fields was itself a controlled change**: `syncDefinitions` parked both forms as pending and
  kept serving the approved snapshot, so the new fields did nothing until Document Control approved them.
  That is the gate working — expect it on any future QMS form field change.

## QA notes that ask for a fix
**Production Log:** QA sign-off has a "this note needs a correction" checkbox (requires a note) →
`production_entries.qa_action_required`. The flag is *itself the authorization* to amend that one entry, by
the person who filed it (`invited` in `PUT /entries/:id`) — **no blanket Production Log edit grant needed**,
and it's spent as soon as the correction lands. The amendment is stamped `resolves_qa_action`, clears the
flag and (as always) retires the QA signature back to Pending QA. `GET /production/entries/qa-actions` feeds
the banner at the top of the log (own entries for everyone; all entries for admins/log editors).
**Task Center:** `POST /pm/work-orders/:id/review` `{note, rework_required}`. A plain note is feedback;
`rework_required` reopens a *completed* task, reassigns it to whoever completed it, and clears
completed_at/by — the prior completion is preserved in `review_history` (JSON array, every round). Completing
the task again clears `rework_required` on all three completion paths. Reviewing is admin/supervisor/QA.

## Per-team EOD reports (structured survey)
Each team can have its own end-of-day survey on top of the shared production fields. `eod_templates`
(team PK, title, `fields` JSON) holds the definition; answers live in `production_entries.structured_data`
(JSON keyed by field key). Fields are typed — text/number/select/checkbox/textarea — and fully
**admin-editable** (no deploy needed) via `PUT /production/eod-templates/:team` (canEditLog-gated: admin or
Production Log **edit** grant). `GET /production/eod-templates` returns `{team: {team,title,fields}}`;
`computeMetrics()` parses `structured_data` onto every entry. **Batching ships a seeded "Blending EOD Report"**
(`BATCHING_EOD_FIELDS`/`seedEodTemplates` in `production-seed.js`, seeded only if none exists) — sensible
default, editable. UI (`ProductionLog.jsx`): `EntryForm` conditionally renders the selected team's survey
(`EodField`); saved answers show read-only on log entries (`EodSummary`, mobile card + desktop notes-expand
row); the **EOD Templates** tab (log-editors/admins) is the field-list editor (`TemplateEditor` — add/remove/
reorder typed fields, dropdown choices comma-separated, save per team). Switching team in the entry form
resets the answers so a Batching answer never carries into a Filling report.

## Schedule: several items on one day, and moving them in bulk
"It won't let me put two things on Thursday" was a client bug, not a server rule: `production_schedule`
upserts on `(week_start, day_of_week, room, slot)`, and `handleSave`'s repeat loops reused the edited cell's
slot (and hardcoded `slot: 0` for next week), so the second item written into a cell **replaced** the first.
`POST /schedule` now takes **`append: true`** → the slot becomes `MAX(slot)+1` for the target cell and the
`existing` upsert lookup is skipped; both repeat paths send it. Never send `append` for the cell the editor
is actually looking at — that's a real upsert and must stay one.
**`POST /schedule/bulk-move`** `{ids, day_of_week, week_start?, room?, updated_by}` appends each assignment
into the target cell and **can cross weeks**, which `PUT /schedule/:id/move` cannot (it only ever moves
within `existing.week_start`). Room follows the request when given, otherwise each item keeps its own.
UI: a **Select** toggle in the schedule toolbar (desktop, admins) puts the grid in selection mode —
checkboxes, drag and inline edit suspended — and ticking items raises `BulkMoveBar` (This week / Next week +
the five weekdays). Moving into next week advances `weekOffset` so the items don't appear to vanish.

## Multi-MO entries (Batching runs several MOs a shift)
`production_entries.mo_lines` is a JSON array of
`{product_name, mo_number, lot_number, batches, batch_weights, quantity}`. **Line 0 is mirrored into the
scalar `product_name`/`mo_number`/`lot_number` columns and `quantity_completed` is the sum of the lines'
quantities** — so filters, `computeMetrics`, COA, missed-report matching and every non-Batching team keep
working against the scalar columns unchanged; the full set lives in `mo_lines`. `usesMoLines(team)` (client)
gates it — currently just `Batching`. The entry form fills shift-level fields once (date/room/times/people +
the Blending EOD survey) then a repeatable `MoLinesField` (one card per MO); on submit for a multi-MO team
the scalar product/MO/lot/quantity are dropped from the payload and the server derives them. The log shows
"+N more MOs" with the full list in the expandable detail row (`MoLinesSummary`); MO search matches **any**
line (client filter + server `mo=` → `mo_lines LIKE`). Amend edits the lines as a whole (one `mo_lines`
change in the audit trail, scalars re-mirrored). **One QA sign-off per entry = the whole shift** (unchanged).
`normalizeMoLines()` in production.js is the single normalizer (drops blank lines, coerces numbers).
Per-MO fields (batches/weights) therefore left the EOD template — it's shift-level only now.

## "My Day": the running day log Bernardo was keeping in his Notes app
The entry form is one all-at-once submission and a shift is not one moment, so he logged the day in his
phone and re-typed a lossy summary at 5pm. `production_day_logs` + `production_day_items` (db.js),
day-log routes in api/production.js, `ProductionDayLog.jsx` as the **My Day** tab of the Production Log
(same `canEod` right as the entry form — the tab exists to produce one).
- **Separate tables, NOT a status column on `production_entries`.** A draft living in the entries table
  would need `AND status = 'filed'` on every existing query — the KPIs, QA sign-off, missed-report matching,
  COA, the compliance badges — and missing one leaks an unfinished shift into a compliance record. A day log
  never appears in the log, never counts toward sign-off, never touches a KPI.
- **Every add saves server-side immediately.** Not localStorage: he logs on the floor phone and finalises at
  a desk, and eight hours lost to a cleared browser is what sends someone back to Notes.
  `POST /day-log` is **get-or-create** (unique partial index on `person+log_date+team WHERE status='open'`),
  so opening the tab twice, or on a second device, lands on the same day.
- **Four kinds of line** — clean / MO run / adjustment / note — each normalized by the SAME function the
  filed entry uses (`normalizeCleaningEvents`, `normalizeMoLines`), so a line accepted at 9am cannot be
  rejected at filing. `note` is the escape hatch that stops the structured kinds having to cover everything.
  A clean can name one MO, which is how "different cleans for that specific MO" is recorded.
- **`PUT /day-log/:id` validates nothing.** A form that refuses a half-filled field mid-shift is a form he
  stops using; validation belongs at filing.
- **`dayLogToEntry()` is a pure preview that writes nothing** — Create EOD Report opens the entry form
  pre-filled for review (`initial` + `dayLogId` props, remounted on the log id). The shift window defaults to
  the earliest and latest times actually logged. **`POST /day-log/:id/filed` is called by the CLIENT only
  after the entry POST succeeds**, so a failed submission never closes the day and loses the logging.
- A filed day refuses new lines and refuses deletion — it is the record of how its entry was built. An
  unfiled one can be discarded (audited). Days left open from earlier are named in an amber strip, not
  hidden: an unfinished shift is either a report nobody filed or a log somebody meant to drop.
- **Quantity inputs carry `step="any"`.** A bare `type="number"` defaults to `step=1` and silently refuses
  687.8 kg — the browser blocks the submit with a tooltip that reads as the app being broken. Batches and
  headcount are whole and stay at the default.
- `PRODUCTION_TEAMS` moved to `constants/productionLines.js`; the log, the schedule and the day log had
  three copies of that array.

## Self-serve structure: managed lists + custom fields (the "Airtable" ask)
Adding a field to a log or an option to a dropdown is a Settings task, not a deploy.
- **Schema:** `app_lists` + `app_list_options` (managed dropdowns), `custom_field_defs` (per-scope field
  definitions). Values live in a `custom_data` JSON column on each host table — same shape as
  `production_entries.structured_data`, which this generalizes (fold that into this when convenient).
- **`server/custom-fields.js`** is the engine: `fieldDefs()`, `listOptions()`, `ensureList()`,
  `coerceCustomData()` (validate on write), `mergeCustomData()` (carry retired-field values through an edit),
  `describeCustomData()` (label/value pairs for exports).
- **Two rules that make this safe for compliance records — do not relax them:**
  1. **Nothing is deleted, only retired** (`is_active = 0`). A retired field/option disappears from new
     entries but still renders on records already filed. Deleting would silently void history.
  2. **Keys and values are immutable.** A field's `key` and an option's `value` are set once; only labels
     change. `PUT /fields/:scope/:id` passes the existing key into `normalizeFieldDef` for exactly this.
- `POST` of an existing-but-retired field/option **revives** it rather than erroring — people think "add
  Break Room back", not "resurrect a row".
- **API:** `server/api/structure.js` — `/lists`, `/lists/:key/options`, `/fields/:scope`,
  `/fields/:scope/:id/usage` (how many filed records use a field, shown before retiring it). Reads are open
  (forms need their own options to render); every write is gated on `canEditStructure` = admin or an explicit
  **`log-builder`** edit grant, and audit-logged.
- **UI:** `LogBuilderPanel.jsx` (Settings → Log Structure; Dropdown Lists + Log Fields tabs) and
  `src/components/common/CustomFields.jsx` — `<CustomFields>` in a form, `<CustomFieldValues>` on a record.
  A module opts in with those two mounts plus a `custom_data` column; nothing else.
- Scopes the field editor offers live in `KNOWN_SCOPES` (structure.js); `SCOPE_TABLES` maps a scope prefix to
  its host table for the usage count. Add both when wiring a new module.
- **Seeded lists** (`server/structure-seed.js`, `ensureList` is idempotent and never overwrites an edited
  label or revives a retired option): `uom`, `receiving_release_status`, `bpg_zones`.
  **`bpg_zones` is the brittle-plastic inspection zone list** — the case that motivated all this. Note the
  zone→PM-schedule wiring in `cleaning-seed.js` is still code-side; adding a zone to the list does not yet
  create its PM schedule (next step).

## Receiving Log (Warehouse)
`receiving_log` table + `server/api/receiving.js` + `ReceivingLogPanel.jsx`. Replaces the Monday board
(~2,100 rows). Filing is open to warehouse/supervisor/admin or a `receiving-log` grant; correcting someone
else's record needs an edit grant. Both dropdowns (UOM, Status of Release) are **managed lists** and extra
questions are **custom fields** — it's the first module built on the structure engine, so use it as the
reference when converting another log. `external_id` is reserved for idempotent import (upsert, don't
duplicate) and `source` records provenance.
**Inspection # is issued per INSPECTION, not per row.** One arrival is often several lines (three parts on
one PO), and the imported Monday history proves it: 1,328 rows share 511 `A-100-####` numbers. So
`nextInspectionNo()` takes MAX of the numeric suffix + 1 (zero-padded to 4, keeps counting past 9999); POST
assigns it **only when `inspection_no` arrives blank** — a number sent explicitly means "add a line to this
open receipt" and is kept as-is (which also leaves the legacy bare-number records alone).
`GET /receiving/next-inspection-no` feeds the form placeholder and is **advisory only** — the real number is
issued at write time, so two people filing at once can't collide. After a save the form clears the field
(new inspection is the common case) and offers a one-click "Add another line to A-100-####".

## QA inspections vs. cleaning: one table, two lists
Light Inspection (110-01/02), Brittle Plastic & Glass (431-02) and Temperature & Humidity (110-04) are
**QA records stored in `sanitation_records`**. `server/qa-records.js` is the single definition —
`QA_RECORD_AREA` (the regex, used on write), `recordGroupFor()` and `tagQaInspectionRecords()` (bulk re-tag).
Each list asks for its own group (`GET /sanitation?group=qa|sanitation|all`), so a record is in **exactly
one** list — nothing is duplicated. Temp/Humidity was missing from the regex, which is why it showed up in
Sanitation.
**`tagQaInspectionRecords()` must run both in `runMigrations` AND after the cleaning seeds in server.js.**
On a fresh DB the migration pass sees an empty table and the seeds then insert every inspection with the
default `sanitation` group — a brand-new deploy came up with an empty QA Inspections list and 407 of QA's
records sitting in Sanitation. Same class of bug as the migration-ordering note below.
**The BPG diagram** (FORM 431-01 V4) is a static reference at `public/forms/…pdf`, linked from the QA
Inspections BPG filter and from every BPG row's detail panel. Deliberately not an upload: it's a reference
sheet that must open even with no R2 configured. The zone **item lists** it documents live as
`pm_schedules.procedure_steps` (`item|qty|material`, one schedule per zone) and the zone names in the
`bpg_zones` managed list. Operator task views don't render reference documents yet.

## Receiving Inspection Checklist — FORM 204-01 V1
`server/receiving-checklist.js` (the form, verbatim, typos included — "informm purchasing" stays) +
`server/receiving-notify.js` + checklist routes in `api/receiving.js` + `ReceivingChecklist.jsx`.
Not user-editable: changing what a receiving inspection asks is a Document Change Request, same doctrine as
`scale-forms.js` tolerances. `checklist_revision` is stamped on every filed checklist.
- **ONE CHECKLIST PER INSPECTION, not per row.** An arrival is routinely several `receiving_log` lines against
  one PO (the Monday import has 1,328 rows sharing 511 inspection numbers) and the paper form has one header,
  one set of checks and one approval. `receiving_checklists.inspection_no` is UNIQUE and the POST is
  get-or-create, so opening the same delivery twice or on a second device lands on the same record.
- **The escalations are the reason this is in the app at all.** Six of the eighteen lines end in "*If YES,
  notify Adam or QA" / "*If NO, inform purchasing", which on paper depends on the receiver walking off the
  dock. Each carries a `notify` rule (which answer fires it, who it reaches); the button appears the moment
  the answer triggers it, and `notifications` records who was told and when.
- **Escalations are DERIVED from the answers on every read, never stored as a list** — correct a mis-tap and
  the escalation withdraws itself. `POST /notify` refuses to send one the answers don't support, or the
  record would claim QA was told about contamination nobody reported.
- **Sign-off is refused while any question is blank AND while a required escalation is unsent.** A checklist
  filed with blanks reads later as if those checks passed; an unsent escalation is the whole point of the line.
  Revoke → correct → sign again, all audited.
- **Answers save as they are tapped** — this is filled in next to a truck on a phone, and a form you have to
  remember to submit loses a delivery's worth of checks when someone walks into the cold store. Validation
  belongs at sign-off, which is where it is.
- `resolveTarget()` matches Adam/Maria BY NAME with a department fallback (the env-limits precedent), and the
  fallback fires only when nobody named is found — per-name fallback would quietly widen an escalation to a
  whole department on a rename. The caller is never notified of their own escalation.
- The allergen line has an instruction ("print placards"), not a person to tell, so it carries a `note` and
  no `notify`. Six escalate, not seven.

## Withdrawing a controlled document ("No longer in use")
`status = 'archived'` already existed and got a document out of the registry, but recorded nothing — and for
an SOP/WI/JD the two facts an auditor asks are *when did this stop applying* and *who decided*.
`archived_at` / `archived_by` / `archive_reason` (db.js), `DELETE /documents/:id` now **400s without a reason**.
- **The stored value stays `archived`; only the LABEL becomes "No longer in use".** The registry query, the
  review-due check, the doc-review queue and the retrain trigger all read `status`, and a sixth value would
  have to be added to every one of them correctly or a withdrawn document would keep generating work.
- **Withdrawn ≠ deleted.** It stays readable and keeps its history; the viewer shows a red banner and
  `printDocument()` stamps "NO LONGER IN USE" at the TOP of the paper, not just in the footer — a printout of
  a withdrawn Work Instruction must never look current. Reachable via the status filter.
- `effective_from` is editable: a document usually stopped applying before anyone recorded it, and an honest
  back-date beats a date everybody knows is wrong.
- **`POST /:id/reinstate` returns it to `draft`, not to approved** — whatever made it wrong enough to withdraw
  should be looked at before it is effective again. Its own audit entry, like revoking a signature.
- `_reinstated` was added to `ACTION_SUFFIXES` → `reinstate`, so the pair doesn't read as `archive` and
  `document_reinstated` in the same filter.

## Closing a sign-out when nothing comes back
`return_reason` and the office restock suggestion were already built — what was missing was any way to SET the
outcome from the **sidebar Return button**, which is the one screen people actually close these out on. It
posted `{}`, so a chemical that ran out was either left open forever or filed as a return that never happened.
- `POST /qms/mine/checked-out/:id/return` now takes `return_reason`, validated against `RETURN_REASONS` —
  an outcome the log cannot filter is refused rather than stored. The sidebar offers Used up / Damaged / Lost
  beside Return.
- **No `condition_returned` is invented for something that no longer exists.** Asking the condition of a
  used-up chemical only produces a meaningless "Good".
- `status` still becomes `returned` — it means "closed, no longer out" and is what CheckedOutPanel, the badges
  and QA Review read. The *outcome* is what says whether anything physically came back.
- **`BULK_APPROVE.routine` now excludes Damaged and Lost** (`NEEDS_A_LOOK`). Something went wrong and it
  deserves QA opening the record, not a checkbox. Used up stays routine — a chemical finishing is the ordinary
  end of a sign-out.

## Scale Verification (Forms 417-01 … 417-05)
Daily three-point scale checks, one form per scale/area. `server/scale-forms.js` holds the five definitions
(nominal + tolerance per point) — **not user-editable on purpose**: changing a tolerance is a document
change through Document Control, not a settings toggle. `gradeReadings()` decides pass/fail, so a reading
outside tolerance can never be filed as a pass (the paper form has the operator circle it; the readings
decide here). `scale_verifications` table + `server/api/scale-verification.js`; `POST /submit/scale-verification`
is the public kiosk path and shares `recordScaleVerification()` with the in-app one.
Kept **separate from `calibration_records`** — that's one before/after reading from an annual technician
calibration; this is three weighed points every morning, and merging them would lose the per-point readings.
UI: `ScaleKiosk.jsx` (QR at `/kiosk/scale`, Quick Forms entry `form-scale`, live in/out-of-tolerance feedback)
→ `ScaleVerificationTab.jsx`, a tab in Calibration Management with one status card per form ("has today's
check been run") and QA counter-signature. Room links to a `calibration_instruments` row when the name matches.

### THE PLACEMENT DIAGRAM IS PER FORM, and so is the wording that goes with it
Only the **Batching PALLET** scale (417-02) uses the revised sheet where all three weights sit in a row across
the centre line. The other four keep the long-standing centre-plus-either-diagonal-corner pattern. A single
global drawing is how four forms silently started showing a placement nobody agreed for them.
- `diagram: 'centerline'` on the form picks it; absent means corners, which is the safe default.
- **The two placement STEPS travel with it.** `PLACEMENT_PATTERNS` holds `about` + steps 3 and 4 per pattern
  and `procedureFor(form)` assembles the rest, served already-assembled by both `/scale-verification/forms`
  and the public `/submit/scale-forms`. A form drawing corners while its steps say "on both sides of the
  centre weight" is telling an operator two different things about where to put a certified weight — which is
  exactly the state a global re-transcription left it in.
- `ScaleProcedureCard` reads `form.procedure` and falls back to the shared object; every read goes through
  `proc`, or the fallback is a decoration that never applies.

## Controlled changes: a deployed definition is not the same as one in use
`server/controlled.js` + `server/api/controlled.js` + `ControlledChangesPanel.jsx`. Document Control decides
whether a change to a **form definition** (`qms-config` fields / logColumns / formCode) or an **acceptance
criterion** (`scale-forms` tolerances) takes effect. Those ship in the code, so "doesn't take effect" can't
mean "isn't deployed" — it means **the app keeps serving the last APPROVED snapshot** and parks the new one.
- `syncDefinitions(db)` runs once at boot, **last**, after every seed: unchanged → nothing; **never seen →
  recorded as the approved baseline, silently** (a fresh DB or the release that introduces this must not come
  up with every form blank — this is the single most important rule here); changed → park as pending and
  `entry.apply(approvedSnapshot)` rewrites the live config object in place, so `getType()` and every consumer
  serve the approved version with no extra wiring.
- **Verified at the point it decides something:** with a deployed 25 kg tolerance of 0.010 and an approved
  0.003, a reading 0.006 out graded **fail** and the record stored `tolerance 0.003`.
- Approving promotes and applies **immediately, no restart**. Removing a field is equally a change. A
  reverted deploy clears the stale pending row. `rejected` is still approvable later (revision issued after
  the denial) without needing another deploy.
- Each parked change raises a **Document Change Request** and ReadyBot DMs Document Control — a blocked
  change nobody is told about is just an outage.
- **The panel lives in the Document Control nav group, NOT Settings** — Settings is admin-only, so Daniela
  would never have reached it. Sidebar items can now carry `visible(user)` for exactly this (access by
  department, not by a module grant).
- **Log Structure stays out of scope on purpose.** Managed lists and custom fields are the self-serve layer;
  putting Document Control in front of adding a dropdown option is how people stop using it.

## Adding a field to a QMS record type (three places, one of them easy to miss)
`server/qms-config.js` drives the in-app form, the log columns, the record view, the Auditor View and the
CSV importer off one `fields` entry — add the field there and to `logColumns` and all of those follow.
**The kiosks do not.** `ComponentKiosk` / `KnifeKiosk` / `MaintenanceKiosk` / `ScaleKiosk` are hand-written
(they're big-tap public forms, not the config renderer), each with its own `POST /api/submit/…` handler that
destructures the body field by field — so a field added only to the config silently never arrives from the
kiosk. Component Sign In/Out's **MO #** (`mo_number`, same key as `production_entries.mo_number` so
"what was pulled for MO 4471" is a straight match) is the worked example: `qms-config.js` fields +
logColumns + `csv.map` aliases, `submit.js` destructure + `data` + audit detail + the `/component-options`
suggestion list, and the kiosk input itself. Records filed before the field exists just render `—`.
Kiosk suggestion lists are built from **that log's own history**, never from the schedule or another module:
the kiosk is a public unauthenticated path and must not widen what it exposes.

## Sign In/Out: one place, two controlled forms
Forms **440-02** (knives/blades) and **703-01** (equipment/tools/chemicals) record the same transaction —
a person takes an item, brings it back, condition checked both ways. They were separate modules only
because they are separate paper forms. They are now one nav entry (`sign-out` hub in `HUB_TABS`) with
tabs **Out now / Equipment, Tools & Chemicals / Knives & Blades**, replacing three entries.
**The records stay separate on purpose.** An auditor asking for 440-02 must get exactly those, and whether
the two forms ever become one controlled document is Document Control's call, not the app's. So each tab
is still its own `record_type` with its own write paths; only the way in is shared.
`ModuleHub` grew an optional per-tab `visible(user)` — Out now is a read-only roll-up, so it shows for
anyone with either form (or Ricardo's explicit `currently-out` grant, which is his whole access). `HUB_OF`
resolves the old ids, so deep links, quick-tab picks and Settings grants all keep working untouched.
**"Chemicals" is a behaviour, not a label.** An item in that category *requires a use specification*
(Food Contact / Non-Food Contact / Food Grade / Non-Food Grade) on sign-out, enforced server-side.
`activeChemicalNames()` (qms.js) is the single answer to "is this a chemical" — the `approved_chemicals`
registry **plus** any `maintenance_items` row with `category = 'Chemicals'` — and the kiosk catalogue, the
in-app picker and the `POST /submit/maintenance-signout` check all read it. Not everything needing a use spec
is in the registry (baking soda is the case that raised it). Adding the category to the editor's list alone
would have let an item *look* like a chemical while the sign-out quietly skipped its use spec, which is worse
than not offering it at all. The category name is **`Chemicals`**, matching the group the registry is merged
into, so hand-added and registry chemicals share one group instead of two near-identical ones.

**CheckedOutPanel read only `maintenance_sign_out`**, so a knife signed out on 440-02 never appeared in
"what's out" — the one question that screen exists to answer. It queries both now.

## "It ran out" is an outcome, not a missing return
A chemical that runs out never comes back, so "Returned" can't be the only way to close a
`maintenance_sign_out`. `return_reason` (`RETURN_REASONS` in qms-config.js: Returned / **Used up / ran out** /
Damaged / Lost) sits beside the existing `comments` box and is in `logColumns`, so it filters — a reason you
can filter is worth more than a sentence someone has to read.
**Used up raises a restock SUGGESTION, never a supply request.** `GET|POST /office/supply/suggestions[/dismiss|/order]`
(office.js). Three people finishing the same sanitizer would otherwise put three near-identical rows in
Marnee's queue, and a queue with duplicates in it stops being read — so suggestions are **grouped by item**,
live in their own dismissible amber strip above the orders list, and only become a real request when someone
clicks Add to orders. What gets ordered stays the office's decision.
**There is no suggestions table.** A suggestion *is* a sign-out record whose outcome was "used up";
`data.suggestion_state` (`open` / `dismissed` / `ordered`) lives on that record, so nothing can fall out of
sync. `openSuggestions()` reads it with `json_extract`, bounded to 500.

## QMS records: who may change a filed record
`server/api/qms.js` — **filing stays open on purpose** (anyone who sees a deviation should be able to
report it), everything after that is records integrity. `mayEdit()`: the filer while unsigned, plus
admin/supervisor/QA/document_control; **any approval signature closes the record to everyone but an admin**.
`mayDelete()`: admin only, and **never once signed** — a signed record is changed by status, not removed
(bulk-delete skips signed rows and reports `skipped_signed` rather than taking the selection down with it).
`bulk-update` needs a records role; CSV `import` is admin-only.
**The client must not decide this — the server tells it.** `withPermissions()` stamps `can_edit` /
`can_delete` / `edit_block_reason` onto every record the API returns, and the UI renders what it's told.
It used to gate Edit on `canEditModule()` alone — a *module* permission — so someone with edit rights on the
log was offered the pencil on a record the server would refuse, filled the form in, and the save did nothing
(`handleUpdate` had no catch, so the 403 rejected silently and the modal just sat there). A deliberate rule
read as a broken screen. Keep policy in `mayEdit`/`mayDelete` only; a second copy on the client is how the
two drift apart.
**The way back from a signature is revoke, not admin.** `DELETE /:type/:id/approve/:role` allows an admin
**or the original signer** — so the normal case (sign off, then spot a wrong lot #) is self-service: revoke
your own signature, correct the record, sign again, all three steps audited. Say this before telling anyone
to find an admin.

This was missing entirely: `/api/qms` mounts with no router guard and the handlers had none, so any
signed-in operator could edit or hard-delete any deviation, non-conformance or on-hold record. Only
`bulk-delete` had ever got the admin check. If you add a QMS write path, guard it — the mount will not.

## Sorting a log by its header (`src/lib/useTableSort.js` + `common/SortHeader.jsx`)
Nine logs had each grown their own copy of the same four pieces of state, the same comparator and the same
chevron — which is exactly how the **Retention log ended up as the one that never got it**. A tenth private
copy would have fixed that screen and left the pattern intact, so the shared pair went in instead.
- **Columns are DATA.** One array drives both the header and the sort, so a column cannot be sortable in one
  place and not the other. An entry with no `key` (the chevron cell, the actions cell) renders as a plain
  `<th>` and is not clickable.
- **Comparators come from the column's `type`**, because the naive string compare most of the copies used
  sorts 9 after 10. `number` is numeric, `date` compares ISO strings as text and falls back to `Date`
  parsing otherwise, and `text` uses `Intl.Collator` so accented names file where a reader expects.
- **Blanks sort last in BOTH directions** — an empty cell is missing data, not a low value, and burying it
  under the rows someone came to read is right.
- **Sort before the render cap.** `useCappedList` renders the first 100; sorting after it would only order
  the hundred rows that happened to be on screen. Retention does `useTableSort` → `useCappedList`.
- The hook copies the array before sorting — sorting in place would mutate the cached API response.
- Wired into Retention Samples. The other eight logs still have their own copies and work fine; convert them
  when one of them next needs touching rather than churning eight screens at once.

## Click a log row to expand it
`src/lib/useRowExpand.js` (`useRowExpand()`, `stopRowClick`) + `src/components/common/RowDetail.jsx`
(`<ExpandCell>`, `<DetailRow>`, `<DetailFields>`). A table opts in with a `w-8` chevron column,
`{...expand.rowProps(r.id)}` on the `<tr>`, and a `<DetailRow>` **inside that row's `<Fragment>`** — two
panels used to render in a second `.map()` after the whole list, so expanding row 3 of 200 dropped the
detail at the bottom of the table. Action cells (`Correct`, sign-off, delete, links) carry `stopRowClick`
so the pencil still opens the form. **The pencil was the wrong door for reading** — it implies you're about
to change a compliance record and is gated behind edit rights most readers don't have; expanding is
read-only and open to anyone who can see the log. `colSpan` on `<DetailRow>` and on the empty-state row must
both count the chevron column.
Wired: Production Log, Receiving, Calibration (instruments + records), Chemicals, QA Inspections, LOTO
executions, Supply Orders, Time Tracking, AP/AR ledgers, and office `DataGrid` (`expandable`, on by default,
auto-builds the panel from the columns; pass `detail={row => …}` to add more). Disposals, QMS Records,
Document Registry and COA already open a full record view on row click — left alone.
The **audit log** detail diffs `previous_state`/`new_state` and shows only the fields that changed; it
stores whole snapshots and dumping both buries the one value someone came to check.

## Performance: what actually made it slow
Measured on a production-scale DB, not guessed — server SQL was never the bottleneck. Two causes:
1. **Unbounded list endpoints.** `/pm/operator-tasks` shipped **3.7 MB** (every unsigned production entry
   ever filed) to the screen floor staff open on a phone; `/sanitation` 3.5 MB, `/coa/requests` 1.3 MB.
   All bounded now (`limit`, default 500; QA sign-off backlog capped at 200 oldest-first — the true count
   is already in `/compliance/notifications`). **Keep new list endpoints bounded.**
2. **`recleanRooms()` ran two `MAX(...)` queries per room** against unindexed columns — 53 rooms, 106 table
   scans, 83 ms, and `/notifications`, `/compliance/critical` and `/sanitation/reclean-status` each paid it
   on every page load. Now two GROUP BY passes (~4 ms) plus indexes on the columns actually filtered.
**Reads must not write.** `markMissedWorkOrders()` and the task generators ran inside every GET; they're
behind `runPmHousekeeping()` now (once per 5 min, whoever asks first). Don't call them from a handler.
3. **The client rendered every row it was given.** Even with bounded APIs, the Production Log came out as
   18,000 DOM nodes and a 60,000px page on a phone. `src/lib/useCappedList.js` + `<ShowMore>` render the
   first 100 with a button for the rest (Production Log 18,084 → 4,874 nodes, Sanitation 14,259 → 3,074,
   QA Inspections 8,996 → 2,257). Deliberately **not** virtualization — a windowed list breaks Ctrl-F,
   breaks printing, and fights the expand-a-row detail panels. Wire new long lists through it.
**Modules are lazy-loaded** (`lazy()` + `<Suspense>` in App.jsx): entry bundle 2,002 KB → 544 KB. That adds
a failure single-bundle didn't have — a deploy replaces hashed chunks under a page that's been open since
before it — so `ModuleBoundary` catches the failed import and offers a reload instead of a white screen.
Adding a module means adding it to the lazy list, not a plain import.

## Migration ordering (fresh-DB gotcha)
`addColumnIfMissing()` runs `ALTER TABLE … ADD COLUMN`, which **throws** if the table doesn't exist yet —
`PRAGMA table_info` on a missing table returns empty, so the "missing" check passes and the ALTER blows up.
This only bites a **fresh DB** (new deploy / DR restore); Railway's persistent volume masks it because the
table already exists from an earlier deploy. Keep every column migration **after** its table's CREATE in
boot order. The `chat_push_subscriptions` diagnostic columns were violating this (added in `runMigrations`
before the chat-schema block that creates the table) — a fresh boot went FATAL. Fixed by moving those
five `addColumnIfMissing` calls to right after the chat-schema `db.exec` block. Same pattern documented for
`supply_invoices.extracted_text`.
**`CREATE INDEX` has the same trap, and it is easier to miss.** An index in the first schema `db.exec` block
that names a table created later, or a column added later by `addColumnIfMissing`, kills a fresh database at
boot. Two from the performance pass were doing exactly that and a fresh boot went FATAL twice over:
`idx_sanitation_group_date` indexed `record_group` (a migration column) and `idx_production_entries_room`
named a table created 400 lines further down. Each now sits next to the thing it indexes — the index for a
migration column goes immediately after its `addColumnIfMissing`. **Boot a fresh DB (`DB_PATH=` a new path)
before shipping any schema change**; the production volume will not tell you.

## Video uploads (comms + training)
`server/media.js` is the single source of truth for large uploads: **200 MB video / 25 MB everything else**,
`isVideo()`, a **disk-backed** multer (`mediaUpload()`, temp files in the OS temp dir), `rejectOversize()`,
`cleanupTemp()` (always call it in a `finally`) and `uploadErrorMessage()` for multer's LIMIT_* codes.
`storage.js` gained `putStream()` — multipart via `@aws-sdk/lib-storage`, 8 MB parts — because the old
memory-buffered `putObject` would have held a whole video in RAM. Comms attachments and the new
**course materials** (`training_materials` table, `/api/training/courses/:id/materials`, delete at
`/api/training/materials/:id`) both go through it. Client: `apiUpload(path, fd, 'POST', onProgress)` switches
to XHR when a progress callback is passed (fetch can't report upload progress). Videos play inline; AVI/MKV
and any codec the browser rejects fall back to the download card.

## COA: Tests Requested is a picker, not a text box
"Tests Requested" on a lab request was free text while the Specifications form had always offered the real
list — same tests, two ways of writing them. `TestsRequestedPicker` (COAPanel.jsx) shows `TEST_GROUPS`
(Microbiological / Heavy Metals / Composition & Identity) as chips with a **select-all per panel**, because
"Micro" and "HM" are how QA talks about this, plus a free-text box for anything else.
- **The stored value stays a comma-joined STRING.** `tests_requested` is read as text by the log column, the
  CSV and PDF exports, the by-test stats and the Monday importer; none of them changed.
- **Panel shorthand is never silently expanded.** 1,150 of 1,391 real requests say `HM & Micro`, not the
  seven named micro tests. `splitTests()` keeps anything unrecognised verbatim in the free-text box, and an
  **Expand to named tests** button offers the upgrade — rewriting what a filed request says as a side effect
  of opening it to change a date is not an edit anyone asked for.
- The picker replaced a `required` input, so `handleSubmit` validates it itself; the server 400s on an empty
  `tests_requested` and a form that silently does nothing is worse than one that says why.

## COA item specification sheet
The Specifications tab stores one row per test (right for auto pass/fail, hard to eyeball). "View item & all
specs" (`ItemSpecSummaryModal` in COAPanel.jsx) regroups the rows under an item — the old paper spec sheet —
with a PDF download. Server: `GET /coa/specifications/summary?item_number=` (JSON) and
`GET /coa/specifications/pdf?item_number=` (same letterhead as the COA export). `specText()` derives a
readable spec from min/max when there's no free-text spec (`≥ X`, `≤ Y`, `X – Y`).
**The CTLA→spec→pass/fail→PowderOps-COA flow the user described is accurate:** specs are logged per test;
an uploaded lab result is parsed (`coa.js` extraction), matched to the active spec for that item+test, and
auto-graded pass/fail from min/max; the request rolls up to pass/fail; the facility COA PDF exports with logo
+ QA e-signature.

## Office finance: AP / AR (+ QuickBooks)
`ap_invoices` / `ar_invoices` / `finance_files` (`server/api/finance.js`, one router driven by a per-ledger
config; UI is one `LedgerPanel.jsx` with `ledger="ap"|"ar"`). KPI cards are plain SQL sums. Bulk file upload
→ R2, contents OCR'd via the shared `server/invoice-text.js` (extracted from office.js; supply invoices use
it too) so search hits text *inside* the PDF. Modules `accounts-payable` / `accounts-receivable` are granted
separately in Settings.
**QuickBooks** (`server/quickbooks.js`) degrades gracefully like storage/ai and is **read-only by
construction** — there is no code that writes back, which is what makes it safe while QBO is still the
system of record. Bills→AP and Invoices→AR upsert on `qb_id`; money fields come from QBO, everything else
stays local. Refresh tokens rotate, so the current one is persisted in `app_settings.qbo_refresh_token`.
**Env:** `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`, `QBO_REALM_ID` (optional
`QBO_ENV=sandbox`; `QBO_API_BASE`/`QBO_TOKEN_URL` exist only to point the tests at a stand-in).
UI is the admin-only **QuickBooks** tab of the Accounting hub (`QuickBooksPanel.jsx`).
- **EVERY read pages through `queryAll()`.** QBO caps a query at 1,000 rows and pages with a **one-based**
  `STARTPOSITION`; the original single `MAXRESULTS 500` query returned the first page and reported success,
  which on a real company is a clean-looking sync that quietly lost most of the books. Worst possible
  failure for a migration — never add a bare query.
- **Discovery answers "what do we actually use", counted rather than recalled.** `discoverQuickBooks()`
  walks `ENTITIES` (22 types), using `SELECT COUNT(*)` → `totalCount` so it counts **without downloading**,
  plus two `ORDERBY TxnDate ASC/DESC MAXRESULTS 1` queries for the date range (QBO has no MIN/MAX). The
  most valuable line is the **zero**: an entity with no records is a feature the replacement needn't carry.
  One entity erroring is reported per-entity (`unreadable`) and never loses the other 21. Stored in
  `app_settings.qbo_inventory` so the answer survives without re-hitting the API.
- **Full pull vs incremental sync are different jobs.** `syncFromQuickBooks(db, {full:true})` drops the date
  cutoff and also pulls the chart of accounts + vendors + customers — that is the migration, run once
  (`qbo_full_pull_at` records that it happened). The default incremental mode takes what changed since
  `qbo_last_sync` (12 months on a cold start), which would silently leave older history behind in a system
  they're trying to leave.
- `qbo_accounts` / `qbo_contacts` (one table, `kind` + unique on `(kind, qb_id)` — QBO namespaces ids per
  entity) are **copies, not sources**: no local fields, overwritten each pull. An account editable in two
  places is worse than one you have to go and read.
- **Exercised end to end against a stand-in QuickBooks** (OAuth refresh incl. token rotation, the v3 query
  endpoint, paging, COUNT, ORDERBY) holding 2,350 bills — deliberately more than one page. 41 assertions on
  the module + 22 on the HTTP surface. Still **never run against their real company**; that's blocked on
  the four env vars, and `docs/quickbooks-api-setup.md` is the step-by-step for them.

## Whole-page EN/ES
`src/lib/usePageTranslation.js` + `src/components/LangToggle.jsx`: pass every string the page shows, get
`tr()` back. Uses the cached `/ai/translate-content` endpoint, so it silently stays English when AI is off.
Wired into Supply Orders, Time Tracking and both finance ledgers; reusable anywhere.

## Passwords expire once a year (`server/password-policy.js`)
`users.password_changed_at` + a 365-day limit, with a 14-day warning banner before it bites.
- **Enforced in the auth middleware, not the login screen.** A rule the client alone applies is a
  suggestion. While expired, a session may call exactly three things — `GET /users/me`,
  `POST /users/me/password`, `POST /users/logout` — and everything else 403s with `password_expired: true`.
  That also catches a tab left open since before the lapse.
- **Expiry must NEVER clear `password_hash`.** The admin reset does that, and its whole point is that the
  next sign-in sets a password *without* proving the old one — doing the same on expiry would let anyone who
  knows a username take the account the day it lapsed. Verified: `set-password` on an expired-but-set
  account is refused.
- **Its own module** because both `middleware/auth.js` and `api/users.js` need it, and users.js already
  imports `requireRole` from the middleware — putting the helpers in users.js closes an import cycle.
- **The clock starts when the column is backfilled, not at `created_at`.** Nobody knows when the existing
  passwords were set, and backfilling from account age would have expired most of the plant on deploy day.
  Everyone gets a full year from the release, and the policy's start date is a recorded fact.
- Stamped on all three write paths (self-serve change, first set-password, admin reset clears it to NULL).
  A NULL never blocks — that user has no password yet and the set-password flow owns them.

## Sign-in usernames (short) vs full names (records)
`users.username` = what people type to sign in, derived first + last from `users.name`
(`server/usernames.js`, backfilled on boot, unique index, admin-editable in Settings). `users.name` stays
the full legal name and is what every record, signature and audit entry shows — nothing historical moved.
Login accepts **either** the username or the full name, so no one is locked out. A rename follows the
username only when it was still the auto-derived one; a hand-set username is never overwritten.
Spanish two-surname names derive to first + *last* word ("Gaston Antonio Perez Quintanilla" → "Gaston
Quintanilla"); when someone goes by the paternal surname, set it by hand in Settings.
**Comms uses the short name everywhere** — author labels, DM/group titles, member lists, mention
autocomplete, search hits, typing indicators and push titles all go through `userName()`/`shortNameOf()`
in comms.js and `chatName()` in CommsView. Chat is conversation, not a record. `extractMentions()` matches
**both** the short and full form (longest first) so messages written before the change still resolve, and
`renderBody` highlights both. Admin screens (CommsSettings, Settings) keep full names — they're about
accounts, not conversation.
**Public API paths live in one place:** `isPublicPath()` in `server/middleware/auth.js` (server.js calls it).
`GET /users/lookup` is public — the login type-ahead was 401ing before, which is why long names had to be
typed exactly.

## Two origins: launcher vs app (link + PWA gotcha)
`start.powder-ops.com` = the **workspace launcher** (`launcher/index.html`), not the app. Only the bare
landing request (`/`, no query) gets the launcher; every other GET on that host 302s to the ReadyDoc origin
with path+query intact (`server.js`, `READYDOC_ORIGIN`, default the Railway domain). Before that, deep links,
`/approve/<token>` magic links, and PWA assets on the launcher host all rendered the picker instead.
**Generate links with `readyDocOrigin()` (`server/links.js`), never `appBaseUrl()`** — `appBaseUrl()` is the
public front door and is only for the Twilio webhook signature, which must match the console entry exactly.
**PWA installs must happen on the app origin** (the manifest and its start_url must be same-origin), so the
launcher host can never be installable. In-app help: `src/components/InstallHelp.jsx` +
`src/lib/useInstallPrompt.js` (captures `beforeinstallprompt` at module load, so the account menu / sidebar
"Add ReadyDoc to your phone" entry can still fire the native prompt). Android Chrome shows no install option
in in-app browsers/WebViews, in Incognito, or when it's already installed — the sheet says so per-platform.

**Slack history importer (Phase 5) — confirmed shape:**
- User will make all channels public before exporting so the Slack export captures everything.
- Map imported authors to **existing users by NAME**, not email — keep the current user structure (add-by-name).
- Open question the user raised: may switch auth from **PIN → password** (or add a password alongside the PIN).
  Revisit this when building the importer / when hardening auth; not part of comms Phase 2.

## Context: audit log (Phases 1 & 2 shipped)
- `logAudit(actorOrUser, action, entityType, entityId, details, prev, next, entityLabel)` in `server/db.js`.
  Pass the authenticated **`req.user` object** (not `req.user.name`) so `actor_id/role/department` are captured; a
  plain string is still accepted for system/public callers.
- `canonicalAction()` normalizes verbs (`<entity>_created/updated/deleted/…` → create/update/delete/…). Keep new
  actions in that canonical vocabulary.
- Auth events logged in `server/api/users.js`: login, logout, login_failed, login_locked, permission_change.
- Audit API: `server/api/audit.js` (`/`, `/facets`, `/export`, `/entity/:type/:id`); UI `src/components/compliance/AuditLogPanel.jsx`.

## Training Log importer (the matrix spreadsheet, not a table)
The plant's Training Log is a **matrix**, one sheet per period (October 2022 … March-April 2026): employees
down the side, trainings across the top, a cell means "this person did this training". 14 sheets, 3,639
completions, 94 written names, 30 headings. `server/training-log.js` parses it; `POST
/api/training/import-log/analyze|preview|commit` (admin-only) is the pipeline; `TrainingLogImportModal` in
TrainingPanel.jsx is the wizard (admin-only **Training Log** button beside Import).
- **The one human step is the COURSE MAPPING.** The headings drifted over three years — "Food Defense",
  "Food Defense (WI)", "Food Defense SOP" are one training — and only a person can say so. ~30 decisions
  instead of 3,639. `suggestCourse()` pre-fills the dropdowns so it's a review, not data entry. A heading
  left blank is skipped and can be mapped on a later run.
- **Cells are messy on purpose-of-parsing:** `"2/7/2023 AB"` (date + trainer initials), an Excel serial, initials
  only, a video URL, or empty. Each training occupies **two** columns (course + "Initial") and people filled
  either, so both are read and merged. A cell with neither a date nor initials is a stray mark, not a record.
- **A missing date is never invented.** `periodOf()` dates a cell from its sheet ("April-July 2023" →
  2023-04-01) and the record says so in its notes; where even the period is unreadable the row is **skipped**
  and the sheet named in `undated_sheets`. The year regex is `(?<!\d)(20\d{2})(?!\d)` so "March-April2026"
  resolves but the log's real tab typo **"November- December 20204"** does not silently become 2020.
- **A person is their name's WORDS, sorted** (`personKey`) — accent-folded, `(?)` stripped. The log writes
  "Vera, Yetzon" on one sheet and "Yetzon Vera" on the next, and the roster spells accents the log drops;
  matching the string as written left **92 of 94 people unlinked**, and an unlinked completion can't answer
  "is this operator current". Sorting the words beats guessing which side of a comma is the surname —
  "Lopez Fernande, Estefany Maria" would get that wrong. 94 apparent people → 80 real ones.
  The record stores the **account's** name when there is one, so it reads like every other ReadyDoc record.
- **Idempotent**: a completion is `personKey + topic + date`. Re-running creates 0. `already_in_readydoc`
  (a prior import) and `repeated_in_file` (the same event on two sheets) are counted **separately** —
  calling the second "already imported" on an empty database is how an importer loses trust on the preview.
- Verified end to end on the real file: 608 created from 11 mapped columns, 208 dated from the sheet period,
  re-run 0 created / 1,279 recognised.
- **`suggestCourse` matches WHOLE WORDS, never substrings, and won't cross the clean/operate line.**
  Two mis-suggestions caught on the real log, both of which a reviewer might have accepted:
  "Sanitation & SSOP" *contains* the letters `sop`, so every `… SOP 401` heading scored against Sanitation on
  nothing but that accident; and "Mixer" overlaps *Cleaning the Hexagon Tumbler Mixer* and *Hexagon Tumbler
  Mixer Operation* equally, with first-match-wins picking the cleaning one — filing 256 people as trained to
  clean a machine they were trained to run. Scoring is now per whole word (≥4 chars = 2, 3 chars = 1) with a
  −3 penalty when only one side of the pair mentions cleaning. Words shorter than 3 chars ("wi") are noise.
  The old `filter(w => w.length > 3)` also made **"GMP" unmatchable** — the one heading named after its course.

## Work Instruction training courses (`seedWorkInstructionCourses`)
The plant's own WIs as courses, so the Training Log's `Mixer (WI)` / `Warehouse (WI)` columns have somewhere
to import to: **WI001** Warehouse, **WI003** Volumetric Stick Pack, **WI004** Hand Filling, **WI007** Auger
Stick Pack, **WI012** Cleaning the Auger Stick Pack, **WI018** Cleaning the Hexagon Tumbler Mixer, **WI021**
Hexagon Tumbler Mixer Operation, plus **SAF-201** Fire Extinguisher & Emergency Exit Awareness carrying the
plant's real 10-question test (transcribed from the signed document, answer key included — not generated).
- **The course code IS the document number.** "Show me who is trained on WI007" is then a straight lookup.
- **This is a SECOND seeder and must stay separate from `seedTrainingCourses`.** That one is
  `if (existing > 0) return` — all-or-nothing on an empty catalog — so it can never introduce a course to a
  database that already has one, which is every deployed instance. `seedWorkInstructionCourses` runs each
  boot and adds only missing codes; it must be called *after* it in server.js.
- **A code that already exists is left completely alone** — an edited title, a cadence someone set, or a
  course retired with `active = 0` are decisions. Courses are retired, never deleted, so the row survives to
  say "don't re-add me".
- Cadence is one-time + retrain-on-revision, not annual: the WI implies retraining when the *document*
  changes, and inventing an annual rule would put the plant overdue on a date nobody agreed to. SAF-201 is
  the exception at 12 months (emergency-response awareness genuinely is annual).
Then the powered industrial trucks, from the plant's own material:
- **FORK-101** Forklift Safety & Certification carries the real 20-question bilingual quiz, graded against
  the MASTER KEY sheet that shipped with it. **The Spanish is the plant's own wording** in
  `training_questions.prompt_es` / `options_es`, not machine translation — a translated safety test is not
  the test people signed. (Accents and five plain misspellings were corrected; no answer or meaning moved.)
- **PJ-101** Electric Pallet Jack Safety — course only, no test: none was supplied, and inventing one for a
  safety topic and presenting it as the plant's would be worse than having none.
- Both are **36 months**, from 29 CFR 1910.178(l)(4)(iii) (three-yearly operator evaluation) — and the
  plant's own quiz answers Q17 the same way. The one cadence here taken from a rule rather than left to the
  user.
- `SYNONYMS = { cgmp: 'gmp' }` in `suggestCourse` is how `cGMP POLICY SOP 401` reaches GMP-101; every
  heading and SOP here writes "cGMP" and the course is named "GMP". **Keep that table tiny** — it is local
  vocabulary, not a second mapping system.
- The courses query is `ORDER BY code, title` so a tie between two equally-plausible courses resolves the
  same way every run. A suggestion that changes between two previews of the same file is worse than one
  that is merely debatable.
- With all of these, every heading maps: suggestions go 11 → **27 of 27** real headings, and a full import
  goes **608 → 1,950** records (3,421 recognised on a re-run).
- **SOP 401 V3 says "biannual cGMP test" where V2 said "annual"** — ambiguous in their own document (twice a
  year, or every two years?). GMP-101 is left at 12 months until Document Control rules; do not silently
  change it.

## Universal file importer (Monday / Airtable / Drive / Slack / desktop)
`server/tabular.js` reads **CSV / TSV / XLSX with no new dependencies** (XLSX is a zip of XML via the
already-present `adm-zip`; the CSV reader is a proper RFC-4180 character scan, not a split). `readTable()`
skips the title/banner rows and repeated header rows a Monday export carries.
`server/api/imports.js` is the pipeline, deliberately four steps so nothing bulk-writes a compliance log by
accident: **analyze** (stash file in `import_batches`, suggest a column mapping) → **preview** (dry run:
create/update/skip counts + per-row reasons, nothing written) → **commit** (one transaction, upsert on a
natural key) → the batch row itself is the **provenance** record (`source`, `external_id` on each row).
- Add a target = one `TARGETS` entry (fields + aliases + identity). Client is `<ImportPanel target=… />`.
- **Identity = business key + occurrence index, and skipping is decided on FULL ROW CONTENT.** Two traps here,
  both caught by the preview before any write:
  1. Monday's item name repeats (722 distinct across 2,107 rows, "NA" 215×), so keying on it alone collapsed
     1,390 rows.
  2. The business key alone is still not enough: **the same item legitimately arrives twice** against one
     inspection #/PO/lot (two pallets, a partial delivery) differing only in quantity, expiry or packing slip.
     Keying on it dropped **15 real receipts**. So each row gets `businessKey + '#' + occurrence-within-file`,
     and a row is only skipped as a duplicate when `contentHash()` (every mapped field) matches an earlier one.
     That keeps separate receipts, collapses true re-entries, and still updates in place on re-import.
- Dates arrive as Excel serials, ISO, or locale strings; `toDate()` normalizes all three (serial only in the
  20000–80000 window so a quantity like 45.36 is never mangled). Monday check columns are "v" → `toBool()`.
- Verified end to end on the real 2,107-row Receiving Log export: 15/16 fields auto-mapped, 2,064 created in
  ~0.2s, 43 skipped (in-file duplicates + rows missing a required field), and **re-importing the same file
  produced 0 created / 2,064 updated with no duplicates**.

## Comms Activity feed
`GET /api/comms/activity?filter=all|mentions|dms|threads&unread=1&before=<created_at>` +
`GET /api/comms/activity/unread` (per-tab badge counts). `ActivityView.jsx`, a sidebar entry above Threads.
**It is deliberately only what involved YOU** — @mentions, DMs, and replies on threads you started/replied
to/were mentioned in. Ordinary channel messages are excluded on purpose: that's the channel list, and
repeating it here buries the things that need an answer. Your own messages are excluded too.
- `ACTIVITY_KINDS` sets precedence (mention > dm > thread) so an @mention inside a DM is de-duplicated to one
  row rather than appearing twice. The UNION over-fetches (`limit * 4`) because access checks and de-duping
  both drop rows after the query.
- **Unread is measured against the thread when the item is a reply, the channel otherwise** — the same rule
  `threadUnread()`/`channelUnread()` use, so the feed and the sidebar badges can't disagree.
- Clicking a row dispatches the existing `comms-open-channel` event (the push-notification deep-link path),
  which opens the channel, scrolls to the message, and resolves a thread reply into its thread drawer.
- Pages back through history via the `before` cursor — people use it to find an old message, not only to
  triage unreads.

## Clearing the Activity badge
Activity has **no read state of its own** — an item is unread when it's newer than the caller's
`last_read_at` on its thread (replies) or its channel (everything else). So `POST /comms/activity/read`
stamps exactly those rows and nothing else; it is deliberately narrower than `/read-all`, which marks every
channel read and would also wipe unread counts for channels the person hasn't opened. Use the same
`strftime('%Y-%m-%d %H:%M:%f')` clock format as `chat_messages.created_at` — the unread check is a string
comparison and an ISO value sorts wrong. A public channel someone was @mentioned in may have no membership
row, so the handler inserts one — **`kind = 'public'` only**, see below. "Mark all read" appears in the
Activity header only while something is unread.
**The DM branch of every Activity query must join `chat_channel_members`** (`DM_MEMBER_JOIN` in comms.js).
It selects every DM message in the database and relies on the post-query `canAccess()` to filter — but
`canAccess()` grants **admins every channel** (that's how channel administration works), so without the join
an admin's feed listed the whole plant's private conversations, and `POST /activity/read` then *inserted a
membership row in each one*, permanently adding every DM to their channel list. Mentions and thread replies
are self-selecting and need no guard; the DM branch does. The auto-join is also restricted to public
channels now, so no read-a-badge action can ever enrol someone in a private channel or DM. A repair pass in
`runMigrations` deletes DM memberships whose `user_id` isn't in the channel's `dm_key` (the authority on who
belongs) — the code fix can't undo rows already written.

## Tasks vs approvals: the Operator View does not sign anything
`/pm/operator-tasks` used to inject pending production entries as virtual
`QA Sign-off: …` tasks (ids prefixed `qa_`). They are gone. A sign-off is an **approval**, not a task, and
it belongs in **QA Review**, which already covers all seven pending-signature sources and clears them in
batches. Listing the same work on both screens, with nothing on either saying so, is what made the QA
Operator View read as "the Production Log again".
- The Operator View is now purely work orders — something to go and do, one at a time, on a phone. QA still
  sees plenty there: BPG (17 zones), Light Inspection (14), Temp & Humidity (3) and Quality Schedules all
  generate `task_group = 'qa'` work orders, so **QA Inspections were never missing from it**.
- A teal banner on the QA filter links to QA Review, so nobody wonders where the sign-offs went.
- `/compliance/notifications` "N production entries pending QA sign-off" now targets **`qa-review`**, not
  `production-log` — a notification that lands somewhere you can't act is noise.
- `canSeeQaReview` moved to `src/utils/permissions.js` (App.jsx imports it) because OperatorView needs the
  same rule; a second copy of an access rule is how two screens start disagreeing about who can reach a
  module.

## Working without a connection (`src/lib/offline.js`)
The Wi-Fi drops in the warehouse and at the back of production. Two narrow mechanisms, not one broad one:
a **read cache** (every successful GET stored in IndexedDB; a GET that fails with a *network* error serves
the last copy and `useApiGet` returns `offline: true`) and a **write outbox** (a non-GET that fails with a
network error is queued and replayed FIFO on reconnect).
- **CAPTURE IS QUEUED, APPROVAL IS NOT** — `NEVER_QUEUE` in offline.js. Signing is a statement that you
  reviewed the record *as it stood*; a signature queued at 9am and applied at noon could land on a record
  someone else changed, and the trail would say you saw it. Approvals, sign-offs, verifications, deletes,
  auth, cleanup and bulk imports refuse to queue and say they need a connection. Same line the Operator
  View draws between tasks and approvals.
- **An HTTP error is an ANSWER, not an outage.** `fetch` only rejects when the request never completed, so
  only a `TypeError` queues; a 400/403 still surfaces. Treating a rejected record as "we'll send it later"
  is how a refused save looks filed.
- **Replay stops at the first failure.** Skipping a failed item and carrying on could apply an edit to a
  record whose creation never landed. A 4xx on replay drops that item out of the queue and names it in the
  red bar — a queue that silently discards a rejection is worse than no queue.
- **A network failure at start-up must not sign you out.** `useAuth` used to `.catch(() => removeItem)` on
  `/users/me`, so opening the app with no signal cleared the token and showed the login screen — offline
  mode was dead on arrival. It now distinguishes a *rejected* token (sign out) from a request that never
  reached the server (render from `localStorage.auth_user`). **`auth_user` is a CACHE, never a credential:**
  the token still has to be accepted by the server before anything is read or written; all it does is let
  the shell render.
- `OfflineBar` (under the header, every screen) shows the two facts separately — no connection, and N
  entries waiting — because someone can be back online with five queued and someone offline with none.
- The queued-write message leads with a ✓ because most forms render it in their error slot.

## Starter COA specifications, seeded as drafts (`server/spec-seed.js`)
The Specifications tab started empty, so an uploaded lab result had nothing to grade itself against — the
test with no spec is the one that quietly passes. The seeder files the standard panel for the **50 most-
tested items** (from `coa_requests`, most requests first) as drafts for QA.
- **A draft can never grade a result, and that's not a promise made here** — drafts are `is_active = 0`, and
  every grading path already reads `is_active = 1`. `approval_status` ('approved' by default, so every spec
  QA typed in keeps meaning what it meant) is only what tells a draft apart from a **retirement**, since
  `DELETE /specifications/:id` also sets `is_active = 0`.
- **A number is seeded only where a published standard gives one that doesn't depend on the item.** Gluten
  20 ppm (FDA gluten-free threshold); USP <2021> counts for oral products containing raw material of natural
  origin. **Heavy metals get NO number** — USP <2232> sets a limit per *daily dose*, and converting it needs
  the item's serving size, so the requirement is written out and the figure is typed in at approval time
  (`limits` on the approve call). Seeding a plausible ppm figure someone rubber-stamps would grade real
  product against a number nobody chose. Potency, minerals, moisture and probiotic counts are absent
  entirely — those are decisions about the product.
- **Discard never deletes.** The row surviving as `approval_status = 'discarded'` is both the record that the
  spec was offered and turned down, and what stops the seeder re-filing it next deploy (idempotency is on
  item + test across *every* status).
- **Seed ordering:** `seedGenericSpecifications` must run **after** the COA seed block in server.js — it
  works from items the plant has sent to a lab, and on a fresh DB that table is empty until then. It was
  first placed with the other seeds and filed zero rows.
- API `GET /coa/specifications/drafts` (bounded; `items` derived from the returned rows so a truncated page
  can't render empty groups, `total` is the honest count) + `POST .../drafts/approve|discard`.
  UI `DraftSpecsReview.jsx`, an amber strip at the top of the Specifications tab.

## Internal Audits — Form 403-01, walked one question at a time
`server/audit-checklist.js` (the form) + `server/api/internal-audits.js` + `InternalAuditsPanel.jsx`.
19 sections, **104 questions**, transcribed from the plant's own controlled form.
- **The wording is VERBATIM, typos included** ("All spay bottles are clearly identified", "kept off the
  grown", "Testing specifications are outline"). An auditor comparing the app to Form 403-01 must find the
  same questions; correcting the text here would make the app disagree with the approved form, and fixing
  the form is a Document Change Request. Same reason the checklist is **not user-editable** — changing what
  an internal audit asks is a document change, like `scale-forms.js` tolerances.
  `checklist_revision` is stamped on every audit, so a record always says which revision it was run against.
- **Picking sections IS the record of scope.** A real audit covers two or three areas — on paper the auditor
  drew a diagonal line through the sections they skipped. Only the picked sections get `internal_audit_items`
  rows; the rest are simply absent, and the PDF says "sections not listed were not in scope". Auditing
  nothing is refused. Dropping a section mid-audit is refused once anything in it has been **answered** —
  deleting answered items would erase evidence.
- **Two ways through the same items, in the same order.** Walkthrough (one question, big buttons, resumes at
  the first unanswered) and Full checklist (filterable). Both — and the PDF — iterate the checklist's
  **print order**, never the order sections were ticked, or two people comparing them think they're
  looking at different records.
- **A not-compliant answer raises a CAR in the existing `capas` register** (`source_type = 'Internal Audit'`),
  not a private findings list; its status is read live by the join, and a second raise on the same item is
  idempotent. Same "one register" rule as meeting actions → work orders.
- **Sign-off is refused while any item is blank** — an audit filed with blank questions reads later as if
  those areas passed. Revoke (signer or admin) to correct, then sign again.
- **The monthly cadence is seeded as a Quality Schedule** ("Internal Audit (Form 403-01)"), because their own
  checklist says internal audits are performed monthly — the plant's document, not a preference.

## Meetings (`server/api/meetings.js` + `MeetingsPanel.jsx`)
Management review and the food safety team meeting are SQF records, so this is a controlled record and not a
notes app. `meetings` + `meeting_actions`; nav entry in **Quality**; module id `meetings`.
- **An action item IS a work order.** `meeting_actions` stores the wording as minuted plus the link; the
  status is read live off `work_orders` by the join in `actionsFor()`. A second to-do list that quietly
  disagrees with Task Center is the duplication the Operator View clean-up removed — don't reintroduce it.
  A due date is therefore **required**: an action without one reaches nobody's task list, so it's a note.
- **Attendance is marked, never assumed.** Everyone starts `present: false` and someone ticks who was
  actually in the room; who was invited and who came are different facts and an auditor asks for the second.
- **Approved minutes are closed** to everyone but an admin (`permissions()` stamps `can_edit` /
  `edit_block_reason` on every record the API returns — the client renders what it's told, same rule as
  qms.js). The way back is **revoke** (the signer or an admin), correct, sign again — all three audited.
  Approve is refused with no minutes, and the button is hidden in that state rather than offered to fail.
- **Filing minutes is what moves `scheduled` → `held`**; nobody should have to remember a status field.
  `approved` is only ever reached by signing — `PUT` rejects it as a field value.
- **"Schedule next" carries open actions forward keeping their ORIGINAL work order.** Re-creating the task
  would double it in the owner's list and reset the clock on work already late. Attendance restarts unmarked.
- Meeting types are the **`meeting_types` managed list** and extra questions are custom fields (`meeting`
  scope) — adding "Allergen review" is a Settings task.
- The minutes PDF goes through `richBlocks`, so it matches what the author saw, and stamps DRAFT until
  approved.

## Bringing ~100 controlled documents up to date from the finalised paper
Document Control's real job right now isn't *creating* documents — it's updating the ones already in the
registry. **Update from file** (Controlled Documents header, `canEdit` only) → `RevisionUploadModal` →
`POST /documents/propose-revisions` (multi-file) → per-file **proposal** → `POST /:id/apply-revision`.
- **The proposal endpoint writes nothing.** It reads each file, works out which registry row it is, and
  returns a field-by-field diff. Every change is a tick box and **nothing is applied until it's ticked** — a
  scanner confidently overwriting a controlled document is exactly the failure Document Control exists to
  prevent. Applying snapshots the previous revision into `sop_versions` first, then sets only the ticked
  fields, and audits which ones.
- **`matchDocument()` matches on document number, falls back to an exact title, and otherwise says it
  couldn't.** Attaching a revision to the wrong document is worse than asking a human which one it is, so
  there is no fuzzy match. An unmatched file is reported with what was read out of it.
- **The body is reported as a size delta, not a character diff** ("1,351 characters on file → 461 from the
  upload"). Nobody reads a word-level diff of a whole SOP; the point is "the body changed, look at it". Its
  tick box is the one people most often want off — the revision and effective date are the update, the body
  is often a worse copy of what's already keyed in.
- **The filename's revision suffix is not part of the title.** Document Control names its files
  `…_Food_Safety_Policy_Statement_V4.pdf`, and `guessMeta` derives the title from the filename — so uploading
  V4 proposed renaming the document to "Food Safety Policy Statement V4", and V5 would have renamed it again.
  A trailing `v`/`rev`/`version` + number is stripped; a title that genuinely ends in a number
  ("Allergen Control Program 2") is left alone.
- The doc-number regex is shared with the PDF importer and lists **longest prefixes first** — `POLICY`/
  `PROTOCOL` before `POL`, or those two get truncated and never match by number (they never did).

## Auditor View: process maps (`src/data/processFlows.js`)
Two shapes, one chapter: **FLOWS** answer "show me your process for X" — a record's life from the event that
starts it to the signature that closes it, naming the form and the actor at each step; **DEPARTMENTS**
answer "what does this team do" — what they own, sign and are scheduled for.
- **Data, not drawings.** `ProcessFlows.jsx` is a small renderer; adding a flow is an entry in the data
  file. Rendered as structured HTML rather than SVG so it stays readable at any width, prints, and can be
  selected and copied — a picture that has to be zoomed on a laptop in a conference room is worse than a
  clear list with the hand-offs made obvious.
- **`branch: true` marks a path that only runs when something goes wrong** (a failed tasting, a correction,
  an excursion). It's indented and labelled, because folding the exception into the happy path is how a
  process map ends up describing something the plant doesn't do.
- **Actors are ROLES, never people** — the map shouldn't need editing when someone changes job.
- Keep the wording matched to what the app actually does. A map describing an aspiration is worse than none,
  because an auditor will test it against the records.

## Auditor View: reading and printing the actual document
The registry showed only the row — number, title, revision, status. An auditor asking for SOP 401 wants the
document, and sending them to another screen is where a self-service binder stops being self-service.
- Clicking a registry row opens `DocumentViewer` (AuditorView.jsx): metadata header, the document body, and
  a link to the source file when there is one.
- **`MarkdownView` moved to `src/components/common/`** and is imported by BOTH DocumentRegistry and the
  Auditor View, so an auditor sees a document exactly as Document Control does. A second renderer would
  drift, and the first sign of the drift would be an auditor reading something that isn't the approved text.
  It renders React nodes, never innerHTML — document bodies are operator-edited text.
- **Print opens a clean window**, not the app styled for print: an auditor asking for a paper copy should
  get the document, not a screenshot of software. The header carries doc number / revision / effective date
  and the footer stamps *"uncontrolled when printed — verify the revision against the registry"*, which is
  the thing that stops a printout becoming a shadow copy.

## Pre-launch cleanup (`server/cleanup.js` + Settings → Cleanup Review)
Closing out what was filed before the plant was really using ReadyDoc. **Nothing is deleted and nothing is
signed** — a deleted task is indistinguishable from one that never existed (exactly the gap an auditor asks
about), and back-dating a QA signature onto a shift nobody reviewed would be a false record, which is worse.
- Work orders close as **`cancelled`** with the reason in `notes` + `completed_by`/`completed_at`.
- Production entries are **WAIVED, never signed**: `qa_signoff_by` stays NULL forever and
  `qa_waived_at`/`qa_waived_by`/`qa_waived_reason` say who closed it and why. **Every "pending QA" query must
  carry `AND qa_waived_at IS NULL`** — qa-review.js (count + pending), compliance.js notifications and
  production.js `entries_pending_qa`. Miss one and waived entries sit in that queue forever.
- A reason is mandatory (≥3 chars) and goes on every record; closes are audited **individually** plus one
  summary row, so a bulk action leaves the trail a manual one would.
- Admin-only: it closes compliance records in bulk and shouldn't be one mis-click from a supervisor clearing
  their own queue. Two steps on purpose (counts → work one pile with rows visible); no "clear everything
  before this date" button.
- Adding a source = one entry in `SOURCES` (`stale`/`count`/`close`), same shape as qa-review.js.
- Verified: 13 entries waived with 0 signatures written, 25 work orders cancelled with reasons, the QA Review
  production count and the pending-QA notification both dropped to zero, re-closing a waived record is
  refused, and a fresh DB boots with the columns + index.

## QA Review Center — one queue, seven sources
`server/qa-review.js` is the registry: one `SOURCES` entry per pile of records waiting on a QA signature
(production entries, QA inspections, cleaning records, scale verifications), each with `pending`/`count`/
`sign`/`canSign`. `server/api/qa-review.js` exposes `GET /api/qa-review` (counts for every source + rows for
the selected one, bounded, **oldest first**) and `POST /api/qa-review/sign` `{source, ids}` (batched, but
per-record — a partial failure reports `failed[]` rather than rolling back real signatures). UI:
`QAReviewPanel.jsx`, nav entry `qa-review` at the top of Quality, gated by `canSeeQaReview` (QA/quality dept,
supervisor, admin, or explicit grant).
**Signing here calls the module's own function — it never writes the columns itself.** `verifySanitationRecord`
(sanitation.js), `signOffProductionEntry` (production.js) and `verifyScaleCheck` (scale-verification.js) were
extracted for exactly this, and each module's route now calls the same function. One place writes a
signature, one audit shape, whichever door QA came through. If a new source needs sign logic, put the logic
in the module and call it from here.
The production adapter adds an **already-signed guard** the module route doesn't have: the Production Log only
offers its button on unsigned entries, but a queue can be worked by two people at once and a stale row must
not overwrite someone's signature.
**Deviations, non-conformances, on-hold records and disposals are deliberately excluded** — those are
multi-party approvals with an e-signature intent statement, and approving one is a decision about product
that belongs on the record beside the investigation, not on a checkbox in a list.
**The SIGN-OUT logs are in** (Equipment/Tool/Chemical 703-01, Knife 440-02, Component 418-02): "the tool came
back and its condition was good" is exactly the routine counter-signature a queue is for, and it was the bulk
of what QA was looking at with no way to see it. They reuse `BULK_APPROVE`'s **`routine`** rule from qms.js
rather than a second, looser one — a record that fails it (bad condition, still out) is never offered as a
checkbox and must be opened and signed deliberately. Signing goes through `signQmsApproval()`, the same
function the module's own button calls, so a queue signature is byte-for-byte the module's signature.

## Pay Tracking: the link is the identity, the name is a label
A roster row carries both `user_id` and its own `name`, and `pay_employees.name` is UNIQUE — so renaming
someone in Settings left the roster showing the old name **forever**: `/pay/sync` matches by name and
deliberately skips already-linked rows, so there was no path back (Josefa → Debora). `withLinkedNames()` now
reports the linked person's **current** name and keeps the old one in `renamed_from`, since that's what the
historical `pay_rate_history` rows were filed under. The sync report gained `renamed` (already linked, since
renamed) and `candidates`, and `POST /pay/employees/:id/link` is the action the unmatched list was missing —
an unmatched list with no button was the actual complaint, not the matching.

## Newsletter header covers (the "make it not read like a policy doc" ask)
`server/newsletter-covers.js` is the gallery: 16 covers grouped Seasons / Holidays / Celebrations /
Powder Ops, each a gradient plus a motif (burst, confetti, dots, waves, stars, sparkle, leaves, flakes,
lights, stripes). **They're drawn, not photographed** — no licensing, no megabytes of assets, and no second
copy of each image for the PDF. `months` drives the "Good for this month" row and the cover a new issue
starts with.
**One definition, two renderers.** The module emits plain geometry (circle / line / poly) in a fixed
1000×300 viewBox; `CoverArt` in `NewsletterBanner.jsx` draws it as SVG and `drawCover()` in
`api/newsletter.js` draws the same numbers with pdfkit. The vocabulary is deliberately tiny so neither
renderer needs a special case, and the preview is genuinely the same picture as the download.
Shapes come from a **seeded PRNG keyed on the cover id** and are cached — a cover looks identical every
render, so the fireworks don't rearrange between the preview and the PDF.
`newsletter_issues.banner_cover` / `banner_image_id`: a built-in cover OR an uploaded photo, never both —
setting one clears the other. Uploads reuse the existing `newsletter_images` + R2 path; `GET /issues/:id`
returns a presigned `banner_image_url` because the editor needs something it can put in an `<img>`.
`GET /newsletter/covers?month=` serves the gallery with shapes included.

## Newsletter: a page people read, PDFs people print
**A PDF cannot have a language toggle** — it's a static file, so whichever language it was rendered in is
what every reader gets. The toggle is a *page* behaviour, so `/newsletter/<id>` (`NewsletterReader.jsx`,
routed in App.jsx after the auth gate) is what #announcements links to, and the PDFs are the download for
printing and posting on the board.
- **`localizeIssue(issue, lang)`** in `api/newsletter.js` is the single translation path: `GET
  /issues/:id/read?lang=` and `renderPdf()` both call it, so the page and the download say the same words.
  Translating again on the client would drift, and the drift only shows up once the issue is already out.
  `translation_available` reports `aiEnabled()` so the page can say "showing English" instead of leaving
  someone wondering why ES did nothing.
- **Share posts BOTH PDFs** (EN + ES) plus the reader link in one message — everyone gets their language
  without asking, and the printed copies exist in both anyway. Spanish is skipped only when AI is off, since
  it would just be a second English file under a Spanish name. The link uses **`readyDocOrigin()`**, never
  `appBaseUrl()` — the launcher host would bounce it.
- `coverPayload()` takes the cover **object**, not its id (`getCover(id)` first) — the reader endpoint 500'd
  on exactly that.

## One formatting grammar, two renderers (`shared/rich-markup.js`)
`*bold*` `_italic_` `__underline__` `~strike~` `` `code` `` `- bullet` `1. numbered` — the grammar the comms
composer has always used, now defined **once** in `shared/rich-markup.js` and imported by **both** the browser
and the server. A second copy would drift, and the first sign of the drift would be a PDF that doesn't match
what the author saw in the editor. `parseRuns()` (one line → styled runs), `parseBlocks()` (text → `p` / `ul` /
`ol` / `spacer`), `hasMarkup()` (lets a caller skip the styled path entirely), `toPlainText()`.
- **Browser:** `<FormatBar>` writes the markers into a plain `<textarea>` (the stored value stays plain text —
  chat renderer, translation, search and the PDF all still get what they expect); `<RichText>`
  (`src/components/common/RichText.jsx`) renders `parseBlocks` output as HTML.
- **Server:** `server/pdf-rich.js` `richBlocks(doc, text, baseFont, options)` is the drop-in for `doc.text()`.
  It **composes with `pdf-emoji.js` rather than replacing it** — style picks the Helvetica face
  (`Helvetica-Bold` / `-Oblique` / `-BoldOblique`, `Courier` for code), emoji overrides the font for its own
  characters, so a bold line with a 🎉 in it works. Bold inside an already-bold heading stays bold instead of
  cancelling. A non-Helvetica base font is left alone (better to lose the italic than swap someone's font).
  Same `continued` rule as pdf-emoji: chain runs **within a line only**. Lists draw the marker chained to the
  text with a hanging indent (`listIndent`, default 14).
- **Wired:** the whole comms composer stack, and the Newsletter — intro + every section body get a `FormatBar`
  and a live `FormattedPreview` (shown only when `hasMarkup()`), and all four newsletter PDF text calls go
  through `richBlocks`. Text with no markup takes the plain path untouched, so wiring this into another export
  can't change how existing documents lay out.

## Emoji in generated PDFs
`server/pdf-emoji.js` + `server/assets/NotoEmoji-Regular.ttf` (OFL 1.1, licence beside it). pdfkit's built-in
Helvetica is **WinAnsi — 256 characters, no emoji**, so `doc.text('Welcome! 👋')` wrote the raw UTF-16 bytes
and the viewer read them as Latin-1 ("Ø=ÜK"). Nothing was lost on the way in; the font had nowhere to put it.
`richText(doc, text, baseFont, options)` is the drop-in for `doc.text()`: it splits the string into plain and
emoji runs and draws the emoji runs in the bundled font. **Text with no emoji takes the original path
untouched**, so wiring it into another export can't change how existing documents look.
- **Monochrome on purpose.** PDF cannot draw the colour bitmap fonts phones use (CBDT/sbix) — a colour emoji
  font embeds as blank boxes. Outline emoji print correctly everywhere.
- **`continued` and `\n` do not mix.** pdfkit carries a continued run's x-offset into the next line, which
  indented everything after an emoji halfway across the page and overprinted the following heading. So
  `richText` splits on newlines first and chains runs only *within* a line; a blank line is a `moveDown()`.
- Grapheme clusters are matched whole — ZWJ sequences (👨‍🍳), skin tones, flags, keycaps — so an emoji is
  never split across two fonts. `©`/`®`/`™` are deliberately left to the body font.
- Only the newsletter is wired up. The other pdfkit exports (COA, QMS, disposals, documents, pay) still have
  the raw-bytes behaviour if someone types an emoji into them; `richText` is the fix when that comes up.

## Badges go stale unless a module says so (`src/lib/dataChanged.js`)
Every module badge and the bell count come from **one** endpoint, `/compliance/notifications`, fetched in
App.jsx with `useApiGet(..., [activeTab, user?.id])` — so it refetched **only on navigation**. Clear six time
entries and the number sat on its old value until you left the module and came back; the work was done, the
app just never asked again. A **every successful non-GET through `hooks/useApi` fires `notifyDataChanged()`** — central, so a module (and
any module added later) gets live badges without anyone remembering. App also refetches on
`visibilitychange` → visible, since someone else's work moves the same numbers while you're in another tab.
Deliberately a payloadless, 300ms-coalesced event: the badge query is server-side and cheap (~4ms at
production row counts, measured), and a module shouldn't have to know which of its writes feeds which badge.
- **`NO_BADGE_PATHS` (`/comms/`, `/ai/`) opt out** — chat messages, read receipts and cached translations are
  writes by HTTP method only, they feed no compliance count, and they happen constantly. Note the asymmetry
  that makes a skip list safe here: getting it wrong costs a few extra 4ms GETs, while forgetting to opt a
  module IN is the bug this replaced. So the default is on and the list stays short.
- The two `/comms/` endpoints that really do create records — **`to-task`** (work order) and **`to-record`**
  (qms_record) — call `notifyDataChanged()` at their call sites. Add to that list, not to the skip list, if
  another comms endpoint starts writing outside chat.
- `apiUpload` fires it too (attaching an SDS clears "chemical missing SDS").
**Don't add per-module calls** for ordinary writes — they're redundant now and invite two mechanisms doing
one job.

## Bulk edit in a log (the Monday.com shape)
Time Tracking's log is the reference. Tick the left-hand boxes → a bar above the list shows the count and the
actions (Mark reviewed, ADP Pending / In ADP / N-A, delete). Three rules worth keeping when copying it:
- **The selection only covers rows currently visible** (`visibleIds` is the *filtered* list), so a row hidden
  by a filter can never be changed by something you can't see. "Select all" means all filtered.
- **Shift-click ticks the range** from the last box you touched, and the span takes the state the clicked row
  is moving *to*. Clicking twenty boxes one at a time is where people go back to the spreadsheet.
- **A per-row control acts on the whole selection when that row is in it** (`rowScope()`/`scopeNote()`) —
  someone who ticked six lines and then clicks one row's ADP pill means all six, and changing one while
  silently leaving five looks from the screen exactly like nothing happened.
Server side: `PUT /office/time/adjustments/bulk` and `POST .../bulk-delete` are one transaction but audit
**each** record individually — a bulk edit has to leave the trail a manual one would.

## Hours as h:mm
`src/lib/hoursFormat.js` (`parseHours`, `formatHours`, `hoursInputValue`). Time Tracking → Hours is typed and
read as **39:56**; storage stays **decimal** because every downstream number (weekly target, overtime, the
paid-non-working balance, period totals, payroll export) is arithmetic on it. Entry stays forgiving —
"39:56", "39.93" and "39" all work. The input must be `type="text"`: a number input rejects the colon and no
phone keyboard offers one.
The Hours roster sorts **by last name**, in JS with `Intl.Collator`, not `ORDER BY name` — it's the payroll
tab and gets read against ADP, which lists people by surname. Two traps it handles: SQLite's default
collation compares raw bytes, so accented names (Ángel, Óscar) sort after every plain-ASCII name (this is
what made an already-sorted list look unsorted); and `lastNameOf()` drops a trailing suffix so "Robert Smith
Jr." files under S. The surname is the **last word** of `users.name`, the same rule `server/usernames.js`
derives sign-in names with, so Spanish two-surname names file under the maternal surname in both places —
where someone goes by the paternal one, correct it on their record rather than special-casing the sort. The
column header says "by last name" because the names still display first-name-first.

## Temp & Humidity excursions alert Adam (`server/env-limits.js`)
Completing the daily Temp & Humidity check (Form 110-04) with an out-of-range reading DMs Adam through
ReadyBot and pushes to his phone, hooked onto `complete-and-recur` in pm.js — the one path where an operator
actually enters the numbers.
- **Humidity alerts at 39%, one point BELOW the procedure's 40% limit.** That gap is the point: an alert
  that only fires once the limit is breached is a report, not a warning. `exceeded` distinguishes
  "approaching" from "out of range" so the message says which. Temperature alerts at its limit, 78°F.
- **A blank or unparseable reading never alerts** — that's a gap in the record, not an excursion, and
  crying wolf on it is how people learn to ignore the alarm. Readings are text from a phone keypad, so
  `"41 %"` and `"78F"` parse.
- Targets Adam by name, falling back to QA admins/supervisors so a rename or an absence can't silence it.
- **Best-effort and never blocking**: the reading is already recorded before the notification runs, so a
  comms failure can't fail the check. Audited as `environmental_alert` with the readings and who was told.
- Limits are acceptance criteria, not settings — not editable in the app, same reasoning as `scale-forms.js`
  tolerances. If they should be gated by Document Control like those are, add them to `controlled.js`.
- Only the work-order path is covered. A temp/humidity record filed straight into Sanitation stores its
  numbers in free-text notes and is not parsed.

## Recurring QA checks that ship pre-scheduled
`SEED_SCHEDULES` in `server/api/quality-schedules.js` + `seedQualitySchedules(db)` (called from server.js).
Seeded **once, keyed on title** — an edited frequency, a paused schedule or a deleted one is a decision, and
a redeploy must not undo it. Currently: **Tap Water Testing** (monthly, Environmental Monitoring — restroom
and kitchen samples to the outside lab) and **Air Testing (Settle Plate)** (annual, same module — Petri-dish
air quality). The sampling points are left to the schedule's own steps rather than assumed, and the annual
cadence is the one the plant asked for. Everything else stays user-created in Quality Schedules.

## ReadyDoc feedback ("Request" button) — REMOVED 2026-08
The Request button, the Settings triage pane, `server/api/requests.js`, `RequestBox.jsx` and the ReadyBot
stale-request nudge were all removed at the user's request — the plant runs app feedback through a comms
channel instead. The `app_requests` table stays in db.js (rows filed before the removal survive), but
nothing reads or writes it. Don't rebuild this without being asked.

## Three counts that must agree (and one that never fired)
- **A sign-out log's badge counts what QA can ACT on.** The generic QMS badge is "any required approval
  missing", which on the three sign-out logs includes items *still signed out* and returns in bad
  condition — nobody can counter-sign those yet. That put 46 on the Equipment tab while QA Review, which
  only offers **routine** returns, showed a different number on the same screen. `compliance.js` now reads
  `safeCount(getSource('sign-out-equipment'|'sign-out-knife'|'component-pulls'))` from **qa-review.js**, so
  there is one definition of "waiting on a signature"; the remainder travels as an `info` badgeDetail line
  ("N still out or needing attention") so the number that disappeared is explained. Note "Out now" (25) is a
  third, different question — what is physically checked out — and is not a badge.
- **A 72-hour re-clean raises its own task.** It used to wait for a supervisor to press *Assign*; until then
  the only trace was a badge on Sanitation, which the cleaner may not even have — so the one person whose
  job it was never saw it. `generateRecleanTasks()` (sanitation.js, hooked into `runPmHousekeeping`) creates
  the `task_group = 'cleaning'` work order itself, idempotent on `flag_key` (the key changes only when the
  last clean or last use changes, so one open task per flag and a new one only when the room is dirtied
  again). Dismiss / N-A / not-in-use **cancel** that task, so a cleaner is never left holding a job a
  supervisor already stood down. Because housekeeping is throttled to once per 5 minutes, a newly flagged
  room appears within that window, not instantly.
- **Comms downloads go through our own origin.** The presigned R2 URL is a different origin, so
  `<a download>` is ignored and the blob-fetch workaround needs a CORS rule on the bucket; without one the
  fetch throws and the fallback opens a tab — which is exactly what "download behaves like open in a new
  tab" looks like. `GET /api/comms/attachments/:id/download` streams the bytes back after the channel
  access check. `url` (presigned) still RENDERS the image; `download_url` is what a Download button uses.

## Scale verification: the procedure is on the form
`SCALE_PROCEDURE` in `server/scale-forms.js` — the plant's own Scale Calibration Verification sheet, one
copy for all five forms because only the three weights differ and the form already knows those. Served with
`/scale-verification/forms` and the public `/submit/scale-forms`, rendered by
`src/components/common/ScaleProcedureCard.jsx`: open by default in the kiosk (where the check is actually
run) and collapsed in the Calibration tab (a log, not a form). The card substitutes **this form's** weights
into the steps — "add the MAXIMUM (75 kg)", not "add the third weight". Not editable in-app, same reason as
the tolerances.

## Rooms: one vocabulary, and a room per TASK
`ROOM_GROUPS` / `PRODUCTION_ROOMS` / `RETIRED_ROOMS` in `constants/productionLines.js`. The schedule and the
Production Log each used to keep their own room list and had drifted badly: the schedule had dropped Room 8
and gained Batching 3 and the half-rooms (1.2 / 4.1 / 4.2), while the log still offered Room 8, had never
heard of Batching 3, and listed rooms 0 and 9–14 that nothing is ever scheduled in — so a shift could be
scheduled in a room it could not be reported in. The **grouping** is vocabulary and lives in the constant;
the **colours** the schedule paints each group with stay in ProductionSchedule (`GROUP_STYLE`).
- **Room 8 is retired, not deleted.** It isn't on the facility map and what ran there is Batching Room 3.
  `RETIRED_ROOMS` is offered in the log's Room **filter** forever but never on a new entry — a filed record
  you can't filter to reads as deleted. It is an **explicit list, not derived from the loaded rows**: the log
  fetches a date window, so inferring it from the data looks like it works and silently fails for a shift run
  last spring. The schedule's `unplaced` banner is the same idea for assignments.
- **The amend form keeps a retired value selected.** A `<select>` whose value isn't among its options falls
  back to the first one, so amending a Room 8 entry's notes would have silently moved it to Batching 1.
- **A shift is not one room.** `mo_lines[].room` and `cleaning_events[].room` — Bernardo blends one MO in
  Batching 1 and the next in Batching 2, and one shift-level answer filed the second in the wrong place. New
  cards default to the shift's main room (usually right) and can be changed. Blank means "same as the shift"
  and is left blank rather than back-filled, so the record doesn't claim a room nobody chose.
- **`production_entries.room` stays but is DERIVED, not asked for.** It's NOT NULL and every filter, KPI,
  `computeMetrics`, the missed-report matcher and the facility map read it — so it still holds one value, but
  for multi-MO teams that value is **the first run's room** (line 0, the same mirroring rule as
  product/MO/lot), falling back to where the cleaning was on a clean-only shift. There is no shift-level room
  input on the Batching form at all; a read-only *Rooms* line lists every room the shift touched. Filled
  **only when absent**, so single-MO teams and deliberate overrides still win, and an entry with no room
  anywhere is refused rather than filed blank.
- **A new MO or clean card starts in the room the last one was in** — most work continues where it was, and
  with no shift-level room there is nothing else to inherit. Blank means blank; nothing is back-filled.
- The log's Room filter matches the scalar **or any line's or clean's room**, or the Batching 2 half of the
  day would be invisible to anyone filtering for Batching 2. `dayLogToEntry` applies the same fallback, so a
  day log can never produce an entry with no room at all.

## FORM 431-01 is a controlled document, not just a file
The Brittle Plastic & Glass diagram is seeded into `sop_documents` (`FORM 431-01`, V4) pointing at
`/forms/FORM-431-01-V4-Brittle-Plastic-and-Glass-Diagram.pdf`. The **file** stays in `public/forms` on
purpose — it must open with no R2 configured — and the registry row is what gives it a revision, an owner
and a review date. The **item lists** it documents remain editable in-app as one `pm_schedules` row per zone
(`item|qty|material`), with zone names in the `bpg_zones` managed list; re-issue the drawing through
Document Control when the picture itself changes.

## A clean that was done but couldn't be logged
`performed_at` used to be "now" and unsettable, so a cleaner locked out of her account for a few days had no
way to record work she had actually done. `POST /sanitation` now accepts `performed_at`, under two rules:
**never in the future** (that would be a record of something that hasn't happened), and **more than a day
back needs a reason**. Both dates are stored — `entered_at`, `entered_late`, `late_entry_reason` — and the
`LateChip` shows "entered late" wherever the record appears. **Back-dating is only safe when it is visible:**
a late entry that looks identical to one filed on the day is a false record; one carrying both dates and a
reason is the honest account, and is what an auditor expects.
**Filing a passed clean closes the 72-hour re-clean task for that area** (`closeRecleanTasksFor`). Without it
the cleaner does the job, files the record, and the task sits in her list anyway — so she either leaves it
open or completes it separately and the two records disagree about when the work happened. The clean IS the
completion.

## Document Control Review Center (`server/doc-review.js` + `api/doc-review.js` + `DocReviewPanel.jsx`)
Daniela's "what do I owe today", same registry shape as `qa-review.js`: four sources, each with
`count`/`pending`/`canAct`, and marking a document reviewed calls documents.js's `recomputeDocumentReview`
rather than writing the columns here. Nav entry at the **top of Document Control**, gated by department the
way Controlled Changes is (not by a module grant).
- **Not every pile is batchable, and the screen says so.** A source declares `action` only when it genuinely
  has one. Documents past review date do ("I've read it, it's still correct" is what a review date asks for);
  a parked Controlled Change, an open DCR and a draft document do **not** — those are decisions that belong
  on the record, so those tabs show the list and a way through instead of a button that can't finish the job.
  Same reasoning that keeps deviations out of QA Review.
- **"Open DCR" means raised SINCE GO-LIVE and still unsigned.** The 180 rows imported from the paper register
  carry no status and no approvals — they are a history of changes already made, not a queue, and a tab
  reading "180 open requests" is the same inflated number the sign-out badges used to show. `GO_LIVE_DATE` is
  exported from db.js for this (the same cutoff `archivePreSystemBacklog` uses). Note the generic QMS badge
  on the DCR tab still counts all of them — worth aligning next.

## Facility Map (`src/data/facilityMap.js` + `server/api/facility.js` + `FacilityMapPanel.jsx`)
The plant's own floor plan, redrawn as **data** and coloured by what ReadyDoc knows. Nav entry in Quality.
- **Geometry on the client, facts on the server.** `facilityMap.js` is a drawing — `PLAN` (1000×410 viewBox),
  `ROOMS` (x/y/w/h + `kind` + `room`, the name the *records* use), `SPANS` (the wall dimensions off the
  drawing), `FIXTURES` (hand wash / mop sink / extinguisher / eye wash), `TRAPS`, `BPG_ZONE_AREAS`.
  `GET /facility/map-status` returns only the live facts, keyed on that `room` name, so **nothing needed a
  new column** — the map reads the records that already exist.
- **The 72-hour answer comes from `recleanRooms()`, never recomputed here.** The panel also renders
  `hours_since_clean` from the server rather than a client `Date.now()`; two clocks is how a map and a module
  start disagreeing about whether a room is due (and `Date.now()` in render is a compiler lint error anyway).
- **Layers, not one busy picture**: Cleaning status / Sinks & extinguishers / Pest control / Brittle plastic
  & glass, plus "Show all (paper view)" for a printout that matches the wall copy. **The legend describes
  whatever colouring is actually on** — showing the room-kind key while the map is coloured by cleaning
  status describes a scheme that isn't on screen.
- **A room with no `room` key is drawn but has no status** — offices, the gate, racking. That's honest: the
  cleaning log has never had a record for them, and colouring them "clean" would invent one.
- `TRAPS_UNPLACED` names the rodent stations on the legend whose position isn't readable from the drawing
  (9, 10, 11, 13). Listing them as unplaced is the record that they exist; guessing a coordinate on a pest
  control map would be worse than saying where the map stops.
- The three racking blocks are labelled **Warehouse 1/2/3** to match their BP&G zones — the zone is the whole
  reason someone opens that layer, and an unlabelled rectangle carries none of it.
- Zone item lists on the BP&G layer are the same `pm_schedules.procedure_steps` (`item|qty|material`) the QA
  Inspections module uses, so adding an item to a zone shows up here with no second edit.

## Mobile: what actually broke, and the two rules that catch it
Everything is checked at **360px** (a small Android), not just 390 — the last 30px is where a row that
"nearly fits" starts panning the whole page sideways. Two classes of bug, both found this way:
- **A `shrink-0` row that can't wrap.** The Schedule toolbar (Progress / Notify / **Share**) ran off the
  right edge at 360px and took the page with it, with Share the button you couldn't reach. It wraps below
  `sm` now and keeps `sm:shrink-0` so the week heading can't squeeze it on desktop. The Training tab strip
  was 6px over — a tab strip is the one place a deliberate `overflow-x-auto` scroller is right, because
  wrapping would break the underline onto two rows.
- **A wide SVG in a scroller.** `min-w-[680px]` on the Facility Map meant a phone saw the left half of the
  building and had to scroll inside the card to find the rest. See below.
**The test is `document.scrollWidth > window.innerWidth`** — measured with a script that walks the DOM for
elements sticking out past the viewport and *ignores anything inside an `overflow-x: auto` parent*, so a
deliberate scroller doesn't read as a bug. Run it on new screens.

### The Facility Map on a phone
- **Fit to width by default, Zoom to read the labels.** Half a building is worse than all of it small.
- **Fit-to-width makes the rooms ~7px tall, so the map stops being the only control.** The compact layout
  gets the same rooms as a **tappable list grouped by cleaning status** underneath — that's how you reach a
  room on a phone; pinching a floor plan is not a workflow. Desktop keeps just the map (`md:hidden`).
- **The detail panel moved directly under the map** on every layout and scrolls itself into view on compact.
  Tapping a room at the top of the plan and having the answer appear two legend blocks below reads as
  nothing happening.
- **Every colour on the cleaning layer now means a cleaning fact.** A room with no cleaning data falls back
  to neutral grey instead of its room-kind colour: Batching's kind fill is the *same amber* as "no clean on
  record", so Batching Rm 3 — which the cleaning log has never heard of — was indistinguishable from a room
  overdue its first record. The legend was naming a fact the colour didn't carry.
- `Line` in the detail panel stacks label-above-value below `sm`; a fixed 8rem label beside a ~190px value
  turned one sentence into four ragged lines hanging off an empty column.

`src/lib/useCompactLayout.js` is the **one** definition of the `md` breakpoint for components that need to
*behave* differently on a phone (CommsView's inline copy now imports it). A second copy is how a component
and its own markup start disagreeing about which layout is on screen.

## Retention Samples (`server/api/retention.js` + `RetentionSamplesPanel.jsx`)
The plant's physical library of what it made — a retain of every blend, intermediate and finished good, plus
90 g of every raw material received. Transcribed from their own Retention Sample log. Nav entry in Quality;
module id `retention-samples`.
- **Why it is NOT a COA tab** (the question asked directly): a COA request is about a **test**, this is about
  an **object** — a jar with a lot number sitting in box 17, to be destroyed in April 2028. They meet at
  exactly one point, where a pull's lab portion goes for testing, and that point is a link
  (`coa_request_id`), not a merge. Retention also spans **receiving** to finished good: raw-material retains
  come off an inbound pallet and have no COA request at all.
- **Lab and retain are counted separately, always.** The paper writes one cell, `5 (2 LAB, 3 RETAIN)`, but
  those are different objects with different fates — the lab samples leave the building and come back as a
  result, the retains stay until the box is destroyed. A single total cannot answer "did the lab samples
  actually go out", which is the question the log exists to answer.
- **A box has the destruction date, not a sample.** `retention_boxes` (15, 16, 17…) each carry one date,
  because that is how the plant actually disposes of them — a box at a time.
- **Destroying a box never deletes its samples.** The whole point of the log is that it can still say what
  was held and when it went. Destruction needs a reason (≥3 chars), is refused before the due date unless
  `early: true` is passed as a deliberate second act, is refused twice, and closes the box to new filings.
- **`batches` is free text** ("1 & 2", "1 BEG, 1 MIDDLE, 1 END") because that is what the log records, and
  normalising it would lose the beginning/middle/end-of-run detail that makes a stick-pack retain meaningful.
- Filing is open (anyone who pulls samples), correcting someone else's needs QA/admin, destroying needs QA
  leadership or an admin — the same ladder the Receiving Log uses. `retention_sample` is a custom-field
  scope, so extra questions are a Settings task.

## Composer: shortcuts, live formatting, and lists that continue themselves
The toolbar was the only way to mark text up, so everyone who types Ctrl+B by reflex got nothing and
concluded the composer couldn't do it. Three additions, all on the existing grammar — no second parser.
- **`src/lib/useFormatKeys.js`** — Ctrl/Cmd+B/I/U (same `wrapSelection` the toolbar uses), Enter continuing
  a list, Tab indenting one. Exported twice: `useFormatKeys` (hook, one textarea) and `formatKeyHandler`
  (plain factory, for the newsletter's N sections rendered from a `.map()` where a hook per item is illegal).
  It **returns true when it consumed the event**, so a composer runs its own @mention / send logic first and
  only then defers — the mention menu and Ctrl+Enter-to-send both get first refusal.
- **TAB IS DELIBERATELY CONDITIONAL.** Swallowing Tab everywhere traps keyboard users in the textarea — it's
  how you reach Send, and in comms how you pick an @mention. It only indents when the caret is on a list
  line; anywhere else it does nothing and lets focus move.
- **Enter on an EMPTY list item ends the list** rather than adding another bullet, which is what every editor
  does and what stops a list running away.
- **`flushSync`, not `requestAnimationFrame`, before restoring the caret.** The rAF version is wrong for a
  keyboard shortcut: anything typed inside that frame lands at the OLD caret and is jumped over — typing
  Ctrl+B then "Blender 1" without pausing reliably produced `*lender 1*B`, and only for people who type
  quickly. `FormatBar` had the same race (less often, since a click means your hands are off the keys) and
  is fixed the same way. **Commit synchronously, then set the range.**
- **`MarkupOverlay.jsx`** draws the formatting behind the composer: the textarea's text is transparent (the
  caret is not) and a layer underneath renders the same characters styled. The stored value stays plain
  text, which is what the chat renderer, translation, search and the PDF all expect.
  **NOTHING MAY CHANGE A GLYPH'S ADVANCE WIDTH** — the caret and selection are drawn by the textarea, which
  knows nothing about the layer, so one pixel of drift reads as broken. That rules out `font-weight` and
  `font-style`, the two obvious choices: bold is `text-shadow` (thickens without re-laying out), italic is
  `skewX` (a transform never affects layout), underline/strike/code-tint are free. Markers are **faded, not
  hidden** — hiding them would change the width. Verified in the browser: both styled spans measure
  identical to plain, and the overlay box is 0px off the textarea.
- **`COMPOSER_METRICS`** in CommsView is the one string of layout classes both elements use, `border` width
  included (colour set separately, transparent on the overlay) — the textarea's 1px border pushes its first
  character in, and an overlay without one sits a pixel high and left.
- **`parseSpans()` + `listPrefix()`** were added to `shared/rich-markup.js` rather than to the overlay:
  `parseRuns` discards the markers, which is right for a renderer and wrong for a layer that must reproduce
  the typed text character for character. Same regex, same grammar.
- Wired into the comms composer, both thread reply boxes, the newsletter intro + section bodies, and meeting
  minutes. Verified in the browser — 21 assertions across the three modules.

### Marking a setup step "not applicable"
Nobody writes a work instruction for switching on an A/C, and a checklist that can't be told so is one people
learn to ignore — which costs more than the step it was nagging about. `equipment_step_waivers`.
- **A row with a REASON and a NAME, not a hidden flag.** Skipping is a decision, and a decision with nobody's
  name on it is indistinguishable from an oversight six months later. A reason under 3 characters is refused.
- **The step stays on the list**, greyed, reading "Not applicable — <reason>" with who marked it. One that
  vanished could never be questioned or undone. Undo puts it straight back.
- **Waived is neither done nor outstanding.** It comes out of the denominator (`applicable`), so the counts
  never claim work that didn't happen — and the routed notifications stop nagging about it.
- **LOTO is deliberately NOT waivable here.** `equipment.loto_required` is the authority and is read by the
  LOTO module and the compliance badge too; waiving only the checklist step would leave those two still
  counting the machine — the same two-mechanisms-disagreeing bug this module already got bitten by. The
  endpoint 400s and names the checkbox to use instead.

## Log Builder (`server/api/log-builder.js` + `LogBuilderStudio.jsx`)
The supervised copy/edit/approve path in front of the structure engine — the procurement copy/edit shape
applied to log structure. Nav entry in **Document Control** (visible to admins, the DC department, and the
`log-builder` grant — the grant finally means something); the direct editor in Settings stays for admins.
- **Draft = a COPY of the live list or scope**, so the editor starts from reality. Editing and submitting
  touch nothing live; **approval is admin-only** and applies through the SAME engine the direct editor uses
  (`ensureList`, `normalizeFieldDef`), so an approved draft can't do anything the structure rules forbid —
  nothing deleted, keys/values immutable, retired options not revived.
- **Approve is additive only**: options/fields created or relabelled, never removed. Retiring stays in the
  live editor, where the usage counts are.
- **An option's VALUE defaults to its label at apply time** — `ensureList` keys options on the value, and
  two new options with blank values collide on `''` with the second silently vanishing (found by test).
- A duplicate drafted option is deduplicated by the engine rather than erroring — drafting "Break Room"
  when it already exists applies cleanly as a no-op for that row.
- Approved/rejected drafts are closed records of a decision; rejection requires a reason (≥3 chars).
- Verified end to end: 10 assertions with a real non-admin DC user — copy, edit-changes-nothing-live,
  drafter-cannot-approve, both kinds applying on admin approval, closed-draft refusal, reject-needs-reason.

## Scale form units, and snapshot fields that grow (`controlled.js` `upgrade`)
Form 417-01 (Batching Platform) read **kg**; the paper form's diagram weights are **lb**. Two things fell
out of fixing one character:
- **The unit is part of the acceptance criterion** — "25 ± 0.003" means nothing without it — but the
  controlled-change snapshot only tracked `points`, so a unit change would have bypassed Document Control
  entirely while a tolerance tweak waited for approval. `current()` now records `{points, unit}`.
- **A field coming under control for the first time is a BASELINE, not a change.** Old approved snapshots
  lack `unit`, and comparing shapes naively parked all five scale forms as pending — four of them over a
  change nobody made. `entry.upgrade(oldSnap)` lets a definition adopt the missing field into the stored
  snapshot silently (the same doctrine as the first-sight branch). The kg→lb itself went through un-gated
  **deliberately**: the controlled paper document already says lb, so the app was mis-transcribing the
  approved form — there was nothing for Document Control to decide.
- The scale/QA fmt helpers printed the raw stored string (`2026-08-06 12:47`), sidestepping the timezone
  fix — raw slices of `datetime('now')` columns are the same six-hour bug wearing different clothes.

## Timestamps read six hours late (`src/lib/datetime.js`)
SQLite's `datetime('now')` — what most of the schema defaults to — returns UTC as
`2026-08-06 19:27:43`: a space instead of a T, and **no timezone marker**. JavaScript doesn't recognise that
as ISO, so `new Date('2026-08-06 19:27:43')` parses it as LOCAL time. In Utah (UTC−6 in summer) a record
written at 1:27pm displayed as 7:27pm — on audit entries, scale verifications and 26 other render sites.
**The stored values were always correct; only the reading was wrong**, so this is a display fix and no data
needed migrating.
- **`parseServerTime()` handles all three shapes that actually arrive**: SQLite's space-separated UTC (needs
  the `Z`), `toISOString()` output (already unambiguous, and must not move), and a bare `YYYY-MM-DD`.
- **A date-only value is deliberately read as LOCAL midnight.** `new Date('2026-08-06')` is UTC midnight,
  which west of Greenwich renders as the previous evening — the classic "everything is a day early" bug. A
  due date on the wrong *day* is worse than a time in the wrong hour.
- Use `formatDateTime` / `formatDate` / `formatTime` for any column written by `datetime('now')`. A bare
  `new Date(row.created_at)` is the bug coming back.

## Maintenance task text split at its commas (`server/task-text-repair.js`)
The equipment import broke every sentence at its commas, so one task became eight — six of them single
words. `"Examine equipment for signs of damage"` / `"leaks"` / `"loose parts"` … `"and cleanliness."` is one
sentence, and to an auditor it reads as eight maintenance activities. 3,966 entries across 136 machines
collapse back to 1,069 real tasks.
- **The rule is mechanical, not interpretive.** A fragment continues the previous one when it cannot begin a
  sentence — it starts lowercase, or with "and"/"or". That is the exact inverse of splitting on `", "`, so it
  restores the author's words; nothing is rephrased, corrected or dropped. Their typo
  *"Maonthly-Inspect drive motor"* survives intact, the same rule the internal-audit checklist follows.
- **`repairConfidence` decides what is PRE-TICKED, and the threshold is exactly one word.** A one-word
  fragment ("leaks") cannot be a task somebody wrote on purpose. Two words ("check filters") plausibly can,
  so a machine whose fragments are all multi-word is listed but left unticked — pre-ticking those would
  rewrite tasks nobody split, which is the opposite of the point.
- **Preview then commit, with before/after side by side**, because this rewrites the maintenance procedure on
  a compliance record. The whole before and after goes into the audit log, so the change is reversible by
  reading the trail rather than by guesswork.
- **Schedules and open work orders built from those tasks are refreshed too** — otherwise the technician's
  work order still lists "leaks" as a step.

## Equipment manuals, searchable inside (`equipment_files`)
The manual, the spec sheet, the parts list — attached to the machine, stored in **R2** like course materials
and comms attachments, with the text pulled out on upload via the shared `invoice-text.js` so a search finds
a part number printed **inside** the PDF. That is the question people actually have.
- **`extracted_text` is searched, never shipped.** It's megabytes of OCR; the client gets `searchable`,
  `text_status` and a snippet around the hit.
- **A file whose text won't read is still a file.** `text_status` records `ok` / `empty` / `failed` and the
  row says so, rather than letting someone assume a search covered it.
- **Manual search lives on the LIST, not on a row** — "which filter does the auger take?" is a
  cross-machine question. `GET /equipment/files/search` is declared before `/:id` (route ordering).
- **`compareManualToTasks` in ai.js SUGGESTS and never applies.** A machine's maintenance procedure quietly
  rewritten by a model that read a PDF is exactly the compliance record that must not change without a
  person. Every suggestion must **quote the manual** in `evidence` — an unsourced "the manual says grease
  this monthly" can't be checked and therefore can't be acted on — and a frequency is only given when the
  manual states one, otherwise `unspecified` rather than an invented cadence.
- Degrades like every other storage/AI feature: uploads 503 without R2, the comparison 503s without an
  Anthropic key, and the rest of the module is unaffected.

## Equipment setup gaps reach the people who own them
The setup checklist could only be seen by someone who thought to open the Equipment list and expand a row —
the same failure as the 72-hour re-clean badge the cleaner couldn't see. `/compliance/notifications` now
carries the gaps, **routed by department**: Maintenance owns whether a machine generates work at all, QA
owns hygienic design and calibration, Document Control owns the work instruction and the course. Everyone
else sees none of it; a warehouse operator can't act on a missing LOTO procedure.
- It runs the **same `equipmentReadiness`** the panel does, not a faster second copy of the SQL, so the bell
  and the row badge can't disagree. Measured at ~22ms over 179 rows.
- **`pm_assignee` is suppressed when the machine has no schedule either** — a machine with nothing
  generating doesn't yet need a team, and counting both turns one problem into two numbers (163 → 83).

### "Create schedules from these tasks" (single + bulk)
`POST /equipment/:id/schedules-from-tasks` — the practical fix for the 80 active machines that had
maintenance tasks written and nothing generating them. **This is not auto-creation and the distinction
matters:** it is offered only because the frequency is not a guess — the operator already wrote each task
under a Daily / Weekly / Monthly / Quarterly heading, so the schedule carries their own words at their own
cadence. One schedule per frequency, inheriting the equipment's team, skipping any frequency that already
has one (so a second click creates nothing), and **"As Needed" is skipped with a reason** because it has no
interval and inventing one would put a cadence on the record that nobody chose.
**`GET /equipment/schedules-from-tasks/preview` + `POST .../bulk`** are the "review and create for all"
pair — the plant wrote those tasks *expecting* them to be the PM schedule, and ~110 machines were in that
state, so one at a time was never going to happen. `planSchedulesFromTasks()` is the SINGLE planner used by
the preview, the bulk write and the per-machine route: a preview computed differently from the commit is a
preview that lies, and this one is shown before a write across a hundred machines. The preview writes
nothing, an empty `ids` is **refused** rather than treated as "all", each machine is audited individually
plus one summary row, and a machine about to get schedules with **no team assigned** is flagged in the list
(those work orders would reach nobody).

## Retiring a machine, and the two PM generators
`equipment.status` was on the list screen but **not in the edit form**, so the only way to retire a machine
was bulk edit — and `POST /equipment` didn't accept a status at all, so anything added or imported as
already-retired came in `active` and started generating tasks. Both fixed.
- **Out of service generates NOTHING new, from either path.** There are two, and filtering only the obvious
  one does nothing: `POST /pm/generate` is a manual action almost nobody triggers, while
  `markMissedWorkOrders` (inside `runPmHousekeeping`, on ordinary page loads) is what actually keeps the
  list full. Retiring a machine looked like it worked until the next GET put the tasks back.
- **The schedule is left alone, not deactivated** — the machine may come back, and deleting it would take
  the procedure with it. **Open tasks stay open**: somebody may still need to close them out honestly.
- `/pm/schedules` hides schedules for out-of-service equipment (`include_inactive_equipment=true` to see
  them), but asking for one `equipment_id` always shows its own.

### "No PM schedule" on a machine showing thirteen tasks
Two different things share the words *PM schedule*: `equipment.maintenance_tasks` is the task LIST the
detail panel prints under "Preventive Maintenance Schedule", while a `pm_schedules` row is the RECURRING
SCHEDULE that generates work orders. The A/C had 13 tasks written and no schedule, so the screen showed four
frequency cards above a step insisting there was no schedule. The step is now
**"Recurring PM schedule (generates the tasks)"** and reads *"3 tasks written, but nothing generates them"*
— naming the difference instead of restating it. Worth remembering when adding anything else that touches
either field.

## The schedule message people actually read (`shared/rooms.js`)
Publishing the schedule posts a per-team message into that team's channel, and for most of the plant that
message *is* the schedule — they never open the grid. It printed the room as the bare grid key (`• 6 · MO
4471`), which makes the reader work out that 6 is a room at all.
- **`roomLabel()` moved to `shared/`** and is imported by both sides. The client's Share text and PNG had
  labelled rooms for a while; the server's Notify message — the one that lands in channels — still printed
  the raw token. Two copies of a display rule is exactly how that drifts. Batching rooms carry their own
  word, so they are never prefixed ("Batching 1", not "Room Batching 1").
- The team message now leads with the room, gives each day heading its **date** ("Thursday 8/6", so a
  weekday name is never ambiguous), keeps notes indented under their run, and ends with a run count. The
  combined summary lists one team per line and says "nothing scheduled" in words rather than printing a 0.
- Bot bold is `*text*`, not `**text**` — the chat renderer isn't markdown.

## Mock Recall — Form 415-1, from SOP 415 V3 (`server/mock-recall-form.js`)
The table was a reasonable guess at a mock recall; the SOP names **seventeen things the exercise "will
document"** and **three effectiveness criteria**, and most had nowhere to go. A record that can't hold what
the controlled procedure requires is not evidence the procedure was followed — which is the point of the drill.
- **The acceptance criteria are NOT user-editable**, same reasoning as `scale-forms.js` tolerances: the
  99.5–100.5% mass balance and the four-hour limit come from a controlled document, so changing one is a
  Document Change Request. `SOP_REVISION` is stamped on every record (`checklist_revision`), so a filed
  exercise always says which revision it was run against.
- **The effectiveness verdict is DERIVED on every read, never stored as an opinion.** Correct the mass
  balance afterwards and the verdict moves with it; a stored "pass" would go stale. `met` is **null** when
  something hasn't been measured — deliberately distinct from false, since "not measured" and "92%" are
  different states and collapsing them makes a half-run drill read as a failed one.
- **Sign-off is refused while any documented item is blank**, the same rule as an internal audit: an exercise
  filed with empty questions reads later as if those areas were covered. And **a failed exercise needs its
  root cause before it can close** — the SOP requires an investigation, and a failed drill with no
  investigation is exactly the gap the drill exists to find.
- The four **tracking procedures** (distributed / undistributed / ingredient / packaging) are recorded, not
  assumed — an ingredient trace and a finished-good trace prove different things.
- **`RECALL_CONTACTS` is the SOP's list, not the user roster** — it includes the FDA line, which is not a
  ReadyDoc account, and V3's only change from V2 was the QA Manager entry.
- Annual cadence is **reported, not enforced** (`GET /status`): the app can say the plant is overdue, it
  can't run the drill. No signed exercise at all reads as overdue, which is the honest state of a new deploy.
  `recent_products` feeds the SOP's "rotate different types of products at each exercise".
- Filing with Document Control is a fact with a name and a time, not a tick, and is refused before sign-off.
- Verified end to end: 36 assertions including the derived verdict moving when the number changes, both
  halves of the four-hour criterion, sign-off refused three different ways, and the revoke → correct → sign
  path.

## New equipment: what the machine still owes (`server/equipment-readiness.js`)
Adding equipment is the start of a chain — a PM schedule, a team to own it, LOTO, a hygienic design
verification, a course, the work instruction it's taught against — and nothing said so, so a machine went
in and its PM schedule turned up months later when someone noticed the task list was thin.
- **A CHECKLIST DERIVED FROM RECORDS, not a wizard.** A wizard fires once, at the moment you least want it
  (you're adding eleven machines off a spreadsheet), and can only ever help equipment added after it
  shipped. Reading the real tables answers the same question for the **183 pieces already in the system**,
  and keeps answering it after somebody retires the only LOTO procedure. Nothing is ticked by hand: a step
  is done when its record exists, so the list can't claim work that was never done.
- **NOTHING IS AUTO-CREATED.** A PM schedule written by a checklist has a guessed frequency and an empty
  procedure — a record asserting maintenance exists, which is worse than the gap it papers over. Each step
  links to the module that owns it (`link.tab`, checked against App.jsx's real nav ids — `hygienic`, not
  `hygienic-design`; `document-control`, not `documents`; HACCP CCPs are managed inside Equipment).
- **`applies` decides from COLUMNS, never from the `type` string** — see the section below. The first cut
  shipped its own list of type names, guessed `'tool'` for what the app calls `'Hand Tool'` (so excluded
  nothing at all), and disagreed with `equipment.loto_required`, which the LOTO module and the compliance
  badge had been reading all along.
- **Two new nullable links make it answerable:** `training_courses.equipment_id` and
  `sop_documents.equipment_id` (a course can be *about* a machine — WI021 is literally "Hexagon Tumbler
  Mixer Operation"), with pickers in the course modal and the document editor.
- Pending ≠ done: a hygienic design verification awaiting approval is the record that somebody *started*.
- `GET /equipment/:id/readiness` (one machine) and `GET /equipment/readiness` (bounded roll-up for the list
  badges) — declared **before** `/:id` or Express reads "readiness" as an id. The roll-up runs the same
  `check` functions, not a second faster copy, so a badge and the panel it opens can't disagree. The create
  response carries the checklist inline so it's in front of whoever just saved.
- Verified end to end on a fresh DB: 33 assertions on the transitions (each step flipping only when its
  record appears, a course on one machine not counting for another, pending vs approved), the per-type
  `applies` rules including a real seeded zone, route ordering, and roll-up/detail agreement.

## Equipment vs areas: `asset_kind` and `loto_required` are COLUMNS, not guesses
**39 of the plant's 183 equipment rows are areas** — BPG inspection zones, light fixture zones, sanitation
zones, environmental monitoring points. They belong in `equipment`: `pm_schedules.equipment_id` is NOT NULL
and a zone genuinely needs a recurring schedule, so pulling them into their own table would mean a second
copy of the PM machinery for something that already works. **The rows are fine; what was wrong was that the
distinction was INFERRED FROM THE `type` STRING in several places at once.**
- **`equipment.asset_kind`** (`machine` | `zone`, default `machine`) is the classification, and
  **`equipment.loto_required`** (default 1) is the lockout answer. `loto_required` *already existed* and was
  already read by `/loto/uncovered-equipment` and the compliance badge — the setup checklist inventing a
  second rule from type names is exactly the drift this codebase keeps warning about. Read the columns.
- **`shared/equipment-types.js` supplies DEFAULTS ONLY.** `defaultAssetKind(type)` sets the value when a row
  is created and drives the one-time backfill; nothing consults the type at read time. A zone typed slightly
  differently used to become a machine owing a lockout procedure, a course and a work instruction.
- **The backfill is one-time, marked in `app_settings.equipment_asset_kind_backfilled`.** A count-based
  guard ("no rows are zones yet") would re-tag on the next deploy if an admin deliberately reclassified them
  all — the sort of quiet undo that makes people stop trusting a setting. Verified: hand-reclassify a zone,
  redeploy, the decision survives.
- **A ZONE CANNOT REQUIRE LOCKOUT** — an area has no energy source, so that's an invariant, not a preference
  to preserve. Enforced on create, update *and* bulk-update; leaving the flag set produced a row the
  checklist treated as an area while the LOTO badge counted it as a machine missing its procedure. The two
  LOTO reads also filter `asset_kind != 'zone'` as defence; that changes no number today (0 contradictions)
  and is there so the count can't be wrong if one ever appears.
- **An absent field on PUT means "leave it", never "re-derive from the type"** — someone who marked a
  machine as not needing lockout must not have it undone by an edit to its location.
- The cleaning seeders set `asset_kind = 'zone', loto_required = 0` **at the point of creation**, so a fresh
  DB is correct without relying on the backfill at all.
- The type dropdown now offers the zone types in their own `<optgroup>`. They were missing entirely, which
  is the retired-rooms trap: a `<select>` whose value isn't among its options falls back to the FIRST one,
  so opening a BPG zone and saving silently retyped it `A/C`.
- The registry has an **Equipment / Areas** filter (nothing hidden by default — a list quietly missing a
  fifth of its rows is worse than a filter people can see), and both fields are in bulk edit and the CSV.
- Verified: fresh boot (39 zones classified by the seeds, 0 contradictions), upgrade of a pre-migration DB
  (40 classified by the backfill), redeploy preserving a hand-set value, and 24 API assertions covering the
  defaults, both override directions, reclassification in and out, bulk edit rejecting an unknown kind, and
  the LOTO/checklist agreement.

## Settings is a registry, not a page (`SettingsShell.jsx` + `SettingsPanel.jsx`)
Settings was one render stacking seven blocks with their permission rules written inline between them, so
finding one thing meant reading past six, and adding an area meant appending JSX to a 1,145-line component.
- **A section is DATA.** `SECTIONS` in SettingsPanel.jsx: `{ id, label, description, keywords, icon,
  visible(user), Component }`, in three groups (People / How the app works / Data & connections). Adding a
  settings area is one entry plus a component — nothing else.
- **The nav and the pane are built from the SAME `visible` predicate**, so they cannot disagree. The old
  shape put the rule in the middle of the markup, where a heading could render with nothing under it. A
  section a user can't see is unreachable by a stale `?section=` link or a remembered id too — the fallback
  is the first section they *can* see (wide) or the index (compact), never a blank pane.
- **Only the open section mounts**, so opening Settings no longer fires every section's queries at once.
- **One pane at a time on a phone**, via `useCompactLayout` — index, tap, Back — the same rule as comms. On
  a wide screen the rail sits beside the pane. Verified at 1024/1280/1440 and 360.
- **`?tab=settings&section=<id>` deep-links a pane, and App.jsx reads it, not the shell.** App's deep-link
  effect does `history.replaceState` to consume the query string, and a lazily-loaded module mounts *after*
  that runs — so a module reading `window.location.search` itself always finds it already gone. It's read
  once in App and passed down as `initialSection`. The last-opened section is remembered in
  `localStorage.settings_section`.
- The file split follows the same logic: `settings/UsersSection.jsx` (by far the largest, ~900 lines),
  `settings/DataBackupSection.jsx`, `settings/ShareableLinksSection.jsx`. SettingsPanel.jsx is now ~120
  lines of registry.
- **Known, carried over from the old code:** `canBuildLogs` allows a non-admin with a `log-builder` edit
  grant, but that branch cannot fire — Settings is admin-only at the *door* (both gear buttons test
  `user.role === 'admin'`, and `settings` is in `ADMIN_ALWAYS`). The rule is kept because it's the right rule
  for the section; making the grant usable is a decision about who gets into Settings at all.

### Module Access: 54 modules is a list, not a scroller
`ModuleAccessEditor` (UsersSection.jsx) rendered all 54 modules one per row inside a `max-h-72` box — about
five screens of scrolling to reach the last group, so setting one permission meant hunting for it.
- **A column FLOW (`columns-1 md:columns-2 2xl:columns-3`), not a grid.** The groups are wildly different
  lengths, and a grid would leave a short group's cell padded out to the height of the tallest one in its
  row. A CSS column flow packs them, and `break-inside-avoid` on each group keeps its heading with its own
  modules. The third column waits for `2xl` on purpose — at 1440 the settings pane is ~830px, and three
  columns there wrap the module notes into eight-line ribbons.
- **The filter is the fast path to one module**, matching label + id + note; a group with no match is dropped
  entirely rather than left as an empty heading.
- The editor is hidden altogether when someone has full access (`allAccess`), so **test it against a
  partial-access user** — opening an admin shows the "Full access (all modules)" checkbox and nothing else.

### The roster on a phone: a table's scroller must not swallow a form
The user roster is a `min-w-[560px]` table in an `overflow-x-auto` wrapper. At 360px that leaves ~326px of
column, so **Status and the Edit / Deactivate / Remove buttons sat off the right edge** — you could not
edit or deactivate anyone on a phone without discovering a sideways scroll. Worse, the inline Edit User form
renders in a `<td colSpan={5}>` *inside that same scroller*, so half of every field was unreachable too.
- Below `md` the same rows render as **cards** (`UserCard`) and the edit form is a plain full-width block
  underneath, outside any scroller. `hidden md:block` on the table, `md:hidden` on the list.
- **The cells are shared components** — `UserName` / `DeptChip` / `AccessNote` / `StatusChip` /
  `UserActions` — used by both layouts. A second copy of the department colour map is how the table and the
  cards start disagreeing about who is in QA.
- **A `fixed inset-0` centred flex modal CLIPS content taller than the viewport rather than scrolling it**,
  so the Bulk-add modal's Add button was simply gone on a short phone. `max-h-[92vh] overflow-y-auto` on the
  panel. Bulk Permissions already had it.
- `ml-auto` on Add User became `sm:ml-auto` — on a wrapped header it stranded the button on a line of its own.
- Everything else in Settings (Log structure, Requests, Backup, Links, Integrations, Cleanup) already passed
  at 360; only the Requests header needed wrapping (title was squeezed beside two `shrink-0` buttons).

## One tab strip for every module (`ModuleTabs.jsx` + `lib/useModuleTabs.js`)
Nine modules had grown their own internal tab strip in **four different visual styles** — filled pills
(Calibration, LOTO), underlines (Training, Retention), and two flavours of segmented control (Production Log,
Time Tracking, the ledgers, ModuleHub) — each re-solving the same four problems slightly differently.
- **The segmented control is the house style**, because it was already the most-used shape and it's the
  calmest: a tab strip is orientation, not a call to action, so it shouldn't shout louder than the buttons
  that actually do something.
- **`ModuleTabs` renders; `useModuleTabs` decides.** The component does NOT filter by permission. That split
  is a bug fix, not tidiness: while the component also filtered on `visible(user)`, any caller that forgot to
  pass `user` ran every predicate against `undefined` and **silently hid the whole strip** — which is exactly
  what happened to all three hubs. One owner for the rule means it can't be evaluated with the wrong argument.
- **`overflow-x-auto`, never wrap.** A wrapped segmented control breaks into two rows of half-pills; scrolling
  is the right idiom and keeps the PAGE from panning — the 360px bug that hit the Training strip.
- Counts go in `badge`, beside the label, not baked into the label string (`Boxes (3)` gets re-pluralised by
  every author otherwise). `badgeTone: 'alert'` is the red pill the hubs use for outstanding work.
- **`?tab=<module>&view=<tab>` deep-links a tab**, and the last tab you were on is remembered per module
  (`localStorage.module_tab_<id>`).
- `ModuleHub` uses the same component — a hub tab and a module tab were always the same idea drawn twice.
- **NOT consolidated: Task Center's group/frequency chips.** Those are colour-coded FILTERS narrowing one
  list, not navigation between views; flattening them would throw away the per-team colour that makes that
  screen scannable. A filter and a tab are different things.

### `src/lib/deepLink.js` — reading a query param a lazy module never sees
App.jsx consumes `?tab=`/`?form=`/`?section=`/`?view=` in an effect and calls `history.replaceState` to clear
them. A **lazily-loaded module mounts after that effect**, so anything reading `window.location.search` for
itself always finds an empty string. `deepLink.js` captures the query string at import — before React renders
— and hands it out afterwards.
**`getParam` is pure; `consumeParam` runs in an effect.** React StrictMode deliberately double-invokes a
`useState` initializer and keeps the SECOND result, so a destructive read during render gives the value to
the throwaway call and `null` to the one that counts. That cost a working `?view=` link before it was caught.

## Accounting: AP, AR and the M4 reconciliation (one number, both companies)
Powder Ops and M4 Dynamics invoice each other constantly — flavours moving both ways, each running
production for the other — and it had stalled because each company was adding up its own emails and getting
a different answer. `accounting` is a **hub** (`HUB_TABS`, Office group) holding **Accounts Payable /
Accounts Receivable / Partner Reconciliation**; the three are the same job split only by which way the money
points, and someone checking the M4 number wants the AP and AR rows a click away, not a screen away.
The module grant is `partner-reconciliation`; AP and AR keep their own.

**`server/partner-recon.js` is the whole arithmetic and is a PURE function** — rows in, numbers out, no
Express, no writes. The number both companies have to trust should be checkable without standing up a
server, and the client never re-adds anything: a second opinion computed in the browser is the original
problem in a new place.
- **One ledger, both directions.** `partner_documents.direction` (receivable = they owe us, payable = we owe
  them) says who owes; two tables is exactly how two companies end up reconciling from different books.
- **A credit is a positive amount with a type**, not a negative amount — "how much was that credit" stays
  answerable without reading a minus sign. `signedAmount()` applies the −1.
- **Nothing counts until it is FINAL.** A document is draft until the work behind it happened (goods went
  out, the run finished). Approving as final is what lets it into the number, and it is office/admin only.
- **A dispute EXCLUDES rather than blocks.** One disagreement must not stop the other eleven settling — the
  row drops out and is named in the report with its reason. That is the mechanism that prevents the standoff.
- **Net 30 decides INCLUSION, and the simplified view does not nullify it.** An invoice raised on the 28th
  isn't owed at month end; it sits out, lands next period, and the report says so by name (`not_due`).
- **`classify()` is the single place eligibility is decided**, so the total and the "not in this number"
  report can never tell different stories about the same row. Every exclusion carries a plain-English reason
  (`EXCLUSION`), which is the report the user asked for: how we got to Z and what wasn't in it.
- **A settlement is immutable.** Paying stamps the exact set of documents into `partner_settlements`;
  without that, next month's figure can't be trusted and "what did we settle in July" has no answer. A
  settled document refuses edit and delete.
- **The settle total is recomputed server-side and `expected_net` mismatches 409.** If someone finalised
  another invoice while the screen was open the number moved, and paying against a stale figure is exactly
  the failure this tool exists to prevent.

**The partner portal** (`server/api/partner-portal.js`, `/partner/<token>`, `PartnerPortalPage.jsx`) is
public and token-gated like the flavor-approval magic link — the person at M4 has no ReadyDoc account and
shouldn't need one to see the number we're both settling against. The surface is deliberately narrow: read
the ledger, upload their own invoices/POs (which land as **draft**, `source = 'partner-portal'`, so a
partner can never put money into a settlement on their own), and raise a dispute (which can only ever remove
money). **Approving as final, voiding, settling and creating links simply have no endpoint there.**
Tokens are stored as a SHA-256 hash and the clear text is returned exactly once; revoking is immediate.
- **`owed_to` on the portal names who is OWED, same meaning as internally, translated to their side**
  (`us` → `powder-ops`, `them` → `you`). The first cut had it inverted, which showed M4 as being paid in a
  month they owed us — caught by the end-to-end test, and the reason that test asserts both directions.
- `net_amount` flips sign so it reads as `you_are_owed − you_owe`; the settlement history keeps the raw
  internal `owed_to` and is worded per row.

Uploaded files go to R2 through the shared `server/media.js` + `invoice-text.js` path, so a search finds a
lot number printed **inside** the PDF (`extracted_text` is searched, never shipped to the client).
Verified end to end on a fresh DB: 35 assertions covering the arithmetic, Net-30 exclusion, the 403s, the
409 on a stale balance, settlement immutability, and every portal boundary.

## Reimbursements (personal card spend) — Accounting tab #4
`reimbursements` + `reimbursement_receipts` (`server/api/reimbursements.js`, `ReimbursementsPanel.jsx`),
a tab in the **Accounting** hub. Today it is Marnee and Adam and a personal card; the loop is photograph the
receipt, say what it was, tick it off when it goes out in payroll — and it should stay that small, because
every extra field is a reason not to file and the claim nobody files is the one that becomes an argument
three months later.
- **The receipt is the record.** The form's file input is `capture="environment"`, so on a phone it opens the
  camera — this is filled in standing at the till. But a **missing receipt never blocks the claim**: it files
  and the row says "no receipt" in amber until one is added (`POST /:id/receipts`). Refusing at the till,
  where someone is holding a phone in a queue, is how the claim doesn't get filed at all.
- **Paid is stamped, never guessed.** `paid_at` / `paid_by` / `pay_period` / `payment_reference`, because
  "did I already reimburse that" is the entire question. `POST /pay` takes `ids[]` — one payroll run, several
  people — but audits **each record individually** plus one batch row, the same rule as Time Tracking's bulk
  edit. Paying twice is refused and reported in `skipped[]` by reason rather than silently re-stamped.
- **A rejection is a decision and carries a reason (≥3 chars); it is not a delete.** You may withdraw your
  own claim only while it is still `submitted` — once someone has decided on it, it is a record.
- **A person with the module only ever sees their OWN claims.** The list query scopes on
  `user_id OR person` for anyone who isn't office/admin, and the roster filter is empty for them. This is a
  pay record; what a colleague spent is not their business. `canSettle` (admin, or supervisor in
  office/admin) is the second, narrower permission — approving and paying is not the same act as asking for
  your own money back, so the module grant deliberately doesn't confer it.
- `can_edit` is stamped server-side and the client renders what it's told (same rule as qms.js). A **paid**
  claim is closed to everyone but an admin.
- `reimbursement` is a custom-field scope, so extra questions are a Settings task.

## Threads clear themselves when you actually read them (`src/lib/useSeenAfterDwell.js`)
"Mark read" used to be the only way to clear a thread, so the honest case — you scrolled to it, read the
replies, decided it needed nothing from you — left it unread forever and the badge stopped meaning anything.
`useSeenAfterDwell(ref, {ms, enabled, onSeen})` fires once when an element has genuinely been *looked at*:
enough of it on screen (IntersectionObserver `threshold`), **the tab visible** (leaving the app open on a
second monitor must not clear your morning), and **continuously** for `ms` — the timer restarts on every
exit, because half a second here and half a second there is still not reading.
- Wired to `ThreadInboxCard` at 4s, and only while the card is **expanded** — a collapsed one-line summary
  scrolling past is not reading the thread.
- **It marks read on the server but deliberately does NOT refresh the list.** The ring, the "N new" badge and
  the NEW divider stay put while you're still looking; a card that rearranges itself out from under the
  sentence you're reading is worse than one that lingers, and the inbox will be in its read state next load.
  `onMarkRead` still updates the sidebar count, which is the number people watch.
- `seenRef` is synced in an effect, not during render — a ref written while rendering is a side effect and
  the lint rule is right about it.

## Split Screen / chat popout: back must stay inside Messages
The `/chat` route is either the ~420px docked panel (an iframe) or a 460px popout. It used to be given
`onExit={() => window.location.href = '/'}`, so "← ReadyDoc" or a swipe-back at the end of the chain
navigated that narrow column to the **whole app** — sidebar and all — inside a panel narrower than a phone.
- **`/chat` is now given no `onExit` at all.** The back chain (`comms-back`) ends at the channel list, which
  is the outermost thing inside Messages, and the header's ReadyDoc button is hidden rather than dead: in the
  docked case ReadyDoc is already on screen beside it, and in the popout case it belongs to the window you
  came from.
- **A ReadyDoc module link inside the panel asks the parent window to navigate.** `openAppLink`'s `tab`
  branch dispatches `app-navigate`, which App listens for — but App isn't in the panel's document at all, so
  that button previously did nothing whatsoever. It now `postMessage`s `readydoc-navigate` to
  `window.parent` (docked) or `window.opener` (popout); App's listener is **origin-checked**. The panel stays
  on Messages and the module opens where the modules live.

## Retention Samples: still empty, and why
The module is built and working but the log has **no rows** — nothing was ever seeded. The plant's own
Retention Sample log (the 16-page PDF, boxes 15–19) was read to design the module, but the PDF is not in the
repo and only pages 1–4 survive in readable form; pages 5–16 exist as ~300-character fragments. **Seeding the
part that is recoverable would be worse than seeding nothing** — a retention log that lists some of the jars
reads as "this is what we hold", and a missing jar is exactly the failure the log exists to prevent.
Re-attach `Retention_Sample_2026_V2.pdf` and it can be transcribed into a `server/retention-seed.js`
(idempotent on box + item + lot, same shape as the other seeders).
Shape confirmed from the pages that did survive: one section per box (`BOX # 15`, destruction date), three
groups within it (**BLEND / IM / FINISH GOOD**, plus raw materials at `90g` in the later boxes), and per row
item number, item name, lot #, EXP date, the retention count (`5 (2 LAB, 3 RETAIN)`), batches (free text —
`1 and 2`, `1 BEG, 1 MIDDLE, 1 END`) and a collected-date + initials cell.

## Retention Samples: importing a box from the paper log (`server/retention-log.js`)
The plant's Retention Sample log is **one sheet per box**, and it is a paper form rather than a table: a
`BOX # 15` banner carrying the destruction date, then sections announced by a bare word in the item column
(**BLEND / IM / FINISH GOOD**, plus raw materials in the later boxes), with runs of blank rows left as
writing space. So this is a section walker like `training-log.js`, not something `readTable` can hand back.
- **Lab and retain are split out of one cell and never recombined.** `parseRetention` reads
  `5 (2 LAB, 3 RETAIN)`, `2 (Retains)`, `1 RETAIN`, `90g`, `1 SAMPLES`, `(1 RETAIN)`. **The explicit
  LAB/RETAIN breakdown wins over the leading total**, because the log's own arithmetic is wrong in places
  (`3(2 LAB, 3 RETAIN)`) and the breakdown is what was physically pulled — the total is a sum someone did in
  their head. The disagreement is reported as `total_mismatch` rather than silently resolved.
- **A weight is a raw-material retain**: `90g` → one sample, `sample_size` kept as written.
- **A month is the LAST day of it.** `Destruction Date: 02/2028` → `2028-02-29`, an expiry of `01/28` →
  `2028-01-31`. A box due "02/2028" is not overdue on the 1st, and `retention.js` reads that date to refuse
  an early destruction.
- **A row with no item name is writing space, not a record.** The log is full of half-filled rows and a
  retention record invented from one is worse than the gap.
- **Preview writes nothing** and lists every row it will file plus everything it could not read. A retention
  log bulk-written from a spreadsheet nobody checked stops being the thing that answers "do we still hold a
  jar of that lot".
- **The raw-material section heading is `RAW INGREDIENTS`, and the first regex missed it.**
  `(raw\s*materials?|rm|ingredients?)` looks like it covers the ground and doesn't: `raw` was welded to
  `materials`, and `ingredients` had no `raw` in front of it, so the plant's own wording matched nothing and
  every raw-material row in boxes 16-19 silently inherited the section above it. It is
  `(raw\s*)?(materials?|ingredients?)` now, and **a row that reads like a heading but matches nothing is
  reported as `unknown_section`** rather than skipped — a heading the parser doesn't know reassigns every
  row beneath it, which is exactly how this stayed invisible. A banner is also recognised now when the row
  carries a stray mark beside it (judged on the absence of lot / retention / collected, not on a raw
  filled-cell count).
- **Idempotent on box + item + lot + collected date** (`sampleKey`, stored as `external_id`). The same item
  legitimately appears twice in a box — a second lot, or a later collection — so item alone would collapse
  real jars; re-importing a corrected sheet updates in place instead of doubling the box.
- **A destroyed box refuses re-import.** Its contents are the record of what was held.
- API: `POST /retention/import/preview|commit` (QA/admin). UI: **Import a box** in the panel header.
- Verified on the real Box 15 sheet: 67 samples, 112 retains, 29 lab, 31 blend / 13 intermediate / 23
  finished good, 6 rows honestly reported as unclear, and a re-import producing 0 created / 67 updated.

## Banking & Reconciliation — the part of QuickBooks that costs accountant hours
`bank_accounts` / `bank_transactions` / `bank_transaction_matches` /
`bank_reconciliations` / `bank_rules`, with `server/bank-formats.js` (statement parsing),
`server/bank-match.js` (**pure** matching + reconcile arithmetic), `server/bank-feed.js` (Plaid, degrades
gracefully), `server/api/banking.js` and `BankingPanel.jsx` — a fifth tab in the **Accounting** hub.
Module grant `banking`.
- **The bank is the fact.** A bank transaction is never edited and never deleted; everything else is an
  opinion *about* it, stored separately, so a wrong match is undone without touching the record.
- **A match is a link, not a merge** — one payment can cover three invoices, so matches carry their own
  amount in their own table. A split must account for the whole payment or it 400s.
- **Nothing auto-matches on a guess.** `scoreCandidate` returns **null** (not a low score) when the
  direction is wrong, the amount differs by a cent, or the gap exceeds 120 days — a suggestion list
  containing impossible rows is one people stop reading. Amount alone scores 0.6; `AUTO_THRESHOLD` is 0.9,
  so a *second* identifier (the vendor name or the invoice number appearing in the bank description) must
  agree before anything is applied without a human. Two equally good candidates report `ambiguous` and
  refuse to auto-match — that is the case where a payment lands on the wrong invoice.
- **`planMatches` withdraws a candidate once consumed**, so two identical bank lines can't both claim one
  invoice.
- **A period closes only when the difference is zero AND nothing is unexplained.** "No document — it was a
  bank fee" is a real answer and is recorded with its reason; ignoring a line silently is not possible.
  Closing stamps the transactions, which then refuse re-matching and refuse to be rewritten by a re-import.
  Reopening needs an admin, a reason, and must be done **newest-first** (each period's opening is the prior
  close). The opening balance is frozen once any period is closed.
- **Signs are normalised at exactly one boundary each.** A statement reads negative = money out; banks
  disagree (one signed column, separate debit/credit columns, or a positive amount plus a `DEBIT` type) and
  `parseBankCsv` resolves all three — while never double-flipping an already-negative debit. **Plaid signs
  the opposite way** (positive = money leaving), flipped once in `fromPlaid`.
- **A CSV has no stable id**, so `csvFingerprint` derives one from date+amount+description+reference, with an
  occurrence suffix so two identical coffees on one day stay two transactions. That is what makes
  re-importing an overlapping date range safe — the most common way a reconciliation goes wrong.
- **Rules are taught, never shipped.** Resolving a line offers to remember it; nothing is seeded as a guess
  about this plant's vendors.
- **The live feed is Plaid and is optional.** `bankFeedEnabled()` gates the Link button, the sync endpoint
  503s without it, and **statement import always works** — the file path is not a fallback for a broken
  feed, it is how a bank Plaid doesn't cover still reconciles. `/transactions/sync` is cursor-based, so a
  repeat sync is idempotent; `removed` deletes retracted pending charges (never inside a closed period).
  **Env:** `PLAID_CLIENT_ID`, `PLAID_SECRET` (optional `PLAID_ENV`). Access tokens live in `app_settings`
  keyed by item id, so several accounts at one institution share one token.
- Verified on a fresh DB: 23 assertions on the pure engine (sign handling in every CSV layout, OFX, the
  auto-match threshold, ambiguity, candidate consumption, the reconcile arithmetic) and 34 end to end
  (import, dedupe on re-import, right-vendor-over-same-amount-decoy, the two close refusals, frozen closed
  periods, reopen ordering, opening-balance protection, and the feed-off paths).
- **Docs for the humans:** `docs/quickbooks-api-setup.md` (getting the four QBO env vars),
  `docs/quickbooks-app-assessment.md` (Intuit rejected the app on *relevance* — a description problem, not
  an app problem; the exact wording to resubmit with) and `docs/accountant-brief.md`.

## Getting the books out of QuickBooks WITHOUT the API
Intuit's app review can block the API indefinitely, so the report exports QuickBooks produces natively are a
**first-class way in, not a fallback** — four `TARGETS` in `server/api/imports.js` plus an import section on
the QuickBooks tab that shows whether or not the API is connected. Verified end to end on the plant's real
exports: 164 accounts, 370 vendors, 31 customers, 736 bills, 160 invoices.
- **A QuickBooks report is not a table.** Every one interleaves subtotal rows ("Total for 1 - 30 days past
  due", "TOTAL") with the data, and a Transaction List filtered to Bills still contains every Bill Payment
  against them — **733 of 1,471 rows** in the real export. Importing those would have invented 733 bills
  that were never issued. `skipRow(src)` runs on the source row before mapping and its rows are counted as
  **`filtered`, separately from `skip`** — a subtotal is not a broken row, and 734 errors on a good file is
  how someone concludes the importer is broken.
- **ABSENCE MUST NOT ERASE.** The A/P Aging Detail carries an open balance and is the authority on what is
  owed; a Transaction List has no such column and is history. Letting history answer "is this paid?" marked
  every outstanding bill settled and dropped AP from **$112,012.56 to $83,644** — caught by the test, not by
  reading the code. So a field the file doesn't carry stays `undefined`, `insertDefaults` fills it for NEW
  rows only (history is paid), and the UPDATE is built per row from the columns that file actually has.
- **Identity must not hinge on a name QuickBooks spells inconsistently.** The aging report says
  "V00301 M4 Dynamic" where the transaction list says "M4 Dynamic", and keying on the vendor imported the
  same two bills twice. A bill is `invoice_number + invoice_date + amount`; the vendor is a label.
- `qbo_accounts.qb_id` / `qbo_contacts.qb_id` had to become **nullable** — those rows now arrive from either
  the API (which supplies an id) or a spreadsheet (which doesn't). Rebuilt in place, guarded on the table
  being empty.
- Field-level extensions the targets needed: `const` (a vendor list has no "kind" column — every row is a
  vendor), `derive`, `columns` (what is WRITTEN, when it differs from the `fields` that are READ — a ledger
  reads an open balance in order to write a status), `transform` and `insertDefaults`.
- **Their books, as of the export:** AP $112,012.56 open across 5 bills, AR nothing outstanding, 737 bills
  and 160 invoices of history back to 2022. One bill is dated **09/22/2002** (Canyon Overhead Doors,
  $1,244.75) — almost certainly a 2022 typo in QuickBooks, imported verbatim rather than silently corrected.

## What the Journal actually says (the stage-3 sizing answer)
Counted from their real Journal export, all dates — the question was whether replacing the general ledger is
a reporting exercise or a real accounting project. **It is neither of the things we guessed.**
- **592 journal entries since 2022, and 568 of them are MRPEasy** — identified exactly by the `Num` prefix
  (`mrp202409132203`), not by guessing at descriptions. They post inventory/WIP/COGS automatically:
  "Received purchase orders", "Finished manufacturing orders", "Applied overhead cost", "Shipped goods".
- **The genuine accountant judgement is 24 entries in FOUR YEARS** (~6/yr): year-end depreciation, the
  intercompany reclasses to Prodough and Matt, corrections. Trial balance ties at **$11,806,803**.
- **The MRPEasy feed is DEAD — last posting 30 April 2026.** The accountant removed the integration during
  this year's clean-up because it was inaccurate; the plant is also migrating off MRPEasy to Keychain. So
  the earlier read ("the blocker on stage 3 is MRPEasy") is wrong: there is no feed to receive. What it
  leaves is a real question for the accountant — **nothing has posted WIP or COGS since 30 April**, so
  where is inventory accounting happening now?
- (`receiving_log.part_in_mrp` / `received_in_mrp` still exist — MRPEasy was upstream of Receiving too, and
  those fields will need revisiting on the Keychain move.)

## The Batching EOD, rebuilt around what Bernardo actually writes down
He was keeping the shift in his phone's Notes and then re-typing a lossy summary into ReadyDoc — the
clearest possible signal the form wasn't asking for what he records. His notes look like:
```
Full Clean (ATP Swab and Allergen Swab) Room 1, Sifter (160) and Utensils (06:40-07:45)
MO76736 Lot.101692 … (Weighed, Sifted and Blended 2 Batches No.1=343.4kg…) (08:00-12:45)
ADJUSTMENT MO76759 Lot.101714 … 1 Batch (15:05-15:25)
```
So neither cleaning nor per-MO work fits a flat per-shift survey. Both are now first-class repeatable
fields on the entry.

**`production_entries.cleaning_events`** (JSON) — `{level, scope[], sifter_no, atp_swab, allergen_swab,
start_time, end_time, mo_number, note}`. **A clean is an EVENT, not a shift attribute.** The old single
"Cleaning performed: Full / Partial" select forced a partial wipe of the room and a full strip of the
blender into one answer, so the operator had to overstate one of them; and a second clean after a
changeover had nowhere to go. `scope` is a tick list (`CLEAN_SCOPE` in `constants/productionLines.js`) so **the room and the equipment can
be at different levels** — file two events. **The plant has TWO blenders and calls them Blender 1 and
Blender 2**, so the list names both: one "Blender" tick could never say which was cleaned, and on a shift
where one is stripped down and the other wiped that is the whole fact. Records filed against the old plain
"Blender" keep saying it — `CleaningSummary` renders whatever scope a record carries, not just the current
list. The facility map labels them Blender 1/2 too, but its `room` KEY stays `Lg Blender 1/2` because that
is what cleaning records were filed against. `mo_number` is
optional and ties a clean to **one specific MO** rather than to the shift.

**`mo_lines` gained `work_stages` / `portion` / `start_time` / `end_time` / `is_adjustment` / `note`.**
- `WORK_STAGES` = Weighed / Sifted / Blended, **fixed** rather than free text, because an MO legitimately
  spans days at different stages (weighed Monday 15:15, sifted and blended Tuesday 05:15) and "what is
  weighed but not yet blended" is worth being able to ask.
- `portion` ("100%", "20%", "80% Left") is kept **verbatim** — normalising "80% Left" to a number loses
  which 80%.
- **`is_adjustment` lines contribute ZERO to `quantity_completed`** (`lineQuantity()`, used by both the
  create and amend paths). An adjustment reworks product already counted on the day it was made; adding it
  again would inflate the week's output — the number Production KPIs are built on. Wednesday of the sample
  week is the case: 182.9 + 952.3 = 1,135.2, **not** 1,535.7.
- Times are stored as text, not timestamps: "05:15" on a night shift belongs to the entry's date, and
  inventing a date-time would put half of Bernardo's shifts on the wrong day.
- **The shift window is DERIVED, not typed.** Every MO run and every clean already carries its own start
  and finish, so `start_time`/`end_time` are the earliest and latest of those — the top-level "Project Start
  / End Time" inputs are gone for multi-MO teams and replaced by a read-only *Shift window* line. A third
  copy of a fact recorded twice is the copy nobody updates. The entry form, `POST /entries` and
  `dayLogToEntry` all apply the same rule so they cannot disagree. The columns stay NOT NULL, so the server
  fills them **only when absent** — a team without per-line times, or a deliberate override, still wins —
  and an entry with no times anywhere is refused rather than filed with a blank window. The form validates
  this itself, because the browser can't enforce `required` on an input that isn't rendered.

**The seeded Blending EOD template shrank to two fields** (Adjustments / notes, Equipment issues /
downtime) because the structured fields took the rest — `clean_type`, `cleaned_items`, `clean_time`,
`sifter_no`, `atp_swab`, `allergen_swab` → cleaning events; `weighing` → the MO line's stages + portion;
`blend_time` → the MO line's own window.
- **The retired keys are NOT reused.** They asked broader questions and re-labelling their historical
  answers as answers to narrower ones would quietly rewrite what those shifts recorded. Filed entries keep
  them and `EodSummary` renders any answer key the template no longer defines, exactly for this.
- **`seedEodTemplates` still refuses to clobber a hand-edited template** (`updated_by !== 'system'`) — but
  it now LOGS when it skips, because a change to the shipped default that silently never appears is
  indistinguishable from a broken deploy. In that case the change is made in Production Log → EOD Templates.
- Cleaning events are gated by `usesMoLines(team)` (Batching today); extending them to another team is one
  entry in that helper.
Verified end to end by filing Bernardo's real Mon–Thu: 26 assertions, including the adjustment not
inflating output, two different-level cleans in one shift, a clean tied to one MO, an MO continuing at a
later stage the next day, and rejection of invented stages/levels/times.

## Sharing a file from the phone (`src/lib/shareFile.js`)
"Copy an image or document from mobile so I can text it" is the Web Share API **with the file attached**,
not a link: `shareFile(attachment)` fetches the bytes through our own origin (bearer token when it's a
`download_url`), builds a `File`, and calls `navigator.share({files})` when `canShare` says the OS sheet
accepts it — that's what puts the actual image into Messages/WhatsApp instead of a URL. Fallbacks in order:
share the link, copy it to the clipboard, open it. **An `AbortError` is the user closing the sheet, not a
failure** — return silently, no error toast. `canNativeShare` gates the button so desktop browsers without
the API aren't offered one that fails. Wired: comms image overlay + file cards, equipment manuals. Presigned
R2 URLs can't be fetched cross-origin (no CORS on the bucket) — always go through the app-origin download
route, same reason the Download button does.

## Task snooze, schedule provenance, and the weekly PM digest
- **`POST /pm/work-orders/:id/snooze`** `{days 1–14, reason ≥3 chars}` — supervisor/QA/admin. An audited
  defer, same shape as the setup-step waiver: due_date moves forward (weekends skipped via `nextWeekday`),
  `original_due_date` is set once, every push appends `{at, by, reason, from, to}` to `snooze_history`,
  audited as `snoozed`. **A missed task refuses** — snoozing must never erase a miss. UI: "Later" on Task
  Center cards (`SnoozeForm` in PMPanel); the card shows the last defer's name and reason.
- **Provenance:** Task Center cards show "From schedule: X · freq" — tapping it mounts `ScheduleInfo`,
  which fetches `/pm/schedules/:id` and lists the recent completions ("when was this last done"). The
  Operator View appends the schedule title only when it differs from the task title (usually it doesn't).
- **Weekly PM digest** (`postPmWeekDigest`, scheduled-jobs.js; Mondays, flag `last_pm_digest_week`): each
  team's open work through Sunday posts into the channel **named like its `task_group`** — the same
  convention `notifyTaskIssue` uses. A team with no channel is skipped silently; another team's PM list in
  #general is noise. Overdue leads, then day by day, capped at 5 lines per bucket.

## Comms: forward, voice notes, camera
- **`POST /comms/messages/:id/forward`** `{channel_id, note?}` — access-checked on BOTH ends; refuses the
  same channel, a deleted message, and admin-post channels for non-admins. Posts an attribution line
  ("↪ Forwarded from #x — originally by NAME") + the original body; the optional note leads. Attachments
  are **re-referenced, not re-uploaded**: new `chat_attachments` rows pointing at the same `storage_key`.
  **Both delete paths therefore purge a storage object only when no row references it any more** — rows
  are deleted first, then each key is checked. Mentions in a forwarded body are deliberately NOT
  re-recorded — an @name was aimed at the original conversation, and re-pinging on every hop is spam.
- **Voice notes:** `VoiceNoteButton` (CommsView; channel composer + thread reply, storage-gated like the
  paperclip). MediaRecorder → webm (mp4 fallback) → the composer's normal upload path → pending
  attachment → Send, so it's reviewable before it posts. Unmount stops the recorder — a hot mic surviving
  navigation is a privacy bug. Audio attachments render an inline `<audio>`; **the isAudio branch sits
  BEFORE the video branch** or audio/webm draws as a black `<video>` box.
- **Camera:** the compact layout gets a separate camera button (`capture="environment"`) beside the
  paperclip. Never put `capture` on the paperclip's own input — on iOS it forces the camera and blocks
  picking an existing file.

## Two operator layouts had no OfflineBar
The standalone `/operator` route and the operator-only account layout — the floor phones, exactly where
the Wi-Fi drops — never rendered `OfflineBar`, so "no connection" and "N entries waiting to send" were
invisible to the people the offline machinery was built for. Both render it under the header now.

## Pay Tracking: stored reviews, corrections, PTO
- **Evaluations are now STORED** (`pay_reviews`) — a deliberate reversal of the ephemeral first design:
  the plant's real flow is supervisor + Adam both reviewing an operator (combined score), Adam alone
  reviewing supervisors, and the admin reading scores and notes BEFORE deciding an increase — which
  requires the review to exist somewhere the admin can read it. A reviewer sees only their own
  submissions (`GET /pay/reviews`); admins see all; no review ever carries pay data.
- **Supervisors are reviewed only by Adam or an admin** — `canReviewSupervisors` matches Adam by name
  (`/^adam\b/i`, the env-limits precedent) with admins as the fallback so an absence never blocks a
  cycle. The evaluatee picker doesn't offer supervisor targets to anyone else AND the submit endpoint
  enforces the same rule, so the filter can't be worked around.
- **Applying a rate auto-resolves that employee's open reviews**, stamping the decision in `resolution`
  ("Increase applied: $X effective DATE"). "Held flat" is `POST /employees/:id/reviews/resolve` with a
  required reason. The admin drawer shows open reviews (scores expandable, notes, attendance flag) plus
  the combined average and the band it lands in, directly above Apply.
- **A mistaken review is corrected in place**: `last_reviewed_at` / `last_increase_at` are in the PUT's
  EDITABLE list (admin-only, audited with before/after) — the drawer's Details editor exposes them,
  alongside team / hire date / PTO plan / active.
- **DELETE refuses once rate history exists** — those rows are deactivated, never removed, so the
  history survives; removing is only for rows added by mistake (the sync-under-a-second-spelling case),
  which the drawer's "Remove from roster" covers. "Add someone" (manual POST) is on the roster tab.
- **`pto_plan` was always in the schema and the org-chart import** ("3 hr"/"4 hr") — it just had no UI.
  Now a roster column (filterable), a drawer stat, and on the Details/Add forms.

## One manual, many machines (`POST /equipment/files/:id/attach`)
One vacuum manual covers eleven identical vacuums. Attaching re-references the SAME stored object and
its extracted text into new `equipment_files` rows — no second upload, and search covers every copy; a
machine that already has that `storage_key` is skipped rather than doubled. **DELETE purges the R2
object only when the last reference is gone** — the same refcount rule as forwarded comms attachments.
UI: the copy icon on a file row → multi-select with a filter and select-all-filtered (the "select all
equipment items" bulk case).

## Comms search is membership-scoped — for admins too (the DM exposure fix)
`resultsFor()` filtered hits with `canAccess(..., isAdmin)` and `semanticHits()` short-circuited the
membership join to `1=1` for admins — so an admin's search (keyword AND semantic, and `/ask`) returned
the whole plant's DMs and private channels. Same class as the Activity-feed DM leak: **`canAccess()`'s
admin bypass exists for channel ADMINISTRATION; any bulk read that selects by CONTENT (search, ask) must
gate on `isMember()` instead.** An admin who needs to search a channel joins it — a deliberate act,
visible in the member list. The self-selecting bulk reads (threads inbox, activity, unread counts) are
fine as-is: their SQL only selects rows involving the caller, so canAccess there is a second gate, not
the first. Verified: admin gets 0 hits on others' DMs/private channels, participants still find theirs,
admin still searches channels they belong to.

## Mark unread is a DELIBERATE act (`deliberate_unread` on both read tables)
"Mark unread from here" was a silent no-op on a message you authored (the unread counts exclude own
messages — which is right for bot-path posts made as you) and was silently wiped by your own next reply
(sending advances last_read_at). A mark someone CHOSE must survive both, so the unread endpoint raises
`deliberate_unread` on `chat_channel_members` / `chat_thread_reads`: while set, own messages count and
the send-path marker bump is skipped. Reading the channel/thread (or read-all / admin reset) clears it.
**A thread reply (or a parent marked from the thread drawer, `{thread: true}`) rewinds the THREAD's
marker, not the channel's** — and the ThreadPanel messages now carry the Mark-unread menu entry at all.
`POST /threads/:parentId/read` also stamps **millisecond** precision now — its `datetime('now')` was
second-precision, so a reply landing in the same second as the read compared GREATER than the marker and
the thread never fully cleared (same class as the /read-all format note).

## Calibration instruments: "not in use" (`out_of_service`)
The server always supported `status = 'out_of_service'` and the module's own KPIs excluded it — but the
instrument form had NO status field (so it couldn't be set; same trap as equipment.status), POST didn't
accept one, and the bell/Critical-Tracking/dashboard counts + the Monday expiry digest only excluded
`retired`, so a not-in-use instrument sat in "calibration due" forever. All fixed: Status select in the
form (with 'overdue' kept in the options while it's the current value — the select-fallback trap),
status accepted at create, and every due/overdue count excludes out_of_service. **The HACCP CCP evidence
check still counts an out-of-service instrument on an active CCP on purpose** — that's a genuine gap,
not noise. Recording a calibration flips the instrument back to active (existing behavior).

## A dropdown inside a card or a scroller must not be a child of it (`MenuPortal`)
The message 3-dot menu was an absolutely-positioned child of the message row, so **any** ancestor with
overflow clipped it. In the Threads inbox there are two — the card (`overflow-hidden`, for its rounded
corners) and the list's own `overflow-y-auto` — and the old `shouldDropUp()` measured the WINDOW, so it
could see neither and dropped a full-height menu into a box that cut it in half with nothing to scroll.
- `MenuPortal` draws the menu on `<body>` via `createPortal` at **fixed** coordinates measured from the
  button (`menuPosition()`): no ancestor can clip it, and no transformed ancestor (the swipe-back pane)
  can shift it. It flips above the button when there's more room there, is clamped horizontally, and
  carries a `maxHeight` so a menu that still doesn't fit **scrolls itself** rather than being unreachable.
- A fixed menu can't follow its button, so **any scroll closes it** (capture phase — the scroller is an
  ancestor and its scroll doesn't bubble).
- `ThreadInboxCard` lost its `overflow-hidden`; the corners are rounded on the first/last children
  instead, which also frees the hover pill and the emoji picker.
- **`onMarkUnread` has to be passed at every `<Message>` call site** — it gates the menu row, so the
  entry was simply missing in the thread drawer AND the inbox cards. Verified in a real browser
  (Playwright, 17 assertions) at 1280×800 and a 420px-tall viewport that forces the flip.

## Comms remembers the VIEW, not just the channel
`comms_last_channel` restored the last channel, but Threads and Activity are their own screens with no
channel of their own — so a refresh while working the Threads inbox always dropped you into a channel,
and with nothing saved at all you landed on #general. `comms_last_view` (`channel|threads|activity`)
is written by `openChannel()` and the Threads/Activity buttons and cleared by `backToList()`.
**Read `lastView()` BEFORE calling `openChannel()`** in the restore effect — openChannel records
'channel', so reading it afterwards always came back 'channel' and the Threads restore could never fire
(and re-write the view after, since openChannel just overwrote it). `bootRestoredRef` stops the effect
re-running into the #general fallback underneath a restored Threads view, which sets no `activeId`.

## Pay evaluations are ASSIGNED, not remembered (`pay_review_assignments`)
The review cycle depended on somebody asking a supervisor in person. An admin now assigns
reviewer → employee with a due date; the reviewer gets a ReadyBot DM + a phone push, and the ask shows
as an amber strip at the top of their own Evaluation tab (tap it to load that person into the form).
- **The supervisor-review rule travels with the assignment** — assigning a supervisor's review to anyone
  but Adam/an admin is refused at assign time, not just at submit time, so the ask can't be created in a
  state that would later bounce. Self-review is refused via the roster row's `user_id`.
- **Submitting the evaluation closes the assignment** (same transaction, `review_id` recorded) — an
  assignment is never a second thing to remember to tick off.
- A **completed** assignment refuses deletion: it is the record that the review was asked for and done.
  Open ones can be cancelled. One open assignment per reviewer+employee (409 on a duplicate).
- Admin tab **Assignments** creates and tracks them; the Evaluation tab label carries the open count.

## Importing the scanned tests from Drive (`server/scanned-tests.js`)
The plant scans each completed test one file per person, and the FILENAME is the record:
`Copy of 06-01-2026 (LIGHT METER TEST) Bernardo Encisos.pdf`. So this is a **filename parser, not a
document parser** — the scan is a photograph of handwriting and nothing reliable can be read out of it.
`POST /training/import/scans/analyze|commit` (admin, multipart .zip; the client re-sends the zip on
commit, so there's no stash table).
- **Both orders occur** — `DATE (TOPIC) NAME` and `NAME (TOPIC) DATE` — so the topic is taken from the
  parentheses, the date by regex, and whatever is left is the person. Drive's `Copy of ` prefix (sometimes
  doubled), trailing spaces before the extension and `__MACOSX/` noise are all stripped.
- **MM-DD-YYYY, because `11-13-2025` proves it.** Day-first is read only when the first number cannot be
  a month — an observation, not a preference.
- **Nothing is invented.** No topic / no person / no date / one-word name → the file is REPORTED with the
  reason and skipped. The group sign-in forms (`August 20, 2025 Crisis Managment,SOP401.pdf`) have no
  `(topic)` and land here on purpose: they are not one person's test.
- **The mapping step is the point.** The scans misspell names the roster spells right ("Encisos"/"Enciso",
  "Inciso"), so an exact `personKey` match is used outright and everything else is a **suggestion** ranked
  by Dice bigram similarity (≥0.55, top 4) with the whole roster available for hand-mapping. Unmapped
  people/topics are skipped and counted, mappable on a later run — same rule as the Training Log importer.
- **The ACCOUNT's spelling goes on the record**, not the scan's, so it reads like every other record; the
  original filename is kept in the notes as provenance.
- Idempotent on `personKey|course title|date`, with `already_in_readydoc` counted separately from
  `repeated_in_file`.
- **The scan is stored as the record's EVIDENCE** (`training_records.evidence_key/_filename/_text/_status`,
  R2). Rows are written in one transaction first and the files attached after, so a storage hiccup can
  never half-import the log — the count of what was and wasn't stored is reported. **OCR is PDF-only**
  (local text layer); running vision OCR over hundreds of scans at import time would turn one click into
  a long, expensive job, and `evidence_status = 'skipped_image'` says so rather than implying it was read.
- Verified on the real filenames: 25 assertions incl. both orders, the group-form rejection, the
  misspelling suggested-not-matched, re-import creating 0, and admin-only.

## Policies module (the handbook) — `server/api/policies.js` + `PoliciesPanel.jsx`
PTO, grievance, conduct: how the company operates. **Deliberately NOT the controlled-document registry** —
an SOP is a controlled record with a revision and Document Control approval, and merging them would hand
an auditor asking for SOP 401 the PTO policy while dragging every handbook edit through a DCR. Office nav
group, module id `policies` (edit grant = upload and publish; admins + the `office`/`hr` departments have
it by role).
- **Two gates, and staff need BOTH: `status = 'published'` AND `visible_to_staff`.** Visibility is per
  POLICY, not per person — most of the handbook is for everyone and a few (the pay-review rubric) are
  management-only, so making it a module permission would force the whole handbook to one audience. A
  draft is never visible to staff even when ticked: an employee reading a half-written rule as if it were
  the rule is worse than not having it in the app.
- A policy a reader may not see **404s rather than 403s**, and the search never reaches it either.
- **Publishing is refused when there's nothing to publish** (no body and no file), and stamps the
  effective date. **Retire, don't delete** — people were told this applied, and only a draft can be
  removed outright.
- **The uploaded document's text is extracted on upload and searched, never shipped** (`extracted_text` →
  `searchable` + a snippet around the hit), same rule as equipment manuals. Google Docs come in as
  File → Download → PDF; DOCX/images work too.
- **AI drafting writes NOTHING** (`draftPolicy` in ai.js) — it returns text for a person to edit, and the
  system prompt forbids inventing this plant's specifics (accrual rates, notice periods, citations),
  emitting `[PLACEHOLDERS]` instead. Publishing stays the human act that makes it the company's word.
- Verified: 20 assertions covering both visibility gates, the 404-not-403 rule, search scoping, the
  empty-publish and delete-published refusals, and extracted text never leaving the server.

## Pay: who can review, and the roster's supervisor flag
- **`GET /pay/reviewers`** is the picker: active `supervisor`/`admin` only, ReadyBot excluded. It used to
  be `/users/technicians` — the whole roster — which offered operators (who never evaluate anyone) and
  **ReadyBot**. The same rule is enforced on `POST /assignments`, so the picker isn't the only guard.
- **`pay_employees.is_supervisor` is NOT the authority once a row is LINKED** — `users.role` is. The flag
  came from the org-chart import and went stale the moment someone was promoted or stepped down in
  Settings, and the review rules read it, so the roster and the app disagreed about who needs Adam. Same
  doctrine as the name: the link is the identity, the stored column is a label. `withLinkedNames()`
  derives it and `isSupervisorRow()` is the single check used by `/evaluatees`, `POST /reviews` and
  `POST /assignments`. The column stays editable for rows with **no** account; the Details checkbox is
  disabled for linked rows and says it follows Settings.

## ReadyBot chases pay reviews (`payReviewNudges` in api/pay.js)
Every third day (flag `last_pay_review_nudge_at`, called from scheduled-jobs.js):
- **each reviewer** is DM'd + pushed about their own assignments due within 3 days or already past;
- **the office** (admins + `office`/`hr` departments — Marnee and the owner) gets one summary: assignments
  past their date, AND **people whose review clock has run out with nobody assigned**. The second half is
  the one that actually starts a cycle; an overdue clock with no reviewer asked is otherwise invisible.
Three days, not daily — a reminder people mute is worse than none — and it re-sends while things stay
open, which is the state it exists to interrupt. Best-effort: a comms failure never throws out of the job.

## A column FLOW must size by the CONTAINER, not the viewport
`ModuleAccessEditor` used `columns-1 md:columns-2 2xl:columns-3`. That's fine in the Settings pane, but
the same editor is mounted inside the **Bulk Permissions** modal in a pane about half as wide — so on a
desktop the viewport said "two columns" while the container could only give each ~150px, and a row
(label + the Keep/None/View/Edit control) needs ~280px. **CSS columns don't shrink their contents**: the
rows overflowed into each other and the panel rendered as overlapping text. It is `columns-[17rem]` now —
a column WIDTH, so the browser fits as many as the container actually has and it's correct in both
places. The bulk modal also went `max-w-2xl` → `max-w-5xl` with a fixed `18rem` people column.

## Importing policies you already have (`POST /policies/import/analyze|import`)
Most of the handbook exists as files; re-typing a title to create an empty policy and then attaching the
document is pure redundancy. Same shape as the controlled-document importer and the scanned-tests one:
**analyze writes NOTHING** (it proposes a title per file and flags ones already on file), the client
re-sends the files on commit (no stash table), and everything lands as a **draft that staff cannot see** —
publishing stays the deliberate act. Titles come from filenames and a filename is a guess, which is why
the confirm step exists: thirty policies imported under wrong titles is worse than thirty minutes typing.
**`server/filename-meta.js` is the one definition** of `cleanFilename` / `stripRevisionSuffix` /
`revisionFromFilename` / `titleFromFilename` — extracted from documents.js rather than copied, or the two
importers would drift and the same file would title differently depending on which screen you used. A
trailing `_V4` is the version, not part of the title; a leading date is provenance; "Allergen Control
Program 2" keeps its number.
**Testing storage-backed paths:** a ~25-line S3 stand-in (PUT/GET/DELETE, signatures ignored) pointed at
by `R2_ENDPOINT` with any `R2_*` values runs the real upload path locally.
