// FORM 204-01 V1 — Receiving Inspection Checklist.
//
// Transcribed from the plant's own controlled form. The wording is VERBATIM,
// typos included ("informm purchasing"), for the same reason the internal-audit
// checklist keeps its own: an auditor comparing the app to Form 204-01 must find
// the same questions. Correcting the text here would make the app disagree with
// the approved document, and fixing the document is a Document Change Request.
//
// NOT user-editable, same doctrine as `scale-forms.js` tolerances and
// `audit-checklist.js`: changing what a receiving inspection asks is a document
// change, not a settings toggle. `CHECKLIST_REVISION` is stamped on every filed
// checklist, so a record always says which revision it was run against.
//
// ── The escalations are the point ────────────────────────────────────────────
// Half these lines end in "*If YES, notify Adam or QA" or "*If NO, inform
// purchasing". On paper that instruction depends on the receiver remembering to
// walk over and find someone. Here each one carries a `notify` rule naming the
// answer that triggers it and who it reaches, so the app can offer the button at
// the moment the box is ticked — and record that it was sent.
//
// A checklist is filed PER INSPECTION, not per row. One arrival is routinely
// several lines against one PO (the imported Monday history has 1,328 rows
// sharing 511 inspection numbers), and the paper form has one header and one
// approval covering all of them.

export const CHECKLIST_FORM_CODE = 'FORM 204-01';
export const CHECKLIST_REVISION = 'V1';
export const CHECKLIST_TITLE = 'Receiving Inspection Checklist';

// Who an escalation reaches. Resolved to real accounts at send time by
// `receiving-notify.js`; named here so the form says who it goes to.
export const NOTIFY_TARGETS = {
  qa_inspection: {
    label: 'Adam and Maria',
    // Both named on the form for this one — it is a QA inspection of incoming
    // packaging, and the form asks for both.
    names: ['Maria', 'Adam'],
    fallbackDepartments: ['qa'],
    subject: 'QA inspection needed on a receipt',
  },
  qa: {
    label: 'Adam and Maria',
    // The paper says "Adam or QA"; the user's routing decision (2026-08-14) is
    // that every QA escalation reaches BOTH Adam and Maria.
    names: ['Adam', 'Maria'],
    fallbackDepartments: ['qa'],
    subject: 'QA inspection needed on a receipt',
  },
  // Raised by the ARRIVAL of an item on QA's standing lab-test list, not by an
  // answer on the checklist — so it has no `notify` line on any question. It
  // reaches the same people as the other QA escalations; only the subject
  // differs, because "pull a sample off this pallet" and "we may have received
  // contaminated product" should not read the same on a phone.
  qa_lab_test: {
    label: 'Adam and Maria',
    names: ['Adam', 'Maria'],
    fallbackDepartments: ['qa'],
    subject: 'Lab sample due on a receipt',
  },
  purchasing: {
    label: 'Jake (Purchasing)',
    // Jake Waits is the procurement manager (user's routing decision,
    // 2026-08-14). The department fallback keeps the escalation alive if his
    // account is renamed or he leaves.
    names: ['Jake Waits', 'Jake'],
    fallbackDepartments: ['purchasing', 'procurement', 'office', 'admin'],
    subject: 'Receiving paperwork problem',
  },
};

// `answer` is the response that fires the escalation. `note` is the form's own
// wording — kept in the definition as the record of what FORM 204-01 says,
// though the screen no longer renders it: the app performs the notification
// itself, so an instruction telling the receiver to go do it is noise.
// `target_label` rides along so every rendering of the item can name who the
// escalation reaches without a second lookup (the missing label is exactly how
// the button once read "Notify undefined").
const N = (target, answer, note) => ({ target, answer, note, target_label: NOTIFY_TARGETS[target].label });

export const CHECKLIST_SECTIONS = [
  {
    key: 'pre_unload',
    title: 'PRE-Unload Inspection',
    items: [
      {
        key: 'is_packaging',
        text: 'Is the product Packaging (Film or pouches)?',
        notify: N('qa_inspection', 'yes', 'If YES, notify Maria and Adam for QA Inspection'),
      },
      { key: 'truck_intact', text: 'Truck exterior appears intact (no damage/leaks)' },
      { key: 'truck_clean', text: 'Truck clean, dry, odor-free' },
      {
        key: 'seal_intact',
        text: 'Seal intact & correct',
        note: 'Applicable if Truck arrives with Seal',
      },
      { key: 'correct_product_type', text: 'Correct product type' },
      { key: 'correct_quantity', text: 'Correct quantity' },
      {
        key: 'visible_damage',
        text: 'Visible damage',
        notify: N('qa', 'yes', 'If YES, notify Adam or QA for immediate Inspection'),
      },
      {
        key: 'moisture_contamination',
        text: 'Moisture or contamination',
        notify: N('qa', 'yes', 'If YES, notify Adam or QA for immediate Inspection'),
      },
      { key: 'labels_match_po', text: 'Labels readable & match PO' },
      { key: 'bol_present', text: 'BOL / Packing Slip present' },
      { key: 'matches_po', text: 'Matches PO' },
    ],
  },
  {
    key: 'post_unload',
    title: 'POST-Unload Inspection',
    items: [
      {
        key: 'coa_present',
        text: 'Certificate of Analysis present',
        notify: N('purchasing', 'no', 'If NO, inform purchasing'),
      },
      {
        key: 'coc_present',
        text: 'Certificate of Conformance',
        notify: N('purchasing', 'no', 'If NO, inform purchasing'),
      },
      {
        key: 'contains_allergen',
        text: 'Does product contain an allergen? (wheat, soy, dairy, nuts, or peanuts)',
        note: 'If YES, print placards and/or Warehouse ID tags, label item with name and allergen',
      },
    ],
  },
  {
    key: 'data_entry',
    title: 'DATA ENTRY - Receiving',
    items: [
      { key: 'po_matches_system', text: 'Does PO # match assigned # in system' },
      {
        key: 'quantities_match',
        text: 'Do PO and Packing slip quantities match?',
        notify: N('purchasing', 'no', 'If NO, informm purchasing'),
      },
      { key: 'entered_into_system', text: 'Receiving information entered into system?' },
      {
        key: 'paperwork_attached',
        text: 'Attached File receiving paperwork',
        note: 'Attach packing slip, PO, & pictures of received items',
      },
    ],
  },
];

// The header block, above the inspection items.
export const CHECKLIST_HEADER = [
  { key: 'po_number', label: 'PO #' },
  { key: 'truck_number', label: 'Truck/Trailer #' },
  { key: 'pallet_count', label: 'Number of Pallets', type: 'number' },
  { key: 'driver_name', label: 'Driver Name / Signature' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'vendor_lot', label: 'Vendor Lot #' },
  { key: 'customer_number', label: 'Customer #' },
];

export const ANSWERS = ['yes', 'no', 'na'];

/** Every item, flattened, in the form's own print order. */
export function allItems() {
  return CHECKLIST_SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s.key, section_title: s.title })));
}

export function getItem(key) {
  return allItems().find(i => i.key === key) || null;
}

/**
 * Which escalations this set of answers has triggered.
 *
 * Derived on every read, never stored as a list — correct an answer and the
 * escalations move with it. A stored list would go stale exactly when somebody
 * fixed a mis-click, which is the moment it matters most.
 */
export function triggeredEscalations(answers = {}) {
  return allItems()
    .filter(i => i.notify && answers[i.key] === i.notify.answer)
    .map(i => ({
      key: i.key,
      text: i.text,
      answer: answers[i.key],
      target: i.notify.target,
      target_label: NOTIFY_TARGETS[i.notify.target]?.label || i.notify.target,
      note: i.notify.note,
    }));
}

/**
 * Answers that are not one of yes/no/na are dropped rather than stored.
 * A checklist is evidence; a value nobody can interpret is worse than a blank,
 * which at least reads honestly as unanswered.
 */
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

/** Unanswered items, in print order. Sign-off is refused while any remain. */
export function unanswered(answers = {}) {
  return allItems().filter(i => !answers[i.key]).map(i => ({ key: i.key, text: i.text, section: i.section_title }));
}

export const CHECKLIST = {
  form_code: CHECKLIST_FORM_CODE,
  revision: CHECKLIST_REVISION,
  title: CHECKLIST_TITLE,
  header: CHECKLIST_HEADER,
  sections: CHECKLIST_SECTIONS,
  answers: ANSWERS,
  targets: NOTIFY_TARGETS,
};
