import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import { CERT_ASSETS_DIR } from '../cert-seed.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

// Everyone with the module can view; supervisors/QA/admin manage.
const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

const STATUS_DAYS = 90; // "expiring soon" window

// extracted_text is SEARCHED, NEVER SHIPPED — it's the inside of the PDF, and
// the client only ever needs to know a search hit there (snippet) or that the
// row is text-searchable at all.
const PUBLIC_COLS = `id, person_name, cert_type, issuer, cert_number, issued_date, expiry_date,
  notes, filename, storage_key, content_type, asset_file, created_by, created_at, updated_at`;

function withStatus(row) {
  let status = 'valid';
  if (row.expiry_date) {
    const days = Math.floor((new Date(row.expiry_date) - Date.now()) / 86400000);
    status = days < 0 ? 'expired' : days <= STATUS_DAYS ? 'expiring' : 'valid';
  }
  const { storage_key, asset_file, ...rest } = row;
  return { ...rest, storage_key, status, has_file: !!(storage_key || asset_file), seeded_asset: !!asset_file };
}

function snippetAround(text, term) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, at + term.length + 60).replace(/\s+/g, ' ').trim()}…`;
}

router.get('/', (req, res) => {
  const db = getDb();
  const q = (req.query.q || '').toString().trim();
  let rows;
  if (q && String(q).trim()) {
    const like = `%${q}%`;
    rows = db.prepare(`SELECT ${PUBLIC_COLS}, extracted_text FROM certifications
      WHERE person_name LIKE ? OR cert_type LIKE ? OR issuer LIKE ? OR cert_number LIKE ?
         OR notes LIKE ? OR filename LIKE ? OR extracted_text LIKE ?
      ORDER BY person_name, expiry_date`).all(like, like, like, like, like, like, like)
      .map(r => {
        const { extracted_text, ...rest } = r;
        const inMeta = [r.person_name, r.cert_type, r.issuer, r.cert_number, r.notes, r.filename]
          .some(v => v && v.toLowerCase().includes(q.toLowerCase()));
        // Only surface a snippet when the text is the REASON the row matched —
        // a snippet on every row would just repeat the metadata above it.
        const snippet = !inMeta && extracted_text ? snippetAround(extracted_text, q) : null;
        return withStatus({ ...rest, ...(snippet ? { snippet } : {}) });
      });
  } else {
    rows = db.prepare(`SELECT ${PUBLIC_COLS} FROM certifications ORDER BY person_name, expiry_date`).all().map(withStatus);
  }
  res.json({ certifications: rows, storage: storageEnabled(), q });
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage certifications.' });
  const { person_name, cert_type, issuer, cert_number, issued_date, expiry_date, notes } = req.body;
  if (!person_name?.trim() || !cert_type?.trim()) return res.status(400).json({ error: 'Person and certification type are required.' });
  const db = getDb();
  const id = uuid();
  let storage_key = null, filename = null, content_type = null, extracted_text = null;
  if (req.file) {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — save without the file or configure R2.' });
    filename = (req.file.originalname || 'certificate').slice(0, 255);
    content_type = req.file.mimetype || null;
    storage_key = `certs/${id}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putObject(storage_key, req.file.buffer, content_type);
    extracted_text = await extractInvoiceText(req.file.buffer, content_type, filename) || null;
  }
  db.prepare(`INSERT INTO certifications (id, person_name, cert_type, issuer, cert_number, issued_date, expiry_date, notes, filename, storage_key, content_type, extracted_text, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, person_name.trim(), cert_type.trim(), issuer || null, cert_number || null,
    issued_date || null, expiry_date || null, notes || null, filename, storage_key, content_type, extracted_text, req.user.name);
  logAudit(req.user, 'certification_created', 'certification', id, { person: person_name, type: cert_type }, null, null, `${person_name} — ${cert_type}`);
  res.status(201).json(withStatus(db.prepare(`SELECT ${PUBLIC_COLS} FROM certifications WHERE id = ?`).get(id)));
});

router.put('/:id', upload.single('file'), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage certifications.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  let { filename, storage_key, content_type, extracted_text, asset_file } = existing;
  if (req.file) {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured.' });
    if (storage_key) deleteObject(storage_key);
    filename = (req.file.originalname || 'certificate').slice(0, 255);
    content_type = req.file.mimetype || null;
    storage_key = `certs/${existing.id}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putObject(storage_key, req.file.buffer, content_type);
    extracted_text = await extractInvoiceText(req.file.buffer, content_type, filename) || null;
    asset_file = null; // a new upload supersedes the seeded copy — one file per record
  }
  db.prepare(`UPDATE certifications SET person_name=?, cert_type=?, issuer=?, cert_number=?, issued_date=?, expiry_date=?, notes=?,
    filename=?, storage_key=?, content_type=?, extracted_text=?, asset_file=?, updated_at=datetime('now') WHERE id=?`).run(
    (b.person_name ?? existing.person_name), (b.cert_type ?? existing.cert_type), b.issuer ?? existing.issuer,
    b.cert_number ?? existing.cert_number, b.issued_date ?? existing.issued_date, b.expiry_date ?? existing.expiry_date,
    b.notes ?? existing.notes, filename, storage_key, content_type, extracted_text, asset_file, existing.id);
  logAudit(req.user, 'certification_updated', 'certification', existing.id, { person: existing.person_name }, null, null, existing.person_name);
  res.json(withStatus(db.prepare(`SELECT ${PUBLIC_COLS} FROM certifications WHERE id = ?`).get(existing.id)));
});

// Where the bytes come from depends on where they live: an uploaded file gets
// a presigned R2 URL; a seeded asset streams from disk through /file/raw
// (authenticated — these carry names and certificate numbers, so they must
// never sit on the unauthenticated public/ path). The client is told which.
router.get('/:id/file', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!row || (!row.storage_key && !row.asset_file)) return res.status(404).json({ error: 'No file attached' });
  if (row.storage_key) {
    const url = await presignGet(row.storage_key, row.filename, row.content_type);
    if (!url) return res.status(503).json({ error: 'File storage unavailable' });
    return res.json({ url, filename: row.filename });
  }
  res.json({ raw: `/certifications/${row.id}/file/raw`, filename: row.filename });
});

router.get('/:id/file/raw', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!row?.asset_file) return res.status(404).json({ error: 'No file attached' });
  // basename() so a hand-edited row can never path-traverse out of the assets dir.
  const path = join(CERT_ASSETS_DIR, basename(row.asset_file));
  if (!existsSync(path)) return res.status(404).json({ error: 'File missing from the server bundle' });
  res.setHeader('Content-Type', row.content_type || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${(row.filename || 'certificate.pdf').replace(/"/g, '')}"`);
  res.sendFile(path);
});

router.delete('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage certifications.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.storage_key) deleteObject(row.storage_key);
  db.prepare('DELETE FROM certifications WHERE id = ?').run(row.id);
  logAudit(req.user, 'certification_deleted', 'certification', row.id, { person: row.person_name, type: row.cert_type }, null, null, row.person_name);
  res.json({ ok: true });
});

export default router;
