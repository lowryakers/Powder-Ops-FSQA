import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit } from '../module-access.js';
import { listOptions, fieldDefs, ensureList, normalizeFieldDef, deriveKey } from '../custom-fields.js';
import { KNOWN_SCOPES } from './structure.js';

/**
 * Log Builder — drafting a change to a managed list or a log's custom fields,
 * with an approval gate in front of it.
 *
 * The structure engine (`server/api/structure.js`) already lets a grantee edit
 * lists and fields DIRECTLY — that stays, it's the self-serve layer. This is
 * the supervised path the plant asked for: Document Control drafts the change
 * by COPYING what exists, edits the copy, submits it, and an admin approves
 * before anything touches the live definition. Same shape as the
 * procurement copy/edit flow and the same principle as `controlled.js`: a
 * drafted change is not a live change.
 *
 * ON APPROVAL THE DRAFT IS APPLIED THROUGH THE SAME ENGINE the direct editor
 * uses — `ensureList` semantics for lists, `normalizeFieldDef` for fields — so
 * an approved draft cannot do anything the structure rules forbid. In
 * particular the two compliance rules hold with no extra code here:
 * nothing is deleted (only retired), and keys/values are immutable once made.
 */
const router = Router();

const canDraft = (u) => u?.role === 'admin'
  || hasExplicitEdit(u, 'log-builder')
  || String(u?.department || '').toLowerCase() === 'document_control';
const canApprove = (u) => u?.role === 'admin';

router.use((req, res, next) => {
  if (canDraft(req.user)) return next();
  return res.status(403).json({ error: 'Log Builder access requires the log-builder grant, Document Control, or an admin.' });
});

const rowOut = (r) => ({ ...r, payload: JSON.parse(r.payload || '{}') });

router.get('/drafts', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM log_builder_drafts ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map(r => ({ ...rowOut(r), can_approve: canApprove(req.user) })));
});

/** What can be copied from: every managed list and every known field scope. */
router.get('/sources', (req, res) => {
  const db = getDb();
  const lists = db.prepare('SELECT key, label FROM app_lists ORDER BY label').all();
  res.json({
    lists,
    scopes: KNOWN_SCOPES.map(s => ({ value: s.scope, label: s.label })),
  });
});

/**
 * Start a draft — as a COPY of an existing list/scope, or empty for a new one.
 * People think "start from Receiving's dropdown", not "write a definition".
 */
router.post('/drafts', (req, res) => {
  const db = getDb();
  const { kind, source_key, title } = req.body || {};
  if (!['list', 'fields'].includes(kind)) return res.status(400).json({ error: 'kind must be list or fields' });

  let payload;
  if (kind === 'list') {
    const src = source_key ? db.prepare('SELECT key, label FROM app_lists WHERE key = ?').get(source_key) : null;
    payload = {
      target_key: src?.key || deriveKey(title || 'new list'),
      label: title || src?.label || 'New list',
      // The copy carries the LIVE options so the editor starts from reality.
      options: src ? listOptions(db, src.key).map(o => ({ value: o.value, label: o.label })) : [],
      copied_from: src?.key || null,
    };
  } else {
    const scope = source_key || null;
    if (!scope) return res.status(400).json({ error: 'fields drafts need the scope they apply to' });
    payload = {
      scope,
      fields: fieldDefs(db, scope).map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options || [], required: !!f.required })),
      copied_from: scope,
    };
  }

  const id = uuid();
  db.prepare(`INSERT INTO log_builder_drafts (id, kind, title, payload, status, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?)`)
    .run(id, kind, (title || payload.label || payload.scope || 'Draft').slice(0, 200), JSON.stringify(payload), req.user?.name || null);
  logAudit(req.user, 'create', 'log_builder_draft', id, { kind, source_key }, null, null, title || source_key);
  res.status(201).json(rowOut(db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(id)));
});

router.put('/drafts/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Approved and rejected drafts are records of a decision; edit a new draft.
  if (!['draft', 'submitted'].includes(row.status)) return res.status(400).json({ error: `A ${row.status} draft is closed — start a new one.` });

  const payload = req.body?.payload;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload required' });
  db.prepare("UPDATE log_builder_drafts SET payload = ?, title = COALESCE(?, title), updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(payload), (req.body.title || '').slice(0, 200) || null, row.id);
  res.json(rowOut(db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(row.id)));
});

router.post('/drafts/:id/submit', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') return res.status(400).json({ error: 'Only a draft can be submitted' });
  db.prepare("UPDATE log_builder_drafts SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(row.id);
  logAudit(req.user, 'update', 'log_builder_draft', row.id, { action: 'submitted' }, null, null, row.title);
  res.json(rowOut(db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(row.id)));
});

/**
 * Approve = APPLY, through the same engine the direct editor uses.
 * Additive only: options/fields are created or revived, labels update, and
 * nothing is deleted — removing something stays a deliberate act in the live
 * editor, where the usage counts are.
 */
router.post('/drafts/:id/approve', (req, res) => {
  const db = getDb();
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Only an admin can approve a Log Builder draft.' });
  const row = db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'submitted') return res.status(400).json({ error: 'Only a submitted draft can be approved' });

  const p = JSON.parse(row.payload || '{}');
  const applied = { options: 0, fields: 0 };
  const tx = db.transaction(() => {
    if (row.kind === 'list') {
      // ensureList is idempotent, never overwrites an edited label and never
      // revives a deliberately retired option — the seeder rules, which are
      // exactly right for an approved draft too.
      // The direct editor defaults an option's VALUE to its label, and
      // `ensureList` keys options on the value — two new options with blank
      // values would collide on '' and the second would silently vanish.
      ensureList(db, {
        key: p.target_key, label: p.label, isSystem: false,
        options: (p.options || [])
          .filter(o => (o.label || o.value || '').trim())
          .map(o => ({ value: String(o.value || o.label).trim(), label: String(o.label || o.value).trim() })),
      });
      applied.options = (p.options || []).length;
    } else {
      const existing = fieldDefs(db, p.scope, { includeRetired: true });
      let order = existing.length;
      for (const [i, f] of (p.fields || []).entries()) {
        const match = existing.find(x => x.key === (f.key || deriveKey(f.label, i)));
        if (match) {
          // Label/required updates only — the key is immutable by rule.
          db.prepare("UPDATE custom_field_defs SET label = ?, required = ?, options = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?")
            .run(f.label || match.label, f.required ? 1 : 0, JSON.stringify(f.options || []), match.id);
        } else {
          const def = normalizeFieldDef(f, i);
          db.prepare(`INSERT INTO custom_field_defs (id, scope, key, label, type, options, required, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuid(), p.scope, def.key, def.label, def.type, JSON.stringify(def.options || []), def.required ? 1 : 0, order++);
        }
        applied.fields++;
      }
    }
    db.prepare("UPDATE log_builder_drafts SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(req.user.name, row.id);
  });
  tx();
  logAudit(req.user, 'approve', 'log_builder_draft', row.id, { kind: row.kind, applied }, null, null, row.title);
  res.json({ ...rowOut(db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(row.id)), applied });
});

router.post('/drafts/:id/reject', (req, res) => {
  const db = getDb();
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Only an admin can decide on a draft.' });
  const row = db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'submitted') return res.status(400).json({ error: 'Only a submitted draft can be rejected' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why — the drafter needs to know what to change.' });
  db.prepare("UPDATE log_builder_drafts SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now') WHERE id = ?")
    .run(req.user.name, reason, row.id);
  logAudit(req.user, 'update', 'log_builder_draft', row.id, { action: 'rejected', reason }, null, null, row.title);
  res.json(rowOut(db.prepare('SELECT * FROM log_builder_drafts WHERE id = ?').get(row.id)));
});

export default router;
