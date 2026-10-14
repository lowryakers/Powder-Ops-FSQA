// A panel file is read, hashed and named; its values land on the draft as
// "extracted from file"; and a file that changed under a reused name says so
// (D-174). Everything here is called from api/nfp.js; nothing is a route.
//
// THE FILE IS THE RECORD. It is stored and hashed before anything is read out
// of it, and a reader that fails leaves a file row reading `extract_status =
// failed` — a draft that silently lost its PDF is worse than one with values
// still to type.
//
// THE READER FILLS BLANKS ONLY, NEVER A TYPED FIELD (the AP Drop rule). Where
// the draft already carries a value and the file says something else, the
// disagreement is a MISMATCH, derived on every read, and the person decides
// which is right — the file or what was typed. Nothing is overwritten by a
// machine reading a PDF.
import { createHash } from 'crypto';
import { extractPdfText } from './api/documents.js';
import { aiEnabled, readPanelImage } from './ai.js';
import { extractPanel, extractMismatches } from '../shared/panel-extract.js';
import { PANEL_VALUE_FIELDS, valuesOf } from '../shared/panel-reconcile.js';

export const EXTRACTED_SOURCE = 'extracted from file';

/** The types a panel file may be: the designer's PDF, or a PNG/JPG of the panel. */
export const PANEL_FILE_TYPES = Object.freeze({
  pdf: { mime: /pdf/i, magic: (b) => b.slice(0, 5).toString('latin1') === '%PDF-', content: 'application/pdf' },
  png: { mime: /png/i, magic: (b) => b.slice(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), content: 'image/png' },
  jpg: { mime: /jpe?g/i, magic: (b) => b[0] === 0xff && b[1] === 0xd8, content: 'image/jpeg' },
  jpeg: { mime: /jpe?g/i, magic: (b) => b[0] === 0xff && b[1] === 0xd8, content: 'image/jpeg' },
});

/** Which panel file type this is, from the name, the declared type and the first bytes — or null. */
export function panelFileType(filename, mimetype, head) {
  const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const t = ext && PANEL_FILE_TYPES[ext];
  if (!t) return null;
  if (!t.mime.test(mimetype || '')) return null;
  if (!head || !t.magic(head)) return null;
  return { ext: ext === 'jpeg' ? 'jpg' : ext, content: t.content };
}

export const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** `<SKU>_<version>_<YYYY-MM-DD>.<ext>` — the stored name. The original is kept beside it. */
export function storedPanelName(sku, version, ext, date = new Date()) {
  const clean = (s) => String(s || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean(sku)}_${clean(version)}_${date.toISOString().slice(0, 10)}.${ext}`;
}

/**
 * Read the text out of a panel file: the PDF's text layer first; a PDF with
 * none, or an image, goes to vision when AI is configured. Never throws —
 * the status says what happened.
 */
export async function readPanelText(buffer, contentType) {
  const isPdf = /pdf/i.test(contentType || '');
  try {
    if (isPdf) {
      const res = await extractPdfText(buffer);
      const text = (typeof res === 'string' ? res : res?.text || '').trim();
      if (text.length >= 20) return { text: text.slice(0, 20000), status: 'ok', via: 'text_layer' };
    }
    if (!aiEnabled()) return { text: '', status: isPdf ? 'empty' : 'skipped', via: null,
      note: isPdf ? 'The PDF has no text layer and AI is not configured to read the image.' : 'AI is not configured to read an image.' };
    const text = await readPanelImage(buffer, isPdf ? 'application/pdf' : contentType);
    if (text && text.trim()) return { text: text.trim().slice(0, 20000), status: 'ok', via: 'vision' };
    return { text: '', status: 'empty', via: 'vision', note: 'Nothing legible as a panel was found in the file.' };
  } catch (e) {
    return { text: '', status: 'failed', via: null, note: e.message };
  }
}

/** Read and parse: `{ text, status, via, note, values, evidence, unread, found }`. */
export async function extractFromFile(buffer, contentType) {
  const read = await readPanelText(buffer, contentType);
  if (read.status !== 'ok') return { ...read, values: {}, evidence: {}, unread: [], found: false };
  const parsed = extractPanel(read.text);
  if (!parsed.found) return { ...read, status: 'empty', note: 'The text was read but no Nutrition Facts panel was found in it.', ...parsed };
  return { ...read, ...parsed };
}

const readJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The stored panel in the reader's field names: the value fields, plus the %DV columns under their own names. */
export function storedValues(panel) {
  const out = {};
  for (const [k, val] of Object.entries(panel || {})) if (/_dv$/.test(k)) out[k] = val;
  return { ...out, ...valuesOf(panel || {}) };
}

/**
 * Apply an extraction to a draft: fill every BLANK panel field from the file,
 * stamp each with source "extracted from file", bump the revision when
 * anything landed. A field that already carries a value is left exactly as it
 * is — the mismatch list is where that disagreement is reported. Returns the
 * fields filled. The caller owns the transaction and the audit entry.
 */
export function applyExtractionToDraft(db, v, fileRow, extracted, who) {
  const panel = readJson(v.panel_json) || {};
  const sources = readJson(v.panel_sources) || {};
  const filled = [];
  const now = new Date().toISOString();
  for (const [field, value] of Object.entries(extracted.values || {})) {
    const col = PANEL_VALUE_FIELDS[field] || (/_dv$/.test(field) ? field : null);
    if (!col) continue;
    const current = panel[col];
    if (current !== null && current !== undefined && current !== '') continue;
    panel[col] = value;
    sources[field] = { source: EXTRACTED_SOURCE, ref: fileRow.original_filename || fileRow.filename, file_id: fileRow.id, by: who, at: now };
    filled.push(field);
  }
  if (!filled.length) return [];
  // The serving halves generate the label (D-173).
  if (filled.includes('serving_grams') || filled.includes('serving_household')) {
    const h = panel.serving_household; const g = panel.serving_grams;
    panel.serving_size_desc = h ? `${h} (${g}g)` : `${g} g`;
    const single = /^\d+(\.\d+)?$/.test(String(g)) ? Number(g) : null;
    panel.serving_size_g = single;
  }
  db.prepare(`UPDATE nfp_versions SET panel_json = ?, panel_sources = ?, panel_rev = panel_rev + 1,
    panel_values_by = ?, panel_values_at = datetime('now'),
    panel_source_ref = COALESCE(panel_source_ref, ?), panel_source_by = COALESCE(panel_source_by, ?), panel_source_at = COALESCE(panel_source_at, datetime('now')),
    updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(panel), JSON.stringify(sources), who, `${EXTRACTED_SOURCE}: ${fileRow.original_filename || fileRow.filename}`, who, v.id);
  if (panel.serving_size_desc) db.prepare('UPDATE nfp_versions SET serving_size = ? WHERE id = ?').run(String(panel.serving_size_desc), v.id);
  if (panel.servings_per_container !== undefined && panel.servings_per_container !== null) {
    db.prepare('UPDATE nfp_versions SET servings_per_container = ? WHERE id = ?').run(String(panel.servings_per_container), v.id);
  }
  return filled;
}

/**
 * The fields where the file and the stored panel disagree, less the ones a
 * person has already resolved against exactly these two values. Derived on
 * every read from the panel file's own extraction.
 */
export function mismatchesFor(v, panelFile) {
  const extracted = readJson(panelFile?.extracted_json);
  if (!extracted?.values) return [];
  const stored = storedValues(readJson(v.panel_json) || {});
  const all = extractMismatches(stored, extracted.values);
  const resolutions = readJson(v.extract_resolutions) || {};
  return all.map((m) => {
    const r = resolutions[m.field];
    const resolved = r && r.fingerprint === m.fingerprint ? r : null;
    return { ...m, label: m.field, resolved: resolved ? { choice: resolved.choice, by: resolved.by, at: resolved.at } : null };
  });
}

/**
 * What a draft's panel file is relative to the SKU's approved panel file:
 *  - `same_file`: identical bytes;
 *  - `file_changed_same_name`: the designer's name is the same, the bytes are not;
 *  - `new_file`: a different name and different bytes;
 *  - `values_changed_file_not_updated`: the values on the draft moved after
 *    the file was uploaded, and the file is still the approved one's bytes.
 * Null when there is no panel file on the draft or nothing approved to compare to.
 */
export function fileStatusFor(v, panelFile, approvedFile) {
  if (!panelFile) return null;
  const out = { sha256: panelFile.sha256 || null, original_filename: panelFile.original_filename || panelFile.filename,
    stored_filename: panelFile.filename, uploaded_at: panelFile.created_at, labels: [] };
  if (approvedFile && panelFile.sha256 && approvedFile.sha256) {
    const sameName = (panelFile.original_filename || panelFile.filename) === (approvedFile.original_filename || approvedFile.filename);
    if (panelFile.sha256 === approvedFile.sha256) {
      out.labels.push('same_file');
      if (v.panel_values_at && panelFile.created_at && String(v.panel_values_at) > String(panelFile.created_at)) {
        out.labels.push('values_changed_file_not_updated');
      }
    } else if (sameName) {
      out.labels.push('file_changed_same_name');
    } else {
      out.labels.push('new_file');
    }
  }
  return out;
}

export const FILE_LABEL = Object.freeze({
  same_file: 'Same file as the approved panel',
  file_changed_same_name: 'File changed, same name as the approved panel',
  new_file: 'New file',
  values_changed_file_not_updated: 'Values changed, file not updated',
});
