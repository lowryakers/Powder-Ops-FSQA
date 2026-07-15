# Powder Ops FSQA — working notes

## Deferred / future work — remind the user when relevant

### Phase 3: Team Activity / efficiency dashboard  (PAUSED — do not build without asking)
The user paused this and asked to be **reminded whenever we touch anything similar or relevant.**

**Surface the reminder when work touches any of:**
- The Production Dashboard, Production KPIs, or any new dashboard/analytics/reporting view.
- The audit log, or anything about "who did what," activity tracking, or productivity/efficiency metrics.
- Task-timing data (work orders, checklist submissions, production entries — `created_at` → `completed_at`/`completed_by`), or any per-person / per-team performance rollup.

**When reminding, restate the agreed shape so the decision is easy:**
- Build it as a **new "Team Activity" view** (Compliance/admin area) — *not* folded into the Production Dashboard (different audience: operational "on track today" vs. managerial "how is the team performing").
- Metrics come from the **operational task-timing tables, not the audit log.** The audit log is the immutable compliance trail; Phase 1 gave it cleaner actor identity to help *correlate*, but the numbers come from work orders / submissions / production entries.
- **Sensitivity guard:** aggregate-by-default (team/department/shift rollups) with **admin-gated** drill-down to individual detail, to avoid a per-person surveillance/scoreboard feel.

### Comms → compliance-record crossover  (DEFERRED — later phase, remind when relevant)
The user wants the ability to promote a chat message into a compliance record (e.g. a message becomes
a deviation / CAPA / NC entry, or gets attached to one) but judged it "overly complex" for now and asked
to be **reminded when something relevant comes up or where it would fit naturally.**

**Surface the reminder when work touches any of:**
- The Comms module (channels/messages/threads/DMs) gaining new capabilities.
- QMS record creation flows (deviations, non-conformance, CAPA, on-hold, disposals) — anywhere a record is opened from context.
- Any "attach evidence / source / provenance" affordance, or linking free-form discussion to a formal record.

**Agreed shape when it lands:** a message action ("Convert to record" / "Attach to record") that opens the
relevant QMS form pre-filled from the message + author + timestamp, and back-links the record to the source
message for an audit trail. Membership/access on the source channel must be respected.

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
- **Phase 5:** EN/ES translate-on-display, web push, mentions. Plus: **installable PWA** (add-to-home-screen +
  web push; Capacitor later only if App/Play Store listings are wanted).

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
