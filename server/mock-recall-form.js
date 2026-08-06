/**
 * SOP 415 (Mock Recall Procedure) V3 — the parts of the plant's own document
 * that the app has to enforce or reproduce.
 *
 * NOT USER-EDITABLE, for the same reason `scale-forms.js` tolerances aren't:
 * the 99.5–100.5% mass balance and the four-hour limit are ACCEPTANCE CRITERIA
 * from a controlled document. Changing one is a Document Change Request, not a
 * settings toggle. `SOP_REVISION` is stamped onto every record so a filed mock
 * recall always says which revision it was run against.
 *
 * The wording of each documented item is the SOP's own, in the SOP's order, so
 * an auditor comparing the screen to Form 415-1 finds the same list.
 */
export const SOP_CODE = 'SOP 415';
export const SOP_REVISION = 'V3';
export const FORM_CODE = 'FORM 415-1';

/**
 * "The mock recall will document the following" — SOP 415 V3.
 *
 * `key` maps to a `mock_recalls` column. `kind` drives the input. The list is
 * the record of scope: an item left blank is visible as blank rather than
 * absent, which is what stops a thin exercise reading later as a complete one.
 */
export const DOCUMENTED_ITEMS = [
  { key: 'product_name', label: 'Product name', kind: 'text', required: true },
  { key: 'item_number', label: 'Item number', kind: 'text' },
  { key: 'lot_number', label: 'Lot number', kind: 'text', required: true },
  { key: 'date_produced', label: 'Date produced', kind: 'date' },
  { key: 'started_at', label: 'Start time of mock recall', kind: 'datetime' },
  { key: 'ended_at', label: 'End time of mock recall', kind: 'datetime' },
  { key: 'quantity_produced', label: 'Total quantity produced', kind: 'text' },
  { key: 'date_distributed', label: 'Date distributed', kind: 'date' },
  { key: 'quantity_distributed', label: 'Quantity distributed', kind: 'text' },
  { key: 'quantity_quarantined', label: 'Quantity on quarantine', kind: 'text' },
  { key: 'quantity_in_market', label: 'Estimated amount remaining in the market place', kind: 'text' },
  { key: 'notification_method', label: 'Method of notification', kind: 'text' },
  { key: 'customer_disposition', label: 'What our customers do with their products', kind: 'textarea' },
  { key: 'batch_records', label: 'Batch records surrounding product', kind: 'textarea' },
  { key: 'labeling_records', label: 'Labeling records', kind: 'textarea' },
  { key: 'retention_samples', label: 'Retention samples available', kind: 'textarea' },
  { key: 'reconciliation', label: 'Reconciliation of product identified', kind: 'textarea' },
  { key: 'product_disposition', label: 'Product disposition', kind: 'textarea' },
  { key: 'closeout_minutes', label: 'Minutes from the mock recall close-out meeting', kind: 'textarea' },
];

// The mass balance window and the time limit, exactly as written.
export const MASS_BALANCE_MIN = 99.5;
export const MASS_BALANCE_MAX = 100.5;
export const MAX_DURATION_MINUTES = 4 * 60;

/** Minutes between start and end, or null when either is missing. */
export function durationMinutes(recall) {
  if (!recall?.started_at || !recall?.ended_at) return null;
  const a = new Date(recall.started_at), b = new Date(recall.ended_at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const mins = Math.round((b - a) / 60000);
  return mins >= 0 ? mins : null;
}

/**
 * The SOP's effectiveness check — three criteria, each reported with the fact
 * it was judged on rather than as a bare pass.
 *
 * `met` is null when the exercise hasn't recorded enough to decide. That is
 * deliberately distinct from false: "we haven't measured the mass balance" and
 * "the mass balance was 92%" are different states, and collapsing them into a
 * red cross is how a half-run drill reads as a failed one.
 */
export function effectivenessCheck(recall) {
  const pct = recall?.mass_balance_pct;
  const hasPct = pct !== null && pct !== undefined && pct !== '';
  const mins = durationMinutes(recall);

  const criteria = [
    {
      id: 'mass_balance',
      label: `Reconciliation demonstrates ${MASS_BALANCE_MIN}–${MASS_BALANCE_MAX}% recovery`,
      detail: hasPct ? `${Number(pct)}% recovery` : 'Mass balance not recorded',
      met: hasPct ? (Number(pct) >= MASS_BALANCE_MIN && Number(pct) <= MASS_BALANCE_MAX) : null,
    },
    {
      id: 'within_4_hours',
      label: 'Completed, including summary report, in no more than 4 hours',
      detail: mins === null
        ? 'Start and end time not both recorded'
        : `${Math.floor(mins / 60)}h ${mins % 60}m${recall.summary_report_complete ? ', summary report complete' : ', summary report not marked complete'}`,
      // Both halves are the SOP's sentence: the exercise AND its summary report.
      met: mins === null ? null : (mins <= MAX_DURATION_MINUTES && !!recall.summary_report_complete),
    },
    {
      id: 'form_415_1',
      label: `Mock recall box checked on Product Recall Record ${FORM_CODE}`,
      detail: recall?.form_415_1_checked ? 'Checked' : 'Not checked',
      met: !!recall?.form_415_1_checked,
    },
  ];

  const decided = criteria.filter(c => c.met !== null);
  const failed = criteria.filter(c => c.met === false);
  return {
    criteria,
    // Only a fully-measured exercise gets a verdict. Anything else is still
    // running as far as this is concerned.
    complete: decided.length === criteria.length,
    successful: decided.length === criteria.length && failed.length === 0,
    failed_ids: failed.map(c => c.id),
  };
}

/** Which of the SOP's documented items are still blank on this record. */
export function missingItems(recall) {
  return DOCUMENTED_ITEMS.filter(f => {
    const v = recall?.[f.key];
    return v === null || v === undefined || String(v).trim() === '';
  }).map(f => ({ key: f.key, label: f.label }));
}

/**
 * The recall contact list, from SOP 415 V3.
 *
 * Held here rather than derived from the user roster on purpose: this is the
 * list on the controlled document, with the titles and the personal numbers as
 * approved — including the FDA line, which is not a ReadyDoc account. V3's only
 * change from V2 was the QA Manager entry, which is why the revision matters.
 */
export const RECALL_CONTACTS = [
  { name: 'FDA', title: 'Contact information', phone: '1-866-300-4374' },
  { name: 'Danny Augustyn', title: 'CEO', phone: '1-773-951-4218' },
  { name: 'Adam Bliss', title: 'Production Manager', phone: '1-801-669-3198' },
  { name: 'Maria Servin', title: 'QA Manager', phone: '1-801-330-7767' },
  { name: 'Lowry Akers', title: 'Office Manager', phone: '1-435-851-0275' },
];

/**
 * The four tracking procedures the SOP defines, as checklists.
 *
 * Which one applies depends on what triggered the exercise, so the record says
 * which was walked rather than assuming the finished-good path. Wording is the
 * SOP's own.
 */
export const TRACKING_PROCEDURES = {
  distributed: {
    label: 'Distributed product',
    steps: [
      'Assemble the team needed to conduct tracking of a finished product.',
      'Identify the affected and any other potentially affected product(s), product code(s) and production date(s).',
      'Determine, from the Batch Record, the quantity of affected product(s) produced.',
      'Determine the last day of shipment (and the customer) for the affected product(s).',
      'Determine the remaining quantity of the affected product(s) in inventory.',
    ],
  },
  undistributed: {
    label: 'Undistributed product',
    steps: [
      'Assemble the team needed to conduct tracking of a work-in-progress product.',
      'Identify the affected and any other potentially affected product(s), product code(s) and production date(s) from the production records.',
      'Determine, from the Production Records, the quantity of the affected product(s) produced.',
      'Locate the affected product(s) in the warehouse and move them to the Quarantine area.',
    ],
  },
  ingredient: {
    label: 'Ingredient',
    steps: [
      'Assemble the team needed to conduct tracking of an ingredient.',
      'Identify the affected and any other potentially affected ingredient(s) and lot number(s)/lot code(s)/production code(s)/best before date(s)/receiving date(s).',
      'Determine the quantity and the receiving date of the affected ingredient(s).',
      'Determine all the finished product(s) produced by the affected ingredient(s).',
      'Determine the quantity of the affected product(s) produced during this period.',
      'Determine the day when the affected product(s) entered into the inventory (i.e. packaging date).',
    ],
  },
  packaging: {
    label: 'Packaging material',
    steps: [
      'Identify the affected and any other potentially affected packaging material(s) and lot number(s)/quality control code/receiving date(s).',
      'Determine the quantity and the receiving date of the affected packaging material(s) received.',
      'Determine all the finished product(s) associated with the affected packaging material(s).',
      'Determine the period of use for the affected packaging material(s).',
      'Determine the day the affected product(s) entered into the inventory (i.e. packaging date).',
      'Determine the last day of shipment (and the customer) for the affected product(s).',
      'Determine the customer who purchased the affected product(s) during this period.',
      'Determine the remaining quantity of the affected product(s) in our inventory, and place them in the Quarantine area.',
    ],
  },
};
