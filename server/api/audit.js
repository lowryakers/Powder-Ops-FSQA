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

/**
 * Ordering, decided HERE rather than in the browser.
 *
 * This list is paged (LIMIT/OFFSET over a table with hundreds of thousands of
 * rows), so sorting the fetched page client-side would reorder a hundred rows
 * while the header implied it had ordered the whole log — an auditor clicking
 * "Actor" would get the As from page four and conclude nobody else ever
 * touched the record.
 *
 * An ALLOWLIST, never the raw parameter: this is interpolated into the SQL
 * because a column name cannot be a bound parameter, so anything not on this
 * list falls back to the default rather than reaching the query.
 */
const SORTABLE = new Set(['timestamp', 'actor', 'actor_role', 'action', 'entity_type', 'entity_id']);

function orderBy(q) {
  const col = SORTABLE.has(String(q.sort)) ? String(q.sort) : 'timestamp';
  const dir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  if (col === 'timestamp') return ` ORDER BY timestamp ${dir}`;
  // COLLATE NOCASE on the text columns. SQLite's default collation compares
  // raw bytes, so every capitalised name sorts before every lowercase one —
  // "Matt Rowley" and "system" end up in separate blocks rather than in one
  // alphabet, and an auditor scanning for a name reads past the end of the As
  // and concludes it isn't there. Same trap that made the Hours roster look
  // unsorted.
  //
  // Timestamp is the tiebreak, so rows sharing an actor or an action still
  // read newest-first within that group.
  return ` ORDER BY ${col} COLLATE NOCASE ${dir}, timestamp DESC`;
}

router.get('/', (req, res) => {
  const db = getDb();
  const { sql: baseSql, params } = buildQuery(req.query);

  const countSql = baseSql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;

  const sql = baseSql + orderBy(req.query) + ' LIMIT ? OFFSET ?';
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
  // The SAME ordering the screen is using. An export that comes out in a
  // different order from the list it was taken from is the kind of thing an
  // auditor notices and then stops trusting the rest of.
  const sql = baseSql + orderBy(req.query) + ' LIMIT ?';
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
