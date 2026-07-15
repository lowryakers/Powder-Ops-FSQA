import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { execSync } from 'child_process';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { getDb } from './server/db.js';
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
import chemicalRoutes from './server/api/chemicals.js';
import hygienicDesignRoutes from './server/api/hygienic-design.js';
import complaintRoutes from './server/api/complaints.js';
import documentRoutes from './server/api/documents.js';
import qmsRoutes, { importCsv as importQmsCsv } from './server/api/qms.js';
import { getType as getQmsType } from './server/qms-config.js';
import { DCR_LOG_CSV, DEVIATION_LOG_CSVS, NON_CONFORMANCE_LOG_CSV, ON_HOLD_LOG_CSV, ORGANOLEPTIC_LOG_CSV } from './server/qms-seed.js';
import orgRoutes from './server/api/org.js';
import disposalRoutes, { importDisposalLog } from './server/api/disposals.js';
import { DISPOSAL_LOG_CSV } from './server/disposal-log-seed.js';
import trainingRoutes from './server/api/training.js';
import aiRoutes from './server/api/ai.js';
import commsRoutes, { backfillEmbeddings } from './server/api/comms.js';
import { initRealtime } from './server/realtime.js';
import mockRecallRoutes from './server/api/mock-recalls.js';
import productionRoutes from './server/api/production.js';
import coaRoutes from './server/api/coa.js';
import { seedCleaningRecords, seedCleaningChecklists, seedCleaningPMSchedules, seedTempHumidityRecords, seedTempHumidityPMSchedules, seedGlassPlasticRecords, seedGlassPlasticPMSchedules, seedLightInspectionRecords, seedLightInspectionPMSchedules, seedApprovedChemicals } from './server/cleaning-seed.js';
import { seedProductionEntries } from './server/production-seed.js';
import { seedTrainingCourses } from './server/training-seed.js';
import { authenticate } from './server/middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Build version: git commit hash or build timestamp
let BUILD_VERSION;
try {
  BUILD_VERSION = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
} catch {
  BUILD_VERSION = Date.now().toString(36);
}

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

let server;

app.use(compression());
app.use(cors());
// Bulk document imports and base64 attachments can be large, so allow a
// generous JSON body (default is only 100kb, which 413's a 50-doc import).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// Data migrations — wrapped in try/catch to prevent startup crashes on existing DBs
try {

// Remove old generic QA seed data (qa-seed-data.json) if it exists in the DB
{
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

// Migrate cleaning tasks from 'qa' to 'cleaning' group
{
  const cleaningEqIds = db.prepare("SELECT id FROM equipment WHERE asset_id LIKE 'QA-CL-%'").all().map(e => e.id);
  if (cleaningEqIds.length > 0) {
    const ph = cleaningEqIds.map(() => '?').join(',');
    const updated = db.prepare(`UPDATE pm_schedules SET task_group = 'cleaning' WHERE task_group = 'qa' AND equipment_id IN (${ph})`).run(...cleaningEqIds);
    const updatedWO = db.prepare(`UPDATE work_orders SET task_group = 'cleaning' WHERE task_group = 'qa' AND equipment_id IN (${ph})`).run(...cleaningEqIds);
    if (updated.changes > 0) {
      console.log(`[migrate] Re-tagged ${updated.changes} cleaning PM schedules and ${updatedWO.changes} work orders from 'qa' to 'cleaning'`);
    }
  }
}

// Fix light inspection frequency from quarterly to semi_annual (biannual)
{
  const updated = db.prepare("UPDATE pm_schedules SET frequency_type = 'semi_annual' WHERE title LIKE 'Light Inspection%' AND frequency_type = 'quarterly'").run();
  if (updated.changes > 0) console.log(`[migrate] Updated ${updated.changes} light inspection schedules from quarterly to semi_annual (biannual)`);
}

// Fix PM schedule and work order titles to match cleaned equipment names
{
  const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Semi-Annual', annual: 'Annual' };
  const scheds = db.prepare(`
    SELECT ps.id, ps.title, ps.frequency_type, e.name as eq_name, e.asset_id
    FROM pm_schedules ps JOIN equipment e ON ps.equipment_id = e.id
    WHERE ps.task_group IN ('warehouse', 'maintenance')
  `).all();
  const updatePM = db.prepare('UPDATE pm_schedules SET title = ? WHERE id = ?');
  const updateWO = db.prepare('UPDATE work_orders SET title = ? WHERE pm_schedule_id = ?');
  let fixed = 0;
  const tx = db.transaction(() => {
    for (const s of scheds) {
      const freqLabel = FREQ_LABEL[s.frequency_type] || s.frequency_type;
      const expected = `${freqLabel} PM — ${s.asset_id} ${s.eq_name}`;
      if (s.title !== expected) {
        updateWO.run(expected, s.id);
        updatePM.run(expected, s.id);
        fixed++;
      }
    }
  });
  tx();
  if (fixed > 0) console.log(`[migrate] Fixed ${fixed} PM schedule/work order titles to match equipment names`);
}

// Separate "maintenance" group from "warehouse" — production equipment moves to maintenance
{
  const maintenanceTypes = ['Auger', 'Coder', 'Compressor', 'Conveyor', 'Dehumidifier', 'Dust Collector',
    'Fan', 'Feeder', 'Filler', 'HEPA Filter', 'Hand Tool',
    'Heat Tunnel', 'Hydraulic Lift', 'Mixer', 'Scissor Lift', 'Sealer',
    'Shop Vac', 'Sifter', 'Tape Machine', 'Turn Table', 'X-Ray', 'A/C', 'Cooler'];
  const ph = maintenanceTypes.map(() => '?').join(',');
  const maintEqIds = db.prepare(`SELECT id FROM equipment WHERE type IN (${ph})`).all(...maintenanceTypes).map(e => e.id);
  if (maintEqIds.length > 0) {
    const eqPh = maintEqIds.map(() => '?').join(',');
    const u1 = db.prepare(`UPDATE pm_schedules SET task_group = 'maintenance' WHERE task_group = 'warehouse' AND equipment_id IN (${eqPh})`).run(...maintEqIds);
    const u2 = db.prepare(`UPDATE work_orders SET task_group = 'maintenance' WHERE task_group = 'warehouse' AND equipment_id IN (${eqPh})`).run(...maintEqIds);
    if (u1.changes > 0) console.log(`[migrate] Moved ${u1.changes} PM schedules and ${u2.changes} work orders from 'warehouse' to 'maintenance'`);
  }
}

// Update forklift daily inspection steps to structured G/B/X format
{
  const FORKLIFT_DAILY_STEPS = [
    'Check the Safety light housing|check|KEY OFF Procedures',
    'Overhead Light|check|KEY OFF Procedures',
    'Overhead Fan|check|KEY OFF Procedures',
    'Dash plastic|check|KEY OFF Procedures',
    'Head lights (Glass)|check|KEY OFF Procedures',
    'The vehicle inspection|check|KEY OFF Procedures',
    'Overhead guard|check|KEY OFF Procedures',
    'Hydraulic cylinders|check|KEY OFF Procedures',
    'Mast assembly|check|KEY OFF Procedures',
    'Lift chains and rollers|check|KEY OFF Procedures',
    'Forks|check|KEY OFF Procedures',
    'Tires|check|KEY OFF Procedures',
    'Examine the battery (any fluids on top? Acid?)|check|KEY OFF Procedures',
    'Water level (If added, how much?)|input|Fluid Checks',
    'Check the hydraulic fluid level|check|Fluid Checks',
    'Brake fluid level|check|Fluid Checks',
    'Grease Bearings (If need, notify Maintenance)|check|Fluid Checks',
    'KEY ON Procedures|check|KEY ON Procedures',
    'Check the gauges|check|KEY ON Procedures',
    'Hour meter (write the hours)|input|KEY ON Procedures',
    'Battery Level|check|KEY ON Procedures',
    'Test the standard equipment|check|KEY ON Procedures',
    'Steering|check|KEY ON Procedures',
    'Brakes|check|KEY ON Procedures',
    'Horn|check|KEY ON Procedures',
    'Safety seat (if equipped)|check|KEY ON Procedures',
  ];

  const PALLET_JACK_DAILY_STEPS = [
    'Forks condition (cracks, bends)|check|Visual Inspection',
    'Wheels and rollers|check|Visual Inspection',
    'Handle grip and controls|check|Visual Inspection',
    'Hydraulic jack/pump|check|Visual Inspection',
    'Lowering mechanism|check|Functional Check',
    'Lifting mechanism|check|Functional Check',
    'Steering operation|check|Functional Check',
    'Battery charge level (if electric)|check|Functional Check',
    'Charger and cord condition (if electric)|check|Functional Check',
    'Leaks (hydraulic fluid)|check|Functional Check',
    'Horn/alert (if equipped)|check|Functional Check',
    'Overall cleanliness|check|General',
  ];

  const CHARGER_DAILY_STEPS = [
    'Power cord condition|check|Inspection',
    'Connector/plug condition|check|Inspection',
    'Indicator lights functioning|check|Inspection',
    'Ventilation clear and unobstructed|check|Inspection',
    'No unusual smell or heat|check|Inspection',
    'Area around charger clean and dry|check|Inspection',
  ];

  const forkliftEq = db.prepare("SELECT id, name, type FROM equipment WHERE type IN ('Forklift', 'Forklift Charger', 'Pallet Jack')").all();
  let updatedCount = 0;
  for (const eq of forkliftEq) {
    let dailySteps;
    if (eq.type === 'Forklift') dailySteps = FORKLIFT_DAILY_STEPS;
    else if (eq.type === 'Pallet Jack') dailySteps = PALLET_JACK_DAILY_STEPS;
    else dailySteps = CHARGER_DAILY_STEPS;

    const stepsJson = JSON.stringify(dailySteps);
    const dailyScheds = db.prepare("SELECT id FROM pm_schedules WHERE equipment_id = ? AND frequency_type = 'daily'").all(eq.id);
    for (const s of dailyScheds) {
      db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(stepsJson, s.id);
      db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress')").run(stepsJson, s.id);
      updatedCount++;
    }
  }
  if (updatedCount > 0) console.log(`[migrate] Updated ${updatedCount} forklift/pallet jack daily PM schedules with G/B/X inspection format`);
}

} catch (migrationErr) {
  console.error('[migrate] Non-fatal migration error:', migrationErr.message);
}

// Auto-seed calibration instruments (V2: Scale Number Log with 21 instruments)
{
  const calCount = db.prepare('SELECT COUNT(*) as c FROM calibration_instruments').get().c;
  const hasV2Marker = calCount > 0 ? db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE asset_number = '0157'").get().c : 0;
  const needsSeed = calCount === 0 || (calCount > 0 && !hasV2Marker);
  if (needsSeed) {
    try {
      if (calCount > 0) {
        const hasCalRecords = db.prepare("SELECT COUNT(*) as c FROM calibration_records").get().c;
        if (hasCalRecords === 0) {
          db.prepare("DELETE FROM calibration_instruments").run();
          console.log('[seed] Cleared V1 calibration instruments for V2 re-seed');
        } else {
          console.log('[seed] Skipping calibration re-seed: existing calibration records would be orphaned');
        }
      }
      const currentCount = db.prepare('SELECT COUNT(*) as c FROM calibration_instruments').get().c;
      if (currentCount === 0) {
        const calPath = path.join(__dirname, 'server', 'calibration-seed-data.json');
        const calData = JSON.parse(readFileSync(calPath, 'utf-8'));
        const insertCal = db.prepare(`
          INSERT INTO calibration_instruments (id, name, type, serial_number, manufacturer, model, location, room, asset_number, max_capacity, calibration_frequency, last_calibrated, next_due, status, department, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const calTx = db.transaction(() => {
          for (const s of calData) {
            const id = uuid();
            const mfr = s.manufacturer || 'Unknown';
            const mdl = s.model || 'Scale';
            const name = `${mfr} ${mdl}${s.asset_number ? ' #' + s.asset_number : ''}`;
            const location = [s.room, s.department].filter(Boolean).join(' — ') || null;
            const status = s.next_due && new Date(s.next_due) < new Date() ? 'overdue' : 'active';
            insertCal.run(id, name, 'scale', s.serial_number || null, mfr, mdl, location, s.room || null, s.asset_number || null, s.max_capacity || null, 'annual', s.last_calibrated, s.next_due, status, s.department || null, s.notes || null);
          }
        });
        calTx();
        console.log(`[seed] Auto-seeded ${calData.length} calibration instruments (V2 Scale Number Log)`);
      }
    } catch (e) {
      console.warn('[seed] Could not seed calibration:', e.message);
    }
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
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Spencer R.', 'spencer@powder-ops.com', '3333', 'supervisor', 'warehouse');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'QA Tech', 'qa@powder-ops.com', '4444', 'operator', 'qa');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Cleaning Tech', 'cleaning@powder-ops.com', '5555', 'operator', 'cleaning');
    db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), 'Auditor', 'auditor@powder-ops.com', '9999', 'auditor', 'warehouse');
  });
  seedUsers();
  console.log('[seed] Created default users (admin + operators + auditor)');
}

// Ensure auditor user exists (for existing databases)
{
  const hasAuditor = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'auditor'").get().c;
  if (!hasAuditor) {
    try {
      db.prepare(`INSERT INTO users (id, name, email, pin, role, department) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(uuid(), 'Auditor', 'auditor@powder-ops.com', '9999', 'auditor', 'warehouse');
      console.log('[seed] Created auditor user');
    } catch (e) {
      console.warn('[seed] Could not create auditor user:', e.message);
    }
  }
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
try {
  seedCleaningRecords(db);
  seedCleaningChecklists(db);
  seedCleaningPMSchedules(db);
  seedTempHumidityRecords(db);
  seedTempHumidityPMSchedules(db);
  seedGlassPlasticRecords(db);
  seedGlassPlasticPMSchedules(db);
  seedLightInspectionRecords(db);
  seedLightInspectionPMSchedules(db);
  seedApprovedChemicals(db);
} catch (err) {
  console.error('[seed] Error seeding data (non-fatal):', err.message);
}

// Seed production entries
try {
  seedProductionEntries(db);
  console.log('[seed] Production entries seeded');
} catch (err) {
  console.error('[seed] Error seeding production entries (non-fatal):', err.message);
}

// Seed the standard training course catalog + starter tests
try {
  seedTrainingCourses(db);
} catch (err) {
  console.error('[seed] Error seeding training courses (non-fatal):', err.message);
}

// Seed default chat channels
try {
  if (db.prepare('SELECT COUNT(*) c FROM chat_channels').get().c === 0) {
    const mk = (name, topic) => db.prepare("INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, 'public', ?, ?, 'system')").run(uuid(), name, topic);
    mk('general', 'Company-wide announcements and general chat');
    mk('production', 'Production floor coordination');
    mk('quality', 'Quality & food-safety discussion');
    console.log('[seed] Created default chat channels');
  }
} catch (err) {
  console.error('[seed] Error seeding chat channels (non-fatal):', err.message);
}

// Seed COA/Lab Testing historical data
try {
  const coaCount = db.prepare('SELECT COUNT(*) as c FROM coa_requests').get().c;
  if (coaCount === 0) {
    const seedPath = path.join(__dirname, 'seeds', 'coa-seed.json.gz');
    console.log('[seed] COA table empty, checking for seed file at:', seedPath);
    if (existsSync(seedPath)) {
      const compressed = readFileSync(seedPath);
      const rows = JSON.parse(gunzipSync(compressed).toString());
      const labIds = new Set(rows.map(r => r.lab_id).filter(Boolean));
      for (const labId of labIds) {
        const exists = db.prepare('SELECT COUNT(*) as c FROM coa_labs WHERE id = ?').get(labId).c;
        if (exists === 0) {
          const labName = rows.find(r => r.lab_id === labId)?.lab_name || 'Unknown';
          db.prepare('INSERT INTO coa_labs (id, name) VALUES (?, ?)').run(labId, labName);
        }
      }
      const cols = ['id','item_number','item_description','lot_number','product_expiration','tests_requested','status','lab_id','lab_name','date_sent','tat_days','expected_results_date','date_of_results','date_sent_to_customer','requested_by','invoice_amount','retest_required','retest_of','notes','source','source_ref','created_by','created_at','updated_at','origin','supplier','product_code','manufacturer_lot','vendor_lot','received_date','certificate_number','date_of_issuance'];
      const placeholders = cols.map(() => '?').join(',');
      const insert = db.prepare(`INSERT OR IGNORE INTO coa_requests (${cols.join(',')}) VALUES (${placeholders})`);
      const tx = db.transaction((data) => {
        for (const r of data) insert.run(...cols.map(c => r[c] ?? null));
      });
      tx(rows);
      console.log(`[seed] COA: ${rows.length} historical lab requests imported`);
    } else {
      console.log('[seed] COA seed file not found at:', seedPath);
    }
  }
} catch (err) {
  console.error('[seed] Error seeding COA data (non-fatal):', err.message, err.stack);
}

// Seed SOP: Food Safety Policy Statement
{
  const hasFSP = db.prepare("SELECT COUNT(*) as c FROM sop_documents WHERE doc_number = 'POLICY 002'").get().c;
  if (hasFSP === 0) {
    try {
      db.prepare(`INSERT INTO sop_documents (id, doc_number, title, category, revision, effective_date, review_due, owner, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuid(), 'POLICY 002', 'Food Safety Policy Statement', 'safety', 'V2', '2025-11-05', '2026-11-05', 'Daniela Servin',
          `At Powder Ops, we are committed to producing safe, high-quality food products that meet or exceed customer expectations and comply with all applicable regulatory and statutory requirements. As part of our dedication to continuous improvement and food safety excellence, we have implemented a robust Food Safety Management System based on the SQF Food Safety Code.

We pledge to:
• Maintain and continuously improve our SQF-certified Food Safety Management System.
• Identify, evaluate, and control food safety hazards through a validated HACCP-based approach such as formal inspections of brittle plastic and glass.
• Ensure all employees are trained, competent, and empowered to uphold food safety standards.
• Comply with all relevant food safety laws, regulations, and customer requirements.
• Foster a culture of food safety through leadership, accountability, and open communication.
• Monitor and verify the effectiveness of our food safety controls and take corrective actions when necessary.
• Review this policy annually to ensure its ongoing suitability and effectiveness.

This policy is communicated to all employees, stakeholders, and visitors, and is prominently displayed throughout our facility. It reflects our unwavering commitment to food safety and quality at every level of our organization.

Signed,
Daniela Servin
CEO
11/05/2025`);
      console.log('[seed] Created SOP: POLICY 002 — Food Safety Policy Statement');
    } catch (e) {
      console.warn('[seed] Could not seed SOP POLICY 002:', e.message);
    }
  }
}

// Seed complaint log if empty
{
  const complaintCount = db.prepare('SELECT COUNT(*) as c FROM complaints').get().c;
  if (complaintCount === 0) {
    try {
      const complaintPath = path.join(__dirname, 'server', 'complaint-seed-data.json');
      if (existsSync(complaintPath)) {
        const complaints = JSON.parse(readFileSync(complaintPath, 'utf-8'));
        const insertComplaint = db.prepare(`INSERT INTO complaints (id, complaint_number, date_received, customer_name, lot_number, item_number, complaint_text, person_responsible, investigation, corrective_action, resolved, date_resolved, capa_needed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const tx = db.transaction(() => {
          for (const c of complaints) {
            insertComplaint.run(uuid(), c.complaint_number, c.date_received, c.customer_name, c.lot_number || null, c.item_number || null, c.complaint_text, c.person_responsible || null, c.investigation || null, c.corrective_action || null, c.resolved ? 1 : 0, c.date_resolved || null, c.capa_needed ? 1 : 0);
          }
        });
        tx();
        console.log(`[seed] Seeded ${complaints.length} complaint records`);
      }
    } catch (e) {
      console.warn('[seed] Could not seed complaints:', e.message);
    }
  }
}

// Seed CAPA records if empty
{
  const capaCount = db.prepare('SELECT COUNT(*) as c FROM capas').get().c;
  if (capaCount === 0) {
    try {
      const cc25005 = db.prepare("SELECT id FROM complaints WHERE complaint_number = 'CC25-005'").get();
      const insertCAPA = db.prepare(`INSERT INTO capas (id, capa_number, complaint_id, title, description, root_cause, corrective_action, preventive_action, proposed_solution, assigned_to, status, priority, date_issued, item_lot, item_number, item_description, work_order_number, po_number, source_type, immediate_correction, series_of_document, mgmt_verification_date, mgmt_verification_by, nc_number, linked_complaint_number, is_preventive_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const capas = [
        {
          capa_number: 'CAPA-001', title: 'Wrong expiration date format on printed carton',
          description: 'The format was not correct and approved from the start. BB 07/2027, wrong format (156) correct format would be 07/31/2027 (BB MM/DD/YYYY)',
          root_cause: 'Unfortunately the final product had two different expiration formats, even though the customer approved it. We will work harder to ensure this doesn\'t happen again.',
          proposed_solution: 'A meeting was held with the work team where they were informed of the inconsistencies and feedback was given. After that, the room leaders and the quality department were trained again to remind them of the importance of comparing the information in the specifications and the final product.',
          assigned_to: 'Maria Servin', status: 'closed', priority: 'normal',
          date_issued: '2025-07-31', item_lot: 'L00922', item_number: '202513',
          item_description: 'JIN Electrolyte 20ct Printed Carton (Lemonade)',
          source_type: 'deviation', immediate_correction: 'Re-train',
          series_of_document: '25-001', mgmt_verification_date: '2026-03-17', mgmt_verification_by: 'MS',
        },
        {
          capa_number: 'CAPA-002', title: 'Incomplete BPR documentation during production run',
          description: 'Upon completion of the work with W.O MO01292, all the information was gathered, but it was incomplete; some cleaning sheets, packaging options, observations, and sample sticks were missing.',
          root_cause: 'Not having complete documents affects traceability, and at the time of closing the order, the information was not clear, making it more difficult to obtain the final order results.',
          proposed_solution: 'We were to make feedback, about the importance of finishing the production with the pagans completed, in our reports. Additionally, we make the training for the leaders and operations for more information.',
          assigned_to: 'Johana Gonzalez', status: 'closed', priority: 'normal',
          date_issued: '2025-10-01', item_lot: '100135', item_number: 'MO001292',
          item_description: 'Alkify 30ct Finished Good',
          work_order_number: 'MO01292', source_type: 'deviation',
          immediate_correction: 'Re-train', is_preventive_action: true,
          series_of_document: '25-002', mgmt_verification_date: '2026-03-17', mgmt_verification_by: 'MS',
        },
        {
          capa_number: 'CAPA-003', title: 'Customer found ladybug on protein pouch',
          description: 'A Customer found a Ladybug on their protein Pouch and due to that quality department initiated a CAPA. Lab test results from the provided batch were found and results came back passing at the time of the production run. X-ray log was inspected and we did not find any abnormalities throughout the run. QA verified that pest control has come to do consecutive inspections.',
          root_cause: 'N/A',
          proposed_solution: 'Removing cleaning towels from production rooms after they fall on the floor, they need to change gloves and grab a clean towel to bring inside of the room. Everything needs to be sifted before the batch is released to production. Any abnormality that shows on the X-Ray will be opened, re-sifted and re-bagged.',
          assigned_to: 'Maria Servin', status: 'closed', priority: 'high',
          date_issued: '2026-03-17', item_lot: '101025-1', item_number: 'FG0984',
          item_description: 'Coconut Cream Whey Protein Pouch',
          work_order_number: 'MO01467', source_type: 'customer_complaint',
          immediate_correction: 'N/A', is_preventive_action: true,
          nc_number: 'NC#003', linked_complaint_number: 'CC25-005',
          complaint_id_ref: cc25005?.id,
          series_of_document: '25-003', mgmt_verification_date: '2026-03-17', mgmt_verification_by: 'MS',
        },
      ];
      const tx = db.transaction(() => {
        for (const c of capas) {
          const id = uuid();
          insertCAPA.run(id, c.capa_number, c.complaint_id_ref || null, c.title, c.description, c.root_cause,
            c.corrective_action || null, c.preventive_action || null, c.proposed_solution || null,
            c.assigned_to, c.status, c.priority, c.date_issued,
            c.item_lot || null, c.item_number || null, c.item_description || null,
            c.work_order_number || null, c.po_number || null, c.source_type || null,
            c.immediate_correction || null, c.series_of_document || null,
            c.mgmt_verification_date || null, c.mgmt_verification_by || null,
            c.nc_number || null, c.linked_complaint_number || null, c.is_preventive_action ? 1 : 0
          );
          if (c.complaint_id_ref) {
            db.prepare("UPDATE complaints SET capa_id = ?, updated_at = datetime('now') WHERE id = ?").run(id, c.complaint_id_ref);
          }
        }
      });
      tx();
      console.log(`[seed] Seeded ${capas.length} CAPA records`);
    } catch (e) {
      console.warn('[seed] Could not seed CAPAs:', e.message);
    }
  }
}

// Seed org chart from Powder Ops Org Chart Version 6 (02/20/2026) if empty
const orgCount = db.prepare('SELECT COUNT(*) as c FROM org_positions').get().c;
if (orgCount === 0) {
  try {
    // Nested definition — inserted parents-first so parent_id links resolve
    const ORG = {
      title: 'CEO', name: 'Danny Augustyn', backup: 'VP', department: 'executive', children: [
        { title: 'Timekeeping', name: 'Marnee Dortch', department: 'admin' },
        { title: 'Formulations', name: 'Matt Schramm', department: 'quality' },
        { title: 'VP Operations / Payroll', name: 'Lowry Akers', backup: 'CEO', department: 'executive' },
        { title: 'Purchasing Manager', name: 'Jake Waits', backup: 'VP', department: 'admin' },
        { title: 'Quality Technical Support Manager', name: 'Carol Pierce', department: 'quality' },
        {
          title: 'Quality Manager / SQF Practitioner', name: 'Maria Servin', backup: 'PCQI', department: 'quality', children: [
            {
              title: 'QA Technician', name: 'Diana Quishpe', department: 'quality', children: [
                {
                  title: 'Document Control Manager', name: 'Daniela Servin', backup: 'QA', department: 'quality', children: [
                    { title: 'Document Control Assistant', name: 'Dayanna Meza Leon', backup: 'QA', department: 'quality' },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'Production Manager / Food Safety PCQI', name: 'Adam Bliss', backup: 'VP', department: 'production', children: [
            { title: 'Sanitation', name: 'Zuleika Mendez', department: 'sanitation' },
            { title: 'Maintenance', name: 'Ricardo Avalos', department: 'maintenance' },
            { title: 'Filling Production Supervisor', name: 'Reina Figueroa', backup: 'Operations', department: 'production', children: [
              { title: 'Hand Fill Workers', department: 'production' },
            ] },
            { title: 'Packaging / Kitting Supervisor', name: 'Jose Luna', backup: 'Operations', department: 'production', children: [
              { title: 'Packing Workers', department: 'production' },
            ] },
            { title: 'Stick Pack Production Supervisor', name: 'Josefa Moy', backup: 'Operations', department: 'production', children: [
              { title: 'Stick Pack Operators', department: 'production' },
            ] },
            { title: 'Batching & Blending Supervisor', name: 'Bernardo Enciso', backup: 'Operations', department: 'production', children: [
              { title: 'Blending Workers', department: 'production' },
            ] },
            { title: 'Warehouse Supervisor', name: 'Juan Gonzalez', backup: 'Operations', department: 'warehouse', children: [
              { title: 'Shipping Assistant', name: 'Danilo Ibanez', department: 'warehouse' },
            ] },
          ],
        },
      ],
    };
    const insert = db.prepare('INSERT INTO org_positions (id, title, name, backup, department, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let n = 0;
    const insertNode = (node, parentId, order) => {
      const id = uuid();
      insert.run(id, node.title, node.name || null, node.backup || null, node.department || null, parentId, order);
      n++;
      (node.children || []).forEach((c, i) => insertNode(c, id, i));
    };
    const seedOrg = db.transaction(() => {
      insertNode(ORG, null, 0);
      db.prepare('INSERT OR REPLACE INTO org_chart_meta (id, version, approved_by, effective_date) VALUES (1, ?, ?, ?)')
        .run('6', 'Lowry Akers', '2026-02-20');
    });
    seedOrg();
    console.log(`[seed] Seeded org chart (${n} positions, Version 6)`);
  } catch (e) {
    console.warn('[seed] Could not seed org chart:', e.message);
  }
}

// Seed the historical Disposal Log once if the register is empty
const disposalCount = db.prepare('SELECT COUNT(*) as c FROM disposals').get().c;
if (disposalCount === 0) {
  try {
    const { disposals, items } = importDisposalLog(db, DISPOSAL_LOG_CSV, 'system-import');
    console.log(`[seed] Imported historical disposal log (${disposals} disposals, ${items} items)`);
  } catch (e) {
    console.warn('[seed] Could not seed disposal log:', e.message);
  }
}

// Seed historical QMS registers (Document Change Requests, Deviations) once
// per type if empty, from the embedded log snapshots.
try {
  const dcrCfg = getQmsType('document_change_request');
  if (dcrCfg && db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='document_change_request'").get().c === 0) {
    const { imported } = importQmsCsv(db, dcrCfg, DCR_LOG_CSV, 'system-import');
    console.log(`[seed] Imported historical Document Change Request log (${imported} records)`);
  }
  const devCfg = getQmsType('deviation');
  if (devCfg && db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='deviation'").get().c === 0) {
    let total = 0;
    for (const csv of DEVIATION_LOG_CSVS) total += importQmsCsv(db, devCfg, csv, 'system-import').imported;
    console.log(`[seed] Imported historical Deviation logs (${total} records)`);
  }
  const ncCfg = getQmsType('non_conformance');
  if (ncCfg && db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='non_conformance'").get().c === 0) {
    const { imported } = importQmsCsv(db, ncCfg, NON_CONFORMANCE_LOG_CSV, 'system-import');
    console.log(`[seed] Imported historical Non-Conformance log (${imported} records)`);
  }
  const holdCfg = getQmsType('on_hold');
  if (holdCfg && db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='on_hold'").get().c === 0) {
    const { imported } = importQmsCsv(db, holdCfg, ON_HOLD_LOG_CSV, 'system-import');
    console.log(`[seed] Imported historical On Hold log (${imported} records)`);
  }
  const orgCfg = getQmsType('organoleptic');
  if (orgCfg && db.prepare("SELECT COUNT(*) c FROM qms_records WHERE record_type='organoleptic'").get().c === 0) {
    const { imported } = importQmsCsv(db, orgCfg, ORGANOLEPTIC_LOG_CSV, 'system-import');
    console.log(`[seed] Imported historical Organoleptic / Shelf-life log (${imported} records)`);
  }
} catch (e) {
  console.warn('[seed] Could not seed QMS registers:', e.message);
}

// One-time migration for the Non-Conformance simplification: the retired
// "Performed By" and "Comments" fields fold into Investigator and Notes so no
// historical content is lost. Idempotent — only touches rows still carrying the
// old keys.
try {
  const ncRows = db.prepare("SELECT id, notes, data FROM qms_records WHERE record_type='non_conformance'").all();
  const upd = db.prepare("UPDATE qms_records SET notes=?, data=?, updated_at=datetime('now') WHERE id=?");
  let moved = 0;
  for (const row of ncRows) {
    let data; try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
    if (data.performed_by === undefined && data.comments === undefined) continue;
    let notes = row.notes;
    if (data.performed_by && !data.investigator) data.investigator = data.performed_by;
    if (data.comments && !(notes && notes.trim())) notes = data.comments;
    delete data.performed_by; delete data.comments; delete data.vendor_number;
    upd.run(notes || null, JSON.stringify(data), row.id);
    moved++;
  }
  if (moved > 0) console.log(`[migrate] Folded NC Performed-By/Comments into Investigator/Notes on ${moved} records`);
} catch (e) {
  console.warn('[migrate] NC field-fold migration skipped:', e.message);
}

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

// This endpoint stays public (the QR-code submit form uses it pre-login),
// so cap upload volume per IP to prevent disk-fill abuse.
const uploadCounts = new Map(); // ip -> { count, windowStart }
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

function uploadRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = uploadCounts.get(ip);
  if (!entry || now - entry.windowStart > UPLOAD_WINDOW_MS) {
    uploadCounts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  if (entry.count >= UPLOAD_LIMIT) {
    return res.status(429).json({ error: 'Too many uploads. Try again later.' });
  }
  entry.count++;
  next();
}

app.post('/api/uploads', uploadRateLimit, upload.array('files', 5), (req, res) => {
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

// --- Auth middleware (applied to all /api/* except public paths) ---
app.use('/api', (req, res, next) => {
  const skip = [
    '/users/login',
    '/users/set-password',
    '/submit/',
    '/version',
    '/health',
  ];
  if (skip.some(p => req.path === p || req.path.startsWith(p))) return next();
  authenticate(req, res, next);
});

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
app.use('/api/chemicals', chemicalRoutes);
app.use('/api/hygienic-design', hygienicDesignRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/disposals', disposalRoutes);
app.use('/api/qms', qmsRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/comms', commsRoutes);
app.use('/api/mock-recalls', mockRecallRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/coa', coaRoutes);

// Version check (used by client to detect updates)
app.get('/api/version', (_req, res) => {
  res.json({ version: BUILD_VERSION });
});

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

// Serve static React build — hashed assets get long cache, HTML never caches
app.use('/assets', express.static(path.join(__dirname, 'dist', 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Purge expired sessions on startup and hourly so the table doesn't grow unbounded
function purgeExpiredSessions() {
  try {
    const { changes } = getDb().prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    if (changes > 0) console.log(`[auth] Purged ${changes} expired session${changes > 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('[auth] Session purge failed:', e.message);
  }
}
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

server = createServer(app);
initRealtime(server); // Comms Phase 2 — socket.io realtime on the same HTTP server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] FSQA Compliance Platform running on port ${PORT} (build ${BUILD_VERSION})`);
  // Backfill message embeddings in the background (no-op unless Voyage is configured).
  backfillEmbeddings().catch(e => console.warn('[comms] embedding backfill error:', e.message));
});

function shutdown(signal) {
  console.log(`[server] ${signal} received — draining connections...`);
  server.closeAllConnections();
  server.close(() => {
    console.log('[server] All connections drained. Exiting.');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('[server] Forced exit after timeout');
    process.exit(0);
  }, 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
