// The records the scheduled checks file (D-060): environmental monitoring
// samples and their results, GMP walk-throughs, banned-list reviews.
//
// Completion writes the record (check-records.js, inside pm.js's
// transaction); this router is how QA reads them, enters the laboratory's
// result against a pending sample, files a historical result by hand, and
// records what was done about an alert. Every figure here is derived on
// read — a stored count of "pending results" goes stale the first time a
// result is entered.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { gradeEmpResult, EMP_FORM_CODE, EMP_REVISION } from '../emp-results.js';
import { EMP_ZONES, GMP_WALK_ITEMS, GMP_WALK_REVISION, BANNED_LISTS } from '../../shared/check-forms.js';
import { raiseCapa } from '../capa-raise.js';
import { currentListEditions } from '../check-records.js';
import { readyDocOrigin } from '../links.js';
import { postMessageAs, botDm } from './comms.js';
import { pushToUser } from '../push.js';

const router = Router();

// Same ladder as the quality schedules themselves: Quality leadership,
// supervisors and admins act; anyone who reached the module reads.
function canAct(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  return ['qa', 'quality'].includes((user.department || '').toLowerCase());
}
const requireAct = (req, res, next) => canAct(req.user) ? next() : res.status(403).json({ error: 'Quality access required' });

const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n) || null;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function sampleShape(r) {
  return { ...r, capa_number: r.capa_number || null };
}
const SAMPLE_SQL = `SELECT s.*, c.capa_number, c.status AS capa_status FROM emp_samples s LEFT JOIN capas c ON c.id = s.capa_id`;

/* ── Environmental monitoring ─────────────────────────────────────────────── */

router.get('/emp/zones', (_req, res) => res.json({ form_code: EMP_FORM_CODE, revision: EMP_REVISION, zones: EMP_ZONES }));

// Samples, newest first, bounded. Filters narrow; nothing is hidden by
// default — a log quietly missing its pending rows is worse than a long one.
router.get('/emp/samples', (req, res) => {
  const db = getDb();
  const { zone, site, test, outcome, since, limit } = req.query;
  const where = []; const params = [];
  if (zone) { where.push('s.zone = ?'); params.push(zone); }
  if (site) { where.push('LOWER(s.site) = LOWER(?)'); params.push(site); }
  if (test) { where.push('s.test = ?'); params.push(test); }
  if (outcome) { where.push('s.outcome = ?'); params.push(outcome); }
  if (isDay(since)) { where.push('s.sampled_on >= ?'); params.push(since); }
  const rows = db.prepare(`${SAMPLE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.sampled_on DESC, s.zone, s.site, s.test LIMIT ?`).all(...params, Math.min(2000, parseInt(limit, 10) || 500));
  res.json({ samples: rows.map(sampleShape) });
});

// What the screen leads with: results awaited, and how long they have been
// awaited. The number IS the rows' length — the activity-metrics rule.
router.get('/emp/summary', (req, res) => {
  const db = getDb();
  const pending = db.prepare(`${SAMPLE_SQL} WHERE s.outcome = 'pending' ORDER BY s.sampled_on ASC`).all().map(sampleShape);
  const openActions = db.prepare(`${SAMPLE_SQL} WHERE s.outcome = 'action' AND (s.corrective_action IS NULL OR s.corrective_action = '') ORDER BY s.sampled_on DESC`).all().map(sampleShape);
  const byZone = db.prepare(`SELECT zone, outcome, COUNT(*) n FROM emp_samples WHERE sampled_on >= date('now','-365 days') GROUP BY zone, outcome`).all();
  const lastByZone = db.prepare(`SELECT zone, MAX(sampled_on) last_sampled FROM emp_samples GROUP BY zone`).all();
  const sites = db.prepare(`SELECT zone, site, test, COUNT(*) n, MAX(sampled_on) last_sampled,
      SUM(CASE WHEN outcome='alert' THEN 1 ELSE 0 END) alerts, SUM(CASE WHEN outcome='action' THEN 1 ELSE 0 END) actions
    FROM emp_samples WHERE sampled_on >= date('now','-365 days') GROUP BY zone, site, test ORDER BY zone, site, test`).all();
  res.json({
    pending, pending_count: pending.length,
    open_actions: openActions, open_action_count: openActions.length,
    by_zone: byZone, last_by_zone: lastByZone, sites,
    form_code: EMP_FORM_CODE, revision: EMP_REVISION,
  });
});

async function tellQuality(db, title, body, tag) {
  try {
    const users = db.prepare(`SELECT id FROM users WHERE is_active = 1 AND name != 'ReadyBot'
      AND (role = 'admin' OR (role = 'supervisor' AND LOWER(department) IN ('qa','quality')))`).all();
    for (const u of users) {
      try { const { bot, dm } = botDm(db, u.id); if (dm) await postMessageAs(db, dm, bot, body); } catch { /* best effort */ }
      pushToUser(u.id, { title, body: body.replace(/\*/g, '').slice(0, 140), tag, url: '/?tab=quality-schedules&view=emp' }).catch(() => {});
    }
  } catch (e) { console.warn('[emp] notify failed:', e.message); }
}

// Grade + write one result. Shared by the result endpoint and the manual
// filing so a historical water result is graded exactly like a fresh one.
function applyResult(db, actor, sample, { result_value, resulted_on, lab, notes }) {
  const g = gradeEmpResult(sample.zone, sample.test, result_value);
  if (g.unreadable) {
    return { error: `Could not read "${result_value}" as a ${sample.test} result. Enter a number (e.g. 45, <10, TNTC) or Present / Absent.` };
  }
  const day = isDay(resulted_on) ? resulted_on : db.prepare("SELECT date('now') d").get().d;
  const who = typeof actor === 'string' ? actor : actor?.name;
  db.prepare(`UPDATE emp_samples SET result_value = ?, result_numeric = ?, outcome = ?, alert_limit = ?, action_limit = ?,
      resulted_on = ?, resulted_by = ?, lab = COALESCE(?, lab), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(clean(result_value, 80), Number.isFinite(g.numeric) ? g.numeric : null, g.outcome, g.alert_limit, g.action_limit,
      day, who, clean(lab, 120), clean(notes, 2000), sample.id);
  let capa = null;
  if (g.outcome === 'action' && !sample.capa_id) {
    // An action-level result raises the CAR itself — idempotent on the
    // sample, so re-entering a corrected value never raises a second.
    capa = raiseCapa(db, actor, {
      title: `EMP action level: ${sample.test} at ${sample.site} (${EMP_ZONES[sample.zone]?.label || sample.zone})`,
      description: `Environmental monitoring result ${result_value} on sample of ${sample.sampled_on} (${EMP_FORM_CODE} ${EMP_REVISION}; action level ${g.action_limit}).\nRecord the investigation and the corrective action on the sample and here.`,
      source_type: 'Environmental Monitoring', priority: 'high', date_issued: day,
      extra: { emp_sample_id: sample.id },
    });
    db.prepare('UPDATE emp_samples SET capa_id = ? WHERE id = ?').run(capa.id, sample.id);
  }
  logAudit(actor, 'emp_result_entered', 'emp_sample', sample.id,
    { zone: sample.zone, site: sample.site, test: sample.test, result_value, outcome: g.outcome, capa_number: capa?.capa_number || null });
  return { grade: g, capa };
}

router.post('/emp/samples/:id/result', requireAct, async (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM emp_samples WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (!clean(req.body?.result_value, 80)) return res.status(400).json({ error: 'Enter the result.' });
  let out;
  const tx = db.transaction(() => { out = applyResult(db, req.user, s, req.body || {}); });
  tx();
  if (out.error) return res.status(400).json({ error: out.error });
  const row = db.prepare(`${SAMPLE_SQL} WHERE s.id = ?`).get(s.id);
  const label = `${s.test} at ${s.site} (${EMP_ZONES[s.zone]?.label || s.zone}), sampled ${s.sampled_on}`;
  if (out.grade.outcome === 'action') {
    tellQuality(db, 'EMP action level', `🚨 *Environmental monitoring — ACTION level.* ${label}: *${req.body.result_value}* (action ${out.grade.action_limit}). ${out.capa ? `${out.capa.capa_number} raised.` : ''} ${readyDocOrigin()}/?tab=quality-schedules&view=emp`, `emp-${s.id}`);
  } else if (out.grade.outcome === 'alert') {
    tellQuality(db, 'EMP alert level', `⚠️ *Environmental monitoring — alert level.* ${label}: *${req.body.result_value}* (alert ${out.grade.alert_limit}, action ${out.grade.action_limit}). ${readyDocOrigin()}/?tab=quality-schedules&view=emp`, `emp-${s.id}`);
  }
  res.json({ sample: sampleShape(row), outcome: out.grade.outcome, capa: out.capa ? { id: out.capa.id, capa_number: out.capa.capa_number } : null });
});

// A historical or off-schedule result, filed by hand: the 2026 water and air
// results the plant already holds. Graded on the way in like any other.
router.post('/emp/samples', requireAct, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const zone = EMP_ZONES[b.zone] ? b.zone : null;
  if (!zone) return res.status(400).json({ error: 'Pick a zone.' });
  const test = clean(b.test, 120);
  if (!test || !EMP_ZONES[zone].tests.includes(test)) return res.status(400).json({ error: `Pick one of the tests the form lists for that zone: ${EMP_ZONES[zone].tests.join(', ')}.` });
  const site = clean(b.site, 160);
  if (!site) return res.status(400).json({ error: 'Name the site.' });
  if (!isDay(b.sampled_on)) return res.status(400).json({ error: 'When was it sampled? (YYYY-MM-DD)' });
  if (b.sampled_on > db.prepare("SELECT date('now') d").get().d) return res.status(400).json({ error: 'A sample cannot be dated in the future.' });
  const id = uuid();
  let out = null;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO emp_samples (id, work_order_id, quality_schedule_id, zone, site, test, sampled_on, sampled_by, lab, outcome, form_revision, notes, source)
      VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'manual')`)
      .run(id, zone, site, test, b.sampled_on, clean(b.sampled_by, 120) || req.user.name, clean(b.lab, 120), `${EMP_FORM_CODE} ${EMP_REVISION}`, clean(b.notes, 2000));
    logAudit(req.user, 'emp_sample_filed', 'emp_sample', id, { zone, site, test, sampled_on: b.sampled_on, source: 'manual' });
    if (clean(b.result_value, 80)) {
      const s = db.prepare('SELECT * FROM emp_samples WHERE id = ?').get(id);
      out = applyResult(db, req.user, s, { result_value: b.result_value, resulted_on: b.resulted_on || b.sampled_on, lab: b.lab, notes: null });
      if (out.error) throw Object.assign(new Error(out.error), { status: 400 });
    }
  });
  try { tx(); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  res.status(201).json({ sample: sampleShape(db.prepare(`${SAMPLE_SQL} WHERE s.id = ?`).get(id)), capa: out?.capa ? { id: out.capa.id, capa_number: out.capa.capa_number } : null });
});

// What was done about it. Required on an action-level result before the
// readiness review stops flagging it.
router.put('/emp/samples/:id/corrective-action', requireAct, (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM emp_samples WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const text = clean(req.body?.corrective_action, 4000);
  if (!text || text.length < 3) return res.status(400).json({ error: 'Say what was done (at least 3 characters).' });
  db.prepare(`UPDATE emp_samples SET corrective_action = ?, corrective_by = ?, corrective_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(text, req.user.name, s.id);
  logAudit(req.user, 'emp_corrective_action', 'emp_sample', s.id, { corrective_action: text });
  res.json({ sample: sampleShape(db.prepare(`${SAMPLE_SQL} WHERE s.id = ?`).get(s.id)) });
});

/* ── GMP walk-throughs ────────────────────────────────────────────────────── */

router.get('/gmp-walks', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM gmp_walkthroughs ORDER BY walked_on DESC, created_at DESC LIMIT ?').all(Math.min(500, parseInt(req.query.limit, 10) || 100));
  res.json({ walks: rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]'), capa_ids: JSON.parse(r.capa_ids || '[]') })), items: GMP_WALK_ITEMS, revision: GMP_WALK_REVISION });
});

/* ── Banned / prohibited substance list reviews ───────────────────────────── */

router.get('/list-reviews', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM banned_list_reviews ORDER BY reviewed_on DESC, created_at DESC LIMIT 100').all()
    .map(r => ({ ...r, editions: JSON.parse(r.editions || '{}') }));
  res.json({ reviews: rows, current: currentListEditions(db), lists: BANNED_LISTS });
});

export default router;
