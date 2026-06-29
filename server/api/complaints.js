import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { resolved, capa_needed } = req.query;
  let sql = 'SELECT c.*, ca.capa_number, ca.status as capa_status FROM complaints c LEFT JOIN capas ca ON c.capa_id = ca.id WHERE 1=1';
  const params = [];
  if (resolved === 'true') { sql += ' AND c.resolved = 1'; }
  if (resolved === 'false') { sql += ' AND c.resolved = 0'; }
  if (capa_needed === 'true') { sql += ' AND c.capa_needed = 1'; }
  sql += ' ORDER BY c.date_received DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT c.*, ca.capa_number, ca.status as capa_status FROM complaints c LEFT JOIN capas ca ON c.capa_id = ca.id WHERE c.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { complaint_number, date_received, customer_name, lot_number, item_number, complaint_text, person_responsible, investigation, corrective_action, resolved, date_resolved, capa_needed, _actor } = req.body;
  if (!complaint_number || !customer_name || !complaint_text) return res.status(400).json({ error: 'Complaint number, customer name, and complaint text are required' });
  const id = uuid();
  db.prepare(`INSERT INTO complaints (id, complaint_number, date_received, customer_name, lot_number, item_number, complaint_text, person_responsible, investigation, corrective_action, resolved, date_resolved, capa_needed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, complaint_number, date_received || new Date().toISOString().split('T')[0], customer_name,
    lot_number || null, item_number || null, complaint_text, person_responsible || null,
    investigation || null, corrective_action || null, resolved ? 1 : 0, date_resolved || null, capa_needed ? 1 : 0
  );
  logAudit(_actor || 'system', 'complaint_created', 'complaint', id, { complaint_number, customer_name });
  res.status(201).json(db.prepare('SELECT * FROM complaints WHERE id = ?').get(id));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { complaint_number, date_received, customer_name, lot_number, item_number, complaint_text, person_responsible, investigation, corrective_action, resolved, date_resolved, capa_needed, capa_id, _actor } = req.body;
  db.prepare(`UPDATE complaints SET complaint_number=?, date_received=?, customer_name=?, lot_number=?, item_number=?, complaint_text=?, person_responsible=?, investigation=?, corrective_action=?, resolved=?, date_resolved=?, capa_needed=?, capa_id=?, updated_at=datetime('now') WHERE id=?`).run(
    complaint_number || existing.complaint_number, date_received || existing.date_received,
    customer_name || existing.customer_name, lot_number ?? existing.lot_number,
    item_number ?? existing.item_number, complaint_text || existing.complaint_text,
    person_responsible ?? existing.person_responsible, investigation ?? existing.investigation,
    corrective_action ?? existing.corrective_action, resolved !== undefined ? (resolved ? 1 : 0) : existing.resolved,
    date_resolved ?? existing.date_resolved, capa_needed !== undefined ? (capa_needed ? 1 : 0) : existing.capa_needed,
    capa_id ?? existing.capa_id, req.params.id
  );
  logAudit(_actor || 'system', 'complaint_updated', 'complaint', req.params.id, { complaint_number: complaint_number || existing.complaint_number });
  res.json(db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id));
});

// --- CAPA routes ---
router.get('/capas/all', (_req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT ca.*, c.complaint_number, c.customer_name FROM capas ca LEFT JOIN complaints c ON ca.complaint_id = c.id ORDER BY ca.capa_number DESC`).all());
});

router.post('/capas', (req, res) => {
  const db = getDb();
  const { capa_number, complaint_id, title, description, root_cause, corrective_action, preventive_action, proposed_solution, assigned_to, priority, due_date, status, date_issued, item_lot, item_number, item_description, work_order_number, po_number, source_type, immediate_correction, series_of_document, mgmt_verification_date, mgmt_verification_by, nc_number, linked_complaint_number, is_preventive_action, _actor } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  let nextNum = capa_number;
  if (!nextNum) {
    const existing = db.prepare("SELECT capa_number FROM capas ORDER BY capa_number DESC LIMIT 1").get();
    nextNum = 'CAPA-001';
    if (existing) {
      const match = existing.capa_number.match(/(\d+)/);
      if (match) nextNum = `CAPA-${String(parseInt(match[1], 10) + 1).padStart(3, '0')}`;
    }
  }

  const id = uuid();
  db.prepare(`INSERT INTO capas (id, capa_number, complaint_id, title, description, root_cause, corrective_action, preventive_action, proposed_solution, assigned_to, priority, due_date, status, date_issued, item_lot, item_number, item_description, work_order_number, po_number, source_type, immediate_correction, series_of_document, mgmt_verification_date, mgmt_verification_by, nc_number, linked_complaint_number, is_preventive_action)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, nextNum, complaint_id || null, title, description || null,
    root_cause || null, corrective_action || null, preventive_action || null, proposed_solution || null,
    assigned_to || null, priority || 'normal', due_date || null, status || 'open',
    date_issued || null, item_lot || null, item_number || null, item_description || null,
    work_order_number || null, po_number || null, source_type || null,
    immediate_correction || null, series_of_document || null,
    mgmt_verification_date || null, mgmt_verification_by || null,
    nc_number || null, linked_complaint_number || null, is_preventive_action ? 1 : 0
  );

  if (complaint_id) {
    db.prepare("UPDATE complaints SET capa_id = ?, capa_needed = 1, updated_at = datetime('now') WHERE id = ?").run(id, complaint_id);
  }

  logAudit(_actor || 'system', 'capa_created', 'capa', id, { capa_number: nextNum, title });
  res.status(201).json(db.prepare('SELECT * FROM capas WHERE id = ?').get(id));
});

router.put('/capas/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM capas WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, description, root_cause, corrective_action, preventive_action, proposed_solution, assigned_to, status, priority, due_date, verification_notes, date_issued, item_lot, item_number, item_description, work_order_number, po_number, source_type, immediate_correction, series_of_document, mgmt_verification_date, mgmt_verification_by, nc_number, linked_complaint_number, is_preventive_action, _actor } = req.body;

  const newStatus = status || existing.status;
  const closedAt = newStatus === 'closed' && existing.status !== 'closed' ? new Date().toISOString() : existing.closed_at;
  const closedBy = newStatus === 'closed' && existing.status !== 'closed' ? (_actor || 'system') : existing.closed_by;

  db.prepare(`UPDATE capas SET title=?, description=?, root_cause=?, corrective_action=?, preventive_action=?, proposed_solution=?, assigned_to=?, status=?, priority=?, due_date=?, closed_at=?, closed_by=?, verification_notes=?, date_issued=?, item_lot=?, item_number=?, item_description=?, work_order_number=?, po_number=?, source_type=?, immediate_correction=?, series_of_document=?, mgmt_verification_date=?, mgmt_verification_by=?, nc_number=?, linked_complaint_number=?, is_preventive_action=?, updated_at=datetime('now') WHERE id=?`).run(
    title || existing.title, description ?? existing.description, root_cause ?? existing.root_cause,
    corrective_action ?? existing.corrective_action, preventive_action ?? existing.preventive_action,
    proposed_solution ?? existing.proposed_solution,
    assigned_to ?? existing.assigned_to, newStatus, priority || existing.priority,
    due_date ?? existing.due_date, closedAt, closedBy, verification_notes ?? existing.verification_notes,
    date_issued ?? existing.date_issued, item_lot ?? existing.item_lot,
    item_number ?? existing.item_number, item_description ?? existing.item_description,
    work_order_number ?? existing.work_order_number, po_number ?? existing.po_number,
    source_type ?? existing.source_type, immediate_correction ?? existing.immediate_correction,
    series_of_document ?? existing.series_of_document,
    mgmt_verification_date ?? existing.mgmt_verification_date, mgmt_verification_by ?? existing.mgmt_verification_by,
    nc_number ?? existing.nc_number, linked_complaint_number ?? existing.linked_complaint_number,
    is_preventive_action !== undefined ? (is_preventive_action ? 1 : 0) : existing.is_preventive_action,
    req.params.id
  );
  logAudit(_actor || 'system', 'capa_updated', 'capa', req.params.id, { status: newStatus });
  res.json(db.prepare('SELECT * FROM capas WHERE id = ?').get(req.params.id));
});

export default router;
