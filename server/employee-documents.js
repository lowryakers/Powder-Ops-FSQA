// Filling and signing a PDF an employee was sent. PURE: bytes in, bytes out.
// No database, no Express — the thing that produces a signed tax form should
// be checkable without standing up a server (the `partner-recon.js` doctrine).
//
// Three jobs:
//   readFields(pdf)      — what the PDF asks for (its AcroForm fields), in the
//                          order the form lists them, labelled from the field's
//                          own tooltip so an IRS name like `f1_01[0]` reads as
//                          "Step 1(a) First name and middle initial".
//   signPdf(pdf, …)      — the employee's answers written into those fields,
//                          the form FLATTENED so the answers are ink rather
//                          than editable boxes, and a signature record page
//                          appended: the drawn signature, the typed name, when,
//                          from where, under what statement, and the SHA-256 of
//                          the document as it was sent.
//   ATTESTATION          — the one statement every signature is given under.
//
// THE SIGNATURE IS A PAGE, NOT A STAMP DROPPED ONTO THE FORM. An IRS form has
// its signature line at a position this code cannot know for an arbitrary PDF,
// and a stamp landing over the "Employer's name" box is a form nobody can
// read. The appended page is what every e-signature service produces — the
// signature, the signer, the time, the evidence — and it is bound to the
// document by the hash of the pages before it.
import { createHash } from 'crypto';
import { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts, rgb,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib';

export const ATTESTATION = 'I have read this document. The signature I drew is my electronic signature, and I intend it to have the same legal effect as my handwritten signature on this document. I understand a copy is filed against my name in ReadyDoc.';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// pdf-lib's standard fonts are WinAnsi: a character outside that set throws at
// draw time. Names with accents are inside it; an emoji or a smart quote from
// a phone keyboard is not, and a signature page must never fail on one.
const winAnsi = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF‘’“”–—•€]/g, '?');

function tooltipOf(field) {
  try {
    const tu = field.acroField.dict.lookup(PDFName.of('TU'));
    if (tu instanceof PDFString || tu instanceof PDFHexString) return tu.decodeText();
  } catch { /* no tooltip */ }
  return null;
}

function typeOf(field) {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  return null; // buttons, signature fields — nothing to ask
}

async function load(bytes) {
  // ignoreEncryption: IRS forms are routinely "encrypted" with an empty owner
  // password to stop editing in Acrobat; the content is readable.
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/**
 * The fillable fields of a PDF, in form order. A PDF with no AcroForm (or an
 * XFA form pdf-lib cannot read) returns [] — the document is then signed as
 * read, which is right for a policy and reported for a form.
 * @returns {Promise<Array<{name:string,label:string,type:string,options?:string[],max_length?:number,multiline?:boolean,required?:boolean}>>}
 */
export async function readFields(bytes) {
  let doc;
  try { doc = await load(bytes); } catch { return []; }
  let fields;
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const out = [];
  for (const f of fields) {
    const type = typeOf(f);
    if (!type) continue;
    if (f.isReadOnly()) continue;
    const item = { name: f.getName(), label: tooltipOf(f) || f.getName(), type };
    if (type === 'text') {
      const max = f.getMaxLength();
      if (max) item.max_length = max;
      if (f.isMultiline()) item.multiline = true;
      const v = f.getText();
      if (v) item.value = v;
    } else if (type === 'checkbox') {
      item.value = f.isChecked();
    } else if (type === 'radio' || type === 'dropdown' || type === 'optionlist') {
      item.options = f.getOptions();
      const sel = type === 'optionlist' ? f.getSelected() : f.getSelected();
      if (Array.isArray(sel) ? sel.length : sel) item.value = Array.isArray(sel) ? sel[0] : sel;
      if (type === 'dropdown' && f.isEditable()) item.editable = true;
    }
    if (f.isRequired()) item.required = true;
    out.push(item);
  }
  return out;
}

/**
 * Write the answers into the form. Unknown names are ignored (a stale client
 * cannot break a signing); a value a field cannot take is an error naming the
 * field, because a W-4 filed with a filing status silently dropped is worse
 * than a refusal.
 */
function applyValues(form, values) {
  const errors = [];
  const byName = new Map(form.getFields().map(f => [f.getName(), f]));
  for (const [name, raw] of Object.entries(values || {})) {
    const f = byName.get(name);
    if (!f || f.isReadOnly()) continue;
    try {
      if (f instanceof PDFTextField) {
        const s = winAnsi(raw == null ? '' : String(raw));
        const max = f.getMaxLength();
        f.setText(max && s.length > max ? s.slice(0, max) : s);
      } else if (f instanceof PDFCheckBox) {
        if (raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on') f.check(); else f.uncheck();
      } else if (f instanceof PDFRadioGroup) {
        if (raw == null || raw === '') continue;
        if (!f.getOptions().includes(String(raw))) { errors.push(`"${tooltipOf(f) || name}" cannot be "${raw}".`); continue; }
        f.select(String(raw));
      } else if (f instanceof PDFDropdown) {
        if (raw == null || raw === '') continue;
        if (!f.getOptions().includes(String(raw)) && !f.isEditable()) { errors.push(`"${tooltipOf(f) || name}" cannot be "${raw}".`); continue; }
        f.select(String(raw));
      } else if (f instanceof PDFOptionList) {
        if (raw == null || raw === '') continue;
        const want = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        const bad = want.find(w => !f.getOptions().includes(w));
        if (bad) { errors.push(`"${tooltipOf(f) || name}" cannot be "${bad}".`); continue; }
        f.select(want);
      }
    } catch (e) {
      errors.push(`"${tooltipOf(f) || name}": ${e.message}`);
    }
  }
  return errors;
}

/**
 * Fill, flatten, and append the signature record.
 * @param {Uint8Array|Buffer} bytes  the PDF as sent
 * @param {object} args
 * @param {object} [args.values]           field answers by field name
 * @param {string} args.signatureImage     data URL of the drawn PNG
 * @param {object} args.signer             {name, username?, id}
 * @param {object} args.evidence           {at, ip, ua, verified}
 * @param {object} args.document           {title, filename, sent_by, sent_at, request_id}
 * @returns {Promise<{bytes:Uint8Array, errors:string[], source_sha256:string, pages:number}>}
 */
export async function signPdf(bytes, { values = {}, signatureImage, signer, evidence, document }) {
  const source_sha256 = sha256(Buffer.from(bytes));
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const form = (() => { try { return doc.getForm(); } catch { return null; } })();
  if (form && form.getFields().length) {
    const errors = applyValues(form, values);
    if (errors.length) return { bytes: null, errors, source_sha256, pages: doc.getPageCount() };
    // Ink, not boxes. Appearances are regenerated with a font pdf-lib knows so
    // the flattened text is drawn rather than left to the viewer, and the
    // flatten is what stops the answers being edited after signing.
    try { form.updateFieldAppearances(font); } catch { /* fields with their own DA keep it */ }
    try { form.flatten(); } catch (e) { return { bytes: null, errors: [`The form could not be locked: ${e.message}`], source_sha256, pages: doc.getPageCount() }; }
  }

  // ── The signature record page ──
  const page = doc.addPage([612, 792]);
  const M = 56;
  let y = 792 - M;
  const text = (s, { size = 10, f = font, color = rgb(0.15, 0.15, 0.15), x = M, dy = 14 } = {}) => {
    page.drawText(winAnsi(s), { x, y: y - size, size, font: f, color });
    y -= dy;
  };
  const wrap = (s, size = 10, width = 612 - 2 * M) => {
    const words = winAnsi(s).split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) > width && line) { lines.push(line); line = w; } else line = cand;
    }
    if (line) lines.push(line);
    return lines;
  };
  const row = (label, value) => {
    page.drawText(winAnsi(label), { x: M, y: y - 10, size: 9, font: bold, color: rgb(0.35, 0.35, 0.35) });
    const lines = wrap(value || '—', 10, 612 - 2 * M - 150);
    lines.forEach((l, i) => page.drawText(l, { x: M + 150, y: y - 10 - i * 13, size: 10, font, color: rgb(0.1, 0.1, 0.1) }));
    y -= 13 * Math.max(1, lines.length) + 5;
  };

  text('Signature record', { size: 18, f: bold, dy: 26 });
  text('This page was added by ReadyDoc when the document was signed electronically. It is part of the signed document.', { size: 9, color: rgb(0.4, 0.4, 0.4), dy: 22 });

  text('Document', { size: 11, f: bold, dy: 18 });
  row('Title', document.title);
  row('File as sent', document.filename || '—');
  row('SHA-256 as sent', source_sha256);
  row('Sent by', `${document.sent_by || '—'}${document.sent_at ? ` on ${document.sent_at}` : ''}`);
  row('ReadyDoc record', document.request_id || '—');
  y -= 8;

  text('Signer', { size: 11, f: bold, dy: 18 });
  row('Name as signed', signer.name);
  row('Account', signer.username ? `${signer.username} (${signer.id})` : signer.id);
  row('Signed at', evidence.at);
  row('Network address', evidence.ip || 'not recorded');
  row('Device', evidence.ua || 'not recorded');
  row('Identity check', evidence.verified ? 'Password confirmed at the moment of signing' : 'Not password-verified');
  y -= 8;

  text('Statement signed under', { size: 11, f: bold, dy: 18 });
  for (const l of wrap(ATTESTATION, 10)) text(l, { size: 10, dy: 13 });
  y -= 10;

  text('Signature', { size: 11, f: bold, dy: 18 });
  if (signatureImage) {
    const b64 = String(signatureImage).replace(/^data:image\/png;base64,/, '');
    const png = await doc.embedPng(Buffer.from(b64, 'base64'));
    const maxW = 280, maxH = 100;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    const w = png.width * scale, h = png.height * scale;
    page.drawRectangle({ x: M, y: y - h - 12, width: Math.max(w + 24, 240), height: h + 16, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5, color: rgb(0.985, 0.985, 0.985) });
    page.drawImage(png, { x: M + 12, y: y - h - 4, width: w, height: h });
    y -= h + 22;
  }
  page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + 260, y: y - 4 }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
  y -= 8;
  text(`${signer.name} · ${evidence.at}`, { size: 9, color: rgb(0.3, 0.3, 0.3), dy: 14 });

  page.drawText(winAnsi(`ReadyDoc · Powder Ops · signed document record ${document.request_id || ''}`), { x: M, y: 30, size: 7.5, font, color: rgb(0.55, 0.55, 0.55) });

  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, errors: [], source_sha256, pages: doc.getPageCount() };
}
