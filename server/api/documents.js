import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';

const router = Router();

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
  logAudit(req.user.name, 'document_created', 'document', id, { doc_type: type, title, category });
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { doc_number, title, category, revision, effective_date, review_due, status, owner, content, source_file, _change_summary } = req.body;

  const newStatus = status || existing.status;
  // Capture approval the first time a document moves to the approved/effective state
  let approvedBy = existing.approved_by;
  let approvedAt = existing.approved_at;
  if (newStatus === 'active' && existing.status !== 'active') {
    approvedBy = req.body.approved_by || req.user.name;
    approvedAt = new Date().toISOString();
  }

  db.prepare(`UPDATE sop_documents SET doc_number=?, title=?, category=?, revision=?, effective_date=?, review_due=?, status=?, owner=?, description=?, source_file=?, approved_by=?, approved_at=?, updated_at=datetime('now') WHERE id=?`).run(
    doc_number ?? existing.doc_number, title || existing.title, category || existing.category,
    revision || existing.revision, effective_date ?? existing.effective_date,
    review_due ?? existing.review_due, newStatus, owner ?? existing.owner,
    content ?? existing.description, source_file ?? existing.source_file,
    approvedBy, approvedAt, req.params.id
  );

  const updated = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), req.params.id, updated.revision, req.user.name, _change_summary || 'Updated', JSON.stringify(updated));
  logAudit(req.user.name, 'document_updated', 'document', req.params.id, { title: updated.title }, existing, updated);
  res.json(updated);
});

// DELETE — soft archive
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE sop_documents SET status='archived', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAudit(req.user.name, 'document_archived', 'document', req.params.id, { title: existing.title }, existing, null);
  res.json({ success: true });
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
