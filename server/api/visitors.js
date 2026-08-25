// Visitor sign-in — the lobby tablet, and the log behind it.
//
// Replaces Lobby Track. The kiosk half is PUBLIC by necessity: it runs on a
// tablet parked in the lobby with nobody signed in, exactly like the knife,
// component, maintenance and scale kiosks. So the surface is deliberately
// narrow — a visitor can sign themselves in, sign themselves out, and read the
// agreement they are being asked to sign. It cannot list who else is on site,
// search the visitor book, or read anybody's stored signature.
//
// TWO RULES THAT SHAPE EVERYTHING HERE:
//
//  1. A SIGNATURE IS AGAINST WORDS, NOT AGAINST A POINTER. Every signature
//     records the agreement's id, code and revision, and the wording of that
//     revision is frozen in `visitor_agreements`. Re-issuing the NDA creates a
//     new revision; it never rewrites what somebody already signed.
//
//  2. AN AUTO SIGN-OUT IS NOT A SIGN-OUT. When a visit times out we know the
//     record was closed; we do NOT know when the person left. `signed_out_method`
//     keeps those apart, and every screen says which happened. Recording a
//     guessed departure time as if somebody tapped a button would make the log
//     assert something nobody observed — the same line the platform draws
//     between a clean that was performed and one that was merely scheduled.
import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { coerceCustomData, parseJson } from '../custom-fields.js';
import { seedVisitorAgreements, sha256 } from '../visitor-agreements.js';

const router = Router();                       // authenticated: the log
export const kioskRouter = Router();           // public: the tablet

// How long a visit stays open before it is closed automatically. The plant's
// Lobby Track setting is about ninety minutes.
export const AUTO_SIGNOUT_MINUTES = 90;

const trim = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const norm = (s) => trim(s).toLowerCase();

const canManage = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['office', 'hr', 'qa', 'quality'].includes((u?.department || '').toLowerCase());

// ── Closing out visits nobody signed out of ─────────────────────────────────
//
// Runs opportunistically on kiosk and log reads rather than on a timer, the same
// way PM housekeeping does — a tablet in a lobby is the thing most likely to be
// awake, and a cron that only fires while somebody is looking is worse than a
// read that fixes itself. Cheap: one indexed UPDATE over open visits.
export function autoSignOutStaleVisits(db) {
  try {
    const info = db.prepare(`
      UPDATE visitor_visits
         SET signed_out_at = datetime('now'),
             signed_out_method = 'auto',
             signed_out_location = location
       WHERE signed_out_at IS NULL
         AND signed_in_at <= datetime('now', ?)`).run(`-${AUTO_SIGNOUT_MINUTES} minutes`);
    return info.changes || 0;
  } catch { return 0; }
}

// ── The agreement currently in force ────────────────────────────────────────
function activeAgreements(db) {
  return db.prepare(`SELECT id, code, title, revision, body, require_signature, effective_from
                     FROM visitor_agreements WHERE is_active = 1 ORDER BY code`).all();
}

// ── Finding the person behind the name ──────────────────────────────────────
//
// Deduplicated on the EMAIL when there is one, because that is the only thing a
// visitor types that is actually theirs; on first+last otherwise. Getting this
// wrong in either direction is bad: a new row per visit turns a returning
// contractor into fifty strangers, while matching too loosely merges two real
// people who share a common name.
function findVisitor(db, { first_name, last_name, email }) {
  if (email) {
    const byEmail = db.prepare('SELECT * FROM visitors WHERE LOWER(email) = ? LIMIT 1').get(norm(email));
    if (byEmail) return byEmail;
  }
  return db.prepare(`SELECT * FROM visitors
                     WHERE LOWER(first_name) = ? AND LOWER(last_name) = ?
                       AND (email IS NULL OR email = '')
                     ORDER BY last_seen_at DESC LIMIT 1`)
    .get(norm(first_name), norm(last_name)) || null;
}

// ── PUBLIC: the tablet ──────────────────────────────────────────────────────

// What the sign-in screen needs to render itself: the extra questions the plant
// has added, and the documents to be signed. No visitor data of any kind.
kioskRouter.get('/config', (_req, res) => {
  const db = getDb();
  autoSignOutStaleVisits(db);
  let fields;
  try {
    fields = db.prepare(`SELECT key, label, field_type, options, required, help_text, sort_order
                         FROM custom_field_defs WHERE scope = 'visitor' AND is_active = 1
                         ORDER BY sort_order, label`).all()
      .map(f => ({ ...f, options: parseJson(f.options, []) || [] }));
  } catch { fields = []; }
  res.json({
    location_default: 'Front Kiosk',
    auto_signout_minutes: AUTO_SIGNOUT_MINUTES,
    fields,
    agreements: activeAgreements(db).map(a => ({
      id: a.id, code: a.code, title: a.title, revision: a.revision,
      body: a.body, require_signature: !!a.require_signature,
    })),
  });
});

kioskRouter.post('/sign-in', (req, res) => {
  const db = getDb();
  const first_name = trim(req.body?.first_name, 60);
  const last_name = trim(req.body?.last_name, 60);
  const email = trim(req.body?.email, 160);
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required.' });
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  // Not a strict validator on purpose — this is a tablet in a lobby and a
  // refused sign-in over a formatting rule is worse than a slightly wrong
  // address. It only rejects what is obviously not an address at all.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });

  const agreements = activeAgreements(db);
  const signatures = Array.isArray(req.body?.signatures) ? req.body.signatures : [];
  // Every agreement that requires a signature must have one, and it must carry
  // a typed name — a drawn mark with nobody's name beside it is not an
  // identifiable signature. Checked HERE and not only on the tablet: a rule the
  // client alone applies is a suggestion.
  for (const a of agreements.filter(x => x.require_signature)) {
    const sig = signatures.find(s => s?.agreement_id === a.id);
    if (!sig || !trim(sig.signed_name)) {
      return res.status(400).json({ error: `Please sign the ${a.title} to continue.` });
    }
  }

  // `.data` — `coerceCustomData` returns `{ data, errors }`, and assigning the
  // whole thing stored `{"data":{…},"errors":[]}` on every visitor: the answers
  // double-wrapped, and a required question left blank silently accepted.
  let custom_data = null;
  try {
    const { data, errors } = coerceCustomData(db, 'visitor', req.body?.custom_data || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    custom_data = data;
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const location = trim(req.body?.location, 60) || 'Front Kiosk';
  const now = new Date().toISOString();

  const out = db.transaction(() => {
    let visitor = findVisitor(db, { first_name, last_name, email });
    if (visitor) {
      db.prepare(`UPDATE visitors SET first_name = ?, last_name = ?, email = COALESCE(NULLIF(?, ''), email),
                  company = COALESCE(NULLIF(?, ''), company), custom_data = COALESCE(?, custom_data),
                  last_seen_at = ?, visit_count = visit_count + 1, updated_at = datetime('now') WHERE id = ?`)
        .run(first_name, last_name, email, trim(req.body?.company, 120),
          custom_data ? JSON.stringify(custom_data) : null, now, visitor.id);
      visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitor.id);
    } else {
      const id = uuid();
      db.prepare(`INSERT INTO visitors (id, first_name, last_name, email, company, custom_data, last_seen_at, visit_count)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(id, first_name, last_name, email, trim(req.body?.company, 120),
          custom_data ? JSON.stringify(custom_data) : null, now);
      visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
    }

    // Somebody already on site who signs in again is not signed in twice — the
    // previous visit is closed by staff action rather than left open forever,
    // and the log says so.
    db.prepare(`UPDATE visitor_visits SET signed_out_at = datetime('now'), signed_out_method = 'auto',
                signed_out_location = location WHERE visitor_id = ? AND signed_out_at IS NULL`).run(visitor.id);

    const visitId = uuid();
    db.prepare(`INSERT INTO visitor_visits (id, visitor_id, location, purpose, host_name, custom_data)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(visitId, visitor.id, location, trim(req.body?.purpose, 200) || null,
        trim(req.body?.host_name, 120) || null, custom_data ? JSON.stringify(custom_data) : null);

    for (const a of agreements) {
      const sig = signatures.find(s => s?.agreement_id === a.id);
      if (!sig) continue;
      db.prepare(`INSERT INTO visitor_signatures
        (id, visit_id, visitor_id, agreement_id, agreement_code, agreement_revision, signed_name, signature_image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuid(), visitId, visitor.id, a.id, a.code, a.revision,
          trim(sig.signed_name, 120), typeof sig.signature_image === 'string' ? sig.signature_image.slice(0, 200000) : null);
    }

    logAudit(`visitor kiosk (${location})`, 'visitor_signed_in', 'visitor_visit', visitId, {
      visitor: `${first_name} ${last_name}`, email, location,
      signed: agreements.map(a => `${a.code} ${a.revision}`),
    }, null, null, `${first_name} ${last_name}`);

    return { visitId, visitor };
  })();

  res.status(201).json({
    ok: true,
    visit_id: out.visitId,
    name: `${first_name} ${last_name}`,
    // So the tablet can tell somebody when they will be closed out.
    auto_signout_minutes: AUTO_SIGNOUT_MINUTES,
  });
});

// Looking yourself up to sign out. Returns ONLY open visits, and only enough to
// pick one — no email, no history, no signature. A lobby tablet must not become
// a way to find out who has been visiting.
kioskRouter.get('/open', (req, res) => {
  const db = getDb();
  autoSignOutStaleVisits(db);
  const q = norm(req.query.q);
  if (q.length < 2) return res.json([]);
  const rows = db.prepare(`
    SELECT v.id, v.signed_in_at, vi.first_name, vi.last_name
    FROM visitor_visits v JOIN visitors vi ON vi.id = v.visitor_id
    WHERE v.signed_out_at IS NULL
      AND (LOWER(vi.first_name) LIKE ? OR LOWER(vi.last_name) LIKE ?
           OR LOWER(vi.first_name || ' ' || vi.last_name) LIKE ?)
    ORDER BY v.signed_in_at DESC LIMIT 10`).all(`${q}%`, `${q}%`, `${q}%`);
  res.json(rows.map(r => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, signed_in_at: r.signed_in_at })));
});

kioskRouter.post('/sign-out', (req, res) => {
  const db = getDb();
  const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(trim(req.body?.visit_id, 60));
  if (!visit) return res.status(404).json({ error: 'We could not find that visit.' });
  if (visit.signed_out_at) return res.status(400).json({ error: 'That visit is already signed out.' });
  const location = trim(req.body?.location, 60) || visit.location;
  db.prepare(`UPDATE visitor_visits SET signed_out_at = datetime('now'), signed_out_method = 'kiosk',
              signed_out_location = ? WHERE id = ?`).run(location, visit.id);
  const vi = db.prepare('SELECT first_name, last_name FROM visitors WHERE id = ?').get(visit.visitor_id);
  logAudit(`visitor kiosk (${location})`, 'visitor_signed_out', 'visitor_visit', visit.id,
    { location }, null, null, `${vi?.first_name || ''} ${vi?.last_name || ''}`.trim());
  res.json({ ok: true, name: `${vi?.first_name || ''} ${vi?.last_name || ''}`.trim() });
});

// ── AUTHENTICATED: the log ──────────────────────────────────────────────────

const shapeVisit = (r) => ({
  ...r,
  custom_data: parseJson(r.custom_data, {}) || {},
  name: `${r.first_name} ${r.last_name}`,
  on_site: !r.signed_out_at,
  // Said in words rather than left for the reader to infer from a NULL.
  signed_out_label: !r.signed_out_at ? 'On site'
    : r.signed_out_method === 'auto' ? 'Closed automatically — actual departure time not recorded'
      : r.signed_out_method === 'staff' ? 'Signed out by staff' : 'Signed out at the kiosk',
});

router.get('/visits', (req, res) => {
  const db = getDb();
  autoSignOutStaleVisits(db);
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const where = [];
  const params = [];
  if (req.query.on_site === 'true') where.push('v.signed_out_at IS NULL');
  if (req.query.from) { where.push('v.signed_in_at >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('v.signed_in_at <= ?'); params.push(`${req.query.to} 23:59:59`); }
  if (req.query.q) {
    where.push('(LOWER(vi.first_name || \' \' || vi.last_name) LIKE ? OR LOWER(vi.email) LIKE ?)');
    const q = `%${norm(req.query.q)}%`;
    params.push(q, q);
  }
  const sql = `SELECT v.*, vi.first_name, vi.last_name, vi.email, vi.company,
                 (SELECT COUNT(*) FROM visitor_signatures s WHERE s.visit_id = v.id) AS signature_count
               FROM visitor_visits v JOIN visitors vi ON vi.id = v.visitor_id
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY v.signed_in_at DESC LIMIT ?`;
  res.json(db.prepare(sql).all(...params, limit).map(shapeVisit));
});

router.get('/visits/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT v.*, vi.first_name, vi.last_name, vi.email, vi.company
                          FROM visitor_visits v JOIN visitors vi ON vi.id = v.visitor_id WHERE v.id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Visit not found' });
  const signatures = db.prepare(`SELECT s.*, a.title, a.body
                                 FROM visitor_signatures s JOIN visitor_agreements a ON a.id = s.agreement_id
                                 WHERE s.visit_id = ?`).all(row.id);
  res.json({ ...shapeVisit(row), signatures });
});

router.get('/people', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const q = norm(req.query.q);
  const sql = `SELECT * FROM visitors
               ${q ? "WHERE LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ?" : ''}
               ORDER BY last_seen_at DESC LIMIT ?`;
  const params = q ? [`%${q}%`, `%${q}%`, limit] : [limit];
  res.json(db.prepare(sql).all(...params).map(v => ({ ...v, custom_data: parseJson(v.custom_data, {}) || {} })));
});

// Staff closing out somebody who left without signing out. Distinct from 'auto'
// because a person decided this, and distinct from 'kiosk' because the visitor
// did not do it themselves.
router.post('/visits/:id/sign-out', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Signing a visitor out needs the office, QA or a supervisor.' });
  const db = getDb();
  const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Visit not found' });
  if (visit.signed_out_at) return res.status(400).json({ error: 'That visit is already signed out.' });
  db.prepare(`UPDATE visitor_visits SET signed_out_at = datetime('now'), signed_out_method = 'staff',
              signed_out_by = ?, signed_out_location = ? WHERE id = ?`)
    .run(req.user.name, trim(req.body?.location, 60) || visit.location, visit.id);
  logAudit(req.user, 'visitor_signed_out', 'visitor_visit', visit.id, { by: 'staff' }, visit, null, visit.id);
  res.json({ ok: true });
});

// The agreements themselves. Read is open to anyone signed in; issuing a new
// revision is admin, because it changes what every future visitor agrees to.
router.get('/agreements', (_req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM visitor_signatures s WHERE s.agreement_id = a.id) AS signature_count
                       FROM visitor_agreements a ORDER BY a.code, a.created_at DESC`).all());
});

router.post('/agreements', requireRole('admin'), (req, res) => {
  const db = getDb();
  const code = trim(req.body?.code, 30).toUpperCase();
  const title = trim(req.body?.title, 160);
  const revision = trim(req.body?.revision, 40);
  const body = String(req.body?.body ?? '').trim();
  if (!code || !title || !revision || !body) {
    return res.status(400).json({ error: 'A document needs a code, a title, a revision and its wording.' });
  }
  if (db.prepare('SELECT 1 FROM visitor_agreements WHERE code = ? AND revision = ?').get(code, revision)) {
    // Re-using a revision number would let the wording behind existing
    // signatures change. Issue the next revision instead.
    return res.status(409).json({ error: `${code} ${revision} already exists. Issue a new revision rather than replacing one.` });
  }
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO visitor_agreements (id, code, title, revision, body, body_sha256, require_signature, is_active, effective_from, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, code, title, revision, body, sha256(body), req.body?.require_signature === false ? 0 : 1,
        trim(req.body?.effective_from, 20) || new Date().toISOString().slice(0, 10), req.user.name);
    db.prepare('UPDATE visitor_agreements SET is_active = 0 WHERE code = ? AND id != ?').run(code, id);
  })();
  logAudit(req.user, 'create', 'visitor_agreement', id, { code, revision, title }, null, null, `${code} ${revision}`);
  res.status(201).json(db.prepare('SELECT * FROM visitor_agreements WHERE id = ?').get(id));
});

router.get('/stats', (_req, res) => {
  const db = getDb();
  autoSignOutStaleVisits(db);
  const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  res.json({
    on_site: one('SELECT COUNT(*) c FROM visitor_visits WHERE signed_out_at IS NULL'),
    today: one("SELECT COUNT(*) c FROM visitor_visits WHERE date(signed_in_at) = date('now')"),
    this_month: one("SELECT COUNT(*) c FROM visitor_visits WHERE signed_in_at >= date('now','start of month')"),
    people: one('SELECT COUNT(*) c FROM visitors'),
    auto_closed_30d: one("SELECT COUNT(*) c FROM visitor_visits WHERE signed_out_method = 'auto' AND signed_in_at >= date('now','-30 day')"),
  });
});

export { seedVisitorAgreements };
export default router;
