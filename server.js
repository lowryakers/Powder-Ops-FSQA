import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());

// Initialize database on startup
getDb();
console.log('[db] SQLite database initialized');

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
