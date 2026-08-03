// Formatted text in a pdfkit document.
//
// Draws the grammar in shared/rich-markup.js — *bold*, _italic_, __underline__,
// ~strike~, `code`, and bullet / numbered lists — so what someone typed into a
// newsletter card comes out of the PDF looking the way they meant it.
//
// Sits on top of pdf-emoji.js rather than replacing it: that module owns the
// emoji font and the run-splitting for it, this one owns styles and blocks. A
// run can be both (a bold line with a 🎉 in it), so the two compose — style
// picks the font family, emoji overrides the font for its own characters.

import { parseBlocks, hasMarkup } from '../shared/rich-markup.js';
import { registerEmojiFont, splitEmojiRuns, EMOJI_FONT, emojiFontAvailable } from './pdf-emoji.js';

// pdfkit's built-in Helvetica family. Bold/italic are separate faces, not a
// synthesized slant, which is why this is a lookup rather than a flag.
const HELVETICA = {
  'false,false': 'Helvetica',
  'true,false': 'Helvetica-Bold',
  'false,true': 'Helvetica-Oblique',
  'true,true': 'Helvetica-BoldOblique',
};

/**
 * The face to draw a run in. Styles COMPOSE with the base: bold inside an
 * already-bold section heading stays bold rather than cancelling, which is what
 * an author means when they bold part of a heading.
 *
 * Only the Helvetica family is mapped. Anything else (a registered custom font)
 * is left exactly as the caller set it — better to lose the italic than to
 * silently swap someone's font.
 */
function faceFor(base, run) {
  if (!/^Helvetica/.test(base)) return base;
  const bold = !!run.bold || /Bold/.test(base);
  const italic = !!run.italic || /Oblique/.test(base);
  if (run.code) return 'Courier';           // code is a face change, not a weight
  return HELVETICA[`${bold},${italic}`] || base;
}

// Draw one line's runs, chained so they flow as a single line. Same rule as
// pdf-emoji: only the LAST run ends the line, and runs are chained within a
// line only — pdfkit carries a continued run's x-offset across a newline.
function drawRuns(doc, runs, baseFont, options) {
  const emojiOk = emojiFontAvailable() && registerEmojiFont(doc);
  // Expand each styled run into (styled × emoji) pieces.
  const pieces = [];
  for (const run of runs) {
    const face = faceFor(baseFont, run);
    if (!emojiOk) { pieces.push({ text: run.text, font: face, run }); continue; }
    for (const part of splitEmojiRuns(run.text)) {
      pieces.push({ text: part.text, font: part.emoji ? EMOJI_FONT : face, run });
    }
  }
  const drawable = pieces.filter(p => p.text !== '');
  if (!drawable.length) { doc.font(baseFont).text('', options); return; }

  drawable.forEach((p, i) => {
    doc.font(p.font).text(p.text, {
      ...options,
      underline: !!p.run.underline,
      strike: !!p.run.strike,
      continued: i < drawable.length - 1,
    });
  });
}

/**
 * doc.text() for text that may carry formatting.
 *
 * Text with no markup takes the plain path untouched, so wiring this into an
 * export can't change how existing documents lay out.
 */
export function richBlocks(doc, text, baseFont, options = {}) {
  const body = String(text ?? '');
  if (!hasMarkup(body)) {
    // Still route through the emoji-aware writer so 🎉 doesn't come out as bytes.
    drawRuns(doc, [{ text: body }], baseFont, options);
    return doc;
  }

  const indent = options.listIndent ?? 14;
  const opts = { ...options };
  delete opts.listIndent;

  for (const block of parseBlocks(body)) {
    if (block.type === 'spacer') { doc.moveDown(0.5); continue; }
    if (block.type === 'p') { drawRuns(doc, block.runs, baseFont, opts); continue; }

    // Lists: draw the marker and the text as one chained line, indented, with
    // a hanging indent so a wrapped item lines up under its own text rather
    // than under the bullet.
    block.items.forEach((runs, i) => {
      const marker = block.type === 'ol' ? `${i + 1}. ` : '•  ';
      const left = (doc.page.margins.left ?? 0) + indent;
      const width = (opts.width ?? doc.page.width - doc.page.margins.left - doc.page.margins.right) - indent;
      doc.font(baseFont).text(marker, left, doc.y, { ...opts, width, continued: true });
      drawRuns(doc, runs, baseFont, { ...opts, width });
    });
  }
  return doc;
}
