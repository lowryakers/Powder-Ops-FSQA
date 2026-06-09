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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());

// Initialize database on startup
const db = getDb();
console.log('[db] SQLite database initialized');

// Auto-seed equipment if table is empty
const eqCount = db.prepare('SELECT COUNT(*) as c FROM equipment').get().c;
if (eqCount === 0) {
  try {
    const seedPath = path.join(__dirname, 'server', 'seed-data.json');
    const data = JSON.parse(readFileSync(seedPath, 'utf-8'));
    const insert = db.prepare(`
      INSERT INTO equipment (id, name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const eq of data) {
        const id = uuid();
        insert.run(id, eq.name, eq.type, eq.location, eq.room || null, eq.asset_id, eq.manufacturer, eq.model_number, eq.serial_number, eq.vendor, eq.pm_frequency, eq.is_food_contact ? 1 : 0, null, eq.status, eq.notes);
      }
    });
    tx();
    console.log(`[seed] Auto-seeded ${data.length} equipment items`);
  } catch (e) {
    console.warn('[seed] Could not auto-seed:', e.message);
  }
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
