import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

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
