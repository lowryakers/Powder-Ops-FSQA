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

/* ── One Pantone on two rows ────────────────────────────────────────────────
 *
 * The catalogue disagreeing with itself — the same ink carrying a materially
 * different hex on two rows — is INTERNAL evidence that one of them was
 * transcribed wrongly. It needs no Pantone book. The comparison lives here,
 * beside the validator, because both the punch list and anything that renders
 * a swatch have to mean the same thing by "a different colour".
 */

/** The three channels of a hex value, 0–255, or null if it is not a hex. */
export function hexChannels(raw) {
  const d = hexDigits(raw);
  return d ? [0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16)) : null;
}

/** The largest per-channel difference between two hex values, or null. */
export function channelDelta(a, b) {
  const x = hexChannels(a);
  const y = hexChannels(b);
  if (!x || !y) return null;
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
}

/**
 * Under this, two transcriptions of one ink are the same ink.
 *
 * THE NUMBER IS THE PLANT'S, NOT THE CODE'S — the same standing the ATP limit
 * and the scale tolerances have. It was set at 25 per channel on 2026-09-24
 * after the first sweep: two people sampling one swatch off two artwork files
 * land a few units apart every time, and a punch list that reports those
 * buries the ones that are real.
 */
export const INFO_TOLERANCE = 25;

/**
 * Pairs a person has checked against the artwork and found to be one ink.
 *
 * TRANSCRIBED WITH THE EVIDENCE, never derived — the `DECIDED` table in the
 * flavour register and `form_numbering_decisions` have the same shape, and for
 * the same reason: this is the one answer nothing here can work out. The
 * catalogue cannot see what a pack prints; only somebody holding the artwork
 * can, and the value of writing it down is that the next sweep does not ask
 * the same question again.
 *
 * A pair listed here still APPEARS on the punch list — it drops to `info`, it
 * is never hidden. A disagreement somebody has explained is a different thing
 * from one nobody has looked at, and deleting it would lose the fact that it
 * was checked.
 */
export const COLOR_PAIR_DECISIONS = [
  {
    pms: 'PMS 375 C', hexes: ['91D500', '95D324'],
    // The Key Lime artwork renders 94D600. Both catalogue values are that ink;
    // they differ in the blue channel, which is near zero on a colour this
    // saturated — a max-per-channel of 36 overstates a difference nobody can
    // see on a pack. Checked by Lowry Akers, 2026-09-24.
    decided_by: 'Lowry Akers', decided_at: '2026-09-24',
    reason: 'Both are the Key Lime green. The artwork renders 94D600 and each '
      + 'catalogue value is that ink; the gap is in the blue channel of a '
      + 'saturated green, which is not a visible difference.',
  },
  {
    pms: 'PMS 123 C', hexes: ['FFC62D', 'FFC43E'],
    // The Orange artwork renders FFC72E. Checked by Lowry Akers, 2026-09-24.
    decided_by: 'Lowry Akers', decided_at: '2026-09-24',
    reason: 'Both are the same yellow. The artwork renders FFC72E and each '
      + 'catalogue value is within a few units of it.',
  },
];

const DECIDED = new Map(COLOR_PAIR_DECISIONS.map((d) => [
  `${d.pms}|${[...d.hexes].map((h) => h.toUpperCase()).sort().join('|')}`, d,
]));

/**
 * How loudly a disagreement should be reported: `warn` or `info`.
 *
 * `info` means somebody has already answered this — either because the two
 * values are close enough that they are plainly one ink, or because a person
 * checked the pair against the artwork and said so. Everything else is `warn`.
 */
export function conflictSeverity(pms, hexA, hexB) {
  const delta = channelDelta(hexA, hexB);
  if (delta === null) return { severity: 'warn', delta: null, decision: null };
  if (delta <= INFO_TOLERANCE) return { severity: 'info', delta, decision: null };
  const key = `${pms}|${[hexDigits(hexA), hexDigits(hexB)].sort().join('|')}`;
  const decision = DECIDED.get(key) || null;
  return { severity: decision ? 'info' : 'warn', delta, decision };
}
