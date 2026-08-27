// SOP 404 V4 § V — the values the supplier register is built on, TRANSCRIBED.
//
// Same doctrine as preventive-controls.js and scale-forms.js: where the SOP
// names a value, the value is the SOP's, verbatim, and is not editable in a
// text box. Changing what a supplier disposition means, or which criteria a
// risk evaluation asks, is a Document Change Request — not a settings screen.
//
// Wording is a faithful transcription of Protocol/SOP 404 V4 dated 08/04/2026.
// Corrections go in THIS FILE and then through Document Control; never in the
// database.
//
// NOTE the document's own state while reading these: SOP 404 V4 is unsigned
// (W2-20), its file contains both V3 and V4 (W2-22), and it cites a FORM 404-3
// that has never been issued (W2-26). None of that changes what § V says; it is
// recorded here so nobody reads this file as evidence the document is settled.

export const SOP = { code: 'SOP 404', revision: 'V4', dated: '2026-08-04',
  title: 'Supplier and Laboratory Qualification' };

/**
 * § V.C.III — the three dispositions, with the SOP's own definitions.
 *
 * A completed questionnaire is EVIDENCE for one of these, never one of them.
 * A fourth value is a Document Change Request.
 */
export const DISPOSITIONS = [
  {
    value: 'approved',
    label: 'Approved',
    text: 'The Supplier has sufficient capabilities and quality systems to supply materials that meet all '
      + 'applicable requirements. In addition, the appropriate audits, surveys, and no change agreements, '
      + 'are completed and signed.',
  },
  {
    value: 'conditionally_approved',
    label: 'Conditionally Approved',
    text: 'The Supplier has sufficient capabilities and quality systems to supply materials that meet all '
      + 'applicable requirements. Some deficiencies may exist that do not meet all aspects of the GMP, ISO '
      + 'or QSR regulation. Another case may be that the documentation is not fully completed or approved. '
      + 'Suppliers that are selected and required by the Customers may be permanently approved for customer '
      + 'specific parts. Suppliers may also be temporarily conditionally approved until deficiencies are '
      + 'corrected or the documentation has been completed and approved.',
  },
  {
    value: 'not_approved',
    label: 'Not Approved',
    text: 'The Supplier does not have sufficient capabilities and quality systems to supply materials that '
      + 'meet all applicable requirements. When the Customer specifies the Supplier, Company shall request '
      + 'that the Customer maintains this Supplier or qualifies an alternate source. These Suppliers shall '
      + 'be classified in category C (i.e. Customer maintained). Written Customer acknowledgement that they '
      + 'will keep the Supplier or approval of an alternate source shall be required and included in the file.',
  },
];

/**
 * § V.C.B.I — "The risk evaluation of the supplier and material will be based
 * on the following minimum criteria". All seven, in the document's order.
 *
 * MINIMUM criteria, in the SOP's own word — so a disposition that leaves one
 * unanswered has not had the evaluation the document requires, which is why the
 * endpoint refuses it rather than storing a partial answer.
 */
export const RISK_CRITERIA = [
  { key: 'quality_system', text: 'A quality system has been developed and implemented.' },
  { key: 'facilities', text: 'Facilities (including buildings, environment, and equipment) are considered acceptable.' },
  { key: 'order_processing', text: 'Order processing controls exist.' },
  { key: 'manufacturing_controls', text: 'Manufacturing controls are in place.' },
  { key: 'capa', text: 'Corrective and Preventative actions are actively used.' },
  { key: 'documentation', text: 'Documentation and configuration controls are implemented.' },
  { key: 'compliance', text: 'There are no known compliance discrepancies which are not being addressed (applicable to FDA or ISO)' },
];

/** § VI — the forms the SOP names. 404-3 has never been issued (W2-26). */
export const FORMS = [
  { code: 'FORM 404-1', title: 'Vendor Qualification Questionnaire', in_index: true },
  { code: 'FORM 404-2', title: 'Vendor Raw Material Questionnaire', in_index: true },
  { code: 'FORM 404-3', title: 'Vendor Audit Summary Form', in_index: false,
    note: 'Cited by SOP 404 § VI and absent from the Master Index and all 159 rows of the DCR log.' },
];
