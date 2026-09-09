// Stability studies, pulls and shelf-life justifications (CAR 4990683-9).
//
// ReadyDoc cannot age a product. What it holds is the plan (a study with its
// pull dates), the evidence as it arrives (each pull, each result), and the
// link from a product's expiration date to whatever justifies it — an interim
// justification now, the study's data later. Coverage is derived on every
// read from the catalogue: a product with neither is the gap an auditor asks
// about, and a stored list of "justified products" would be stale the day a
// SKU is added.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { planPulls, generateStabilityPullTasks, stabilityStatus, pullState } from '../stability.js';
import { raiseCapa } from '../capa-raise.js';
import { readyDocOrigin } from '../links.js';
import { postMessageAs, botDm } from './comms.js';
import { pushToUser } from '../push.js';

const router = Router();

// The retention module's own ladder: Quality, supervisors, admins act.
const canEdit = (u) => ['admin', 'supervisor'].includes(u?.role)
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase());
const requireEdit = (req, res, next) => canEdit(req.user) ? next() : res.status(403).json({ error: 'Quality access required' });
const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n) || null;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const skus = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map(s => String(s).trim().toUpperCase()).filter(Boolean))];
const today = (db) => db.prepare("SELECT date('now') d").get().d;

function studyShape(db, s, t) {
  const pulls = db.prepare('SELECT * FROM stability_pulls WHERE study_id = ? ORDER BY pull_month').all(s.id)
    .map(p => ({ ...p, state: pullState(p, t) }));
  return {
    ...s, product_skus: JSON.parse(s.product_skus || '[]'), pull_months: JSON.parse(s.pull_months || '[]'), pulls,
    missed: pulls.filter(p => p.state === 'missed').length,
    awaiting_result: pulls.filter(p => p.state === 'pulled').length,
    resulted: pulls.filter(p => p.state === 'resulted').length,
    failed: pulls.filter(p => p.result === 'fail').length,
  };
}

/**
 * The basis in force for each SKU is the MOST RECENT justification naming it —
 * derived on read, never a stored flag. A later justification for one SKU of a
 * family does not unsay the earlier one for the rest of the family; each row
 * reports `current_for`, the SKUs it still speaks for.
 */
function currentJustifications(db) {
  const rows = db.prepare('SELECT * FROM stability_justifications ORDER BY decided_on DESC, created_at DESC, rowid DESC').all()
    .map(j => ({ ...j, skus: JSON.parse(j.product_skus || '[]') }));
  const claimed = new Set();
  for (const j of rows) {
    j.current_for = j.skus.filter(k => !claimed.has(k));
    for (const k of j.current_for) claimed.add(k);
  }
  return rows;
}

/** Every active product and what its expiration date rests on. */
function coverage(db) {
  const products = (() => {
    try { return db.prepare("SELECT sku, flavor, category, base_flavor, status FROM products WHERE status = 'active' ORDER BY category, base_flavor").all(); }
    catch { return []; }
  })();
  const studies = db.prepare("SELECT id, title, product_skus, product_family, status FROM stability_studies WHERE status != 'stopped'").all()
    .map(s => ({ ...s, skus: JSON.parse(s.product_skus || '[]') }));
  const just = currentJustifications(db);
  const rows = products.map(p => {
    const st = studies.filter(s => s.skus.includes(p.sku));
    const js = just.filter(j => j.current_for.includes(p.sku));
    return { ...p, studies: st.map(s => ({ id: s.id, title: s.title, status: s.status })), justifications: js.map(j => ({ id: j.id, shelf_life_months: j.shelf_life_months, basis_type: j.basis_type })),
      covered: st.length > 0 || js.length > 0 };
  });
  return { products: rows, uncovered: rows.filter(r => !r.covered).length, covered: rows.filter(r => r.covered).length };
}

router.get('/', (req, res) => {
  const db = getDb();
  const t = today(db);
  const studies = db.prepare('SELECT * FROM stability_studies ORDER BY status = \'active\' DESC, start_date DESC').all().map(s => studyShape(db, s, t));
  const status = stabilityStatus(db, { today: t });
  res.json({ studies, missed: status.missed.length, awaiting_result: status.awaiting_result.length, upcoming: status.upcoming.length, coverage: coverage(db) });
});

router.get('/justifications', (_req, res) => {
  const db = getDb();
  res.json({ justifications: currentJustifications(db).map(j => ({ ...j, product_skus: j.skus, skus: undefined })) });
});

router.post('/', requireEdit, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const title = clean(b.title, 160);
  if (!title) return res.status(400).json({ error: 'Name the study.' });
  if (!isDay(b.start_date)) return res.status(400).json({ error: 'Start date (YYYY-MM-DD) is required — the pull dates count from it.' });
  const months = [...new Set((Array.isArray(b.pull_months) ? b.pull_months : String(b.pull_months || '').split(/[,\s]+/)).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b2) => a - b2);
  if (!months.length) return res.status(400).json({ error: 'List the pull points in months (e.g. 0, 3, 6, 12, 18, 24).' });
  const condition = b.condition === 'accelerated' ? 'accelerated' : 'real_time';
  const id = uuid();
  const t = today(db);
  const status = ['planned', 'active'].includes(b.status) ? b.status : (b.start_date <= t ? 'active' : 'planned');
  db.transaction(() => {
    db.prepare(`INSERT INTO stability_studies (id, title, product_family, product_skus, item_number, lot_number, condition, condition_detail, start_date, pull_months, tests, acceptance, retention_sample_id, protocol_ref, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, title, clean(b.product_family, 120), JSON.stringify(skus(b.product_skus)), clean(b.item_number, 60), clean(b.lot_number, 60), condition, clean(b.condition_detail, 200),
        b.start_date, JSON.stringify(months), clean(b.tests, 1000), clean(b.acceptance, 1000), clean(b.retention_sample_id, 60), clean(b.protocol_ref, 120), status, clean(b.notes, 2000), req.user.name);
    const ins = db.prepare('INSERT INTO stability_pulls (id, study_id, pull_month, due_date) VALUES (?, ?, ?, ?)');
    for (const p of planPulls({ start_date: b.start_date, pull_months: months })) ins.run(uuid(), id, p.pull_month, p.due_date);
    logAudit(req.user, 'stability_study_created', 'stability_study', id, { title, condition, start_date: b.start_date, pull_months: months });
  })();
  // A pull already due gets its task now, not at the next housekeeping tick.
  generateStabilityPullTasks(db);
  res.status(201).json({ study: studyShape(db, db.prepare('SELECT * FROM stability_studies WHERE id = ?').get(id), t) });
});

router.put('/:id', requireEdit, (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM stability_studies WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const status = ['planned', 'active', 'complete', 'stopped'].includes(b.status) ? b.status : s.status;
  if ((status === 'stopped' || status === 'complete') && status !== s.status && !clean(b.notes, 2000) && !s.notes) {
    return res.status(400).json({ error: `Say why the study is ${status} (notes).` });
  }
  db.prepare(`UPDATE stability_studies SET title = ?, product_family = ?, product_skus = ?, tests = ?, acceptance = ?, protocol_ref = ?, retention_sample_id = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(clean(b.title, 160) || s.title, b.product_family !== undefined ? clean(b.product_family, 120) : s.product_family,
      b.product_skus !== undefined ? JSON.stringify(skus(b.product_skus)) : s.product_skus,
      b.tests !== undefined ? clean(b.tests, 1000) : s.tests, b.acceptance !== undefined ? clean(b.acceptance, 1000) : s.acceptance,
      b.protocol_ref !== undefined ? clean(b.protocol_ref, 120) : s.protocol_ref, b.retention_sample_id !== undefined ? clean(b.retention_sample_id, 60) : s.retention_sample_id,
      status, b.notes !== undefined ? clean(b.notes, 2000) : s.notes, s.id);
  logAudit(req.user, 'stability_study_updated', 'stability_study', s.id, { status }, s, db.prepare('SELECT * FROM stability_studies WHERE id = ?').get(s.id));
  res.json({ study: studyShape(db, db.prepare('SELECT * FROM stability_studies WHERE id = ?').get(s.id), today(db)) });
});

async function tellQuality(db, title, body) {
  try {
    const users = db.prepare(`SELECT id FROM users WHERE is_active = 1 AND name != 'ReadyBot'
      AND (role = 'admin' OR (role = 'supervisor' AND LOWER(department) IN ('qa','quality')))`).all();
    for (const u of users) {
      try { const { bot, dm } = botDm(db, u.id); if (dm) await postMessageAs(db, dm, bot, body); } catch { /* best effort */ }
      pushToUser(u.id, { title, body: body.replace(/\*/g, '').slice(0, 140), tag: 'stability', url: '/?tab=retention-samples&view=stability' }).catch(() => {});
    }
  } catch (e) { console.warn('[stability] notify failed:', e.message); }
}

// The laboratory's answer for a pull. A FAIL raises a CAR: a stability failure
// is a product on the shelf with a date that may not hold.
router.post('/pulls/:id/result', requireEdit, async (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT p.*, s.title AS study_title FROM stability_pulls p JOIN stability_studies s ON s.id = p.study_id WHERE p.id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status === 'planned') return res.status(409).json({ error: 'This pull has not been recorded as pulled yet — complete its task first.' });
  const result = ['pass', 'fail'].includes(req.body?.result) ? req.body.result : null;
  if (!result) return res.status(400).json({ error: 'Result must be pass or fail.' });
  const summary = clean(req.body?.result_summary, 4000);
  if (!summary) return res.status(400).json({ error: 'Write the result summary (what was tested and what it read).' });
  const day = isDay(req.body?.resulted_on) ? req.body.resulted_on : today(db);
  let capa = null;
  db.transaction(() => {
    if (result === 'fail' && !p.capa_id) {
      capa = raiseCapa(db, req.user, {
        title: `Stability failure: ${p.study_title}, ${p.pull_month}-month pull`,
        description: `The ${p.pull_month}-month pull of stability study "${p.study_title}" failed.\n\n${summary}\n\nAssess product on the market within its dated shelf life; decide whether the expiration date holds.`,
        source_type: 'Stability', priority: 'high', date_issued: day, extra: { stability_pull_id: p.id },
      });
    }
    db.prepare(`UPDATE stability_pulls SET status = 'resulted', result = ?, result_summary = ?, resulted_on = ?, resulted_by = ?, coa_request_id = COALESCE(?, coa_request_id), capa_id = COALESCE(?, capa_id), updated_at = datetime('now') WHERE id = ?`)
      .run(result, summary, day, req.user.name, clean(req.body?.coa_request_id, 60), capa?.id || null, p.id);
    logAudit(req.user, 'stability_result_entered', 'stability_pull', p.id, { study: p.study_title, pull_month: p.pull_month, result, capa_number: capa?.capa_number || null });
  })();
  if (result === 'fail') tellQuality(db, 'Stability failure', `🚨 *Stability failure* — "${p.study_title}", ${p.pull_month}-month pull: ${summary.slice(0, 160)}. ${capa ? `${capa.capa_number} raised.` : ''} ${readyDocOrigin()}/?tab=retention-samples&view=stability`);
  const row = db.prepare('SELECT * FROM stability_pulls WHERE id = ?').get(p.id);
  res.json({ pull: { ...row, state: pullState(row, today(db)) }, capa: capa ? { id: capa.id, capa_number: capa.capa_number } : null });
});

// A pull that could not be taken (no retain left, study stopped) is skipped
// with a reason — never quietly left "planned" to read as missed forever.
router.post('/pulls/:id/skip', requireEdit, (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM stability_pulls WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'planned') return res.status(409).json({ error: 'Only a pull that has not been taken can be skipped.' });
  const reason = clean(req.body?.reason, 500);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'Say why the pull was skipped.' });
  db.transaction(() => {
    db.prepare("UPDATE stability_pulls SET status = 'skipped', notes = ?, updated_at = datetime('now') WHERE id = ?").run(reason, p.id);
    if (p.work_order_id) db.prepare("UPDATE work_orders SET status = 'cancelled', notes = ?, completed_by = ?, completed_at = datetime('now') WHERE id = ? AND status IN ('open','in_progress','overdue','missed')").run(`Stability pull skipped: ${reason}`, req.user.name, p.work_order_id);
    logAudit(req.user, 'stability_pull_skipped', 'stability_pull', p.id, { reason });
  })();
  res.json({ pull: db.prepare('SELECT * FROM stability_pulls WHERE id = ?').get(p.id) });
});

// What an expiration date rests on today. A new justification for a SKU is
// the one in force for it from then on (see currentJustifications); nothing
// is edited or flagged, so the history is the rows.
router.post('/justifications', requireEdit, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const list = skus(b.product_skus);
  if (!list.length) return res.status(400).json({ error: 'Name at least one SKU the justification covers.' });
  const basis = clean(b.basis, 4000);
  if (!basis || basis.length < 10) return res.status(400).json({ error: 'Write the basis for the date (ingredient stability data, water activity, packaging, published data…).' });
  const months = parseInt(b.shelf_life_months, 10);
  if (!Number.isFinite(months) || months <= 0) return res.status(400).json({ error: 'Shelf life in months is required.' });
  const type = b.basis_type === 'study' ? 'study' : 'interim';
  if (type === 'study' && !db.prepare('SELECT 1 FROM stability_studies WHERE id = ?').get(b.study_id || '')) return res.status(400).json({ error: 'A study-based justification must name the study.' });
  const id = uuid();
  const day = isDay(b.decided_on) ? b.decided_on : today(db);
  db.transaction(() => {
    db.prepare(`INSERT INTO stability_justifications (id, product_family, product_skus, shelf_life_months, basis_type, study_id, basis, document_ref, decided_by, decided_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, clean(b.product_family, 120), JSON.stringify(list), months, type, type === 'study' ? b.study_id : null, basis, clean(b.document_ref, 200), clean(b.decided_by, 120) || req.user.name, day);
    logAudit(req.user, 'stability_justification_filed', 'stability_justification', id, { skus: list, shelf_life_months: months, basis_type: type });
  })();
  res.status(201).json({ justification: { ...db.prepare('SELECT * FROM stability_justifications WHERE id = ?').get(id), product_skus: list }, coverage: coverage(db) });
});

export default router;
