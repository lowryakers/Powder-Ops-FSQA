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

## Context: audit log (Phases 1 & 2 shipped)
- `logAudit(actorOrUser, action, entityType, entityId, details, prev, next, entityLabel)` in `server/db.js`.
  Pass the authenticated **`req.user` object** (not `req.user.name`) so `actor_id/role/department` are captured; a
  plain string is still accepted for system/public callers.
- `canonicalAction()` normalizes verbs (`<entity>_created/updated/deleted/…` → create/update/delete/…). Keep new
  actions in that canonical vocabulary.
- Auth events logged in `server/api/users.js`: login, logout, login_failed, login_locked, permission_change.
- Audit API: `server/api/audit.js` (`/`, `/facets`, `/export`, `/entity/:type/:id`); UI `src/components/compliance/AuditLogPanel.jsx`.
