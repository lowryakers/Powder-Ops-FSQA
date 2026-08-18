import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

// A position can carry SEVERAL job descriptions — a small plant's people wear
// several hats, and the chart should say so rather than picking one. The full
// set lives in job_description_ids (JSON array); job_description_id stays as
// a MIRROR of the first entry so everything that reads the old column (the
// chart chip, the JD auto-linker, exports) keeps working — the same line-0
// mirroring rule as production_entries.mo_lines.
function normalizeJdIds(body, existing = null) {
  if (body.job_description_ids !== undefined) {
    const arr = Array.isArray(body.job_description_ids) ? body.job_description_ids : [];
    return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
  }
  if (body.job_description_id !== undefined) {
    return body.job_description_id ? [String(body.job_description_id)] : [];
  }
  return existing ? jdIdsOf(existing) : [];
}
function jdIdsOf(row) {
  try {
    const arr = JSON.parse(row.job_description_ids || 'null');
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* fall through */ }
  return row.job_description_id ? [row.job_description_id] : [];
}

const router = Router();

/**
 * The person on each box comes from the LINKED ACCOUNT, not the stored string.
 *
 * `org_positions.name` was the only answer, so the chart froze at whatever was
 * typed: renames in Settings never reached it, leavers kept their box, and new
 * starters were invisible until somebody remembered to edit it. The pay roster
 * had the identical bug and the same fix — the link is the identity, the stored
 * name is a label.
 *
 * `name_on_file` is returned alongside so a chart that has drifted can be seen
 * to have drifted rather than silently corrected, and `person_active` is what
 * lets the UI mark a box whose holder has left. An unlinked position falls back
 * to its stored name, which is right for a contractor with no account and for
 * every position filled before this existed.
 */
function withPeople(db, positions) {
  const users = new Map(db.prepare('SELECT id, name, is_active, department FROM users').all().map(u => [u.id, u]));
  return positions.map((p) => {
    const u = p.user_id ? users.get(p.user_id) : null;
    return {
      ...p,
      name: u ? u.name : p.name,
      name_on_file: p.name || null,
      person_active: u ? (u.is_active === null || u.is_active === 1) : null,
      // A link that points at an account that no longer exists is a fact worth
      // showing, not one to hide by falling back silently.
      link_broken: !!(p.user_id && !u),
    };
  });
}

// GET / — all positions + chart meta
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM org_positions ORDER BY sort_order, title').all();
  const positions = withPeople(db, rows).map(p => ({ ...p, job_description_ids: jdIdsOf(p) }));
  const meta = db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get() || null;

  // WHO IS NOT ON THE CHART. An org chart that is missing people is the one an
  // auditor finds a hole in, and until now nothing compared it to the roster.
  const linked = new Set(rows.map(p => p.user_id).filter(Boolean));
  const unplaced = db.prepare(
    "SELECT id, name, role, department FROM users WHERE (is_active IS NULL OR is_active = 1) ORDER BY name"
  ).all().filter(u => !linked.has(u.id) && u.role !== 'auditor' && !/^readybot$/i.test(u.name || ''));

  res.json({ positions, meta, unplaced });
});

// The roster the position picker chooses from.
router.get('/people', (_req, res) => {
  const db = getDb();
  res.json(db.prepare(
    "SELECT id, name, role, department FROM users WHERE (is_active IS NULL OR is_active = 1) ORDER BY name"
  ).all());
});

router.post('/', (req, res) => {
  const db = getDb();
  const { title, name, backup, department, parent_id, sort_order, user_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  // The stored name is kept as the label for a vacancy or a contractor with no
  // account; when a person is linked, THEIR account is what the chart reads.
  const person = user_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id) : null;
  if (user_id && !person) return res.status(400).json({ error: 'That person no longer has an account.' });
  const jdIds = normalizeJdIds(req.body);
  const id = uuid();
  db.prepare(`INSERT INTO org_positions (id, title, name, backup, department, parent_id, job_description_id, job_description_ids, sort_order, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title, person ? person.name : (name || null), backup || null, department || null,
    parent_id || null, jdIds[0] || null, jdIds.length ? JSON.stringify(jdIds) : null,
    Number.isInteger(sort_order) ? sort_order : 0,
    person ? person.id : null
  );
  const created = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(id);
  logAudit(req.user, 'org_position_created', 'org_position', id, { title, name });
  res.status(201).json(created);
});

/**
 * The chart's version, who approved it and when it took effect.
 *
 * DECLARED BEFORE `/:id`. Express matches in declaration order and 'meta' is a
 * perfectly good position id, so with this below the update handler every call
 * was answered by it, looked for a position called "meta", and 404'd — these
 * three fields have never once been settable. Same trap as /master.csv on the
 * products router and /batch/send on the NFP one.
 *
 * They are also the three facts that make an org chart a controlled document
 * rather than a drawing, which is what an auditor asks it for.
 */
router.put('/meta', (req, res) => {
  const db = getDb();
  const { version, approved_by, effective_date } = req.body;
  const existing = db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get();
  if (existing) {
    db.prepare(`UPDATE org_chart_meta SET version=?, approved_by=?, effective_date=?, updated_at=datetime('now') WHERE id=1`)
      .run(version ?? existing.version, approved_by ?? existing.approved_by, effective_date ?? existing.effective_date);
  } else {
    db.prepare('INSERT INTO org_chart_meta (id, version, approved_by, effective_date) VALUES (1, ?, ?, ?)')
      .run(version || null, approved_by || null, effective_date || null);
  }
  logAudit(req.user, 'org_meta_updated', 'org_chart', '1', req.body);
  res.json(db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get());
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, name, backup, department, parent_id, sort_order, user_id } = req.body;
  const jdIds = normalizeJdIds(req.body, existing);
  // An ABSENT user_id means "leave the link alone"; an explicit null unlinks,
  // which is how a position becomes vacant without losing its title.
  const changingPerson = user_id !== undefined;
  const person = user_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id) : null;
  if (user_id && !person) return res.status(400).json({ error: 'That person no longer has an account.' });

  // Guard against making a node its own ancestor (cycle)
  if (parent_id) {
    let cur = parent_id;
    const byId = Object.fromEntries(db.prepare('SELECT id, parent_id FROM org_positions').all().map(p => [p.id, p.parent_id]));
    while (cur) {
      if (cur === req.params.id) return res.status(400).json({ error: 'A position cannot report into its own branch' });
      cur = byId[cur];
    }
  }

  db.prepare(`UPDATE org_positions SET title=?, name=?, backup=?, department=?, parent_id=?, job_description_id=?, job_description_ids=?, sort_order=?, user_id=?, updated_at=datetime('now') WHERE id=?`).run(
    title || existing.title,
    // Linking someone stamps their current name so an export or an old print
    // still reads; unlinking keeps whatever was there rather than blanking it.
    changingPerson && person ? person.name : (name ?? existing.name),
    backup ?? existing.backup,
    department ?? existing.department, parent_id !== undefined ? (parent_id || null) : existing.parent_id,
    jdIds[0] || null, jdIds.length ? JSON.stringify(jdIds) : null,
    Number.isInteger(sort_order) ? sort_order : existing.sort_order,
    changingPerson ? (person ? person.id : null) : existing.user_id,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'org_position_updated', 'org_position', req.params.id, { title: updated.title }, existing, updated);
  res.json(updated);
});

// DELETE — remove a position; its children re-report to its parent (no orphans)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE org_positions SET parent_id = ?, updated_at = datetime(\'now\') WHERE parent_id = ?').run(existing.parent_id || null, req.params.id);
    db.prepare('DELETE FROM org_positions WHERE id = ?').run(req.params.id);
  });
  tx();
  logAudit(req.user, 'org_position_deleted', 'org_position', req.params.id, { title: existing.title }, existing, null);
  res.json({ success: true });
});

export default router;
