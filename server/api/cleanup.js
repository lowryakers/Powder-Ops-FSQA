import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { SOURCES, sourceFor, counts } from '../cleanup.js';

const router = Router();

// Admin only. This closes compliance records in bulk; it is a records-integrity
// action, not day-to-day work, and it should not be one mis-click away for a
// supervisor clearing their own queue.
function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Cleanup Review is admin-only.' });
    return false;
  }
  return true;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cutoffOf = (raw) => (ISO.test(String(raw || '')) ? String(raw) : null);

// GET /api/cleanup?before=YYYY-MM-DD[&source=key]
// Without `source`, just the counts — that's the summary screen and it stays
// cheap however big the backlog is. With `source`, the rows for that pile.
router.get('/', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cutoff = cutoffOf(req.query.before);
  if (!cutoff) return res.status(400).json({ error: 'before=YYYY-MM-DD is required.' });
  const db = getDb();
  const out = { cutoff, sources: counts(db, cutoff) };
  const src = sourceFor(req.query.source);
  if (src) {
    try { out.rows = src.stale(db, cutoff); } catch (e) { return res.status(400).json({ error: e.message }); }
    out.source = src.key;
  }
  res.json(out);
});

// POST /api/cleanup/close { source, ids[], reason }
//
// Per-record, not one transaction: a partial failure reports which ids failed
// rather than rolling back closures that genuinely succeeded. Same rule the QA
// Review batch sign uses — a bulk action still has to leave the trail a manual
// one would, so every record is audited individually.
router.post('/close', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { source, ids, reason } = req.body || {};
  const src = sourceFor(source);
  if (!src) return res.status(400).json({ error: 'Unknown source.' });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Nothing selected.' });
  // A reason is mandatory. "Closed" with no explanation is the same dead end as
  // a deleted record — the trail has to say why.
  const why = String(reason || '').trim();
  if (why.length < 3) return res.status(400).json({ error: 'Give a reason — it goes on every record you close.' });

  const db = getDb();
  const closed = [];
  const failed = [];
  for (const id of ids) {
    let out;
    try { out = src.close(db, req.user, id, why); }
    catch (e) { out = { error: e.message }; }
    if (out?.error) { failed.push({ id, error: out.error }); continue; }
    logAudit(req.user, 'update', source === 'production-qa' ? 'production_entry' : 'work_order', id,
      { cleanup: true, reason: why, source }, out.before, null, out.label);
    closed.push(id);
  }
  logAudit(req.user, 'update', 'cleanup_review', null,
    { source, closed: closed.length, failed: failed.length, reason: why }, null, null, src.label);
  res.json({ closed: closed.length, failed });
});

export default router;
export { SOURCES };
