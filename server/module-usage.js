// Which parts of ReadyDoc are used — READ-ONLY (D-214, D-216). One definition, two callers:
// `npm run report:usage -- <db copy>` and Settings → Data & backup → Module usage.
// Every statement here is a SELECT on the connection it is handed; it writes nothing.
//
// Use is measured two ways per module, because neither alone is honest:
//   - ROWS: how many records its tables hold, and how many were dated on or after go-live.
//     Seeds and imports fill tables without anybody using the screen, so rows alone overstate use.
//   - PEOPLE: audit entries written by a person (not the system, a seeder, ReadyBot or a bot
//     token) against the module's record types, since go-live and in the last 90 days, and how
//     many different people. The verdict is decided on this.
// It also looks for two leftovers of the demo-era boot code (removed in D-215):
//   - completed work orders under Adam B. / Ricardo A. / Spencer R. with no audit entry by an
//     account. A real completion always has one, so that is the fingerprint of invented history.
//   - active accounts that still have a PIN and no password (claimable with the PIN). Names only.

// GO_LIVE_DATE in server/db.js; not imported, so the CLI opens no second connection.
export const GO_LIVE = '2026-07-01';
export const RECENT_DAYS = 90;

// Every module a person can reach (and the hidden or retired ones), with the tables it owns and
// the audit entity types its write paths log. A table shared by two modules is listed once, under
// the module that writes it.
export const MODULES = [
  // Floor
  ['Operator View / Task Center', 'Floor', ['work_orders', 'pm_schedules'], ['work_order', 'pm_schedule']],
  ['Production Log + My Day', 'Production', ['production_entries', 'production_day_logs', 'production_runs'], ['production_entry', 'production_day_log', 'eod_template', 'production_missed_report']],
  ['Production Schedule', 'Production', ['production_schedule'], ['production_schedule']],
  ['Receiving Log + checklist', 'Warehouse', ['receiving_log', 'receiving_checklists', 'receiving_lab_test_items'], ['receiving_record', 'receiving_checklist', 'receiving_lab_test_item']],
  ['Shipping inspection', 'Warehouse', ['shipping_inspections'], ['shipping_inspection', 'shipping_photo']],
  ['Film / pouch inspection', 'Warehouse', ['film_pouch_inspections'], ['film_inspection']],
  ['Sign In/Out (tools, knives, components)', 'Floor', ['maintenance_items'], ['maintenance_sign_out', 'component_sign_out', 'maintenance_items']],
  ['Equipment', 'Maintenance', ['equipment', 'equipment_files', 'equipment_step_waivers'], ['equipment', 'equipment_file']],
  ['Calibration + scale checks', 'Maintenance', ['calibration_instruments', 'calibration_records', 'scale_verifications', 'instrument_incidents'], ['calibration_instrument', 'calibration_record', 'calibration_certificate', 'scale_verification', 'instrument_incident']],
  ['Lockout / Tagout', 'Maintenance', ['loto_procedures', 'loto_executions'], ['loto_procedure', 'loto_execution']],
  ['Hygienic Design', 'Maintenance', ['design_verifications'], ['design_verification']],
  ['Old checklist API (/api/checklists)', 'Retired?', ['checklist_templates', 'checklist_instances', 'checklist_submissions'], ['checklist_template', 'checklist_instance', 'checklist_submission']],
  // Quality
  ['QA Review', 'Quality', [], ['qa_review_batch']],
  ['Sanitation + swab log', 'Quality', ['sanitation_records', 'sanitation_swabs', 'swab_log_entries', 'swab_stock_events'], ['sanitation_record', 'sanitation_reclean', 'swab_log', 'swab_stock']],
  ['Chemicals', 'Quality', ['approved_chemicals'], ['chemical']],
  ['COA / Lab Testing', 'Quality', ['coa_requests', 'coa_specifications', 'coa_files', 'coa_submissions'], ['coa_request', 'coa_requests', 'coa_specification', 'coa_file', 'coa_test_result', 'coa_test_results', 'coa_lab', 'coa_material_spec']],
  ['Quality Schedules + check records', 'Quality', ['quality_schedules', 'emp_samples', 'gmp_walkthroughs', 'banned_list_reviews', 'management_reviews', 'food_defense_challenges'], ['quality_schedule', 'emp_sample']],
  ['Food Safety Culture', 'Quality', ['culture_concerns', 'culture_checks'], ['culture_concern', 'culture_check', 'culture_settings']],
  ['Suppliers', 'Quality', ['suppliers', 'supplier_materials', 'supplier_qualifications', 'supplier_files', 'supplier_questionnaires', 'supplier_banned_checks'], ['supplier', 'supplier_file']],
  ['Quality events (deviation / NC / on hold) + all QMS forms', 'Quality', ['qms_records'], ['qms_record', 'deviation', 'non_conformance', 'on_hold', 'organoleptic', 'flavor_approval', 'qms_attachment']],
  ['CAPA / Complaints', 'Quality', ['capas', 'complaints'], ['capa', 'complaint']],
  ['Disposals', 'Quality', ['disposals'], ['disposal']],
  ['Mock Recall', 'Quality', ['mock_recalls'], ['mock_recall']],
  ['Retention Samples', 'Quality', ['retention_samples', 'retention_boxes'], ['retention_sample', 'retention_box']],
  ['Stability', 'Quality', ['stability_studies', 'stability_pulls', 'stability_justifications'], ['stability_study', 'stability_pull', 'stability_justification']],
  ['Meetings', 'Quality', ['meetings', 'meeting_actions'], ['meeting', 'meeting_action']],
  ['Internal Audits', 'Quality', ['internal_audits'], ['internal_audit']],
  ['Safety (evacuations, first aid)', 'Quality', ['evacuation_headcounts', 'first_aid_injuries'], ['evacuation_headcount', 'first_aid_injury']],
  ['QA Inspections (BP&G zones)', 'Quality', [], []], // its records are sanitation_records (group qa); counted there
  ['HACCP / preventive controls', 'Quality', ['haccp_ccps'], ['haccp_ccp']],
  ['Facility Map', 'Quality', ['facility_room_overrides'], ['facility_room']],
  ['Visitors', 'Office', ['visitor_visits', 'visitors'], ['visitor_visit', 'visitor_agreement']],
  // Document control
  ['Controlled Documents + Forms', 'Document Control', ['sop_documents', 'document_attachments', 'controlled_forms'], ['document', 'document_attachment', 'document_revision_batch', 'document_revision_item', 'controlled_form', 'form_numbering', 'form_gap']],
  ['Document Change Requests', 'Document Control', [], ['document_change_request']],
  ['Controlled Changes', 'Document Control', ['controlled_definitions'], ['controlled_definition']],
  ['Change Register', 'Document Control', ['change_requests', 'software_releases'], ['change_request']],
  ['Log Structure (Settings; the studio was retired, D-215)', 'Document Control', ['log_builder_drafts', 'custom_field_defs', 'app_list_options'], ['log_builder_draft', 'custom_field', 'app_list', 'app_list_option']],
  ['Training', 'Document Control', ['training_records', 'training_courses', 'training_test_attempts', 'training_practical_evaluations'], ['training', 'training_record', 'training_course', 'training_test_attempt', 'practical_evaluation']],
  ['Certifications', 'Document Control', ['certifications'], ['certification']],
  ['Org Chart', 'Document Control', ['org_positions'], ['org_position', 'org_chart']],
  // Product
  ['Products (catalog, specs, NFP)', 'Product', ['products', 'packaging_specs', 'nfp_versions', 'product_documents', 'flavor_codes'], ['product', 'packaging_spec', 'nfp', 'product_document', 'product_doc_slot', 'flavor_code', 'sensory_spec']],
  ['Artwork', 'Product', ['artwork_versions'], ['artwork']],
  // Office
  ['AP Drop', 'Office', ['ap_drops'], ['ap_drop']],
  ['Partner Reconciliation', 'Office', ['partner_documents', 'partner_settlements'], ['partner_document', 'partner_settlement', 'partner_account', 'partner_credit', 'partner_reminder', 'partner_review', 'partner_portal_token']],
  ['Reimbursements', 'Office', ['reimbursements'], ['reimbursement', 'reimbursement_batch', 'reimbursement_receipt']],
  ['AP / AR ledgers (hidden D-075)', 'Hidden', ['ap_invoices', 'ar_invoices', 'finance_files'], ['finance_file']],
  ['Banking (hidden D-075)', 'Hidden', ['bank_accounts', 'bank_transactions', 'bank_reconciliations'], ['bank_account', 'bank_transaction', 'bank_reconciliation']],
  ['QuickBooks (hidden D-075)', 'Hidden', ['qbo_accounts', 'qbo_contacts'], ['quickbooks_sync', 'quickbooks_discovery']],
  ['Requests / Supply Orders / standing lists', 'Office', ['supply_orders', 'supply_lists', 'supply_list_cycles', 'supply_invoices'], ['supply_order', 'supply_list', 'supply_list_cycle', 'supply_invoice', 'supply_suggestion']],
  ['Time Tracking / Hours', 'Office', ['time_adjustments', 'employee_hours'], ['time_adjustment', 'employee_hours', 'hours_exclusion']],
  ['Procurement & Demand', 'Office', ['purchase_orders', 'procurement_parts', 'procurement_scenarios'], ['purchase_order', 'procurement_scenario']],
  ['Newsletter', 'Office', ['newsletter_issues'], ['newsletter']],
  ['Pay Tracking', 'Office', ['pay_employees', 'pay_reviews', 'pay_review_assignments', 'pay_rate_history'], ['pay_employee', 'pay_review', 'pay_review_assignment', 'pay_action_recipients']],
  ['Policies', 'Office', ['policies', 'policy_acknowledgements'], ['policy', 'policy_acknowledgement']],
  ['Onboarding + employee documents', 'Office', ['onboarding_records', 'employee_documents'], ['onboarding', 'onboarding_file', 'employee_document', 'employee_document_template']],
  ['People (candidates)', 'Office', ['candidates'], ['candidate', 'candidate_file']],
  ["Danny's List (retired, D-215)", 'Retired', ['danny_items'], ['danny_item', 'danny_reply', 'danny_attachment']],
  // System
  ['Messages', 'System', ['chat_messages'], ['chat_message', 'chat_channel', 'chat_attachment', 'comms']],
  ['Flash Report', 'System', [], ['flash_report']],
  ['Ask AI / SMS to AI', 'System', [], ['ai', 'sms_query']],
  ['Bot API tokens', 'System', ['api_tokens'], ['api_token']],
  ['Kiosk keys', 'System', ['kiosk_tokens'], ['kiosk_token', 'kiosk_token_mode']],
  ['Auditor passes', 'System', ['auditor_passes'], ['auditor_pass']],
  ['Importer (files)', 'System', ['import_batches'], ['import_batch']],
  ['Request button (removed)', 'Retired', ['app_requests'], []],
];

// A person, as opposed to the machinery: the audit row names an account, or a name that is not one
// of the system's own (kiosk paths log the typed name with no id). Bot-token writes are a person's
// account but not a person at the screen, so they are excluded too.
const SYSTEM_ACTOR = `(actor IS NULL OR lower(actor) LIKE 'system%' OR lower(actor) IN ('readybot','seed','import','migration','scheduler','cron','backfill')
  OR lower(actor) LIKE '%seed%' OR lower(actor) LIKE '%import%' OR (details LIKE '%"via_token"%'))`;
// The demo scripts' three names. backfill-history.js also wrote audit rows under them with no
// actor id, which must not count as a person using the Task Center.
const FAKE_TECHS = ['Adam B.', 'Ricardo A.', 'Spencer R.'];
const FAKE_AUDIT = `(actor IN ('Adam B.','Ricardo A.','Spencer R.') AND actor_id IS NULL AND entity_type = 'work_order' AND action = 'complete')`;

export function moduleUsage(db) {
  const tableExists = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const DATE_COLS = ['created_at', 'performed_at', 'submitted_at', 'filed_at', 'received_date', 'date', 'timestamp'];
  function dateCol(t) {
    const cols = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
    return DATE_COLS.find(c => cols.has(c)) || null;
  }

  const hasActorId = db.prepare('PRAGMA table_info(audit_log)').all().some(c => c.name === 'actor_id');
  const personWhere = `NOT ${SYSTEM_ACTOR}${hasActorId ? ` AND NOT ${FAKE_AUDIT}` : ''}`;
  const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);

  function people(entities) {
    if (!entities.length) return { total: 0, since_go_live: 0, recent: 0, last: null, persons: 0, recent_persons: 0 };
    const ph = entities.map(() => '?').join(',');
    const base = `FROM audit_log WHERE entity_type IN (${ph}) AND ${personWhere}`;
    const r = db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN timestamp >= '${GO_LIVE}' THEN 1 ELSE 0 END) since_go_live,
        SUM(CASE WHEN timestamp >= '${since}' THEN 1 ELSE 0 END) recent,
        MAX(timestamp) last,
        COUNT(DISTINCT CASE WHEN timestamp >= '${GO_LIVE}' THEN COALESCE(actor_id, actor) END) persons,
        COUNT(DISTINCT CASE WHEN timestamp >= '${since}' THEN COALESCE(actor_id, actor) END) recent_persons ${base}`).get(...entities);
    return { total: r.total || 0, since_go_live: r.since_go_live || 0, recent: r.recent || 0, last: r.last, persons: r.persons || 0, recent_persons: r.recent_persons || 0 };
  }

  function rows(tables) {
    let total = 0, after = 0, newest = null; const missing = [];
    for (const t of tables) {
      if (!tableExists(t)) { missing.push(t); continue; }
      total += db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      const dc = dateCol(t);
      if (dc) {
        const r = db.prepare(`SELECT SUM(CASE WHEN ${dc} >= ? THEN 1 ELSE 0 END) a, MAX(${dc}) m FROM ${t}`).get(GO_LIVE);
        after += r.a || 0;
        if (r.m && (!newest || String(r.m) > newest)) newest = String(r.m);
      }
    }
    return { total, after, newest, missing };
  }

  // The verdict is about people at a screen. Rows alone never make a module "in use".
  function verdict(p, r, entities) {
    if (!entities.length) return 'n/a';
    if (p.since_go_live === 0) return r.after > 0 ? 'machine only' : 'never used';
    if (p.recent === 0) return 'dormant';
    if (p.recent < 10 || p.recent_persons < 2) return 'light';
    return 'in use';
  }

  const out = MODULES.map(([name, group, tables, entities]) => {
    const p = people(entities); const r = rows(tables);
    return { name, group, verdict: verdict(p, r, entities), ...p, rows: r.total, rows_since_go_live: r.after, newest_row: r.newest, missing_tables: r.missing.join(' ') };
  });

  const ORDER = ['never used', 'machine only', 'dormant', 'light', 'in use', 'n/a'];
  out.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  // The fake-history check. Counts only; nothing is changed.
  const fake = (() => {
    if (!tableExists('work_orders')) return null;
    const ph = FAKE_TECHS.map(() => '?').join(',');
    // Completed under a demo name with no audit entry by an account (a real completion always writes one).
    const wo = db.prepare(`SELECT COUNT(*) c, MIN(completed_at) first, MAX(completed_at) last,
        SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END) after_go_live FROM work_orders w
      WHERE status = 'completed' AND completed_by IN (${ph})
        AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'work_order' AND a.entity_id = w.id
                        ${hasActorId ? 'AND a.actor_id IS NOT NULL' : ''})`).get(GO_LIVE, ...FAKE_TECHS);
    const au = hasActorId ? db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${FAKE_AUDIT}`).get().c : null;
    return { work_orders: wo.c, first: wo.first, last: wo.last, after: wo.after_go_live || 0, audit_rows: au };
  })();

  // Active accounts still holding a PIN and no password: claimable by anyone who knows the PIN.
  const pinAccounts = (() => {
    const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
    if (!cols.has('pin') || !cols.has('password_hash')) return [];
    return db.prepare(`SELECT name, role, created_at FROM users WHERE is_active = 1 AND pin IS NOT NULL AND pin != ''
      AND (password_hash IS NULL OR password_hash = '') ORDER BY role = 'admin' DESC, name`).all();
  })();

  // Audit entity types nothing above claims — a module this report does not know about yet.
  const claimed = new Set(MODULES.flatMap(m => m[3]));
  const unclaimed = db.prepare(`SELECT entity_type, COUNT(*) c, MAX(timestamp) last FROM audit_log
    WHERE ${personWhere} AND timestamp >= ? GROUP BY entity_type ORDER BY c DESC`).all(GO_LIVE).filter(r => !claimed.has(r.entity_type));
  return { go_live: GO_LIVE, since, recent_days: RECENT_DAYS, modules: out, fake, pin_accounts: pinAccounts, unclaimed };
}

const COLS = ['group', 'name', 'verdict', 'since_go_live', 'recent', 'persons', 'recent_persons', 'last', 'rows', 'rows_since_go_live', 'newest_row'];
export function usageCsv(r) {
  const esc = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [COLS.join(','), ...r.modules.map(m => COLS.map(c => esc(m[c])).join(','))].join('\n');
}

// The text the CLI prints and the Settings page shows — one rendering, so the two cannot differ.
export function usageText(r, label) {
  const L = [];
  const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
  const num = (s, n) => String(s ?? '').padStart(n);
  L.push(`ReadyDoc module usage — ${label}`);
  L.push(`Go-live ${r.go_live}; "recent" = since ${r.since} (${r.recent_days} days). Read-only: nothing was written.`, '');
  L.push('Verdicts: never used = no person has written anything since go-live · machine only = rows appear but no');
  L.push('person wrote them (seeds, imports, generators) · dormant = used once, nothing in 90 days · light = under 10');
  L.push('actions or one person in 90 days · in use.', '');
  L.push(`${pad('Verdict', 13)}${pad('Module', 46)}${num('acts', 7)}${num('90d', 6)}${num('ppl', 5)}  ${pad('last by a person', 17)}${num('rows', 8)}${num('new', 7)}`);
  for (const m of r.modules) {
    L.push(`${pad(m.verdict, 13)}${pad(m.name, 46)}${num(m.since_go_live, 7)}${num(m.recent, 6)}${num(m.persons, 5)}  ${pad((m.last || '—').slice(0, 16), 17)}${num(m.rows, 8)}${num(m.rows_since_go_live, 7)}${m.missing_tables ? `  (no table: ${m.missing_tables})` : ''}`);
  }
  L.push('', 'acts = audit entries by a person since go-live · ppl = different people since go-live · rows = records held ·');
  L.push('new = records dated on or after go-live.');
  if (r.unclaimed.length) {
    L.push('', 'Record types people wrote that this report does not map to a module (add them to MODULES):');
    for (const u of r.unclaimed) L.push(`  ${pad(u.entity_type, 34)}${num(u.c, 7)}  last ${u.last}`);
  }
  const f = r.fake;
  L.push('', 'Invented maintenance history (the demo backfill removed in D-215):');
  if (!f) L.push('  no work_orders table.');
  else if (!f.work_orders) L.push('  none found. The demo script never ran on this database.');
  else {
    L.push(`  FOUND ${f.work_orders} completed work orders under ${FAKE_TECHS.join(' / ')} with no audit entry by an account,`);
    L.push(`  completed ${String(f.first).slice(0, 10)} to ${String(f.last).slice(0, 10)} (${f.after} of them on or after go-live), plus ${f.audit_rows ?? '?'} audit rows`);
    L.push('  under those names with no account. These match the demo backfill. Check a few by hand; if confirmed they are');
    L.push('  invented maintenance records: retire them (cancelled, with the reason), never delete, and keep them out of Team Activity.');
  }
  L.push('', 'Active accounts that still have a PIN and no password (claimable with the PIN):');
  if (!r.pin_accounts.length) L.push('  none.');
  else {
    for (const u of r.pin_accounts) L.push(`  ${u.name} (${u.role}, created ${String(u.created_at || '').slice(0, 10)})`);
    L.push('  Fix: give each a password, or clear its PIN, or deactivate it.');
  }
  return L.join('\n');
}
