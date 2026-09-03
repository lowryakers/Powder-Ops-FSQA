// Shipping Truck Inspection — the outbound twin of FORM 204-01.
//
// The warehouse asked for the receiving inspection mirrored for the trucks
// that LEAVE: same shape, same dock, same phone, plus photographs of the load
// before the doors close. So this file has the same skeleton as
// `receiving-checklist.js` — sections, items, `notify` rules, the same
// yes / no / na vocabulary — and the API and screen follow the same rules
// (answers save as they are tapped, escalations are derived from the answers,
// sign-off is refused while anything is blank).
//
// ── THIS ONE IS A DRAFT, AND THE RECORD SAYS SO ──────────────────────────────
// Every other checklist here is transcribed VERBATIM from a controlled form
// (FORM 204-01, FORM 403-01, FORM 415-1). There is no controlled shipping
// inspection form: the Forms Master Index has nothing for it, SOP 205
// (Shipping) describes the process but issues no form, and the plant has not
// been working one on paper. So these questions were DRAFTED — from SOP 205,
// the pre-load half of FORM 204-01 turned around, and what an SQF outbound
// transport check asks (trailer condition, pests, prior-load residue,
// allergen segregation, seal, BOL) — and they are not the plant's document
// until Document Control says so.
//
// Two consequences, both deliberate:
//   - `CHECKLIST_REVISION` is 'DRAFT-1' and `form_code` is null. A filed
//     inspection is stamped DRAFT-1 forever, so an auditor reading it later is
//     told it predates the issued form rather than left to assume it matches
//     one. When Document Control issues the number, the code here changes to
//     that number and revision, `controlled.js` parks it, and records filed
//     afterwards carry the issued revision.
//   - The wording is still NOT user-editable, for the same reason as the
//     receiving one: once issued, changing what a truck inspection asks is a
//     Document Change Request. Corrections before issue go here, in one place.
// The DCR draft for Document Control is docs/v2/queued/dcr-shipping-truck-inspection.md.
//
// Escalations reach QA only. A damaged or contaminated load is a hold, and QA
// decides holds. A quantity or paperwork mismatch is fixed at the dock with the
// office, and a checklist that pages somebody for it is one the loader learns
// to answer "yes" to.

import { NOTIFY_TARGETS as RECEIVING_TARGETS } from './receiving-checklist.js';

export const CHECKLIST_FORM_CODE = null;          // not yet issued by Document Control
export const CHECKLIST_REVISION = 'DRAFT-1';
export const CHECKLIST_TITLE = 'Shipping Truck Inspection';
export const CHECKLIST_NOTE = 'Draft checklist — no controlled form has been issued for outbound truck inspection yet. '
  + 'Document Control is asked to issue one (see the DCR draft); records filed meanwhile are stamped DRAFT-1.';

// The same QA people the receiving form escalates to, on purpose: a load
// that must not leave is a hold, and holds are QA's whichever direction the
// truck faces. `shipping_qa` only changes the subject line, so "do not ship
// this" does not read like "inspect this delivery" on a phone.
export const NOTIFY_TARGETS = {
  shipping_qa: {
    ...RECEIVING_TARGETS.qa,
    subject: 'Shipment held — QA needed at the dock',
  },
};

const N = (target, answer, note) => ({ target, answer, note, target_label: NOTIFY_TARGETS[target].label });

export const CHECKLIST_SECTIONS = [
  {
    key: 'pre_load',
    title: 'PRE-Load Inspection (empty trailer)',
    items: [
      { key: 'trailer_intact', text: 'Trailer exterior intact (no holes, damage or leaks)' },
      { key: 'trailer_clean', text: 'Trailer interior clean, dry and odor-free' },
      {
        key: 'pest_evidence',
        text: 'Evidence of pests (droppings, insects, nesting)',
        notify: N('shipping_qa', 'yes', 'If YES, do not load — notify QA'),
      },
      {
        key: 'prior_load_residue',
        text: 'Residue or spillage from a previous load (chemicals, allergens, other product)',
        notify: N('shipping_qa', 'yes', 'If YES, do not load — notify QA'),
      },
      { key: 'floor_walls_sound', text: 'Floor and walls sound (no exposed nails, splinters or sharp edges)' },
      {
        key: 'temperature_ok',
        text: 'Refrigeration running and at temperature',
        note: 'Applicable only if the shipment requires temperature control',
      },
    ],
  },
  {
    key: 'load',
    title: 'LOAD Inspection',
    items: [
      { key: 'correct_product', text: 'Correct product loaded (matches order / pick list)' },
      { key: 'correct_quantity', text: 'Correct quantity (case and pallet count match the BOL)' },
      { key: 'labels_readable', text: 'Case and pallet labels readable and match the order' },
      { key: 'lots_on_bol', text: 'Lot numbers recorded on the BOL / packing list' },
      { key: 'pallets_secure', text: 'Pallets wrapped, stable and braced for transit' },
      {
        key: 'allergen_segregation',
        text: 'Allergen-containing product segregated from non-allergen product',
        note: 'Applicable if the load mixes allergen and non-allergen product',
      },
      {
        key: 'product_damaged',
        text: 'Visible damage to product (crushed, torn or leaking cases)',
        notify: N('shipping_qa', 'yes', 'If YES, hold the affected product — notify QA'),
      },
      {
        key: 'photos_taken',
        text: 'Photos of the loaded product taken before the doors closed',
        note: 'Attach them to this inspection — the photos are the evidence of how the load left',
      },
    ],
  },
  {
    key: 'release',
    title: 'RELEASE - Paperwork and seal',
    items: [
      { key: 'bol_complete', text: 'BOL complete and signed by the driver' },
      {
        key: 'seal_applied',
        text: 'Seal applied and seal number recorded on the BOL',
        note: 'Applicable if the shipment is sealed',
      },
      { key: 'doors_secured', text: 'Doors closed and secured' },
      { key: 'entered_in_system', text: 'Shipment entered in the system' },
    ],
  },
];

export const CHECKLIST_HEADER = [
  { key: 'order_number', label: 'Order / Pick List #' },
  { key: 'bol_number', label: 'BOL #' },
  { key: 'customer', label: 'Customer' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'truck_number', label: 'Truck/Trailer #' },
  { key: 'driver_name', label: 'Driver Name' },
  { key: 'seal_number', label: 'Seal #' },
  { key: 'pallet_count', label: 'Number of Pallets', type: 'number' },
];

export const ANSWERS = ['yes', 'no', 'na'];

export function allItems() {
  return CHECKLIST_SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s.key, section_title: s.title })));
}

export function getItem(key) {
  return allItems().find(i => i.key === key) || null;
}

/** Derived on every read, never stored — the receiving rule. */
export function triggeredEscalations(answers = {}) {
  return allItems()
    .filter(i => i.notify && answers[i.key] === i.notify.answer)
    .map(i => ({
      key: i.key, text: i.text, answer: answers[i.key],
      target: i.notify.target,
      target_label: NOTIFY_TARGETS[i.notify.target]?.label || i.notify.target,
      note: i.notify.note,
    }));
}

export function normalizeAnswers(input = {}) {
  const known = new Set(allItems().map(i => i.key));
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!known.has(k)) continue;
    const val = String(v || '').toLowerCase();
    if (ANSWERS.includes(val)) out[k] = val;
  }
  return out;
}

export function unanswered(answers = {}) {
  return allItems().filter(i => !answers[i.key]).map(i => ({ key: i.key, text: i.text, section: i.section_title }));
}

/**
 * The photo question is the one item whose answer can be CHECKED against the
 * record. "Photos taken — yes" with no photograph attached is a claim with
 * nothing behind it, which is precisely what this form exists to prevent; so
 * sign-off refuses it, and names the fix.
 */
export function photoClaimUnsupported(answers = {}, photoCount = 0) {
  return answers.photos_taken === 'yes' && photoCount === 0;
}

export const CHECKLIST = {
  form_code: CHECKLIST_FORM_CODE,
  revision: CHECKLIST_REVISION,
  title: CHECKLIST_TITLE,
  note: CHECKLIST_NOTE,
  header: CHECKLIST_HEADER,
  sections: CHECKLIST_SECTIONS,
  answers: ANSWERS,
  targets: NOTIFY_TARGETS,
};
