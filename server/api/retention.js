// Retention samples — what was pulled from each job, and where it is now.
//
// The plant keeps a physical library of what it made: a retain of every blend,
// intermediate and finished good, plus 90 g of every raw material received.
// They live in numbered boxes, each box carrying a destruction date, and they
// are what answers "send us a sample of that lot" two years later.
//
// WHY THIS IS NOT A COA TAB — the question I was asked directly.
//
//   A COA request is about a TEST: send this to the lab, grade the result
//   against the spec, issue the certificate. A retention record is about an
//   OBJECT: a jar with a lot number on it, sitting in box 17, to be destroyed
//   in April 2028. The two meet at exactly one point — the lab portion of a
//   pull is what gets sent for testing — and that point is a link
//   (`coa_request_id`), not a merge.
//
//   Three things make the difference concrete:
//     · Retention spans RECEIVING to FINISHED GOOD. Raw-material retains come
//       off an inbound pallet and have no COA request at all.
//     · A retention record's whole life is custody: which box, whose initials,
//       when it may be destroyed. A COA request has none of those.
//     · The counts differ. "5 (2 LAB, 3 RETAIN)" is one pull that produced two
//       objects with different fates. Folding that into a COA request would
//       lose the three that never left the building.
//
// So: its own module, cross-linked to COA and to the Production Log by lot and
// MO number.

import { Router } from 'express';
import multer from 'multer';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { coerceCustomData, mergeCustomData } from '../custom-fields.js';
import { parseRetentionLog, sampleKey } from '../retention-log.js';

const router = Router();

export const STAGES = [
  { value: 'raw_material', label: 'Raw material', hint: '90 g retained from an inbound lot' },
  { value: 'blend', label: 'Blend' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'finished_good', label: 'Finished good' },
];
const STAGE_VALUES = STAGES.map(s => s.value);

// Filing is open to anyone who pulls samples — QA, production, warehouse.
// Correcting somebody else's record, and anything to do with destroying a box,
// is a records act.
const canFile = (u) => !!u;
const canEdit = (u) => ['admin', 'supervisor'].includes(u?.role)
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase())
  || u?.modules?.includes?.('retention-samples');
const canDestroy = (u) => u?.role === 'admin'
  || (u?.role === 'supervisor' && ['qa', 'quality'].includes((u?.department || '').toLowerCase()));

const clean = (v, max = 200) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/* ── Boxes ────────────────────────────────────────────────────────────────── */

router.get('/boxes', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM retention_samples s WHERE s.box_id = b.id) AS sample_count,
      (SELECT COALESCE(SUM(retain_count), 0) FROM retention_samples s WHERE s.box_id = b.id) AS retains,
      (SELECT COALESCE(SUM(lab_count), 0) FROM retention_samples s WHERE s.box_id = b.id) AS labs
    FROM retention_boxes b
    ORDER BY b.status = 'destroyed', CAST(b.box_no AS INTEGER) DESC, b.box_no DESC`).all();
  // "Due for destruction" is a date that has passed on a box still holding
  // samples — the only actionable state this module has.
  const today = new Date().toISOString().slice(0, 10);
  res.json(rows.map(b => ({
    ...b,
    due_for_destruction: b.status !== 'destroyed' && !!b.destruction_date && b.destruction_date <= today,
  })));
});

router.post('/boxes', (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only QA or an admin can open a retention box.' });
  const db = getDb();
  const boxNo = clean(req.body?.box_no, 40);
  if (!boxNo) return res.status(400).json({ error: 'A box number is required.' });
  const existing = db.prepare('SELECT id FROM retention_boxes WHERE box_no = ?').get(boxNo);
  if (existing) return res.status(409).json({ error: `Box ${boxNo} already exists.` });

  const id = uuid();
  db.prepare(`INSERT INTO retention_boxes (id, box_no, destruction_date, location, notes)
    VALUES (?, ?, ?, ?, ?)`)
    .run(id, boxNo, clean(req.body?.destruction_date, 20), clean(req.body?.location), clean(req.body?.notes, 1000));
  const box = db.prepare('SELECT * FROM retention_boxes WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'retention_box', id, { box_no: boxNo }, null, box, `Box ${boxNo}`);
  res.status(201).json(box);
});

router.put('/boxes/:id', (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only QA or an admin can change a retention box.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM retention_boxes WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Box not found' });
  if (before.status === 'destroyed') {
    return res.status(400).json({ error: 'This box has been destroyed. That record does not change.' });
  }
  const status = ['open', 'closed'].includes(req.body?.status) ? req.body.status : before.status;
  db.prepare(`UPDATE retention_boxes SET destruction_date = ?, location = ?, notes = ?, status = ?,
      closed_at = CASE WHEN ? = 'closed' AND closed_at IS NULL THEN datetime('now') ELSE closed_at END,
      updated_at = datetime('now') WHERE id = ?`)
    .run(clean(req.body?.destruction_date, 20), clean(req.body?.location), clean(req.body?.notes, 1000),
      status, status, before.id);
  const after = db.prepare('SELECT * FROM retention_boxes WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'retention_box', before.id, null, before, after, `Box ${before.box_no}`);
  res.json(after);
});

// Destroying a box is the end of those samples' lives and cannot be undone, so
// it needs a reason and a records role. The samples are NOT deleted — the whole
// point of the log is that it can still say what was held and when it went.
router.post('/boxes/:id/destroy', (req, res) => {
  if (!canDestroy(req.user)) return res.status(403).json({ error: 'Only QA leadership or an admin can record a destruction.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM retention_boxes WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Box not found' });
  if (before.status === 'destroyed') return res.status(400).json({ error: 'This box is already recorded as destroyed.' });
  const notes = clean(req.body?.notes, 1000);
  if (!notes || notes.length < 3) return res.status(400).json({ error: 'Say how and when the samples were disposed of.' });

  const today = new Date().toISOString().slice(0, 10);
  if (before.destruction_date && before.destruction_date > today && req.body?.early !== true) {
    return res.status(400).json({
      error: `Box ${before.box_no} is not due until ${before.destruction_date}. Confirm you mean to destroy it early.`,
      needs_early_confirmation: true,
    });
  }

  db.prepare(`UPDATE retention_boxes SET status = 'destroyed', destroyed_at = datetime('now'),
      destroyed_by = ?, destruction_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user?.name || null, notes, before.id);
  const after = db.prepare('SELECT * FROM retention_boxes WHERE id = ?').get(before.id);
  const n = db.prepare('SELECT COUNT(*) c FROM retention_samples WHERE box_id = ?').get(before.id).c;
  logAudit(req.user, 'update', 'retention_box', before.id,
    { destroyed: true, samples: n, notes }, before, after, `Box ${before.box_no}`);
  res.json(after);
});

/* ── Samples ──────────────────────────────────────────────────────────────── */

router.get('/', (req, res) => {
  const db = getDb();
  const { stage, box_id, lot, mo, item, q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 500, 2000);

  let sql = `SELECT s.*, b.box_no, b.destruction_date, b.status AS box_status
    FROM retention_samples s LEFT JOIN retention_boxes b ON s.box_id = b.id WHERE 1=1`;
  const params = [];
  if (stage && STAGE_VALUES.includes(stage)) { sql += ' AND s.stage = ?'; params.push(stage); }
  if (box_id) { sql += ' AND s.box_id = ?'; params.push(box_id); }
  if (lot) { sql += ' AND s.lot_number LIKE ?'; params.push(`%${lot}%`); }
  if (mo) { sql += ' AND s.mo_number LIKE ?'; params.push(`%${mo}%`); }
  if (item) { sql += ' AND (s.item_number LIKE ? OR s.item_name LIKE ?)'; params.push(`%${item}%`, `%${item}%`); }
  if (q) {
    sql += ' AND (s.item_name LIKE ? OR s.item_number LIKE ? OR s.lot_number LIKE ? OR s.mo_number LIKE ? OR s.comments LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  // Bounded and newest-first, like every other list endpoint here.
  sql += ' ORDER BY COALESCE(s.collected_date, s.created_at) DESC, s.created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  res.json({
    samples: rows,
    total: db.prepare('SELECT COUNT(*) c FROM retention_samples').get().c,
    truncated: rows.length >= limit,
  });
});

// "What have we got for this lot?" — the question an auditor or a customer
// complaint actually starts with.
router.get('/by-lot/:lot', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT s.*, b.box_no, b.destruction_date, b.status AS box_status
    FROM retention_samples s LEFT JOIN retention_boxes b ON s.box_id = b.id
    WHERE s.lot_number = ? ORDER BY s.stage, s.collected_date`).all(req.params.lot);
  res.json(rows);
});

router.get('/stats', (_req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const byStage = {};
  for (const r of db.prepare('SELECT stage, COUNT(*) c, COALESCE(SUM(retain_count),0) retains, COALESCE(SUM(lab_count),0) labs FROM retention_samples GROUP BY stage').all()) {
    byStage[r.stage] = { pulls: r.c, retains: r.retains, labs: r.labs };
  }
  res.json({
    by_stage: byStage,
    total: db.prepare('SELECT COUNT(*) c FROM retention_samples').get().c,
    open_boxes: db.prepare("SELECT COUNT(*) c FROM retention_boxes WHERE status = 'open'").get().c,
    due_for_destruction: db.prepare(`SELECT COUNT(*) c FROM retention_boxes
      WHERE status != 'destroyed' AND destruction_date IS NOT NULL AND destruction_date <= ?`).get(today).c,
  });
});

router.post('/', (req, res) => {
  if (!canFile(req.user)) return res.status(403).json({ error: 'Sign in to file a retention record.' });
  const db = getDb();
  const itemName = clean(req.body?.item_name, 300);
  if (!itemName) return res.status(400).json({ error: 'What was sampled?' });

  const stage = STAGE_VALUES.includes(req.body?.stage) ? req.body.stage : 'finished_good';
  const retain = count(req.body?.retain_count);
  const lab = count(req.body?.lab_count);
  // A pull that kept nothing and sent nothing is not a record of anything.
  if (retain + lab === 0) {
    return res.status(400).json({ error: 'Record how many were kept as retains, or sent to the lab, or both.' });
  }

  // Filing into a destroyed box would say a sample is somewhere it isn't.
  const boxId = clean(req.body?.box_id, 60);
  if (boxId) {
    const box = db.prepare('SELECT status, box_no FROM retention_boxes WHERE id = ?').get(boxId);
    if (!box) return res.status(400).json({ error: 'That box does not exist.' });
    if (box.status === 'destroyed') return res.status(400).json({ error: `Box ${box.box_no} has been destroyed — pick an open box.` });
  }

  // `.data`, not the `{ data, errors }` wrapper — storing the wrapper put
  // `{"data":{…},"errors":[]}` in the column and made every extra question
  // render blank on the record it was answered on.
  let custom;
  try { custom = coerceCustomData(db, 'retention_sample', req.body?.custom_data).data; } catch { custom = null; }

  const id = uuid();
  db.prepare(`INSERT INTO retention_samples
    (id, box_id, stage, item_number, item_name, lot_number, mo_number, expiration_date,
     retain_count, lab_count, sample_size, batches, collected_date, collected_by,
     coa_request_id, comments, custom_data, external_id, source, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, boxId, stage, clean(req.body?.item_number, 60), itemName,
      clean(req.body?.lot_number, 100), clean(req.body?.mo_number, 60), clean(req.body?.expiration_date, 20),
      retain, lab, clean(req.body?.sample_size, 40), clean(req.body?.batches, 200),
      clean(req.body?.collected_date, 20) || new Date().toISOString().slice(0, 10),
      clean(req.body?.collected_by, 120) || req.user?.name || null,
      clean(req.body?.coa_request_id, 60), clean(req.body?.comments, 2000),
      custom ? JSON.stringify(custom) : null,
      clean(req.body?.external_id, 200), clean(req.body?.source, 60), req.user?.name || null);

  const row = db.prepare('SELECT * FROM retention_samples WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'retention_sample', id,
    { stage, lot: row.lot_number, retains: retain, labs: lab }, null, row, itemName);
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM retention_samples WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Record not found' });
  // The person who filed it can correct it; changing someone else's needs the
  // records role. Same line the receiving log draws.
  const mine = before.created_by && before.created_by === req.user?.name;
  if (!mine && !canEdit(req.user)) return res.status(403).json({ error: 'Only QA or an admin can correct someone else\'s record.' });

  const stage = STAGE_VALUES.includes(req.body?.stage) ? req.body.stage : before.stage;
  const retain = req.body?.retain_count !== undefined ? count(req.body.retain_count) : before.retain_count;
  const lab = req.body?.lab_count !== undefined ? count(req.body.lab_count) : before.lab_count;
  if (retain + lab === 0) return res.status(400).json({ error: 'A record needs at least one retain or lab sample.' });

  let custom = before.custom_data;
  if (req.body?.custom_data !== undefined) {
    // `mergeCustomData(existingRaw, incoming)` takes TWO arguments. Called
    // with four, `existingRaw` was the Database object and `incoming` was the
    // scope STRING — and spreading a string yields {0:'r',1:'e',…}, so every
    // edit wrote indexed characters into the column. Measured, not guessed.
    try {
      const { data } = coerceCustomData(db, 'retention_sample', req.body.custom_data);
      custom = JSON.stringify(mergeCustomData(before.custom_data, data) || {});
    } catch { /* keep what's there */ }
  }

  db.prepare(`UPDATE retention_samples SET box_id = ?, stage = ?, item_number = ?, item_name = ?,
      lot_number = ?, mo_number = ?, expiration_date = ?, retain_count = ?, lab_count = ?,
      sample_size = ?, batches = ?, collected_date = ?, collected_by = ?, coa_request_id = ?,
      comments = ?, custom_data = ?, updated_at = datetime('now'), updated_by = ?
    WHERE id = ?`)
    .run(clean(req.body?.box_id, 60) ?? before.box_id, stage,
      clean(req.body?.item_number, 60), clean(req.body?.item_name, 300) || before.item_name,
      clean(req.body?.lot_number, 100), clean(req.body?.mo_number, 60), clean(req.body?.expiration_date, 20),
      retain, lab, clean(req.body?.sample_size, 40), clean(req.body?.batches, 200),
      clean(req.body?.collected_date, 20), clean(req.body?.collected_by, 120),
      clean(req.body?.coa_request_id, 60), clean(req.body?.comments, 2000), custom,
      req.user?.name || null, before.id);

  const after = db.prepare('SELECT * FROM retention_samples WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'retention_sample', before.id, null, before, after, after.item_name);
  res.json(after);
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete a retention record.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM retention_samples WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Record not found' });
  db.prepare('DELETE FROM retention_samples WHERE id = ?').run(before.id);
  logAudit(req.user, 'delete', 'retention_sample', before.id, null, before, null, before.item_name);
  res.json({ ok: true });
});

/* ── Importing a box from the paper log ───────────────────────────────────── */

// The plant's Retention Sample log is one sheet per box. This is the four-step
// shape every importer here uses — read, plan, show, write — with the crucial
// property that PREVIEW WRITES NOTHING. A retention log is the record of what
// physically exists in a box; bulk-writing one from a spreadsheet nobody
// checked is how it stops being trustworthy.
//
// Idempotent on box + item + lot + collected date, so re-importing a corrected
// sheet updates in place instead of doubling the box.

const boxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Decide what each parsed row becomes. Shared by preview and commit so a dry
// run and the real thing can never tell different stories.
function planImport(db, buffer, filename) {
  const parsed = parseRetentionLog(buffer, filename);
  if (parsed.error) return parsed;

  const box = db.prepare('SELECT * FROM retention_boxes WHERE box_no = ?').get(parsed.box.box_no);
  // Existing rows in THIS box only — the same lot legitimately appears in two
  // boxes (a later collection), and those are different jars.
  const existing = new Map();
  if (box) {
    for (const r of db.prepare('SELECT * FROM retention_samples WHERE box_id = ?').all(box.id)) {
      existing.set(sampleKey(parsed.box.box_no, r), r);
    }
  }

  const seen = new Set();
  const plan = { create: [], update: [], duplicate_in_file: [] };
  for (const s of parsed.samples) {
    const key = sampleKey(parsed.box.box_no, s);
    if (seen.has(key)) { plan.duplicate_in_file.push(s); continue; }
    seen.add(key);
    const prior = existing.get(key);
    if (prior) plan.update.push({ ...s, id: prior.id });
    else plan.create.push(s);
  }

  return {
    box: parsed.box,
    box_exists: !!box,
    // A destroyed box is history. Re-importing into one would rewrite what was
    // held after the fact, which is the one thing this log must never do.
    box_destroyed: box?.status === 'destroyed',
    counts: parsed.counts,
    problems: parsed.problems,
    plan,
  };
}

router.post('/import/preview', boxUpload.single('file'), (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Importing a box is a QA or admin job.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the box\'s sheet (.csv).' });
  let out;
  try { out = planImport(getDb(), req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: `Could not read that sheet: ${e.message}` }); }
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({
    ...out,
    // The rows themselves, so the preview can be read rather than trusted.
    samples: [...out.plan.create.map(s => ({ ...s, action: 'create' })),
              ...out.plan.update.map(s => ({ ...s, action: 'update' }))],
    summary: {
      create: out.plan.create.length,
      update: out.plan.update.length,
      duplicate_in_file: out.plan.duplicate_in_file.length,
    },
  });
});

router.post('/import/commit', boxUpload.single('file'), (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Importing a box is a QA or admin job.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the box\'s sheet (.csv).' });
  const db = getDb();
  let out;
  try { out = planImport(db, req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: `Could not read that sheet: ${e.message}` }); }
  if (out.error) return res.status(400).json({ error: out.error });
  if (out.box_destroyed) {
    return res.status(400).json({ error: 'That box has already been destroyed. Its contents are the record of what was held and are not rewritten.' });
  }

  const source = `retention-log:${req.file.originalname}`.slice(0, 200);
  let boxId;
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM retention_boxes WHERE box_no = ?').get(out.box.box_no);
    if (existing) {
      boxId = existing.id;
      // A destruction date already set by hand is a decision; only fill a blank.
      if (!existing.destruction_date && out.box.destruction_date) {
        db.prepare("UPDATE retention_boxes SET destruction_date = ?, updated_at = datetime('now') WHERE id = ?")
          .run(out.box.destruction_date, boxId);
      }
    } else {
      boxId = uuid();
      db.prepare('INSERT INTO retention_boxes (id, box_no, destruction_date, notes) VALUES (?,?,?,?)')
        .run(boxId, out.box.box_no, out.box.destruction_date, `Imported from ${req.file.originalname}`);
    }

    const ins = db.prepare(`INSERT INTO retention_samples
      (id, box_id, stage, item_number, item_name, lot_number, mo_number, expiration_date,
       retain_count, lab_count, sample_size, batches, collected_date, collected_by, comments,
       external_id, source, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const upd = db.prepare(`UPDATE retention_samples SET stage = ?, item_number = ?, item_name = ?,
      lot_number = ?, mo_number = ?, expiration_date = ?, retain_count = ?, lab_count = ?,
      sample_size = ?, batches = ?, collected_date = ?, collected_by = ?, comments = ?,
      source = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`);

    for (const s of out.plan.create) {
      ins.run(uuid(), boxId, s.stage, s.item_number, s.item_name, s.lot_number, s.mo_number,
        s.expiration_date, s.retain_count, s.lab_count, s.sample_size, s.batches,
        s.collected_date, s.collected_by, s.comments,
        sampleKey(out.box.box_no, s), source, req.user?.name || null);
    }
    for (const s of out.plan.update) {
      upd.run(s.stage, s.item_number, s.item_name, s.lot_number, s.mo_number, s.expiration_date,
        s.retain_count, s.lab_count, s.sample_size, s.batches, s.collected_date, s.collected_by,
        s.comments, source, req.user?.name || null, s.id);
    }
  });
  tx();

  logAudit(req.user, 'create', 'retention_box', boxId, {
    box_no: out.box.box_no, created: out.plan.create.length, updated: out.plan.update.length,
    file: req.file.originalname, unreadable_rows: out.problems.length,
  }, null, null, `Box ${out.box.box_no} import`);

  res.status(201).json({
    box_no: out.box.box_no,
    created: out.plan.create.length,
    updated: out.plan.update.length,
    duplicate_in_file: out.plan.duplicate_in_file.length,
    problems: out.problems.length,
    counts: out.counts,
  });
});

export default router;
