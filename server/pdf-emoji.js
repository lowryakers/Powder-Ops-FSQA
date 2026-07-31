// Emoji in generated PDFs.
//
// pdfkit's built-in fonts (Helvetica and friends) are WinAnsi-encoded — one
// byte per character, 256 characters, no emoji anywhere in it. Given 👋 pdfkit
// writes the raw UTF-16 bytes and the viewer reads each one as Latin-1, which
// is why the newsletter came out as "Welcome, Gaston! Ø=ÜK" instead of
// "Welcome, Gaston! 👋". Nothing was lost on the way in; the font simply had
// nowhere to put it.
//
// So: bundle a font that does have the glyphs (Noto Emoji, monochrome outlines
// — OFL 1.1, see NotoEmoji-LICENSE.txt) and switch to it for the emoji runs
// only. Monochrome on purpose: PDF has no way to draw the colour bitmap fonts
// phones use (CBDT/sbix), so a colour emoji font would embed as blank boxes.
// Outline emoji print correctly on any printer and any viewer.
//
// Usage — a drop-in replacement for doc.text():
//     registerEmojiFont(doc);
//     richText(doc, 'Welcome! 👋', 'Helvetica', { align: 'left' });
//
// Text with no emoji takes exactly the path it always did, so wiring this in
// can't change how existing documents look.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// Named import: fontkit's ESM build has no default export.
import { create as createFont } from 'fontkit';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(HERE, 'assets', 'NotoEmoji-Regular.ttf');

export const EMOJI_FONT = 'NotoEmoji';

let cached; // { buffer, coverage } — read once, reused by every render.

function load() {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    if (existsSync(FONT_PATH)) {
      const buffer = readFileSync(FONT_PATH);
      cached = { buffer, font: createFont(buffer) };
    }
  } catch { cached = null; }
  return cached;
}

/** Is the bundled emoji font present and readable? */
export function emojiFontAvailable() {
  return !!load();
}

/**
 * Make the emoji font available on a document. Safe to call more than once,
 * and a no-op when the font file is missing — a missing asset should cost you
 * emoji, not the whole PDF.
 */
export function registerEmojiFont(doc) {
  const f = load();
  if (!f) return false;
  try { doc.registerFont(EMOJI_FONT, f.buffer); return true; }
  catch { return false; }
}

// One emoji "character" as a person thinks of it: a pictograph plus its
// optional variation selector and skin tone, plus any ZWJ-joined continuation
// (👨‍🍳 is one image, not three), flag pairs, and keycaps (1️⃣).
const TONE = '\\u{1F3FB}-\\u{1F3FF}';
const EMOJI_RE = new RegExp(
  '(?:' +
    '\\p{RI}\\p{RI}' +                                                  // 🇺🇸
    '|[0-9#*]\\uFE0F?\\u20E3' +                                         // 1️⃣
    `|\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:[${TONE}])?` +
      `(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F)?(?:[${TONE}])?)*` +
  ')', 'gu'
);

// Extended_Pictographic includes a few characters that are really text and that
// the body font draws perfectly well. Sending © through the emoji font would
// turn a copyright sign into an emoji-styled blob, so leave them alone unless
// the author explicitly asked for the emoji form with a variation selector.
const TEXT_LIKE = new Set(['©', '®', '™']);

/**
 * Split a string into alternating plain / emoji runs.
 * Exported for tests; `richText` is what callers want.
 */
export function splitEmojiRuns(input) {
  const text = String(input ?? '');
  const runs = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    const cluster = m[0];
    if (TEXT_LIKE.has(cluster)) continue;
    if (m.index > last) runs.push({ text: text.slice(last, m.index), emoji: false });
    runs.push({ text: cluster, emoji: true });
    last = m.index + cluster.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), emoji: false });
  return runs.length ? runs : [{ text, emoji: false }];
}

/** Does this string contain anything the body font can't draw? */
export function hasEmoji(text) {
  return splitEmojiRuns(text).some(r => r.emoji);
}

// Can the emoji font actually draw this cluster? A glyph it doesn't cover
// renders as an empty box, which is just a different kind of wrong — fall back
// to the body font, which at worst drops it.
function drawableAsEmoji(cluster, font) {
  return [...cluster].every(ch => {
    const cp = ch.codePointAt(0);
    // Joiners and selectors have no glyph of their own and never need one.
    if (cp === 0x200D || cp === 0xFE0F || cp === 0xFE0E) return true;
    return font.hasGlyphForCodePoint(cp);
  });
}

/**
 * doc.text(), but emoji come out as emoji.
 *
 * Within a line the runs are chained with `continued` so pdfkit keeps them
 * flowing — one text() per run without it would put every emoji on its own
 * line. But `continued` and an explicit "\n" do NOT mix: pdfkit carries the
 * continued run's x-offset into the new line, which indented every line after
 * an emoji halfway across the page and printed the next heading on top of its
 * own text. So the string is split on newlines first and each line is its own
 * chain — long lines still wrap normally inside their own text() call.
 *
 * `baseFont` is whatever the caller would have passed to doc.font().
 */
export function richText(doc, text, baseFont, options = {}) {
  const body = String(text ?? '');

  // No emoji, or no font to draw them with: the original path, untouched.
  if (!hasEmoji(body) || !registerEmojiFont(doc)) {
    doc.font(baseFont).text(body, options);
    return doc;
  }

  const f = load();
  const lines = body.split('\n');

  for (const line of lines) {
    // A blank line is a deliberate paragraph break; moveDown reproduces it
    // without pdfkit measuring an empty string.
    if (line === '') { doc.moveDown(); continue; }

    const runs = splitEmojiRuns(line);
    if (runs.length === 1) {
      doc.font(runs[0].emoji && drawableAsEmoji(line, f.font) ? EMOJI_FONT : baseFont).text(line, options);
    } else {
      runs.forEach((run, i) => {
        // The last run of a line must NOT be continued — that's what ends the
        // line and moves the cursor down.
        doc.font(run.emoji && drawableAsEmoji(run.text, f.font) ? EMOJI_FONT : baseFont)
          .text(run.text, { ...options, continued: i < runs.length - 1 });
      });
    }
  }
  return doc;
}
