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
- **Phase 2 (next):** realtime (socket.io/WebSockets) replacing polling.
- **Phase 3:** file uploads (object storage — Cloudflare R2 recommended) + FTS5 keyword search.
- **Phase 4:** embeddings (Voyage AI) → semantic search + cross-module AI digest (membership-scoped).
- **Phase 5:** EN/ES translate-on-display, web push, mentions. Plus: Slack history importer.

## Context: audit log (Phases 1 & 2 shipped)
- `logAudit(actorOrUser, action, entityType, entityId, details, prev, next, entityLabel)` in `server/db.js`.
  Pass the authenticated **`req.user` object** (not `req.user.name`) so `actor_id/role/department` are captured; a
  plain string is still accepted for system/public callers.
- `canonicalAction()` normalizes verbs (`<entity>_created/updated/deleted/…` → create/update/delete/…). Keep new
  actions in that canonical vocabulary.
- Auth events logged in `server/api/users.js`: login, logout, login_failed, login_locked, permission_change.
- Audit API: `server/api/audit.js` (`/`, `/facets`, `/export`, `/entity/:type/:id`); UI `src/components/compliance/AuditLogPanel.jsx`.
