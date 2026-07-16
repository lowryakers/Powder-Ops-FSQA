import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { getType } from '../qms-config.js';

const router = Router();

router.get('/equipment-list', (_req, res) => {
  const db = getDb();
  const equipment = db.prepare("SELECT id, name, type, location, asset_id FROM equipment WHERE status = 'active' ORDER BY name").all();
  res.json(equipment);
});

router.post('/work-order', (req, res) => {
  const db = getDb();
  const { equipment_id, title, description, priority, submitted_by, attachments } = req.body;

  if (!title || !submitted_by || !equipment_id) {
    return res.status(400).json({ error: 'title, submitted_by, and equipment are required' });
  }

  const id = uuid();
  const due_date = new Date();
  due_date.setDate(due_date.getDate() + 7);

  db.prepare(`
    INSERT INTO work_orders (id, equipment_id, title, description, priority, assigned_to, due_date, attachments, task_group)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'maintenance')
  `).run(id, equipment_id, title, description || null, priority || 'normal', due_date.toISOString().split('T')[0], JSON.stringify(attachments || []));

  logAudit(submitted_by, 'submit_public', 'work_order', id, { title, submitted_by }, null, null, title);
  res.status(201).json({ id, message: 'Work order submitted successfully' });
});

// ── QMS kiosk helpers ─────────────────────────────────────────────────────────
function parseJson(raw, fallback) { if (!raw) return fallback; try { return JSON.parse(raw); } catch { return fallback; } }

// Next sequential record number for a QMS type (mirrors qms.js nextNumber).
function nextNumber(db, cfg) {
  const rows = db.prepare('SELECT record_number FROM qms_records WHERE record_type = ?').all(cfg.key);
  let max = 0;
  for (const r of rows) {
    const m = String(r.record_number || '').match(/\d+/g);
    if (m) max = Math.max(max, parseInt(m[m.length - 1], 10));
  }
  return (cfg.numberPrefix || '') + String(max + 1).padStart(cfg.numberPad || 3, '0');
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Knife / Blade kiosk ───────────────────────────────────────────────────────
// Public roster of registered knives so a floor user can pick theirs. Excludes
// decommissioned tools. Returns just enough to render + toggle each one.
router.get('/knife-list', (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM qms_records WHERE record_type = 'knife_accountability' AND (status IS NULL OR status != 'decommissioned') ORDER BY record_number").all();
  const list = rows.map(r => {
    const data = parseJson(r.data, {});
    return {
      id: r.id,
      record_number: r.record_number,
      tool_id: data.tool_id || r.record_number,
      status: r.status || 'available',
      issued_to: data.issued_to || null,
    };
  });
  res.json(list);
});

// Check a knife out (Available → Issued) or back in (Issued → Available). The
// tool record holds current state (so the Master List stays accurate) and every
// transaction is written to the immutable audit trail for full history.
router.post('/knife', (req, res) => {
  const db = getDb();
  const { record_id, person, condition } = req.body;
  const name = (person || '').trim();
  if (!record_id || !name) return res.status(400).json({ error: 'Please pick a knife and enter your name.' });

  const row = db.prepare("SELECT * FROM qms_records WHERE id = ? AND record_type = 'knife_accountability'").get(record_id);
  if (!row) return res.status(404).json({ error: 'Knife not found' });
  if (row.status === 'decommissioned') return res.status(400).json({ error: 'This knife has been decommissioned.' });

  const data = parseJson(row.data, {});
  const wasIssued = row.status === 'issued';
  const action = wasIssued ? 'in' : 'out';
  const cond = condition === 'Bad' ? 'Bad' : 'Good';

  if (wasIssued) {
    // Check in: clear the holder, record who returned it + condition.
    data.returned_by = name;
    data.condition = cond;
    data.issued_to = '';
  } else {
    // Check out: record the new holder + condition.
    data.issued_to = name;
    data.condition = cond;
    data.returned_by = '';
  }

  db.prepare("UPDATE qms_records SET status = ?, data = ?, record_date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(wasIssued ? 'available' : 'issued', JSON.stringify(data), today(), record_id);

  logAudit(name, action === 'out' ? 'knife_check_out' : 'knife_check_in', 'knife_accountability', record_id,
    { tool_id: data.tool_id || row.record_number, condition: cond, via: 'kiosk' }, null, null, data.tool_id || row.record_number);

  res.status(201).json({ ok: true, action, tool_id: data.tool_id || row.record_number, condition: cond });
});

// ── Component Sign In/Out kiosk ───────────────────────────────────────────────
// Suggestion lists (item names / part numbers seen before) for quick entry.
router.get('/component-options', (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT data FROM qms_records WHERE record_type = 'component_sign_out'").all();
  const items = new Set(), parts = new Set();
  for (const r of rows) {
    const d = parseJson(r.data, {});
    if (d.item_name) items.add(d.item_name);
    if (d.part_number) parts.add(d.part_number);
  }
  res.json({ item_names: [...items].sort(), part_numbers: [...parts].sort() });
});

// Log a component sign-out (or sign-in) as a new record awaiting in-app WH/QA
// approval. `person` is the typed name at the kiosk.
router.post('/component-signout', (req, res) => {
  const db = getDb();
  const cfg = getType('component_sign_out');
  const { direction, item_name, part_number, lot_number, qty_pulled, person } = req.body;
  const name = (person || '').trim();
  if (!name || !item_name || !String(item_name).trim()) {
    return res.status(400).json({ error: 'Item name and your name are required.' });
  }

  const id = uuid();
  const number = nextNumber(db, cfg);
  const data = {
    direction: direction === 'In' ? 'In' : 'Out',
    item_name: String(item_name).trim(),
    part_number: part_number || '',
    lot_number: lot_number || '',
    qty_pulled: qty_pulled || '',
    signed_by: name,
  };

  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
    VALUES (?, 'component_sign_out', ?, ?, NULL, ?, 0, ?)`).run(id, number, today(), JSON.stringify(data), name);

  logAudit(name, 'submit_public', 'component_sign_out', id,
    { record_number: number, direction: data.direction, item_name: data.item_name, via: 'kiosk' }, null, null, data.item_name);

  res.status(201).json({ ok: true, record_number: number, direction: data.direction });
});

// ── Maintenance Sign In/Out kiosk ─────────────────────────────────────────────
// The editable tool list (same one managed in the app) for the kiosk dropdown.
router.get('/maintenance-items', (_req, res) => {
  const db = getDb();
  let items = [];
  try { items = db.prepare('SELECT name FROM maintenance_items ORDER BY sort_order, name').all().map(r => r.name); } catch { /* table optional */ }
  res.json({ items });
});

// Sign a tool out from the floor kiosk — creates a record (status Out) awaiting
// the in-app QA return/review. `employee_name` is the typed name at the kiosk.
router.post('/maintenance-signout', (req, res) => {
  const db = getDb();
  const cfg = getType('maintenance_sign_out');
  const { employee_name, item_description, asset_tag, condition_out, time_out } = req.body;
  const name = (employee_name || '').trim();
  const item = (item_description || '').trim();
  if (!name || !item) return res.status(400).json({ error: 'Item and your name are required.' });

  const id = uuid();
  const number = nextNumber(db, cfg);
  const data = {
    employee_name: name,
    item_description: item,
    asset_tag: asset_tag || '',
    condition_out: condition_out === 'Bad' ? 'Bad' : 'Good',
    time_out: time_out || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
    VALUES (?, 'maintenance_sign_out', ?, ?, 'out', ?, 0, ?)`).run(id, number, today(), JSON.stringify(data), name);

  logAudit(name, 'submit_public', 'maintenance_sign_out', id,
    { record_number: number, item_description: item, via: 'kiosk' }, null, null, item);

  res.status(201).json({ ok: true, record_number: number, item_description: item });
});

export default router;
