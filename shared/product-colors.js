// A brand colour as the catalogue writes it: a Pantone name and a hex value,
// one pair per slot.
//
// PURE — strings in, verdicts out. No Express, no database, no React. Both
// sides import it: the server decides what `pms_valid` / `hex_valid` are
// stored as, and the drawer shows the same verdict beside the box as somebody
// types, so a refusal is visible before the save rather than after it. One
// definition, two callers — the `shared/nutrition-dv.js` arrangement. A second
// copy in the client is how a form and a gate start disagreeing.
//
// THE SHAPES ARE THE PLANT'S, NOT A STANDARD'S. These are transcribed off real
// artwork and the audit wrote them as it found them:
//
//     PMS 158 C · PMS 9224 U · PMS Black C · PMS 4625 (no suffix)
//     HEX EE7623 · HX FF9015
//
// and four kinds of value that are NOT a spot colour, all of which the audit
// had already marked invalid and which this reproduces exactly:
//
//     PMS --          a slot with no colour chosen (or none recorded)
//     PNS 9160 C      a typo for PMS
//     CMYK 3 1 17 0   a process build, which is not a spot ink
//     HEX F43BF       five digits; HEX E613B24 is seven; HEX 4E2CID has an I
//
// `check:colors` asserts this agrees with the audit's own TRUE/FALSE on all
// 312 seeded slots, so re-deriving validity on a write cannot silently
// reclassify a row somebody else transcribed.

/** `--`, `-`, `N/A`, `TBD`, `none` — a slot nobody has filled in. */
const PLACEHOLDER = /^(?:[-–—]+|n\/?a|tbd|none|tba)$/i;

/**
 * The six hex digits, or null.
 *
 * The `HEX` / `HX` prefix is part of how the catalogue writes the value and
 * travels to the proofing service that way, so it is READ here and never
 * rewritten — normalising it on save would rewrite rows nobody edited.
 */
export function hexDigits(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/^(?:hex|hx)\s+/i, '').replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null;
}

/** A hex that a screen can actually render. */
export const hexValid = (raw) => hexDigits(raw) !== null;

/**
 * The Pantone reference, or null.
 *
 * Deliberately strict about the PREFIX. `PNS 9160 C` is a typo sitting in the
 * catalogue today and `CMYK 3 1 17 0` is a process build — neither is a spot
 * ink a printer can be handed, and accepting them would put a value on the
 * master feed that the proofing service then tries to match a separation name
 * against.
 */
export function pmsCode(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const m = /^pms\s+(.+)$/i.exec(s);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest || PLACEHOLDER.test(rest)) return null;
  return rest;
}

/** A PMS value that names an ink. */
export const pmsValid = (raw) => pmsCode(raw) !== null;

/**
 * What is wrong with one slot, in the words the person typing sees.
 *
 * A slot with NEITHER value is not an error — it is an empty row somebody has
 * not filled in yet, and the editor drops it rather than refusing the save.
 * Only a value that is present and unusable is reported.
 */
export function colorIssues({ pms, hex } = {}) {
  const out = [];
  const p = (pms ?? '').toString().trim();
  const h = (hex ?? '').toString().trim();
  if (p && !pmsValid(p)) {
    out.push(/^pms\b/i.test(p)
      ? `"${p}" does not name a Pantone ink.`
      : `"${p}" is not a Pantone reference — it should read like "PMS 158 C".`);
  }
  if (h && !hexValid(h)) out.push(`"${h}" is not six hex digits.`);
  return out;
}

/** A slot nobody typed anything into. Dropped on save rather than stored blank. */
export const isBlankSlot = (c) =>
  !String(c?.pms ?? '').trim() && !String(c?.hex ?? '').trim();
