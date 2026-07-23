import { Router } from 'express';
import AdmZip from 'adm-zip';
import { getDb } from '../db.js';
import { QMS_TYPES } from '../qms-config.js';
import { recleanRooms } from './sanitation.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// ── Critical Tracking (Audit Prep Phase 2) ───────────────────────────────────
// One aggregation for the program-health dashboard: every category returns a
// status (ok/warn/crit), a count, and the top offending items so the fix is
// one click away. Admin + supervisors.
router.get('/critical', (req, res) => {
  // Admins/supervisors always; others need an explicit 'critical-tracking'
  // grant in their Settings access map (shareable like any module).
  const ma = req.user?.module_access;
  const granted = ma && !Array.isArray(ma) && !!ma['critical-tracking'];
  if (!req.user || (!['admin', 'supervisor'].includes(req.user.role) && !granted)) {
    return res.status(403).json({ error: 'Critical Tracking is for admins, supervisors, or users granted access in Settings.' });
  }
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);
  const cats = {};

  // Overdue preventive maintenance / tasks
  const overdueWos = db.prepare(`
    SELECT wo.id, wo.title, wo.due_date, wo.task_group, e.name AS equipment_name
    FROM work_orders wo LEFT JOIN equipment e ON e.id = wo.equipment_id
    WHERE wo.status = 'open' AND wo.due_date < ? ORDER BY wo.due_date LIMIT 200`).all(today);
  cats.pm_overdue = {
    label: 'Overdue Tasks / PMs', module: 'pm', count: overdueWos.length,
    status: overdueWos.length === 0 ? 'ok' : overdueWos.length <= 5 ? 'warn' : 'crit',
    items: overdueWos.slice(0, 8).map(w => ({ title: `${w.title}${w.equipment_name ? ` — ${w.equipment_name}` : ''}`, detail: `${daysBetween(today, w.due_date)}d overdue · ${w.task_group || ''}` })),
  };

  // Unsigned required approvals per QMS type
  const pendingByType = [];
  try {
    const rows = db.prepare('SELECT record_type, record_number, record_date, approvals, paper_record, created_at FROM qms_records').all();
    const grouped = {};
    for (const r of rows) {
      if (r.paper_record) continue;
      const cfg = QMS_TYPES[r.record_type];
      const required = (cfg?.approvals || []).filter(a => a.required);
      if (!required.length) continue;
      let approvals = {};
      try { approvals = JSON.parse(r.approvals || '{}'); } catch { approvals = {}; }
      if (required.some(a => !approvals[a.key])) {
        (grouped[r.record_type] = grouped[r.record_type] || []).push(r);
      }
    }
    for (const [type, list] of Object.entries(grouped)) {
      const cfg = QMS_TYPES[type];
      const oldest = list.reduce((m, r) => Math.max(m, daysBetween(today, (r.record_date || r.created_at || today).slice(0, 10))), 0);
      pendingByType.push({ title: `${cfg?.label || type}: ${list.length} awaiting sign-off`, detail: `oldest ${oldest}d`, module: cfg?.moduleId });
    }
  } catch { /* table optional */ }
  const pendingTotal = pendingByType.reduce((s, p) => s + parseInt(p.title.match(/(\d+) awaiting/)?.[1] || 0, 10), 0);
  cats.approvals = {
    label: 'Records Awaiting Required Sign-off', module: null, count: pendingTotal,
    status: pendingTotal === 0 ? 'ok' : pendingTotal <= 10 ? 'warn' : 'crit',
    items: pendingByType,
  };

  // Open CAPAs with age
  let capas = [];
  try {
    capas = db.prepare("SELECT capa_number, title, date_issued, due_date FROM capas WHERE status != 'closed' ORDER BY date_issued").all();
  } catch { /* optional */ }
  const oldCapas = capas.filter(c => c.date_issued && daysBetween(today, c.date_issued) > 30);
  cats.capas = {
    label: 'Open CAPAs', module: 'capa', count: capas.length,
    status: capas.length === 0 ? 'ok' : oldCapas.length ? 'crit' : 'warn',
    items: capas.slice(0, 8).map(c => ({ title: `${c.capa_number} — ${c.title}`, detail: c.date_issued ? `open ${daysBetween(today, c.date_issued)}d${c.due_date ? ` · due ${c.due_date}` : ''}` : '' })),
  };

  // Product on hold
  let holds = [];
  try {
    holds = db.prepare("SELECT record_number, record_date, data FROM qms_records WHERE record_type = 'on_hold' AND status = 'on_hold' ORDER BY record_date").all();
  } catch { /* optional */ }
  cats.on_hold = {
    label: 'Product On Hold', module: 'on-hold', count: holds.length,
    status: holds.length === 0 ? 'ok' : 'warn',
    items: holds.slice(0, 8).map(h => { let d; try { d = JSON.parse(h.data || '{}'); } catch { d = {}; } return { title: `${h.record_number} — ${d.product || 'item'}${d.lot ? ` (Lot ${d.lot})` : ''}`, detail: h.record_date ? `held ${daysBetween(today, h.record_date)}d` : '' }; }),
  };

  // Certifications expiring/expired
  let certs = [];
  try { certs = db.prepare('SELECT person_name, cert_type, expiry_date FROM certifications WHERE expiry_date IS NOT NULL').all(); } catch { /* optional */ }
  const certAlerts = certs.map(c => ({ ...c, days: -daysBetween(today, c.expiry_date) }))
    .filter(c => c.days <= 30).sort((a, b) => a.days - b.days);
  cats.certs = {
    label: 'Certifications Expiring', module: 'certifications', count: certAlerts.length,
    status: certAlerts.some(c => c.days < 0) ? 'crit' : certAlerts.length ? 'warn' : 'ok',
    items: certAlerts.slice(0, 8).map(c => ({ title: `${c.person_name} — ${c.cert_type}`, detail: c.days < 0 ? `EXPIRED ${-c.days}d ago` : `expires in ${c.days}d` })),
  };

  // Calibration due/overdue
  let instruments = [];
  try { instruments = db.prepare("SELECT name, asset_number, next_due FROM calibration_instruments WHERE next_due IS NOT NULL AND status != 'retired'").all(); } catch { /* optional */ }
  const calAlerts = instruments.map(i => ({ ...i, days: -daysBetween(today, i.next_due) }))
    .filter(i => i.days <= 30).sort((a, b) => a.days - b.days);
  cats.calibration = {
    label: 'Calibration Due', module: 'calibration', count: calAlerts.length,
    status: calAlerts.some(i => i.days < 0) ? 'crit' : calAlerts.length ? 'warn' : 'ok',
    items: calAlerts.slice(0, 8).map(i => ({ title: `${i.name}${i.asset_number ? ` #${i.asset_number}` : ''}`, detail: i.days < 0 ? `OVERDUE ${-i.days}d` : `due in ${i.days}d` })),
  };

  // Flagged task issues still open
  const flagged = db.prepare(`
    SELECT wo.title, wo.issue_notes, wo.issue_flagged_by, wo.issue_flagged_at
    FROM work_orders wo WHERE wo.issue_flagged = 1 AND wo.status = 'open' ORDER BY wo.issue_flagged_at DESC LIMIT 50`).all();
  cats.issues = {
    label: 'Open Flagged Issues', module: 'pm', count: flagged.length,
    status: flagged.length === 0 ? 'ok' : 'warn',
    items: flagged.slice(0, 8).map(f => ({ title: f.title, detail: `${f.issue_flagged_by || ''} — ${(f.issue_notes || '').slice(0, 60)}` })),
  };

  // 72-hour re-clean attention
  let reclean = [];
  try { reclean = recleanRooms(db).filter(r => r.needs_attention); } catch { /* optional */ }
  cats.reclean = {
    label: '72h Re-clean Needed', module: 'sanitation', count: reclean.length,
    status: reclean.length === 0 ? 'ok' : 'warn',
    items: reclean.slice(0, 8).map(r => ({ title: r.room, detail: r.last_clean ? `last cleaned ${r.last_clean.slice(0, 10)}` : 'no clean on record' })),
  };

  const statuses = Object.values(cats).map(c => c.status);
  const overall = statuses.includes('crit') ? 'crit' : statuses.includes('warn') ? 'warn' : 'ok';
  res.json({ overall, generated_at: new Date().toISOString(), categories: cats });
});

// ── Full data backup ─────────────────────────────────────────────────────────
// Admin-only ZIP of every application table as CSV — the "if the tool ever
// crashes we still have every form and every check on paper" export. Secrets
// and machine-only tables (sessions, push subscriptions, embeddings, FTS
// shadows) are excluded; BLOB columns are dropped.
const BACKUP_EXCLUDE = /^(sqlite_|sessions$|chat_push_subscriptions$|chat_message_embeddings$|chat_messages_fts)/;
const csvCell = (v) => {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function buildBackupZip(db, generatedBy) {
  const zip = new AdmZip();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map(t => t.name).filter(n => !BACKUP_EXCLUDE.test(n));
  let total = 0;
  for (const table of tables) {
    let rows;
    try { rows = db.prepare(`SELECT * FROM "${table}"`).all(); } catch { continue; }
    const cols = rows.length ? Object.keys(rows[0]) : db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
    // Drop password/PIN columns from the users export.
    const keep = cols.filter(c => !/password|pin/i.test(c) || table !== 'users');
    const lines = [keep.join(',')];
    for (const r of rows) lines.push(keep.map(c => csvCell(r[c])).join(','));
    zip.addFile(`${table}.csv`, Buffer.from(lines.join('\r\n'), 'utf8'));
    total += rows.length;
  }
  zip.addFile('README.txt', Buffer.from(
    `Powder Ops ReadyDoc full data backup\nGenerated: ${new Date().toISOString()} by ${generatedBy}\n` +
    `${tables.length} tables, ${total} rows. Each CSV opens in Excel; JSON columns (data, procedure_steps, approvals) hold structured form contents.\n` +
    `Comms channels/messages/reactions are included as CSVs; chat attachment FILES live in R2 object storage (not in this zip).\n`, 'utf8'));
  return zip.toBuffer();
}

router.get('/export-all', requireRole('admin'), (req, res) => {
  const db = getDb();
  const name = `readydoc-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buildBackupZip(db, req.user.name));
});

// Stored automatic backups (weekly Friday job writes them to R2 under backups/).
router.get('/backups', requireRole('admin'), async (req, res) => {
  const db = getDb();
  let list;
  try { list = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'auto_backups'").get()?.value || '[]'); } catch { list = []; }
  const { presignGet } = await import('../storage.js');
  const out = [];
  for (const b of list) {
    const url = await presignGet(b.key, b.name).catch(() => null);
    out.push({ ...b, url });
  }
  res.json({ backups: out });
});

router.get('/dashboard', (_req, res) => {
  const db = getDb();
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const from = thirtyDaysAgo.toISOString().split('T')[0];
  const to = now.toISOString().split('T')[0];
  const sevenDaysOut = new Date(now);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const pmCutoff = yesterday.toISOString().split('T')[0];
  const pmTotal = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status != 'not_applicable'").get(from, pmCutoff).c;
  const pmCompleted = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('completed','not_applicable')").get(from, pmCutoff).c;
  const pmRate = pmTotal > 0 ? ((pmCompleted / pmTotal) * 100) : 0;

  const overdueWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')").get(to).c;
  const openWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE status IN ('open','in_progress')").get().c;
  const dueSoonWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('open','in_progress')").get(to, sevenDaysOut.toISOString().split('T')[0]).c;
  const clearancePending = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE clearance_required = 1 AND clearance_status = 'pending'").get().c;
  const sopReviewDue = db.prepare("SELECT COUNT(*) as c FROM sop_documents WHERE status != 'archived' AND review_due <= ?").get(to).c;

  const calTotal = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE status != 'retired'").get().c;
  const calOverdue = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due < ? AND status != 'retired'").get(to).c;
  const calDueSoon = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due BETWEEN ? AND ? AND status != 'retired'").get(to, sevenDaysOut.toISOString().split('T')[0]).c;

  const checklistSubmissions = db.prepare('SELECT COUNT(*) as c FROM checklist_submissions WHERE submitted_at >= ?').get(from).c;
  const checklistFails = db.prepare("SELECT COUNT(*) as c FROM checklist_submissions WHERE submitted_at >= ? AND overall_status = 'fail'").get(from).c;

  const sanitationTotal = db.prepare('SELECT COUNT(*) as c FROM sanitation_records WHERE performed_at >= ?').get(from).c;
  const sanitationFails = db.prepare("SELECT COUNT(*) as c FROM sanitation_records WHERE performed_at >= ? AND result = 'fail'").get(from).c;

  const foodContactEquipment = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE is_food_contact = 1 AND status = 'active'").get().c;

  const recentActivity = db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 10').all();

  const upcomingWOs = db.prepare(`
    SELECT wo.*, e.name as equipment_name FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.due_date BETWEEN ? AND ? AND wo.status IN ('open','in_progress')
    ORDER BY wo.due_date ASC LIMIT 10
  `).all(to, sevenDaysOut.toISOString().split('T')[0]);

  // Audit readiness extras
  const chemTotal = db.prepare("SELECT COUNT(*) as c FROM approved_chemicals WHERE is_active = 1").get().c;
  const chemMissingSDS = db.prepare("SELECT COUNT(*) as c FROM approved_chemicals WHERE is_active = 1 AND sds_url IS NULL AND sds_number IS NULL").get().c;

  const calByStatus = db.prepare("SELECT status, COUNT(*) as c FROM calibration_instruments WHERE status != 'retired' GROUP BY status").all();

  const lotoTotal = db.prepare("SELECT COUNT(*) as c FROM loto_procedures").get().c;
  const lotoEquipWithoutProc = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status = 'active' AND loto_required = 1 AND id NOT IN (SELECT equipment_id FROM loto_procedures)").get().c;

  const flaggedIssues = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE issue_flagged = 1 AND status IN ('open','in_progress','overdue')").get().c;

  const monthlyPM = db.prepare(`
    SELECT strftime('%Y-%m', due_date) as month,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed
    FROM work_orders WHERE due_date BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', due_date) ORDER BY month
  `).all(from, to);

  const sanitationTrend = db.prepare(`
    SELECT strftime('%Y-%m', performed_at) as month,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) as passed
    FROM sanitation_records WHERE performed_at >= ?
    GROUP BY strftime('%Y-%m', performed_at) ORDER BY month
  `).all(from);

  const totalAuditRecords = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE timestamp >= ?').get(from).c;

  res.json({
    period: { from, to },
    pm: {
      total: pmTotal,
      completed: pmCompleted,
      completion_rate: parseFloat(pmRate.toFixed(1)),
      meets_sqf_target: pmRate >= 95,
      overdue: overdueWOs,
      open: openWOs,
      due_soon: dueSoonWOs,
    },
    clearance_pending: clearancePending,
    sop_review_due: sopReviewDue,
    calibration: {
      total_instruments: calTotal,
      overdue: calOverdue,
      due_within_7_days: calDueSoon,
      by_status: calByStatus,
    },
    checklists: {
      submissions_30d: checklistSubmissions,
      failures_30d: checklistFails,
      pass_rate: checklistSubmissions > 0 ? parseFloat(((1 - checklistFails / checklistSubmissions) * 100).toFixed(1)) : 100,
    },
    sanitation: {
      records_30d: sanitationTotal,
      failures_30d: sanitationFails,
      pass_rate: sanitationTotal > 0 ? parseFloat(((1 - sanitationFails / sanitationTotal) * 100).toFixed(1)) : 100,
      monthly_trend: sanitationTrend,
    },
    chemicals: {
      total_approved: chemTotal,
      missing_sds: chemMissingSDS,
    },
    loto: {
      total_procedures: lotoTotal,
      equipment_without_procedure: lotoEquipWithoutProc,
    },
    flagged_issues: flaggedIssues,
    food_contact_equipment: foodContactEquipment,
    upcoming_work_orders: upcomingWOs,
    recent_activity: recentActivity,
    monthly_pm: monthlyPM,
    total_audit_records: totalAuditRecords,
  });
});

router.get('/audit-ready', (_req, res) => {
  const db = getDb();
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const from = yearAgo.toISOString().split('T')[0];
  const to = now.toISOString().split('T')[0];

  const monthlyPM = db.prepare(`
    SELECT strftime('%Y-%m', due_date) as month,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM work_orders WHERE due_date BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', due_date) ORDER BY month
  `).all(from, to);

  const criticalCalHistory = db.prepare(`
    SELECT ci.name, ci.serial_number, cr.calibrated_at, cr.result, cr.calibrated_by, cr.certificate_number
    FROM calibration_records cr
    JOIN calibration_instruments ci ON cr.instrument_id = ci.id
    WHERE ci.is_critical_control = 1 AND cr.calibrated_at >= ?
    ORDER BY ci.name, cr.calibrated_at
  `).all(from);

  const lubricantRecords = db.prepare(`
    SELECT wo.completed_at, wo.title, e.name as equipment_name, wo.lubricant_used, wo.lubricant_is_food_grade, wo.completed_by
    FROM work_orders wo JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.lubricant_used IS NOT NULL AND wo.completed_at >= ?
    ORDER BY wo.completed_at DESC
  `).all(from);

  const haccpCoverage = db.prepare(`
    SELECT c.id, c.name, c.critical_limits,
      (SELECT COUNT(*) FROM equipment WHERE haccp_ccp_id = c.id) as equipment_count,
      (SELECT COUNT(*) FROM pm_schedules WHERE haccp_ccp_id = c.id) as pm_count,
      (SELECT COUNT(*) FROM calibration_instruments WHERE haccp_ccp_id = c.id) as instrument_count
    FROM haccp_ccps c ORDER BY c.name
  `).all();

  const sanitationTrend = db.prepare(`
    SELECT strftime('%Y-%m', performed_at) as month,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) as passed
    FROM sanitation_records WHERE performed_at >= ?
    GROUP BY strftime('%Y-%m', performed_at) ORDER BY month
  `).all(from);

  const totalAuditRecords = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE timestamp >= ?').get(from).c;

  res.json({
    period: { from, to },
    monthly_pm: monthlyPM,
    critical_calibration_history: criticalCalHistory,
    lubricant_records: lubricantRecords,
    haccp_coverage: haccpCoverage,
    sanitation_trend: sanitationTrend,
    total_audit_trail_records: totalAuditRecords,
    generated_at: new Date().toISOString(),
  });
});

router.get('/notifications', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenOut = sevenDaysOut.toISOString().split('T')[0];

  const overdueWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')").get(today).c;
  const dueSoonWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('open','in_progress')").get(today, sevenOut).c;
  const clearancePending = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE clearance_required = 1 AND clearance_status = 'pending'").get().c;
  const calOverdue = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due < ? AND status != 'retired'").get(today).c;
  const calDueSoon = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due BETWEEN ? AND ? AND status != 'retired'").get(today, sevenOut).c;
  const lotoUncovered = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status = 'active' AND loto_required = 1 AND id NOT IN (SELECT equipment_id FROM loto_procedures)").get().c;
  const chemMissingSDS = db.prepare("SELECT COUNT(*) as c FROM approved_chemicals WHERE is_active = 1 AND sds_url IS NULL AND sds_number IS NULL").get().c;
  const flaggedIssues = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE issue_flagged = 1 AND status IN ('open','in_progress','overdue')").get().c;
  const sopReviewDue = db.prepare("SELECT COUNT(*) as c FROM sop_documents WHERE status != 'archived' AND review_due <= ?").get(today).c;
  let pendingQA = 0;
  try { pendingQA = db.prepare("SELECT COUNT(*) as c FROM production_entries WHERE qa_signoff_by IS NULL").get().c; } catch {}

  // Pending in-system approvals across the QMS logs + disposals + COA, routed
  // to the people who can act on them (QA / Document Control / supervisors /
  // admins) so nothing sits isolated inside a module.
  const role = req.user?.role, dept = req.user?.department;
  const isApprover = role === 'admin' || role === 'supervisor' || ['qa', 'document_control'].includes(dept);
  let qmsPending = [], disposalsPending = 0, coaPending = 0;
  if (isApprover) {
    try {
      const rows = db.prepare('SELECT record_type, approvals, paper_record FROM qms_records').all();
      const counts = {};
      for (const r of rows) {
        if (r.paper_record) continue;
        const cfg = QMS_TYPES[r.record_type];
        const required = (cfg?.approvals || []).filter(a => a.required);
        if (!required.length) continue;
        let approvals = {};
        try { approvals = JSON.parse(r.approvals || '{}'); } catch { approvals = {}; }
        if (required.some(a => !approvals[a.key])) counts[r.record_type] = (counts[r.record_type] || 0) + 1;
      }
      qmsPending = Object.entries(counts).map(([type, c]) => ({ type, count: c, cfg: QMS_TYPES[type] }));
    } catch { /* table optional */ }
    try {
      const drows = db.prepare('SELECT approvals, paper_record FROM disposals').all();
      disposalsPending = drows.filter(d => {
        if (d.paper_record) return false;
        let a; try { a = JSON.parse(d.approvals || '{}'); } catch { a = {}; }
        return !a.ops_manager || !a.quality_control;
      }).length;
    } catch { /* table optional */ }
    try { coaPending = db.prepare("SELECT COUNT(*) as c FROM coa_requests WHERE status IN ('pending','sent')").get().c; } catch { /* optional */ }
  }

  const items = [];
  if (overdueWOs > 0) items.push({ id: 'pm-overdue', tab: 'pm', severity: 'critical', label: `${overdueWOs} overdue PM work order${overdueWOs > 1 ? 's' : ''}` });
  if (dueSoonWOs > 0) items.push({ id: 'pm-due-soon', tab: 'pm', severity: 'warning', label: `${dueSoonWOs} PM work order${dueSoonWOs > 1 ? 's' : ''} due within 7 days` });
  if (clearancePending > 0) items.push({ id: 'clearance', tab: 'pm', severity: 'warning', label: `${clearancePending} hygiene clearance${clearancePending > 1 ? 's' : ''} awaiting QA sign-off` });
  if (calOverdue > 0) items.push({ id: 'cal-overdue', tab: 'calibration', severity: 'critical', label: `${calOverdue} calibration${calOverdue > 1 ? 's' : ''} overdue` });
  if (calDueSoon > 0) items.push({ id: 'cal-due-soon', tab: 'calibration', severity: 'info', label: `${calDueSoon} calibration${calDueSoon > 1 ? 's' : ''} due within 7 days` });
  if (lotoUncovered > 0) items.push({ id: 'loto-uncovered', tab: 'loto', severity: 'warning', label: `${lotoUncovered} equipment missing LOTO procedure${lotoUncovered > 1 ? 's' : ''}` });
  if (chemMissingSDS > 0) items.push({ id: 'chem-sds', tab: 'chemicals', severity: 'warning', label: `${chemMissingSDS} chemical${chemMissingSDS > 1 ? 's' : ''} missing SDS documentation` });
  if (flaggedIssues > 0) items.push({ id: 'flagged', tab: 'pm', severity: 'critical', label: `${flaggedIssues} flagged issue${flaggedIssues > 1 ? 's' : ''} requiring attention` });
  if (sopReviewDue > 0) items.push({ id: 'sop-review', tab: 'sops', severity: 'info', label: `${sopReviewDue} SOP${sopReviewDue > 1 ? 's' : ''} past review date` });
  if (pendingQA > 0) items.push({ id: 'production-qa', tab: 'production-log', severity: 'warning', label: `${pendingQA} production entr${pendingQA > 1 ? 'ies' : 'y'} pending QA sign-off` });
  for (const q of qmsPending) {
    items.push({ id: `qms-approval-${q.type}`, tab: q.cfg?.moduleId || 'deviations', severity: 'warning', label: `${q.count} ${q.cfg?.label || q.type} record${q.count > 1 ? 's' : ''} awaiting approval` });
  }
  if (disposalsPending > 0) items.push({ id: 'disposal-approvals', tab: 'disposals', severity: 'warning', label: `${disposalsPending} disposal${disposalsPending > 1 ? 's' : ''} awaiting Ops/QA sign-off` });
  if (coaPending > 0) items.push({ id: 'coa-pending', tab: 'coa', severity: 'info', label: `${coaPending} lab request${coaPending > 1 ? 's' : ''} awaiting results` });

  // 72-hour idle rule: applicable rooms needing a re-clean that nobody has
  // handled yet (not dismissed / N-A'd / assigned) badge the Sanitation module.
  try {
    const flagged = recleanRooms(db).filter(r => r.needs_attention).length;
    if (flagged > 0) items.push({ id: 'sanitation-reclean', tab: 'sanitation', severity: 'warning', label: `${flagged} room${flagged > 1 ? 's' : ''} need${flagged > 1 ? '' : 's'} re-cleaning (72h rule / used since clean)` });
  } catch { /* optional tables */ }

  const badges = {};
  for (const item of items) {
    if (item.severity === 'critical' || item.severity === 'warning') {
      badges[item.tab] = (badges[item.tab] || 0) + 1;
    }
  }

  // Production Schedule "New/Updated" notice: a text pill on the Schedule tab
  // that persists per-user until they open the schedule. Raised by an admin
  // pressing Notify (see production.js), cleared by opening the tab.
  let scheduleNotice = null;
  try {
    const notifiedAt = db.prepare("SELECT value FROM app_settings WHERE key = 'schedule_notified_at'").get()?.value || null;
    if (notifiedAt) {
      const kind = db.prepare("SELECT value FROM app_settings WHERE key = 'schedule_notify_kind'").get()?.value || 'updated';
      let seenAt = null;
      if (req.user?.id) seenAt = db.prepare('SELECT schedule_seen_at FROM users WHERE id = ?').get(req.user.id)?.schedule_seen_at || null;
      const unseen = !seenAt || notifiedAt > seenAt;
      scheduleNotice = { unseen, kind, notified_at: notifiedAt };
    }
  } catch { /* app_settings/column may not exist yet */ }

  res.json({ items, badges, scheduleNotice, total: items.filter(i => i.severity === 'critical' || i.severity === 'warning').length });
});

export default router;
