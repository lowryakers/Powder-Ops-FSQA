import { Router } from 'express';
import { createReadStream } from 'fs';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { aiEnabled, draftPolicy } from '../ai.js';
import { storageEnabled, putStream, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { extractInvoiceText } from '../invoice-text.js';
import { hasExplicitEdit } from '../module-access.js';
import { titleFromFilename, revisionFromFilename } from '../filename-meta.js';

/**
 * Company policies — the handbook side of the plant (PTO, grievance, conduct).
 *
 * DELIBERATELY NOT the controlled-document registry. An SOP is a controlled
 * record with a revision, an owner and Document Control approval; a policy is
 * a statement of how the company operates. Putting them in one list would mean
 * an auditor asking for SOP 401 gets handed the PTO policy, and it would drag
 * every handbook edit through a Document Change Request. They stay apart.
 *
 * Two rules shape the access model:
 *
 *  1. **`visible_to_staff` is per POLICY, not per person.** Most of the
 *     handbook is for everyone; a few (say, the pay-review rubric) are for
 *     managers. Making that a module permission would force the whole
 *     handbook to one audience or the other.
 *  2. **Only a PUBLISHED policy is ever visible to staff.** A draft is someone
 *     thinking out loud, and an employee reading a half-written rule as if it
 *     were the rule is worse than not having it in the app at all.
 */
const router = Router();
const MODULE_ID = 'policies';

const isAdmin = (u) => u?.role === 'admin';
const dept = (u) => String(u?.department || '').toLowerCase();
// Who maintains the handbook: admins, the office (Marnee), or an explicit grant.
const canManage = (u) => isAdmin(u) || ['office', 'admin', 'hr'].includes(dept(u)) || hasExplicitEdit(u, MODULE_ID);
function requireManage(req, res) {
  if (canManage(req.user)) return true;
  res.status(403).json({ error: 'Editing policies is limited to the office and admins.' });
  return false;
}

const today = () => new Date().toISOString().slice(0, 10);
const STATUSES = ['draft', 'published', 'retired'];

// The extracted text is megabytes of OCR and never leaves the server; the
// client gets whether it worked and, on a search, a snippet around the hit.
const publicFields = (r) => ({
  id: r.id, code: r.code, title: r.title, category: r.category, summary: r.summary,
  body: r.body, filename: r.filename, content_type: r.content_type, size: r.size,
  has_file: !!r.storage_key,
  searchable: r.text_status === 'ok' && !!r.extracted_text,
  text_status: r.text_status,
  status: r.status, visible_to_staff: !!r.visible_to_staff,
  version: r.version, effective_date: r.effective_date, review_date: r.review_date,
  owner: r.owner, created_by: r.created_by, updated_by: r.updated_by,
  created_at: r.created_at, updated_at: r.updated_at,
});

/** A short window around the first hit, so search says WHY a policy matched. */
function snippetFor(row, needle) {
  const n = needle.toLowerCase();
  for (const field of ['summary', 'body', 'extracted_text']) {
    const hay = String(row[field] || '');
    const at = hay.toLowerCase().indexOf(n);
    if (at < 0) continue;
    const from = Math.max(0, at - 90);
    return `${from > 0 ? '…' : ''}${hay.slice(from, at + n.length + 130).replace(/\s+/g, ' ').trim()}…`;
  }
  return null;
}

router.get('/', (req, res) => {
  const db = getDb();
  const manage = canManage(req.user);
  const q = String(req.query.q || '').trim();

  let sql = 'SELECT * FROM policies WHERE 1=1';
  const params = [];
  // Everyone else sees the published, staff-visible handbook and nothing else.
  if (!manage) sql += " AND status = 'published' AND visible_to_staff = 1";
  else if (req.query.status && STATUSES.includes(req.query.status)) { sql += ' AND status = ?'; params.push(req.query.status); }
  if (req.query.category) { sql += ' AND category = ?'; params.push(req.query.category); }

  if (q) {
    // The uploaded document's text is searched too — "everything in the doc is
    // searchable" is the point of extracting it.
    sql += ' AND (title LIKE ? OR code LIKE ? OR summary LIKE ? OR body LIKE ? OR extracted_text LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY (status = 'retired'), category, title LIMIT 500";

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...publicFields(r), ...(q ? { snippet: snippetFor(r, q) } : {}) })));
});

router.get('/categories', (req, res) => {
  const db = getDb();
  const manage = canManage(req.user);
  const rows = db.prepare(`SELECT category, COUNT(*) c FROM policies
    WHERE category IS NOT NULL AND category != ''
    ${manage ? '' : "AND status = 'published' AND visible_to_staff = 1"}
    GROUP BY category ORDER BY category`).all();
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!canManage(req.user) && !(r.status === 'published' && r.visible_to_staff)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const out = publicFields(r);
  if (r.storage_key) out.file_url = await presignGet(r.storage_key, r.filename);
  res.json(out);
});

const EDITABLE = ['code', 'title', 'category', 'summary', 'body', 'version', 'effective_date', 'review_date', 'owner'];

router.post('/', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A title is required.' });
  const id = uuid();
  db.prepare(`INSERT INTO policies (id, code, title, category, summary, body, version, effective_date, review_date, owner, visible_to_staff, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.body?.code || null, title, req.body?.category || null,
    req.body?.summary || null, req.body?.body || null, req.body?.version || null,
    req.body?.effective_date || null, req.body?.review_date || null, req.body?.owner || null,
    req.body?.visible_to_staff ? 1 : 0, req.user?.name || null, req.user?.name || null);
  logAudit(req.user, 'create', 'policy', id, { title }, null, null, title);
  res.status(201).json(publicFields(db.prepare('SELECT * FROM policies WHERE id = ?').get(id)));
});

router.put('/:id', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const sets = [], vals = [];
  for (const f of EDITABLE) {
    if (req.body[f] === undefined) continue;
    sets.push(`${f} = ?`); vals.push(req.body[f] || null);
  }
  if (req.body.visible_to_staff !== undefined) { sets.push('visible_to_staff = ?'); vals.push(req.body.visible_to_staff ? 1 : 0); }
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
    sets.push('status = ?'); vals.push(req.body.status);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  sets.push('updated_by = ?', "updated_at = datetime('now')");
  vals.push(req.user?.name || null, existing.id);
  db.prepare(`UPDATE policies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  const updated = db.prepare('SELECT * FROM policies WHERE id = ?').get(existing.id);
  logAudit(req.user, 'update', 'policy', existing.id, req.body, existing, updated, existing.title);
  res.json(publicFields(updated));
});

// Publishing is the act that makes a policy real, so it's its own endpoint —
// and a policy with nothing in it (no body, no file) can't be published: an
// employee opening an empty rule is worse than not finding one.
router.post('/:id/publish', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!String(p.body || '').trim() && !p.storage_key) {
    return res.status(400).json({ error: 'There is nothing to publish yet — write the policy or attach the document first.' });
  }
  db.prepare("UPDATE policies SET status='published', effective_date=COALESCE(effective_date, ?), updated_by=?, updated_at=datetime('now') WHERE id=?")
    .run(today(), req.user?.name || null, p.id);
  logAudit(req.user, 'approve', 'policy', p.id, { published: true }, p, null, p.title);
  res.json(publicFields(db.prepare('SELECT * FROM policies WHERE id = ?').get(p.id)));
});

// Retired, not deleted: people were told this policy applied, and the record
// that it existed is what makes "what were we doing in March" answerable.
router.post('/:id/retire', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE policies SET status='retired', visible_to_staff=0, updated_by=?, updated_at=datetime('now') WHERE id=?")
    .run(req.user?.name || null, p.id);
  logAudit(req.user, 'update', 'policy', p.id, { retired: true }, p, null, p.title);
  res.json(publicFields(db.prepare('SELECT * FROM policies WHERE id = ?').get(p.id)));
});

// Only a draft can be removed outright — anything that was ever published is
// retired instead, for the reason above.
router.delete('/:id', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'draft') {
    return res.status(400).json({ error: 'Only a draft can be deleted. Retire a published policy instead, so the record that it existed survives.' });
  }
  db.prepare('DELETE FROM policies WHERE id = ?').run(p.id);
  if (p.storage_key) deleteObject(p.storage_key);
  logAudit(req.user, 'delete', 'policy', p.id, null, p, null, p.title);
  res.json({ deleted: p.id });
});

// ── The document itself ──────────────────────────────────────────────────────
// Marnee works in Google Docs; the way in is File → Download → PDF (or DOCX),
// then upload it here. The text is pulled out on upload so a search finds a
// phrase printed INSIDE the document, which is the actual ask.
const policyUpload = mediaUpload({ files: 1 }).single('file');
const uploadPolicyFile = (req, res, next) => policyUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

router.post('/:id/file', uploadPolicyFile, async (req, res) => {
  const files = req.file ? [req.file] : [];
  try {
    if (!requireManage(req, res)) return;
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    const db = getDb();
    const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const safe = (req.file.originalname || 'policy').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `policies/${p.id}/${uuid()}-${safe}`;
    await putStream(key, createReadStream(req.file.path), req.file.mimetype);

    let text = null, status = 'none';
    try {
      const buf = await getObjectBuffer(key);
      text = await extractInvoiceText(buf, req.file.mimetype, req.file.originalname);
      status = text && text.trim() ? 'ok' : 'empty';
    } catch (e) {
      status = 'failed';
      console.warn('[policies] text extraction failed:', e.message);
    }

    // Replacing a document: the old object goes only after the new one is in.
    const old = p.storage_key;
    db.prepare(`UPDATE policies SET storage_key=?, filename=?, content_type=?, size=?, extracted_text=?, text_status=?,
      updated_by=?, updated_at=datetime('now') WHERE id=?`).run(
      key, (req.file.originalname || 'policy').slice(0, 255), req.file.mimetype || null,
      req.file.size || null, text || null, status, req.user?.name || null, p.id);
    if (old && old !== key) deleteObject(old);

    logAudit(req.user, 'update', 'policy', p.id, { file: req.file.originalname, text_status: status }, null, null, p.title);
    res.status(201).json(publicFields(db.prepare('SELECT * FROM policies WHERE id = ?').get(p.id)));
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/:id/file', (req, res) => {
  if (!requireManage(req, res)) return;
  const db = getDb();
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!p.storage_key) return res.status(400).json({ error: 'No document attached.' });
  db.prepare("UPDATE policies SET storage_key=NULL, filename=NULL, content_type=NULL, size=NULL, extracted_text=NULL, text_status=NULL, updated_at=datetime('now') WHERE id=?").run(p.id);
  deleteObject(p.storage_key);
  logAudit(req.user, 'delete', 'policy', p.id, { removed_file: p.filename }, null, null, p.title);
  res.json({ ok: true });
});

// ── Importing policies you already have ──────────────────────────────────────
//
// Most of the handbook exists already as files. Re-typing a title for each one
// to create an empty policy and then attaching the document is pure
// redundancy, so this does what the controlled-document importer does: read
// the files, propose a title per file, and create them once you've confirmed.
//
// Two steps, and the first WRITES NOTHING. The titles come from filenames, and
// a filename is a guess — thirty policies imported under wrong titles is worse
// than thirty minutes of typing. The client re-sends the files on commit, so
// there's no half-finished import sitting in a stash table.
//
// Everything lands as a DRAFT that staff cannot see. Publishing stays the
// deliberate act it is everywhere else in this module.
const policyImport = mediaUpload({ files: 40 }).array('files', 40);
const uploadPolicyBatch = (req, res, next) => policyImport(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

router.post('/import/analyze', uploadPolicyBatch, (req, res) => {
  const files = req.files || [];
  try {
    if (!requireManage(req, res)) return;
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const db = getDb();
    const existing = db.prepare('SELECT title FROM policies').all()
      .map(r => String(r.title || '').trim().toLowerCase());
    res.json({
      files: files.map(f => {
        const title = titleFromFilename(f.originalname);
        const version = revisionFromFilename(f.originalname);
        return {
          filename: f.originalname,
          title,
          version,
          size: f.size,
          // Already on file: offered unticked rather than silently skipped, so
          // re-importing a corrected copy is still possible on purpose.
          exists: existing.includes(title.toLowerCase()),
        };
      }),
      storage_ready: storageEnabled(),
    });
  } finally {
    cleanupTemp(files);
  }
});

router.post('/import', uploadPolicyBatch, async (req, res) => {
  const files = req.files || [];
  try {
    if (!requireManage(req, res)) return;
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const db = getDb();
    // { "<filename>": { title, category, include } } — a file the client didn't
    // tick is not imported. Absent metadata means "use what analyze proposed".
    let meta = {};
    try { meta = JSON.parse(req.body?.meta || '{}') || {}; } catch { meta = {}; }

    const summary = { created: 0, skipped: 0, failed: 0, policies: [], problems: [] };
    for (const f of files) {
      const m = meta[f.originalname] || {};
      if (m.include === false) { summary.skipped++; continue; }
      const title = String(m.title || titleFromFilename(f.originalname)).trim().slice(0, 200);
      if (!title) { summary.problems.push({ filename: f.originalname, reason: 'no title could be derived' }); summary.failed++; continue; }

      try {
        const id = uuid();
        const safe = (f.originalname || 'policy').replace(/[^\w.-]+/g, '_').slice(0, 120);
        const key = `policies/${id}/${uuid()}-${safe}`;
        await putStream(key, createReadStream(f.path), f.mimetype);

        let text = null, status = 'none';
        try {
          const buf = await getObjectBuffer(key);
          text = await extractInvoiceText(buf, f.mimetype, f.originalname);
          status = text && text.trim() ? 'ok' : 'empty';
        } catch { status = 'failed'; }

        db.prepare(`INSERT INTO policies (id, title, category, version, storage_key, filename, content_type, size,
          extracted_text, text_status, visible_to_staff, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
          id, title, m.category || null, m.version || revisionFromFilename(f.originalname) || null,
          key, (f.originalname || 'policy').slice(0, 255), f.mimetype || null, f.size || null,
          text || null, status, req.user?.name || null, req.user?.name || null);
        summary.created++;
        summary.policies.push({ id, title, searchable: status === 'ok' });
      } catch (e) {
        summary.failed++;
        summary.problems.push({ filename: f.originalname, reason: e.message });
      }
    }
    logAudit(req.user, 'import', 'policy', 'batch', { created: summary.created, skipped: summary.skipped, failed: summary.failed }, null, null, 'Policy import');
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

// ── AI draft ─────────────────────────────────────────────────────────────────
// Returns text and writes NOTHING. A drafted policy is a starting point for a
// person to edit and then publish deliberately — the publish step is what makes
// it the company's word, and that stays a human act.
router.post('/draft', async (req, res) => {
  if (!requireManage(req, res)) return;
  if (!aiEnabled()) return res.status(503).json({ error: 'AI drafting is not configured on this server.' });
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Give the policy a title first — that is what it drafts against.' });
  try {
    const body = await draftPolicy({ title, category: req.body?.category, notes: req.body?.notes });
    res.json({ body, drafted: true });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Drafting failed.' });
  }
});

export default router;
