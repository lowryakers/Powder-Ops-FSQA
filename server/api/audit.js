import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { entity_type, entity_id, actor, action, from, to, limit: lim, offset } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  if (actor) { sql += ' AND actor = ?'; params.push(actor); }
  if (action) { sql += ' AND action = ?'; params.push(action); }
  if (from) { sql += ' AND timestamp >= ?'; params.push(from); }
  if (to) { sql += ' AND timestamp <= ?'; params.push(to); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(parseInt(lim) || 100, parseInt(offset) || 0);

  const rows = db.prepare(sql).all(...params);
  res.json({ total, data: rows });
});

router.get('/entity/:type/:id', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC'
  ).all(req.params.type, req.params.id);
  res.json(rows);
});

export default router;
