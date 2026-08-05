// Self-serve structure API: the screens that let the team change what a log
// captures without a deploy. Two resources — managed dropdown lists, and custom
// field definitions per scope.
//
// Everything here is gated on `canEditStructure` and audit-logged: changing the
// shape of a compliance record is a controlled-document-level act, so who did it
// and what changed has to be answerable.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit } from '../module-access.js';
import {
  listOptions, fieldDefs, normalizeFieldDef, FIELD_TYPES, parseJson,
} from '../custom-fields.js';

const router = Router();

// Admin, or an explicit edit grant on the grantable 'log-builder' module — so
// a QA lead can own form structure without being handed full admin.
const canEditStructure = (u) => u?.role === 'admin' || hasExplicitEdit(u, 'log-builder');
function requireStructure(req, res) {
  if (canEditStructure(req.user)) return true;
  res.status(403).json({ error: 'Changing log structure requires admin or a Log Builder edit grant (Settings).' });
  return false;
}

/* ── Managed lists ───────────────────────────────────────────────────────── */

// Every list with its live option count. Drives the Lists admin screen.
router.get('/lists', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM app_list_options o WHERE o.list_key = l.key AND o.is_active = 1) AS option_count
    FROM app_lists l ORDER BY l.label
  `).all();
  res.json(rows.map(r => ({ ...r, is_system: !!r.is_system })));
});

// Options for one list. Retired options are included only for editors, who need
// to see them to un-retire; everyone else gets the live set.
router.get('/lists/:key', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM app_lists WHERE key = ?').get(req.params.key);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const includeRetired = req.query.all === '1' && canEditStructure(req.user);
  res.json({ ...list, is_system: !!list.is_system, options: listOptions(db, req.params.key, { includeRetired }) });
});

router.post('/lists', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const key = String(req.body?.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const label = String(req.body?.label || '').trim();
  if (!key || !label) return res.status(400).json({ error: 'key and label are required' });
  if (db.prepare('SELECT 1 FROM app_lists WHERE key = ?').get(key)) {
    return res.status(409).json({ error: 'A list with that key already exists.' });
  }
  db.prepare('INSERT INTO app_lists (key, label, description, is_system, updated_by) VALUES (?, ?, ?, 0, ?)')
    .run(key, label, String(req.body?.description || '').trim() || null, req.user?.name || null);
  logAudit(req.user, 'create', 'app_list', key, { label }, null, null, label);
  res.status(201).json(db.prepare('SELECT * FROM app_lists WHERE key = ?').get(key));
});

router.put('/lists/:key', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_lists WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'List not found' });
  const label = String(req.body?.label || '').trim() || existing.label;
  const description = req.body?.description !== undefined
    ? (String(req.body.description || '').trim() || null) : existing.description;
  db.prepare("UPDATE app_lists SET label = ?, description = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?")
    .run(label, description, req.user?.name || null, req.params.key);
  logAudit(req.user, 'update', 'app_list', req.params.key, { label }, existing, null, label);
  res.json(db.prepare('SELECT * FROM app_lists WHERE key = ?').get(req.params.key));
});

// Add an option. The stored `value` is fixed at creation — later label edits
// don't touch it, so records already referencing it keep resolving.
router.post('/lists/:key/options', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const list = db.prepare('SELECT * FROM app_lists WHERE key = ?').get(req.params.key);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label is required' });
  const value = String(req.body?.value || label).trim();

  const clash = db.prepare('SELECT * FROM app_list_options WHERE list_key = ? AND value = ?').get(req.params.key, value);
  if (clash) {
    // Re-adding something that was retired should revive it, not fail — the
    // team thinks of it as "add Break Room back", not "resurrect a row".
    if (!clash.is_active) {
      db.prepare("UPDATE app_list_options SET is_active = 1, label = ?, updated_at = datetime('now') WHERE id = ?")
        .run(label, clash.id);
      logAudit(req.user, 'update', 'app_list_option', clash.id, { revived: true, label }, clash, null, `${list.label}: ${label}`);
      return res.status(200).json({ ...clash, label, is_active: true, revived: true });
    }
    return res.status(409).json({ error: `"${label}" is already in this list.` });
  }

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) n FROM app_list_options WHERE list_key = ?').get(req.params.key).n;
  const id = uuid();
  db.prepare('INSERT INTO app_list_options (id, list_key, value, label, sort_order, meta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.key, value, label, maxOrder + 1, req.body?.meta ? JSON.stringify(req.body.meta) : null);
  logAudit(req.user, 'create', 'app_list_option', id, { list: req.params.key, label, value }, null, null, `${list.label}: ${label}`);
  res.status(201).json(db.prepare('SELECT * FROM app_list_options WHERE id = ?').get(id));
});

// Edit an option's label / order / active state. `value` is intentionally not
// editable — see the module header in custom-fields.js.
router.put('/lists/:key/options/:id', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_list_options WHERE id = ? AND list_key = ?').get(req.params.id, req.params.key);
  if (!existing) return res.status(404).json({ error: 'Option not found' });
  const label = String(req.body?.label || '').trim() || existing.label;
  const sort_order = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : existing.sort_order;
  const is_active = req.body?.is_active === undefined ? existing.is_active : (req.body.is_active ? 1 : 0);
  const meta = req.body?.meta !== undefined ? (req.body.meta ? JSON.stringify(req.body.meta) : null) : existing.meta;
  db.prepare("UPDATE app_list_options SET label = ?, sort_order = ?, is_active = ?, meta = ?, updated_at = datetime('now') WHERE id = ?")
    .run(label, sort_order, is_active, meta, req.params.id);
  logAudit(req.user, is_active ? 'update' : 'retire', 'app_list_option', req.params.id,
    { label, is_active: !!is_active }, existing, null, label);
  res.json(db.prepare('SELECT * FROM app_list_options WHERE id = ?').get(req.params.id));
});

// Persist a drag-reorder in one call.
router.post('/lists/:key/reorder', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE app_list_options SET sort_order = ? WHERE id = ? AND list_key = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, req.params.key)))();
  res.json({ ok: true, options: listOptions(db, req.params.key, { includeRetired: true }) });
});

/* ── Custom fields ───────────────────────────────────────────────────────── */

// Scopes the UI offers in the field editor. A scope is just a string, but
// listing the known ones keeps the picker honest and self-documenting.
export const KNOWN_SCOPES = [
  { scope: 'receiving_log', label: 'Receiving Log' },
  { scope: 'qms:deviation', label: 'Quality Events — Deviation' },
  { scope: 'qms:non_conformance', label: 'Quality Events — Non-Conformance' },
  { scope: 'qms:on_hold', label: 'Quality Events — On Hold' },
  { scope: 'supply_order', label: 'Supply Orders' },
  { scope: 'disposal', label: 'Disposals' },
  { scope: 'meeting', label: 'Meetings' },
  { scope: 'internal_audit', label: 'Internal Audits' },
  { scope: 'retention_sample', label: 'Retention Samples' },
  { scope: 'reimbursement', label: 'Reimbursements' },
];

router.get('/scopes', (req, res) => {
  const db = getDb();
  res.json(KNOWN_SCOPES.map(s => ({
    ...s,
    field_count: db.prepare('SELECT COUNT(*) n FROM custom_field_defs WHERE scope = ? AND is_active = 1').get(s.scope).n,
  })));
});

router.get('/fields/:scope', (req, res) => {
  const db = getDb();
  const includeRetired = req.query.all === '1' && canEditStructure(req.user);
  res.json(fieldDefs(db, req.params.scope, { includeRetired }));
});

router.post('/fields/:scope', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const scope = req.params.scope;
  const count = db.prepare('SELECT COUNT(*) n FROM custom_field_defs WHERE scope = ?').get(scope).n;
  const def = normalizeFieldDef(req.body, count);
  if (!FIELD_TYPES.has(def.type)) return res.status(400).json({ error: 'Unknown field type.' });

  const clash = db.prepare('SELECT * FROM custom_field_defs WHERE scope = ? AND key = ?').get(scope, def.key);
  if (clash) {
    if (!clash.is_active) {
      db.prepare("UPDATE custom_field_defs SET is_active = 1, label = ?, updated_at = datetime('now') WHERE id = ?")
        .run(def.label, clash.id);
      logAudit(req.user, 'update', 'custom_field', clash.id, { revived: true, scope, label: def.label }, clash, null, def.label);
      return res.json({ ...clash, label: def.label, is_active: 1, revived: true });
    }
    return res.status(409).json({ error: `A field named "${def.label}" already exists on this log.` });
  }

  const id = uuid();
  db.prepare(`INSERT INTO custom_field_defs
    (id, scope, key, label, type, options_list_key, options, required, help_text, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, scope, def.key, def.label, def.type, def.options_list_key, def.options,
      def.required, def.help_text, def.sort_order, req.user?.name || null);
  logAudit(req.user, 'create', 'custom_field', id, { scope, key: def.key, label: def.label, type: def.type }, null, null, def.label);
  res.status(201).json(db.prepare('SELECT * FROM custom_field_defs WHERE id = ?').get(id));
});

router.put('/fields/:scope/:id', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM custom_field_defs WHERE id = ? AND scope = ?').get(req.params.id, req.params.scope);
  if (!existing) return res.status(404).json({ error: 'Field not found' });
  // Key stays put across every edit; data already written under it must keep
  // resolving no matter how the label changes.
  const def = normalizeFieldDef({ ...existing, ...req.body }, existing.sort_order, existing.key);
  const is_active = req.body?.is_active === undefined ? existing.is_active : (req.body.is_active ? 1 : 0);
  db.prepare(`UPDATE custom_field_defs SET label = ?, type = ?, options_list_key = ?, options = ?,
              required = ?, help_text = ?, sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(def.label, def.type, def.options_list_key, def.options, def.required, def.help_text,
      def.sort_order, is_active, req.params.id);
  logAudit(req.user, is_active ? 'update' : 'retire', 'custom_field', req.params.id,
    { scope: req.params.scope, label: def.label, is_active: !!is_active }, existing, null, def.label);
  res.json(db.prepare('SELECT * FROM custom_field_defs WHERE id = ?').get(req.params.id));
});

router.post('/fields/:scope/reorder', (req, res) => {
  if (!requireStructure(req, res)) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE custom_field_defs SET sort_order = ? WHERE id = ? AND scope = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, req.params.scope)))();
  res.json(fieldDefs(db, req.params.scope, { includeRetired: true }));
});

// How many filed records already carry a value for this field — shown in the
// editor before someone retires it, so "12 records use this" is visible at the
// moment of the decision rather than discovered later.
router.get('/fields/:scope/:id/usage', (req, res) => {
  const db = getDb();
  const def = db.prepare('SELECT * FROM custom_field_defs WHERE id = ? AND scope = ?').get(req.params.id, req.params.scope);
  if (!def) return res.status(404).json({ error: 'Field not found' });
  const table = SCOPE_TABLES[req.params.scope.split(':')[0]];
  if (!table) return res.json({ count: null });
  try {
    const rows = db.prepare(`SELECT custom_data FROM ${table} WHERE custom_data IS NOT NULL`).all();
    const count = rows.filter(r => {
      const d = parseJson(r.custom_data, null);
      return d && d[def.key] !== undefined && d[def.key] !== '' && d[def.key] !== null;
    }).length;
    res.json({ count });
  } catch { res.json({ count: null }); }
});

// Scope prefix → host table holding the custom_data column.
const SCOPE_TABLES = {
  receiving_log: 'receiving_log',
  qms: 'qms_records',
  supply_order: 'supply_orders',
  meeting: 'meetings',
  internal_audit: 'internal_audits',
  disposal: 'disposals',
  retention_sample: 'retention_samples',
  reimbursement: 'reimbursements',
};

export default router;
