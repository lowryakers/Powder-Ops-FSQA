// Controlled definitions — change control for the things a document change
// request would cover.
//
// The rule the plant agreed: a change to a controlled definition does not take
// effect until Document Control approves it. Most of these ship in the code, so
// "does not take effect" cannot mean "is not deployed" — by the time the app is
// running the code is already there. It means the app keeps serving the LAST
// APPROVED version and parks the new one for review.
//
// Concretely: add a field to a QMS form, deploy, and the form keeps the old
// field set until it's approved. The record still stores whatever arrives; only
// the definition is gated. That is the conservative direction — a filed record
// is never invalidated by a definition that hasn't been approved yet.
//
// Two things this must never do:
//   1. Block a brand-new database. The first time a definition is seen it is
//      recorded as the approved baseline, silently. Otherwise the release that
//      introduces change control comes up with every form blank.
//   2. Lose a filed record. Nothing here touches qms_records; the gate is only
//      over the definition the form and the log render from.

import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { QMS_TYPES } from './qms-config.js';
import { SCALE_FORMS } from './scale-forms.js';

// Stable hash of a definition: keys sorted, so a reordered object literal in
// the source doesn't read as a change someone has to approve.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o; }, {});
  }
  return value;
}
export function hashOf(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex').slice(0, 32);
}

// ── The registry ────────────────────────────────────────────────────────────
// One entry per controlled definition. `current()` reads the code; `apply()`
// puts an approved snapshot back so every consumer serves the approved version
// without knowing this module exists.
//
// Scopes deliberately NOT here: managed lists and custom fields (Log
// Structure). Those are the self-serve layer, and putting Document Control in
// front of adding a dropdown option is how people stop using it.

// What of a QMS form is controlled: the fields it captures, the columns the log
// shows, and the form code printed on the record. Not the label or the module
// id — those are wiring, not the document.
const qmsSnapshot = (cfg) => ({
  fields: cfg.fields, logColumns: cfg.logColumns, formCode: cfg.formCode,
});

function qmsEntries() {
  return Object.values(QMS_TYPES).map(cfg => ({
    scope: 'qms_form',
    key: cfg.key,
    label: `${cfg.label}${cfg.formCode ? ` (${cfg.formCode})` : ''}`,
    current: () => qmsSnapshot(cfg),
    apply: (snap) => {
      // Mutate the live config object in place: getType() and every consumer
      // (form, log, record view, Auditor View, CSV import) then serve the
      // approved definition with no further wiring.
      if (Array.isArray(snap.fields)) cfg.fields = snap.fields;
      if (Array.isArray(snap.logColumns)) cfg.logColumns = snap.logColumns;
      if (typeof snap.formCode === 'string') cfg.formCode = snap.formCode;
    },
  }));
}

// Scale tolerances: the number IS the compliance decision, which is why they
// were never editable in Settings. Same reason they're gated here.
function scaleEntries() {
  return SCALE_FORMS.map(form => ({
    scope: 'acceptance',
    key: `scale:${form.code}`,
    label: `${form.title || form.code} tolerances`,
    current: () => ({ points: form.points }),
    apply: (snap) => { if (Array.isArray(snap.points)) form.points = snap.points; },
  }));
}

export function registry() {
  return [...qmsEntries(), ...scaleEntries()];
}

// ── Boot: baseline, detect, gate ────────────────────────────────────────────

const SELECT = 'SELECT * FROM controlled_definitions WHERE scope = ? AND key = ?';

/**
 * Called once at startup, after the schema exists.
 *
 * For each definition: unchanged → apply the approved snapshot and move on;
 * never seen → record it as the approved baseline; changed → park the new
 * version as pending and keep serving the approved one.
 *
 * Returns the entries that newly became pending, so the caller can raise the
 * change requests and tell Document Control.
 */
export function syncDefinitions(db) {
  const newlyPending = [];
  const ins = db.prepare(`INSERT INTO controlled_definitions
    (id, scope, key, label, approved_hash, approved_snapshot, approved_at, approved_by, version, status)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'baseline', 1, 'approved')`);
  const setPending = db.prepare(`UPDATE controlled_definitions
    SET pending_hash = ?, pending_snapshot = ?, pending_seen_at = datetime('now'), status = 'pending', label = ?
    WHERE id = ?`);
  const touchLabel = db.prepare('UPDATE controlled_definitions SET label = ? WHERE id = ?');

  for (const entry of registry()) {
    let snapshot;
    try { snapshot = entry.current(); } catch { continue; }
    const hash = hashOf(snapshot);
    const row = db.prepare(SELECT).get(entry.scope, entry.key);

    if (!row) {
      // First sight of this definition — it IS the baseline. Silent on purpose:
      // a fresh database (or the release that introduces this) must not come up
      // with every form waiting on an approval nobody knew to give.
      ins.run(uuid(), entry.scope, entry.key, entry.label, hash, JSON.stringify(snapshot));
      continue;
    }

    if (row.approved_hash === hash) {
      // The code matches what's approved. Nothing to serve from the snapshot,
      // but clear any stale pending row left by a reverted deploy.
      if (row.status === 'pending') {
        db.prepare("UPDATE controlled_definitions SET pending_hash = NULL, pending_snapshot = NULL, pending_seen_at = NULL, pending_dcr_id = NULL, status = 'approved' WHERE id = ?").run(row.id);
      }
      if (row.label !== entry.label) touchLabel.run(entry.label, row.id);
      continue;
    }

    // Changed. Serve the approved version and park this one.
    try { entry.apply(JSON.parse(row.approved_snapshot)); } catch { /* keep code as-is if unreadable */ }
    if (row.pending_hash !== hash) {
      setPending.run(hash, JSON.stringify(snapshot), entry.label, row.id);
      newlyPending.push({ ...entry, id: row.id, hash, snapshot, approved: safeParse(row.approved_snapshot) });
    }
  }
  return newlyPending;
}

function safeParse(raw) { try { return JSON.parse(raw || 'null'); } catch { return null; } }

/** Promote the pending version. The definition takes effect immediately. */
export function approveDefinition(db, id, user) {
  const row = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(id);
  if (!row) return { error: 'Not found' };
  // 'rejected' is approvable too: denied because the revision wasn't issued
  // yet, then it is — that shouldn't need a redeploy to become approvable.
  if (!row.pending_snapshot || !['pending', 'rejected'].includes(row.status)) {
    return { error: 'Nothing is waiting on approval for this definition.' };
  }
  const snapshot = safeParse(row.pending_snapshot);
  db.prepare(`UPDATE controlled_definitions SET approved_hash = pending_hash, approved_snapshot = pending_snapshot,
      approved_at = datetime('now'), approved_by = ?, version = version + 1,
      pending_hash = NULL, pending_snapshot = NULL, pending_seen_at = NULL, status = 'approved',
      rejected_at = NULL, rejected_by = NULL, rejected_reason = NULL
    WHERE id = ?`).run(user?.name || 'system', id);
  const entry = registry().find(e => e.scope === row.scope && e.key === row.key);
  if (entry && snapshot) { try { entry.apply(snapshot); } catch { /* next boot will settle it */ } }
  return { ok: true, row: db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(id) };
}

/**
 * Deny it. The approved version keeps being served, which is the whole point —
 * but be honest about what this does NOT do: the code is still deployed, so
 * undoing it for real is a code change. Denying keeps the app on the approved
 * definition until then.
 */
export function rejectDefinition(db, id, user, reason) {
  const row = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(id);
  if (!row) return { error: 'Not found' };
  if (row.status !== 'pending') return { error: 'Nothing is waiting on approval for this definition.' };
  db.prepare(`UPDATE controlled_definitions SET status = 'rejected', rejected_at = datetime('now'),
      rejected_by = ?, rejected_reason = ? WHERE id = ?`).run(user?.name || 'system', String(reason || '').trim() || null, id);
  return { ok: true, row: db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(id) };
}

/** Field-by-field difference, so a reviewer sees the change and not two blobs. */
export function diffSnapshots(approved, pending) {
  const out = [];
  const a = approved || {}, b = pending || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (k === 'fields') { out.push(...diffFields(a.fields || [], b.fields || [])); continue; }
    const av = JSON.stringify(a[k]), bv = JSON.stringify(b[k]);
    if (av !== bv) out.push({ kind: 'changed', what: k, from: a[k], to: b[k] });
  }
  return out;
}

function diffFields(a, b) {
  const byKey = (list) => new Map(list.map(f => [f.key, f]));
  const A = byKey(a), B = byKey(b), out = [];
  for (const [k, f] of B) {
    if (!A.has(k)) out.push({ kind: 'added', what: `field ${k}`, to: f.label || k });
    else if (JSON.stringify(stable(A.get(k))) !== JSON.stringify(stable(f))) {
      out.push({ kind: 'changed', what: `field ${k}`, from: A.get(k), to: f });
    }
  }
  for (const [k, f] of A) if (!B.has(k)) out.push({ kind: 'removed', what: `field ${k}`, from: f.label || k });
  return out;
}

export function pendingCount(db) {
  try { return db.prepare("SELECT COUNT(*) c FROM controlled_definitions WHERE status = 'pending'").get().c; }
  catch { return 0; }
}
