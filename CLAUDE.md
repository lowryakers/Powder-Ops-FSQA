# Powder Ops FSQA — working notes

## Flavor approvals via SMS (Danny)
`flavor_approval` QMS type + FlavorPanel ("Text for approval" row action) → magic link `/approve/<token>`
(public, single-use, ApprovePage.jsx) → decision updates the record + announces in #batching.
**SMS auto-send needs env:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `FLAVOR_APPROVER_PHONE`
(optional `APP_BASE_URL`, default start.powder-ops.com). Without them the link is shown for manual texting.
Future: text-to-AI query layer for Danny rides on the same Twilio setup (inbound webhook needed then).

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
