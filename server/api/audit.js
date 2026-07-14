import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

// Build the WHERE clause shared by the list and export endpoints.
function buildQuery(q) {
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (q.entity_type) { sql += ' AND entity_type = ?'; params.push(q.entity_type); }
  if (q.entity_id) { sql += ' AND entity_id = ?'; params.push(q.entity_id); }
  if (q.actor) { sql += ' AND actor = ?'; params.push(q.actor); }
  if (q.actor_id) { sql += ' AND actor_id = ?'; params.push(q.actor_id); }
  if (q.actor_role) { sql += ' AND actor_role = ?'; params.push(q.actor_role); }
  if (q.actor_department) { sql += ' AND actor_department = ?'; params.push(q.actor_department); }
  if (q.action) { sql += ' AND action = ?'; params.push(q.action); }
  if (q.from) { sql += ' AND timestamp >= ?'; params.push(q.from); }
  if (q.to) { sql += ' AND timestamp <= ?'; params.push(q.to); }
  return { sql, params };
}

router.get('/', (req, res) => {
  const db = getDb();
  const { sql: baseSql, params } = buildQuery(req.query);

  const countSql = baseSql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;

  const sql = baseSql + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(sql).all(...params, parseInt(req.query.limit) || 100, parseInt(req.query.offset) || 0);
  res.json({ total, data: rows });
});

// Distinct values that populate the UI filter dropdowns.
router.get('/facets', (req, res) => {
  const db = getDb();
  const col = (c) => db.prepare(`SELECT DISTINCT ${c} AS v FROM audit_log WHERE ${c} IS NOT NULL AND ${c} != '' ORDER BY v`).all().map(r => r.v);
  res.json({
    actions: col('action'),
    entity_types: col('entity_type'),
    roles: col('actor_role'),
    departments: col('actor_department'),
  });
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

// CSV export of the currently-filtered log (capped so a huge log can't OOM).
router.get('/export', (req, res) => {
  const db = getDb();
  const { sql: baseSql, params } = buildQuery(req.query);
  const sql = baseSql + ' ORDER BY timestamp DESC LIMIT ?';
  const rows = db.prepare(sql).all(...params, parseInt(req.query.limit) || 10000);

  const cols = ['id', 'timestamp', 'actor', 'actor_role', 'actor_department', 'action', 'entity_type', 'entity_id', 'entity_label', 'details'];
  const header = ['ID', 'Timestamp', 'Actor', 'Role', 'Department', 'Action', 'Entity Type', 'Entity ID', 'Entity Label', 'Details'];
  const lines = [header.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

router.get('/entity/:type/:id', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC'
  ).all(req.params.type, req.params.id);
  res.json(rows);
});

export default router;
