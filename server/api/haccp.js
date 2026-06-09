import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const db = getDb();
  const ccps = db.prepare('SELECT * FROM haccp_ccps ORDER BY name').all();
  res.json(ccps);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const ccp = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  if (!ccp) return res.status(404).json({ error: 'CCP not found' });

  const equipment = db.prepare('SELECT id, name, type, room FROM equipment WHERE haccp_ccp_id = ?').all(req.params.id);
  const pmSchedules = db.prepare('SELECT id, title, frequency_type FROM pm_schedules WHERE haccp_ccp_id = ?').all(req.params.id);
  const instruments = db.prepare('SELECT id, name, type FROM calibration_instruments WHERE haccp_ccp_id = ?').all(req.params.id);

  res.json({ ...ccp, equipment, pm_schedules: pmSchedules, instruments });
});

router.post('/', (req, res) => {
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
  logAudit(req.body._actor || 'system', 'create', 'haccp_ccp', id, { name }, null, created);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'CCP not found' });

  const fields = ['name', 'description', 'hazard_type', 'critical_limits', 'monitoring_procedure', 'monitoring_frequency', 'corrective_action', 'verification_procedure', 'record_keeping_requirements'];
  const updated = {};
  for (const f of fields) updated[f] = req.body[f] ?? existing[f];

  db.prepare(`
    UPDATE haccp_ccps SET name=?, description=?, hazard_type=?, critical_limits=?, monitoring_procedure=?,
    monitoring_frequency=?, corrective_action=?, verification_procedure=?, record_keeping_requirements=?,
    updated_at=datetime('now') WHERE id=?
  `).run(...fields.map(f => updated[f]), req.params.id);

  const result = db.prepare('SELECT * FROM haccp_ccps WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'haccp_ccp', req.params.id, null, existing, result);
  res.json(result);
});

export default router;
