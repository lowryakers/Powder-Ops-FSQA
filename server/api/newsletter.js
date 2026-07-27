import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, getObjectBuffer } from '../storage.js';
import { getChannelByName, postMessageAs } from './comms.js';
import { aiEnabled, translateCached } from '../ai.js';

// The company newsletter.
//
// Two layers, deliberately: cards are the running notes Marnee adds to all
// month (an event here, a shout-out there); an issue is a snapshot of those
// cards at the moment she presses Build, which she can then edit freely
// without disturbing the notes. Sharing renders that snapshot to a PDF, puts
// it in storage, and posts it to #announcements with her own message.

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'powder-ops-logo.jpg');

const MODULE_ID = 'newsletter';
const KINDS = ['events', 'shoutouts', 'news', 'stats', 'general'];

function may(user, level = 'view') {
  if (user?.role === 'admin') return true;
  const ma = user?.module_access;
  if (!ma) return false;
  if (Array.isArray(ma)) return level === 'view' && ma.includes(MODULE_ID);
  const lvl = ma[MODULE_ID];
  return level === 'edit' ? lvl === 'edit' : lvl === 'edit' || lvl === 'view';
}
function requireAccess(req, res, level) {
  if (!may(req.user, level)) { res.status(403).json({ error: 'You do not have access to the Newsletter.' }); return false; }
  return true;
}

const parseSections = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

// ── Cards: the running notes ─────────────────────────────────────────────────

router.get('/cards', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  res.json(getDb().prepare('SELECT * FROM newsletter_cards ORDER BY sort_order, created_at').all());
});

router.post('/cards', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const { kind, title, body } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = uuid();
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM newsletter_cards').get().n;
  db.prepare('INSERT INTO newsletter_cards (id, kind, title, body, sort_order, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, KINDS.includes(kind) ? kind : 'general', title, body || null, next, req.user.name);
  res.status(201).json(db.prepare('SELECT * FROM newsletter_cards WHERE id = ?').get(id));
});

router.put('/cards/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM newsletter_cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Card not found' });
  const b = req.body || {};
  db.prepare(`UPDATE newsletter_cards SET kind = ?, title = ?, body = ?, sort_order = ?, is_active = ?,
    updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(KINDS.includes(b.kind) ? b.kind : existing.kind, b.title ?? existing.title, b.body ?? existing.body,
      b.sort_order ?? existing.sort_order, b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0),
      req.user.name, req.params.id);
  res.json(db.prepare('SELECT * FROM newsletter_cards WHERE id = ?').get(req.params.id));
});

router.delete('/cards/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM newsletter_cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Card not found' });
  db.prepare('DELETE FROM newsletter_cards WHERE id = ?').run(req.params.id);
  res.json({ deleted: req.params.id });
});

// ── Issues: the thing that gets sent ─────────────────────────────────────────

router.get('/issues', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const rows = getDb().prepare('SELECT * FROM newsletter_issues ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows.map(r => ({ ...r, sections: parseSections(r.sections) })));
});

router.get('/issues/:id', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const row = getDb().prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Newsletter not found' });
  res.json({ ...row, sections: parseSections(row.sections) });
});

// Build: snapshot the active cards into a fresh draft.
router.post('/issues', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const cards = db.prepare('SELECT * FROM newsletter_cards WHERE is_active = 1 ORDER BY sort_order, created_at').all();
  const sections = cards.map(c => ({ id: uuid(), kind: c.kind, title: c.title, body: c.body || '', image_id: null }));
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const id = uuid();
  db.prepare('INSERT INTO newsletter_issues (id, title, intro, sections, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.body?.title || `Powder Ops — ${month}`, req.body?.intro || null, JSON.stringify(sections), req.user.name);
  const created = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'newsletter', id, { sections: sections.length }, null, created, created.title);
  res.status(201).json({ ...created, sections });
});

router.put('/issues/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Newsletter not found' });
  if (existing.status === 'shared') return res.status(400).json({ error: 'This newsletter has already been shared. Build a new one to make changes.' });
  const b = req.body || {};
  db.prepare(`UPDATE newsletter_issues SET title = ?, intro = ?, sections = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(b.title ?? existing.title, b.intro ?? existing.intro,
      b.sections ? JSON.stringify(b.sections) : existing.sections, req.params.id);
  const updated = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  res.json({ ...updated, sections: parseSections(updated.sections) });
});

router.delete('/issues/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Newsletter not found' });
  db.prepare('DELETE FROM newsletter_issues WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'newsletter', req.params.id, null, existing, null, existing.title);
  res.json({ deleted: req.params.id });
});

// ── Images ───────────────────────────────────────────────────────────────────

router.post('/images', upload.array('files', 10), async (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const files = (req.files || []).filter(f => /^image\//i.test(f.mimetype));
  if (!files.length) return res.status(400).json({ error: 'No images uploaded' });
  const db = getDb();
  const ins = db.prepare('INSERT INTO newsletter_images (id, issue_id, filename, storage_key, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const out = [];
  for (const f of files) {
    const id = uuid();
    const key = `newsletter/${id}-${f.originalname.replace(/[^\w.-]+/g, '_')}`;
    await putObject(key, f.buffer, f.mimetype);
    ins.run(id, req.body?.issue_id || null, f.originalname, key, f.mimetype, f.size, req.user.name);
    out.push({ id, filename: f.originalname, url: await presignGet(key) });
  }
  res.status(201).json({ images: out });
});

router.get('/images/:id/url', async (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const row = getDb().prepare('SELECT * FROM newsletter_images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Image not found' });
  res.json({ url: await presignGet(row.storage_key), filename: row.filename });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

const KIND_LABEL_ES = {
  events: 'Próximos eventos',
  shoutouts: 'Reconocimientos',
  news: 'Noticias importantes',
  stats: 'En números',
  general: '',
};

const KIND_LABEL = {
  events: 'Upcoming events',
  shoutouts: 'Shout-outs',
  news: 'Big news',
  stats: 'By the numbers',
  general: '',
};

// Renders the issue to a PDF buffer. Images are fetched from storage; a
// missing one is skipped rather than failing the whole newsletter.
async function renderPdf(db, issue, lang = 'en') {
  let sections = parseSections(issue.sections);
  let title = issue.title;
  let intro = issue.intro;

  // Spanish is a translation of the same newsletter, not a second half bolted
  // on: everything the PDF prints goes through the cached translator, so the
  // document reads end-to-end in the language that was asked for.
  if (lang === 'es' && aiEnabled()) {
    const texts = [title, intro || '', ...sections.flatMap(s => [s.title, s.body || ''])];
    try {
      const out = await translateCached(texts, 'es');
      title = out[0] || title;
      intro = out[1] || intro;
      sections = sections.map((s, i) => ({ ...s, title: out[2 + i * 2] || s.title, body: out[3 + i * 2] || s.body }));
    } catch { /* fall back to English rather than fail the download */ }
  }
  const imageIds = sections.map(s => s.image_id).filter(Boolean);
  const images = new Map();
  for (const id of imageIds) {
    const row = db.prepare('SELECT * FROM newsletter_images WHERE id = ?').get(id);
    if (!row) continue;
    const buf = await getObjectBuffer(row.storage_key).catch(() => null);
    if (buf) images.set(id, buf);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (existsSync(LOGO_PATH)) {
      try { doc.image(readFileSync(LOGO_PATH), 54, 40, { height: 34 }); } catch { /* logo optional */ }
    }
    doc.moveDown(2.2);
    doc.fillColor('#26262a').font('Helvetica-Bold').fontSize(24).text(title, { align: 'left' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#6c6c73')
      .text(new Date(issue.created_at?.replace(' ', 'T') || Date.now())
        .toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { dateStyle: 'long' }));
    doc.moveTo(54, doc.y + 10).lineTo(558, doc.y + 10).strokeColor('#e5e4df').stroke();
    doc.moveDown(1.2);

    if (intro) {
      doc.font('Helvetica').fontSize(11).fillColor('#26262a').text(intro, { align: 'left' });
      doc.moveDown(1);
    }

    for (const s of sections) {
      if (doc.y > 640) doc.addPage();
      const label = lang === 'es' ? (KIND_LABEL_ES[s.kind] || KIND_LABEL[s.kind]) : KIND_LABEL[s.kind];
      if (label) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#4f6ff5').text(label.toUpperCase(), { characterSpacing: 0.8 });
        doc.moveDown(0.15);
      }
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#26262a').text(s.title);
      if (s.body) {
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(11).fillColor('#3a3a40').text(s.body, { align: 'left', lineGap: 2 });
      }
      const img = s.image_id && images.get(s.image_id);
      if (img) {
        doc.moveDown(0.5);
        try { doc.image(img, { fit: [440, 260], align: 'center' }); } catch { /* unreadable image */ }
      }
      doc.moveDown(1);
    }

    doc.font('Helvetica').fontSize(9).fillColor('#9a9aa2')
      .text('Powder Ops · ReadyDoc', 54, 720, { align: 'center', width: 504 });
    doc.end();
  });
}

router.get('/issues/:id/pdf', async (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const db = getDb();
  const issue = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Newsletter not found' });
  try {
    const pdf = await renderPdf(db, issue, req.query.lang === 'es' ? 'es' : 'en');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${issue.title.replace(/[^\w -]+/g, '')}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: `Could not build the PDF: ${e.message}` });
  }
});

// ── Share ────────────────────────────────────────────────────────────────────

// Renders the PDF, stores it, attaches it to a message in #announcements and
// marks the issue shared. Storage is required: a newsletter announcement with
// no newsletter attached would be worse than no announcement.
router.post('/issues/:id/share', async (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const issue = db.prepare('SELECT * FROM newsletter_issues WHERE id = ?').get(req.params.id);
  if (!issue) return res.status(404).json({ error: 'Newsletter not found' });
  if (issue.status === 'shared') return res.status(400).json({ error: 'This newsletter has already been shared.' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured, so the PDF cannot be attached.' });

  const channelName = req.body?.channel || 'announcements';
  const channel = getChannelByName(db, channelName);
  if (!channel) return res.status(404).json({ error: `No #${channelName} channel found.` });

  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  let pdf;
  try { pdf = await renderPdf(db, issue, lang); }
  catch (e) { return res.status(500).json({ error: `Could not build the PDF: ${e.message}` }); }

  const filename = `${issue.title.replace(/[^\w -]+/g, '').trim() || 'newsletter'}${lang === 'es' ? ' (ES)' : ''}.pdf`;
  const key = `newsletter/${issue.id}-${filename}`;
  await putObject(key, pdf, 'application/pdf');

  const body = String(req.body?.message || '').trim() || `📣 ${issue.title} is out — have a read.`;
  const message = await postMessageAs(db, channel, req.user, body);
  if (!message) return res.status(500).json({ error: 'Could not post to the channel.' });

  // Attach the PDF to that message so it opens from the conversation.
  db.prepare(`INSERT INTO chat_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key)
    VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?)`)
    .run(uuid(), message.id, channel.id, req.user.id, filename, pdf.length, key);

  db.prepare(`UPDATE newsletter_issues SET status = 'shared', shared_at = datetime('now'), shared_by = ?,
    channel_id = ?, message_id = ?, pdf_key = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, channel.id, message.id, key, issue.id);

  logAudit(req.user, 'update', 'newsletter', issue.id, { shared_to: channel.name }, issue, null, issue.title);
  res.json({ ok: true, channel: channel.name, message_id: message.id });
});

export default router;
