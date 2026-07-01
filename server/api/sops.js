import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { category, status, sort, order } = req.query;
  let sql = 'SELECT * FROM sop_documents WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status != 'archived'"; }

  const SORTABLE = { doc_number: 'doc_number', title: 'title', category: 'category', revision: 'revision', status: 'status', review_due: 'review_due', owner: 'owner', updated_at: 'updated_at' };
  const col = SORTABLE[sort] || 'category';
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

router.post('/', (req, res) => {
  const db = getDb();
  const { doc_number, title, category, revision, effective_date, review_due, owner, gdrive_url, gdrive_folder, description, _actor } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category are required' });
  const id = uuid();
  const versionId = uuid();
  const finalOwner = owner || 'Daniela Servin';

  db.prepare(`INSERT INTO sop_documents (id, doc_number, title, category, revision, effective_date, review_due, owner, gdrive_url, gdrive_folder, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, doc_number || '', title, category, revision || '1.0',
    effective_date || null, review_due || null, finalOwner,
    gdrive_url || null, gdrive_folder || null, description || null
  );

  const created = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(id);
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(versionId, id, revision || '1.0', _actor || 'system', 'Created', JSON.stringify(created));
  logAudit(_actor || 'system', 'sop_created', 'sop', id, { title, category });
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { doc_number, title, category, revision, effective_date, review_due, status, owner, gdrive_url, gdrive_folder, description, _actor, _change_summary } = req.body;

  db.prepare(`UPDATE sop_documents SET doc_number=?, title=?, category=?, revision=?, effective_date=?, review_due=?, status=?, owner=?, gdrive_url=?, gdrive_folder=?, description=?, updated_at=datetime('now') WHERE id=?`).run(
    doc_number ?? existing.doc_number, title || existing.title, category || existing.category,
    revision || existing.revision, effective_date ?? existing.effective_date,
    review_due ?? existing.review_due, status || existing.status, owner ?? existing.owner,
    gdrive_url ?? existing.gdrive_url, gdrive_folder ?? existing.gdrive_folder,
    description ?? existing.description, req.params.id
  );

  const updated = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  const versionId = uuid();
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(versionId, req.params.id, updated.revision, _actor || 'system', _change_summary || 'Updated', JSON.stringify(updated));
  logAudit(_actor || 'system', 'sop_updated', 'sop', req.params.id, { title: updated.title }, existing, updated);
  res.json(updated);
});

// Version history
router.get('/:id/versions', (req, res) => {
  const db = getDb();
  const versions = db.prepare('SELECT * FROM sop_versions WHERE sop_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(versions);
});

// PDF — single SOP
router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  generatePDF(res, [doc]);
});

// PDF — multiple SOPs
router.post('/pdf', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  const docs = db.prepare(`SELECT * FROM sop_documents WHERE id IN (${placeholders}) ORDER BY category, doc_number`).all(...ids);
  if (!docs.length) return res.status(404).json({ error: 'No documents found' });
  generatePDF(res, docs);
});

function generatePDF(res, docs) {
  const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 60, left: 60, right: 60 } });
  res.setHeader('Content-Type', 'application/pdf');
  const title = docs.length === 1 ? `${docs[0].doc_number || 'SOP'} - ${docs[0].title}` : `SOP_Registry_${docs.length}_docs`;
  res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`);
  pdf.pipe(res);

  docs.forEach((doc, idx) => {
    if (idx > 0) pdf.addPage();

    pdf.save();
    pdf.rect(60, 40, 492, 40).fill('#1e40af');
    pdf.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
      .text(doc.title, 70, 50, { width: 472 });
    pdf.restore();

    let y = 100;

    pdf.fillColor('#374151').fontSize(9).font('Helvetica');
    const meta = [
      ['Document #', doc.doc_number || '—'],
      ['Category', (doc.category || '').charAt(0).toUpperCase() + (doc.category || '').slice(1)],
      ['Revision', doc.revision || '—'],
      ['Status', (doc.status || '').replace('_', ' ')],
      ['Owner', doc.owner || '—'],
      ['Effective Date', doc.effective_date || '—'],
      ['Review Due', doc.review_due || '—'],
    ];

    meta.forEach(([label, value]) => {
      pdf.font('Helvetica-Bold').text(label + ':', 60, y, { continued: true, width: 120 });
      pdf.font('Helvetica').text('  ' + value, { width: 370 });
      y += 16;
    });

    y += 10;
    pdf.moveTo(60, y).lineTo(552, y).strokeColor('#d1d5db').stroke();
    y += 15;

    if (doc.description) {
      pdf.fillColor('#111827').fontSize(10).font('Helvetica');
      const lines = doc.description.split('\n');
      for (const line of lines) {
        if (y > 700) { pdf.addPage(); y = 60; }
        const trimmed = line.trim();
        if (!trimmed) { y += 8; continue; }
        if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
          pdf.text(trimmed, 70, y, { width: 472, lineGap: 3 });
        } else if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80) {
          pdf.font('Helvetica-Bold').fontSize(11).text(trimmed, 60, y, { width: 482, lineGap: 3 });
          pdf.font('Helvetica').fontSize(10);
        } else {
          pdf.text(trimmed, 60, y, { width: 482, lineGap: 3 });
        }
        y += pdf.heightOfString(trimmed || ' ', { width: 482 }) + 4;
      }
    } else {
      pdf.fillColor('#9ca3af').fontSize(10).font('Helvetica-Oblique')
        .text('No description content available.', 60, y, { width: 482 });
    }

    pdf.fillColor('#9ca3af').fontSize(7).font('Helvetica')
      .text(`Generated ${new Date().toLocaleDateString()} — Powder Ops FSQA`, 60, 730, { width: 492, align: 'center' });
  });

  pdf.end();
}

export default router;
