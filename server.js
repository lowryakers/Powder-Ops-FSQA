import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { getDb, logAudit } from './server/db.js';
import equipmentRoutes from './server/api/equipment.js';
import haccpRoutes from './server/api/haccp.js';
import pmRoutes from './server/api/pm.js';
import checklistRoutes from './server/api/checklists.js';
import calibrationRoutes from './server/api/calibration.js';
import sanitationRoutes from './server/api/sanitation.js';
import auditRoutes from './server/api/audit.js';
import complianceRoutes from './server/api/compliance.js';
import lotoRoutes from './server/api/loto.js';
import userRoutes from './server/api/users.js';
import submitRoutes from './server/api/submit.js';
import { seedCleaningRecords, seedCleaningChecklists, seedCleaningPMSchedules, seedTempHumidityRecords, seedTempHumidityPMSchedules, seedGlassPlasticRecords, seedGlassPlasticPMSchedules, seedLightInspectionRecords, seedLightInspectionPMSchedules } from './server/cleaning-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

app.use(compression());
app.use(cors());
app.use(express.json());

// Initialize database on startup
let db;
try {
  db = getDb();
  console.log('[db] SQLite database initialized');
} catch (err) {
  console.error('[db] FATAL: Failed to initialize database:', err.message);
  process.exit(1);
}

// Auto-seed equipment if table is empty
const eqCount = db.prepare('SELECT COUNT(*) as c FROM equipment').get().c;
if (eqCount === 0) {
  try {
    const seedPath = path.join(__dirname, 'server', 'seed-data.json');
    const data = JSON.parse(readFileSync(seedPath, 'utf-8'));
    const insertEq = db.prepare(`
      INSERT INTO equipment (id, name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const eq of data) {
        const id = uuid();
        insertEq.run(id, eq.name, eq.type, eq.location, eq.room || null, eq.asset_id, eq.manufacturer, eq.model_number, eq.serial_number, eq.vendor, eq.pm_frequency, eq.is_food_contact ? 1 : 0, null, eq.status, eq.notes);
      }
    });
    tx();
    console.log(`[seed] Auto-seeded ${data.length} equipment items`);
  } catch (e) {
    console.warn('[seed] Could not auto-seed equipment:', e.message);
  }
}

// Auto-seed PM schedules if equipment exists but PM is empty
const pmCount = db.prepare('SELECT COUNT(*) as c FROM pm_schedules').get().c;
if (pmCount === 0 && db.prepare('SELECT COUNT(*) as c FROM equipment').get().c > 0) {
  try {
    const pmPath = path.join(__dirname, 'server', 'pm-seed-data.json');
    const pmData = JSON.parse(readFileSync(pmPath, 'utf-8'));
    const eqRows = db.prepare('SELECT id, asset_id FROM equipment WHERE asset_id IS NOT NULL').all();
    const eqIdMap = {};
    for (const r of eqRows) eqIdMap[r.asset_id] = r.id;

    const insertPM = db.prepare(`
      INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, is_active)
      VALUES (?, ?, ?, ?, ?, 1, ?, 1)
    `);
    const freqDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, annual: 365 };
    const insertWO = db.prepare(`
      INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, status)
      VALUES (?, ?, ?, ?, ?, ?, 'open')
    `);
    let seededPM = 0;
    let seededWO = 0;
    const pmTx = db.transaction(() => {
      for (const pm of pmData) {
        const equipId = eqIdMap[pm.equipment_asset_id];
        if (!equipId) continue;
        const pmId = uuid();
        const steps = JSON.stringify(pm.tasks);
        insertPM.run(pmId, equipId, pm.title, null, pm.frequency, steps);
        seededPM++;
        const woId = uuid();
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (freqDays[pm.frequency] || 30));
        insertWO.run(woId, pmId, equipId, pm.title, dueDate.toISOString().split('T')[0], steps);
        seededWO++;
      }
    });
    pmTx();
    console.log(`[seed] Auto-seeded ${seededPM} PM schedules and ${seededWO} work orders`);
  } catch (e) {
    console.warn('[seed] Could not seed PM schedules:', e.message);
  }
}

// Remove old generic QA seed data (qa-seed-data.json) if it exists in the DB
{
  const oldAssetPatterns = ['QA-TH-00%', 'QA-LG-00%', 'QA-CZ-00%'];
  const oldEq = db.prepare("SELECT id FROM equipment WHERE asset_id LIKE 'QA-TH-00%' OR asset_id LIKE 'QA-LG-00%' OR asset_id LIKE 'QA-CZ-00%'").all();
  if (oldEq.length > 0) {
    const oldIds = oldEq.map(e => e.id);
    const ph = oldIds.map(() => '?').join(',');
    const schedIds = db.prepare(`SELECT id FROM pm_schedules WHERE equipment_id IN (${ph})`).all(...oldIds).map(s => s.id);
    const cleanTx = db.transaction(() => {
      if (schedIds.length > 0) {
        const sph = schedIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM work_orders WHERE pm_schedule_id IN (${sph})`).run(...schedIds);
        db.prepare(`DELETE FROM pm_schedules WHERE id IN (${sph})`).run(...schedIds);
      }
      db.prepare(`DELETE FROM work_orders WHERE equipment_id IN (${ph})`).run(...oldIds);
      db.prepare(`DELETE FROM loto_procedures WHERE equipment_id IN (${ph})`).run(...oldIds);
      db.prepare(`DELETE FROM equipment WHERE id IN (${ph})`).run(...oldIds);
    });
    cleanTx();
    console.log(`[seed] Removed ${oldEq.length} old generic QA equipment and related schedules/work orders`);
  }
}

// Auto-seed calibration instruments if empty
const calCount = db.prepare('SELECT COUNT(*) as c FROM calibration_instruments').get().c;
if (calCount === 0) {
  try {
    const calPath = path.join(__dirname, 'server', 'calibration-seed-data.json');
    const calData = JSON.parse(readFileSync(calPath, 'utf-8'));
    const insertCal = db.prepare(`
      INSERT INTO calibration_instruments (id, name, type, serial_number, manufacturer, model, location, room, asset_number, max_capacity, calibration_frequency, last_calibrated, next_due, status, department)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const calTx = db.transaction(() => {
      for (const s of calData) {
        const id = uuid();
        const name = `${s.manufacturer} ${s.model}${s.asset_number ? ' #' + s.asset_number : ''}`;
        const location = [s.room, s.department].filter(Boolean).join(' — ') || null;
        const status = s.next_due && new Date(s.next_due) < new Date() ? 'overdue' : 'active';
        insertCal.run(id, name, 'scale', s.serial_number, s.manufacturer, s.model, location, s.room, s.asset_number, s.max_capacity, 'annual', s.last_calibrated, s.next_due, status, s.department);
      }
    });
    calTx();
    console.log(`[seed] Auto-seeded ${calData.length} calibration instruments`);
  } catch (e) {
    console.warn('[seed] Could not seed calibration:', e.message);
  }
}

// Seed LOTO procedures for all equipment if none exist
const lotoCount = db.prepare('SELECT COUNT(*) as c FROM loto_procedures').get().c;
if (lotoCount === 0 && db.prepare('SELECT COUNT(*) as c FROM equipment').get().c > 0) {
  try {
    const allEquip = db.prepare('SELECT id, name FROM equipment').all();
    const lotoSteps = [
      { section: 'Preparation: Identify Energy Sources', items: [
        'Review equipment manuals and maintenance records',
        'Identify all energy sources: electrical, mechanical, hydraulic, pneumatic, chemical, or thermal',
        'Note down potential hazards associated with each energy source',
      ]},
      { section: 'Notification: Inform Affected Employees', items: [
        'Inform employees who work on or near the equipment about scheduled maintenance',
        'Explain what maintenance will be performed and the expected duration',
        'Clearly communicate that the equipment will be shut down and locked out, and employees must not attempt to operate it',
        'Address questions or concerns to prevent confusion or accidents',
      ]},
      { section: 'Shutdown: Power Down Equipment', items: [
        "Follow the manufacturer's recommended shutdown procedure",
        'Use normal operating controls',
        'Wait until all moving parts come to a complete stop',
        'Double-check that no secondary systems are still running',
      ]},
      { section: 'Isolation: Disconnect Energy Sources', items: [
        'Locate all primary and secondary energy sources, such as electrical switches, valves, breakers, etc.',
        'Disconnect or block each source to stop energy from flowing back into the system',
        'Use energy isolating devices such as circuit breakers and valve covers',
        'Confirm that all energy sources have been fully cut off — many machines have multiple sources',
      ]},
      { section: 'Lockout/Tagout: Apply Devices', items: [
        'Apply locks to energy control devices (switches, breakers, etc.) to prevent accidental reactivation',
        'Place tags indicating that maintenance is in progress and equipment must not be operated',
        'Use individually identifiable locks. Only the employee who applied the device removes it, except under a documented, employer-directed process',
        'Double-check that all devices are secure and visible',
      ]},
      { section: 'Release Stored Energy: Ensure Zero Energy State', items: [
        'Release or relieve stored energy in springs, capacitors, hydraulic systems, or pneumatic lines',
        'Bleed off pressure, drain fluids, or discharge residual electrical energy as needed',
        'Confirm that all moving parts are fully stopped and cannot restart unexpectedly',
        'Lock or block components that could move due to stored energy',
      ]},
      { section: 'Verification: Confirm Isolation', items: [
        "Attempt to start the equipment using normal controls to confirm it doesn't operate",
        'Test each energy source individually if possible',
        'Check that all locks, tags, and isolation devices are securely and properly placed',
        'Verify with a second qualified person when required by your safety procedures',
        'Only begin maintenance once you are 100% confident the equipment is safe',
      ]},
    ];
    const energySources = ['electrical', 'mechanical', 'hydraulic', 'pneumatic', 'chemical', 'thermal'];
    const flatSteps = lotoSteps.flatMap(s => [s.section + ':', ...s.items.map(i => '  ' + i)]);
    const insertLoto = db.prepare(`INSERT INTO loto_procedures (id, equipment_id, title, description, energy_sources, steps, required_locks, required_tags, verification_method) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'try_start')`);
    const lotoTx = db.transaction(() => {
      for (const eq of allEquip) {
        insertLoto.run(uuid(), eq.id, `LOTO — ${eq.name}`, 'Standard Lockout/Tagout Procedure Checklist', JSON.stringify(energySources), JSON.stringify(flatSteps));
      }
    });
    lotoTx();
    console.log(`[seed] Created LOTO procedures for ${allEquip.length} equipment items`);
  } catch (e) {
    console.warn('[seed] Could not seed LOTO procedures:', e.message);
  }
}

// Seed default admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const seedUsers = db.transaction(() => {
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Admin', 'lowry@powder-ops.com', '1234', 'admin', 'warehouse');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Adam B.', 'adam@powder-ops.com', '1111', 'operator', 'warehouse');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Ricardo A.', 'ricardo@powder-ops.com', '2222', 'operator', 'warehouse');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Spencer R.', 'spencer@powder-ops.com', '3333', 'operator', 'warehouse');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'QA Tech', 'qa@powder-ops.com', '4444', 'operator', 'qa');
  });
  seedUsers();
  console.log('[seed] Created default users (admin + operators)');
}

// Backfill 4 months of completed work order history if none exist
const completedCount = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE status = 'completed'").get().c;
if (completedCount === 0 && db.prepare("SELECT COUNT(*) as c FROM work_orders").get().c > 0) {
  try {
    const TECHS = ['Adam B.', 'Ricardo A.', 'Spencer R.'];
    const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
    const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, semi_annual: 182, annual: 365 };
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 4);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);

    const schedules = db.prepare('SELECT ps.*, e.name as eq_name FROM pm_schedules ps JOIN equipment e ON ps.equipment_id = e.id WHERE ps.is_active = 1').all();
    const insertWO = db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, status, priority, assigned_to, started_at, completed_at, completed_by, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'completed', 'normal', ?, ?, ?, ?, ?, ?, ?)`);
    const NOTES = ['No issues found', 'Minor wear noted', 'Cleaned and lubricated', 'All readings within spec', 'Topped off lubricant', null, null, null, null, null];
    let count = 0;
    const seedTx = db.transaction(() => {
      for (const s of schedules) {
        const interval = freqDays[s.frequency_type] || 30;
        const cursor = new Date(startDate);
        while (cursor <= endDate) {
          const dueDate = cursor.toISOString().split('T')[0];
          const delay = Math.floor(Math.random() * Math.min(interval, 3));
          const done = new Date(cursor); done.setDate(done.getDate() + delay);
          done.setHours(6 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
          if (done > endDate) break;
          const tech = pickOne(TECHS);
          const started = new Date(done.getTime() - (15 + Math.random() * 45) * 60000).toISOString();
          const created = new Date(cursor); created.setDate(created.getDate() - Math.min(interval, 7));
          insertWO.run(uuid(), s.id, s.equipment_id, s.title, dueDate, s.procedure_steps, tech, started, done.toISOString(), tech, pickOne(NOTES), created.toISOString(), done.toISOString());
          count++;
          cursor.setDate(cursor.getDate() + interval);
        }
      }
    });
    seedTx();
    console.log(`[seed] Backfilled ${count} completed work orders (4 months of history)`);
  } catch (e) {
    console.warn('[seed] Could not backfill history:', e.message);
  }
}

// Fix technician names on completed work orders
const oldNames = ['Carlos M.', 'Derek W.', 'James R.', 'Luis T.'];
const newNames = ['Adam B.', 'Ricardo A.', 'Spencer R.'];
const hasOld = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE assigned_to IN ('Carlos M.','Derek W.','James R.','Luis T.') AND status = 'completed'").get().c;
if (hasOld > 0) {
  const reassign = db.transaction(() => {
    for (const old of oldNames) {
      const replacement = newNames[Math.floor(Math.random() * newNames.length)];
      db.prepare("UPDATE work_orders SET assigned_to = ?, completed_by = ? WHERE assigned_to = ? AND status = 'completed'").run(replacement, replacement, old);
      db.prepare("UPDATE audit_log SET actor = ? WHERE actor = ?").run(replacement, old);
    }
  });
  reassign();
  console.log(`[migrate] Reassigned ${hasOld} completed WOs to correct technician names`);
}

// Seed cleaning/sanitation records and checklist templates
seedCleaningRecords(db);
seedCleaningChecklists(db);
seedCleaningPMSchedules(db);
seedTempHumidityRecords(db);
seedTempHumidityPMSchedules(db);
seedGlassPlasticRecords(db);
seedGlassPlasticPMSchedules(db);
seedLightInspectionRecords(db);
seedLightInspectionPMSchedules(db);

// --- File Uploads ---
const UPLOAD_DIR = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data'), 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|heic|pdf|mp4|mov)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

app.post('/api/uploads', upload.array('files', 5), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  const results = req.files.map(f => ({
    filename: f.filename,
    originalName: f.originalname,
    size: f.size,
    url: `/uploads/${f.filename}`,
  }));
  res.json(results);
});

app.use('/uploads', express.static(UPLOAD_DIR));

// --- API Routes ---
app.use('/api/equipment', equipmentRoutes);
app.use('/api/haccp', haccpRoutes);
app.use('/api/pm', pmRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/calibration', calibrationRoutes);
app.use('/api/sanitation', sanitationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/loto', lotoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/submit', submitRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  const db = getDb();
  const counts = {
    equipment: db.prepare('SELECT COUNT(*) as c FROM equipment').get().c,
    pm_schedules: db.prepare('SELECT COUNT(*) as c FROM pm_schedules').get().c,
    work_orders: db.prepare('SELECT COUNT(*) as c FROM work_orders').get().c,
    checklists: db.prepare('SELECT COUNT(*) as c FROM checklist_templates').get().c,
    calibration_instruments: db.prepare('SELECT COUNT(*) as c FROM calibration_instruments').get().c,
    audit_log_entries: db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c,
  };
  const woByStatus = db.prepare("SELECT status, COUNT(*) as c FROM work_orders GROUP BY status").all();
  const activeSchedules = db.prepare("SELECT COUNT(*) as c FROM pm_schedules WHERE is_active = 1").get().c;
  const schedulesWithOpenWO = db.prepare("SELECT COUNT(DISTINCT pm_schedule_id) as c FROM work_orders WHERE pm_schedule_id IS NOT NULL AND status IN ('open','in_progress')").get().c;
  const schedulesWithoutOpenWO = activeSchedules - schedulesWithOpenWO;
  res.json({ status: 'ok', database: 'connected', counts, work_orders_by_status: woByStatus, active_schedules: activeSchedules, schedules_with_open_wo: schedulesWithOpenWO, schedules_missing_open_wo: schedulesWithoutOpenWO });
});

// Serve static React build
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] FSQA Compliance Platform running on port ${PORT}`);
});
