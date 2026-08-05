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
**QuickBooks** (`server/quickbooks.js`) degrades gracefully like storage/ai: pull-only sync of Bills→AP and
Invoices→AR, upserted on `qb_id`; money fields come from QBO, everything else stays local. Refresh tokens
rotate, so the current one is persisted in `app_settings.qbo_refresh_token`. **Env:** `QBO_CLIENT_ID`,
`QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`, `QBO_REALM_ID` (optional `QBO_ENV=sandbox`). Written against QBO
v3 but **not yet exercised against a real company** — verify the pull before building push-back.

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

## Room 8 is gone from the schedule
`ROOM_SECTIONS` in ProductionSchedule.jsx lost `'8-1'` / `'8-2'` — Room 8 isn't on the facility map, and what
ran there is Batching Room 3, which already has its own row. Rooms come from that constant, so removing one
would make anything still scheduled there **invisible rather than gone**; the `unplaced` banner at the top of
the schedule names any assignment filed against a room with no row, so a removal can't silently strand work.

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
