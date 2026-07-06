import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM mock_recalls ORDER BY date_initiated DESC').all());
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const recall = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!recall) return res.status(404).json({ error: 'Not found' });
  res.json(recall);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { date_initiated, product_name, lot_number, reason, initiated_by, scope, quantity_produced, quantity_distributed, quantity_recovered, distribution_list, time_to_notify_minutes, time_to_complete_minutes, accounts_contacted, accounts_responded, effectiveness_pct, result, corrective_actions, notes } = req.body;
  if (!product_name || !lot_number || !reason) return res.status(400).json({ error: 'Product name, lot number, and reason are required' });

  const existing = db.prepare("SELECT recall_number FROM mock_recalls ORDER BY recall_number DESC LIMIT 1").get();
  let nextNum = 'MR-001';
  if (existing) {
    const num = parseInt(existing.recall_number.replace('MR-', ''), 10);
    nextNum = `MR-${String(num + 1).padStart(3, '0')}`;
  }

  const id = uuid();
  db.prepare(`INSERT INTO mock_recalls (id, recall_number, date_initiated, product_name, lot_number, reason, initiated_by, scope, quantity_produced, quantity_distributed, quantity_recovered, distribution_list, time_to_notify_minutes, time_to_complete_minutes, accounts_contacted, accounts_responded, effectiveness_pct, result, corrective_actions, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, nextNum, date_initiated || new Date().toISOString().split('T')[0],
    product_name, lot_number, reason, initiated_by || req.user.name,
    scope || 'internal', quantity_produced || null, quantity_distributed || null,
    quantity_recovered || null, distribution_list || null,
    time_to_notify_minutes ?? null, time_to_complete_minutes ?? null,
    accounts_contacted ?? null, accounts_responded ?? null,
    effectiveness_pct ?? null, result || 'pending', corrective_actions || null, notes || null
  );
  logAudit(req.user.name, 'mock_recall_created', 'mock_recall', id, { recall_number: nextNum, product_name });
  res.status(201).json(db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(id));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { date_initiated, product_name, lot_number, reason, initiated_by, scope, quantity_produced, quantity_distributed, quantity_recovered, distribution_list, time_to_notify_minutes, time_to_complete_minutes, accounts_contacted, accounts_responded, effectiveness_pct, result, corrective_actions, notes, completed_at } = req.body;

  const newResult = result || existing.result;
  const newCompleted = newResult !== 'pending' && !existing.completed_at ? (completed_at || new Date().toISOString()) : (completed_at ?? existing.completed_at);

  db.prepare(`UPDATE mock_recalls SET date_initiated=?, product_name=?, lot_number=?, reason=?, initiated_by=?, scope=?, quantity_produced=?, quantity_distributed=?, quantity_recovered=?, distribution_list=?, time_to_notify_minutes=?, time_to_complete_minutes=?, accounts_contacted=?, accounts_responded=?, effectiveness_pct=?, result=?, corrective_actions=?, notes=?, completed_at=?, updated_at=datetime('now') WHERE id=?`).run(
    date_initiated || existing.date_initiated, product_name || existing.product_name,
    lot_number || existing.lot_number, reason || existing.reason,
    initiated_by ?? existing.initiated_by, scope || existing.scope,
    quantity_produced ?? existing.quantity_produced, quantity_distributed ?? existing.quantity_distributed,
    quantity_recovered ?? existing.quantity_recovered, distribution_list ?? existing.distribution_list,
    time_to_notify_minutes ?? existing.time_to_notify_minutes, time_to_complete_minutes ?? existing.time_to_complete_minutes,
    accounts_contacted ?? existing.accounts_contacted, accounts_responded ?? existing.accounts_responded,
    effectiveness_pct ?? existing.effectiveness_pct, newResult,
    corrective_actions ?? existing.corrective_actions, notes ?? existing.notes,
    newCompleted, req.params.id
  );
  logAudit(req.user.name, 'mock_recall_updated', 'mock_recall', req.params.id, { result: newResult });
  res.json(db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id));
});

export default router;
