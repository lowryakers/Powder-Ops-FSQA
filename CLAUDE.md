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
**CheckedOutPanel read only `maintenance_sign_out`**, so a knife signed out on 440-02 never appeared in
"what's out" — the one question that screen exists to answer. It queries both now.

## QMS records: who may change a filed record
`server/api/qms.js` — **filing stays open on purpose** (anyone who sees a deviation should be able to
report it), everything after that is records integrity. `mayEdit()`: the filer while unsigned, plus
admin/supervisor/QA/document_control; **any approval signature closes the record to everyone but an admin**.
`mayDelete()`: admin only, and **never once signed** — a signed record is changed by status, not removed
(bulk-delete skips signed rows and reports `skipped_signed` rather than taking the selection down with it).
`bulk-update` needs a records role; CSV `import` is admin-only.
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

## QA Review Center — one queue, four modules
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
**QMS records and disposals are deliberately excluded** — those are multi-party approvals with an e-signature
intent statement, and approving one is a decision about product that belongs on the record beside the
investigation, not on a checkbox in a list.

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
app just never asked again. A module now calls `notifyDataChanged()` after a write that could move a count,
and App also refetches on `visibilitychange` → visible (someone else's work moves the same numbers while
you're in another tab). Deliberately a payloadless event: the badge query is server-side and cheap, and a
module shouldn't have to know which of its writes feeds which badge. **Wire new count-moving writes to it.**

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

## Recurring QA checks that ship pre-scheduled
`SEED_SCHEDULES` in `server/api/quality-schedules.js` + `seedQualitySchedules(db)` (called from server.js).
Seeded **once, keyed on title** — an edited frequency, a paused schedule or a deleted one is a decision, and
a redeploy must not undo it. Currently: **Tap Water Testing** (monthly, Environmental Monitoring — restroom
and kitchen samples to the outside lab). Everything else stays user-created in Quality Schedules.

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
