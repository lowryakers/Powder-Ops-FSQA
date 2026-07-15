import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { getDb, logAudit } from '../db.js';

const router = Router();

const MAX_IMPORT_MB = 50;

// Accept a broad set of document files. Unsupported types are NOT rejected
// here (that would abort the whole batch) — they are accepted and flagged
// per-file during extraction so a mixed upload still imports what it can.
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_MB * 1024 * 1024, files: 100 },
});

// Wrap multer so its size/count errors come back as a clear 400 instead of a
// generic 500, and one oversized file doesn't silently kill the whole import.
function receiveImportFiles(req, res, next) {
  importUpload.array('files', 100)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `A file exceeds the ${MAX_IMPORT_MB} MB limit. Split or compress it and try again.` });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files in one batch (max 100). Upload in smaller groups.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

// Cluster x-positions (cell starts) into column boundaries within a table block.
function clusterColumns(starts, tol) {
  const sorted = [...starts].sort((a, b) => a - b);
  const clusters = [];
  for (const x of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.center <= tol) { last.xs.push(x); last.center = last.xs.reduce((s, v) => s + v, 0) / last.xs.length; }
    else clusters.push({ center: x, xs: [x] });
  }
  return clusters.map(c => c.center);
}

// Pull text out of a PDF, reconstructing tables from text x/y positions so
// ruled SOP tables come through as Markdown tables instead of jumbled text.
async function extractPdfText(buffer) {
  const pdfDoc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const parts = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    // 1) group items into visual rows by y
    const items = content.items
      // Drop whitespace-only fragments: some PDFs pad column gaps with a wide
      // blank item, which otherwise hides the gap and merges the columns.
      .filter(it => it.str !== undefined && it.str.trim() !== '')
      .map(it => ({ str: it.str, x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, w: it.width || 0, h: it.height || Math.abs(it.transform?.[3]) || 10 }));
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= Math.max(3, it.h * 0.5)) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    // 2) split each row into cells on large horizontal gaps
    const rowCells = rows.map(r => {
      const its = r.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null, prevEnd = null;
      for (const it of its) {
        const gap = prevEnd == null ? 0 : it.x - prevEnd;
        const threshold = Math.max(14, it.h * 1.4);
        if (cur && gap <= threshold) { cur.text += (gap > it.h * 0.25 ? ' ' : '') + it.str; }
        else { cur = { x: it.x, text: it.str }; cells.push(cur); }
        prevEnd = it.x + it.w;
      }
      return cells.map(c => ({ x: c.x, text: c.text.trim() })).filter(c => c.text !== '');
    });
    // 3) walk rows; runs of multi-cell rows become tables, the rest stay text
    const out = [];
    let i = 0;
    while (i < rowCells.length) {
      const isMulti = (r) => r && r.length >= 2;
      if (isMulti(rowCells[i]) && isMulti(rowCells[i + 1])) {
        const block = [];
        while (i < rowCells.length && isMulti(rowCells[i])) block.push(rowCells[i++]);
        const maxCells = Math.max(...block.map(r => r.length));
        if (maxCells >= 3 || block.length >= 3) {
          const cols = clusterColumns(block.flatMap(r => r.map(c => c.x)), 24);
          const nearest = (x) => { let bi = 0, bd = Infinity; cols.forEach((cx, ci) => { const d = Math.abs(cx - x); if (d < bd) { bd = d; bi = ci; } }); return bi; };
          const grid = block.map(r => { const g = Array(cols.length).fill(''); for (const c of r) { const ci = nearest(c.x); g[ci] = (g[ci] ? g[ci] + ' ' : '') + c.text; } return g; });
          const line = (r) => '| ' + r.map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |';
          const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
          out.push('', line(grid[0]), sep, ...grid.slice(1).map(line), '');
        } else {
          for (const r of block) out.push(r.map(c => c.text).join('  '));
        }
      } else {
        if (rowCells[i]?.length) out.push(rowCells[i].map(c => c.text).join('  '));
        i++;
      }
    }
    parts.push(out.join('\n'));
  }
  return { text: parts.join('\n').replace(/\n{3,}/g, '\n\n').trim(), pages: pdfDoc.numPages };
}

// Convert flat extracted PDF text into structured Markdown (headings, bullets,
// numbered steps) so imported drafts arrive readable instead of a wall of text.
const SECTION_RE = /^(purpose|scope|responsibilit(?:y|ies)|procedures?|definitions?|references?|materials?|equipment|safety|ppe|records?|revision history|version history|overview|policy|policies|objectives?|introduction|documentation|monitoring|corrective actions?|preventive (?:measures?|actions?)|verification|frequency|training|approval|distribution)\b[:.]?\s*$/i;

function textToMarkdown(text) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (!line) { out.push(''); continue; }
    // Reconstructed table rows pass through untouched (keep GFM pipes intact)
    if (line.startsWith('|')) { out.push(line); continue; }
    // Bullets: various glyphs -> "- "
    const b = line.match(/^[•◦▪·‣∙*•▪-]\s+(.*)$/);
    if (b) { out.push('- ' + b[1]); continue; }
    // Numbered / lettered steps -> normalized ordered list
    const n = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (n) { out.push(`${n[1]}. ${n[2]}`); continue; }
    // Headings: known section keyword, "Title:" line, or a short ALL-CAPS line
    const isSection = SECTION_RE.test(line) || (line.length <= 48 && /^[A-Z][A-Za-z ]+:$/.test(line));
    // Multi-word ALL-CAPS line (single tokens like "SSOP-01" or "GMP" are values, not headings)
    const isCaps = line.length <= 60 && /\s/.test(line) && /[A-Z]/.test(line) && line === line.toUpperCase()
      && /^[A-Z0-9 ,/&().:'-]+$/.test(line) && !/\.{2,}/.test(line) && line.split(' ').length <= 9;
    if (isSection || isCaps) { out.push('## ' + line.replace(/:$/, '')); continue; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── HTML → Markdown (for Word docs; preserves tables as GFM) ────────────────
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function stripTags(s) { return decodeEntities(s.replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ')).trim(); }

function htmlTableToGfm(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m => [...m[1].matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)].map(c => stripTags(c[2]).replace(/\n/g, ' ')))
    .filter(r => r.length);
  if (!rows.length) return '';
  const cols = Math.max(...rows.map(r => r.length));
  const pad = (r) => { const a = r.slice(); while (a.length < cols) a.push(''); return a; };
  const line = (r) => '| ' + pad(r).map(c => c.replace(/\|/g, '\\|')).join(' | ') + ' |';
  const sep = '| ' + Array(cols).fill('---').join(' | ') + ' |';
  return '\n' + [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n') + '\n';
}

// Convert mammoth's (clean, predictable) HTML into Markdown, keeping tables.
function htmlToMarkdown(html) {
  let s = html.replace(/<table[\s\S]*?<\/table>/gi, m => htmlTableToGfm(m));
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, c) => `\n${'#'.repeat(Math.min(+l, 3))} ${stripTags(c)}\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c)}\n`);
  s = s.replace(/<\/(ul|ol)>/gi, '\n').replace(/<(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, __, c) => `**${c}**`);
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, __, c) => `*${c}*`);
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, c) => `[${stripTags(c)}](${href})`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '');
  // strip any remaining tags outside of the GFM tables we already built
  s = s.split('\n').map(line => line.trim().startsWith('|') ? line : stripTags(line)).join('\n');
  return decodeEntities(s).replace(/\n{3,}/g, '\n\n').trim();
}

// Extract plain/markdown-ish text from a supported document buffer. Returns
// { text, pages } or throws with a user-facing reason for unsupported types.
async function extractDocText(file) {
  const name = file.originalname || '';
  if (/\.pdf$/i.test(name) || file.mimetype === 'application/pdf') {
    return extractPdfText(file.buffer);
  }
  if (/\.docx$/i.test(name) || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Use mammoth's HTML (it preserves Word tables as real <table>, which its
    // markdown output flattens) and convert to Markdown incl. GFM tables.
    const { value } = await mammoth.convertToHtml({ buffer: file.buffer });
    return { text: htmlToMarkdown(value || ''), pages: null, isMarkdown: true };
  }
  if (/\.(txt|md|markdown)$/i.test(name) || file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
    return { text: file.buffer.toString('utf8').trim(), pages: null, isMarkdown: /\.(md|markdown)$/i.test(name) };
  }
  if (/\.doc$/i.test(name)) {
    throw new Error('Legacy .doc files are not supported — save as .docx or PDF and re-upload.');
  }
  throw new Error('Unsupported file type — upload a PDF, Word (.docx), text, or Markdown file.');
}

// Strip common cloud/OS duplication noise from a filename before parsing
function cleanFilename(filename) {
  let s = filename.replace(/\.(pdf|docx?|txt|md|markdown)$/i, '');
  s = s.replace(/[_]+/g, ' ');
  // Leading "Copy of " (possibly repeated, e.g. "Copy of Copy of ...")
  s = s.replace(/^(?:\s*copy\s+of\s+)+/i, '');
  // Trailing duplicate markers: " - Copy", " copy", " (1)", " - Copy (2)"
  s = s.replace(/[\s-]*copy(?:\s*\(\d+\))?\s*$/i, '');
  s = s.replace(/\s*\(\d+\)\s*$/, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// Best-effort guess of a document number and title from filename + first lines
function guessMeta(filename, text) {
  const base = cleanFilename(filename);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const numRe = /\b((?:SOP|WI|JD|POL|FORM|F|QP|HACCP)[-\s]?\d{1,4}(?:[-.]\d{1,3})?)\b/i;
  let doc_number = '';
  const fromName = base.match(numRe);
  if (fromName) doc_number = fromName[1].toUpperCase().replace(/\s+/g, '-');
  else {
    for (const l of lines.slice(0, 8)) { const m = l.match(numRe); if (m) { doc_number = m[1].toUpperCase().replace(/\s+/g, '-'); break; } }
  }
  // Title: filename minus the doc number, else first substantial line
  let title = base.replace(numRe, '').replace(/^[-\s]+|[-\s]+$/g, '').trim();
  if (!title || title.length < 3) {
    title = lines.find(l => l.length > 4 && l.length < 90 && !numRe.test(l)) || base;
  }
  return { doc_number, title: title.slice(0, 120) };
}

// POST /extract — parse uploaded documents into draft candidates (does not
// save). PDFs, Word (.docx), and text/Markdown files are supported; any
// unsupported or unreadable file is returned with ok:false so the rest of the
// batch still imports.
router.post('/extract', receiveImportFiles, async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  const out = [];
  for (const f of req.files) {
    try {
      const { text, pages, isMarkdown } = await extractDocText(f);
      const { doc_number, title } = guessMeta(f.originalname, text);
      // mammoth/Markdown sources already carry structure — don't re-mangle them.
      const content = isMarkdown ? text : textToMarkdown(text);
      out.push({ filename: f.originalname, doc_number, title, content, pages, ok: true });
    } catch (err) {
      out.push({ filename: f.originalname, ok: false, error: err.message });
    }
  }
  res.json({ documents: out });
});

// POST /bulk — create many documents at once (from the reviewed import)
router.post('/bulk', (req, res) => {
  const db = getDb();
  const { documents } = req.body;
  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: 'documents array is required' });
  }
  const insert = db.prepare(`INSERT INTO sop_documents
    (id, doc_type, doc_number, title, category, revision, status, owner, description, source_file)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`);
  const insertVersion = db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    let count = 0;
    for (const d of documents) {
      if (!d.title || !d.category) continue;
      const type = ['sop', 'work_instruction', 'job_description', 'policy', 'form'].includes(d.doc_type) ? d.doc_type : 'sop';
      const id = uuid();
      insert.run(id, type, d.doc_number || '', d.title, d.category, d.revision || '1.0', d.owner || null, d.content || null, d.source_file || null);
      const created = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(id);
      insertVersion.run(uuid(), id, created.revision, req.user.name, 'Imported', JSON.stringify(created));
      count++;
    }
    return count;
  });
  const imported = tx();
  logAudit(req.user, 'documents_bulk_imported', 'document', null, { imported });
  res.status(201).json({ imported });
});

// Supported controlled-document types. The registry (sop_documents table) is
// shared; doc_type separates SOPs, Work Instructions, Job Descriptions, etc.
const DOC_TYPES = new Set(['sop', 'work_instruction', 'job_description', 'policy', 'form']);
const TYPE_LABEL = {
  sop: 'SOP',
  work_instruction: 'Work Instruction',
  job_description: 'Job Description',
  policy: 'Policy',
  form: 'Form',
};

const SORTABLE = { doc_number: 'doc_number', title: 'title', category: 'category', revision: 'revision', status: 'status', review_due: 'review_due', owner: 'owner', updated_at: 'updated_at' };

// GET / — list documents, filtered by doc_type/category/status/search
router.get('/', (req, res) => {
  const db = getDb();
  const { doc_type, category, status, sort, order, q } = req.query;
  let sql = 'SELECT * FROM sop_documents WHERE 1=1';
  const params = [];
  if (doc_type) { sql += ' AND doc_type = ?'; params.push(doc_type); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status != 'archived'"; }
  if (q) { sql += ' AND (LOWER(title) LIKE ? OR LOWER(doc_number) LIKE ? OR LOWER(owner) LIKE ?)'; const like = `%${q.toLowerCase()}%`; params.push(like, like, like); }

  const col = SORTABLE[sort] || 'doc_number';
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  sql += ` ORDER BY ${col} ${dir}, doc_number ASC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

router.get('/:id/versions', (req, res) => {
  const db = getDb();
  const versions = db.prepare('SELECT * FROM sop_versions WHERE sop_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(versions);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { doc_type, doc_number, title, category, revision, effective_date, review_due, owner, status, content, source_file } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category are required' });
  const type = DOC_TYPES.has(doc_type) ? doc_type : 'sop';
  const id = uuid();
  const st = status || 'draft';
  const approvedBy = st === 'active' ? (req.body.approved_by || req.user.name) : null;
  const approvedAt = st === 'active' ? new Date().toISOString() : null;

  db.prepare(`INSERT INTO sop_documents
    (id, doc_type, doc_number, title, category, revision, effective_date, review_due, status, owner, description, source_file, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, type, doc_number || '', title, category, revision || '1.0',
    effective_date || null, review_due || null, st, owner || null,
    content || null, source_file || null, approvedBy, approvedAt
  );

  const created = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(id);
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), id, created.revision, req.user.name, 'Created', JSON.stringify(created));
  logAudit(req.user, 'document_created', 'document', id, { doc_type: type, title, category });
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { doc_number, title, category, revision, effective_date, review_due, status, owner, content, source_file, _change_summary, _minor } = req.body;

  const newStatus = status || existing.status;
  // A material change (body or revision) that is NOT flagged as a minor edit
  // advances the "training revision" — the version people must be trained on —
  // which flags everyone trained on the prior version for retraining.
  const bodyChanged = content !== undefined && content !== existing.description;
  const revisionChanged = !!revision && revision !== existing.revision;
  const isMinor = !!_minor;
  const materialChange = (bodyChanged || revisionChanged) && !isMinor;
  // Capture approval the first time a document moves to the approved/effective state
  let approvedBy = existing.approved_by;
  let approvedAt = existing.approved_at;
  if (newStatus === 'active' && existing.status !== 'active') {
    approvedBy = req.body.approved_by || req.user.name;
    approvedAt = new Date().toISOString();
  }

  const newRevision = revision || existing.revision;
  // Bump training_revision only on a material change; otherwise keep the prior
  // value (initialized to the current revision by migration).
  const trainingRevision = materialChange ? newRevision : (existing.training_revision || newRevision);

  db.prepare(`UPDATE sop_documents SET doc_number=?, title=?, category=?, revision=?, effective_date=?, review_due=?, status=?, owner=?, description=?, source_file=?, approved_by=?, approved_at=?, training_revision=?, updated_at=datetime('now') WHERE id=?`).run(
    doc_number ?? existing.doc_number, title || existing.title, category || existing.category,
    newRevision, effective_date ?? existing.effective_date,
    review_due ?? existing.review_due, newStatus, owner ?? existing.owner,
    content ?? existing.description, source_file ?? existing.source_file,
    approvedBy, approvedAt, trainingRevision, req.params.id
  );

  const updated = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot, minor) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), req.params.id, updated.revision, req.user.name, _change_summary || (isMinor ? 'Minor edit' : 'Updated'), JSON.stringify(updated), isMinor ? 1 : 0);

  // How many completed trainings this change just invalidated (for the response).
  let retraining_triggered = 0;
  if (materialChange) {
    retraining_triggered = db.prepare(`
      SELECT COUNT(*) c FROM training_records tr JOIN training_courses c ON tr.course_id = c.id
      WHERE c.sop_id = ? AND c.retrain_on_doc_change = 1 AND tr.superseded = 0 AND tr.status = 'completed'
        AND (tr.sop_revision IS NULL OR tr.sop_revision != ?)`).get(req.params.id, trainingRevision).c;
  }
  logAudit(req.user, 'document_updated', 'document', req.params.id, { title: updated.title, material_change: materialChange, retraining_triggered }, existing, updated);
  res.json({ ...updated, retraining_triggered });
});

// DELETE — soft archive
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE sop_documents SET status='archived', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAudit(req.user, 'document_archived', 'document', req.params.id, { title: existing.title }, existing, null);
  res.json({ success: true });
});

// Bulk permanent delete — removes documents (and their version history) for
// good. Admin only, since this is not reversible.
router.post('/bulk-delete', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can permanently delete documents.' });
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const placeholders = ids.map(() => '?').join(',');
  const docs = db.prepare(`SELECT id, doc_number, title, doc_type FROM sop_documents WHERE id IN (${placeholders})`).all(...ids);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM sop_versions WHERE sop_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM sop_documents WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();
  for (const d of docs) logAudit(req.user, 'document_deleted', 'document', d.id, { doc_number: d.doc_number, title: d.title }, d, null);
  res.json({ deleted: docs.length });
});

// Bulk field update — set status / category / owner on many documents at once.
router.post('/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object is required' });
  const allowed = ['status', 'category', 'owner'];
  const fields = Object.keys(patch).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No editable fields in patch' });
  const setSql = fields.map(f => `${f}=?`).join(', ');
  const placeholders = ids.map(() => '?').join(',');
  const values = fields.map(f => (patch[f] === '' ? null : patch[f]));
  const info = db.prepare(`UPDATE sop_documents SET ${setSql}, updated_at=datetime('now') WHERE id IN (${placeholders})`).run(...values, ...ids);
  logAudit(req.user, 'documents_bulk_updated', 'document', null, { count: info.changes, fields, patch });
  res.json({ updated: info.changes });
});

// PDF — single or multiple
router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  generatePDF(res, [doc]);
});

router.post('/pdf', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  const docs = db.prepare(`SELECT * FROM sop_documents WHERE id IN (${placeholders}) ORDER BY category, doc_number`).all(...ids);
  if (!docs.length) return res.status(404).json({ error: 'No documents found' });
  generatePDF(res, docs);
});

const STATUS_LABEL = { draft: 'Draft', under_review: 'In Review', active: 'Approved / Effective', superseded: 'Superseded', archived: 'Archived' };

function generatePDF(res, docs) {
  const LEFT = 72;
  const RIGHT = 540;
  const BODY_W = RIGHT - LEFT;
  const BULLET_LEFT = LEFT + 18;
  const BULLET_W = RIGHT - BULLET_LEFT;
  const PAGE_BOTTOM = 720;

  const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: LEFT, right: 72 } });
  res.setHeader('Content-Type', 'application/pdf');
  const typeLabel = TYPE_LABEL[docs[0].doc_type] || 'Document';
  const title = docs.length === 1 ? `${docs[0].doc_number || typeLabel} - ${docs[0].title}` : `${typeLabel}_${docs.length}_docs`;
  const safeName = (title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  pdf.pipe(res);

  const footerText = `Generated ${new Date().toLocaleDateString()} — Powder Ops FSQA`;
  const ensureSpace = (needed) => { if (pdf.y > PAGE_BOTTOM - needed) pdf.addPage(); };

  docs.forEach((doc, idx) => {
    if (idx > 0) pdf.addPage();

    pdf.save();
    pdf.rect(LEFT, 50, BODY_W, 36).fill('#1e40af');
    pdf.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text(doc.title, LEFT + 12, 59, { width: BODY_W - 24 });
    pdf.restore();

    pdf.y = 104;
    pdf.x = LEFT;
    pdf.fontSize(9);
    const meta = [
      ['Type', TYPE_LABEL[doc.doc_type] || 'Document'],
      ['Document #', doc.doc_number || '—'],
      ['Category', (doc.category || '').charAt(0).toUpperCase() + (doc.category || '').slice(1)],
      ['Revision', doc.revision || '—'],
      ['Status', STATUS_LABEL[doc.status] || doc.status || '—'],
      ['Owner', doc.owner || '—'],
      ['Approved By', doc.approved_by || '—'],
      ['Effective Date', doc.effective_date || '—'],
      ['Review Due', doc.review_due || '—'],
    ];
    for (const [label, value] of meta) {
      pdf.font('Helvetica-Bold').fillColor('#374151').text(label + ':  ', LEFT, pdf.y, { continued: true });
      pdf.font('Helvetica').text(value);
    }

    pdf.y += 10;
    pdf.moveTo(LEFT, pdf.y).lineTo(RIGHT, pdf.y).strokeColor('#d1d5db').stroke();
    pdf.y += 16;

    if (doc.description) {
      pdf.fillColor('#111827').fontSize(10).font('Helvetica');
      for (const raw of doc.description.split('\n')) {
        const trimmed = raw.trim();
        if (!trimmed) { pdf.y += 6; continue; }
        ensureSpace(30);
        // Strip inline markdown emphasis markers for print
        const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)(.+?)\*/g, '$1');
        if (/^#{1,2}\s+/.test(trimmed)) {
          const level = trimmed.startsWith('## ') ? 2 : 1;
          const text = trimmed.replace(/^#{1,2}\s+/, '');
          pdf.y += 4;
          pdf.font('Helvetica-Bold').fontSize(level === 1 ? 12 : 11).text(clean(text), LEFT, pdf.y, { width: BODY_W, lineGap: 2 });
          pdf.font('Helvetica').fontSize(10);
        } else if (/^[-*•]\s+/.test(trimmed)) {
          pdf.text('•  ' + clean(trimmed.replace(/^[-*•]\s+/, '')), BULLET_LEFT, pdf.y, { width: BULLET_W, lineGap: 2 });
        } else if (/^\d+\.\s+/.test(trimmed)) {
          pdf.text(clean(trimmed), BULLET_LEFT, pdf.y, { width: BULLET_W, lineGap: 2 });
        } else {
          pdf.text(clean(trimmed), LEFT, pdf.y, { width: BODY_W, lineGap: 2 });
        }
      }
    } else {
      pdf.fillColor('#9ca3af').fontSize(10).font('Helvetica-Oblique').text('No content yet.', LEFT, pdf.y, { width: BODY_W });
    }

    pdf.save();
    pdf.fillColor('#9ca3af').fontSize(7).font('Helvetica');
    pdf.page.margins.bottom = 0;
    pdf.text(footerText, LEFT, 745, { width: BODY_W, align: 'center', lineBreak: false });
    pdf.restore();
  });

  pdf.end();
}

export default router;
