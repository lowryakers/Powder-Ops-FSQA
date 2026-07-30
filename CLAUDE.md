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
`<FormatBar>` (B/I/U/S + bullet/numbered) sits above the channel composer, the thread drawer reply, and the
Threads-inbox reply; `wrapSelection()` / `prefixLines()` edit the textarea and the caller wires its own
`writeDraft`. `onMouseDown preventDefault` on each button preserves the textarea selection.
**Composer autofocus** (desktop only): a per-channel `wantFocusRef` re-attempts focus on open and again once
messages render (the old single timeout lost the race to the load+scroll), and stands down if the cursor is
already somewhere deliberate. ThreadPanel focuses its reply box on `parent.id` change.
**Split screen** (`App.jsx`): the docked `/chat` panel width is drag-resizable via a left-edge handle,
clamped 320–760px, persisted in `localStorage.dock_chat_w`; the iframe goes `pointer-events:none` mid-drag so
it doesn't eat the move events.

## Threads behave like their own channel
Thread replies are **excluded from channel unread** (`parent_id IS NULL` in *both* `channelUnread()` and the
channel-list query in `/channels` — they're separate queries, keep them in step) and counted per-thread
instead via `chat_thread_reads` + `threadUnread()`. `GET /threads` returns `unread` + `last_read_at` per
thread (drives the "N new" badge and the NEW divider), `GET /threads/unread` feeds the sidebar badge, and
`POST /threads/:parentId/read` clears one — fired by opening the ThreadPanel, by Mark read / Mark all read,
and by replying. Unread threads sort first. **`threadUnread()` falls back to the channel's `last_read_at`
when there's no per-thread read row** — otherwise a thread you'd never opened counted its entire history
(hundreds of replies on imported threads), the "phantom huge number" bug. So once you've caught up on the
channel, old thread replies don't linger as unread; only replies since count. In the inbox, **read threads dim (opacity-75) and collapse to a
one-line summary** (parent preview + "N replies · last from X", Expand to reopen) while unread stay open with
the ring + "N new"; a thread you've replied to shows a muted "Replied" chip — so the list is scannable for
what still needs you.

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

## Migration ordering (fresh-DB gotcha)
`addColumnIfMissing()` runs `ALTER TABLE … ADD COLUMN`, which **throws** if the table doesn't exist yet —
`PRAGMA table_info` on a missing table returns empty, so the "missing" check passes and the ALTER blows up.
This only bites a **fresh DB** (new deploy / DR restore); Railway's persistent volume masks it because the
table already exists from an earlier deploy. Keep every column migration **after** its table's CREATE in
boot order. The `chat_push_subscriptions` diagnostic columns were violating this (added in `runMigrations`
before the chat-schema block that creates the table) — a fresh boot went FATAL. Fixed by moving those
five `addColumnIfMissing` calls to right after the chat-schema `db.exec` block. Same pattern documented for
`supply_invoices.extracted_text`.

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
**QuickBooks** (`server/quickbooks.js`) degrades gracefully like storage/ai: pull-only sync of Bills→AP and
Invoices→AR, upserted on `qb_id`; money fields come from QBO, everything else stays local. Refresh tokens
rotate, so the current one is persisted in `app_settings.qbo_refresh_token`. **Env:** `QBO_CLIENT_ID`,
`QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`, `QBO_REALM_ID` (optional `QBO_ENV=sandbox`). Written against QBO
v3 but **not yet exercised against a real company** — verify the pull before building push-back.

## Whole-page EN/ES
`src/lib/usePageTranslation.js` + `src/components/LangToggle.jsx`: pass every string the page shows, get
`tr()` back. Uses the cached `/ai/translate-content` endpoint, so it silently stays English when AI is off.
Wired into Supply Orders, Time Tracking and both finance ledgers; reusable anywhere.

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

## ReadyDoc feedback ("Request" button)
`app_requests` table + `server/api/requests.js` + `src/components/common/RequestBox.jsx`.
**Submitting is deliberately one box and a button** — no title, team, assignee or due date. Every required
field is a reason not to bother, and the request nobody files is the expensive one. `RequestModal` opens from
a **Request** button in the top bar (admins + supervisors), available from any screen.
**Triage is where the structure lives:** `RequestListPanel` in Settings (admin) is an open checklist — tick
to mark done, "Show done" to review, delete to discard. Non-admins only ever see their own submissions.
Deliberately **not** Task Center: app feedback isn't plant work, and mixing it in dilutes the operational
task list. Adding an area is optional and free-text-free (a fixed short list) so triage can group without
making the submitter think.
