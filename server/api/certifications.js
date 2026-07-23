import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

// Everyone with the module can view; supervisors/QA/admin manage.
const canManage = (u) => u && (u.role === 'admin' || u.role === 'supervisor' || u.department === 'qa');

const STATUS_DAYS = 90; // "expiring soon" window

function withStatus(row) {
  let status = 'valid';
  if (row.expiry_date) {
    const days = Math.floor((new Date(row.expiry_date) - Date.now()) / 86400000);
    status = days < 0 ? 'expired' : days <= STATUS_DAYS ? 'expiring' : 'valid';
  }
  return { ...row, status, has_file: !!row.storage_key };
}

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM certifications ORDER BY person_name, expiry_date').all().map(withStatus);
  res.json({ certifications: rows, storage: storageEnabled() });
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage certifications.' });
  const { person_name, cert_type, issuer, cert_number, issued_date, expiry_date, notes } = req.body;
  if (!person_name?.trim() || !cert_type?.trim()) return res.status(400).json({ error: 'Person and certification type are required.' });
  const db = getDb();
  const id = uuid();
  let storage_key = null, filename = null, content_type = null;
  if (req.file) {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — save without the file or configure R2.' });
    filename = (req.file.originalname || 'certificate').slice(0, 255);
    content_type = req.file.mimetype || null;
    storage_key = `certs/${id}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putObject(storage_key, req.file.buffer, content_type);
  }
  db.prepare(`INSERT INTO certifications (id, person_name, cert_type, issuer, cert_number, issued_date, expiry_date, notes, filename, storage_key, content_type, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, person_name.trim(), cert_type.trim(), issuer || null, cert_number || null,
    issued_date || null, expiry_date || null, notes || null, filename, storage_key, content_type, req.user.name);
  logAudit(req.user, 'certification_created', 'certification', id, { person: person_name, type: cert_type }, null, null, `${person_name} — ${cert_type}`);
  res.status(201).json(withStatus(db.prepare('SELECT * FROM certifications WHERE id = ?').get(id)));
});

router.put('/:id', upload.single('file'), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage certifications.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  let { filename, storage_key, content_type } = existing;
  if (req.file) {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured.' });
    if (storage_key) deleteObject(storage_key);
    filename = (req.file.originalname || 'certificate').slice(0, 255);
    content_type = req.file.mimetype || null;
    storage_key = `certs/${existing.id}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putObject(storage_key, req.file.buffer, content_type);
  }
  db.prepare(`UPDATE certifications SET person_name=?, cert_type=?, issuer=?, cert_number=?, issued_date=?, expiry_date=?, notes=?,
    filename=?, storage_key=?, content_type=?, updated_at=datetime('now') WHERE id=?`).run(
    (b.person_name ?? existing.person_name), (b.cert_type ?? existing.cert_type), b.issuer ?? existing.issuer,
    b.cert_number ?? existing.cert_number, b.issued_date ?? existing.issued_date, b.expiry_date ?? existing.expiry_date,
    b.notes ?? existing.notes, filename, storage_key, content_type, existing.id);
  logAudit(req.user, 'certification_updated', 'certification', existing.id, { person: existing.person_name }, null, null, existing.person_name);
  res.json(withStatus(db.prepare('SELECT * FROM certifications WHERE id = ?').get(existing.id)));
});

router.get('/:id/file', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
  if (!row || !row.storage_key) return res.status(404).json({ error: 'No file attached' });
  const url = await presignGet(row.storage_key, row.filename, row.content_type);
  if (!url) return res.status(503).json({ error: 'File storage unavailable' });
  res.json({ url, filename: row.filename });
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
