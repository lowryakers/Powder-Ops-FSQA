import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { documentOwned, guardCcpEdit, PC_LOCK_MESSAGE, PC_OWNED_FIELDS, PC_DOCUMENT, PC_REVISION } from '../preventive-controls.js';

const router = Router();

// CCP definitions are food-safety-plan content: writable by admins,
// supervisors, or QA; readable by anyone authenticated (the equipment form
// needs the list for its link dropdown).
function canManageCcps(u) {
  return !!u && (['admin', 'supervisor'].includes(u.role) || u.department === 'qa');
}

// The four preventive controls are TRANSCRIBED from Protocol 003 (D-022), so
// the client is told which rows the document owns and which fields are
// therefore closed — the same way products.js reports nfp_version as a mirror.
// The server still decides; this only lets the form say why before the save.
const annotate = (row) => ({
  ...row,
  document_owned: documentOwned(row),
  document: documentOwned(row) ? `${PC_DOCUMENT} ${PC_REVISION}` : null,
  owned_fields: documentOwned(row) ? ['name', ...PC_OWNED_FIELDS] : [],
});

router.get('/', (_req, res) => {
  const db = getDb();
  const ccps = db.prepare('SELECT * FROM haccp_ccps ORDER BY name').all();
  res.json(ccps.map(annotate));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const ccp = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  if (!ccp) return res.status(404).json({ error: 'CCP not found' });

  const equipment = db.prepare('SELECT id, name, type, room FROM equipment WHERE haccp_ccp_id = ?').all(req.params.id);
  const pmSchedules = db.prepare('SELECT id, title, frequency_type FROM pm_schedules WHERE haccp_ccp_id = ?').all(req.params.id);
  const instruments = db.prepare('SELECT id, name, type FROM calibration_instruments WHERE haccp_ccp_id = ?').all(req.params.id);

  res.json({ ...annotate(ccp), equipment, pm_schedules: pmSchedules, instruments });
});

router.post('/', (req, res) => {
  if (!canManageCcps(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage CCPs.' });
  const db = getDb();
  const id = uuid();
  const { name, description, hazard_type, critical_limits, monitoring_procedure, monitoring_frequency, corrective_action, verification_procedure, record_keeping_requirements } = req.body;

  if (!name || !critical_limits || !monitoring_procedure || !corrective_action) {
    return res.status(400).json({ error: 'name, critical_limits, monitoring_procedure, and corrective_action are required' });
  }

  db.prepare(`
    INSERT INTO haccp_ccps (id, name, description, hazard_type, critical_limits, monitoring_procedure, monitoring_frequency, corrective_action, verification_procedure, record_keeping_requirements)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description || null, hazard_type || null, critical_limits, monitoring_procedure, monitoring_frequency || null, corrective_action, verification_procedure || null, record_keeping_requirements || null);

  const created = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'haccp_ccp', id, { name }, null, created);
  res.status(201).json(annotate(created));
});

router.put('/:id', (req, res) => {
  if (!canManageCcps(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage CCPs.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'CCP not found' });

  // A critical limit transcribed from the food safety plan is not edited here.
  // 400 with the fields named, never a silent drop: a client that thinks it
  // saved a new limit is worse than one told no.
  const locked = guardCcpEdit(existing, req.body);
  if (locked.length) {
    return res.status(400).json({ error: PC_LOCK_MESSAGE, code: 'PC_OWNED', fields: locked });
  }

  const fields = ['name', 'description', 'hazard_type', 'critical_limits', 'monitoring_procedure', 'monitoring_frequency', 'corrective_action', 'verification_procedure', 'record_keeping_requirements'];
  const updated = {};
  for (const f of fields) updated[f] = req.body[f] ?? existing[f];

  db.prepare(`
    UPDATE haccp_ccps SET name=?, description=?, hazard_type=?, critical_limits=?, monitoring_procedure=?,
    monitoring_frequency=?, corrective_action=?, verification_procedure=?, record_keeping_requirements=?,
    updated_at=datetime('now') WHERE id=?
  `).run(...fields.map(f => updated[f]), req.params.id);

  const result = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'haccp_ccp', req.params.id, null, existing, result);
  res.json(annotate(result));
});

export default router;
