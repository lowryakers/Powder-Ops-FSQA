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

## Threads behave like their own channel
Thread replies are **excluded from channel unread** (`parent_id IS NULL` in *both* `channelUnread()` and the
channel-list query in `/channels` — they're separate queries, keep them in step) and counted per-thread
instead via `chat_thread_reads` + `threadUnread()`. `GET /threads` returns `unread` + `last_read_at` per
thread (drives the "N new" badge and the NEW divider), `GET /threads/unread` feeds the sidebar badge, and
`POST /threads/:parentId/read` clears one — fired by opening the ThreadPanel, by Mark read / Mark all read,
and by replying. Unread threads sort first.

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
