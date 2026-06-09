import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { v4 as uuid } from 'uuid';
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

// Seed default admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const adminId = uuid();
  db.prepare(`INSERT INTO users (id, name, email, pin, role) VALUES (?, ?, ?, ?, ?)`).run(adminId, 'Admin', 'lowry@powder-ops.com', '1234', 'admin');
  console.log('[seed] Created default admin user (pin: 1234)');
}

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
  res.json({ status: 'ok', database: 'connected', counts });
});

// Serve static React build
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] FSQA Compliance Platform running on port ${PORT}`);
});
