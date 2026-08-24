import { Router } from 'express';
import AdmZip from 'adm-zip';
import { equipmentReadiness } from '../equipment-readiness.js';
import { getDb, logAudit } from '../db.js';
import { QMS_TYPES } from '../qms-config.js';
import { recleanRooms } from './sanitation.js';
import { requireRole } from '../middleware/auth.js';
import { hasExplicitGrant } from '../module-access.js';
import { readinessReview } from '../audit-readiness.js';
// One definition of "waiting on a signature" — see the sign-out badge note below.
import { getSource, safeCount } from '../qa-review.js';
// One definition of "completed PM" — the dashboard, the Task Center and the
// auditor binder all read it from here.
import { pmCompletion } from '../pm-completion.js';

const router = Router();

// ── What the auditor binder shows ────────────────────────────────────────────
//
// Some evidence is genuinely not ready to be shown from the app — right now the
// controlled documents and the change-request log, which the plant is still
// working from paper for. Hiding those has to be a SETTING and not a code edit,
// because "temporarily" means somebody has to be able to put them back without
// a deploy, and the person who decides that is not the person who deploys.
//
// This hides SECTIONS OF THE BINDER, not records. Nothing is deleted, no log is
// filtered, and every other route still returns exactly what it returned
// before — an admin, QA and Document Control all still see the registry in the
// operating app. It is a statement about which evidence the plant is presenting
// from the system this time round, which is the plant's call to make.
const BINDER_SECTION_IDS = ['documents', 'dcr', 'process-maps'];
const BINDER_HIDDEN_KEY = 'auditor_binder_hidden';

function binderHidden(db) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BINDER_HIDDEN_KEY);
    const parsed = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(parsed) ? parsed.filter(id => BINDER_SECTION_IDS.includes(id)) : [];
  } catch { return []; }
}

// The plant is presenting controlled documents and the change log on paper this
// audit, so those two start HIDDEN. Written ONCE, behind its own marker, and
// never again: the moment somebody turns a section back on, that is a decision,
// and a seeder that re-applied the default on the next deploy would quietly
// undo it. Same rule as every other seeder here — a redeploy must not overwrite
// what a person set by hand.
export function seedAuditorBinderDefaults(db) {
  try {
    const MARKER = 'auditor_binder_defaults_v1';
    if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(MARKER)) return;
    const set = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    // Only if nothing has been chosen yet — an instance where somebody already
    // set this keeps what they set.
    if (!db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(BINDER_HIDDEN_KEY)) {
      set.run(BINDER_HIDDEN_KEY, JSON.stringify(['documents', 'dcr']));
      console.log('[compliance] Auditor binder: controlled documents and DCRs start hidden');
    }
    set.run(MARKER, new Date().toISOString());
  } catch (err) {
    console.warn('[compliance] Auditor binder defaults skipped:', err.message);
  }
}

// Read is open to any signed-in user because the auditor themselves has to
// fetch it to render their own binder, and it says nothing an auditor could not
// already see by looking at the page.
router.get('/binder', (_req, res) => {
  res.json({ sections: BINDER_SECTION_IDS, hidden: binderHidden(getDb()) });
});

router.put('/binder', requireRole('admin'), (req, res) => {
  const db = getDb();
  const raw = Array.isArray(req.body?.hidden) ? req.body.hidden : [];
  const unknown = raw.filter(id => !BINDER_SECTION_IDS.includes(id));
  if (unknown.length) return res.status(400).json({ error: `Unknown binder section: ${unknown.join(', ')}` });
  const hidden = BINDER_SECTION_IDS.filter(id => raw.includes(id)); // normalised order, deduplicated
  const before = binderHidden(db);
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(BINDER_HIDDEN_KEY, JSON.stringify(hidden));
  logAudit(req.user, 'update', 'auditor_binder', BINDER_HIDDEN_KEY,
    { hidden }, { hidden: before }, { hidden }, 'Auditor binder sections');
  res.json({ sections: BINDER_SECTION_IDS, hidden });
});

// ── Critical Tracking (Audit Prep Phase 2) ───────────────────────────────────
// One aggregation for the program-health dashboard: every category returns a
// status (ok/warn/crit), a count, and the top offending items so the fix is
// one click away. Admin + supervisors.
// Shared by the /critical route and the daily red-alert job in
// scheduled-jobs.js, so what the dashboard shows and what QA gets pinged
// about can never drift apart.
export function computeCritical(db) {
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
  // out_of_service excluded like retired: an instrument marked not in use has
  // no calibration owing — counting it is how "2 due" sits on the bell forever.
  try { instruments = db.prepare("SELECT name, asset_number, next_due FROM calibration_instruments WHERE next_due IS NOT NULL AND status NOT IN ('retired','out_of_service')").all(); } catch { /* optional */ }
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

  // HACCP / CCP monitoring evidence: each defined CCP with its linked
  // equipment + calibration instruments, checked for the evidence an auditor
  // asks for — current PMs on the equipment and in-date calibration.
  try {
    const ccps = db.prepare('SELECT id, name, hazard_type FROM haccp_ccps ORDER BY name').all();
    const ccpItems = [];
    let worst = 'ok';
    const bump = (s) => { if (s === 'crit') worst = 'crit'; else if (s === 'warn' && worst === 'ok') worst = 'warn'; };
    for (const ccp of ccps) {
      const eq = db.prepare('SELECT id, name FROM equipment WHERE haccp_ccp_id = ?').all(ccp.id);
      const inst = db.prepare("SELECT name, next_due FROM calibration_instruments WHERE haccp_ccp_id = ? AND status != 'retired'").all(ccp.id);
      const eqIds = eq.map(e => e.id);
      let overduePm = 0;
      if (eqIds.length) {
        const ph = eqIds.map(() => '?').join(',');
        overduePm = db.prepare(`SELECT COUNT(*) c FROM work_orders WHERE status = 'open' AND due_date < ? AND equipment_id IN (${ph})`).get(today, ...eqIds).c;
      }
      const overdueCal = inst.filter(i => i.next_due && i.next_due < today).length;
      const unlinked = eq.length === 0 && inst.length === 0;
      const status = (overduePm || overdueCal) ? 'crit' : unlinked ? 'warn' : 'ok';
      bump(status);
      const parts = [`${eq.length} equipment`, `${inst.length} instrument${inst.length === 1 ? '' : 's'}`];
      if (overduePm) parts.push(`${overduePm} overdue PM${overduePm === 1 ? '' : 's'}`);
      if (overdueCal) parts.push(`${overdueCal} calibration overdue`);
      if (unlinked) parts.push('no equipment/instruments linked');
      if (status === 'ok') parts.push('evidence current');
      ccpItems.push({ title: `${ccp.name}${ccp.hazard_type ? ` (${ccp.hazard_type})` : ''}`, detail: parts.join(' · ') });
    }
    if (!ccps.length) {
      ccpItems.push({ title: 'No CCPs defined yet', detail: 'Add them under Equipment → Manage CCPs and link the monitoring equipment/instruments.' });
    }
    cats.ccp = {
      label: 'HACCP / CCP Monitoring', module: 'equipment',
      count: ccps.length,
      status: ccps.length ? worst : 'warn',
      items: ccpItems.slice(0, 8),
    };
  } catch { /* optional tables */ }

  const statuses = Object.values(cats).map(c => c.status);
  const overall = statuses.includes('crit') ? 'crit' : statuses.includes('warn') ? 'warn' : 'ok';
  // Audit-readiness: each program area contributes fully when green, half
  // when amber, nothing when red. Deliberately blunt — it moves when and only
  // when program health moves.
  const score = statuses.length ? Math.round((statuses.reduce((s, st) => s + (st === 'ok' ? 1 : st === 'warn' ? 0.5 : 0), 0) / statuses.length) * 100) : 100;
  const gaps = Object.values(cats).filter(c => c.status !== 'ok').map(c => ({ label: c.label, status: c.status, count: c.count }));
  return { overall, readiness: { score, gaps }, generated_at: new Date().toISOString(), categories: cats };
}

router.get('/critical', (req, res) => {
  // Admins/supervisors always; others need an explicit 'critical-tracking'
  // grant in their Settings access map (shareable like any module).
  if (!req.user || (!['admin', 'supervisor'].includes(req.user.role) && !hasExplicitGrant(req.user, 'critical-tracking'))) {
    return res.status(403).json({ error: 'Critical Tracking is for admins, supervisors, or users granted access in Settings.' });
  }
  res.json(computeCritical(getDb()));
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

// The binder-completeness review behind the dashboard's readiness score —
// program-by-program gaps computed from the records, never ticked by hand.
// Admins, supervisors and QA: the audience that acts on "the org chart has no
// approved version", and a screen that names every unplaced person and every
// unsigned program is not for the whole floor.
router.get('/readiness-review', (req, res) => {
  const u = req.user;
  const allowed = u && (['admin', 'supervisor'].includes(u.role)
    || ['qa', 'quality', 'document_control'].includes((u.department || '').toLowerCase()));
  if (!allowed) return res.status(403).json({ error: 'The readiness review is for admins, supervisors and QA.' });
  res.json(readinessReview(getDb()));
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
  // One definition of "completed", shared with the Task Center — see
  // pm-completion.js for why a cancelled task is not a missed one.
  const pm = pmCompletion(db, { from, to: pmCutoff });
  const pmTotal = pm.total;
  const pmCompleted = pm.completed;
  const pmStoodDown = pm.stood_down;


  const overdueWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')").get(to).c;
  const openWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE status IN ('open','in_progress')").get().c;
  const dueSoonWOs = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('open','in_progress')").get(to, sevenDaysOut.toISOString().split('T')[0]).c;
  const clearancePending = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE clearance_required = 1 AND clearance_status = 'pending'").get().c;
  const sopReviewDue = db.prepare("SELECT COUNT(*) as c FROM sop_documents WHERE status != 'archived' AND review_due <= ?").get(to).c;

  const calTotal = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE status != 'retired'").get().c;
  const calOverdue = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due < ? AND status NOT IN ('retired','out_of_service')").get(to).c;
  const calDueSoon = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due BETWEEN ? AND ? AND status NOT IN ('retired','out_of_service')").get(to, sevenDaysOut.toISOString().split('T')[0]).c;

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
  const lotoEquipWithoutProc = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status = 'active' AND loto_required = 1 AND asset_kind != 'zone' AND id NOT IN (SELECT equipment_id FROM loto_procedures)").get().c;

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
      completion_rate: pm.completion_rate,
      meets_sqf_target: pm.meets_sqf_target,
      // Reported rather than folded silently into the rate: "12 stood down" is
      // a fact somebody should be able to check, not an adjustment hidden in a
      // percentage.
      stood_down: pmStoodDown,
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
  const calOverdue = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due < ? AND status NOT IN ('retired','out_of_service')").get(today).c;
  const calDueSoon = db.prepare("SELECT COUNT(*) as c FROM calibration_instruments WHERE next_due BETWEEN ? AND ? AND status NOT IN ('retired','out_of_service')").get(today, sevenOut).c;
  const lotoUncovered = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status = 'active' AND loto_required = 1 AND asset_kind != 'zone' AND id NOT IN (SELECT equipment_id FROM loto_procedures)").get().c;
  const chemMissingSDS = db.prepare("SELECT COUNT(*) as c FROM approved_chemicals WHERE is_active = 1 AND sds_url IS NULL AND sds_number IS NULL").get().c;
  const flaggedIssues = db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE issue_flagged = 1 AND status IN ('open','in_progress','overdue')").get().c;
  const sopReviewDue = db.prepare("SELECT COUNT(*) as c FROM sop_documents WHERE status != 'archived' AND review_due <= ?").get(today).c;
  let pendingQA = 0;
  try { pendingQA = db.prepare("SELECT COUNT(*) as c FROM production_entries WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL").get().c; } catch {}

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
  if (overdueWOs > 0) items.push({ id: 'pm-overdue', tab: 'pm', severity: 'critical', count: overdueWOs, label: `${overdueWOs} overdue PM work order${overdueWOs > 1 ? 's' : ''}` });
  if (dueSoonWOs > 0) items.push({ id: 'pm-due-soon', tab: 'pm', severity: 'info', count: dueSoonWOs, label: `${dueSoonWOs} PM work order${dueSoonWOs > 1 ? 's' : ''} due within 7 days` });
  if (clearancePending > 0) items.push({ id: 'clearance', tab: 'pm', severity: 'warning', count: clearancePending, label: `${clearancePending} hygiene clearance${clearancePending > 1 ? 's' : ''} awaiting QA sign-off` });
  if (calOverdue > 0) items.push({ id: 'cal-overdue', tab: 'calibration', severity: 'critical', count: calOverdue, label: `${calOverdue} calibration${calOverdue > 1 ? 's' : ''} overdue` });
  if (calDueSoon > 0) items.push({ id: 'cal-due-soon', tab: 'calibration', severity: 'info', count: calDueSoon, label: `${calDueSoon} calibration${calDueSoon > 1 ? 's' : ''} due within 7 days` });
  if (lotoUncovered > 0) items.push({ id: 'loto-uncovered', tab: 'loto', severity: 'warning', count: lotoUncovered, label: `${lotoUncovered} equipment missing LOTO procedure${lotoUncovered > 1 ? 's' : ''}` });
  if (chemMissingSDS > 0) items.push({ id: 'chem-sds', tab: 'chemicals', severity: 'warning', count: chemMissingSDS, label: `${chemMissingSDS} chemical${chemMissingSDS > 1 ? 's' : ''} missing SDS documentation` });
  if (flaggedIssues > 0) items.push({ id: 'flagged', tab: 'pm', severity: 'critical', count: flaggedIssues, label: `${flaggedIssues} flagged issue${flaggedIssues > 1 ? 's' : ''} requiring attention` });
  if (sopReviewDue > 0) items.push({ id: 'sop-review', tab: 'sops', severity: 'info', count: sopReviewDue, label: `${sopReviewDue} SOP${sopReviewDue > 1 ? 's' : ''} past review date` });
  // Points at QA Review, not the Production Log: signing is done in the review
  // queue now, and a notification that lands somewhere you can't act is noise.
  if (pendingQA > 0) items.push({ id: 'production-qa', tab: 'qa-review', severity: 'warning', count: pendingQA, label: `${pendingQA} production entr${pendingQA > 1 ? 'ies' : 'y'} pending QA sign-off` });
  // A sign-out log's badge counts what QA can ACT on, not every unsigned row.
  //
  // The generic count above is "any required approval missing", which on the
  // three sign-out logs includes items still signed out and items returned in
  // bad condition — neither of which anyone can counter-sign yet. That put 46
  // on the Equipment tab while QA Review, which only offers ROUTINE returns,
  // showed a different number on the same screen, and nothing said why.
  // Reusing the QA Review source is what keeps the two honest: one definition
  // of "waiting on a signature", read from `server/qa-review.js`.
  const SIGN_OUT_SOURCE = {
    maintenance_sign_out: 'sign-out-equipment',
    knife_sign_out: 'sign-out-knife',
    component_sign_out: 'component-pulls',
  };
  for (const q of qmsPending) {
    const tab = q.cfg?.moduleId || 'deviations';
    const sourceKey = SIGN_OUT_SOURCE[q.type];
    if (sourceKey) {
      const source = getSource(sourceKey);
      const signable = source ? safeCount(source, db) : q.count;
      if (signable > 0) {
        items.push({ id: `qms-approval-${q.type}`, tab, severity: 'warning', count: signable,
          label: `${signable} ${q.cfg?.label || q.type} record${signable > 1 ? 's' : ''} ready to counter-sign` });
      }
      // The rest are real, just not signable yet — they travel as info so the
      // number that "disappeared" is explained rather than silently dropped.
      const waiting = q.count - signable;
      if (waiting > 0) {
        items.push({ id: `qms-open-${q.type}`, tab, severity: 'info', count: waiting,
          label: `${waiting} ${q.cfg?.label || q.type} record${waiting > 1 ? 's' : ''} still out or needing attention before sign-off` });
      }
      continue;
    }
    items.push({ id: `qms-approval-${q.type}`, tab, severity: 'warning', count: q.count, label: `${q.count} ${q.cfg?.label || q.type} record${q.count > 1 ? 's' : ''} awaiting approval` });
  }
  if (disposalsPending > 0) items.push({ id: 'disposal-approvals', tab: 'disposals', severity: 'warning', count: disposalsPending, label: `${disposalsPending} disposal${disposalsPending > 1 ? 's' : ''} awaiting Ops/QA sign-off` });
  if (coaPending > 0) items.push({ id: 'coa-pending', tab: 'coa', severity: 'info', count: coaPending, label: `${coaPending} lab request${coaPending > 1 ? 's' : ''} awaiting results` });

  // Office inbox (Marnee): unhandled supply orders and unreviewed time
  // adjustments badge their own modules. Urgent supply requests and absences
  // are red; everything else is amber, so the colour says how fast to look.
  try {
    const urgentOrders = db.prepare("SELECT COUNT(*) c FROM supply_orders WHERE status = 'new' AND urgent = 1").get().c;
    const newOrders = db.prepare("SELECT COUNT(*) c FROM supply_orders WHERE status = 'new' AND urgent = 0").get().c;
    if (urgentOrders > 0) items.push({ id: 'supply-urgent', tab: 'supply-orders', severity: 'critical', count: urgentOrders, label: `${urgentOrders} urgent supply request${urgentOrders > 1 ? 's' : ''} to order` });
    if (newOrders > 0) items.push({ id: 'supply-new', tab: 'supply-orders', severity: 'warning', count: newOrders, label: `${newOrders} new supply request${newOrders > 1 ? 's' : ''} to order` });
  } catch { /* table optional */ }
  try {
    const absences = db.prepare("SELECT COUNT(*) c FROM time_adjustments WHERE status = 'new' AND adjustment_type = 'absent'").get().c;
    const others = db.prepare("SELECT COUNT(*) c FROM time_adjustments WHERE status = 'new' AND adjustment_type != 'absent'").get().c;
    if (absences > 0) items.push({ id: 'time-absent', tab: 'time-tracking', severity: 'critical', count: absences, label: `${absences} absence${absences > 1 ? 's' : ''} to review` });
    if (others > 0) items.push({ id: 'time-new', tab: 'time-tracking', severity: 'warning', count: others, label: `${others} tardy/early-leave report${others > 1 ? 's' : ''} to review` });
  } catch { /* table optional */ }
  try {
    const unaccounted = db.prepare("SELECT COUNT(*) c FROM time_adjustments WHERE status = 'reviewed' AND COALESCE(adp_status,'pending') = 'pending' AND adjustment_date < date('now', '-7 days')").get().c;
    if (unaccounted > 0) items.push({ id: 'time-adp', tab: 'time-tracking', severity: 'warning', count: unaccounted, label: `${unaccounted} reviewed entr${unaccounted > 1 ? 'ies' : 'y'} not yet accounted for in ADP` });
  } catch { /* column added by migration */ }
  /**
   * Pay evaluations assigned to THIS PERSON.
   *
   * Every other item here is a fact about the plant that several people can
   * act on; this one is addressed to one reviewer, so it is scoped to
   * `req.user.id` and nobody else ever sees it. ReadyBot already DMs and
   * pushes the ask every three days, but a supervisor who reads the DM and
   * comes back to it later had nothing on screen telling them it was still
   * open — the module tab looked exactly like a day with nothing due.
   *
   * BOTH severities are `warning`, so both put a number on the tab. `info`
   * would have been the tidier-looking choice and it is the wrong one here:
   * info lines never reach `badges[tab]`, so an assignment that wasn't late
   * yet would have shown nothing at all — which is the bug being fixed. The
   * overdue/open split lives in the label, which is what the tooltip reads.
   * An assignment with no due date counts as open: a real ask, just not a
   * late one. Assignments are a handful per cycle and the number clears the
   * moment the review is submitted, so this can't become wallpaper.
   */
  try {
    if (req.user?.id) {
      const overdue = db.prepare(
        "SELECT COUNT(*) c FROM pay_review_assignments WHERE reviewer_id = ? AND status = 'open' AND due_date IS NOT NULL AND due_date < ?").get(req.user.id, today).c;
      const upcoming = db.prepare(
        "SELECT COUNT(*) c FROM pay_review_assignments WHERE reviewer_id = ? AND status = 'open' AND (due_date IS NULL OR due_date >= ?)").get(req.user.id, today).c;
      if (overdue > 0) items.push({ id: 'pay-review-overdue', tab: 'pay-tracking', severity: 'warning', count: overdue, label: `${overdue} employee evaluation${overdue > 1 ? 's' : ''} past due` });
      if (upcoming > 0) items.push({ id: 'pay-review-open', tab: 'pay-tracking', severity: 'warning', count: upcoming, label: `${upcoming} employee evaluation${upcoming > 1 ? 's' : ''} assigned to you` });
    }
  } catch { /* table optional */ }

  /**
   * Equipment setup gaps, ROUTED TO WHOEVER OWNS THE MISSING RECORD.
   *
   * The setup checklist could only be seen by someone who thought to open the
   * Equipment list and expand a row, which is the same failure as the 72-hour
   * re-clean badge the cleaner couldn't see: a gap that reaches nobody is
   * indistinguishable from no gap.
   *
   * Each step is owned by a different department, so they are not one lump.
   * Maintenance owns whether a machine generates work at all; QA owns hygienic
   * design and calibration; Document Control owns the work instruction and the
   * course it's taught against. Everyone else sees none of it — a warehouse
   * operator cannot act on a missing LOTO procedure.
   *
   * Runs the same `readinessSummary` the Equipment panel does rather than a
   * faster second copy of the same SQL, so the bell and the row badge can never
   * disagree. Measured at ~22ms over 179 rows.
   */
  try {
    const OWNERS = {
      pm_schedule: { depts: ['maintenance'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no recurring PM schedule — nothing generates their tasks` },
      pm_assignee: { depts: ['maintenance'], label: (n) => `${n} machine${n > 1 ? 's' : ''} whose PM work is not assigned to a team` },
      hygienic_design: { depts: ['qa'], label: (n) => `${n} food-contact machine${n > 1 ? 's' : ''} with no hygienic design verification` },
      calibration: { depts: ['qa'], label: (n) => `${n} measuring device${n > 1 ? 's' : ''} not set up for calibration` },
      training_course: { depts: ['document_control', 'qa'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no training course` },
      work_instruction: { depts: ['document_control'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no work instruction linked` },
    };
    const myDept = String(dept || '').toLowerCase();
    const sees = (depts) => role === 'admin' || depts.includes(myDept)
      || (role === 'supervisor' && depts.includes(myDept));
    // Only compute if this viewer owns at least one of them.
    if (role === 'admin' || Object.values(OWNERS).some(o => o.depts.includes(myDept))) {
      const counts = {};
      for (const eq of db.prepare("SELECT * FROM equipment WHERE status = 'active'").all()) {
        const steps = equipmentReadiness(db, eq).steps;
        const noSchedule = steps.some(x => x.id === 'pm_schedule' && !x.done);
        for (const step of steps) {
          if (step.done || !OWNERS[step.id]) continue;
          // Don't report the same machine twice. A machine with no recurring
          // schedule doesn't yet need a team assigned — the team only matters
          // once something generates, so counting both turns one problem into
          // two numbers and inflates the headline.
          if (step.id === 'pm_assignee' && noSchedule) continue;
          counts[step.id] = (counts[step.id] || 0) + 1;
        }
      }
      for (const [id, owner] of Object.entries(OWNERS)) {
        const n = counts[id] || 0;
        if (!n || !sees(owner.depts)) continue;
        items.push({
          id: `equip-setup-${id}`, tab: 'equipment',
          // A machine generating no maintenance at all is the one worth a
          // warning; the rest are real but not urgent.
          severity: id === 'pm_schedule' ? 'warning' : 'info',
          count: n, label: owner.label(n),
        });
      }
    }
  } catch { /* readiness is best-effort — it must never fail the bell */ }

  // 72-hour idle rule: applicable rooms needing a re-clean that nobody has
  // handled yet (not dismissed / N-A'd / assigned) badge the Sanitation module.
  try {
    const flagged = recleanRooms(db).filter(r => r.needs_attention).length;
    if (flagged > 0) items.push({ id: 'sanitation-reclean', tab: 'sanitation', severity: 'warning', count: flagged, label: `${flagged} room${flagged > 1 ? 's' : ''} need${flagged > 1 ? '' : 's'} re-cleaning (72h rule / used since clean)` });
  } catch { /* optional tables */ }

  // A module's badge is the number of THINGS needing attention, not the number
  // of alert categories (a badge of "3" used to mean "3 kinds of problem",
  // which read as "3 items" and confused everyone). `badgeDetail` carries the
  // per-category breakdown so the sidebar tooltip and the module's attention
  // bar can say exactly what those items are.
  const badges = {};
  const badgeDetail = {};
  for (const item of items) {
    const n = Number.isFinite(item.count) ? item.count : 1;
    // Only actionable severities drive the number; 'info' items (things merely
    // coming up) still travel in badgeDetail so the page can show them as a
    // heads-up without inflating the badge.
    if (item.severity === 'critical' || item.severity === 'warning') {
      badges[item.tab] = (badges[item.tab] || 0) + n;
    }
    (badgeDetail[item.tab] = badgeDetail[item.tab] || []).push({
      id: item.id, label: item.label, severity: item.severity, count: n,
    });
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

  res.json({
    items, badges, badgeDetail, scheduleNotice,
    total: Object.values(badges).reduce((s, n) => s + n, 0),
  });
});

export default router;
