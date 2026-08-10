import { Router } from 'express';
import { createReadStream } from 'fs';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import { repairTasks, repairConfidence } from '../task-text-repair.js';
import { aiEnabled, compareManualToTasks } from '../ai.js';
import { equipmentReadiness, readinessSummary, READINESS_STEPS } from '../equipment-readiness.js';
import { ASSET_KINDS, defaultAssetKind } from '../../shared/equipment-types.js';

// The status vocabulary the table's CHECK-free column actually uses.
const STATUSES = ['active', 'partial', 'out_of_service'];

const router = Router();

function syncMaintenanceTasksToPM(db, equipmentId) {
  const eq = db.prepare('SELECT maintenance_tasks FROM equipment WHERE id = ?').get(equipmentId);
  if (!eq) return;
  let tasks;
  try { tasks = JSON.parse(eq.maintenance_tasks || '{}'); } catch { tasks = {}; }
  const flatSteps = [];
  const freqOrder = ['Daily', 'Bi-weekly', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'As Needed'];
  for (const freq of freqOrder) {
    if (tasks[freq]?.length) {
      flatSteps.push(`${freq}:`);
      tasks[freq].forEach(t => flatSteps.push(`  ${t}`));
    }
  }
  const stepsJson = JSON.stringify(flatSteps);

  const schedules = db.prepare("SELECT id FROM pm_schedules WHERE equipment_id = ? AND is_active = 1").all(equipmentId);
  for (const s of schedules) {
    db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(stepsJson, s.id);
    db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress')").run(stepsJson, s.id);
  }
}

// Propagate an equipment's assignee (task_group) to its PM schedules and any
// still-open work orders, so reassigning on the Equipment List immediately
// routes the tasks to the chosen department.
function syncTaskGroupToPM(db, equipmentId, taskGroup) {
  const tg = taskGroup || null;
  db.prepare("UPDATE pm_schedules SET task_group = ?, updated_at = datetime('now') WHERE equipment_id = ?").run(tg, equipmentId);
  db.prepare("UPDATE work_orders SET task_group = ? WHERE equipment_id = ? AND status IN ('open','in_progress','overdue')").run(tg, equipmentId);
}

router.get('/', (req, res) => {
  const db = getDb();
  const { status, type, food_contact } = req.query;
  let sql = 'SELECT e.*, c.name as ccp_name FROM equipment e LEFT JOIN haccp_ccps c ON e.haccp_ccp_id = c.id WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (type) { sql += ' AND e.type = ?'; params.push(type); }
  if (food_contact !== undefined) { sql += ' AND e.is_food_contact = ?'; params.push(food_contact === 'true' ? 1 : 0); }

  sql += ' ORDER BY e.name';
  res.json(db.prepare(sql).all(...params));
});

// BEFORE '/:id' — Express matches in order, and a route declared after it would
// be swallowed with req.params.id = 'readiness'.
router.get('/readiness', (req, res) => {
  const db = getDb();
  res.json(readinessSummary(db, { limit: Math.min(Number(req.query.limit) || 500, 1000) }));
});

router.get('/:id/readiness', (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });
  res.json(equipmentReadiness(db, eq));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT e.*, c.name as ccp_name FROM equipment e LEFT JOIN haccp_ccps c ON e.haccp_ccp_id = c.id WHERE e.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Equipment not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, notes, maintenance_tasks, task_group } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  // A zone is not a machine: it is scheduled and inspected, and nobody operates
  // or locks it out. The caller may say so explicitly; otherwise the type
  // supplies the default, which is the ONLY place the type decides this.
  const assetKind = ASSET_KINDS.includes(req.body.asset_kind) ? req.body.asset_kind : defaultAssetKind(type);
  // Zones never need a lockout procedure. Otherwise default to requiring one —
  // the column has always defaulted to 1 and the safe error is asking.
  // A zone cannot require lockout — see the same rule on PUT.
  const lotoRequired = assetKind === 'zone' ? 0
    : (req.body.loto_required !== undefined ? (req.body.loto_required ? 1 : 0) : 1);

  db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, notes, maintenance_tasks, task_group, asset_kind, loto_required, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, location || null, room || null, asset_id || null, manufacturer || null, model_number || null, serial_number || null, vendor || null, pm_frequency || null, is_food_contact ? 1 : 0, haccp_ccp_id || null, notes || null, maintenance_tasks ? JSON.stringify(maintenance_tasks) : '{}', task_group || null, assetKind, lotoRequired,
    // Create never accepted a status, so equipment imported or added as
    // already-retired came in active and started generating PM tasks.
    STATUSES.includes(req.body.status) ? req.body.status : 'active');
  if (task_group) syncTaskGroupToPM(db, id, task_group);

  const created = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'equipment', id, { name, type }, null, created);
  // The setup checklist rides along on the create response so the panel can put
  // "here is what this machine still needs" in front of whoever just added it,
  // without a second round trip at the one moment they are looking.
  res.status(201).json({ ...created, readiness: equipmentReadiness(db, created) });
});

/**
 * Turn the maintenance tasks written on an equipment record into REAL recurring
 * schedules, one per frequency.
 *
 * The A/C is the case: thirteen tasks written across Daily / Weekly / Monthly /
 * Quarterly, and not one of them generated anything, because the task list and
 * the recurring schedule are different records that happen to share a name on
 * screen. There were 79 active machines in that state.
 *
 * This is NOT auto-creation — it is a deliberate action, and it is only offered
 * because the frequency is not a guess: the operator already wrote each task
 * under a frequency heading. A schedule is created per frequency that has
 * tasks, carrying those tasks as its procedure steps and inheriting the
 * equipment's team, and a frequency that already has an active schedule is
 * skipped rather than duplicated.
 */
const FREQ_TO_SCHEDULE = {
  Daily: 'daily', Weekly: 'weekly', 'Bi-weekly': 'biweekly', Monthly: 'monthly',
  Quarterly: 'quarterly', 'Semi-Annual': 'semi_annual', Annual: 'annual',
};

/**
 * What WOULD be created for one machine. One planner, used by the preview and
 * by the write — a preview computed differently from the commit is a preview
 * that lies, and this one is shown before a bulk write across 80 machines.
 */
function planSchedulesFromTasks(db, eq) {
  let tasks;
  try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { tasks = {}; }
  const existing = db.prepare('SELECT frequency_type FROM pm_schedules WHERE equipment_id = ? AND is_active = 1').all(eq.id);
  const create = [];
  const skip = [];
  for (const [freq, list] of Object.entries(tasks)) {
    if (!Array.isArray(list) || !list.filter(Boolean).length) continue;
    const freqType = FREQ_TO_SCHEDULE[freq];
    if (!freqType) { skip.push({ frequency: freq, reason: 'not a recurring frequency' }); continue; }
    if (existing.some(x => x.frequency_type === freqType)) { skip.push({ frequency: freq, reason: 'already has a schedule' }); continue; }
    create.push({ frequency: freq, frequency_type: freqType, steps: list.filter(Boolean) });
  }
  return { create, skip };
}

function writeSchedulesFromTasks(db, eq, plan) {
  const created = [];
  for (const c of plan.create) {
    const id = uuid();
    db.prepare(`
      INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, eq.id, `${eq.name} — ${c.frequency} PM`,
      `Created from the maintenance tasks written on ${eq.name}.`,
      c.frequency_type, JSON.stringify(c.steps), eq.task_group || 'maintenance');
    created.push({ id, frequency: c.frequency, frequency_type: c.frequency_type, steps: c.steps.length });
  }
  return created;
}

/**
 * Every active machine whose written tasks generate nothing, and exactly what
 * would be created for each. Read-only — nothing is written until the caller
 * picks ids and posts them.
 *
 * BEFORE '/:id', or Express reads "schedules-from-tasks" as an equipment id.
 */
router.get('/schedules-from-tasks/preview', (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM equipment WHERE status = 'active' ORDER BY name").all();
  const machines = [];
  for (const eq of rows) {
    const plan = planSchedulesFromTasks(db, eq);
    if (!plan.create.length) continue;
    machines.push({
      id: eq.id, name: eq.name, type: eq.type, asset_id: eq.asset_id,
      task_group: eq.task_group, location: eq.location,
      // Named so the reviewer can see a machine is about to be given
      // schedules with no team to send them to.
      no_team: !eq.task_group,
      create: plan.create.map(c => ({ frequency: c.frequency, step_count: c.steps.length, steps: c.steps })),
      skip: plan.skip,
    });
  }
  res.json({
    machines,
    total_machines: machines.length,
    total_schedules: machines.reduce((t, m) => t + m.create.length, 0),
  });
});

router.post('/schedules-from-tasks/bulk', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids?.length) return res.status(400).json({ error: 'ids are required — nothing is created for machines you did not pick.' });

  const results = [];
  const tx = db.transaction(() => {
    for (const id of ids) {
      const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
      if (!eq) { results.push({ id, error: 'not found' }); continue; }
      const plan = planSchedulesFromTasks(db, eq);
      const created = writeSchedulesFromTasks(db, eq, plan);
      // Audited per machine as well as in summary: a bulk action has to leave
      // the trail a manual one would.
      if (created.length) {
        logAudit(req.user, 'create', 'pm_schedule', eq.id,
          { from: 'maintenance_tasks', bulk: true, created: created.map(c => c.frequency) }, null, null, eq.name);
      }
      results.push({ id, name: eq.name, created: created.length, frequencies: created.map(c => c.frequency), skipped: plan.skip });
    }
  });
  tx();

  const total = results.reduce((t, r) => t + (r.created || 0), 0);
  logAudit(req.user, 'bulk_update', 'pm_schedule', null,
    { from: 'maintenance_tasks', machines: results.length, schedules_created: total }, null, null);
  res.json({ results, machines: results.length, schedules_created: total });
});

router.post('/:id/schedules-from-tasks', (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });

  const plan = planSchedulesFromTasks(db, eq);
  const created = writeSchedulesFromTasks(db, eq, plan);
  if (created.length) {
    logAudit(req.user, 'create', 'pm_schedule', eq.id,
      { from: 'maintenance_tasks', equipment: eq.name, created: created.map(c => c.frequency) }, null, null, eq.name);
  }
  const fresh = db.prepare('SELECT * FROM equipment WHERE id = ?').get(eq.id);
  res.json({ created, skipped: plan.skip, readiness: equipmentReadiness(db, fresh) });
});

/**
 * Mark a setup step NOT APPLICABLE for this machine.
 *
 * Nobody writes a work instruction for switching on an A/C, and a checklist
 * that can't be told so is one people stop reading. But a skip is a decision,
 * so it takes a REASON and records who made it, and the step stays on the list
 * reading "not applicable — <reason>" rather than disappearing.
 *
 * LOTO IS DELIBERATELY NOT WAIVABLE HERE. `equipment.loto_required` is the
 * authority on that, and it is read by the LOTO module and the compliance badge
 * as well — waiving the checklist step alone would leave those two still
 * counting the machine, which is exactly the two-mechanisms-disagreeing problem
 * this module has already been bitten by. The caller is sent to the column.
 */
const UNWAIVABLE = {
  loto: 'Use the "Needs a LOTO procedure" checkbox on the equipment record — that column is what the LOTO module and the compliance badge read.',
};

router.post('/:id/steps/:stepId/skip', (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT id, name FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });

  const stepId = req.params.stepId;
  if (UNWAIVABLE[stepId]) return res.status(400).json({ error: UNWAIVABLE[stepId] });
  if (!READINESS_STEPS.some(s => s.id === stepId)) return res.status(400).json({ error: 'Unknown setup step' });

  const reason = String(req.body?.reason || '').trim();
  // A skip with no reason is indistinguishable from an oversight six months
  // later, which is the whole thing this is trying to avoid.
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this step does not apply — it is recorded on the machine.' });

  db.prepare(`INSERT INTO equipment_step_waivers (equipment_id, step_id, reason, waived_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(equipment_id, step_id) DO UPDATE SET reason = excluded.reason, waived_by = excluded.waived_by, waived_at = datetime('now')`)
    .run(eq.id, stepId, reason.slice(0, 300), req.user?.name || null);

  logAudit(req.user, 'update', 'equipment', eq.id,
    { action: 'setup_step_waived', step: stepId, reason }, null, null, eq.name);
  const fresh = db.prepare('SELECT * FROM equipment WHERE id = ?').get(eq.id);
  res.json(equipmentReadiness(db, fresh));
});

router.delete('/:id/steps/:stepId/skip', (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT id, name FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });
  const prev = db.prepare('SELECT * FROM equipment_step_waivers WHERE equipment_id = ? AND step_id = ?').get(eq.id, req.params.stepId);
  db.prepare('DELETE FROM equipment_step_waivers WHERE equipment_id = ? AND step_id = ?').run(eq.id, req.params.stepId);
  if (prev) {
    logAudit(req.user, 'update', 'equipment', eq.id,
      { action: 'setup_step_waiver_removed', step: req.params.stepId }, prev, null, eq.name);
  }
  const fresh = db.prepare('SELECT * FROM equipment WHERE id = ?').get(eq.id);
  res.json(equipmentReadiness(db, fresh));
});

/**
 * Repair maintenance task text that an import split on its commas.
 *
 * Preview first, commit second, exactly like the file importers — this rewrites
 * the maintenance procedure on a compliance record, so nothing moves until
 * somebody has read the before and after.
 *
 * BEFORE '/:id'.
 */
router.get('/maintenance-tasks/repair/preview', (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT id, name, type, asset_id, maintenance_tasks FROM equipment WHERE COALESCE(maintenance_tasks,'{}') NOT IN ('{}','') ORDER BY name").all();
  const machines = [];
  for (const eq of rows) {
    let tasks;
    try { tasks = JSON.parse(eq.maintenance_tasks) || {}; } catch { continue; }
    const out = repairTasks(tasks);
    if (!out.changed) continue;
    const conf = repairConfidence(tasks);
    machines.push({
      id: eq.id, name: eq.name, type: eq.type, asset_id: eq.asset_id,
      before_count: out.before, after_count: out.after, joined: out.joined,
      // Machines whose fragments are all multi-word might have been typed that
      // way on purpose, so they are listed but not pre-selected.
      confident: conf.confident,
      single_word_fragments: conf.single_word_fragments,
      before: tasks, after: out.tasks,
    });
  }
  res.json({
    machines,
    total_machines: machines.length,
    confident_machines: machines.filter(m => m.confident).length,
    total_joined: machines.reduce((t, m) => t + m.joined, 0),
  });
});

router.post('/maintenance-tasks/repair', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids?.length) return res.status(400).json({ error: 'ids are required — nothing is rewritten for machines you did not pick.' });

  const results = [];
  const tx = db.transaction(() => {
    for (const id of ids) {
      const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
      if (!eq) { results.push({ id, error: 'not found' }); continue; }
      let tasks;
      try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { results.push({ id, error: 'unreadable tasks' }); continue; }
      const out = repairTasks(tasks);
      if (!out.changed) { results.push({ id, name: eq.name, joined: 0 }); continue; }

      db.prepare("UPDATE equipment SET maintenance_tasks = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(out.tasks), eq.id);

      // Any schedule built FROM these tasks is carrying the fragments as its
      // procedure steps, so it has to be refreshed too — otherwise the
      // technician's work order still shows "leaks" as a step.
      let refreshed = 0;
      for (const [freq, list] of Object.entries(out.tasks)) {
        const freqType = FREQ_TO_SCHEDULE[freq];
        if (!freqType) continue;
        const steps = JSON.stringify(list);
        refreshed += db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE equipment_id = ? AND frequency_type = ? AND is_active = 1")
          .run(steps, eq.id, freqType).changes;
        db.prepare(`UPDATE work_orders SET procedure_steps = ?
          WHERE status IN ('open','in_progress') AND pm_schedule_id IN
            (SELECT id FROM pm_schedules WHERE equipment_id = ? AND frequency_type = ? AND is_active = 1)`)
          .run(steps, eq.id, freqType);
      }

      // The whole before/after is in the audit trail, so the change is
      // reversible by reading the log rather than by guesswork.
      logAudit(req.user, 'update', 'equipment', eq.id,
        { action: 'maintenance_task_text_repair', joined: out.joined, before_count: out.before, after_count: out.after },
        { maintenance_tasks: eq.maintenance_tasks },
        { maintenance_tasks: JSON.stringify(out.tasks) }, eq.name);
      results.push({ id, name: eq.name, joined: out.joined, before: out.before, after: out.after, schedules_refreshed: refreshed });
    }
  });
  tx();

  const joined = results.reduce((t, r) => t + (r.joined || 0), 0);
  logAudit(req.user, 'bulk_update', 'equipment', null,
    { action: 'maintenance_task_text_repair', machines: results.length, fragments_rejoined: joined }, null, null);
  res.json({ results, machines: results.length, fragments_rejoined: joined });
});

/* ── Equipment documents (manuals, spec sheets, parts lists) ─────────────── */

// The multer instance has to be turned into middleware and its LIMIT_* errors
// answered as a 413 — same wrapper as the training materials upload.
const manualUpload = mediaUpload({ files: 5 }).array('files', 5);
const uploadManuals = (req, res, next) => manualUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});
const FILE_KINDS = ['manual', 'spec_sheet', 'parts_list', 'other'];

router.get('/:id/files', async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM equipment_files WHERE equipment_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(await Promise.all(rows.map(async f => ({
    id: f.id, kind: f.kind, title: f.title, filename: f.filename,
    content_type: f.content_type, size: f.size, uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    // The extracted text is megabytes of OCR — the client gets whether it
    // worked, never the text itself.
    searchable: f.text_status === 'ok' && !!f.extracted_text,
    text_status: f.text_status,
    url: await presignGet(f.storage_key, f.filename),
  }))));
});

router.post('/:id/files', uploadManuals, async (req, res) => {
  const files = req.files || [];
  try {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    const db = getDb();
    const eq = db.prepare('SELECT id, name FROM equipment WHERE id = ?').get(req.params.id);
    if (!eq) return res.status(404).json({ error: 'Equipment not found' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const kind = FILE_KINDS.includes(req.body?.kind) ? req.body.kind : 'manual';
    const out = [];
    for (const f of files) {
      const id = uuid();
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `equipment/${eq.id}/${id}-${safe}`;
      await putStream(key, createReadStream(f.path), f.mimetype);

      // Pull the text out so a search can find a part number printed inside the
      // PDF. Best-effort: a manual that won't OCR is still a manual, and the
      // row records that the text is missing rather than pretending.
      let text = null, status = 'none';
      try {
        const buf = await getObjectBuffer(key);
        text = await extractInvoiceText(buf, f.mimetype, f.originalname);
        status = text && text.trim() ? 'ok' : 'empty';
      } catch (e) {
        status = 'failed';
        console.warn('[equipment] manual text extraction failed:', e.message);
      }

      db.prepare(`INSERT INTO equipment_files (id, equipment_id, kind, title, filename, content_type, size, storage_key, extracted_text, text_status, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, eq.id, kind, (req.body?.title || '').slice(0, 200) || null,
        (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null,
        key, text || null, status, req.user?.name || null);
      out.push({ id, filename: f.originalname, kind, searchable: status === 'ok' });
    }
    logAudit(req.user, 'create', 'equipment_file', eq.id, { files: out.map(o => o.filename), kind }, null, null, eq.name);
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

// Attach an already-uploaded manual to more machines. One vacuum manual covers
// eleven identical vacuums — re-uploading it eleven times is what people were
// doing. This re-references the SAME stored object (and its extracted text, so
// search covers every copy) into new rows; nothing is uploaded twice. A machine
// that already has this document is skipped rather than doubled.
router.post('/files/:fileId/attach', (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM equipment_files WHERE id = ?').get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const ids = Array.isArray(req.body?.equipment_ids) ? req.body.equipment_ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one machine.' });

  const getEq = db.prepare('SELECT id, name FROM equipment WHERE id = ?');
  const already = db.prepare('SELECT 1 FROM equipment_files WHERE equipment_id = ? AND storage_key = ?');
  const ins = db.prepare(`INSERT INTO equipment_files (id, equipment_id, kind, title, filename, content_type, size, storage_key, extracted_text, text_status, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const attached = [];
  const skipped = [];
  db.transaction(() => {
    for (const eid of ids) {
      const eq = getEq.get(eid);
      if (!eq || eq.id === f.equipment_id) continue;
      if (already.get(eq.id, f.storage_key)) { skipped.push(eq.name); continue; }
      ins.run(uuid(), eq.id, f.kind, f.title, f.filename, f.content_type, f.size,
        f.storage_key, f.extracted_text, f.text_status, req.user?.name || null);
      attached.push(eq.name);
    }
  })();
  logAudit(req.user, 'create', 'equipment_file', f.id,
    { filename: f.filename, attached_to: attached, skipped_already_attached: skipped }, null, null, f.filename);
  res.json({ attached: attached.length, skipped: skipped.length, machines: attached });
});

router.delete('/files/:fileId', (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM equipment_files WHERE id = ?').get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM equipment_files WHERE id = ?').run(f.id);
  // A manual attached to several machines shares one stored object — removing
  // it from this machine must not take it off the others, so the object is
  // purged only when the last reference is gone.
  const stillRef = db.prepare('SELECT 1 FROM equipment_files WHERE storage_key = ? LIMIT 1').get(f.storage_key);
  if (!stillRef) deleteObject(f.storage_key);
  logAudit(req.user, 'delete', 'equipment_file', f.equipment_id, { filename: f.filename, object_purged: !stillRef }, f, null, f.filename);
  res.json({ ok: true });
});

/**
 * Search inside the manuals. "Which filter does the auger take?" is the whole
 * point of extracting the text, and it is answered across every machine at
 * once rather than one document at a time.
 */
router.get('/files/search', (req, res) => {
  const db = getDb();
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, results: [] });
  const rows = db.prepare(`
    SELECT f.id, f.equipment_id, f.filename, f.kind, f.extracted_text, e.name AS equipment_name
    FROM equipment_files f JOIN equipment e ON f.equipment_id = e.id
    WHERE f.text_status = 'ok' AND f.extracted_text LIKE ?
    LIMIT 50
  `).all(`%${q}%`);
  // A snippet around the hit, so the answer is on the results page rather than
  // three clicks into a 200-page PDF.
  const results = rows.map(r => {
    const text = r.extracted_text || '';
    const at = text.toLowerCase().indexOf(q.toLowerCase());
    const from = Math.max(0, at - 90);
    return {
      id: r.id, equipment_id: r.equipment_id, equipment_name: r.equipment_name,
      filename: r.filename, kind: r.kind,
      snippet: (from > 0 ? '…' : '') + text.slice(from, at + q.length + 110).replace(/\s+/g, ' ') + '…',
      hits: text.toLowerCase().split(q.toLowerCase()).length - 1,
    };
  });
  res.json({ query: q, results });
});

/**
 * Read the manual's maintenance section and say what it mentions that the PM
 * tasks don't.
 *
 * SUGGESTIONS ONLY — it never edits the tasks. A machine's maintenance
 * procedure quietly rewritten by an AI reading a PDF is exactly the kind of
 * record that must not change without a person deciding, and the output here
 * is a list to read, not a diff to apply.
 */
router.post('/:id/files/compare-pm', async (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI is not configured on this server, so manuals cannot be compared to the PM tasks.' });

  const files = db.prepare("SELECT filename, extracted_text FROM equipment_files WHERE equipment_id = ? AND text_status = 'ok'").all(eq.id);
  if (!files.length) return res.status(400).json({ error: 'No searchable manual on this machine yet. Upload one whose text could be read.' });

  let tasks;
  try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { tasks = {}; }

  try {
    const out = await compareManualToTasks({
      equipmentName: eq.name,
      manualText: files.map(f => f.extracted_text).join('\n\n').slice(0, 120000),
      tasks,
    });
    logAudit(req.user, 'update', 'equipment', eq.id,
      { action: 'manual_pm_comparison', suggestions: out.suggestions?.length || 0 }, null, null, eq.name);
    res.json({ ...out, compared_files: files.map(f => f.filename) });
  } catch (e) {
    res.status(502).json({ error: `Could not compare the manual: ${e.message}` });
  }
});

// Bulk update - POST to avoid /:id conflict
router.post('/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, changes } = req.body;
  if (!ids?.length || !changes) return res.status(400).json({ error: 'ids and changes are required' });

  const fields = [];
  const vals = [];
  const allowed = ['type', 'location', 'room', 'manufacturer', 'model_number', 'vendor', 'pm_frequency', 'is_food_contact', 'haccp_ccp_id', 'status', 'notes', 'maintenance_tasks', 'task_group', 'asset_kind', 'loto_required'];

  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.includes(key)) continue;
    if (key === 'asset_kind') {
      // Reclassifying a batch of rows is exactly what bulk edit is for, but an
      // unrecognised value would silently write nonsense into the column every
      // readiness rule reads.
      if (!ASSET_KINDS.includes(value)) return res.status(400).json({ error: `asset_kind must be one of ${ASSET_KINDS.join(', ')}` });
      fields.push(`${key} = ?`);
      vals.push(value);
    } else if (key === 'is_food_contact' || key === 'loto_required') {
      fields.push(`${key} = ?`);
      vals.push(value ? 1 : 0);
    } else if (key === 'maintenance_tasks') {
      fields.push(`${key} = ?`);
      vals.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      vals.push(value);
    }
  }

  if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  fields.push("updated_at = datetime('now')");

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE equipment SET ${fields.join(', ')} WHERE id IN (${placeholders})`).run(...vals, ...ids);

  if (changes.maintenance_tasks !== undefined) {
    for (const id of ids) syncMaintenanceTasksToPM(db, id);
  }
  if (changes.task_group !== undefined) {
    for (const id of ids) syncTaskGroupToPM(db, id, changes.task_group);
  }
  // Hold the same invariant the single-record paths do: a zone has no energy
  // source to lock out, so bulk-reclassifying to zone clears the flag rather
  // than leaving rows the checklist and the LOTO badge disagree about.
  if (changes.asset_kind === 'zone') {
    db.prepare(`UPDATE equipment SET loto_required = 0 WHERE id IN (${placeholders})`).run(...ids);
  }

  logAudit(req.user, 'bulk_update', 'equipment', null, { ids, fields: Object.keys(changes) }, null, null);
  res.json({ updated: ids.length });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Equipment not found' });

  const { name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, status, notes, maintenance_tasks, task_group } = req.body;
  // Both are deliberate classifications, so an absent field means "leave it" —
  // never "re-derive it from the type". Someone who marked a machine as not
  // needing lockout must not have that undone by an unrelated edit.
  const assetKind = ASSET_KINDS.includes(req.body.asset_kind) ? req.body.asset_kind : existing.asset_kind;
  // A ZONE CANNOT REQUIRE LOCKOUT. That isn't a preference to be preserved —
  // an area has no energy source — and leaving the flag set produced a row the
  // checklist treated as a zone while the LOTO coverage badge still counted it
  // as a machine missing its procedure. Reclassifying clears it.
  const lotoRequired = assetKind === 'zone' ? 0
    : req.body.loto_required !== undefined
      ? (req.body.loto_required ? 1 : 0)
      : existing.loto_required;
  db.prepare(`
    UPDATE equipment SET name = ?, type = ?, location = ?, room = ?, asset_id = ?, manufacturer = ?,
    model_number = ?, serial_number = ?, vendor = ?, pm_frequency = ?, is_food_contact = ?,
    haccp_ccp_id = ?, status = ?, notes = ?, maintenance_tasks = ?, task_group = ?,
    asset_kind = ?, loto_required = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    name || existing.name, type || existing.type, location ?? existing.location,
    room ?? existing.room, asset_id ?? existing.asset_id, manufacturer ?? existing.manufacturer,
    model_number ?? existing.model_number, serial_number ?? existing.serial_number,
    vendor ?? existing.vendor, pm_frequency ?? existing.pm_frequency,
    is_food_contact !== undefined ? (is_food_contact ? 1 : 0) : existing.is_food_contact,
    haccp_ccp_id ?? existing.haccp_ccp_id, status || existing.status, notes ?? existing.notes,
    maintenance_tasks !== undefined ? JSON.stringify(maintenance_tasks) : (existing.maintenance_tasks || '{}'),
    task_group !== undefined ? (task_group || null) : existing.task_group,
    assetKind, lotoRequired, req.params.id
  );
  if (task_group !== undefined && (task_group || null) !== existing.task_group) {
    syncTaskGroupToPM(db, req.params.id, task_group);
  }

  if (maintenance_tasks !== undefined) {
    syncMaintenanceTasksToPM(db, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'equipment', req.params.id, null, existing, updated);
  res.json(updated);
});

export default router;
