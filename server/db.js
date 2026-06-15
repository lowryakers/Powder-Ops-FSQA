import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'compliance.db');

let db;

export function getDb() {
  if (!db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      location TEXT,
      room TEXT,
      asset_id TEXT,
      manufacturer TEXT,
      model_number TEXT,
      serial_number TEXT,
      vendor TEXT,
      pm_frequency TEXT,
      is_food_contact INTEGER NOT NULL DEFAULT 0,
      haccp_ccp_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (haccp_ccp_id) REFERENCES haccp_ccps(id)
    );

    CREATE TABLE IF NOT EXISTS haccp_ccps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      hazard_type TEXT,
      critical_limits TEXT NOT NULL,
      monitoring_procedure TEXT NOT NULL,
      monitoring_frequency TEXT,
      corrective_action TEXT NOT NULL,
      verification_procedure TEXT,
      record_keeping_requirements TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pm_schedules (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      frequency_type TEXT NOT NULL CHECK (frequency_type IN ('daily','weekly','biweekly','monthly','quarterly','semi_annual','annual')),
      frequency_value INTEGER NOT NULL DEFAULT 1,
      procedure_steps TEXT NOT NULL DEFAULT '[]',
      lubricant_type TEXT,
      is_food_grade_lubricant INTEGER,
      estimated_minutes INTEGER,
      haccp_ccp_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id),
      FOREIGN KEY (haccp_ccp_id) REFERENCES haccp_ccps(id)
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      pm_schedule_id TEXT,
      equipment_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','overdue','missed','cancelled')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
      assigned_to TEXT,
      due_date TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      completed_by TEXT,
      procedure_steps TEXT DEFAULT '[]',
      step_completions TEXT DEFAULT '[]',
      notes TEXT,
      lubricant_used TEXT,
      lubricant_is_food_grade INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pm_schedule_id) REFERENCES pm_schedules(id),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pre_op','operational','sanitation','gmp','custom')),
      frequency TEXT NOT NULL DEFAULT 'daily',
      description TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checklist_submissions (
      id TEXT PRIMARY KEY,
      checklist_id TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      responses TEXT NOT NULL DEFAULT '[]',
      overall_status TEXT NOT NULL DEFAULT 'pass' CHECK (overall_status IN ('pass','fail','needs_attention')),
      notes TEXT,
      corrective_action_taken TEXT,
      verified_by TEXT,
      verified_at TEXT,
      FOREIGN KEY (checklist_id) REFERENCES checklist_templates(id)
    );

    CREATE TABLE IF NOT EXISTS calibration_instruments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      serial_number TEXT,
      manufacturer TEXT,
      model TEXT,
      location TEXT,
      room TEXT,
      asset_number TEXT,
      max_capacity TEXT,
      equipment_id TEXT,
      calibration_frequency TEXT NOT NULL DEFAULT 'annual',
      tolerance TEXT,
      unit_of_measure TEXT,
      last_calibrated TEXT,
      next_due TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','due','overdue','out_of_service','retired')),
      is_critical_control INTEGER NOT NULL DEFAULT 0,
      haccp_ccp_id TEXT,
      department TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id),
      FOREIGN KEY (haccp_ccp_id) REFERENCES haccp_ccps(id)
    );

    CREATE TABLE IF NOT EXISTS calibration_records (
      id TEXT PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      calibrated_by TEXT NOT NULL,
      calibrated_at TEXT NOT NULL DEFAULT (datetime('now')),
      result TEXT NOT NULL CHECK (result IN ('pass','fail','adjusted_pass')),
      reading_before TEXT,
      reading_after TEXT,
      standard_used TEXT,
      standard_cert_number TEXT,
      certificate_number TEXT,
      next_due TEXT,
      notes TEXT,
      FOREIGN KEY (instrument_id) REFERENCES calibration_instruments(id)
    );

    CREATE TABLE IF NOT EXISTS sanitation_records (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pre_op','post_op','mid_shift','deep_clean','emergency')),
      equipment_id TEXT,
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      chemicals_used TEXT,
      concentration TEXT,
      contact_time_minutes INTEGER,
      rinse_verified INTEGER,
      result TEXT NOT NULL CHECK (result IN ('pass','fail','reclean')),
      atp_reading REAL,
      verified_by TEXT,
      verified_at TEXT,
      corrective_action TEXT,
      notes TEXT,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE TABLE IF NOT EXISTS loto_procedures (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      energy_sources TEXT NOT NULL DEFAULT '[]',
      steps TEXT NOT NULL DEFAULT '[]',
      required_locks INTEGER NOT NULL DEFAULT 1,
      required_tags INTEGER NOT NULL DEFAULT 1,
      verification_method TEXT NOT NULL DEFAULT 'try_start',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE TABLE IF NOT EXISTS loto_executions (
      id TEXT PRIMARY KEY,
      procedure_id TEXT NOT NULL,
      locked_by TEXT NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT NOT NULL,
      lock_numbers TEXT,
      tag_numbers TEXT,
      verified_by TEXT,
      verified_at TEXT,
      verification_result TEXT,
      released_by TEXT,
      released_at TEXT,
      release_notes TEXT,
      status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','verified','released')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (procedure_id) REFERENCES loto_procedures(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      previous_state TEXT,
      new_state TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_due_date ON work_orders(due_date);
    CREATE INDEX IF NOT EXISTS idx_work_orders_equipment ON work_orders(equipment_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_submissions_date ON checklist_submissions(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_calibration_next_due ON calibration_instruments(next_due);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sanitation_date ON sanitation_records(performed_at);
    CREATE INDEX IF NOT EXISTS idx_loto_executions_status ON loto_executions(status);
    CREATE INDEX IF NOT EXISTS idx_loto_executions_procedure ON loto_executions(procedure_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      pin TEXT,
      role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','supervisor','operator')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS checklist_instances (
      id TEXT PRIMARY KEY,
      checklist_id TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue','skipped')),
      submission_id TEXT,
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (checklist_id) REFERENCES checklist_templates(id),
      FOREIGN KEY (submission_id) REFERENCES checklist_submissions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_instances_due ON checklist_instances(due_date);
    CREATE INDEX IF NOT EXISTS idx_checklist_instances_status ON checklist_instances(status);
    CREATE INDEX IF NOT EXISTS idx_checklist_instances_checklist ON checklist_instances(checklist_id);
  `);

  runMigrations();
}

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate] Added ${table}.${column}`);
  }
}

function runMigrations() {
  addColumnIfMissing('calibration_instruments', 'room', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'asset_number', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'max_capacity', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'department', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'notes', 'TEXT');
  addColumnIfMissing('work_orders', 'attachments', "TEXT DEFAULT '[]'");
  addColumnIfMissing('equipment', 'maintenance_tasks', "TEXT DEFAULT '{}'");

  migrateEquipmentNotes();
  cleanEquipmentNames();
}

function cleanEquipmentNames() {
  const rows = db.prepare("SELECT id, name, asset_id FROM equipment WHERE name GLOB '[0-9][0-9][0-9]*'").all();
  if (rows.length === 0) return;
  const update = db.prepare("UPDATE equipment SET name = ?, updated_at = datetime('now') WHERE id = ?");
  let cleaned = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const newName = row.name.replace(/^0*\d+\s+/, '').trim();
      if (newName && newName !== row.name) {
        update.run(newName, row.id);
        cleaned++;
      }
    }
  });
  tx();
  if (cleaned > 0) console.log(`[migrate] Cleaned ${cleaned} equipment names (removed asset # prefix)`);
}

function parseNotesIntoTasks(notes) {
  if (!notes) return null;
  const freqPattern = /\b(Daily|Weekly|Bi-weekly|Biweekly|Monthly|Quarterly|Semi-Annual|Semi Annual|Annual|Annually|As Needed)\s*[-–—:]\s*/gi;
  const freqNormalize = {
    'daily': 'Daily', 'weekly': 'Weekly', 'bi-weekly': 'Bi-weekly', 'biweekly': 'Bi-weekly',
    'monthly': 'Monthly', 'quarterly': 'Quarterly', 'semi-annual': 'Semi-Annual',
    'semi annual': 'Semi-Annual', 'annual': 'Annual', 'annually': 'Annual', 'as needed': 'As Needed',
  };
  const parts = notes.split(freqPattern);
  if (parts.length <= 1) return null;

  const tasks = {};
  for (let i = 1; i < parts.length; i += 2) {
    const freq = freqNormalize[parts[i].toLowerCase()] || parts[i];
    const raw = (parts[i + 1] || '').trim().replace(/,\s*$/, '');
    const items = raw.split(/,\s*/).map(s => s.trim()).filter(s => s.length > 0);
    if (items.length > 0) {
      if (!tasks[freq]) tasks[freq] = [];
      tasks[freq].push(...items);
    }
  }
  return Object.keys(tasks).length > 0 ? tasks : null;
}

function migrateEquipmentNotes() {
  const rows = db.prepare("SELECT id, notes, maintenance_tasks FROM equipment WHERE notes IS NOT NULL AND notes != '' AND (maintenance_tasks IS NULL OR maintenance_tasks = '{}')").all();
  if (rows.length === 0) return;

  const update = db.prepare("UPDATE equipment SET maintenance_tasks = ?, notes = '' WHERE id = ?");
  let migrated = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const tasks = parseNotesIntoTasks(row.notes);
      if (tasks) {
        update.run(JSON.stringify(tasks), row.id);
        migrated++;
      }
    }
  });
  tx();
  if (migrated > 0) console.log(`[migrate] Parsed ${migrated} equipment notes into structured maintenance tasks`);
}

export function logAudit(actor, action, entityType, entityId, details, previousState, newState) {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (actor, action, entity_type, entity_id, details, previous_state, new_state)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor,
    action,
    entityType,
    entityId || null,
    details ? JSON.stringify(details) : null,
    previousState ? JSON.stringify(previousState) : null,
    newState ? JSON.stringify(newState) : null
  );
}
