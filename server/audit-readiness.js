// The audit readiness REVIEW — is the binder complete?
//
// The dashboard's readiness checklist is OPERATIONAL: overdue tasks, overdue
// calibrations, pending clearances — what is late this week. This is the other
// question, the one asked two weeks before an audit: which programs have gaps
// an auditor will find. A module can be perfectly up to date on its tasks and
// still be missing the thing itself — an org chart with no approved version,
// a retention log with no rows, a course nobody has ever completed, a mock
// recall that has never been run.
//
// EVERYTHING IS DERIVED FROM RECORDS, nothing is ticked by hand — the same
// rule as the equipment setup checklist, and for the same reason: a review
// somebody fills in says what they remembered; a review computed from the
// tables says what an auditor will actually find.
//
// Each section is guarded independently: one table failing must not take down
// the review, but a failed section says so rather than silently reading green.

import { EMP_COVERAGE } from './emp-site-list.js';
import { ccpDrift, PREVENTIVE_CONTROLS, PC_DOCUMENT, PC_REVISION } from './preventive-controls.js';

const item = (label, status, detail, tab) => ({ label, status, detail, tab });

export function readinessReview(db) {
  const sections = [];
  const add = (title, fn) => {
    try {
      const items = fn() || [];
      const worst = items.reduce((w, i) =>
        i.status === 'critical' ? 'critical'
          : (i.status === 'warning' && w !== 'critical') ? 'warning' : w, 'good');
      sections.push({ title, status: worst, items });
    } catch (e) {
      // A section that cannot be computed is a fact worth showing — a review
      // that quietly skips a broken program reads as that program being fine.
      sections.push({ title, status: 'warning', items: [item('Could not be checked', 'warning', e.message)] });
    }
  };

  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const n = (sql, ...p) => one(sql, ...p)?.c ?? 0;

  // ── Controlled documents ──────────────────────────────────────────────────
  add('Controlled Documents', () => {
    const total = n("SELECT COUNT(*) c FROM sop_documents WHERE status NOT IN ('archived','superseded')");
    const drafts = n("SELECT COUNT(*) c FROM sop_documents WHERE status = 'draft'");
    const pastReview = n("SELECT COUNT(*) c FROM sop_documents WHERE status = 'active' AND review_due IS NOT NULL AND review_due < date('now')");
    const noEffective = n("SELECT COUNT(*) c FROM sop_documents WHERE status = 'active' AND (effective_date IS NULL OR effective_date = '')");
    return [
      item(`${total} live documents in the registry`, 'good', null, 'sops'),
      item(`${drafts} in draft`, drafts ? 'warning' : 'good',
        drafts ? 'A draft is not an effective document — an auditor asking for it gets a work in progress.' : null, 'sops'),
      item(`${pastReview} past their review date`, pastReview ? 'warning' : 'good', null, 'doc-review'),
      item(`${noEffective} active with no effective date`, noEffective ? 'warning' : 'good',
        noEffective ? 'An effective date is the first thing checked against a record filed under the document.' : null, 'sops'),
    ];
  });

  // ── Training ──────────────────────────────────────────────────────────────
  add('Training', () => {
    const untrained = n(`SELECT COUNT(*) c FROM users u
      WHERE (u.is_active IS NULL OR u.is_active = 1) AND u.role != 'auditor'
        AND LOWER(u.name) NOT IN ('readybot')
        AND NOT EXISTS (SELECT 1 FROM training_records tr WHERE LOWER(tr.employee_name) = LOWER(u.name))`);
    const emptyCourses = n(`SELECT COUNT(*) c FROM training_courses tc
      WHERE tc.active = 1
        AND NOT EXISTS (SELECT 1 FROM training_records tr WHERE tr.course_id = tc.id)`);
    const total = n('SELECT COUNT(*) c FROM training_records');
    return [
      item(`${total.toLocaleString()} training records on file`, total ? 'good' : 'warning',
        total ? null : 'No training history at all — import the Training Log and the scanned tests.', 'training'),
      item(`${untrained} active people with no training record`, untrained ? 'warning' : 'good',
        untrained ? '"Is this operator trained?" has no answer for them.' : null, 'training'),
      item(`${emptyCourses} active courses nobody has completed`, emptyCourses ? 'warning' : 'good',
        emptyCourses ? 'A course with no completions is a requirement with no evidence.' : null, 'training'),
    ];
  });

  // ── Org chart ─────────────────────────────────────────────────────────────
  add('Org Chart', () => {
    const meta = one('SELECT * FROM org_chart_meta WHERE id = 1');
    const noJd = n('SELECT COUNT(*) c FROM org_positions WHERE job_description_id IS NULL');
    const positions = n('SELECT COUNT(*) c FROM org_positions');
    const linked = db.prepare('SELECT user_id FROM org_positions WHERE user_id IS NOT NULL').all().map(r => r.user_id);
    const users = new Set(db.prepare('SELECT id FROM users').all().map(u => u.id));
    const broken = linked.filter(id => !users.has(id)).length;
    const unplacedRow = db.prepare(`SELECT COUNT(*) c FROM users u
      WHERE (u.is_active IS NULL OR u.is_active = 1) AND u.role != 'auditor'
        AND u.id NOT IN (SELECT user_id FROM org_positions WHERE user_id IS NOT NULL)`).get();
    return [
      item(meta?.version && meta?.approved_by
        ? `Version ${meta.version}, approved by ${meta.approved_by}`
        : 'No version / approval recorded', meta?.version && meta?.approved_by ? 'good' : 'warning',
        meta?.version && meta?.approved_by ? null
          : 'The version, who approved it and when it took effect are what make a chart a controlled document.', 'org-chart'),
      item(`${noJd} of ${positions} positions without a linked job description`, noJd ? 'warning' : 'good', null, 'org-chart'),
      item(`${unplacedRow.c} active people not on the chart`, unplacedRow.c ? 'warning' : 'good',
        unplacedRow.c ? 'An org chart missing people is the one an auditor finds a hole in.' : null, 'org-chart'),
      ...(broken ? [item(`${broken} positions linked to a deleted account`, 'warning', null, 'org-chart')] : []),
    ];
  });

  // ── Mock recall ───────────────────────────────────────────────────────────
  add('Mock Recall', () => {
    const last = one(`SELECT recall_number, date_initiated FROM mock_recalls
      WHERE approved_at IS NOT NULL ORDER BY date_initiated DESC LIMIT 1`);
    if (!last) return [item('No signed mock recall on file', 'critical',
      'SOP 415 requires an annual exercise; a new system with no history reads as overdue by definition.', 'recall')];
    const days = one("SELECT CAST(julianday('now') - julianday(?) AS INTEGER) d", last.date_initiated)?.d ?? null;
    const overdue = days !== null && days > 365;
    return [item(`Last signed exercise ${last.recall_number} — ${days} days ago`,
      overdue ? 'critical' : 'good',
      overdue ? 'Past the annual cadence in SOP 415.' : null, 'recall')];
  });

  // ── Internal audits ───────────────────────────────────────────────────────
  add('Internal Audits', () => {
    const last = one(`SELECT audit_date FROM internal_audits
      WHERE signed_by IS NOT NULL ORDER BY audit_date DESC LIMIT 1`);
    const days = last ? one("SELECT CAST(julianday('now') - julianday(?) AS INTEGER) d", last.audit_date)?.d : null;
    return [last
      ? item(`Last signed audit ${days} days ago`, days > 45 ? 'warning' : 'good',
        days > 45 ? 'Their own checklist says internal audits run monthly.' : null, 'internal-audits')
      : item('No signed internal audit on file', 'warning',
        'Form 403-01 says monthly; the first signed audit starts the record.', 'internal-audits')];
  });

  // ── Environmental monitoring (FORM 604-01) ────────────────────────────────
  add('Environmental Monitoring (EMP)', () => {
    const scheds = new Map(db.prepare('SELECT title, is_active FROM quality_schedules').all()
      .map(s => [s.title.toLowerCase(), s]));
    return EMP_COVERAGE.map(c => {
      const s = scheds.get(c.schedule.toLowerCase());
      return item(c.row,
        !s ? 'critical' : s.is_active ? 'good' : 'warning',
        !s ? `No schedule named "${c.schedule}" — this row of the Master Site List is not being sampled.`
          : s.is_active ? null : `"${c.schedule}" is paused.`, 'quality-schedules');
    });
  });

  // ── HACCP ─────────────────────────────────────────────────────────────────
  add('HACCP', () => {
    const ccps = n('SELECT COUNT(*) c FROM haccp_ccps');
    const items = [item(`${ccps} CCPs defined`, ccps ? 'good' : 'warning',
      ccps ? null : 'A HACCP plan with no CCPs in the system has its monitoring evidence nowhere.', 'equipment')];
    // The four preventive controls are transcribed from Protocol 003 V4; a
    // stored row that has wandered from the document is the finding, and a
    // control the plan names that the database lacks is the same finding the
    // other way round. Reported so the section keeps answering once rows exist.
    const drift = ccpDrift(db);
    const missing = drift.filter(d => d.missing).length;
    const fields = drift.length - missing;
    items.push(item(
      drift.length
        ? `${missing ? `${missing} preventive control(s) not in the database` : ''}${missing && fields ? '; ' : ''}${fields ? `${fields} field(s) differ from ${PC_DOCUMENT} ${PC_REVISION}` : ''}`
        : `All ${PREVENTIVE_CONTROLS.length} preventive controls match ${PC_DOCUMENT} ${PC_REVISION}`,
      drift.length ? 'warning' : 'good',
      drift.length ? 'A critical limit that differs from the food safety plan is an audit finding either way — the document or the database is wrong.' : null,
      'equipment'));
    return items;
  });

  // ── NSF GMP for Sport (from the Audit Guide on file, REF-NSF-GMP-AUDIT) ───
  // The guide's Section 3 is the sport-specific half of the audit: 6.2.1 (no
  // banned/prohibited substances in the facility — the MLB / NFL / WADA /
  // Annex C lists), 6.2.2 (procedures reference those lists), 6.2.3.1
  // (documented ANNUAL review of the lists, NSF notified of changes) and
  // 6.2.3.2 (purchasing checks materials against them). Section 2's PP-5 asks
  // for the facility's current GMP/food-safety certification up front.
  // Everything here is derived from the registry and the certifications table
  // — what an auditor following that guide would actually be handed.
  add('NSF GMP for Sport (Audit Guide)', () => {
    const like = (s) => `%${s}%`;
    const bannedDocs = db.prepare(`SELECT doc_number, title,
        COALESCE(NULLIF(effective_date, ''), substr(updated_at, 1, 10)) AS last_touched
      FROM sop_documents
      WHERE status = 'active' AND COALESCE(doc_type, '') != 'reference'
        AND (title LIKE ? OR title LIKE ? OR description LIKE ? OR description LIKE ?
             OR description LIKE ? OR description LIKE ? OR description LIKE ?)`)
      .all(like('banned'), like('prohibited substance'), like('WADA'), like('NFL'),
        like('MLB'), like('Annex C'), like('banned substance'));
    const items = [];
    if (bannedDocs.length === 0) {
      items.push(item('No live procedure references the banned/prohibited-substance lists', 'critical',
        'Guide §6.2.1–6.2.3: the auditor asks for procedures that name the MLB / NFL / WADA / Annex C lists, '
        + 'prove an annual documented review of them, and check purchased materials against them. '
        + 'No active document in the registry mentions any of these.', 'sops'));
    } else {
      const names = bannedDocs.slice(0, 3).map(d => d.doc_number || d.title).join(', ');
      items.push(item(`${bannedDocs.length} live document(s) reference the banned-substance lists (${names})`, 'good', null, 'sops'));
      // 6.2.3.1 wants the list review ANNUAL and documented — a procedure not
      // touched in a year has no evidence this year's review happened.
      const fresh = bannedDocs.some(d => d.last_touched
        && (one("SELECT CAST(julianday('now') - julianday(?) AS INTEGER) d", d.last_touched)?.d ?? 9999) <= 366);
      items.push(item(fresh
        ? 'Banned-list procedure touched within the last year'
        : 'No banned-list procedure updated or made effective within the last year', fresh ? 'good' : 'warning',
        fresh ? null : '§6.2.3.1 asks for a documented annual review of the lists (and notifying NSF of changes) — '
          + 'record this year\'s review against the procedure.', 'sops'));
    }
    // PP-5: the audit opens with the facility's current GMP/food-safety
    // certification. A person's PCQI is not the facility's certificate.
    const facility = n(`SELECT COUNT(*) c FROM certifications
      WHERE cert_type LIKE '%GMP%' OR cert_type LIKE '%455%' OR cert_type LIKE '%SQF%' OR issuer LIKE '%NSF%'`);
    items.push(item(facility
      ? 'A facility GMP/food-safety certificate is on file in Certifications'
      : 'No facility GMP/food-safety certificate filed in Certifications', facility ? 'good' : 'warning',
      facility ? null : 'PP-5: the auditor asks for the facility\'s current registration certificate first — '
        + 'file it in Certifications so it is producible on demand (GP-26: records provided in a timely manner).', 'certifications'));
    const pcqi = n("SELECT COUNT(*) c FROM certifications WHERE cert_type LIKE '%PCQI%'");
    const haccp = n("SELECT COUNT(*) c FROM certifications WHERE cert_type LIKE '%HACCP%'");
    items.push(item(`${pcqi} PCQI and ${haccp} HACCP certificate(s) on file`,
      pcqi && haccp ? 'good' : 'warning',
      pcqi && haccp ? null : 'Qualified-individual evidence — file the team\'s PCQI/HACCP certificates.', 'certifications'));
    return items;
  });

  // ── Retention samples ─────────────────────────────────────────────────────
  add('Retention Samples', () => {
    const rows = n('SELECT COUNT(*) c FROM retention_samples');
    const boxes = n('SELECT COUNT(*) c FROM retention_boxes');
    return [item(`${rows} samples across ${boxes} boxes`, rows ? 'good' : 'warning',
      rows ? null : 'The log is empty — the physical library exists, so import the boxes from the paper log ("Import a box").', 'retention-samples')];
  });

  // ── Meetings ──────────────────────────────────────────────────────────────
  add('Meetings (SQF records)', () => {
    const mgmt = one(`SELECT meeting_date FROM meetings
      WHERE LOWER(meeting_type) LIKE '%management%' AND status = 'approved'
      ORDER BY meeting_date DESC LIMIT 1`);
    const fst = one(`SELECT meeting_date FROM meetings
      WHERE LOWER(meeting_type) LIKE '%food safety%' AND status = 'approved'
      ORDER BY meeting_date DESC LIMIT 1`);
    const within = (d, days) => d && (one("SELECT CAST(julianday('now') - julianday(?) AS INTEGER) d", d)?.d ?? 9999) <= days;
    return [
      item(mgmt ? `Management review: last approved minutes ${mgmt.meeting_date}` : 'No approved management review minutes',
        within(mgmt?.meeting_date, 366) ? 'good' : 'warning',
        within(mgmt?.meeting_date, 366) ? null : 'SQF asks for management review at least annually, with minutes.', 'meetings'),
      item(fst ? `Food safety team: last approved minutes ${fst.meeting_date}` : 'No approved food safety team minutes',
        fst ? 'good' : 'warning', fst ? null : 'The food safety team meeting is an SQF record.', 'meetings'),
    ];
  });

  // ── Safety ────────────────────────────────────────────────────────────────
  add('Safety', () => {
    const lastDrill = one('SELECT event_date FROM evacuation_headcounts ORDER BY event_date DESC LIMIT 1');
    return [item(lastDrill ? `Last evacuation on file ${lastDrill.event_date}` : 'No evacuation drill on file',
      lastDrill ? 'good' : 'warning',
      lastDrill ? null : '"When was your last drill?" currently has no answer in the system.', 'safety')];
  });

  // ── Equipment ─────────────────────────────────────────────────────────────
  add('Equipment', () => {
    const noSchedule = n(`SELECT COUNT(*) c FROM equipment e
      WHERE e.status = 'active' AND COALESCE(e.asset_kind, 'machine') = 'machine'
        AND NOT EXISTS (SELECT 1 FROM pm_schedules ps WHERE ps.equipment_id = e.id AND ps.is_active = 1)`);
    return [item(`${noSchedule} active machines generate no PM work`, noSchedule ? 'warning' : 'good',
      noSchedule ? 'Written tasks with nothing generating them — use "Create schedules from these tasks".' : null, 'equipment')];
  });

  // ── QA backlog ────────────────────────────────────────────────────────────
  add('QA Sign-off Backlog', () => {
    const prod = n(`SELECT COUNT(*) c FROM production_entries
      WHERE qa_signoff_by IS NULL AND qa_waived_at IS NULL`);
    return [item(`${prod} production entries pending QA sign-off`, prod > 25 ? 'warning' : 'good',
      prod > 25 ? 'A backlog this size on audit day reads as sign-off not keeping pace with production.' : null, 'qa-review')];
  });

  const worst = sections.reduce((w, s) =>
    s.status === 'critical' ? 'critical'
      : (s.status === 'warning' && w !== 'critical') ? 'warning' : w, 'good');
  const gaps = sections.flatMap(s => s.items.filter(i => i.status !== 'good').map(i => ({ section: s.title, ...i })));
  return { overall: worst, sections, gaps: gaps.length, generated_at: new Date().toISOString() };
}
