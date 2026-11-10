// FORM 418-01 V1 — QA Film/Pouch Inspection Checklist.
//
// Transcribed from the plant's own controlled form. The wording is VERBATIM,
// typos included ("Matrial - Discoloration / bubbles"), for the same reason
// FORM 204-01 and the internal-audit checklist keep theirs: an auditor
// comparing the app to the paper must find the same questions, and correcting
// the text here would make the app disagree with the approved document.
// Fixing the document is a Document Change Request.
//
// NOT user-editable — changing what a QA inspection asks is a document change,
// not a settings toggle. `CHECKLIST_REVISION` is stamped on every filed
// inspection, so a record always says which revision it was run against.
//
// ── Where it sits in the day ─────────────────────────────────────────────────
// FORM 204-01's very first question is "Is the product Packaging (Film or
// pouches)?" and, on YES, tells the receiver to notify Maria and Adam for a QA
// inspection. That inspection is THIS form, and until now it had nowhere to
// land — the escalation went out and the result came back as a photo in a chat
// channel. QA inspects the packaging FIRST; the warehouse's own receiving
// process follows once QA has accepted it.
//
// ── ONE SHEET PER FLAVOUR ────────────────────────────────────────────────────
// The paper says so in its own header, and it matters: a delivery is often
// several flavours of film on one PO, each with its own rolls, lot and
// artwork. One sheet covering the pallet could not record that flavour three
// was rejected while the rest were fine. So the record is keyed on
// (inspection_no, flavor) rather than on the inspection alone — the same
// reasoning that made FORM 204-01 one checklist per inspection rather than per
// line, applied one level down.

// ── V2 (D-332): bottle sleeves ──────────────────────────────────────────────
// The bottling line's printed packaging is a shrink sleeve, and QA inspects it
// on arrival the way it inspects film and pouches. V2 adds a BOTTLE SLEEVE
// section and asks the inspector what the sheet is for (film, pouches or bottle
// sleeves), so a sheet asks only that section. The V1 lines are untouched.
//
// THE SLEEVE LINES ARE DRAFTED, NOT TRANSCRIBED. No V2 paper exists: they follow
// the film section's own material checks line for line, plus what a sleeve has
// that a roll of film does not (lay-flat width, cut length, seam, perforation,
// a shrink test on a bottle). Document Control issues V2 — until then the
// app serves V1 (controlled.js parks the code; `filmChecklistBaseline()`), and
// the DCR is docs/v2/queued/dcr-form-418-01-v2.md. Do not tidy the sleeve
// wording without telling Document Control.
export const FILM_FORM_CODE = 'FORM 418-01';
export const FILM_REVISION = 'V2';
export const FILM_PREVIOUS_REVISION = 'V1';
export const FILM_TITLE = 'QA Film/Pouch/Bottle Sleeve Inspection Checklist';
const FILM_PREVIOUS_TITLE = 'QA Film/Pouch Inspection Checklist';

/** What a sheet inspects (V2). Each section names the kind it applies to. */
export const FILM_KINDS = [
  { key: 'film', label: 'Film (rolls)' },
  { key: 'pouch', label: 'Pouches' },
  { key: 'sleeve', label: 'Bottle sleeves' },
];

/** The answers the paper offers. */
export const FILM_ANSWERS = ['yes', 'no', 'na'];

/**
 * The header the paper asks for before any item is ticked.
 *
 * `wind_direction` and `film_width` are the two "CIRCLE ONE" rows: the form
 * prints them beside their inspection item, but they are FACTS ABOUT THE ROLL
 * rather than pass/fail judgements, so they are captured as values here and the
 * item keeps its own yes/no. Recording "wind direction is correct: yes" without
 * recording WHICH direction was correct is the kind of record that cannot be
 * checked afterwards.
 */
export const FILM_HEADER = [
  { key: 'inspection_no', label: 'Inspection #', type: 'text' },
  { key: 'vendor', label: 'Vendor', type: 'text' },
  { key: 'part_no', label: 'Part #', type: 'text' },
  { key: 'inspection_date', label: 'Date', type: 'date' },
  { key: 'roll_count', label: '# of rolls', type: 'number' },
  { key: 'vendor_lot', label: 'Vendor Lot #', type: 'text' },
  { key: 'qa_lead', label: 'Name (QA Lead)', type: 'text' },
  { key: 'flavor', label: 'Flavor', type: 'text', required: true },
  { key: 'assistant', label: 'Assistant Name', type: 'text' },
  // V2, bottle sleeves only: the two measurements the sleeve's dimension lines
  // are judged against, recorded as values for the same reason as the film's
  // CIRCLE ONE rows — "lay-flat width correct: yes" says nothing afterwards.
  { key: 'sleeve_layflat', label: 'Sleeve lay-flat width (mm)', type: 'text', kinds: ['sleeve'] },
  { key: 'sleeve_length', label: 'Sleeve cut length (mm)', type: 'text', kinds: ['sleeve'] },
];
const NEW_HEADER_IN_V2 = ['sleeve_layflat', 'sleeve_length'];

/** The CIRCLE ONE options, exactly as printed. */
export const WIND_DIRECTIONS = ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9', '#10'];
export const FILM_WIDTHS = ['140mm', '54mm', '56mm', '70mm', '90mm', '200mm', '258mm', 'Other'];

const I = (key, text, note) => (note ? { key, text, note } : { key, text });

export const FILM_SECTIONS = [
  {
    key: 'film',
    title: 'FILM Inspection',
    applies_to: ['film'],
    items: [
      // The wind direction itself is recorded in the header (CIRCLE ONE #1–#10).
      I('wind_direction_correct', 'Wind direction is correct', 'Record which direction above'),
      I('roll_tightness', 'Roll tightness acceptable (not loose/crushed)'),
      I('core_damage', 'Damage to cores or outer wrap'),
      I('eye_mark_present', 'Eye Mark - present and consistent'),
      I('eye_mark_contrast', 'Eye Mark - high contrast with film color',
        '*i.e. dark eye mark on light film color'),
      // The width itself is recorded in the header (CIRCLE ONE).
      I('width_matches_machine', 'Dimensions - width matches machine requirement',
        'Record the width above'),
      I('width_variance', 'Dimensions - width variance across entire roll'),
      I('edge_cuts', 'Edges - Proper edge cuts'),
      I('approved_colors', 'Edges - Only approved artwork colors'),
      I('artwork_text_centered', 'Artwork - Text centered'),
      I('artwork_logos_centered', 'Artwork - Logos centered'),
      I('artwork_grammar', 'Artwork - Grammar/spelling correct'),
      I('artwork_nfp', 'Artwork - Nutrition Facts Panel correct'),
      I('material_discoloration', 'Material - Discoloration or bubbles'),
      I('material_wrinkles', 'Material - Wrinkles or surface defects'),
      I('material_feel', 'Material - Feel / texture acceptable'),
      I('material_odor', 'Material - Unusual odor present'),
      I('material_foreign', 'Material - Dust, oil, or foreign material present'),
      I('material_pinholes', 'Material - Pinholes or thin spots', '*Flashlight Test if applicable'),
      I('color_hex', 'Color - Hex color matches standard'),
      I('color_impression', 'Color - Visible impression variance'),
    ],
  },
  {
    key: 'pouch',
    title: 'POUCH Inspection',
    note: '*Pull 3 pouches from 4 random boxes per pallet',
    applies_to: ['pouch'],
    items: [
      I('pouch_artwork_centered', 'Artwork centered'),
      I('pouch_dimensions', 'Dimensions correct'),
      I('pouch_zipper', 'Zipper correct'),
      I('pouch_glue_dot', 'Half-moon glue dot present'),
      I('pouch_cuts', 'Straight top/bottom cuts'),
      I('pouch_gusset', 'Gusset size correct'),
      // "Matrial" is the paper's own spelling. See the note at the top.
      I('pouch_material', 'Matrial - Discoloration / bubbles'),
      I('pouch_seals', 'Seals Clean (no bleed lines)'),
      I('pouch_edge_lines', 'Silver or other lines on edges'),
    ],
  },
  {
    // V2 (D-332) — DRAFTED for Document Control; see the note at the top.
    key: 'sleeve',
    title: 'BOTTLE SLEEVE Inspection',
    note: '*Pull 3 sleeves from 4 random rolls or boxes per pallet',
    applies_to: ['sleeve'],
    items: [
      I('sleeve_roll_tightness', 'Roll tightness acceptable (not loose/crushed)', 'N/A if delivered as cut sleeves'),
      I('sleeve_core_damage', 'Damage to cores, boxes or outer wrap'),
      I('sleeve_eye_mark', 'Eye Mark / cut mark - present and consistent'),
      I('sleeve_layflat_correct', 'Dimensions - lay-flat width matches specification', 'Record the width above'),
      I('sleeve_length_correct', 'Dimensions - cut length matches specification', 'Record the length above'),
      I('sleeve_seam', 'Seam - straight, fully sealed, no gaps or solvent marks'),
      I('sleeve_perforation', 'Perforation / tamper band - present and correct', 'N/A if the specification has none'),
      I('sleeve_artwork_position', 'Artwork - Text and logos centered / correct position'),
      I('sleeve_artwork_grammar', 'Artwork - Grammar/spelling correct'),
      I('sleeve_artwork_nfp', 'Artwork - Nutrition Facts Panel correct'),
      I('sleeve_barcode', 'Artwork - Barcode present and scans to the product\'s GTIN'),
      I('sleeve_approved_colors', 'Color - Only approved artwork colors'),
      I('sleeve_color_hex', 'Color - Hex color matches standard'),
      I('sleeve_color_impression', 'Color - Visible impression variance'),
      I('sleeve_material_type', 'Material - Type and thickness match specification', '*e.g. PETG, microns, as on the PO / spec'),
      I('sleeve_material_discoloration', 'Material - Discoloration or bubbles'),
      I('sleeve_material_wrinkles', 'Material - Wrinkles, scratches or surface defects'),
      I('sleeve_material_feel', 'Material - Feel / texture acceptable'),
      I('sleeve_material_odor', 'Material - Unusual odor present'),
      I('sleeve_material_foreign', 'Material - Dust, oil, or foreign material present'),
      I('sleeve_material_pinholes', 'Material - Pinholes or thin spots', '*Flashlight Test if applicable'),
      I('sleeve_shrink_test', 'Shrink test - sleeve applied to a sample bottle shrinks evenly, no distortion of text or NFP'),
    ],
  },
];
const NEW_SECTIONS_IN_V2 = ['sleeve'];

/**
 * The instruction printed above the notes box, kept because it tells the
 * inspector what to DO when something fails — and the photos it asks for are
 * the evidence an auditor will want against a rejection.
 */
export const FILM_FAILURE_INSTRUCTION =
  'If ANY item fails: Record the issue below, take photos, and send photos / inspection sheet in the receiving channel';

/** The decision the paper asks QA to circle. */
export const FILM_DECISIONS = {
  accepted: 'ACCEPTED - Receive / release to warehouse',
  rejected: 'REJECTED - Notify Admin / Do not receive',
};

/**
 * The sections a sheet asks (V2). The served form names its kinds; a sheet
 * that has said what it inspects asks only the sections for that kind. A sheet
 * that has not said — or any sheet while the served form is V1, which has no
 * kinds — asks every section, which is what V1 has always done.
 */
export function sectionsFor(kind) {
  if (!FILM_CHECKLIST.kinds?.length || !kind) return FILM_SECTIONS;
  return FILM_SECTIONS.filter(s => !s.applies_to || s.applies_to.includes(kind));
}

/** Whether the served form asks what a sheet inspects (V2 approved). */
export const asksKind = () => !!FILM_CHECKLIST.kinds?.length;
export const isKind = (k) => (FILM_CHECKLIST.kinds || []).some(x => x.key === k);

export function allItems(kind) {
  return sectionsFor(kind).flatMap(s => s.items.map(i => ({ ...i, section: s.key, section_title: s.title })));
}

export function normalizeAnswers(input = {}) {
  const known = new Set(FILM_SECTIONS.flatMap(s => s.items.map(i => i.key)));
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!known.has(k)) continue;
    const val = String(v || '').toLowerCase();
    if (FILM_ANSWERS.includes(val)) out[k] = val;
  }
  return out;
}

/** Unanswered items, in print order. Sign-off is refused while any remain. */
export function unanswered(answers = {}, kind = null) {
  return allItems(kind).filter(i => !answers[i.key])
    .map(i => ({ key: i.key, text: i.text, section: i.section_title }));
}

/**
 * NOTHING HERE IS AUTO-GRADED, and that is deliberate.
 *
 * The form mixes two kinds of line. "Roll tightness acceptable" and "Artwork -
 * Text centered" are good when YES; "Damage to cores or outer wrap", "Material
 * - Unusual odor present" and "Material - Pinholes or thin spots" are good when
 * NO. The paper never states which is which — a human reads the line and
 * knows — so a rule that treated every NO as a failure would report a perfect
 * roll as defective, and the opposite rule would pass a roll full of pinholes.
 *
 * Inventing a polarity the controlled document does not state, and then
 * printing a verdict from it, is exactly the kind of quiet fabrication the
 * dilution log was kept clear of. So the ACCEPTED/REJECTED decision is QA's,
 * recorded explicitly, the way the paper has them circle it.
 *
 * What the app CAN do honestly is show which lines were answered NO and which
 * N/A, so whoever signs is looking at the exceptions rather than re-reading
 * thirty rows. That is an aid to the decision, not the decision.
 */
export function exceptions(answers = {}, kind = null) {
  const items = allItems(kind);
  return {
    no: items.filter(i => answers[i.key] === 'no').map(i => ({ key: i.key, text: i.text })),
    na: items.filter(i => answers[i.key] === 'na').map(i => ({ key: i.key, text: i.text })),
  };
}

export const FILM_CHECKLIST = {
  form_code: FILM_FORM_CODE,
  revision: FILM_REVISION,
  title: FILM_TITLE,
  kinds: FILM_KINDS,
  header: FILM_HEADER,
  sections: FILM_SECTIONS,
  answers: FILM_ANSWERS,
  wind_directions: WIND_DIRECTIONS,
  film_widths: FILM_WIDTHS,
  decisions: FILM_DECISIONS,
  failure_instruction: FILM_FAILURE_INSTRUCTION,
  sheet_rule: '1 SHEET PER FLAVOR',
};

// ── Under change control (D-332) ─────────────────────────────────────────────
// The form is a controlled definition (scope 'checklist', key 'film:FORM 418-01').
// `filmChecklistSnapshot()` is what the CODE says (V2); `filmChecklistBaseline()`
// is the revision the approved paper carries (V1: no kinds, no sleeve section,
// no sleeve header lines, every section asked on every sheet). A database seeing
// this definition for the first time records V1 as approved and parks V2 for
// Document Control. `applyFilmChecklistSnapshot()` puts an approved snapshot
// back over the live objects in place, so the served form, unanswered() and
// sign-off all follow it with no further wiring.
const clone = (x) => JSON.parse(JSON.stringify(x));
// Frozen at module load — before controlled.js can have applied anything.
const CODE = Object.freeze(clone({ revision: FILM_REVISION, title: FILM_TITLE, kinds: FILM_KINDS, header: FILM_HEADER, sections: FILM_SECTIONS }));
export function filmChecklistSnapshot() { return clone(CODE); }
export function filmChecklistBaseline() {
  return {
    revision: FILM_PREVIOUS_REVISION,
    title: FILM_PREVIOUS_TITLE,
    kinds: [],
    header: CODE.header.filter(h => !NEW_HEADER_IN_V2.includes(h.key)),
    sections: CODE.sections.filter(s => !NEW_SECTIONS_IN_V2.includes(s.key)).map(s => { const c = clone(s); delete c.applies_to; return c; }),
  };
}
export function applyFilmChecklistSnapshot(snap) {
  if (!snap || !Array.isArray(snap.sections) || !Array.isArray(snap.header)) return;
  FILM_SECTIONS.splice(0, FILM_SECTIONS.length, ...clone(snap.sections));
  FILM_HEADER.splice(0, FILM_HEADER.length, ...clone(snap.header));
  FILM_CHECKLIST.kinds = Array.isArray(snap.kinds) ? clone(snap.kinds) : [];
  if (typeof snap.revision === 'string') FILM_CHECKLIST.revision = snap.revision;
  if (typeof snap.title === 'string') FILM_CHECKLIST.title = snap.title;
}
