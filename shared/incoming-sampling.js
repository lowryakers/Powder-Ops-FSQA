// INCOMING SAMPLING — the record of sampling a received lot and deciding what
// happens to it (D-394, A-20261124-003). PURE: the server validates with it and
// the screen draws from it, so the two cannot disagree.
//
// DRAFTED FROM SOP 402 V3 § IV.B–C, NOT TRANSCRIBED FROM A FORM. The plant's
// FORM 402 V2 asks packaging questions (carton, film, pouch measurements, tear
// notch, zip, barcode) — that work is FORM 418-01, already filed in ReadyDoc —
// and no form exists for sampling a powder. So every record is stamped DRAFT-1
// until Document Control issues a number, the shipping-checklist arrangement
// (D-052). The step wording below is the SOP's own; do not tidy it without
// telling Document Control.

export const SAMPLING_FORM = Object.freeze({
  code: null,
  revision: 'DRAFT-1',
  title: 'Incoming raw material sampling',
  procedure: 'SOP 402 V3',
});

/** What was received. The SOP releases a dietary ingredient and anything else differently (§ IV.C). */
export const MATERIAL_KINDS = Object.freeze([
  { value: 'dietary_ingredient', label: 'Dietary ingredient', rule: 'Needs at least one identity test before release (§ IV.C.1.a).' },
  { value: 'other_ingredient', label: 'Other ingredient, label or component', rule: 'A visual examination confirms acceptability (§ IV.C.2.a).' },
]);
export const MATERIAL_KIND_VALUES = MATERIAL_KINDS.map(k => k.value);

/** SOP 402 V3 § IV.B.b steps 1–7, one answer each. */
export const SAMPLING_STEPS = Object.freeze([
  { key: 'random_select', text: 'Containers selected at random and moved to the QA/QC sampling tent' },
  { key: 'gloves', text: 'Clean, sanitary gloves worn; one container opened at a time' },
  { key: 'lid_wiped', text: 'Lid and adjacent areas wiped with a clean paper towel before opening' },
  { key: 'area_sanitized', text: 'Work area cleaned with an approved sanitizer (Sani-512)' },
  { key: 'lid_protected', text: 'Lid laid down so nothing touched its inside surface' },
  { key: 'scoop', text: 'A clean, disposable sampling scoop used' },
  { key: 'resealed', text: 'Sample and product containers closed at once; the original container properly sealed' },
  { key: 'sample_labelled', text: 'Sample labelled with product name, lot number, container number, date and initials' },
  { key: 'sampled_label', text: 'Signed and dated "SAMPLED" label placed on each sampled container, not covering existing labels' },
]);
export const STEP_ANSWERS = ['yes', 'no'];

/** What the person decides when they sign (§ IV.C). Hold keeps it in quarantine. */
export const DISPOSITIONS = Object.freeze([
  { value: 'release', label: 'Release for use' },
  { value: 'hold', label: 'Keep on hold' },
  { value: 'reject', label: 'Reject' },
]);
export const DISPOSITION_VALUES = DISPOSITIONS.map(d => d.value);

/**
 * How many containers to sample, from the rule IN FORCE (a controlled
 * definition — never a number on a screen). SOP 402 V3: "the root square of
 * (N+1)". `round` is how a fraction is taken; the SOP's own reading is up.
 */
export function containersRequired(n, rule = { method: 'sqrt_n_plus_1', round: 'up' }) {
  const N = Math.floor(Number(n));
  if (!Number.isFinite(N) || N < 1) return null;
  const raw = Math.sqrt(N + 1);
  const k = rule?.round === 'nearest' ? Math.round(raw) : Math.ceil(raw);
  return Math.min(Math.max(k, 1), N);
}

/**
 * What still stops a signature, in words. Empty when the record can be signed.
 * `linkedLab` is the lab request's status when one is linked (for the identity rule).
 */
export function signRefusals(rec = {}, { rule, linkedLab = null } = {}) {
  const out = [];
  if (!rec.part_number && !rec.item_name) out.push('Name the material.');
  if (!rec.vendor_lot) out.push('Record the vendor lot.');
  if (!MATERIAL_KIND_VALUES.includes(rec.material_kind)) out.push('Say whether it is a dietary ingredient.');
  const need = containersRequired(rec.containers_received, rule);
  if (need == null) out.push('Record how many containers were received.');
  else if (!(Number(rec.containers_sampled) >= need)) out.push(`Sample at least ${need} container${need === 1 ? '' : 's'} (√(N+1) of ${Math.floor(Number(rec.containers_received))}).`);
  const steps = rec.steps || {};
  const blank = SAMPLING_STEPS.filter(s => !STEP_ANSWERS.includes(steps[s.key]));
  if (blank.length) out.push(`${blank.length} sampling step${blank.length === 1 ? '' : 's'} still blank.`);
  const noWithoutNote = SAMPLING_STEPS.filter(s => steps[s.key] === 'no' && !String(rec.step_notes?.[s.key] || '').trim());
  if (noWithoutNote.length) out.push('Each "no" needs a note saying what happened.');
  if (!DISPOSITION_VALUES.includes(rec.disposition)) out.push('Choose release, hold or reject.');
  if (['hold', 'reject'].includes(rec.disposition) && String(rec.disposition_reason || '').trim().length < 3) {
    out.push(`Say why it is ${rec.disposition === 'hold' ? 'kept on hold' : 'rejected'}.`);
  }
  if (rec.disposition === 'release') {
    if (Object.values(steps).includes('no')) out.push('A lot with a sampling step answered "no" is not released; hold it.');
    if (rec.material_kind === 'dietary_ingredient' && linkedLab !== 'pass') {
      out.push(linkedLab
        ? `The identity test on the linked lab request reads "${linkedLab}", not pass. A dietary ingredient is released only after it passes (SOP 402 § IV.C.1.a).`
        : 'Link the lab request with the identity test. A dietary ingredient is released only after it passes (SOP 402 § IV.C.1.a).');
    }
    if (rec.material_kind === 'other_ingredient' && rec.visual_ok !== 'yes') out.push('Record that the visual examination was acceptable (SOP 402 § IV.C.2.a).');
  }
  return out;
}
