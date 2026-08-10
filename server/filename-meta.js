// What a filename tells you about the document inside it.
//
// Extracted from the controlled-document importer so the policy importer can
// use the same rules rather than growing a second, slightly-different copy —
// the two would drift, and the first sign of the drift would be the same file
// importing under two different titles depending on which screen you used.

/** Strip the extension and the noise Drive/Windows add when copying. */
export function cleanFilename(filename) {
  let s = String(filename || '').replace(/\.(pdf|docx?|txt|md|markdown|rtf|pages)$/i, '');
  s = s.replace(/[_]+/g, ' ');
  // Leading "Copy of " (possibly repeated, e.g. "Copy of Copy of ...")
  s = s.replace(/^(?:\s*copy\s+of\s+)+/i, '');
  // Trailing duplicate markers: " - Copy", " copy", " (1)", " - Copy (2)"
  s = s.replace(/[\s-]*copy(?:\s*\(\d+\))?\s*$/i, '');
  s = s.replace(/\s*\(\d+\)\s*$/, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A trailing revision token is the revision, NOT part of the title.
 *
 * Document Control names its files "…_Food_Safety_Policy_Statement_V4.pdf".
 * Left in, uploading V4 titles the document "… V4" and the next revision
 * renames it again. A title that genuinely ends in a number ("Allergen Control
 * Program 2") has no v/rev token and is left alone.
 */
export function stripRevisionSuffix(title) {
  return String(title || '')
    .replace(/[\s_-]*\b(?:rev(?:ision)?|ver(?:sion)?|v)\.?\s*\d+(?:\.\d+)?$/i, '')
    .trim() || String(title || '').trim();
}

/** The revision a filename claims, if it names one ("…_V4" → "4"). */
export function revisionFromFilename(filename) {
  const m = cleanFilename(filename).match(/\b(?:rev(?:ision)?|ver(?:sion)?|v)\.?\s*(\d+(?:\.\d+)?)$/i);
  return m ? m[1] : null;
}

/** A readable title for a file that carries no document number. */
export function titleFromFilename(filename) {
  const base = stripRevisionSuffix(cleanFilename(filename));
  // Leading dates ("2025-06-01 PTO Policy") are provenance, not the title.
  const undated = base.replace(/^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*[-–—]?\s*/, '').trim();
  return (undated || base).slice(0, 120);
}
