// Text that survives the trip into a generated PDF (D-151).
//
// pdfkit's built-in Helvetica is WinAnsi — 256 characters. Anything outside it
// is not dropped, it is written as its raw UTF-16 bytes, which a viewer reads
// as Latin-1: a full-width letter becomes "ÿ%", a Chinese character "u5", an
// emoji "Ø=Ü". That is the garbled "Product Description" on the deviation
// Quality was attaching to MRPEasy MOs — the record was fine, the font had
// nowhere to put the characters.
//
// So user text is drawn in an EMBEDDED Unicode font, Liberation Sans (SIL OFL
// 1.1, licence beside it in assets/). It is metric-compatible with Helvetica —
// the same letter widths — so a layout drawn for Helvetica lays out the same.
// It covers Latin, Greek and Cyrillic; a character it still has no glyph for
// renders as an empty box, which says "something is here" instead of
// inventing letters. Emoji keep their own font through pdf-emoji.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FACES = {
  Sans: 'LiberationSans-Regular.ttf',
  'Sans-Bold': 'LiberationSans-Bold.ttf',
  'Sans-Italic': 'LiberationSans-Italic.ttf',
  'Sans-BoldItalic': 'LiberationSans-BoldItalic.ttf',
};
const cache = {};

/**
 * Register the four faces on a document. Returns a name map; if a font file is
 * missing (a deployment without the assets) the map falls back to Helvetica, so
 * an export still renders rather than failing.
 */
export function registerUnicodeFonts(doc) {
  const names = { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' };
  try {
    for (const [name, file] of Object.entries(FACES)) {
      cache[file] = cache[file] || fs.readFileSync(path.join(__dirname, 'assets', file));
      doc.registerFont(name, cache[file]);
    }
    return { regular: 'Sans', bold: 'Sans-Bold', italic: 'Sans-Italic', boldItalic: 'Sans-BoldItalic' };
  } catch { return names; }
}

/**
 * Prepare a value for print. NFKC folds compatibility forms onto the letters
 * they are — full-width "Ｅｌｅｃ" to "Elec", styled "𝐇𝐲𝐝𝐫" (pasted from a
 * product page) to "Hydr", ligatures to their letters — without changing what
 * the text says. Control characters other than newlines and tabs are removed.
 */
export function printable(value) {
  if (value == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(value).normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Draw an existing Helvetica layout in the embedded faces (D-234). A document
 * written against the built-in names ('Helvetica', 'Helvetica-Bold', …) keeps
 * every call as it is, and each one lands on the matching Liberation Sans
 * face — same metrics, so nothing moves, and "≤ 0.5 ppm" prints as written
 * instead of the "d 0.5 ppm" WinAnsi made of it on a COA a customer receives.
 * Any other font name passes through unchanged. Call once, right after
 * `new PDFDocument(...)`.
 */
// Built-in Helvetica cannot draw these; spelled out, they read correctly.
// (µ ± ° ™ × are in WinAnsi and need no help.)
const ASCII_FALLBACK = [[/≤/g, '<='], [/≥/g, '>='], [/≠/g, '!='], [/−/g, '-']];
/** "≤ 0.5 ppm" → "<= 0.5 ppm" for a document that could not load the embedded font. */
export const fallbackText = (s) => ASCII_FALLBACK.reduce((t, [re, to]) => t.replace(re, to), String(s));
let warnedFallback = false;

export function embedUnicodeFaces(doc, { forceFallback = false } = {}) {
  const F = forceFallback ? { regular: 'Helvetica' } : registerUnicodeFonts(doc);
  if (F.regular === 'Helvetica') {
    // The font files are missing: leave Helvetica in place, and write the
    // symbols it cannot draw as text rather than as garbage (D-239). Said once.
    if (!warnedFallback) { warnedFallback = true; console.warn('[pdf] embedded Unicode font unavailable — writing ≤ ≥ as <= >= in generated PDFs'); }
    const text = doc.text.bind(doc);
    doc.text = (str, ...rest) => text(typeof str === 'string' ? fallbackText(str) : str, ...rest);
    return doc;
  }
  const FACE = { Helvetica: F.regular, 'Helvetica-Bold': F.bold, 'Helvetica-Oblique': F.italic, 'Helvetica-BoldOblique': F.boldItalic };
  const setFont = doc.font.bind(doc);
  doc.font = (name, ...rest) => setFont(FACE[name] || name, ...rest);
  doc.font('Helvetica'); // pdfkit starts on Helvetica; text drawn before the first font() call gets the face too
  return doc;
}
