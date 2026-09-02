import { Router } from 'express';
import { cleanFilename, stripRevisionSuffix } from '../filename-meta.js';
import { orderWorklist, worklistProgress } from '../doc-worklist.js';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { tableAt, drawTable } from '../pdf-table.js';
import mammoth from 'mammoth';
import { createReadStream } from 'fs';
import { getDb, logAudit } from '../db.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';

const clean = (v, max = 300) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

const router = Router();

const MAX_IMPORT_MB = 50;

// ── One work instruction, several machines ──────────────────────────────────
// The plant runs eleven identical vacuums and two blenders off one WI, so
// naming a single machine made the equipment setup checklist wrong for every
// other copy. The FULL set lives in equipment_ids (JSON array);
// `equipment_id` stays as a MIRROR of the first entry so everything that
// already reads that column (equipment-readiness.js, the CSV, the registry
// chip) keeps working untouched — the same line-0 mirroring rule as
// org_positions.job_description_ids and production_entries.mo_lines.
function normalizeEquipmentIds(body, existing = null) {
  if (body.equipment_ids !== undefined) {
    const arr = Array.isArray(body.equipment_ids) ? body.equipment_ids : [];
    return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
  }
  if (body.equipment_id !== undefined) {
    return body.equipment_id ? [String(body.equipment_id)] : [];
  }
  return existing ? equipmentIdsOf(existing) : [];
}
export function equipmentIdsOf(row) {
  try {
    const arr = JSON.parse(row.equipment_ids || 'null');
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* fall through */ }
  return row.equipment_id ? [row.equipment_id] : [];
}
// Every document read hands back the resolved array, so no client has to know
// the column holds JSON — or that there are two columns at all.
const withEquipment = (row) => (row ? { ...row, equipment_ids: equipmentIdsOf(row) } : row);

// ── Document review scheduling (Doc-Control task feed) ────────────────────────
export const REVIEW_FREQ_MONTHS = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12, biennial: 24 };
const REVIEW_LEAD_DAYS = 30;

// Recompute a document's next review after it's reviewed: last_reviewed = today,
// review_due = today + its frequency. Called when a review task is completed.
export function recomputeDocumentReview(db, documentId) {
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(documentId);
  if (!doc) return;
  const months = REVIEW_FREQ_MONTHS[doc.review_frequency] || 12;
  db.prepare(`UPDATE sop_documents SET last_reviewed = date('now'), review_due = date('now', ?), updated_at = datetime('now') WHERE id = ?`)
    .run(`+${months} months`, documentId);
}

// Generate a Document-Control task for each active document whose review is due
// within the lead window (or overdue), unless one is already open. Idempotent.
export function generateDocumentReviewTasks(db) {
  let due;
  try {
    due = db.prepare(`SELECT id, doc_number, title FROM sop_documents
      WHERE status != 'archived' AND review_due IS NOT NULL AND review_due != ''
        AND date(review_due) <= date('now', ?)`).all(`+${REVIEW_LEAD_DAYS} days`);
  } catch { return 0; }
  if (!due.length) return 0;
  const hasOpen = db.prepare("SELECT 1 FROM work_orders WHERE document_id = ? AND status IN ('open','in_progress','overdue') LIMIT 1");
  const ins = db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, task_group, document_id, status)
    VALUES (?, ?, ?, 'normal', ?, 'document_control', ?, 'open')`);
  let created = 0;
  const tx = db.transaction(() => {
    for (const d of due) {
      if (hasOpen.get(d.id)) continue;
      const reviewDue = db.prepare('SELECT review_due FROM sop_documents WHERE id = ?').get(d.id).review_due;
      ins.run(uuid(), `Review ${d.doc_number || ''}: ${d.title || 'document'}`.trim(), 'Scheduled document review (SQF).', reviewDue, d.id);
      created++;
    }
  });
  tx();
  return created;
}

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
// Exported: also indexes uploaded supply invoices for content search.
export async function extractPdfText(buffer) {
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

// Best-effort guess of a document number and title from filename + first lines
function guessMeta(filename, text) {
  const base = cleanFilename(filename);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Longest prefixes first — the plant numbers documents POLICY 002 and
  // PROTOCOL 003, and a shorter alternative ("POL") would match first and
  // truncate them, which is why those two never matched by number.
  const numRe = /\b((?:PROTOCOL|POLICY|HACCP|FORM|SOP|POL|WI|JD|QP|F)[-\s]?\d{1,4}(?:[-.]\d{1,3})?)\b/i;
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
  // Document Control names its files with the revision on the end
  // ("…_Food_Safety_Policy_Statement_V4.pdf"). That's the revision, not part of
  // the title — left in, uploading V4 of a document renames it to "… V4" and
  // the next revision renames it again. Only a trailing v/rev token goes; a
  // title that genuinely ends in a number ("Allergen Control Program 2") stays.
  title = stripRevisionSuffix(title);
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


// ── Uploading the latest version of a document already on file ──────────────
//
// Document Control's real job right now is not creating documents — it's
// bringing ~100 existing ones up to date from the finalised paper. So this
// takes an upload, works out WHICH document it is, and proposes the changes
// rather than making them.
//
// Nothing here writes. The proposal is a diff Daniela reads and applies (or
// doesn't), because a scanner confidently overwriting a controlled document is
// exactly the failure mode Document Control exists to prevent.

// Revision and effective date as the plant writes them on the page.
function guessRevision(text) {
  const head = String(text || '').slice(0, 4000);
  const rev = head.match(/\b(?:revision|rev\.?|version|ver\.?)\s*#?\s*:?\s*(V?\d+(?:\.\d+)?)\b/i);
  const eff = head.match(/\b(?:effective|issued|approved)\s*(?:date)?\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i);
  const iso = (d) => {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!m) return null;
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  };
  return { revision: rev ? rev[1].toUpperCase() : null, effective_date: iso(eff && eff[1]) };
}

const normDoc = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Which document on file is this upload? Doc number is the reliable signal;
// an exact title match is the fallback. No match is reported as such rather
// than guessed — attaching a revision to the wrong document is worse than
// asking someone which one it is.
function matchDocument(db, meta) {
  const all = db.prepare('SELECT id, doc_number, title, revision, effective_date, description, status FROM sop_documents').all();
  if (meta.doc_number) {
    const key = normDoc(meta.doc_number);
    const hit = all.find(d => normDoc(d.doc_number) === key);
    if (hit) return { doc: hit, matched_on: 'document number' };
  }
  const t = String(meta.title || '').trim().toLowerCase();
  if (t.length > 6) {
    const hit = all.find(d => String(d.title || '').trim().toLowerCase() === t);
    if (hit) return { doc: hit, matched_on: 'exact title' };
  }
  return { doc: null, matched_on: null };
}

// What would change, field by field. Content is reported as a size delta
// rather than a character diff: the point is "the body changed, look at it",
// and a word-level diff of a whole SOP is not something anyone reads.
function proposeChanges(doc, extracted) {
  const changes = [];
  const add = (field, label, from, to) => {
    if (to == null || to === '' ) return;
    if (String(from || '').trim() === String(to).trim()) return;
    changes.push({ field, label, from: from || null, to });
  };
  add('revision', 'Revision', doc.revision, extracted.revision);
  add('effective_date', 'Effective date', doc.effective_date, extracted.effective_date);
  add('title', 'Title', doc.title, extracted.title);
  const oldLen = String(doc.description || '').trim().length;
  const newLen = String(extracted.content || '').trim().length;
  if (newLen > 40 && String(doc.description || '').trim() !== String(extracted.content).trim()) {
    changes.push({
      field: 'description', label: 'Document body',
      from: oldLen ? `${oldLen.toLocaleString()} characters on file` : 'empty',
      to: `${newLen.toLocaleString()} characters from the upload`,
      content: extracted.content,
    });
  }
  return changes;
}

/**
 * What this file could NOT give us, said out loud.
 *
 * Both of these failed silently before, and both are the case the process
 * actually asks for. A scanned signature copy has no text layer at all, so it
 * proposed no body change and looked like it had simply agreed with what was on
 * file. And a table pulled out of a PDF is rebuilt from where the words sit on
 * the page: a cell that wraps splits its row, which is what turned the Food
 * Defense Plan's vulnerability assessment into three broken tables that
 * somebody then had to repair by hand.
 */
function extractWarnings(file, content, pages, isMarkdown) {
  const warnings = [];
  const isPdf = /\.pdf$/i.test(file.originalname || '') || file.mimetype === 'application/pdf';
  if (!isPdf) return warnings;

  const text = String(content || '').trim();
  if (pages && text.length < 40) {
    warnings.push({
      level: 'error',
      message: `No text could be read from this PDF (${pages} page${pages === 1 ? '' : 's'}). It is almost certainly a scan — a picture of a page holds no text. Attach it to the document as the signed copy, and take the body from the Word original.`,
    });
    return warnings;
  }
  if (!isMarkdown && /^\s*\|.*\|/m.test(text)) {
    warnings.push({
      level: 'warn',
      message: 'This document has tables, and a table in a PDF is rebuilt from where the words sit on the page — any cell that wraps onto a second line splits its row. Check them, or upload the Word (.docx) file instead, where the tables come through exactly.',
    });
  }
  return warnings;
}

// POST /propose-revisions — upload one or more finalised documents, get back
// what each one WOULD change. Writes nothing.
router.post('/propose-revisions', receiveImportFiles, async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  const db = getDb();
  const out = [];
  for (const f of req.files) {
    try {
      const { text, pages, isMarkdown } = await extractDocText(f);
      const meta = guessMeta(f.originalname, text);
      const rev = guessRevision(text);
      const content = isMarkdown ? text : textToMarkdown(text);
      const extracted = { ...meta, ...rev, content };
      const { doc, matched_on } = matchDocument(db, meta);
      out.push({
        filename: f.originalname, ok: true, pages, extracted,
        document: doc ? { id: doc.id, doc_number: doc.doc_number, title: doc.title, revision: doc.revision, status: doc.status } : null,
        matched_on,
        changes: doc ? proposeChanges(doc, extracted) : [],
        warnings: extractWarnings(f, content, pages, isMarkdown),
      });
    } catch (err) {
      out.push({ filename: f.originalname, ok: false, error: err.message });
    }
  }
  res.json({ files: out });
});

// POST /:id/apply-revision — apply the fields Document Control ticked.
// A version snapshot is written first, so the previous revision is recoverable
// and the trail shows what the upload replaced.
// ONE WRITER, TWO DOORS. The modal and the worklist both land here, so a
// revision applied from a queue is byte for byte one applied from the upload
// screen — including the version snapshot and the audit entry. A second copy is
// how one of them quietly stops writing history.
export function applyRevision(db, doc, fields, { actor, filename }) {
  const allowed = ['revision', 'effective_date', 'title', 'description'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] === undefined || fields[k] === null || fields[k] === '') continue;
    sets.push(`${k} = ?`);
    vals.push(fields[k]);
  }
  if (!sets.length) return { error: 'Nothing selected to apply.' };

  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), doc.id, doc.revision, actor?.name || 'system',
      `Superseded by an uploaded revision (${filename || 'file'})`, JSON.stringify(doc));

  db.prepare(`UPDATE sop_documents SET ${sets.join(', ')}, source_file = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(...vals, filename || doc.source_file, doc.id);

  const after = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(doc.id);
  logAudit(actor, 'update', 'document', doc.id,
    { applied: Object.keys(fields), from_revision: doc.revision, to_revision: fields.revision || doc.revision, source: filename },
    doc, after, doc.doc_number || doc.title);
  return { document: after, applied: Object.keys(fields) };
}

router.post('/:id/apply-revision', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const r = applyRevision(db, doc, req.body?.fields || {},
    { actor: req.user, filename: req.body?.filename });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r.document);
});

// ── The worklist: the same proposals, kept ──────────────────────────────────
//
// /propose-revisions above is a modal — drop files, apply, gone. Across roughly
// a hundred documents that is a job nobody can put down: do twenty today and
// tomorrow you are working from memory about which twenty. Filing the proposals
// makes it survivable, and NOTHING ELSE CHANGES — the proposal is the same
// proposal, applying it goes through the same writer, and nothing is applied
// until it is ticked.

// POST /revisions/batch — propose against many files and KEEP the proposals.
// Writes to the worklist; writes NOTHING to any document.
router.post('/revisions/batch', receiveImportFiles, async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  const db = getDb();
  const batchId = uuid();
  const insBatch = db.prepare(`INSERT INTO document_revision_batches (id, note, file_count, created_by)
    VALUES (?, ?, ?, ?)`);
  const insItem = db.prepare(`INSERT INTO document_revision_items
    (id, batch_id, filename, document_id, matched_on, changes, extracted, warnings)
    VALUES (?,?,?,?,?,?,?,?)`);

  const rows = [];
  const failed = [];
  for (const f of req.files) {
    try {
      const { text, pages, isMarkdown } = await extractDocText(f);
      const meta = guessMeta(f.originalname, text);
      const rev = guessRevision(text);
      const content = isMarkdown ? text : textToMarkdown(text);
      const extracted = { ...meta, ...rev, content };
      const { doc, matched_on } = matchDocument(db, meta);
      rows.push({
        id: uuid(), filename: f.originalname,
        document_id: doc ? doc.id : null, matched_on: matched_on || null,
        changes: doc ? proposeChanges(doc, extracted) : [],
        extracted, warnings: extractWarnings(f, content, pages, isMarkdown),
      });
    } catch (err) {
      // A file that cannot be read is REPORTED, not filed as an empty proposal —
      // a row proposing nothing reads later as "we looked and there was no change".
      failed.push({ filename: f.originalname, error: err.message });
    }
  }

  db.transaction(() => {
    insBatch.run(batchId, clean(req.body?.note, 300), rows.length, req.user.name);
    for (const r of rows) {
      insItem.run(r.id, batchId, r.filename, r.document_id, r.matched_on,
        JSON.stringify(r.changes), JSON.stringify(r.extracted), JSON.stringify(r.warnings || []));
    }
  })();

  logAudit(req.user, 'create', 'document_revision_batch', batchId,
    { files: rows.length, unreadable: failed.length }, null, null, `${rows.length} documents`);
  res.json({ batch_id: batchId, filed: rows.length, unreadable: failed });
});

// GET /revisions/worklist — what is outstanding, in the order to work it.
router.get('/revisions/worklist', (req, res) => {
  const db = getDb();
  const all = db.prepare(`SELECT i.*, d.doc_number, d.title AS doc_title, d.revision AS doc_revision,
      d.review_due, d.status AS doc_status
    FROM document_revision_items i LEFT JOIN sop_documents d ON d.id = i.document_id
    ORDER BY i.created_at DESC LIMIT 1000`).all()
    .map(r => ({
      ...r,
      changes: JSON.parse(r.changes || '[]'),
      warnings: JSON.parse(r.warnings || '[]'),
      // The extracted body is megabytes of document text, searched and never
      // shipped — the equipment-manual rule. The proposal already carries the
      // sizes, which is what a person decides from.
      extracted: undefined,
    }));
  const pending = all.filter(r => r.state === 'pending');
  res.json({
    progress: worklistProgress(all),
    items: orderWorklist(pending, { today: new Date().toISOString().slice(0, 10) }),
    recent_done: all.filter(r => r.state !== 'pending').slice(0, 40),
  });
});

// POST /revisions/items/:id/apply — apply the ticked fields for one item.
router.post('/revisions/items/:id/apply', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM document_revision_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.state !== 'pending') return res.status(409).json({ error: 'Already decided' });
  if (!item.document_id) {
    return res.status(400).json({ error: 'This file matched no document. Say which one it is, or skip it.' });
  }
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(item.document_id);
  if (!doc) return res.status(404).json({ error: 'That document is no longer in the registry' });

  // The fields the person ticked, taken from the STORED proposal rather than
  // from the request body — so what applies is what was reviewed, and a stale
  // browser cannot write a value nobody saw.
  const proposal = JSON.parse(item.changes || '[]');
  const ticked = new Set(req.body?.fields || proposal.map(c => c.field));
  const extracted = JSON.parse(item.extracted || '{}');
  const fields = {};
  for (const c of proposal) {
    if (!ticked.has(c.field)) continue;
    fields[c.field] = c.field === 'description' ? extracted.content : c.to;
  }

  const r = applyRevision(db, doc, fields, { actor: req.user, filename: item.filename });
  if (r.error) return res.status(400).json({ error: r.error });
  db.prepare(`UPDATE document_revision_items SET state = 'applied', applied_fields = ?,
    decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(Object.keys(fields)), req.user.name, item.id);
  res.json({ ok: true, document: r.document, applied: r.applied });
});

// POST /revisions/items/:id/skip — a decision, with a reason, not a delete.
// The row survives: "we looked at this file and did not apply it" is an answer
// an auditor can be given, and a removed row cannot give it.
router.post('/revisions/items/:id/skip', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM document_revision_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.state !== 'pending') return res.status(409).json({ error: 'Already decided' });
  const reason = clean(req.body?.reason, 400);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'A reason is required' });
  db.prepare(`UPDATE document_revision_items SET state = 'skipped', skip_reason = ?,
    decided_by = ?, decided_at = datetime('now') WHERE id = ?`).run(reason, req.user.name, item.id);
  logAudit(req.user, 'update', 'document_revision_item', item.id, { skipped: reason }, null, null, item.filename);
  res.json({ ok: true });
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
  res.json(db.prepare(sql).all(...params).map(withEquipment));
});

// ── Wet signatures on controlled documents ──────────────────────────────────
// Danny (or QA, or Document Control) draws their signature ONCE on a phone;
// signing a document applies it. The signature row stamps name, capacity,
// time AND a snapshot of the drawn image — self-contained history, so
// re-drawing the stored signature never rewrites what a signed document
// shows. Declared before the '/:id' routes ('signatures' is a perfectly good
// :id — the org /meta trap).

const canWetSign = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'document_control'].includes((u?.department || '').toLowerCase());

router.get('/:id/signatures', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM document_signatures WHERE document_id = ? ORDER BY signed_at').all(req.params.id));
});

router.post('/:id/sign', (req, res) => {
  if (!canWetSign(req.user)) return res.status(403).json({ error: 'Signing a controlled document is for QA, Document Control, supervisors and admins.' });
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  // A withdrawn document is history — nobody signs history into effect.
  if (doc.status === 'archived') return res.status(409).json({ error: 'This document is no longer in use — reinstate it before signing.' });
  const capacity = String(req.body?.capacity || '').trim();
  if (capacity.length < 2) return res.status(400).json({ error: 'Say in what capacity you are signing (e.g. CEO, Quality Assurance).' });
  // The drawn image is what makes this a WET signature — without one on file,
  // the button sends the person to draw it first rather than filing a
  // signature with nothing behind it.
  const sig = db.prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id)?.signature_image;
  if (!sig) return res.status(409).json({ error: 'Draw your signature first (Account menu → My signature), then sign.', needs_signature: true });
  if (db.prepare('SELECT 1 FROM document_signatures WHERE document_id = ? AND user_id = ? AND capacity = ?')
    .get(doc.id, req.user.id, capacity)) {
    return res.status(409).json({ error: 'You have already signed this document in that capacity.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO document_signatures (id, document_id, user_id, name, capacity, signature_image)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, doc.id, req.user.id, req.user.name, capacity, sig);
  logAudit(req.user, 'document_signed', 'document', doc.id,
    { capacity, doc_number: doc.doc_number }, null, null, `${doc.doc_number || ''} ${doc.title}`.trim());
  res.status(201).json(db.prepare('SELECT * FROM document_signatures WHERE id = ?').get(id));
});

// The way back is revoke — the signer, or an admin. Audited like every revoke.
router.delete('/signatures/:sigId', (req, res) => {
  const db = getDb();
  const sig = db.prepare('SELECT * FROM document_signatures WHERE id = ?').get(req.params.sigId);
  if (!sig) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && sig.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the person who signed, or an admin, can revoke a signature.' });
  }
  db.prepare('DELETE FROM document_signatures WHERE id = ?').run(sig.id);
  logAudit(req.user, 'document_signature_revoked', 'document', sig.document_id,
    { signed_by: sig.name, capacity: sig.capacity }, sig, null);
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(withEquipment(doc));
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

  // Review frequency defaults to annual (SQF baseline). When no explicit review
  // date is given, derive it from the effective date (or today) + the frequency.
  const reviewFrequency = REVIEW_FREQ_MONTHS[req.body.review_frequency] ? req.body.review_frequency : 'annual';
  let reviewDue = review_due || null;
  if (!reviewDue) {
    const months = REVIEW_FREQ_MONTHS[reviewFrequency];
    const base = effective_date || null;
    reviewDue = base
      ? db.prepare(`SELECT date(?, ?) d`).get(base, `+${months} months`).d
      : db.prepare(`SELECT date('now', ?) d`).get(`+${months} months`).d;
  }

  const equipmentIds = normalizeEquipmentIds(req.body);

  db.prepare(`INSERT INTO sop_documents
    (id, doc_type, doc_number, title, category, revision, effective_date, review_due, review_frequency, status, owner, description, source_file, approved_by, approved_at, equipment_id, equipment_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, type, doc_number || '', title, category, revision || '1.0',
    effective_date || null, reviewDue, reviewFrequency, st, owner || null,
    content || null, source_file || null, approvedBy, approvedAt,
    equipmentIds[0] || null, equipmentIds.length ? JSON.stringify(equipmentIds) : null
  );

  const created = withEquipment(db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(id));
  db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), id, created.revision, req.user.name, 'Created', JSON.stringify(created));
  logAudit(req.user, 'document_created', 'document', id, { doc_type: type, title, category });
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { doc_number, title, category, revision, effective_date, review_due, review_frequency, status, owner, content, source_file, _change_summary, _minor, content_es } = req.body;

  const newStatus = status || existing.status;
  // Resolve review frequency (validate against known values) and, if the caller
  // changed the frequency without supplying an explicit review date, re-derive
  // the next review date from the effective date (or today) + the new frequency.
  const newFrequency = REVIEW_FREQ_MONTHS[review_frequency]
    ? review_frequency
    : (existing.review_frequency || 'annual');
  let newReviewDue = review_due ?? existing.review_due;
  if (review_frequency && newFrequency !== existing.review_frequency && review_due === undefined) {
    const months = REVIEW_FREQ_MONTHS[newFrequency];
    const base = effective_date ?? existing.effective_date;
    newReviewDue = base
      ? db.prepare(`SELECT date(?, ?) d`).get(base, `+${months} months`).d
      : db.prepare(`SELECT date('now', ?) d`).get(`+${months} months`).d;
  }
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

  const equipmentIds = normalizeEquipmentIds(req.body, existing);

  db.prepare(`UPDATE sop_documents SET doc_number=?, title=?, category=?, revision=?, effective_date=?, review_due=?, review_frequency=?, status=?, owner=?, description=?, description_es=?, source_file=?, approved_by=?, approved_at=?, training_revision=?, equipment_id=?, equipment_ids=?, updated_at=datetime('now') WHERE id=?`).run(
    doc_number ?? existing.doc_number, title || existing.title, category || existing.category,
    newRevision, effective_date ?? existing.effective_date,
    newReviewDue, newFrequency, newStatus, owner ?? existing.owner,
    content ?? existing.description, content_es !== undefined ? content_es : existing.description_es,
    source_file ?? existing.source_file,
    approvedBy, approvedAt, trainingRevision,
    equipmentIds[0] || null, equipmentIds.length ? JSON.stringify(equipmentIds) : null,
    req.params.id
  );

  const updated = withEquipment(db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id));
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

/**
 * Withdraw a document — mark it no longer in use.
 *
 * The document is NOT deleted and does not stop being readable. Someone
 * following a Work Instruction last month needs to be able to see the one they
 * followed, and an auditor asking "what did you withdraw and when" gets an
 * answer rather than an absence. What changes is that it leaves the active
 * registry and is stamped, everywhere it appears, as no longer in use.
 *
 * A reason is required. A controlled document withdrawn with nothing written
 * against it is indistinguishable six months later from a mis-click.
 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) {
    return res.status(400).json({ error: 'Say why this document is no longer in use — it stays on the record and an auditor will ask.' });
  }
  // `effective_from` lets a withdrawal be dated to when it actually stopped
  // applying, which is not always the day somebody got round to recording it.
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.effective_from || '')
    ? req.body.effective_from : new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE sop_documents SET status='archived', archived_at=?, archived_by=?,
    archive_reason=?, updated_at=datetime('now') WHERE id=?`)
    .run(effective, req.user.name, reason, req.params.id);
  const updated = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'document_archived', 'document', req.params.id,
    { title: existing.title, doc_number: existing.doc_number, reason, effective_from: effective },
    existing, updated);
  res.json({ success: true, document: updated });
});

/**
 * Put a withdrawn document back into use.
 *
 * The way back from a withdrawal is a deliberate act with its own audit entry,
 * not an edit that silently clears three columns — the same rule as revoking a
 * signature. It returns to draft rather than straight to approved: whatever
 * made it wrong enough to withdraw should be looked at before it is effective
 * again.
 */
router.post('/:id/reinstate', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status !== 'archived') return res.status(409).json({ error: 'This document is already in use.' });
  db.prepare(`UPDATE sop_documents SET status='draft', archived_at=NULL, archived_by=NULL,
    archive_reason=NULL, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  const updated = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'document_reinstated', 'document', req.params.id,
    { title: existing.title, was_withdrawn: existing.archived_at, prior_reason: existing.archive_reason },
    existing, updated);
  res.json({ success: true, document: updated });
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
  const sigs = db.prepare('SELECT * FROM document_signatures WHERE document_id = ? ORDER BY signed_at').all(doc.id);
  generatePDF(res, [doc], { [doc.id]: sigs });
});

router.post('/pdf', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  const docs = db.prepare(`SELECT * FROM sop_documents WHERE id IN (${placeholders}) ORDER BY category, doc_number`).all(...ids);
  if (!docs.length) return res.status(404).json({ error: 'No documents found' });
  const sigsByDoc = {};
  for (const d of docs) sigsByDoc[d.id] = db.prepare('SELECT * FROM document_signatures WHERE document_id = ? ORDER BY signed_at').all(d.id);
  generatePDF(res, docs, sigsByDoc);
});

const STATUS_LABEL = { draft: 'Draft', under_review: 'In Review', active: 'Approved / Effective', superseded: 'Superseded', archived: 'Archived' };

function generatePDF(res, docs, sigsByDoc = null) {
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
      const bodyLines = doc.description.split('\n');
      for (let li = 0; li < bodyLines.length; li++) {
        const raw = bodyLines[li];
        const trimmed = raw.trim();
        if (!trimmed) { pdf.y += 6; continue; }
        // A TABLE IS DRAWN AS A TABLE. Without this branch a pipe row fell
        // through to plain text, which is why an SOP full of tables printed as
        // a page of pipe characters.
        const table = tableAt(bodyLines, li);
        if (table) {
          pdf.y += 4;
          drawTable(pdf, table, { left: LEFT, width: BODY_W, pageBottom: PAGE_BOTTOM });
          li = table.next - 1;
          continue;
        }
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

    // Wet signatures — the drawn image beside name, capacity and date, the way
    // a signed paper original reads. Rendered from each signature's own stored
    // snapshot, never the signer's current pad.
    const sigs = (sigsByDoc && sigsByDoc[doc.id]) || [];
    if (sigs.length) {
      ensureSpace(60 + sigs.length * 58);
      pdf.moveDown(1.5);
      pdf.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text('Signatures', LEFT, pdf.y, { width: BODY_W });
      pdf.moveDown(0.4);
      for (const s of sigs) {
        ensureSpace(58);
        const y = pdf.y;
        let drew = false;
        if (s.signature_image && s.signature_image.startsWith('data:image/')) {
          try {
            const buf = Buffer.from(s.signature_image.split(',')[1], 'base64');
            pdf.image(buf, LEFT, y, { fit: [150, 40] });
            drew = true;
          } catch { /* fall through to text-only */ }
        }
        pdf.fillColor('#111827').fontSize(10).font('Helvetica-Bold')
          .text(s.name, LEFT + (drew ? 165 : 0), y + 4, { width: BODY_W - (drew ? 165 : 0), lineBreak: false });
        pdf.fillColor('#4b5563').fontSize(9).font('Helvetica')
          .text(`${s.capacity} · ${String(s.signed_at).slice(0, 10)}`, LEFT + (drew ? 165 : 0), y + 18, { width: BODY_W - (drew ? 165 : 0), lineBreak: false });
        pdf.moveTo(LEFT, y + 46).lineTo(RIGHT, y + 46).strokeColor('#e5e7eb').stroke();
        pdf.y = y + 52;
        pdf.x = LEFT;
      }
    }

    pdf.save();
    pdf.fillColor('#9ca3af').fontSize(7).font('Helvetica');
    pdf.page.margins.bottom = 0;
    pdf.text(footerText, LEFT, 745, { width: BODY_W, align: 'center', lineBreak: false });
    pdf.restore();
  });

  pdf.end();
}

/* ── Attachments (signed paper originals + supporting files) ─────────────── */
// The migration case: each controlled document keeps its last approved PAPER
// version attached, scanned, so the signed original stays with the record that
// replaced it. Uses the same disk-backed media pipeline as course materials —
// large scans stream to storage rather than buffering in memory.

const docFileUpload = mediaUpload({ files: 10 }).array('files', 10);
const uploadDocFiles = (req, res, next) => docFileUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

router.get('/:id/attachments', async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM document_attachments WHERE document_id = ? ORDER BY created_at DESC').all(req.params.id);
  // ONE UNREADABLE FILE MUST NOT HIDE THE REST. Every row was presigned in a
  // single Promise.all, so a storage hiccup on one object rejected the whole
  // request and the attachments list came back empty — the file was uploaded,
  // recorded and stored, and the screen said there was nothing there. The row
  // is what proves the attachment exists; the link is a convenience, and a
  // missing one now says so instead of taking the list down with it.
  res.json(await Promise.all(rows.map(async a => {
    let url = null, link_error = null;
    try { url = await presignGet(a.storage_key, a.filename); }
    catch (e) {
      link_error = e.message || 'The file could not be opened from storage.';
      console.warn('[documents] presign failed for attachment', a.id, e.message);
    }
    return {
      id: a.id, kind: a.kind, title: a.title, filename: a.filename,
      content_type: a.content_type, size: a.size, revision: a.revision,
      uploaded_by: a.uploaded_by, created_at: a.created_at,
      url, link_error,
    };
  })));
});

router.post('/:id/attachments', uploadDocFiles, async (req, res) => {
  const files = req.files || [];
  try {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    const db = getDb();
    const doc = db.prepare('SELECT id, doc_number, title FROM sop_documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const kind = req.body?.kind === 'signed_original' ? 'signed_original' : 'attachment';
    const out = [];
    for (const f of files) {
      const id = uuid();
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `documents/${doc.id}/${id}-${safe}`;
      await putStream(key, createReadStream(f.path), f.mimetype);
      db.prepare(`INSERT INTO document_attachments
        (id, document_id, kind, title, filename, content_type, size, storage_key, revision, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, doc.id, kind, (req.body?.title || '').slice(0, 200) || null,
        (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null, key,
        (req.body?.revision || '').slice(0, 40) || null, req.user?.name || null);
      out.push({ id, filename: f.originalname, kind });
    }
    logAudit(req.user, 'attach', 'document', doc.id,
      { kind, files: out.map(o => o.filename) }, null, null, `${doc.doc_number} ${doc.title}`);
    res.status(201).json(out);
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/attachments/:id', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM document_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  // A signed paper original is the evidence the electronic record replaced;
  // removing one is an admin decision, not routine housekeeping.
  if (a.kind === 'signed_original' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can remove a signed original.' });
  }
  db.prepare('DELETE FROM document_attachments WHERE id = ?').run(a.id);
  deleteObject(a.storage_key); // best effort; the row is already gone
  logAudit(req.user, 'delete', 'document_attachment', a.id,
    { filename: a.filename, kind: a.kind }, a, null, a.filename);
  res.json({ ok: true });
});

export default router;
