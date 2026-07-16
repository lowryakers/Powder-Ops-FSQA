import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'compliance.db');

let db;

export function getDbPath() {
  return DB_PATH;
}

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

function runMigrations() {
  addColumnIfMissing('calibration_instruments', 'room', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'asset_number', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'max_capacity', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'department', 'TEXT');
  addColumnIfMissing('calibration_instruments', 'notes', 'TEXT');
  addColumnIfMissing('work_orders', 'attachments', "TEXT DEFAULT '[]'");
  addColumnIfMissing('equipment', 'maintenance_tasks', "TEXT DEFAULT '{}'");
  addColumnIfMissing('users', 'department', "TEXT DEFAULT 'warehouse'");
  addColumnIfMissing('pm_schedules', 'task_group', "TEXT DEFAULT 'warehouse'");
  addColumnIfMissing('work_orders', 'task_group', "TEXT DEFAULT 'warehouse'");

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
  // Mark area/zone types as not requiring LOTO
  const areaTypes = ['Inspection Zone', 'Light Fixture Zone', 'Cleaning Zone', 'Monitoring'];
  const alreadyTagged = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE loto_required = 0").get().c;
  if (alreadyTagged === 0) {
    db.prepare(`UPDATE equipment SET loto_required = 0 WHERE type IN (${areaTypes.map(() => '?').join(',')})`).run(...areaTypes);
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
  addColumnIfMissing('training_tests', 'sop_revision', 'TEXT');
  addColumnIfMissing('sop_documents', 'training_revision', 'TEXT');
  addColumnIfMissing('sop_versions', 'minor', 'INTEGER NOT NULL DEFAULT 0');

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
  `);

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

  // Editable dropdown list for the Maintenance Sign In/Out item field, managed
  // in Settings. Seeded (in server.js) from the Tool Box Equipment List default.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
  } catch (e) {
    console.warn('[db] maintenance_items unavailable:', e.message);
  }

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
const GO_LIVE_DATE = '2026-07-01';

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
