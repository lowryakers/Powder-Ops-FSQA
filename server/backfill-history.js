import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'compliance.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const TECHNICIANS = ['Adam B.', 'Ricardo A.', 'Spencer R.'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const freqDays = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  semi_annual: 182,
  annual: 365,
};

const MONTHS_BACK = 4;
const startDate = new Date('2026-02-15');
const endDate = new Date('2026-06-14');

const schedules = db.prepare(`
  SELECT ps.*, e.name as equipment_name
  FROM pm_schedules ps
  JOIN equipment e ON ps.equipment_id = e.id
  WHERE ps.is_active = 1
`).all();

console.log(`Found ${schedules.length} active PM schedules`);
console.log(`Backfilling from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

const insertWO = db.prepare(`
  INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, status, priority, assigned_to, started_at, completed_at, completed_by, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'completed', 'normal', ?, ?, ?, ?, ?, ?, ?)
`);

const insertAudit = db.prepare(`
  INSERT INTO audit_log (actor, action, entity_type, entity_id, details, timestamp)
  VALUES (?, 'complete', 'work_order', ?, ?, ?)
`);

let totalGenerated = 0;
const byCounts = { daily: 0, weekly: 0, monthly: 0, quarterly: 0, annual: 0, other: 0 };

const tx = db.transaction(() => {
  for (const sched of schedules) {
    const interval = freqDays[sched.frequency_type] || 30;
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const dueDate = cursor.toISOString().split('T')[0];

      const completionDelay = Math.floor(Math.random() * Math.min(interval, 3));
      const completedDate = new Date(cursor);
      completedDate.setDate(completedDate.getDate() + completionDelay);
      const completedHour = 6 + Math.floor(Math.random() * 10);
      const completedMin = Math.floor(Math.random() * 60);
      completedDate.setHours(completedHour, completedMin, 0);

      if (completedDate > endDate) break;

      const completedAt = completedDate.toISOString();
      const startedAt = new Date(completedDate.getTime() - (15 + Math.random() * 45) * 60000).toISOString();
      const tech = pick(TECHNICIANS);
      const woId = uuid();

      const createdAt = new Date(cursor);
      createdAt.setDate(createdAt.getDate() - Math.min(interval, 7));

      const notes = Math.random() < 0.15
        ? pick([
            'No issues found',
            'Minor wear noted, monitoring',
            'Cleaned and lubricated',
            'Replaced filter',
            'Belt tension adjusted',
            'Slight vibration — will check next cycle',
            'All readings within spec',
            'Topped off lubricant',
          ])
        : null;

      insertWO.run(
        woId,
        sched.id,
        sched.equipment_id,
        sched.title,
        dueDate,
        sched.procedure_steps,
        tech,
        startedAt,
        completedAt,
        tech,
        notes,
        createdAt.toISOString(),
        completedAt,
      );

      insertAudit.run(tech, woId, JSON.stringify({ notes }), completedAt);

      totalGenerated++;
      byCounts[sched.frequency_type] = (byCounts[sched.frequency_type] || 0) + 1;

      cursor.setDate(cursor.getDate() + interval);
    }
  }
});

tx();

console.log(`\nGenerated ${totalGenerated} completed work orders:`);
for (const [freq, count] of Object.entries(byCounts)) {
  if (count > 0) console.log(`  ${freq}: ${count}`);
}

const totalWOs = db.prepare('SELECT COUNT(*) as c FROM work_orders').get().c;
const completedWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE status = 'completed'").get().c;
console.log(`\nTotal work orders in DB: ${totalWOs} (${completedWOs} completed)`);
