import Database from 'better-sqlite3';
import { tagQaInspectionRecords } from './qa-records.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { backfillUsernames } from './usernames.js';
import { ZONE_TYPES } from '../shared/equipment-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'compliance.db');

let db;

export function getDbPath() {
  return DB_PATH;
}

// Directory for ALL persisted files (uploads, certificates, …). Lives beside
// the database so that when DB_PATH points at the Railway volume, files land
// on the volume too and survive deploys. Never build file paths from the app
// directory — that filesystem is wiped on every deploy.
export function dataDir() {
  return path.dirname(DB_PATH);
}

export function getDb() {
  if (!db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Throughput tuning (safe on a single Railway instance with WAL):
    //  - synchronous=NORMAL: fewer fsyncs; durable across app crashes, only the
    //    last transaction is at risk on OS/power loss (we also keep DB backups).
    //  - busy_timeout: wait rather than throw if a write briefly locks.
    //  - temp_store=MEMORY + a larger page cache + mmap: faster sorts/scans.
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -16000'); // ~16 MB page cache
    try { db.pragma('mmap_size = 268435456'); } catch { /* mmap unsupported — non-fatal */ }
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
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','overdue','missed','cancelled','not_applicable')),
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

    -- Daily three-point scale checks (Forms 417-01 … 417-05). Separate from
    -- calibration_records on purpose: an annual calibration is one before/after
    -- reading by a technician, this is a three-weight verification the floor
    -- runs every morning. Both live in Calibration Management; conflating them
    -- would lose the per-point readings that make the check auditable.
    CREATE TABLE IF NOT EXISTS scale_verifications (
      id TEXT PRIMARY KEY,
      form_code TEXT NOT NULL,
      form_title TEXT NOT NULL,
      room TEXT,
      instrument_id TEXT,
      weights_serial TEXT,
      asset_tag TEXT,
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      readings TEXT NOT NULL DEFAULT '[]',
      result TEXT NOT NULL CHECK (result IN ('pass','fail')),
      notes TEXT,
      verified_by TEXT,
      verified_at TEXT,
      source TEXT NOT NULL DEFAULT 'kiosk',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (instrument_id) REFERENCES calibration_instruments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scale_verifications_performed ON scale_verifications(performed_at);
    CREATE INDEX IF NOT EXISTS idx_scale_verifications_form ON scale_verifications(form_code, performed_at);

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
    -- The 72-hour rule groups by area; this was scanning the whole log.
    -- (The record_group index can't live here — that column arrives as a
    -- migration, so indexing it before then kills a fresh database. It's
    -- created beside the ALTER instead.)
    CREATE INDEX IF NOT EXISTS idx_sanitation_area ON sanitation_records(area, performed_at);
    CREATE INDEX IF NOT EXISTS idx_loto_executions_status ON loto_executions(status);
    CREATE INDEX IF NOT EXISTS idx_loto_executions_procedure ON loto_executions(procedure_id);

    CREATE TABLE IF NOT EXISTS approved_chemicals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('lubricant','sanitizer','cleaner','degreaser','other')),
      manufacturer TEXT,
      product_code TEXT,
      sds_number TEXT,
      is_food_grade INTEGER NOT NULL DEFAULT 0,
      nsf_rating TEXT,
      approved_applications TEXT DEFAULT '[]',
      max_concentration TEXT,
      required_contact_time_minutes INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      approved_by TEXT,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')),
      review_due TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_approved_chemicals_category ON approved_chemicals(category);

    CREATE TABLE IF NOT EXISTS design_verifications (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL,
      trigger_reason TEXT NOT NULL CHECK (trigger_reason IN ('new_install','modification','relocation','repair','periodic_review')),
      description TEXT,
      checklist_responses TEXT NOT NULL DEFAULT '[]',
      overall_result TEXT NOT NULL DEFAULT 'pending' CHECK (overall_result IN ('pending','approved','conditional','rejected')),
      conditions TEXT,
      performed_by TEXT NOT NULL,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_by TEXT,
      approved_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE INDEX IF NOT EXISTS idx_design_verifications_equipment ON design_verifications(equipment_id);
    CREATE INDEX IF NOT EXISTS idx_design_verifications_result ON design_verifications(overall_result);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      pin TEXT,
      role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','supervisor','operator','auditor')),
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

    -- CAPA / Complaints / NCR tracking
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      complaint_number TEXT NOT NULL UNIQUE,
      date_received TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      lot_number TEXT,
      item_number TEXT,
      complaint_text TEXT NOT NULL,
      person_responsible TEXT,
      investigation TEXT,
      corrective_action TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      date_resolved TEXT,
      capa_needed INTEGER NOT NULL DEFAULT 0,
      capa_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capas (
      id TEXT PRIMARY KEY,
      capa_number TEXT NOT NULL UNIQUE,
      complaint_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      root_cause TEXT,
      corrective_action TEXT,
      preventive_action TEXT,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','implemented','verified','closed')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
      due_date TEXT,
      closed_at TEXT,
      closed_by TEXT,
      verification_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (complaint_id) REFERENCES complaints(id)
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_number ON complaints(complaint_number);
    CREATE INDEX IF NOT EXISTS idx_complaints_date ON complaints(date_received);
    CREATE INDEX IF NOT EXISTS idx_capas_status ON capas(status);
    CREATE INDEX IF NOT EXISTS idx_capas_complaint ON capas(complaint_id);

    -- SOP Document Registry
    CREATE TABLE IF NOT EXISTS sop_documents (
      id TEXT PRIMARY KEY,
      doc_number TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('production','quality','sanitation','maintenance','safety','haccp','training','admin','other')),
      revision TEXT NOT NULL DEFAULT '1.0',
      effective_date TEXT,
      review_due TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','under_review','superseded','archived')),
      owner TEXT,
      gdrive_url TEXT,
      gdrive_folder TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sop_category ON sop_documents(category);
    CREATE INDEX IF NOT EXISTS idx_sop_status ON sop_documents(status);

    CREATE TABLE IF NOT EXISTS sop_versions (
      id TEXT PRIMARY KEY,
      sop_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      changed_by TEXT,
      change_summary TEXT,
      snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sop_id) REFERENCES sop_documents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sop_versions_sop ON sop_versions(sop_id);

    -- Files attached to a controlled document (SOP / WI / Job Description).
    -- The immediate need is the last approved PAPER version of each document,
    -- scanned, so the signed original an auditor asks for stays attached to the
    -- record that superseded it. The kind column distinguishes that from ordinary
    -- supporting files, because "show me what this replaced" is a different
    -- question from "show me the appendix".
    CREATE TABLE IF NOT EXISTS document_attachments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'attachment' CHECK (kind IN ('signed_original', 'attachment')),
      title TEXT,
      filename TEXT NOT NULL,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT NOT NULL,
      revision TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES sop_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_document_attachments_doc ON document_attachments(document_id, created_at);

    -- Org Chart (structured, editable)
    CREATE TABLE IF NOT EXISTS org_positions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      name TEXT,
      backup TEXT,
      department TEXT,
      parent_id TEXT,
      job_description_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_org_parent ON org_positions(parent_id);

    CREATE TABLE IF NOT EXISTS org_chart_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version TEXT,
      approved_by TEXT,
      effective_date TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Disposals (digital Form 411-1)
    CREATE TABLE IF NOT EXISTS disposals (
      id TEXT PRIMARY KEY,
      disposal_number TEXT,
      document_rev TEXT,
      disposal_date TEXT,
      reason TEXT,
      approvals TEXT,
      witness TEXT,
      paper_record INTEGER NOT NULL DEFAULT 0,
      scanned INTEGER NOT NULL DEFAULT 0,
      document_url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_disposals_number ON disposals(disposal_number);
    CREATE INDEX IF NOT EXISTS idx_disposals_date ON disposals(disposal_date);

    CREATE TABLE IF NOT EXISTS disposal_items (
      id TEXT PRIMARY KEY,
      disposal_id TEXT NOT NULL,
      item_name TEXT,
      item_number TEXT,
      lot_number TEXT,
      quantity TEXT,
      category TEXT,
      reason_disposed TEXT,
      date_disposed TEXT,
      write_off_number TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (disposal_id) REFERENCES disposals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_disposal_items_disposal ON disposal_items(disposal_id);

    -- QMS Records — generic framework for Document Change Requests, Deviations,
    -- Non-Conformance, On Hold, etc. Type-specific fields live in the data JSON.
    CREATE TABLE IF NOT EXISTS qms_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      record_number TEXT,
      record_date TEXT,
      status TEXT,
      data TEXT,
      approvals TEXT,
      paper_record INTEGER NOT NULL DEFAULT 0,
      document_url TEXT,
      capa_id TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_qms_type ON qms_records(record_type);
    CREATE INDEX IF NOT EXISTS idx_qms_number ON qms_records(record_type, record_number);

    -- Training Records
    CREATE TABLE IF NOT EXISTS training_records (
      id TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      employee_id TEXT,
      training_topic TEXT NOT NULL,
      sop_id TEXT,
      trainer TEXT,
      training_date TEXT NOT NULL,
      completion_date TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','overdue','failed')),
      score REAL,
      certificate_url TEXT,
      gdrive_url TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sop_id) REFERENCES sop_documents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_training_employee ON training_records(employee_name);
    CREATE INDEX IF NOT EXISTS idx_training_date ON training_records(training_date);
    CREATE INDEX IF NOT EXISTS idx_training_status ON training_records(status);

    -- Training program: the catalog of courses (GMP, allergen, HACCP, SOP-specific…).
    -- required_roles / required_departments (JSON arrays) drive who needs each course;
    -- retrain_months encodes the refresher cadence (NULL = one-time).
    CREATE TABLE IF NOT EXISTS training_courses (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'GMP',
      description TEXT,
      sop_id TEXT,
      retrain_months INTEGER,
      required_roles TEXT NOT NULL DEFAULT '[]',
      required_departments TEXT NOT NULL DEFAULT '[]',
      has_test INTEGER NOT NULL DEFAULT 0,
      passing_score REAL NOT NULL DEFAULT 80,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sop_id) REFERENCES sop_documents(id)
    );

    -- Course material: the video or handout people actually watch, stored in R2
    -- rather than on the data volume (one training video outweighs the whole
    -- database). Attached to the course, so it's the same material for everyone
    -- taking it — training_records.document_url stays what it always was, the
    -- scan of one person's signed form.
    CREATE TABLE IF NOT EXISTS training_materials (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT,
      filename TEXT NOT NULL,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES training_courses(id)
    );
    CREATE INDEX IF NOT EXISTS idx_training_materials_course ON training_materials(course_id);

    -- Versioned assessment for a course. Editing publishes a new version so past
    -- attempts stay tied to the exact test the employee took (is_current = latest).
    CREATE TABLE IF NOT EXISTS training_tests (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      title TEXT,
      passing_score REAL NOT NULL DEFAULT 80,
      is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES training_courses(id)
    );

    CREATE TABLE IF NOT EXISTS training_questions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'multiple_choice' CHECK (type IN ('multiple_choice','true_false','short_answer')),
      prompt TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT,
      points REAL NOT NULL DEFAULT 1,
      FOREIGN KEY (test_id) REFERENCES training_tests(id)
    );

    -- One row per in-app test take, auto-graded; links to the completion it created.
    CREATE TABLE IF NOT EXISTS training_test_attempts (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_user_id TEXT,
      answers TEXT NOT NULL DEFAULT '{}',
      score REAL,
      passed INTEGER NOT NULL DEFAULT 0,
      record_id TEXT,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (test_id) REFERENCES training_tests(id)
    );

    -- Per-individual assignment/exemption overrides on top of the role/department
    -- rules that live on the course (rule = 'required' | 'exempt').
    CREATE TABLE IF NOT EXISTS training_requirements (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rule TEXT NOT NULL DEFAULT 'required' CHECK (rule IN ('required','exempt')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES training_courses(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (course_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_training_courses_active ON training_courses(active);
    CREATE INDEX IF NOT EXISTS idx_training_tests_course ON training_tests(course_id);
    CREATE INDEX IF NOT EXISTS idx_training_questions_test ON training_questions(test_id);
    CREATE INDEX IF NOT EXISTS idx_training_attempts_course ON training_test_attempts(course_id);
    CREATE INDEX IF NOT EXISTS idx_training_requirements_course ON training_requirements(course_id);

    -- Mock Recall Log
    CREATE TABLE IF NOT EXISTS mock_recalls (
      id TEXT PRIMARY KEY,
      recall_number TEXT NOT NULL UNIQUE,
      date_initiated TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot_number TEXT NOT NULL,
      reason TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'internal' CHECK (scope IN ('internal','customer','public')),
      quantity_produced TEXT,
      quantity_distributed TEXT,
      quantity_recovered TEXT,
      distribution_list TEXT,
      time_to_notify_minutes INTEGER,
      time_to_complete_minutes INTEGER,
      accounts_contacted INTEGER,
      accounts_responded INTEGER,
      effectiveness_pct REAL,
      result TEXT DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','conditional')),
      corrective_actions TEXT,
      notes TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mock_recalls_date ON mock_recalls(date_initiated);
    CREATE INDEX IF NOT EXISTS idx_mock_recalls_result ON mock_recalls(result);

    -- Production Entries
    CREATE TABLE IF NOT EXISTS production_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      team TEXT NOT NULL,
      room TEXT NOT NULL,
      product_name TEXT NOT NULL,
      mo_number TEXT NOT NULL,
      lot_number TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      quantity_completed REAL NOT NULL,
      people_count INTEGER NOT NULL,
      notes TEXT,
      qa_signoff_by TEXT,
      qa_signoff_at TEXT,
      qa_notes TEXT,
      submitted_by TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_production_entries_date ON production_entries(date);
    CREATE INDEX IF NOT EXISTS idx_production_entries_mo ON production_entries(mo_number);
    CREATE INDEX IF NOT EXISTS idx_production_entries_team ON production_entries(team);
    -- "What ran in this room" — the 72-hour rule and the schedule's progress
    -- overlay both ask per room. Indexed beside its own CREATE TABLE, not up
    -- with the first index block: that block runs before this table exists.
    CREATE INDEX IF NOT EXISTS idx_production_entries_room ON production_entries(room, date);

    -- Per-team EOD report templates. Batching/Blending records different things
    -- than Filling or Kitting, so each team gets its own set of structured
    -- fields (a small survey) on top of the shared production entry. Fully
    -- admin-editable — the field list is JSON, not code — so QA can shape a
    -- team's report without a deploy. Answers live in
    -- production_entries.structured_data keyed by field key.
    CREATE TABLE IF NOT EXISTS eod_templates (
      team TEXT PRIMARY KEY,
      title TEXT,
      fields TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Production Schedule
    CREATE TABLE IF NOT EXISTS production_schedule (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      room TEXT NOT NULL,
      slot INTEGER NOT NULL DEFAULT 0,
      room_type TEXT NOT NULL DEFAULT 'production',
      team TEXT,
      mo_number TEXT,
      product_name TEXT,
      start_time TEXT,
      notes TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_production_schedule_week ON production_schedule(week_start);
    CREATE INDEX IF NOT EXISTS idx_production_schedule_room ON production_schedule(room);

    -- QA-dismissed "missed end-of-day report" callouts (reviewed & cleared).
    CREATE TABLE IF NOT EXISTS production_missed_dismissals (
      id TEXT PRIMARY KEY,
      dismiss_key TEXT NOT NULL UNIQUE,
      sched_date TEXT NOT NULL,
      room TEXT,
      mo_number TEXT,
      team TEXT,
      reason TEXT,
      dismissed_by TEXT,
      dismissed_by_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Production Cleaning Levels
    CREATE TABLE IF NOT EXISTS production_cleaning_levels (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      room TEXT NOT NULL,
      level TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_production_cleaning_week ON production_cleaning_levels(week_start);

    -- COA / Supplier Quality Module
    CREATE TABLE IF NOT EXISTS coa_labs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coa_specifications (
      id TEXT PRIMARY KEY,
      item_number TEXT NOT NULL,
      item_description TEXT NOT NULL,
      test_type TEXT NOT NULL,
      specification TEXT,
      unit TEXT,
      min_value REAL,
      max_value REAL,
      method TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_coa_specs_item ON coa_specifications(item_number);
    CREATE INDEX IF NOT EXISTS idx_coa_specs_test ON coa_specifications(test_type);

    CREATE TABLE IF NOT EXISTS coa_requests (
      id TEXT PRIMARY KEY,
      item_number TEXT NOT NULL,
      item_description TEXT NOT NULL,
      lot_number TEXT NOT NULL,
      product_expiration TEXT,
      tests_requested TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','pass','fail','hold','re_test','na')),
      lab_id TEXT,
      lab_name TEXT,
      date_sent TEXT,
      tat_days INTEGER,
      expected_results_date TEXT,
      date_of_results TEXT,
      date_sent_to_customer TEXT,
      requested_by TEXT,
      invoice_amount REAL,
      retest_required INTEGER NOT NULL DEFAULT 0,
      retest_of TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lab_id) REFERENCES coa_labs(id),
      FOREIGN KEY (retest_of) REFERENCES coa_requests(id)
    );

    CREATE INDEX IF NOT EXISTS idx_coa_requests_item ON coa_requests(item_number);
    CREATE INDEX IF NOT EXISTS idx_coa_requests_lot ON coa_requests(lot_number);
    CREATE INDEX IF NOT EXISTS idx_coa_requests_status ON coa_requests(status);
    CREATE INDEX IF NOT EXISTS idx_coa_requests_date_sent ON coa_requests(date_sent);

    CREATE TABLE IF NOT EXISTS coa_files (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('lab_results','customer_coa','other')),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (request_id) REFERENCES coa_requests(id)
    );

    CREATE INDEX IF NOT EXISTS idx_coa_files_request ON coa_files(request_id);

    CREATE TABLE IF NOT EXISTS coa_test_results (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      test_type TEXT NOT NULL,
      result_value TEXT,
      unit TEXT,
      specification_id TEXT,
      pass_fail TEXT CHECK(pass_fail IN ('pass','fail','na')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (request_id) REFERENCES coa_requests(id),
      FOREIGN KEY (specification_id) REFERENCES coa_specifications(id)
    );

    CREATE INDEX IF NOT EXISTS idx_coa_test_results_request ON coa_test_results(request_id);

    -- ── Self-serve structure: managed lists + custom fields ──────────────
    -- The team changes what a log CAPTURES (custom_field_defs) and what its
    -- dropdowns OFFER (app_lists) from inside the app, with no migration or
    -- deploy. Two hard rules make this safe for compliance records:
    --   1. Nothing is ever deleted — options and fields RETIRE (is_active = 0).
    --      A record filed last year must still render with the labels it was
    --      filed under; deleting a field would silently void history.
    --   2. A field's key and an option's value are immutable once created.
    --      Labels are free to change; the stored value never does, so old rows
    --      keep resolving.
    CREATE TABLE IF NOT EXISTS app_lists (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      -- Seeded lists the app itself reads (e.g. bpg_zones). Options stay
      -- editable; the list row can't be dropped out from under the code.
      is_system INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS app_list_options (
      id TEXT PRIMARY KEY,
      list_key TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      -- Free-form JSON for options that carry more than a label (a brittle
      -- plastic zone carries its item inventory, for instance).
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (list_key, value)
    );
    CREATE INDEX IF NOT EXISTS idx_list_options_list ON app_list_options(list_key, sort_order);

    -- One row per user-added field. The scope names what it hangs off — a table
    -- ('receiving_log'), or a table plus a discriminator ('qms:deviation'), so
    -- one host table can carry different fields per record type.
    CREATE TABLE IF NOT EXISTS custom_field_defs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      -- A select either points at a managed list (shared, editable in one
      -- place) or carries its own inline options JSON.
      options_list_key TEXT,
      options TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      help_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (scope, key)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_fields_scope ON custom_field_defs(scope, sort_order);

    -- ── Receiving Log (Warehouse) ────────────────────────────────────────
    -- Replaces the Monday board. Columns here are the ones the warehouse has
    -- actually been filling for 2,000+ receipts; anything they want to add
    -- later goes in custom_data via the field engine rather than a migration.
    -- The external_id carries the source row's identity so re-importing the
    -- same export updates rather than duplicates.
    CREATE TABLE IF NOT EXISTS receiving_log (
      id TEXT PRIMARY KEY,
      inspection_no TEXT,
      date_received TEXT,
      po_number TEXT,
      part_number TEXT,
      part_description TEXT,
      vendor_lot TEXT,
      expiration_date TEXT,
      quantity_received REAL,
      uom TEXT,
      received_by TEXT,
      part_in_mrp INTEGER NOT NULL DEFAULT 0,
      received_in_mrp INTEGER NOT NULL DEFAULT 0,
      -- Legacy Monday attachments stay as URLs; new uploads go to R2 by key.
      packing_slip_url TEXT,
      packing_slip_key TEXT,
      packing_slip_name TEXT,
      status_of_release TEXT,
      release_date TEXT,
      notes TEXT,
      custom_data TEXT,
      source TEXT NOT NULL DEFAULT 'app',
      external_id TEXT UNIQUE,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receiving_date ON receiving_log(date_received DESC);
    CREATE INDEX IF NOT EXISTS idx_receiving_po ON receiving_log(po_number);
    CREATE INDEX IF NOT EXISTS idx_receiving_part ON receiving_log(part_number);
    CREATE INDEX IF NOT EXISTS idx_receiving_lot ON receiving_log(vendor_lot);

    -- FORM 204-01 — the Receiving Inspection Checklist.
    --
    -- ONE PER INSPECTION, not per line. An arrival is routinely several
    -- receiving_log rows against one PO (the imported Monday history has 1,328
    -- rows sharing 511 inspection numbers), and the paper form has one header,
    -- one set of checks and one approval covering the whole delivery. Keyed on
    -- inspection_no rather than a row id for exactly that reason.
    --
    -- The answers live as JSON because the questions are a controlled form, not
    -- a schema: they change through Document Control, and checklist_revision
    -- records which revision this one was filed against.
    CREATE TABLE IF NOT EXISTS receiving_checklists (
      id TEXT PRIMARY KEY,
      inspection_no TEXT NOT NULL UNIQUE,
      checklist_revision TEXT NOT NULL,
      inspection_date TEXT,
      inspector TEXT,
      po_number TEXT,
      truck_number TEXT,
      pallet_count REAL,
      driver_name TEXT,
      vendor TEXT,
      vendor_lot TEXT,
      customer_number TEXT,
      answers TEXT NOT NULL DEFAULT '{}',
      item_notes TEXT,
      -- Escalations actually sent: [{item, target, to[], at, by}]. Appended,
      -- never rewritten — "we told QA at 09:14" is the evidence the form's
      -- "*notify Adam" instruction exists to produce.
      notifications TEXT NOT NULL DEFAULT '[]',
      system_status TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receiving_checklists_no ON receiving_checklists(inspection_no);
    CREATE INDEX IF NOT EXISTS idx_receiving_checklists_date ON receiving_checklists(inspection_date DESC);

    -- ── Universal file importer ──────────────────────────────────────────
    -- One row per uploaded file. The parsed rows are held here between the
    -- analyze and commit steps so the preview is a true dry run against the
    -- exact data that will be written — no re-upload, no drift. Keeping the
    -- batch afterwards is the provenance record: which file, whose upload,
    -- what mapping, and what it did.
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      filename TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      headers TEXT,
      rows_json TEXT,
      mapping TEXT,
      result TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_import_batches_created ON import_batches(created_at DESC);

    -- ── ReadyDoc feedback (RETIRED) ──────────────────────────────────────
    -- The Request button / Settings triage pane were removed 2026-08 — the
    -- plant runs app feedback through a comms channel instead. The table
    -- stays so any rows filed before the removal survive in the database;
    -- there is no UI or API over it any more.
    CREATE TABLE IF NOT EXISTS app_requests (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      area TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
      submitted_by TEXT,
      submitted_by_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_by TEXT,
      done_at TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_requests(status, created_at DESC);

    -- A screenshot says in one image what a paragraph struggles to. Files and
    -- links share one table because they are the same thing to the reader —
    -- something to look at alongside the request. A link carries a url and no
    -- storage key; an upload carries a storage key and is presigned on read,
    -- so a request with a Drive link still works with no R2 configured.
    CREATE TABLE IF NOT EXISTS app_request_attachments (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'link')),
      filename TEXT,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT,
      url TEXT,
      added_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (request_id) REFERENCES app_requests(id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_request_attachments ON app_request_attachments(request_id);

    -- ── Facility map: what is currently IN a space ───────────────────────────
    -- The plant runs on casters and tents: the walls stay put but the line in a
    -- room changes. So the geometry stays in the client's drawing and only the
    -- naming is data: label (what the map says) and equipment (the line
    -- sited there right now).
    --
    -- The records key is deliberately NOT here. production_entries.room and
    -- sanitation_records.area already hold it on every filed record, and
    -- rewriting it would orphan that history from the map without touching the
    -- records themselves. Renaming a space is a display decision; re-keying a
    -- log is not.
    -- ── Retention samples ────────────────────────────────────────────────────
    -- What was pulled and kept from each job, and where it physically is.
    --
    -- Transcribed from the plant's own Retention Sample log. Four things that
    -- shaped this table:
    --
    --  1. LAB AND RETAIN ARE COUNTED SEPARATELY. The paper writes one cell,
    --     "5 (2 LAB, 3 RETAIN)", but they are different objects with different
    --     fates: the lab portion leaves the building and comes back as a COA,
    --     the retain sits in the box until its destruction date. A single
    --     total cannot answer "did the lab samples actually go out".
    --  2. A BOX HAS A DESTRUCTION DATE, not a sample. The log is organised by
    --     box (15, 16, 17…) and each box carries one date; that is how the
    --     plant actually disposes of them, a box at a time.
    --  3. STAGE spans the whole process — raw material (kept at 90 g from
    --     receiving), blend, intermediate, finished good. It is not a COA
    --     concept, which is why this is its own module rather than a COA tab.
    --  4. The batches column is free text ("1 & 2", "1 BEG, 1 MIDDLE, 1 END") because
    --     that is what the log records, and normalising it would lose the
    --     "beginning / middle / end of the run" detail that makes a stick-pack
    --     retain meaningful.
    CREATE TABLE IF NOT EXISTS retention_boxes (
      id TEXT PRIMARY KEY,
      box_no TEXT NOT NULL UNIQUE,
      destruction_date TEXT,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'destroyed')),
      closed_at TEXT,
      destroyed_at TEXT,
      destroyed_by TEXT,
      destruction_notes TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS retention_samples (
      id TEXT PRIMARY KEY,
      box_id TEXT,
      stage TEXT NOT NULL DEFAULT 'finished_good'
        CHECK (stage IN ('raw_material', 'blend', 'intermediate', 'finished_good')),
      item_number TEXT,
      item_name TEXT NOT NULL,
      lot_number TEXT,
      mo_number TEXT,
      expiration_date TEXT,
      retain_count INTEGER NOT NULL DEFAULT 0,
      lab_count INTEGER NOT NULL DEFAULT 0,
      sample_size TEXT,
      batches TEXT,
      collected_date TEXT,
      collected_by TEXT,
      coa_request_id TEXT,
      comments TEXT,
      custom_data TEXT,
      external_id TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_at TEXT,
      updated_by TEXT,
      FOREIGN KEY (box_id) REFERENCES retention_boxes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_retention_samples_box ON retention_samples(box_id);
    CREATE INDEX IF NOT EXISTS idx_retention_samples_lot ON retention_samples(lot_number);
    CREATE INDEX IF NOT EXISTS idx_retention_samples_mo ON retention_samples(mo_number);
    CREATE INDEX IF NOT EXISTS idx_retention_samples_collected ON retention_samples(collected_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retention_samples_external ON retention_samples(external_id)
      WHERE external_id IS NOT NULL;

    -- ── Partner reconciliation (Powder Ops ⇄ M4 Dynamics) ───────────────────
    -- Two companies that invoice each other constantly and had ground to a halt
    -- because each was reconciling from its own emails. The whole design goal is
    -- X − Y = Z: one number, at the end of the month, that both sides can see
    -- was derived the same way.
    --
    -- FOUR RULES THIS SCHEMA EXISTS TO ENFORCE:
    --
    --  1. ONE LEDGER, BOTH DIRECTIONS. The direction column says who owes, not which
    --     table a row lives in. Two tables is exactly how two companies end up
    --     reconciling from different books, which is the problem being solved.
    --  2. NOTHING COUNTS UNTIL IT IS FINAL. A document is draft until the work
    --     behind it is actually done — goods delivered, or production finished.
    --     Only final documents reach the net.
    --  3. EITHER SIDE CAN DISPUTE, AND A DISPUTE EXCLUDES RATHER THAN BLOCKS.
    --     A disagreement over one invoice must not stop the other eleven from
    --     settling; the disputed row drops out of the number and is named in the
    --     report. That is the mechanism that prevents the standoff.
    --  4. A SETTLEMENT IS IMMUTABLE. Paying stamps the exact set of documents
    --     that made up that number. Without it, next month's figure cannot be
    --     trusted and "what did we settle in July" has no answer.
    CREATE TABLE IF NOT EXISTS partner_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      contact_name TEXT,
      contact_email TEXT,
      -- Net terms per partner and per direction: the two companies need not
      -- have agreed the same terms with each other.
      terms_days INTEGER NOT NULL DEFAULT 30,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS partner_documents (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      -- receivable = they owe us (we issued it) · payable = we owe them
      direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
      doc_type TEXT NOT NULL DEFAULT 'invoice' CHECK (doc_type IN ('invoice', 'po', 'credit')),
      doc_number TEXT,
      reference TEXT,
      description TEXT,
      issued_date TEXT,
      terms_days INTEGER,
      due_date TEXT,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'final', 'disputed', 'void')),
      finalized_at TEXT,
      finalized_by TEXT,
      disputed_reason TEXT,
      disputed_at TEXT,
      disputed_by TEXT,
      settlement_id TEXT,
      -- The uploaded PO or invoice, and its text so a search finds a lot number
      -- printed inside the PDF rather than only what someone keyed in.
      storage_key TEXT,
      filename TEXT,
      content_type TEXT,
      size INTEGER,
      extracted_text TEXT,
      source TEXT NOT NULL DEFAULT 'internal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_at TEXT,
      updated_by TEXT,
      FOREIGN KEY (partner_id) REFERENCES partner_accounts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_partner_docs_partner ON partner_documents(partner_id, status);
    CREATE INDEX IF NOT EXISTS idx_partner_docs_due ON partner_documents(due_date);
    CREATE INDEX IF NOT EXISTS idx_partner_docs_settlement ON partner_documents(settlement_id);

    CREATE TABLE IF NOT EXISTS partner_settlements (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      period_end TEXT NOT NULL,
      receivable_total REAL NOT NULL DEFAULT 0,
      payable_total REAL NOT NULL DEFAULT 0,
      net_amount REAL NOT NULL DEFAULT 0,
      -- Who pays whom, recorded rather than re-derived from the sign later.
      owed_to TEXT CHECK (owed_to IN ('us', 'them', 'nobody')),
      document_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
      paid_at TEXT,
      paid_by TEXT,
      payment_reference TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (partner_id) REFERENCES partner_accounts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_partner_settlements ON partner_settlements(partner_id, period_end DESC);

    -- A scoped link the partner uses to see the same ledger and upload their
    -- own paperwork. Read + upload only — approving, disputing and settling stay
    -- with whoever owns the account. Hashed like a session token, never stored
    -- in the clear.
    CREATE TABLE IF NOT EXISTS partner_portal_tokens (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT,
      FOREIGN KEY (partner_id) REFERENCES partner_accounts(id)
    );

    -- Somebody paid for something out of their own pocket. Right now that is
    -- Marnee and Adam and a personal card, and the whole loop is: photograph
    -- the receipt, say what it was, and get it back in payroll.
    --
    --  · THE RECEIPT IS THE RECORD. A reimbursement with no receipt is a
    --    request to be trusted; one with a photo is a document. So the amount
    --    and the image are captured in the same act, on a phone, at the till.
    --  · PAID IS STAMPED, NEVER GUESSED. paid_at / paid_by / pay_period say
    --    which payroll run it went out on, because "did I already pay Marnee
    --    for that" is the question this table exists to answer.
    --  · A REJECTION IS A DECISION AND CARRIES A REASON. It is not a delete —
    --    the person submitted it in good faith and is owed an answer.
    CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      person TEXT NOT NULL,
      spent_on TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      merchant TEXT,
      description TEXT,
      payment_method TEXT,
      status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'paid', 'rejected')),
      approved_at TEXT, approved_by TEXT,
      paid_at TEXT, paid_by TEXT, pay_period TEXT, payment_reference TEXT,
      rejected_at TEXT, rejected_by TEXT, rejected_reason TEXT,
      custom_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      updated_at TEXT, updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reimbursements_status ON reimbursements(status, spent_on DESC);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_person ON reimbursements(user_id, spent_on DESC);

    -- One claim can be several receipts (a run to two shops on one card).
    CREATE TABLE IF NOT EXISTS reimbursement_receipts (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL,
      storage_key TEXT,
      filename TEXT,
      content_type TEXT,
      size INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      uploaded_by TEXT,
      FOREIGN KEY (reimbursement_id) REFERENCES reimbursements(id)
    );
    CREATE INDEX IF NOT EXISTS idx_reimb_receipts ON reimbursement_receipts(reimbursement_id);

    -- Banking and reconciliation — the part of QuickBooks that actually costs
    -- accountant hours: matching what the bank says happened against what the
    -- ledgers say we did, and closing a month when the two agree.
    --
    -- FOUR RULES:
    --
    --  1. THE BANK IS THE FACT. A bank transaction is never edited and never
    --     deleted. It says what left or entered the account. Everything else
    --     here is an opinion ABOUT it, stored separately, so a wrong match can
    --     be undone without touching the record it was made against.
    --  2. A MATCH IS A LINK, NOT A MERGE. One payment can cover three
    --     invoices and one invoice can be paid in two instalments, so matches
    --     live in their own table with an amount each.
    --  3. NOTHING IS AUTO-MATCHED ON A GUESS. Confidence is recorded on every
    --     match and only an exact amount plus a corroborating identifier is
    --     applied without a human. Everything else is a suggestion.
    --  4. A CLOSED RECONCILIATION IS IMMUTABLE. It stamps the statement
    --     balance, the cleared total and the exact transactions that made it
    --     up. Without that, next month's opening figure cannot be trusted.
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      institution TEXT,
      account_type TEXT,
      mask TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_date TEXT,
      current_balance REAL,
      balance_as_of TEXT,
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_item_id TEXT,
      provider_account_id TEXT,
      last_synced_at TEXT,
      last_sync_error TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      posted_date TEXT NOT NULL,
      description TEXT,
      counterparty TEXT,
      reference TEXT,
      -- Signed the way a bank statement reads: negative is money out.
      amount REAL NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      -- Set once the transaction has been accounted for, whether by a match or
      -- by someone saying it needs no document (bank fee, interest, transfer).
      status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (status IN ('unmatched', 'matched', 'no_document', 'ignored')),
      resolution_note TEXT,
      resolved_at TEXT, resolved_by TEXT,
      reconciliation_id TEXT,
      -- The provider's own id, so a re-sync or a re-imported statement updates
      -- rather than duplicating. Unique per account.
      external_id TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES bank_accounts(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_txn_external
      ON bank_transactions(account_id, external_id) WHERE external_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(account_id, posted_date DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_txn_status ON bank_transactions(status, posted_date DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_txn_recon ON bank_transactions(reconciliation_id);

    -- One payment can cover several invoices, so a match carries its own
    -- amount. target_type names the ledger it points into.
    CREATE TABLE IF NOT EXISTS bank_transaction_matches (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      amount REAL NOT NULL,
      confidence REAL,
      auto INTEGER NOT NULL DEFAULT 0,
      matched_at TEXT NOT NULL DEFAULT (datetime('now')),
      matched_by TEXT,
      FOREIGN KEY (transaction_id) REFERENCES bank_transactions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bank_match_txn ON bank_transaction_matches(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_bank_match_target ON bank_transaction_matches(target_type, target_id);

    CREATE TABLE IF NOT EXISTS bank_reconciliations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      period_end TEXT NOT NULL,
      statement_balance REAL NOT NULL,
      opening_balance REAL NOT NULL,
      cleared_total REAL NOT NULL,
      difference REAL NOT NULL,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
      closed_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_by TEXT,
      reopened_at TEXT, reopened_by TEXT, reopened_reason TEXT,
      notes TEXT,
      FOREIGN KEY (account_id) REFERENCES bank_accounts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bank_recon ON bank_reconciliations(account_id, period_end DESC);

    -- Rules people teach it: "anything from AMEX EPAYMENT is a card payment,
    -- category Credit card". Learned from what Jake actually does rather than
    -- shipped as a guess about this plant's vendors.
    CREATE TABLE IF NOT EXISTS bank_rules (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      match_text TEXT NOT NULL,
      category TEXT,
      counterparty TEXT,
      action TEXT NOT NULL DEFAULT 'categorize'
        CHECK (action IN ('categorize', 'no_document', 'ignore')),
      hits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );

    -- The running day log — what somebody is doing RIGHT NOW, before it becomes
    -- an EOD report.
    --
    -- Bernardo was keeping his day in his phone's Notes and re-typing it here
    -- at 5pm, because the entry form is a single all-at-once submission and a
    -- shift is not a single moment. This is the missing half: add a line when
    -- the thing happens, walk away, come back, and file the report from it.
    --
    -- IT IS A SEPARATE TABLE, NOT A STATUS ON production_entries, and that is
    -- the most important decision here. A draft living in the entries table
    -- would need an AND status = 'filed' on every existing query — the log, the
    -- QA sign-off queue, the missed-report scan, the KPIs — and missing one
    -- would leak an unfinished shift into a compliance record. Same class of
    -- bug as the qa_waived_at rule. Nothing reads these tables except the day
    -- log itself and the one function that turns it into an entry.
    CREATE TABLE IF NOT EXISTS production_day_logs (
      id TEXT PRIMARY KEY,
      log_date TEXT NOT NULL,
      team TEXT NOT NULL,
      room TEXT,
      user_id TEXT,
      person TEXT NOT NULL,
      -- Shift-level answers, held here until the report is created so a
      -- half-filled form survives a phone going to sleep.
      start_time TEXT, end_time TEXT, people_count INTEGER,
      notes TEXT,
      structured_data TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filed')),
      -- The entry it became. Kept, rather than deleting the log, because it is
      -- the record of what was observed when — and a line logged at 07:46 for
      -- work done 06:40-07:45 is a contemporaneous note, which is worth more
      -- than one typed from memory at the end of the day.
      entry_id TEXT,
      filed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    -- One open day per person per team per date. Re-opening the module mid
    -- shift has to find the SAME log, not start a second one.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_day_log_open
      ON production_day_logs(person, log_date, team) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS idx_day_log_person ON production_day_logs(person, log_date DESC);

    -- One line of the day. The data column is the item's own shape, validated
    -- on write by the SAME normalizers the filed entry uses — so "it looked
    -- fine in the day log and was rejected at filing" cannot happen.
    CREATE TABLE IF NOT EXISTS production_day_items (
      id TEXT PRIMARY KEY,
      log_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('clean', 'mo', 'adjustment', 'note')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      data TEXT,
      -- When it was WRITTEN DOWN, as opposed to when the work happened.
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (log_id) REFERENCES production_day_logs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_day_items_log ON production_day_items(log_id, sort_order);

    CREATE TABLE IF NOT EXISTS facility_room_overrides (
      room_id TEXT PRIMARY KEY,
      label TEXT,
      equipment TEXT,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  runMigrations();
}

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate] Added ${table}.${column}`);
    return true;
  }
  return false;
}

// The mirror of the above, for columns a feature no longer has any use for.
// Leaving dead columns behind makes the next reader guess whether they matter.
function dropColumnIfPresent(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) return false;
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    console.log(`[migrate] Dropped ${table}.${column}`);
    return true;
  } catch (e) {
    console.warn(`[migrate] Could not drop ${table}.${column}:`, e.message);
    return false;
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
  addColumnIfMissing('users', 'department', "TEXT DEFAULT 'warehouse'");
  // Per-user mobile bottom-bar tabs (JSON array of module ids / 'messages');
  // null = role-aware default picks.
  addColumnIfMissing('users', 'quick_tabs', 'TEXT');
  addColumnIfMissing('pm_schedules', 'task_group', "TEXT DEFAULT 'warehouse'");
  addColumnIfMissing('work_orders', 'task_group', "TEXT DEFAULT 'warehouse'");

  // Flavor approval on a scheduled manufacturing order
  addColumnIfMissing('production_schedule', 'flavor_approved_by', 'TEXT');
  addColumnIfMissing('production_schedule', 'flavor_approved_at', 'TEXT');

  // Sticks and Hand Fill merged into one Filling team; which machine a run used
  // moved from the team name onto its own tag, so historical runs stay
  // distinguishable and new lines (auto pouch, sachet, bottling) need no team.
  addColumnIfMissing('production_entries', 'line', 'TEXT');
  addColumnIfMissing('production_schedule', 'line', 'TEXT');

  // Good documentation practice for the production log: a filed EOD report is
  // a record, so it is never quietly overwritten. Corrections are appended
  // here as amendments — who, when, why, and each field's before/after — and
  // the entry shows that it was amended. Nothing is ever destroyed.
  addColumnIfMissing('production_entries', 'amendments', "TEXT NOT NULL DEFAULT '[]'");

  // A QA note is usually just a note. Sometimes it means "this needs fixing",
  // and until now there was no way to say which — the supervisor had to notice.
  // Flagging a note as actionable puts the entry on the submitter's list AND
  // authorizes them to amend that one entry, so asking for a correction doesn't
  // require handing out blanket edit rights to the whole log.
  addColumnIfMissing('production_entries', 'qa_action_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('production_entries', 'qa_action_resolved_at', 'TEXT');
  // Answers to the team's EOD template fields, as a JSON object keyed by field key.
  addColumnIfMissing('production_entries', 'structured_data', 'TEXT');
  // Values for user-added fields (the custom-field engine). One JSON object per
  // record, keyed by field key. Any table that wants self-serve fields adds
  // this column and nothing else — the definitions live in custom_field_defs.
  // (Safe here: qms_records is created in initSchema's exec above.)
  addColumnIfMissing('qms_records', 'custom_data', 'TEXT');
  // Batching runs several MOs in one shift; mo_lines is a JSON array of
  // { product_name, mo_number, lot_number, batches, batch_weights, quantity }.
  // Line 0 is mirrored into the scalar product_name/mo_number/lot_number/
  // quantity_completed columns so filters, metrics, COA and other teams keep
  // working unchanged; the full set lives here.
  addColumnIfMissing('production_entries', 'mo_lines', 'TEXT');

  // Pre-launch cleanup: an entry filed before the plant was really using
  // ReadyDoc can't be signed off now — nobody reviewed that shift, and writing
  // a QA signature today would be a false record. So it is WAIVED instead:
  // qa_signoff_by stays NULL forever, and these three columns say who closed
  // it, when, and why. A waived entry drops out of the pending queues without
  // ever pretending to have been reviewed.
  addColumnIfMissing('production_entries', 'qa_waived_at', 'TEXT');
  addColumnIfMissing('production_entries', 'qa_waived_by', 'TEXT');
  addColumnIfMissing('production_entries', 'qa_waived_reason', 'TEXT');
  // A shift's cleans, as a JSON array. Cleaning is an EVENT with its own time
  // window — not a shift-level attribute — because the room, the sifter and the
  // utensils are cleaned at different times and to different levels, and a
  // second clean can follow a changeover mid-shift. A single "Cleaning
  // performed: Full" answer forced the operator to overstate one or understate
  // the other. Each event may name an MO, so a clean done for one specific run
  // is attributable to it.
  addColumnIfMissing('production_entries', 'cleaning_events', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_production_entries_waived ON production_entries(qa_waived_at)'); } catch { /* ignore */ }

  // Same idea on the task side. A completed task can be reviewed with a note;
  // marking the note as needing rework reopens the task for whoever did it.
  // review_history keeps every round so a reopened-and-redone task still shows
  // what was asked and what the first completion looked like.
  addColumnIfMissing('work_orders', 'review_note', 'TEXT');
  addColumnIfMissing('work_orders', 'review_by', 'TEXT');
  addColumnIfMissing('work_orders', 'review_at', 'TEXT');
  addColumnIfMissing('work_orders', 'rework_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('work_orders', 'review_history', "TEXT NOT NULL DEFAULT '[]'");

  // Deferring a task ("push it to tomorrow") is an audited decision, not a
  // silent due-date edit: snooze_history records who moved it, why, and from
  // where; original_due_date keeps the first due date the schedule generated.
  addColumnIfMissing('work_orders', 'snooze_history', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('work_orders', 'original_due_date', 'TEXT');

  // (chat_push_subscriptions diagnostic columns are added further down, right
  // after the chat schema block that creates the table — a column migration
  // can't run before its table exists, which on a fresh DB is fatal.)

  // (supply_invoices.extracted_text is added further down, right after the
  // office tables are created — a column migration can't run before its table.)

  // 72-hour re-clean workflow: per-room applicability overrides plus the
  // dismiss / N-A / not-in-use / task-assigned actions taken on a flag. An
  // action is bound to a flag_key (room + last clean + last use) so a new
  // clean or use naturally re-arms the flag.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reclean_rooms (
      room TEXT PRIMARY KEY,
      applicable INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reclean_actions (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('dismissed','na','not_in_use','assigned')),
      reason TEXT,
      work_order_id TEXT,
      created_by TEXT,
      created_by_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reclean_actions_room ON reclean_actions(room, created_at);
  `);

  // Certifications: per-person professional certs (PCQI, HACCP, ...) with the
  // actual certificate file stored in R2 (storage-gated, like invoices).
  db.exec(`
    CREATE TABLE IF NOT EXISTS certifications (
      id TEXT PRIMARY KEY,
      person_name TEXT NOT NULL,
      cert_type TEXT NOT NULL,
      issuer TEXT,
      cert_number TEXT,
      issued_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      filename TEXT,
      storage_key TEXT,
      content_type TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_certifications_person ON certifications(person_name);
  `);

  // ── Product management ────────────────────────────────────────────────────
  // The finished-goods catalogue: what we sell, its codes, and the film it
  // prints on. Distinct from coa_specifications, which covers raw materials
  // coming IN from vendors — these are the products going out.
  //
  // `sku` is the primary key and the join key for everything downstream, which
  // is why `legacy_sku` sits beside it: a code that changes must still resolve
  // on a two-year-old PO or Shopify order. Nothing ever clears legacy_sku.
  //
  // This table is also the master the Artwork-Proofing service reads
  // (api/products.js -> GET /master.csv), so a column rename here is a contract
  // change over there.
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_specs (
      spec_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      material_structure TEXT,
      zipper TEXT,
      print_process TEXT,
      trim_length_mm REAL,
      trim_width_mm REAL,
      gusset_mm REAL,
      front_panel_mm REAL,
      wind_direction TEXT,
      core_in TEXT,
      dieline_required INTEGER NOT NULL DEFAULT 1,
      vendor TEXT,
      last_unit_cost REAL,
      -- The exact string that prints on a PO footer. Stored once and rendered
      -- from here, so "SKUs: 21" on a 38-line PO cannot happen again.
      vendor_spec_string TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      sku TEXT PRIMARY KEY,
      legacy_sku TEXT,
      gtin TEXT UNIQUE,
      -- Stored rather than computed so it can be sorted and filtered on.
      -- Every write path that touches gtin must maintain it.
      gtin_valid INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL,
      protein_type TEXT,
      pack TEXT NOT NULL,
      pack_count INTEGER,
      flavor TEXT NOT NULL,
      -- What joins a flavour across formats. "Double Chocolate" is five SKUs.
      base_flavor TEXT NOT NULL,
      flavor_code TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      spec_id TEXT,
      eyemark_color TEXT,
      dieline_required INTEGER NOT NULL DEFAULT 1,
      shopify_sku TEXT,
      shopify_variant_id TEXT,
      shiphero_synced_at TEXT,
      -- Pointers. The formula itself lives in the MRP and is never copied here.
      mrp_formula_id TEXT,
      formula_rev TEXT,
      nfp_version TEXT,
      nfp_approved_at TEXT,
      artwork_version TEXT,
      artwork_status TEXT,
      drive_url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (spec_id) REFERENCES packaging_specs(spec_id)
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_base_flavor ON products(base_flavor);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

    -- One row per colour slot rather than three columns, because the number of
    -- spot colours varies by pack and a fourth colour should not need a schema
    -- change. Validity is stored so a bad value stays visible instead of
    -- silently rendering as black.
    CREATE TABLE IF NOT EXISTS product_colors (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      slot INTEGER NOT NULL,
      pms TEXT,
      hex TEXT,
      pms_valid INTEGER NOT NULL DEFAULT 0,
      hex_valid INTEGER NOT NULL DEFAULT 0,
      UNIQUE (sku, slot),
      FOREIGN KEY (sku) REFERENCES products(sku) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_product_colors_sku ON product_colors(sku);
  `);

  // ── Artwork ───────────────────────────────────────────────────────────────
  // Version history for what is actually printed on the pack, shaped like
  // sop_documents / sop_versions / document_attachments because QA already
  // reads controlled documents that way and this is the same job: which
  // revision is current, what changed, who signed it, and show me the file.
  //
  // Rows are created two ways. Someone uploads a proof, or — the common case —
  // the Artwork-Proofing service finishes a job and posts its results here, so
  // the history accumulates as a side effect of the check that already runs.
  // Shaun keeps working in Drive and uploads nothing.
  //
  // An approved version is never rewritten. A change files a new version and
  // supersedes the old one, same rule as a signed organoleptic record.
  db.exec(`
    CREATE TABLE IF NOT EXISTS artwork_versions (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      -- One SKU can have several printed components: the pouch, the case, the
      -- shipper. They revise independently.
      component TEXT NOT NULL DEFAULT 'primary',
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_review','approved','print_ready','superseded','rejected')),
      -- 'upload' or 'proofing' — where this version came into existence.
      source TEXT NOT NULL DEFAULT 'upload',
      proof_job_id TEXT,
      drive_url TEXT,
      -- The NFP revision this artwork was drawn against. Artwork cannot reach
      -- print_ready unless this matches the product's approved NFP.
      nfp_version TEXT,
      effective_date TEXT,
      superseded_by TEXT,
      change_summary TEXT,
      approved_by TEXT,
      approved_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (sku, component, version),
      FOREIGN KEY (sku) REFERENCES products(sku)
    );
    CREATE INDEX IF NOT EXISTS idx_artwork_versions_sku ON artwork_versions(sku, component, version);
    CREATE INDEX IF NOT EXISTS idx_artwork_versions_status ON artwork_versions(status);

    -- Files live in R2; only the key is stored. 'preview' is a rendered PNG of
    -- page 1, which is what lets the list show the actual pack instead of a
    -- filename — the proofing service already rasterises every page, so it
    -- costs nothing to keep one.
    CREATE TABLE IF NOT EXISTS artwork_files (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'print_pdf'
        CHECK (kind IN ('print_pdf','preview','dieline','proof_report','other')),
      filename TEXT NOT NULL,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT NOT NULL,
      page INTEGER,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (version_id) REFERENCES artwork_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_artwork_files_version ON artwork_files(version_id, kind);

    -- One row per check, per version. Results arrive from the proofing engine
    -- or are recorded by hand. A dismissal keeps the finding and records who
    -- waved it through, because "we looked and it was fine" is the answer an
    -- auditor wants and deleting the row cannot give it.
    CREATE TABLE IF NOT EXISTS artwork_checks (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      check_name TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('pass','fail','warn','dismissed')),
      detail TEXT,
      expected TEXT,
      found TEXT,
      checked_by TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      dismissed_by TEXT,
      dismissed_reason TEXT,
      FOREIGN KEY (version_id) REFERENCES artwork_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_artwork_checks_version ON artwork_checks(version_id);
  `);

  // ── Nutrition Facts Panels ────────────────────────────────────────────────
  // The panel that is printed on the pack, as an approvable record rather than
  // a version string somebody typed.
  //
  // `products.nfp_version` / `nfp_approved_at` already existed and are what the
  // artwork print gate reads — nothing may reach print_ready against an
  // unapproved panel, or against a panel that is not the product's current one.
  // But those were two free-text fields, so "NFP V3 approved" was an assertion
  // with nothing behind it: no file, no approver, no date anyone can check. An
  // auditor asking to see the panel that was approved and the artwork printed
  // from it got a version number.
  //
  // So the columns stay — they are the gate and the readiness step, and every
  // consumer keeps working — but they become a MIRROR written by the approval
  // here, never typed. Same arrangement as knife_accountability.status mirroring
  // the sign-out log: one authority, one derived copy.
  //
  // An approved panel is never rewritten. A correction files a new version and
  // supersedes the old one, exactly like artwork and a signed organoleptic
  // record — history that can be edited is not evidence.
  db.exec(`
    CREATE TABLE IF NOT EXISTS nfp_versions (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      -- TEXT, not a counter: this is the label that gets printed on artwork and
      -- matched against artwork_versions.nfp_version. "V3", "2026-A".
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','approved','rejected','superseded')),
      -- 'upload' — filed here and approved here; 'paper' — approved before
      -- ReadyDoc, recorded with the date and the name of whoever signed it.
      source TEXT NOT NULL DEFAULT 'upload',
      serving_size TEXT,
      servings_per_container TEXT,
      -- Which formula the panel was calculated from. A reformulation that does
      -- not move this is the case where a panel silently stops being true.
      formula_rev TEXT,
      drive_url TEXT,
      change_summary TEXT,
      -- The signed link. Stored as a SHA-256 hash and returned in clear exactly
      -- once, same as a partner portal token: a link that can be read back out
      -- of the database is a second copy of a credential.
      token_hash TEXT,
      token_issued_at TEXT,
      token_issued_by TEXT,
      sent_to TEXT,
      approved_by TEXT,
      approved_at TEXT,
      -- 'link' | 'in_app' | 'paper' — how the decision actually arrived.
      decided_via TEXT,
      decision_comments TEXT,
      rejected_reason TEXT,
      superseded_by TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (sku, version),
      FOREIGN KEY (sku) REFERENCES products(sku)
    );
    CREATE INDEX IF NOT EXISTS idx_nfp_versions_sku ON nfp_versions(sku, status);
    CREATE INDEX IF NOT EXISTS idx_nfp_versions_token ON nfp_versions(token_hash);

    -- The panel itself. Files live in R2; only the key is stored. Without one
    -- there is nothing for an approver to look at, which is why sending a link
    -- refuses when neither a file nor a Drive link is on the version.
    CREATE TABLE IF NOT EXISTS nfp_files (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'panel'
        CHECK (kind IN ('panel','preview','backup','other')),
      filename TEXT NOT NULL,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (version_id) REFERENCES nfp_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_nfp_files_version ON nfp_files(version_id, kind);
  `);

  // Post-repair hygiene clearance
  addColumnIfMissing('work_orders', 'clearance_required', 'INTEGER DEFAULT 0');
  addColumnIfMissing('work_orders', 'clearance_status', 'TEXT');
  addColumnIfMissing('work_orders', 'clearance_by', 'TEXT');
  addColumnIfMissing('work_orders', 'clearance_at', 'TEXT');
  addColumnIfMissing('work_orders', 'clearance_notes', 'TEXT');
  addColumnIfMissing('work_orders', 'clearance_method', 'TEXT');

  // Contractor tracking
  addColumnIfMissing('users', 'is_contractor', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'contractor_company', 'TEXT');
  addColumnIfMissing('users', 'contractor_license', 'TEXT');
  addColumnIfMissing('users', 'contractor_insurance_expiry', 'TEXT');
  addColumnIfMissing('users', 'contractor_scope', 'TEXT');

  // Chemical FK links
  addColumnIfMissing('work_orders', 'chemical_id', 'TEXT');
  addColumnIfMissing('sanitation_records', 'chemical_id', 'TEXT');

  // Filing a clean that was done days ago.
  //
  // `performed_at` defaulted to now and could not be set, so a cleaner locked
  // out of her account for a few days had no way to record work she had
  // actually done. She can now, and the record says so: `entered_at` is when it
  // was keyed, `entered_late` marks the two apart, and a reason is required.
  //
  // Back-dating a compliance record is only safe when it is VISIBLE. A late
  // entry that looks identical to one filed the same day is a false record;
  // one that carries both dates and a reason is the honest version of what
  // happened, and is what an auditor expects to see.
  addColumnIfMissing('sanitation_records', 'entered_at', 'TEXT');
  addColumnIfMissing('sanitation_records', 'entered_late', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('sanitation_records', 'late_entry_reason', 'TEXT');

  // Chemical location tracking
  addColumnIfMissing('approved_chemicals', 'location_for_use', 'TEXT');
  addColumnIfMissing('approved_chemicals', 'sds_url', 'TEXT');

  // Issue flagging on work orders
  addColumnIfMissing('work_orders', 'issue_flagged', 'INTEGER DEFAULT 0');
  addColumnIfMissing('work_orders', 'issue_notes', 'TEXT');
  addColumnIfMissing('work_orders', 'issue_attachments', "TEXT DEFAULT '[]'");
  addColumnIfMissing('work_orders', 'issue_flagged_by', 'TEXT');
  addColumnIfMissing('work_orders', 'issue_flagged_at', 'TEXT');
  addColumnIfMissing('work_orders', 'readings', "TEXT DEFAULT '{}'");
  addColumnIfMissing('work_orders', 'step_results', "TEXT DEFAULT '[]'");
  addColumnIfMissing('work_orders', 'reading_result', 'TEXT');

  // CAPA extended fields matching Form 408-2
  addColumnIfMissing('capas', 'date_issued', 'TEXT');
  addColumnIfMissing('capas', 'item_lot', 'TEXT');
  addColumnIfMissing('capas', 'item_number', 'TEXT');
  addColumnIfMissing('capas', 'item_description', 'TEXT');
  addColumnIfMissing('capas', 'work_order_number', 'TEXT');
  addColumnIfMissing('capas', 'po_number', 'TEXT');
  addColumnIfMissing('capas', 'source_type', 'TEXT');
  addColumnIfMissing('capas', 'immediate_correction', 'TEXT');
  addColumnIfMissing('capas', 'series_of_document', 'TEXT');
  addColumnIfMissing('capas', 'proposed_solution', 'TEXT');
  addColumnIfMissing('capas', 'mgmt_verification_date', 'TEXT');
  addColumnIfMissing('capas', 'mgmt_verification_by', 'TEXT');
  addColumnIfMissing('capas', 'nc_number', 'TEXT');
  addColumnIfMissing('capas', 'linked_complaint_number', 'TEXT');
  addColumnIfMissing('capas', 'is_preventive_action', 'INTEGER DEFAULT 0');

  // Module access permissions per user (JSON array of module IDs, null = all access)
  addColumnIfMissing('users', 'module_access', 'TEXT');

  // Widen users.role CHECK constraint to include 'auditor'
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'auditor'")) {
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const colList = cols.join(', ');
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TABLE IF EXISTS users_new');
      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          pin TEXT,
          role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','supervisor','operator','auditor')),
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          department TEXT DEFAULT 'warehouse',
          is_contractor INTEGER DEFAULT 0,
          contractor_company TEXT,
          contractor_license TEXT,
          contractor_insurance_expiry TEXT,
          contractor_scope TEXT,
          module_access TEXT
        );
        INSERT INTO users_new (${colList}) SELECT ${colList} FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
      db.pragma('foreign_keys = ON');
      console.log('[migrate] Widened users.role CHECK to include auditor');
    }
  } catch (e) {
    db.pragma('foreign_keys = ON');
    console.warn('[migrate] Could not migrate users table for auditor role:', e.message);
  }

  // Widen work_orders.status CHECK constraint to include 'not_applicable'
  try {
    const woInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_orders'").get();
    if (woInfo && woInfo.sql && !woInfo.sql.includes("'not_applicable'")) {
      const cols = db.prepare("PRAGMA table_info(work_orders)").all().map(c => c.name);
      const colList = cols.join(', ');
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TABLE IF EXISTS work_orders_new');
      const createSql = woInfo.sql
        .replace('work_orders', 'work_orders_new')
        .replace(
          "CHECK (status IN ('open','in_progress','completed','overdue','missed','cancelled'))",
          "CHECK (status IN ('open','in_progress','completed','overdue','missed','cancelled','not_applicable'))"
        );
      db.exec(createSql);
      db.exec(`INSERT INTO work_orders_new (${colList}) SELECT ${colList} FROM work_orders`);
      db.exec('DROP TABLE work_orders');
      db.exec('ALTER TABLE work_orders_new RENAME TO work_orders');
      db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_due_date ON work_orders(due_date)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_equipment ON work_orders(equipment_id)');
      db.pragma('foreign_keys = ON');
      console.log("[migrate] Widened work_orders.status CHECK to include 'not_applicable'");
    }
  } catch (e) {
    db.pragma('foreign_keys = ON');
    console.warn('[migrate] Could not migrate work_orders table for not_applicable status:', e.message);
  }

  // COA extended fields for facility COA export
  addColumnIfMissing('equipment', 'loto_required', 'INTEGER DEFAULT 1');
  // Default assignee (department/group) for this equipment's PM work —
  // 'maintenance' | 'warehouse' | 'qa' | 'cleaning'. Propagates to the
  // equipment's PM schedules and open work orders when set.
  addColumnIfMissing('equipment', 'task_group', 'TEXT');

  // Make work_orders.equipment_id nullable so departments (e.g. Document
  // Control) can be assigned free-form tasks that aren't tied to a machine.
  // One-time, transactional table rebuild — guarded so it only runs once.
  try {
    const col = db.prepare('PRAGMA table_info(work_orders)').all().find(c => c.name === 'equipment_id');
    if (col && col.notnull === 1) {
      const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_orders'").get().sql;
      const newSql = createSql
        .replace(/CREATE TABLE\s+"?work_orders"?/i, 'CREATE TABLE work_orders_new')
        .replace(/equipment_id\s+TEXT\s+NOT\s+NULL/i, 'equipment_id TEXT');
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='work_orders' AND sql IS NOT NULL").all().map(r => r.sql);
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(newSql);
        db.exec('INSERT INTO work_orders_new SELECT * FROM work_orders');
        db.exec('DROP TABLE work_orders');
        db.exec('ALTER TABLE work_orders_new RENAME TO work_orders');
        for (const ix of indexes) db.exec(ix);
      })();
      db.pragma('foreign_keys = ON');
      console.log('[migrate] work_orders.equipment_id is now nullable (non-equipment tasks supported)');
    }
  } catch (e) {
    console.error('[migrate] work_orders equipment_id nullable failed:', e.message);
  }
  // Mark area/zone types as not requiring LOTO.
  //
  // `equipment.loto_required` is the AUTHORITY on this — read the column, never
  // re-derive it from the type string. The setup checklist got that wrong once
  // and shipped its own list of type names, which then disagreed with the LOTO
  // module and the compliance badge that were already reading this. The zone
  // classification proper is `asset_kind`, backfilled further down.
  const alreadyTagged = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE loto_required = 0").get().c;
  if (alreadyTagged === 0) {
    db.prepare(`UPDATE equipment SET loto_required = 0 WHERE type IN (${ZONE_TYPES.map(() => '?').join(',')})`).run(...ZONE_TYPES);
    const updated = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE loto_required = 0").get().c;
    if (updated > 0) console.log(`[migrate] Marked ${updated} area/zone items as not requiring LOTO`);
  }

  addColumnIfMissing('coa_requests', 'origin', 'TEXT');
  addColumnIfMissing('coa_requests', 'supplier', 'TEXT');
  addColumnIfMissing('coa_requests', 'product_code', 'TEXT');
  addColumnIfMissing('coa_requests', 'manufacturer_lot', 'TEXT');
  addColumnIfMissing('coa_requests', 'vendor_lot', 'TEXT');
  addColumnIfMissing('coa_requests', 'received_date', 'TEXT');
  addColumnIfMissing('coa_requests', 'certificate_number', 'TEXT');
  addColumnIfMissing('coa_requests', 'date_of_issuance', 'TEXT');

  // Calibration certificate PDFs/scans attached to individual calibration
  // records (stored on disk under data/calibration-certs).
  addColumnIfMissing('calibration_records', 'certificate_file', 'TEXT');
  addColumnIfMissing('calibration_records', 'certificate_original_name', 'TEXT');

  // Digital COA sign-off: who signed, when, and a snapshot of the signature
  // image at signing time (so later changes to a user's saved signature never
  // alter an already-issued certificate).
  addColumnIfMissing('coa_requests', 'qa_signed_by', 'TEXT');
  addColumnIfMissing('coa_requests', 'qa_signed_by_id', 'TEXT');
  addColumnIfMissing('coa_requests', 'qa_signed_at', 'TEXT');
  addColumnIfMissing('coa_requests', 'qa_signature', 'TEXT');
  // A user's reusable drawn signature (PNG data URL), applied when signing.
  addColumnIfMissing('users', 'signature_image', 'TEXT');

  // Multiple schedule lines per room/day (e.g. several Kitting products on the same day)
  addColumnIfMissing('production_schedule', 'slot', 'INTEGER NOT NULL DEFAULT 0');

  // Disposal witness (free-text) — Ops Manager/QC sign-offs live in approvals JSON
  addColumnIfMissing('disposals', 'witness', 'TEXT');
  // Draft status + provenance back-link (e.g. auto-created from an organoleptic
  // FAIL). status: NULL/'complete' = normal; 'draft' = needs completion.
  addColumnIfMissing('disposals', 'status', 'TEXT');
  addColumnIfMissing('disposals', 'source_type', 'TEXT');
  addColumnIfMissing('disposals', 'source_id', 'TEXT');

  // Raw-material spec identity (Form 607-01): SKU / vendor / revision on the
  // COA specifications so a spec is tied to a material, not just an item number.
  addColumnIfMissing('coa_specifications', 'sku_number', 'TEXT');
  addColumnIfMissing('coa_specifications', 'vendor', 'TEXT');
  addColumnIfMissing('coa_specifications', 'revision', 'TEXT');

  // Seeded specifications arrive as DRAFTS for QA to review.
  //
  // `is_active` already means two things at once if you're not careful:
  // grading only ever reads `is_active = 1`, and the delete route sets it to 0
  // to RETIRE a spec. So a draft is `is_active = 0` — which gives the safety
  // property for free, a draft can never grade a result — and
  // `approval_status` is what tells a draft apart from a retirement.
  // 'approved' is the default so every spec already on file, typed in
  // deliberately by QA, keeps meaning exactly what it meant.
  addColumnIfMissing('coa_specifications', 'approval_status', "TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing('coa_specifications', 'source', 'TEXT');
  addColumnIfMissing('coa_specifications', 'reviewed_by', 'TEXT');
  addColumnIfMissing('coa_specifications', 'reviewed_at', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_coa_specs_approval ON coa_specifications(approval_status)'); } catch { /* ignore */ }

  // Document review scheduling: each controlled document gets a review frequency
  // (default annual per SQF) that drives an auto-computed next-review date
  // (stored in the existing review_due) and generates Document-Control tasks.
  addColumnIfMissing('sop_documents', 'review_frequency', 'TEXT');
  addColumnIfMissing('sop_documents', 'last_reviewed', 'TEXT');
  addColumnIfMissing('work_orders', 'document_id', 'TEXT'); // link a review task back to its doc
  try {
    db.prepare("UPDATE sop_documents SET review_frequency = 'annual' WHERE review_frequency IS NULL").run();
    // Seed a next-review date for docs that don't have one yet: effective date
    // (or creation) + 1 year. Only touches active docs missing review_due.
    db.prepare(`UPDATE sop_documents
      SET review_due = date(COALESCE(NULLIF(effective_date,''), date(created_at), date('now')), '+12 months')
      WHERE (review_due IS NULL OR review_due = '') AND status != 'archived'`).run();
  } catch (e) {
    console.warn('[migrate] document review scheduling backfill:', e.message);
  }

  // Quality task schedules (Phase 2): recurring Quality-Control checks
  // (hygienic, organoleptic, glass/brittle-plastic, sanitation, etc.) that
  // generate QA work orders on a calendar frequency, mirroring how equipment
  // PM schedules feed maintenance tasks. next_due drives generation; the
  // schedule advances on its own calendar so a missed check never piles up.
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      module_id TEXT,
      frequency_type TEXT NOT NULL DEFAULT 'monthly',
      frequency_value INTEGER NOT NULL DEFAULT 1,
      procedure_steps TEXT NOT NULL DEFAULT '[]',
      next_due TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addColumnIfMissing('work_orders', 'quality_schedule_id', 'TEXT'); // link a QC task back to its schedule


  // Material-level requirements narrative (Form 607-01 sections 2-5): packaging,
  // labeling, storage, acceptance criteria, etc. One row per item number,
  // alongside the per-test limits in coa_specifications.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS coa_material_specs (
      item_number TEXT PRIMARY KEY,
      common_name TEXT, sku_number TEXT, vendor TEXT, revision TEXT,
      packaging TEXT, labeling TEXT, desiccant TEXT,
      storage TEXT, handling TEXT, safety TEXT,
      acceptance_criteria TEXT, retest_panel TEXT, max_shelf_life TEXT, treatment_note TEXT,
      notes TEXT, updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch (e) {
    console.warn('[db] coa_material_specs unavailable:', e.message);
  }

  // Link an org-chart position to its Job Description document
  addColumnIfMissing('org_positions', 'job_description_id', 'TEXT');

  // "Logged on paper" flag — grandfathered/historical disposals whose Ops
  // Manager & QC signatures live on the uploaded scanned form, not in-system,
  // so they don't show as awaiting approval. Backfill the historical import.
  if (addColumnIfMissing('disposals', 'paper_record', 'INTEGER NOT NULL DEFAULT 0')) {
    try {
      const marked = db.prepare("UPDATE disposals SET paper_record = 1 WHERE created_by = 'system-import'").run();
      if (marked.changes > 0) console.log(`[migrate] Marked ${marked.changes} imported historical disposals as paper records`);
    } catch (e) { console.error('[migrate] disposals paper_record backfill:', e.message); }
  }

  // Generalize the SOP registry into a unified document-control system.
  // sop_documents now holds SOPs, Work Instructions, Job Descriptions, etc.
  addColumnIfMissing('sop_documents', 'doc_type', "TEXT NOT NULL DEFAULT 'sop'");
  addColumnIfMissing('sop_documents', 'approved_by', 'TEXT');
  addColumnIfMissing('sop_documents', 'approved_at', 'TEXT');
  addColumnIfMissing('sop_documents', 'source_file', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sop_doc_type ON sop_documents(doc_type)'); } catch { /* ignore */ }

  // Migrate module_access from legacy array form (["a","b"]) to per-module
  // level object ({a:"edit", b:"edit"}) so View/Edit permissions apply.
  try {
    const rows = db.prepare('SELECT id, module_access FROM users WHERE module_access IS NOT NULL').all();
    for (const r of rows) {
      let parsed;
      try { parsed = JSON.parse(r.module_access); } catch { continue; }
      if (Array.isArray(parsed)) {
        const obj = {};
        for (const id of parsed) obj[id] = 'edit';
        db.prepare('UPDATE users SET module_access = ? WHERE id = ?').run(JSON.stringify(obj), r.id);
      }
    }
  } catch (e) {
    console.warn('[migrate] Could not migrate module_access to view/edit form:', e.message);
  }

  // Training records evolve from a flat log into course-linked completions with
  // stable employee identity, a computed retraining due date, attached scanned
  // evidence, and a link to the in-app test attempt that produced them.
  addColumnIfMissing('training_records', 'course_id', 'TEXT');
  addColumnIfMissing('training_records', 'employee_user_id', 'TEXT');
  addColumnIfMissing('training_records', 'method', 'TEXT');
  addColumnIfMissing('training_records', 'passed', 'INTEGER');
  addColumnIfMissing('training_records', 'next_due_date', 'TEXT');
  addColumnIfMissing('training_records', 'document_url', 'TEXT');
  addColumnIfMissing('training_records', 'test_attempt_id', 'TEXT');
  addColumnIfMissing('training_records', 'superseded', 'INTEGER NOT NULL DEFAULT 0');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_training_course ON training_records(course_id)'); } catch { /* ignore */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_training_due ON training_records(next_due_date)'); } catch { /* ignore */ }

  // Document ↔ training linkage: when a linked SOP/WI changes materially, people
  // trained on the old version go stale. `training_revision` tracks the revision
  // training must reflect — bumped only on non-minor edits; `sop_versions.minor`
  // marks a revision as a typo/formatting fix that should NOT trigger retraining.
  addColumnIfMissing('training_courses', 'retrain_on_doc_change', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('training_records', 'sop_revision', 'TEXT');
  // The scanned test itself, kept as the EVIDENCE behind the completion — an
  // auditor asking "show me he passed it" wants the paper, not a row.
  // evidence_text is the PDF's own text layer where it has one; a photographed
  // scan has none, and the row says so rather than implying it was searched.
  addColumnIfMissing('training_records', 'evidence_key', 'TEXT');
  addColumnIfMissing('training_records', 'evidence_filename', 'TEXT');
  addColumnIfMissing('training_records', 'evidence_text', 'TEXT');
  addColumnIfMissing('training_records', 'evidence_status', 'TEXT');
  addColumnIfMissing('training_tests', 'sop_revision', 'TEXT');
  addColumnIfMissing('sop_documents', 'training_revision', 'TEXT');
  addColumnIfMissing('sop_versions', 'minor', 'INTEGER NOT NULL DEFAULT 0');

  // Equipment ↔ training / document linkage. A course and a work instruction can
  // be ABOUT a machine (WI021 is literally "Hexagon Tumbler Mixer Operation"),
  // and without the link nothing can answer "is this machine ready to run" —
  // which is the whole point of the setup checklist. Nullable: most courses and
  // most documents are not about one piece of equipment.
  addColumnIfMissing('training_courses', 'equipment_id', 'TEXT');
  addColumnIfMissing('sop_documents', 'equipment_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_training_courses_equipment ON training_courses(equipment_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sop_documents_equipment ON sop_documents(equipment_id)');

  // Withdrawing a controlled document is a DECISION, not housekeeping.
  //
  // `status = 'archived'` already got a document out of the active list, but it
  // recorded nothing about why or when — and for an SOP, a Work Instruction or
  // a Job Description those are the two facts an auditor asks for. "Who decided
  // this instruction no longer applies, and from when?" cannot be answered by a
  // row that merely stopped appearing.
  //
  // Reusing the existing status rather than adding a sixth is deliberate: the
  // registry, the review-due query, the doc-review queue and the training
  // retrain check all read `status`, and a new value would have to be added to
  // every one of them correctly or a withdrawn document would keep generating
  // work. What changes is that the state now carries its reason.
  addColumnIfMissing('sop_documents', 'archived_at', 'TEXT');
  addColumnIfMissing('sop_documents', 'archived_by', 'TEXT');
  addColumnIfMissing('sop_documents', 'archive_reason', 'TEXT');

  // Spanish translations (AI-assisted, stored + editable) for documents + tests.
  addColumnIfMissing('sop_documents', 'description_es', 'TEXT');
  addColumnIfMissing('training_questions', 'prompt_es', 'TEXT');
  addColumnIfMissing('training_questions', 'options_es', 'TEXT');

  // ── Communication tool (Slack-style) — Phase 1 ──────────────────────────────
  // Kept in the same DB so the cross-module AI assistant can reason over comms +
  // compliance together. Private channels + DMs are gated by chat_channel_members.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_channels (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'public' CHECK (kind IN ('public','private','dm')),
      name TEXT,
      topic TEXT,
      dm_key TEXT UNIQUE,
      created_by TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_channel_members (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      last_read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT,
      parent_id TEXT,
      edited_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT,
      size INTEGER,
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_channel_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_channel ON chat_channel_members(channel_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);
    CREATE TABLE IF NOT EXISTS chat_message_embeddings (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_embeddings_channel ON chat_message_embeddings(channel_id);
    CREATE TABLE IF NOT EXISTS chat_message_translations (
      message_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, lang)
    );
    CREATE TABLE IF NOT EXISTS chat_mentions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_mentions_user ON chat_mentions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_mentions_message ON chat_mentions(message_id);
    CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_push_user ON chat_push_subscriptions(user_id);

    -- Per-person read state for a single thread. Threads act like their own
    -- channel — each is unread until you open it — which is why this can't be
    -- derived from the channel's last_read_at.
    CREATE TABLE IF NOT EXISTS chat_thread_reads (
      user_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, parent_id)
    );

    -- Slack-style "Remind me about this": ReadyBot DMs the user at remind_at.
    CREATE TABLE IF NOT EXISTS chat_reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      fired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_reminders_due ON chat_reminders(remind_at) WHERE fired_at IS NULL;
  `);

  // Push subscriptions are bound to the VAPID key they were created with. If
  // the server's keys ever change, every older subscription starts failing with
  // a 403 that nothing was recording — the phone looks subscribed, the server
  // thinks it sent, and no notification ever arrives. Storing the key each
  // subscription was made under (plus the last send result) makes that state
  // visible and repairable instead of silent. (Runs here, after the chat schema
  // block above creates chat_push_subscriptions — not with the other migrations.)
  // "Mark unread from here" as a deliberate act. last_read_at alone can't
  // represent it: the unread counts exclude your OWN messages (so bot-path
  // posts made as you don't self-badge), which made mark-unread a silent
  // no-op on a message you authored — e.g. a request you forwarded into a
  // channel. The flag makes a deliberate mark count own messages too, and
  // stops your own replies from silently advancing the marker past it.
  // Cleared by reading the channel (or read-all).
  addColumnIfMissing('chat_channel_members', 'deliberate_unread', 'INTEGER NOT NULL DEFAULT 0');
  // Same flag for threads — they carry their own read state, and a deliberate
  // mark on a thread reply has the same two problems to survive.
  addColumnIfMissing('chat_thread_reads', 'deliberate_unread', 'INTEGER NOT NULL DEFAULT 0');

  addColumnIfMissing('chat_push_subscriptions', 'vapid_key', 'TEXT');
  addColumnIfMissing('chat_push_subscriptions', 'user_agent', 'TEXT');
  addColumnIfMissing('chat_push_subscriptions', 'last_success_at', 'TEXT');
  addColumnIfMissing('chat_push_subscriptions', 'last_error', 'TEXT');
  addColumnIfMissing('chat_push_subscriptions', 'last_error_at', 'TEXT');

  // Comms: announcement channels (admins-only posting) and default channels
  // (everyone auto-joined, pinned) — Slack-style #general / #announcements.
  addColumnIfMissing('chat_channels', 'post_policy', "TEXT NOT NULL DEFAULT 'all'"); // 'all' | 'admins'
  addColumnIfMissing('chat_channels', 'is_default', 'INTEGER NOT NULL DEFAULT 0');

  // Repair: strip DM memberships that belong to nobody.
  //
  // POST /comms/activity/read used to enrol the caller in every channel its
  // feed touched, and the feed's DM branch was not membership-scoped — so an
  // admin who cleared the Activity badge once was silently added to every
  // direct message in the plant, and every one of those private conversations
  // then appeared in their channel list. The query is scoped now, but the rows
  // it already wrote outlive the fix.
  //
  // chat_channels.dm_key is the sorted list of the real participants, set at
  // creation on all three DM paths (1:1, group, ReadyBot), so it is the
  // authority on who belongs. Anyone in a DM but absent from its key was put
  // there by that bug. Idempotent — a clean database matches nothing.
  try {
    const stray = db.prepare(`
      SELECT m.rowid AS rid FROM chat_channel_members m
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE c.kind = 'dm' AND c.dm_key IS NOT NULL AND c.dm_key != ''
        AND ':' || c.dm_key || ':' NOT LIKE '%:' || m.user_id || ':%'`).all();
    if (stray.length) {
      const del = db.prepare('DELETE FROM chat_channel_members WHERE rowid = ?');
      db.transaction(() => { for (const s of stray) del.run(s.rid); })();
      console.log(`[migrate] removed ${stray.length} DM membership row(s) that no participant owned`);
    }
  } catch { /* pre-comms database */ }

  // Comms: sidebar sections (admin-defined groupings like OFFICE / WAREHOUSE /
  // PRODUCTION) and per-channel ordering within a section.
  db.exec(`CREATE TABLE IF NOT EXISTS chat_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  addColumnIfMissing('chat_channels', 'section_id', 'TEXT');
  addColumnIfMissing('chat_channels', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');

  // Full-text keyword search over messages (Comms Phase 3). FTS5 may be absent
  // from some SQLite builds — degrade gracefully (search simply returns nothing).
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
        body, message_id UNINDEXED, channel_id UNINDEXED
      );
      CREATE TRIGGER IF NOT EXISTS chat_fts_ai AFTER INSERT ON chat_messages BEGIN
        INSERT INTO chat_messages_fts (body, message_id, channel_id)
          SELECT new.body, new.id, new.channel_id WHERE new.body IS NOT NULL AND new.deleted_at IS NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS chat_fts_au AFTER UPDATE ON chat_messages BEGIN
        DELETE FROM chat_messages_fts WHERE message_id = old.id;
        INSERT INTO chat_messages_fts (body, message_id, channel_id)
          SELECT new.body, new.id, new.channel_id WHERE new.body IS NOT NULL AND new.deleted_at IS NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS chat_fts_ad AFTER DELETE ON chat_messages BEGIN
        DELETE FROM chat_messages_fts WHERE message_id = old.id;
      END;
    `);
    // Backfill any messages that predate the FTS index.
    if (db.prepare('SELECT COUNT(*) n FROM chat_messages_fts').get().n === 0) {
      db.exec(`INSERT INTO chat_messages_fts (body, message_id, channel_id)
               SELECT body, id, channel_id FROM chat_messages WHERE body IS NOT NULL AND deleted_at IS NULL`);
    }
  } catch (e) {
    console.warn('[db] FTS5 message search unavailable:', e.message);
  }
  try { db.prepare('UPDATE sop_documents SET training_revision = revision WHERE training_revision IS NULL').run(); } catch { /* ignore */ }

  // Audit log: stable actor identity (survives renames) + role/department for
  // filtering + human-readable entity label. Backfill identity from the users
  // table by name, and normalize historical action verbs to the canonical set.
  // Password auth (replacing PIN). scrypt hash stored as "salt:hash" hex.
  addColumnIfMissing('users', 'password_hash', 'TEXT');
  // Default landing workspace per user: 'fsqa' (default) or 'messages'.
  addColumnIfMissing('users', 'home_workspace', 'TEXT');
  // Last time this user opened the Production Schedule — clears the New/Updated
  // badge that admins raise when they publish/update the week's schedule.
  addColumnIfMissing('users', 'schedule_seen_at', 'TEXT');

  // Light Inspection (Form 110-01/02), Brittle Plastic & Glass (Form 431-02)
  // and Temperature & Humidity Control (Form 110-04) are QA inspections that
  // happen to be stored as sanitation_records. Tagging them keeps the
  // Sanitation log about cleaning and puts the inspections on QA's own list,
  // without moving a single historical record. The same tagger runs again
  // after the seeds (server.js) — on a fresh DB this pass sees an empty table.
  addColumnIfMissing('sanitation_records', 'record_group', "TEXT DEFAULT 'sanitation'");
  // Both lists filter on record_group before ordering by date. Indexed here,
  // immediately after the column exists — creating it up with the other
  // sanitation indexes made a FRESH database fail at boot with "no such column:
  // record_group", because the table is created there without it. Railway's
  // persistent volume hid that; a new deploy or a DR restore would not have.
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sanitation_group_date ON sanitation_records(record_group, performed_at);'); } catch { /* ignore */ }
  tagQaInspectionRecords(db);

  // Short sign-in name (first + last) for people whose legal name runs to three
  // or four words. `name` stays the full name on every record; this is only
  // what they type to log in. NULLs don't collide in a SQLite unique index, so
  // the index is safe to create before the backfill fills them.
  // Passwords expire once a year (see PASSWORD_MAX_AGE_DAYS in api/users.js).
  //
  // The clock starts when this column is filled, NOT at the account's creation
  // date. Nobody knows when the existing passwords were actually set, and
  // backfilling from created_at would expire most of the plant the moment this
  // deploys — the whole floor locked out on a Monday morning. Starting the
  // clock now gives everyone a full year and makes the policy's start date an
  // honest, recorded fact rather than a guess.
  addColumnIfMissing('users', 'password_changed_at', 'TEXT');
  try {
    const started = db.prepare(`UPDATE users SET password_changed_at = datetime('now')
      WHERE password_hash IS NOT NULL AND password_changed_at IS NULL`).run().changes;
    if (started) console.log(`[db] Password expiry clock started for ${started} existing user${started === 1 ? '' : 's'}`);
  } catch (e) {
    console.warn('[db] password_changed_at backfill skipped:', e.message);
  }

  addColumnIfMissing('users', 'username', 'TEXT');
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
    const filled = backfillUsernames(db);
    if (filled) console.log(`[db] Assigned sign-in usernames to ${filled} user${filled === 1 ? '' : 's'}`);
  } catch (e) {
    console.warn('[db] username backfill skipped:', e.message);
  }

  // Generic app-wide key/value settings (e.g. the schedule "notified" marker).
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (e) {
    console.warn('[db] app_settings unavailable:', e.message);
  }

  // Generic content-translation cache: reusable across modules (operator task
  // titles/steps, etc.). Keyed by a hash of the source text + target language so
  // identical strings are translated once and reused everywhere.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        source_hash TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        source_text TEXT,
        translated  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (source_hash, target_lang)
      )
    `);
  } catch (e) {
    console.warn('[db] translation_cache unavailable:', e.message);
  }

  /**
   * `equipment.asset_kind` — is this row a MACHINE or an AREA/ZONE?
   *
   * 39 of the plant's 183 equipment rows are inspection, light-fixture,
   * cleaning and environmental-monitoring zones. They live in this table
   * legitimately: `pm_schedules.equipment_id` is NOT NULL and a zone genuinely
   * needs a recurring schedule, so the alternative is a second copy of the PM
   * machinery for things that already work. What was wrong was that the
   * distinction was INFERRED FROM THE `type` STRING in several places at once —
   * the loto_required backfill below, the setup checklist, and implicitly the
   * cleaning seeds — so a zone typed even slightly differently silently became
   * a machine that owed a lockout procedure, a training course and a work
   * instruction. A fundamental distinction has to be a column somebody can set,
   * not a string list each caller re-derives.
   *
   * Backfilled ONCE, recorded in app_settings. A count-based guard ("no rows
   * are zones yet") would re-tag on the next boot if an admin deliberately
   * reclassified them all, which is the sort of quiet undo that makes people
   * stop trusting a setting.
   */
  /**
   * Mock recall — the fields FORM 415-1 / SOP 415 V3 actually asks for.
   *
   * The original table was a reasonable guess at a mock recall; the SOP names
   * seventeen specific things the exercise "will document" and three
   * effectiveness criteria, and most of them had nowhere to go. A record that
   * can't hold what the controlled procedure requires is not evidence the
   * procedure was followed — which is the entire point of running the drill.
   *
   * Deliberately additive: every existing column keeps its meaning and every
   * filed record still reads. Nothing here is required at creation, because a
   * mock recall is filled in AS IT RUNS — the reconciliation isn't knowable at
   * the start. The completeness rule lives at sign-off instead.
   */
  addColumnIfMissing('mock_recalls', 'item_number', 'TEXT');
  addColumnIfMissing('mock_recalls', 'date_produced', 'TEXT');
  addColumnIfMissing('mock_recalls', 'date_distributed', 'TEXT');
  addColumnIfMissing('mock_recalls', 'started_at', 'TEXT');
  addColumnIfMissing('mock_recalls', 'ended_at', 'TEXT');
  addColumnIfMissing('mock_recalls', 'quantity_quarantined', 'TEXT');
  addColumnIfMissing('mock_recalls', 'quantity_in_market', 'TEXT');
  addColumnIfMissing('mock_recalls', 'notification_method', 'TEXT');
  addColumnIfMissing('mock_recalls', 'customer_disposition', 'TEXT');
  addColumnIfMissing('mock_recalls', 'batch_records', 'TEXT');
  addColumnIfMissing('mock_recalls', 'labeling_records', 'TEXT');
  addColumnIfMissing('mock_recalls', 'retention_samples', 'TEXT');
  addColumnIfMissing('mock_recalls', 'reconciliation', 'TEXT');
  addColumnIfMissing('mock_recalls', 'product_disposition', 'TEXT');
  addColumnIfMissing('mock_recalls', 'closeout_minutes', 'TEXT');
  // The three effectiveness criteria, stored as the numbers they are derived
  // from rather than as a tick — a mass balance recorded as "pass" cannot be
  // re-checked, and an auditor asks for the percentage.
  addColumnIfMissing('mock_recalls', 'mass_balance_pct', 'REAL');
  addColumnIfMissing('mock_recalls', 'summary_report_complete', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('mock_recalls', 'form_415_1_checked', 'INTEGER NOT NULL DEFAULT 0');
  // Not successful → an investigation with root cause and actions taken.
  addColumnIfMissing('mock_recalls', 'root_cause', 'TEXT');
  addColumnIfMissing('mock_recalls', 'investigation_required', 'INTEGER NOT NULL DEFAULT 0');
  // "All documentation generated from the Mock Recall will be filed with the
  // Document Control department."
  addColumnIfMissing('mock_recalls', 'filed_with_dc_at', 'TEXT');
  addColumnIfMissing('mock_recalls', 'filed_with_dc_by', 'TEXT');
  // Authorization — the SOP's signature line, same shape as every other
  // signed record here.
  addColumnIfMissing('mock_recalls', 'approved_by', 'TEXT');
  addColumnIfMissing('mock_recalls', 'approved_at', 'TEXT');
  addColumnIfMissing('mock_recalls', 'checklist_revision', 'TEXT');
  addColumnIfMissing('mock_recalls', 'custom_data', 'TEXT');
  // Which of the SOP's four tracking procedures this exercise walked. Recorded
  // rather than assumed — an ingredient trace and a finished-good trace are
  // different exercises and prove different things.
  addColumnIfMissing('mock_recalls', 'tracking_procedure', 'TEXT');

  /**
   * Equipment documents — the manual, the spec sheet, the parts list.
   *
   * Stored in R2 like course materials and comms attachments (a manual PDF is
   * far too big for the data volume), with the text pulled out on upload so a
   * search can find a part number printed INSIDE the file. `extracted_text` is
   * searched, never shipped to the client — it is megabytes of OCR and nobody
   * reads it directly.
   */
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_files (
        id TEXT PRIMARY KEY,
        equipment_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'manual',
        title TEXT,
        filename TEXT NOT NULL,
        content_type TEXT,
        size INTEGER,
        storage_key TEXT NOT NULL,
        extracted_text TEXT,
        text_status TEXT NOT NULL DEFAULT 'pending',
        uploaded_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (equipment_id) REFERENCES equipment(id)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_equipment_files_equipment ON equipment_files(equipment_id)');
  } catch (e) {
    console.warn('[db] equipment_files unavailable:', e.message);
  }

  /**
   * Evidence attached to a quality event.
   *
   * A deviation, a non-conformance, an on-hold record — the investigation is
   * usually half photographs: the damaged pallet, the label that was wrong, the
   * lab slip, the supplier's email. Before this, the record described them and
   * the evidence lived in somebody's phone, which is exactly the gap an auditor
   * asking "show me" finds.
   *
   * Same shape and the same storage path as `equipment_files` and course
   * materials: R2 via `putStream`, text pulled out on upload so a search finds
   * a lot number printed INSIDE the PDF, and `extracted_text` is searched but
   * never shipped to the client.
   *
   * Deliberately its own table rather than a JSON column on `qms_records`: a
   * file has a storage key that must be purged on delete, and a blob inside a
   * record is not something a `DELETE` can clean up.
   */
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS qms_attachments (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        title TEXT,
        filename TEXT NOT NULL,
        content_type TEXT,
        size INTEGER,
        storage_key TEXT NOT NULL,
        extracted_text TEXT,
        text_status TEXT NOT NULL DEFAULT 'pending',
        uploaded_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (record_id) REFERENCES qms_records(id)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_qms_attachments_record ON qms_attachments(record_id)');
  } catch (e) {
    console.warn('[db] qms_attachments unavailable:', e.message);
  }

  /**
   * Setup steps marked NOT APPLICABLE for one machine.
   *
   * Not every step applies to every machine — nobody writes a work instruction
   * for switching on an A/C — and a checklist that can't be told so is one
   * people learn to ignore, which costs far more than the step it was nagging
   * about.
   *
   * A ROW, WITH A REASON AND A NAME, rather than a hidden flag: skipping a
   * setup step is a decision, and a decision with nobody's name on it is
   * indistinguishable from an oversight. The step stays visible on the
   * checklist reading "not applicable — <reason>", so it can be read and
   * reversed rather than vanishing.
   */
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_step_waivers (
        equipment_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        waived_by TEXT,
        waived_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (equipment_id, step_id),
        FOREIGN KEY (equipment_id) REFERENCES equipment(id)
      )
    `);
  } catch (e) {
    console.warn('[db] equipment_step_waivers unavailable:', e.message);
  }

  // Log Builder drafts — a supervised copy/edit/approve path in front of the
  // structure engine. The draft is the record of who proposed what and who
  // decided; applying happens through the same helpers the live editor uses.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS log_builder_drafts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('list','fields')),
        title TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
        created_by TEXT,
        submitted_at TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        review_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (e) {
    console.warn('[db] log_builder_drafts unavailable:', e.message);
  }

  addColumnIfMissing('equipment', 'asset_kind', "TEXT NOT NULL DEFAULT 'machine'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_equipment_asset_kind ON equipment(asset_kind)");
  try {
    const done = db.prepare("SELECT value FROM app_settings WHERE key = 'equipment_asset_kind_backfilled'").get();
    if (!done) {
      const n = db.prepare(
        `UPDATE equipment SET asset_kind = 'zone' WHERE type IN (${ZONE_TYPES.map(() => '?').join(',')})`,
      ).run(...ZONE_TYPES).changes;
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('equipment_asset_kind_backfilled', ?)")
        .run(new Date().toISOString());
      if (n) console.log(`[migrate] Classified ${n} equipment row(s) as zones (asset_kind)`);
    }
  } catch (e) {
    console.warn('[migrate] asset_kind backfill skipped:', e.message);
  }

  // Editable dropdown list for the Maintenance Sign In/Out item field, managed
  // in Settings. Seeded (in server.js) from the Tool Box Equipment List default.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
    // Group the dropdown by source list (Tool Box Equipment List / Equipment List).
    addColumnIfMissing('maintenance_items', 'category', 'TEXT');
  } catch (e) {
    console.warn('[db] maintenance_items unavailable:', e.message);
  }

  // Office Ops: supply ordering + time tracking (replaces the Monday boards).
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supply_orders (
        id TEXT PRIMARY KEY,
        item_name TEXT NOT NULL,
        qty REAL,
        uom TEXT,
        link TEXT,
        supplier TEXT,
        urgent INTEGER NOT NULL DEFAULT 0,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ordered','received','paid')),
        total REAL,
        eta TEXT,
        invoice_link TEXT,
        invoice_id TEXT,
        notes TEXT,
        requested_by TEXT,
        requested_by_id TEXT,
        submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_supply_orders_status ON supply_orders(status, submitted_at);
      CREATE TABLE IF NOT EXISTS supply_invoices (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        size INTEGER,
        content_type TEXT,
        supplier TEXT,
        invoice_date TEXT,
        total REAL,
        notes TEXT,
        uploaded_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS time_adjustments (
        id TEXT PRIMARY KEY,
        employee_name TEXT NOT NULL,
        employee_id TEXT,
        adjustment_type TEXT NOT NULL DEFAULT 'other' CHECK (adjustment_type IN ('absent','tardy_leave_early','other')),
        adjustment_date TEXT,
        message TEXT,
        message_en TEXT,
        details TEXT,
        submitted_by TEXT,
        submitted_by_id TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_time_adjustments_emp ON time_adjustments(employee_name, adjustment_date);
    `);
  } catch (e) {
    console.warn('[db] office ops tables unavailable:', e.message);
  }

  // Invoice content search: text pulled from the uploaded file (PDF text layer
  // or vision OCR). NULL = not yet indexed; '' = indexed, nothing extractable.
  addColumnIfMissing('supply_invoices', 'extracted_text', 'TEXT');

  // Payroll follow-through: once Marnee has reviewed an absence/tardy she still
  // has to enter it in ADP, per pay period. These columns track that last mile
  // so nothing silently misses payroll.
  addColumnIfMissing('time_adjustments', 'pay_period', 'TEXT');
  addColumnIfMissing('time_adjustments', 'adp_status', "TEXT DEFAULT 'pending'");
  addColumnIfMissing('time_adjustments', 'adp_entered_by', 'TEXT');
  addColumnIfMissing('time_adjustments', 'adp_entered_at', 'TEXT');
  // Pay periods run every two weeks from the 2026-07-19 period. Recompute any
  // row whose stored period isn't a period start date — that catches both new
  // rows and the semi-monthly labels used before this rule was confirmed.
  try {
    const rows = db.prepare("SELECT id, adjustment_date FROM time_adjustments WHERE adjustment_date IS NOT NULL AND (pay_period IS NULL OR pay_period NOT LIKE '____-__-__')").all();
    if (rows.length) {
      const anchor = Date.parse('2026-07-19T00:00:00Z');
      const upd = db.prepare('UPDATE time_adjustments SET pay_period = ? WHERE id = ?');
      const tx = db.transaction(() => {
        for (const r of rows) {
          const d = String(r.adjustment_date).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          const n = Math.floor((Date.parse(`${d}T00:00:00Z`) - anchor) / (14 * 86400000));
          upd.run(new Date(anchor + n * 14 * 86400000).toISOString().slice(0, 10), r.id);
        }
      });
      tx();
      console.log(`[db] Set biweekly pay periods on ${rows.length} time entries`);
    }
  } catch { /* table optional */ }

  // ── Finance: Accounts Payable / Accounts Receivable ────────────────────────
  // Jake's two ledgers, deliberately flat: one row per invoice, money in
  // dollars, status as a short vocabulary the KPI cards can add up. Attached
  // files live in finance_files (R2 like every other upload) and their text is
  // indexed so search covers what's inside the PDF.
  // The two QuickBooks mirror tables shipped with `qb_id NOT NULL`, which
  // assumed the API was the only way in. It isn't — an Intuit app review can
  // block it indefinitely, and a report export has to work regardless. SQLite
  // can't relax a NOT NULL in place, so the old shape is rebuilt. Guarded on
  // being EMPTY: these only ever fill from a QuickBooks pull, so anywhere the
  // pull has run this is a no-op rather than a data loss.
  for (const tbl of ['qbo_accounts', 'qbo_contacts']) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all();
      const qb = cols.find(c => c.name === 'qb_id');
      if (qb?.notnull === 1 && db.prepare(`SELECT COUNT(*) n FROM ${tbl}`).get().n === 0) {
        db.exec(`DROP TABLE ${tbl}`);
        console.log(`[migrate] Rebuilt ${tbl} so a spreadsheet import can fill it`);
      }
    } catch { /* table not created yet — the CREATE below makes the right shape */ }
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ap_invoices (
        id             TEXT PRIMARY KEY,
        vendor         TEXT NOT NULL,
        invoice_number TEXT,
        po_number      TEXT,
        invoice_date   TEXT,
        due_date       TEXT,
        terms          TEXT,
        category       TEXT,
        amount         REAL NOT NULL DEFAULT 0,
        amount_paid    REAL NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'awaiting_approval'
                       CHECK (status IN ('draft','awaiting_approval','approved','scheduled','paid','void')),
        approved_by    TEXT,
        approved_at    TEXT,
        paid_date      TEXT,
        payment_method TEXT,
        payment_ref    TEXT,
        notes          TEXT,
        file_id        TEXT,
        qb_id          TEXT,
        qb_synced_at   TEXT,
        created_by     TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ap_status ON ap_invoices(status, due_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_qb ON ap_invoices(qb_id) WHERE qb_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ar_invoices (
        id              TEXT PRIMARY KEY,
        customer        TEXT NOT NULL,
        invoice_number  TEXT,
        po_number       TEXT,
        invoice_date    TEXT,
        due_date        TEXT,
        terms           TEXT,
        amount          REAL NOT NULL DEFAULT 0,
        amount_received REAL NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'unbilled'
                        CHECK (status IN ('unbilled','sent','partial','paid','void')),
        sent_date       TEXT,
        paid_date       TEXT,
        notes           TEXT,
        file_id         TEXT,
        qb_id           TEXT,
        qb_synced_at    TEXT,
        created_by      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ar_status ON ar_invoices(status, due_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_qb ON ar_invoices(qb_id) WHERE qb_id IS NOT NULL;

      -- The Chart of Accounts as QuickBooks holds it. Copied out, not authored
      -- here: while QBO is still the system of record, an account edited in two
      -- places is worse than an account you have to go and read.
      CREATE TABLE IF NOT EXISTS qbo_accounts (
        id               TEXT PRIMARY KEY,
        -- Nullable: these rows arrive EITHER from the API (which supplies an
        -- id) or from a spreadsheet export (which does not). A report export
        -- has to be a first-class way in, because the API is gated behind an
        -- Intuit app review that may never clear.
        qb_id            TEXT,
        acct_number      TEXT,
        name             TEXT NOT NULL,
        fully_qualified  TEXT,
        account_type     TEXT,
        account_sub_type TEXT,
        classification   TEXT,
        parent_qb_id     TEXT,
        active           INTEGER NOT NULL DEFAULT 1,
        current_balance  REAL,
        description      TEXT,
        source           TEXT,
        external_id      TEXT,
        created_by       TEXT,
        synced_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Partial, so the many import rows with no QuickBooks id don't collide.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_accounts_qb ON qbo_accounts(qb_id) WHERE qb_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_accounts_ext ON qbo_accounts(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_qbo_accounts_type ON qbo_accounts(classification, account_type);

      -- Vendors and customers. One table with a kind, because they are the same
      -- shape here; the QuickBooks ids are namespaced per entity, so the unique
      -- key is (kind, qb_id) and never qb_id alone.
      CREATE TABLE IF NOT EXISTS qbo_contacts (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL CHECK (kind IN ('vendor','customer')),
        qb_id       TEXT,
        name        TEXT NOT NULL,
        company     TEXT,
        email       TEXT,
        phone       TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        balance     REAL,
        address     TEXT,
        source      TEXT,
        external_id TEXT,
        created_by  TEXT,
        synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_contacts_qb ON qbo_contacts(kind, qb_id) WHERE qb_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_contacts_ext ON qbo_contacts(external_id) WHERE external_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS finance_files (
        id             TEXT PRIMARY KEY,
        ledger         TEXT NOT NULL DEFAULT 'ap' CHECK (ledger IN ('ap','ar')),
        invoice_id     TEXT,
        filename       TEXT NOT NULL,
        storage_key    TEXT NOT NULL,
        size           INTEGER,
        content_type   TEXT,
        extracted_text TEXT,
        uploaded_by    TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_files_invoice ON finance_files(invoice_id);
    `);
  } catch (e) {
    console.warn('[db] finance tables unavailable:', e.message);
  }

  // ── Hours & spend (Marnee's payroll tracker, merged in) ───────────────────
  // One row per person per week (weeks run Sun–Sat). "Worked" is time on the
  // clock; PTO and holiday are paid time off; unpaid is unpaid absence. When
  // auto-fill is on, whatever is left up to the weekly target counts as paid
  // non-working time — which is the number payroll actually argues about.
  // The roster is the users table, so nobody maintains a second list.
  addColumnIfMissing('users', 'weekly_hours_target', 'REAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_hours (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        week_start    TEXT NOT NULL,
        worked        REAL NOT NULL DEFAULT 0,
        pto           REAL NOT NULL DEFAULT 0,
        holiday       REAL NOT NULL DEFAULT 0,
        unpaid        REAL NOT NULL DEFAULT 0,
        auto_fill     INTEGER NOT NULL DEFAULT 1,
        note          TEXT,
        updated_by    TEXT,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_hours_week ON employee_hours(user_id, week_start);
    `);
  } catch (e) {
    console.warn('[db] employee_hours unavailable:', e.message);
  }

  // ── Newsletter (Marnee) ───────────────────────────────────────────────────
  // Two layers on purpose. `newsletter_cards` are the living notes she adds to
  // all month — upcoming events, shout-outs, big news, stats. Pressing
  // "Build newsletter" snapshots them into a `newsletter_issues` row, so
  // editing the draft never disturbs the running notes, and an issue that went
  // out is a permanent record of exactly what was sent.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_cards (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL DEFAULT 'general',
        title      TEXT NOT NULL,
        body       TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS newsletter_issues (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        intro      TEXT,
        sections   TEXT NOT NULL DEFAULT '[]',
        status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared')),
        shared_at  TEXT,
        shared_by  TEXT,
        channel_id TEXT,
        message_id TEXT,
        pdf_key    TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS newsletter_images (
        id           TEXT PRIMARY KEY,
        issue_id     TEXT,
        filename     TEXT NOT NULL,
        storage_key  TEXT NOT NULL,
        content_type TEXT,
        size         INTEGER,
        uploaded_by  TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (e) {
    console.warn('[db] newsletter tables unavailable:', e.message);
  }

  // Controlled definitions — what Document Control has approved the app to
  // serve. Whole table in one CREATE with no migration columns on purpose:
  // an ALTER or an index naming a column added later is what kills a fresh
  // database at boot (see the migration-ordering note in CLAUDE.md).
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS controlled_definitions (
        id                TEXT PRIMARY KEY,
        scope             TEXT NOT NULL,
        key               TEXT NOT NULL,
        label             TEXT,
        approved_hash     TEXT,
        approved_snapshot TEXT,
        approved_at       TEXT,
        approved_by       TEXT,
        version           INTEGER NOT NULL DEFAULT 1,
        pending_hash      TEXT,
        pending_snapshot  TEXT,
        pending_seen_at   TEXT,
        pending_dcr_id    TEXT,
        rejected_at       TEXT,
        rejected_by       TEXT,
        rejected_reason   TEXT,
        status            TEXT NOT NULL DEFAULT 'approved',
        UNIQUE (scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_controlled_status ON controlled_definitions(status);
    `);
  } catch (e) {
    console.warn('[db] controlled_definitions unavailable:', e.message);
  }

  // Newsletter banner: either a built-in cover (server/newsletter-covers.js) or
  // an uploaded image. Added here, immediately after the CREATE above — a
  // column migration before its table is what kills a fresh database at boot.
  addColumnIfMissing('newsletter_issues', 'banner_cover', 'TEXT');
  addColumnIfMissing('newsletter_issues', 'banner_image_id', 'TEXT');

  // A newsletter is written once, in English, and read in whichever language
  // the EN/ES toggle is set to — the PDF renders in that language too. An
  // earlier pass stored a hand-kept Spanish half alongside the English one;
  // these columns are what's left of it.
  for (const col of ['title_es', 'intro_es', 'include_spanish']) {
    dropColumnIfPresent('newsletter_issues', col);
  }

  // The pay module briefly carried a static table of market bands by position,
  // imported from the workbook. It was already out of date there, and the
  // roster shows what people are actually paid, so it is gone rather than kept
  // as a second number to maintain.
  try { db.exec('DROP TABLE IF EXISTS pay_ranges'); } catch { /* fine if absent */ }

  // ── Pay tracking (admin only) ─────────────────────────────────────────────
  // The roster of who is paid what, and when they were last raised, replacing
  // the Pay Tracking workbook. Two deliberate omissions:
  //
  //  * Evaluations are NOT stored. A supervisor scores the rubric in the
  //    browser, has the conversation, and the scores and notes are gone when
  //    the form closes. Only `last_reviewed_at` is stamped, so the review
  //    clock resets without leaving a rating on anybody's file.
  //  * Rate history records what a rate was and when it changed, because a
  //    pay change is a durable business fact even when the evaluation behind
  //    it deliberately isn't.
  try {
    db.exec(`
      -- ── Company policies ──────────────────────────────────────────────
      -- The handbook side of the plant: PTO, grievance, conduct. Deliberately
      -- NOT the controlled-document registry — an SOP is a controlled record
      -- with a revision and Document Control approval, and mixing the two
      -- would put a policy PDF in front of an auditor asking for SOP 401.
      --
      -- visible_to_staff is the whole point of the module: most policies are
      -- for everyone, some are management-only, and that is a per-policy
      -- decision rather than a permission on the module.
      CREATE TABLE IF NOT EXISTS policies (
        id             TEXT PRIMARY KEY,
        code           TEXT,
        title          TEXT NOT NULL,
        category       TEXT,
        summary        TEXT,
        body           TEXT,
        storage_key    TEXT,
        filename       TEXT,
        content_type   TEXT,
        size           INTEGER,
        extracted_text TEXT,
        text_status    TEXT,
        status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
        visible_to_staff INTEGER NOT NULL DEFAULT 0,
        version        TEXT,
        effective_date TEXT,
        review_date    TEXT,
        owner          TEXT,
        created_by     TEXT,
        updated_by     TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status, visible_to_staff);

      CREATE TABLE IF NOT EXISTS pay_employees (
        id               TEXT PRIMARY KEY,
        user_id          TEXT,
        name             TEXT NOT NULL,
        team             TEXT,
        is_supervisor    INTEGER NOT NULL DEFAULT 0,
        pay_rate         REAL,
        hire_date        TEXT,
        last_increase_at TEXT,
        last_reviewed_at TEXT,
        pto_plan         TEXT,
        active           INTEGER NOT NULL DEFAULT 1,
        notes            TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_employees_name ON pay_employees(name);
      CREATE INDEX IF NOT EXISTS idx_pay_employees_user ON pay_employees(user_id);

      CREATE TABLE IF NOT EXISTS pay_rate_history (
        id           TEXT PRIMARY KEY,
        employee_id  TEXT NOT NULL,
        old_rate     REAL,
        new_rate     REAL,
        effective_at TEXT NOT NULL,
        changed_by   TEXT,
        note         TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pay_rate_history_emp ON pay_rate_history(employee_id, effective_at);

      -- Submitted pay evaluations. The plant's real flow is two reviews per
      -- operator (supervisor + Adam) combined, and Adam alone for supervisors,
      -- with the admin reading scores and notes BEFORE deciding an increase —
      -- which requires the review to exist somewhere the admin can read it.
      -- Scores/notes are visible only to admins and the reviewer themselves;
      -- no pay data is ever stored here.
      CREATE TABLE IF NOT EXISTS pay_reviews (
        id             TEXT PRIMARY KEY,
        employee_id    TEXT NOT NULL,
        reviewer_id    TEXT,
        reviewer_name  TEXT NOT NULL,
        review_date    TEXT NOT NULL,
        scores         TEXT NOT NULL DEFAULT '{}',
        total          INTEGER,
        recommendation TEXT,
        notes          TEXT,
        attendance_flag INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'open',
        resolved_by    TEXT,
        resolved_at    TEXT,
        resolution     TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pay_reviews_emp ON pay_reviews(employee_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pay_reviews_status ON pay_reviews(status);

      -- Who owes a review, and by when. Without this a supervisor has no way
      -- to know an evaluation is expected of them — the review cycle ran on
      -- somebody remembering to ask in person.
      CREATE TABLE IF NOT EXISTS pay_review_assignments (
        id          TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        due_date    TEXT,
        note        TEXT,
        status      TEXT NOT NULL DEFAULT 'open',
        assigned_by TEXT,
        review_id   TEXT,
        completed_at TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pay_assign_reviewer ON pay_review_assignments(reviewer_id, status);
      CREATE INDEX IF NOT EXISTS idx_pay_assign_emp ON pay_review_assignments(employee_id, status);
    `);
  } catch (e) {
    console.warn('[db] pay tracking tables unavailable:', e.message);
  }

  // ── Procurement & demand planning (Jake) ──────────────────────────────────
  // Reference data comes from his two workbooks: the combined BOMs drive parts
  // demand, the parts/pricing sheet drives sourcing, and samples track what's
  // being evaluated. Purchase orders are entered here.
  //
  // Scenarios are the "make a copy to edit" habit made safe: demand-plan rows
  // and POs carry a scenario_id (NULL = the live plan). Editing inside a
  // scenario never touches live numbers, reverting drops the scenario, and
  // applying copies it over live in one transaction.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS procurement_scenarios (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        note       TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT
      );

      CREATE TABLE IF NOT EXISTS procurement_parts (
        id             TEXT PRIMARY KEY,
        part_no        TEXT NOT NULL,
        description    TEXT,
        vendor         TEXT,
        price          REAL,
        current_price  REAL,
        moq            REAL,
        lead_time_days REAL,
        priority       REAL,
        mrp_updated    INTEGER DEFAULT 0,
        last_checked   TEXT,
        link           TEXT,
        notes          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_proc_parts_no ON procurement_parts(part_no);

      CREATE TABLE IF NOT EXISTS procurement_boms (
        id               TEXT PRIMARY KEY,
        bom_number       TEXT,
        bom_name         TEXT,
        product_number   TEXT NOT NULL,
        product_name     TEXT,
        group_number     TEXT,
        group_name       TEXT,
        part_no          TEXT NOT NULL,
        part_description TEXT,
        uom              TEXT,
        bom_qty          REAL NOT NULL DEFAULT 0,
        fill_weight      REAL NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_proc_boms_product ON procurement_boms(product_number);
      CREATE INDEX IF NOT EXISTS idx_proc_boms_part ON procurement_boms(part_no);

      CREATE TABLE IF NOT EXISTS procurement_demand (
        id             TEXT PRIMARY KEY,
        scenario_id    TEXT,
        product_number TEXT NOT NULL,
        product_name   TEXT,
        requested_qty  REAL NOT NULL DEFAULT 0,
        quarter        TEXT,
        notes          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_proc_demand_scenario ON procurement_demand(scenario_id, product_number);

      CREATE TABLE IF NOT EXISTS procurement_samples (
        id             TEXT PRIMARY KEY,
        item_name      TEXT NOT NULL,
        vendor         TEXT,
        status         TEXT,
        viable         TEXT,
        qc_approved    TEXT,
        quality_rank   REAL,
        demand_qty     REAL,
        price          REAL,
        moq            REAL,
        lead_time      TEXT,
        notes          TEXT,
        ordering_notes TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id            TEXT PRIMARY KEY,
        scenario_id   TEXT,
        po_number     TEXT,
        vendor        TEXT NOT NULL,
        part_no       TEXT,
        description   TEXT,
        qty           REAL NOT NULL DEFAULT 0,
        uom           TEXT,
        unit_price    REAL NOT NULL DEFAULT 0,
        order_date    TEXT,
        expected_date TEXT,
        received_date TEXT,
        status        TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('draft','open','confirmed','shipped','received','cancelled')),
        urgent        INTEGER NOT NULL DEFAULT 0,
        notes         TEXT,
        created_by    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_po_scenario ON purchase_orders(scenario_id, status);
    `);
    // Columns the Monday board carried that this table did not.
    //
    // `customer` / `customer_po` are on 245 of the 351 real rows: a great deal
    // of what is bought is bought against somebody else's job (ProDough, M4),
    // and folding that into a notes string would make "what is on order for
    // ProDough" unanswerable. `source_status` keeps Monday's own word for the
    // row verbatim — the CHECK here has six states and the board has seven,
    // so the mapping loses a distinction and this is what preserves it.
    //
    // `source` / `external_id` are what the universal importer upserts on;
    // without them a re-import doubles the board instead of updating it.
    // AFTER the CREATE above, never before — addColumnIfMissing ALTERs, and
    // PRAGMA table_info on a table that does not exist yet returns empty, so
    // the "missing" test passes and the ALTER throws on a fresh database.
    addColumnIfMissing('purchase_orders', 'customer', 'TEXT');
    addColumnIfMissing('purchase_orders', 'customer_po', 'TEXT');
    addColumnIfMissing('purchase_orders', 'bol', 'TEXT');
    addColumnIfMissing('purchase_orders', 'lead_time_days', 'INTEGER');
    addColumnIfMissing('purchase_orders', 'source_status', 'TEXT');
    addColumnIfMissing('purchase_orders', 'source', 'TEXT');
    addColumnIfMissing('purchase_orders', 'external_id', 'TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_po_external ON purchase_orders(external_id);');
  } catch (e) {
    console.warn('[db] procurement tables unavailable:', e.message);
  }

  // Meetings — management review, food safety team, production, safety.
  // The minutes are the record; the ACTIONS are work orders (meeting_actions
  // only holds the wording as minuted plus the link), so there is one task
  // list in this app and not two that disagree.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id            TEXT PRIMARY KEY,
        meeting_type  TEXT NOT NULL,
        title         TEXT NOT NULL,
        meeting_date  TEXT NOT NULL,
        start_time    TEXT,
        end_time      TEXT,
        location      TEXT,
        chair         TEXT,
        agenda        TEXT NOT NULL DEFAULT '[]',
        minutes       TEXT,
        attendees     TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','held','approved')),
        approved_by   TEXT,
        approved_at   TEXT,
        approval_note TEXT,
        previous_meeting_id TEXT,
        custom_data   TEXT,
        created_by    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date DESC);
      CREATE INDEX IF NOT EXISTS idx_meetings_type ON meetings(meeting_type, meeting_date DESC);

      CREATE TABLE IF NOT EXISTS meeting_actions (
        id            TEXT PRIMARY KEY,
        meeting_id    TEXT NOT NULL,
        description   TEXT NOT NULL,
        owner         TEXT,
        due_date      TEXT,
        work_order_id TEXT,
        carried_from  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_meeting_actions_meeting ON meeting_actions(meeting_id);
    `);
  } catch (e) {
    console.warn('[db] meetings tables unavailable:', e.message);
  }

  // Internal audits (Form 403-01). One row per audit, one row per checklist
  // item IN SCOPE — the sections not audited simply have no rows, which is
  // the honest version of the diagonal pen stroke on the paper form.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS internal_audits (
        id            TEXT PRIMARY KEY,
        audit_no      TEXT,
        checklist_code     TEXT NOT NULL DEFAULT 'Form 403-01',
        checklist_revision TEXT NOT NULL DEFAULT 'V1',
        focus_areas   TEXT,
        audit_date    TEXT NOT NULL,
        lead_auditor  TEXT,
        sections      TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress','completed')),
        summary       TEXT,
        signed_by     TEXT,
        signed_at     TEXT,
        completed_at  TEXT,
        custom_data   TEXT,
        created_by    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_internal_audits_date ON internal_audits(audit_date DESC);

      CREATE TABLE IF NOT EXISTS internal_audit_items (
        id          TEXT PRIMARY KEY,
        audit_id    TEXT NOT NULL,
        section     TEXT NOT NULL,
        item_key    TEXT NOT NULL,
        prompt      TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        result      TEXT CHECK (result IN ('c','nc','na')),
        comments    TEXT,
        capa_id     TEXT,
        answered_by TEXT,
        answered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_internal_audit_items_audit ON internal_audit_items(audit_id, sort_order);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_audit_items_key ON internal_audit_items(audit_id, item_key);
    `);
  } catch (e) {
    console.warn('[db] internal audit tables unavailable:', e.message);
  }

  // Fields carried over from the Monday boards these ledgers replace.
  // Provenance for the universal importer: which file a row came from and its
  // stable identity within it, so a re-import updates in place.
  for (const tbl of ['ap_invoices', 'ar_invoices']) {
    addColumnIfMissing(tbl, 'source', 'TEXT');
    addColumnIfMissing(tbl, 'external_id', 'TEXT');
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_ext ON ap_invoices(external_id) WHERE external_id IS NOT NULL;
           CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_ext ON ar_invoices(external_id) WHERE external_id IS NOT NULL;`);

  addColumnIfMissing('ap_invoices', 'priority', 'TEXT');
  addColumnIfMissing('ap_invoices', 'invoice_link', 'TEXT');
  addColumnIfMissing('ap_invoices', 'ach_link', 'TEXT');
  addColumnIfMissing('ap_invoices', 'pay_link', 'TEXT');
  addColumnIfMissing('ap_invoices', 'pay_confirmation', 'TEXT');
  addColumnIfMissing('ar_invoices', 'co_number', 'TEXT');
  addColumnIfMissing('ar_invoices', 'person', 'TEXT');
  addColumnIfMissing('ar_invoices', 'order_type', 'TEXT');
  addColumnIfMissing('ar_invoices', 'invoice_link', 'TEXT');
  addColumnIfMissing('ar_invoices', 'pay_confirmation', 'TEXT');

  // What was ON the invoice or PO, as a JSON array of
  // {description, quantity, unit_price, amount}.
  //
  // A JSON column rather than a `partner_document_lines` table because these
  // are only ever read WITH their document — never queried, summed or filtered
  // on their own. Same call as `production_entries.mo_lines`.
  //
  // The lines are a SUMMARY of what the document contained. `amount` on the
  // document stays the authority for the money; `lines_total` records what the
  // lines add up to so a short read is visible as a short read rather than a
  // summary that implies the invoice held less than it did.
  addColumnIfMissing('partner_documents', 'line_items', 'TEXT');
  addColumnIfMissing('partner_documents', 'lines_total', 'REAL');

  // Slack import: original message ts for idempotent re-imports.
  addColumnIfMissing('chat_messages', 'external_id', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_external ON chat_messages(channel_id, external_id)'); } catch { /* ignore */ }

  addColumnIfMissing('audit_log', 'actor_id', 'TEXT');
  addColumnIfMissing('audit_log', 'actor_role', 'TEXT');
  addColumnIfMissing('audit_log', 'actor_department', 'TEXT');
  addColumnIfMissing('audit_log', 'entity_label', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log(actor_id)'); } catch { /* ignore */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)'); } catch { /* ignore */ }
  backfillAuditActorIdentity();
  normalizeAuditActions();

  // Hot-path indexes added after the fact. task_group is now a primary filter
  // for the split department teams (operator-tasks, archive, missed-reports);
  // the partial index speeds the frequent "pending QA sign-off" scan.
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_group_status ON work_orders(task_group, status)'); } catch { /* ignore */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_clearance ON work_orders(clearance_required, clearance_status)'); } catch { /* ignore */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_production_entries_pending_qa ON production_entries(qa_signoff_by) WHERE qa_signoff_by IS NULL'); } catch { /* ignore */ }

  migrateEquipmentNotes();
  cleanEquipmentNames();
  archivePreSystemBacklog();
}

// Fill actor_id/role/department on historical audit rows by matching the stored
// actor name back to a current user. Idempotent — only touches rows still null.
function backfillAuditActorIdentity() {
  try {
    const rows = db.prepare(
      "SELECT DISTINCT actor FROM audit_log WHERE actor_id IS NULL AND actor IS NOT NULL AND actor != ''"
    ).all();
    if (rows.length === 0) return;
    const findUser = db.prepare('SELECT id, role, department FROM users WHERE LOWER(name) = LOWER(?)');
    const update = db.prepare(
      'UPDATE audit_log SET actor_id = ?, actor_role = ?, actor_department = ? WHERE actor = ? AND actor_id IS NULL'
    );
    let filled = 0;
    const tx = db.transaction(() => {
      for (const { actor } of rows) {
        const u = findUser.get(actor);
        if (u) filled += update.run(u.id, u.role, u.department, actor).changes;
      }
    });
    tx();
    if (filled > 0) console.log(`[migrate] Backfilled actor identity on ${filled} audit log rows`);
  } catch (e) {
    console.warn('[migrate] audit actor backfill:', e.message);
  }
}

// Normalize historical action verbs to the canonical set so old + new rows
// filter consistently. Idempotent — canonicalAction is stable on its output.
function normalizeAuditActions() {
  try {
    const rows = db.prepare('SELECT DISTINCT action FROM audit_log WHERE action IS NOT NULL').all();
    const update = db.prepare('UPDATE audit_log SET action = ? WHERE action = ?');
    let changed = 0;
    const tx = db.transaction(() => {
      for (const { action } of rows) {
        const canon = canonicalAction(action);
        if (canon !== action) changed += update.run(canon, action).changes;
      }
    });
    tx();
    if (changed > 0) console.log(`[migrate] Normalized action verbs on ${changed} audit log rows`);
  } catch (e) {
    console.warn('[migrate] audit action normalization:', e.message);
  }
}

// Go-live cutoff: work the team performed before the system was in real use
// was tracked on paper, not here. Recurring work orders the engine generated
// with due dates before this date are archived as not_applicable with an
// honest label, rather than sitting as a permanent "missed" backlog that
// drags audit-readiness metrics down. Idempotent — once archived, re-running
// touches zero rows, and no new pre-go-live work orders are ever created.
export const GO_LIVE_DATE = '2026-07-01';

function archivePreSystemBacklog() {
  const note = `Pre-system backlog: task predates go-live (${GO_LIVE_DATE}); handled on paper before this system was in use.`;
  const pending = db.prepare(
    "SELECT COUNT(*) as c FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue','missed')"
  ).get(GO_LIVE_DATE).c;
  if (pending === 0) return;

  const info = db.prepare(`
    UPDATE work_orders
    SET status = 'not_applicable',
        completed_by = COALESCE(NULLIF(completed_by, ''), 'system-migration'),
        completed_at = COALESCE(completed_at, due_date || 'T00:00:00'),
        notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' | ' || ? END,
        updated_at = datetime('now')
    WHERE due_date < ? AND status IN ('open','in_progress','overdue','missed')
  `).run(note, note, GO_LIVE_DATE);

  logAudit('system-migration', 'archive_pre_system_backlog', 'work_order', null,
    { go_live: GO_LIVE_DATE, archived: info.changes, reason: 'pre-system backlog — recorded on paper prior to go-live' }, null, null);
  console.log(`[migrate] Archived ${info.changes} pre-go-live work orders as not_applicable (pre-system backlog)`);
}

function cleanEquipmentNames() {
  const rows = db.prepare("SELECT id, name, asset_id FROM equipment WHERE name GLOB '[0-9]*'").all();
  if (rows.length === 0) return;
  const updateBoth = db.prepare("UPDATE equipment SET name = ?, asset_id = ?, updated_at = datetime('now') WHERE id = ?");
  const updateName = db.prepare("UPDATE equipment SET name = ?, updated_at = datetime('now') WHERE id = ?");
  let cleaned = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const match = row.name.match(/^(\d{1,4})\s+(.+)/);
      if (match) {
        const assetNum = match[1];
        const newName = match[2].trim();
        if (newName) {
          if (row.asset_id) {
            updateName.run(newName, row.id);
          } else {
            updateBoth.run(newName, assetNum, row.id);
          }
          cleaned++;
        }
      }
    }
  });
  tx();
  if (cleaned > 0) console.log(`[migrate] Cleaned ${cleaned} equipment names (moved # prefix to asset_id)`);
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

// Collapse the sprawling, per-entity action verbs into a small canonical set so
// the audit log's Action filter is meaningful. Only the redundant
// "<entity>_created/updated/deleted/…" patterns (whose noun already lives in
// entity_type) are folded; genuinely distinct domain verbs pass through as-is.
const ACTION_OVERRIDES = {
  qa_signoff: 'sign_off',
  verify_lockout: 'verify',
  release_lockout: 'release',
  import_coa_pdf: 'import',
  duplicate_day: 'duplicate',
  submit_public: 'submit',
  archive_pre_system_backlog: 'archive',
};
const ACTION_SUFFIXES = [
  ['_bulk_updated', 'bulk_update'],
  ['_bulk_imported', 'bulk_import'],
  ['_created', 'create'],
  ['_updated', 'update'],
  ['_deleted', 'delete'],
  ['_archived', 'archive'],
  // The other half of archive — a document put back into use. Without this
  // the pair reads as `archive` and `document_reinstated` in the same filter.
  ['_reinstated', 'reinstate'],
  ['_imported', 'import'],
  ['_approved', 'approve'],
];

export function canonicalAction(action) {
  if (!action) return action;
  const a = String(action).toLowerCase();
  if (ACTION_OVERRIDES[a]) return ACTION_OVERRIDES[a];
  for (const [suffix, verb] of ACTION_SUFFIXES) {
    if (a.endsWith(suffix)) return verb;
  }
  return a;
}

// `actor` accepts either a plain name (string) — legacy/system callers — or the
// authenticated user object ({ id, name, role, department }), which lets us
// persist a stable actor identity that survives a user being renamed and
// enables role/department filtering. `entityLabel` is an optional
// human-readable name for the affected record.
export function logAudit(actor, action, entityType, entityId, details, previousState, newState, entityLabel) {
  const db = getDb();
  let actorName, actorId = null, actorRole = null, actorDept = null;
  if (actor && typeof actor === 'object') {
    actorName = actor.name || 'unknown';
    actorId = actor.id || null;
    actorRole = actor.role || null;
    actorDept = actor.department || null;
  } else {
    actorName = actor || 'system';
  }
  db.prepare(`
    INSERT INTO audit_log (actor, actor_id, actor_role, actor_department, action, entity_type, entity_id, entity_label, details, previous_state, new_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorName,
    actorId,
    actorRole,
    actorDept,
    canonicalAction(action),
    entityType,
    entityId || null,
    entityLabel || null,
    details ? JSON.stringify(details) : null,
    previousState ? JSON.stringify(previousState) : null,
    newState ? JSON.stringify(newState) : null
  );
}
