// Form 403-01 — Internal Audit Checklist, Revision V1.
//
// Transcribed from the plant's own controlled form, section by section, in the
// order it prints. Two decisions worth knowing:
//
//   1. THE WORDING IS VERBATIM, typos included ("All spay bottles are clearly
//      identified", "All cleaning utensils are kept off the grown"). This is a
//      controlled document: an auditor comparing the app to Form 403-01 must
//      find the same questions. Correcting the text here would make the app
//      disagree with the approved form, and fixing the form is a Document
//      Change Request, not an edit in a source file.
//   2. THE CHECKLIST IS NOT USER-EDITABLE, for the same reason the scale
//      tolerances aren't (`scale-forms.js`). Changing what an internal audit
//      asks is a document change. `checklist_revision` is recorded on every
//      audit so a record always says which revision it was run against.
//
// Sections are selectable per audit. On paper, whole sections get a diagonal
// line through them when they weren't in scope that month — that is exactly
// what picking sections does here, except the record then says so instead of
// leaving a reader to interpret a pen stroke.

export const CHECKLIST_CODE = 'Form 403-01';
export const CHECKLIST_REVISION = 'V1';

// The closing line of most sections. Written out per section rather than
// appended in code, so the item keys stay stable and readable.
export const SECTIONS = [
  {
    id: 'incoming_inspections',
    title: 'Incoming inspections',
    items: [
      'All inbound trailers are inspected',
      'Only shipments in good condition and transported at appropriate temperatures are received.',
      'All incoming ingredients are received into the inventory management system.',
      'All products received are labeled and stored in the appropriate storage area.',
      'Is incoming material placed on hold at the moment of arrival',
      'Employees follow GMPs',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'incoming_sampling',
    title: 'Incoming Sampling and Retention',
    items: [
      'Sampling is done in a sanitary manner',
      'The equipment used has been calibrated',
      'Cleaning records are present and filled out properly',
      'Utensils and towel have a clean or dirty status',
      'All spay bottles are clearly identified',
      'Samples are clearly marked and recorded',
      'Retain samples are kept according to proper storage conditions',
      'Retention logs are available',
      'Employees follow GMPs',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'production_dosing',
    title: 'Production: Dosing',
    items: [
      'Batch production record is present and fill out at the time of performance',
      'Components and Quantities are recorded and verified',
      'All scales are calibrated',
      'Employees follow GMPs',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'capas_nonconformance',
    title: 'CAPAs and nonconformance',
    items: [
      'All CAPAs and non-conformance are logged',
      'CAPAs have been initiated, implement and proven effective',
      'CAPAs and non-conformance have an assigned number',
      'CAPAs and non-conformance are approved and reviewed by Quality.',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'purchasing_vendors',
    title: 'Purchasing and Vendor qualification',
    items: [
      'All vendors have been qualified and approved by Quality',
      "There's a list of approved vendors",
      'SDS are received for the incoming ingredients',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'maintenance_pm',
    title: 'Maintenance and Preventive Maintenances',
    items: [
      'All tools are controlled',
      "There's a PM schedule set up",
      'PMs are recorded and performed as scheduled',
      'Maintenance shop is well organized',
      'There are labeled chemical cabinets (food grade vs non-food grade',
      'SDS for the chemicals are present',
      'Employees follow GMPs.',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'calibration',
    title: 'Calibration',
    items: [
      'All scales, metal detectors, refrigerators have been calibrated',
      'Calibration certification documents have been properly reviewed',
      'Calibration records are recorded daily',
      'Units of measuring have been recorded properly',
      'Scale and weight set are recorded on the documents',
    ],
  },
  {
    id: 'production_molding',
    title: 'Production: Molding and de-molding',
    items: [
      'Batch production record is present and fill out at the time of performance',
      'Components and Quantities are recorded and verified',
      'All scales are calibrated',
      'Room status is present',
      'Employees follow GMPs',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'document_control_training',
    title: 'Document Control and Training',
    items: [
      'New employees have been trained in all required SOPs.',
      'Required employees have successfully completed the GMP training.',
      'Personnel training records are up to date.',
      'Visitor Policy is enforced.',
      'Visitor log book is completed for each visitor to the building.',
      'Master SOP list is accurate and up to date.',
      'SOPs and Forms are revision controlled',
      'Record change controls are used',
      'All changes are logged and recorded under the change control number',
      'All documents are filed in a manner that are easy to find',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'sanitation_pest',
    title: 'Sanitation and Pest Control',
    items: [
      'Facility sanitation program is followed and effective.',
      'Sanitation Pre-Operations Checklist are completed daily and prior to production.',
      'Approved chemical list is up to date.',
      'Pest Control program is being monitored and logged.',
      'Pest control program is effective.',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'production_packaging',
    title: 'Production: Packaging',
    items: [
      'Batch production record is present and fill out at the time of performance',
      'Components and Quantities are recorded and verified',
      'Room status is present',
      'All scales are calibrated',
      'Employees follow GMPs',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'management_review',
    title: 'Management Review',
    items: [
      'Management perform reviews',
      'Management meets regularly and its aware of quality issues',
    ],
  },
  {
    id: 'internal_audits',
    title: 'Internal audits',
    items: [
      'Internal audits are performed monthly',
      'Internal audit plan is present and up to date',
      'Auditors have been properly trained to perform audits',
      'Findings are logged properly',
      'All Corrective Actions Requests resulting from internal audits have been closed and Corrective Action Plans have been assessed for effectiveness.',
    ],
  },
  {
    id: 'product_distribution',
    title: 'Product distribution',
    items: [
      'Batch records are reviewed and released by Quality',
      'Trailers are inspected',
      'BOLs and COAs are part of the out going material',
      'Quantities are verified and match the system',
      'Governing SOPs match the process',
    ],
  },
  {
    id: 'sanitary_audits',
    title: 'Sanitary Audits',
    items: [
      'Building Exterior and surrounding area is free from potential contaminants. This includes pests, debris, chemicals etc.',
      'Building Interior is clean and free from potential contaminants. This includes pests, debris, chemicals etc.',
      'Clean areas are in good working order and stocked with hand washing supplies.',
      'Chemicals are labeled and stored separately from products.',
      'Bathrooms are clean daily and the clean is recorded.',
      'Broken pallets are disposed and not present in the facility.',
      'All cleaning utensils are kept off the grown.',
    ],
  },
  {
    id: 'environmental_monitoring',
    title: 'Environmental Monitoring',
    items: [
      'Environmental monitoring is in place',
      "There's a schedule for the equipment and sites to check",
      'Testing specifications are outline',
    ],
  },
  {
    id: 'quality_responsibilities',
    title: 'Quality Responsibilities and Policies',
    items: [
      'SOPs outline the Quality Assurance role',
      'Quality is the only department that can take product off quality holds',
    ],
  },
  {
    id: 'recall',
    title: 'Recall',
    items: [
      'Mock Recall documents have been attached to the internal audit checklist.',
      'Mock recall has been successfully completed',
      'All individual product profiles are up to date.',
    ],
  },
  {
    id: 'rework',
    title: 'Rework',
    items: [
      'Documented rework policy and procedures is in place.',
      'Rework traceable to maintain trace and recall compliance.',
      'Rework managed in a sanitary manner complying with GMPs.',
      'Governing SOPs match the process',
    ],
  },
];

export const SECTION_IDS = SECTIONS.map(s => s.id);
const BY_ID = new Map(SECTIONS.map(s => [s.id, s]));
export const sectionById = (id) => BY_ID.get(id) || null;

// An item's stable key: section id + its index in that section. Stable because
// the checklist is code, not data — a revision that reorders items is a new
// revision, and old records keep saying which revision they were run against.
export const itemKey = (sectionId, index) => `${sectionId}.${index}`;

// The rows an audit starts with, for the sections in scope. Sections keep the
// order they print in, whatever order they were picked in.
export function itemsForSections(sectionIds) {
  const wanted = new Set(sectionIds);
  const out = [];
  for (const s of SECTIONS) {
    if (!wanted.has(s.id)) continue;
    s.items.forEach((prompt, i) => out.push({ section: s.id, item_key: itemKey(s.id, i), prompt }));
  }
  return out;
}
