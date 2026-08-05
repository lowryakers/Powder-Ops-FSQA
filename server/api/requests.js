// ReadyDoc feedback — "this is broken" / "can we add X" from the people using
// the app.
//
// The design constraint is that submitting has to be frictionless: one box, one
// button. Every extra required field is a reason not to bother, and a request
// nobody files is a problem nobody hears about. Triage is where the structure
// lives — an open checklist that gets ticked off.
//
// Deliberately not Task Center: app feedback isn't plant work, and mixing it in
// would dilute the operational task list people work from every day.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { createReadStream } from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';

const router = Router();

// Same wrapper shape as training materials: multer's own errors come back as a
// readable 413 rather than an unhandled throw.
const attachmentUpload = mediaUpload({ files: 5 }).array('files', 5);
const uploadAttachments = (req, res, next) => attachmentUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

// Attachments come back with the row, so a request reads as one thing rather
// than a body plus a second fetch. Uploads are presigned per read (short-lived
// URLs); links are returned as typed.
async function withAttachments(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const all = db.prepare(`SELECT * FROM app_request_attachments
    WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(...ids);
  const byReq = {};
  for (const a of all) {
    (byReq[a.request_id] ||= []).push({
      id: a.id, kind: a.kind, filename: a.filename, content_type: a.content_type, size: a.size,
      added_by: a.added_by, created_at: a.created_at,
      url: a.kind === 'link' ? a.url : (a.storage_key ? await presignGet(a.storage_key, a.filename) : null),
    });
  }
  return rows.map(r => ({ ...r, attachments: byReq[r.id] || [] }));
}

// Anyone who can see the app can report a problem with it — narrowing this
// would just mean the reports arrive as hallway conversation instead.
// Admins triage.
const canTriage = (u) => u?.role === 'admin';

router.get('/', (req, res) => {
  const db = getDb();
  const status = req.query.status === 'done' ? 'done' : req.query.status === 'all' ? null : 'open';
  const mine = req.query.mine === '1';
  let sql = 'SELECT * FROM app_requests WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  // A non-admin only sees their own — this is a suggestion box, not a forum.
  if (mine || !canTriage(req.user)) { sql += ' AND submitted_by_id = ?'; params.push(req.user?.id); }
  sql += " ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 300";
  Promise.resolve(withAttachments(db, db.prepare(sql).all(...params)))
    .then(rows => res.json(rows))
    .catch(() => res.json(db.prepare(sql).all(...params)));
});

// Counts for the badge — open items only.
router.get('/count', (req, res) => {
  const db = getDb();
  if (!canTriage(req.user)) {
    const n = db.prepare("SELECT COUNT(*) n FROM app_requests WHERE status = 'open' AND submitted_by_id = ?").get(req.user?.id).n;
    return res.json({ open: n });
  }
  res.json({ open: db.prepare("SELECT COUNT(*) n FROM app_requests WHERE status = 'open'").get().n });
});

router.post('/', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Type what you need and submit.' });
  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO app_requests (id, body, area, submitted_by, submitted_by_id)
              VALUES (?, ?, ?, ?, ?)`)
    .run(id, body.slice(0, 4000), String(req.body?.area || '').trim() || null,
      req.user?.name || null, req.user?.id || null);
  logAudit(req.user, 'create', 'app_request', id, { area: req.body?.area }, null, null, body.slice(0, 80));
  res.status(201).json(db.prepare('SELECT * FROM app_requests WHERE id = ?').get(id));
});

// Tick it off (or put it back).
router.put('/:id', (req, res) => {
  if (!canTriage(req.user)) return res.status(403).json({ error: 'Only an admin can update requests.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  const done = req.body?.status === 'done';
  db.prepare(`UPDATE app_requests SET status = ?, done_by = ?, done_at = ?, note = COALESCE(?, note) WHERE id = ?`)
    .run(done ? 'done' : 'open', done ? (req.user?.name || null) : null,
      done ? new Date().toISOString() : null,
      req.body?.note !== undefined ? String(req.body.note).slice(0, 2000) : null, req.params.id);
  res.json(db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  if (!canTriage(req.user)) return res.status(403).json({ error: 'Only an admin can delete requests.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  // Take the attachments with it, objects included — an orphaned screenshot in
  // the bucket is cost with nothing pointing at it.
  for (const a of db.prepare('SELECT storage_key FROM app_request_attachments WHERE request_id = ?').all(existing.id)) {
    if (a.storage_key) deleteObject(a.storage_key);
  }
  db.prepare('DELETE FROM app_request_attachments WHERE request_id = ?').run(existing.id);
  db.prepare('DELETE FROM app_requests WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'app_request', req.params.id, null, existing, null, (existing.body || '').slice(0, 80));
  res.json({ ok: true });
});

/* ── Attachments: a screenshot, a photo of the machine, a Drive link ──────── */

// Only the person who filed it, or an admin — an attachment is part of someone
// else's report.
const mayAttach = (u, r) => u?.role === 'admin' || (r.submitted_by_id && r.submitted_by_id === u?.id);

router.post('/:id/attachments', uploadAttachments, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const r = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (!mayAttach(req.user, r)) return res.status(403).json({ error: 'You can only attach to your own requests.' });

    const out = [];
    // A link needs no storage at all, so it works with R2 switched off.
    const link = String(req.body?.url || '').trim();
    if (link) {
      if (!/^https?:\/\//i.test(link)) return res.status(400).json({ error: 'A link must start with http:// or https://' });
      const id = uuid();
      db.prepare(`INSERT INTO app_request_attachments (id, request_id, kind, filename, url, added_by)
        VALUES (?, ?, 'link', ?, ?, ?)`)
        .run(id, r.id, (req.body?.title || link).slice(0, 200), link.slice(0, 2000), req.user?.name || null);
      out.push({ id, kind: 'link', filename: req.body?.title || link, url: link });
    }

    if (files.length) {
      if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server. A link still works.' });
      const tooBig = rejectOversize(files);
      if (tooBig) return res.status(413).json({ error: tooBig });
      for (const f of files) {
        const id = uuid();
        const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
        const key = `app-requests/${r.id}/${id}-${safe}`;
        await putStream(key, createReadStream(f.path), f.mimetype);
        db.prepare(`INSERT INTO app_request_attachments (id, request_id, kind, filename, content_type, size, storage_key, added_by)
          VALUES (?, ?, 'file', ?, ?, ?, ?, ?)`)
          .run(id, r.id, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null, key, req.user?.name || null);
        out.push({ id, kind: 'file', filename: f.originalname, content_type: f.mimetype, size: f.size });
      }
    }

    if (!out.length) return res.status(400).json({ error: 'Nothing to attach.' });
    logAudit(req.user, 'update', 'app_request', r.id, { attached: out.map(o => o.filename) }, null, null, (r.body || '').slice(0, 80));
    res.status(201).json(out);
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/attachments/:id', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM app_request_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const r = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(a.request_id);
  if (r && !mayAttach(req.user, r)) return res.status(403).json({ error: 'You can only change your own requests.' });
  db.prepare('DELETE FROM app_request_attachments WHERE id = ?').run(a.id);
  if (a.storage_key) deleteObject(a.storage_key);
  res.json({ ok: true });
});

export default router;
