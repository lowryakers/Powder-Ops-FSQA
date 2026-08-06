import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { equipmentReadiness, readinessSummary } from '../equipment-readiness.js';
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

router.post('/:id/schedules-from-tasks', (req, res) => {
  const db = getDb();
  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipment not found' });

  let tasks;
  try { tasks = JSON.parse(eq.maintenance_tasks || '{}') || {}; } catch { tasks = {}; }
  const existing = db.prepare('SELECT title, frequency_type FROM pm_schedules WHERE equipment_id = ? AND is_active = 1').all(eq.id);

  const created = [];
  const skipped = [];
  for (const [freq, list] of Object.entries(tasks)) {
    if (!Array.isArray(list) || !list.length) continue;
    const freqType = FREQ_TO_SCHEDULE[freq];
    // "As Needed" has no interval, so it cannot generate a recurring task —
    // saying so is better than inventing a cadence nobody chose.
    if (!freqType) { skipped.push({ frequency: freq, reason: 'not a recurring frequency' }); continue; }
    if (existing.some(x => x.frequency_type === freqType)) { skipped.push({ frequency: freq, reason: 'already has a schedule' }); continue; }

    const id = uuid();
    db.prepare(`
      INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, eq.id, `${eq.name} — ${freq} PM`,
      `Created from the maintenance tasks written on ${eq.name}.`,
      freqType, JSON.stringify(list.filter(Boolean)), eq.task_group || 'maintenance');
    created.push({ id, frequency: freq, frequency_type: freqType, steps: list.length });
  }

  if (created.length) {
    logAudit(req.user, 'create', 'pm_schedule', eq.id,
      { from: 'maintenance_tasks', equipment: eq.name, created: created.map(c => c.frequency) }, null, null, eq.name);
  }
  const fresh = db.prepare('SELECT * FROM equipment WHERE id = ?').get(eq.id);
  res.json({ created, skipped, readiness: equipmentReadiness(db, fresh) });
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
