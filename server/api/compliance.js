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

  const pmTotal = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status != 'not_applicable'").get(from, to).c;
  const pmCompleted = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('completed','not_applicable')").get(from, to).c;
  const pmRate = pmTotal > 0 ? ((pmCompleted / pmTotal) * 100) : 0;

  const overdueWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')").get(to).c;

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
  const lotoEquipWithoutProc = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status = 'active' AND id NOT IN (SELECT equipment_id FROM loto_procedures)").get().c;

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
    },
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

export default router;
