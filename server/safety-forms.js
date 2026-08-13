// The plant's three safety forms, transcribed from the controlled documents.
//
// The wording is VERBATIM — same doctrine as FORM 204-01, FORM 418-01 and the
// internal-audit checklist: an auditor comparing the app to the paper must find
// the same words, and correcting anything here would make the app disagree with
// the approved document. Changing a form is a Document Change Request. None of
// this is user-editable; each filed record stamps the revision it was filed
// against.

// ── FORM 501-01 V5 — Crisis Management Contact List ─────────────────────────
//
// A REFERENCE, not a log: who to call when something goes wrong. Like the mock
// recall's RECALL_CONTACTS, this is the DOCUMENT'S list, not the user roster —
// it includes the police, fire and county emergency lines, which are not
// ReadyDoc accounts, and its phone numbers are the approved ones even where a
// person's profile might say otherwise. When someone changes role, the fix is
// a revision of FORM 501-01, and this transcription follows it.
export const CRISIS_FORM_CODE = 'FORM 501-01';
export const CRISIS_REVISION = 'V5';
export const CRISIS_TITLE = 'Crisis Management Contact List';

export const CRISIS_CONTACTS = [
  { name: 'Danny Augustyn', title: 'CEO', phone: '1-773-951-4218' },
  { name: 'Adam Bliss', title: 'Operations Manager', phone: '1-801-669-3198' },
  { name: 'Maria Servin', title: 'QA', phone: '1-801-330-7767' },
  { name: 'Lowry Akers', title: 'VP of Operations Manager/HR', phone: '1-435-851-0275' },
  { name: 'Non Emergency Police Dispatch', title: 'Police', phone: '1-801-798-5600' },
  { name: 'Utah County Emergency Management', title: 'Utah County Emergency Management', phone: '1-801-851-4130' },
  { name: 'Non Emergency Fire Department', title: 'Fire Department', phone: '1-801-229-7070' },
];

// ── FORM 501-02 V1 — Headcount Evacuation Form ──────────────────────────────
//
// Filed once per evacuation (drill or real). The paper is one sheet with a row
// per work area; each row records how many were in the area, how many are
// accounted for at the evacuation site, and the circled reason code.
export const EVAC_FORM_CODE = 'Form 501-02';
export const EVAC_REVISION = 'V1';
export const EVAC_TITLE = 'Headcount Evacuation Form';

export const EVAC_INSTRUCTION =
  'Upon reaching the evacuation area, one or more office members should assign employees to use this form to gather the evacuation site headcount. Return the form to any emergency response team member.';

export const EVAC_WORK_AREAS = ['Production', 'Warehouse', 'Cleaning Crew', 'Maintenance', 'Office', 'Contractors'];

// "Circle any Evacuation reason and list details on the back if needed."
export const EVAC_REASONS = {
  G: 'gas',
  F: 'fire',
  E: 'electrical',
  W: 'water',
  N: 'Natural disaster',
};

// ── FORM 502-01 V1 — First Aid Injury/Accident Form ─────────────────────────
//
// A log: one row per injury. The paper's five columns, in its order and its
// wording (including the spacing of "INJURY/ ACCIDENT" in the title).
export const FIRST_AID_FORM_CODE = 'FORM 502-01';
export const FIRST_AID_REVISION = 'V1';
export const FIRST_AID_TITLE = 'FIRST AID INJURY/ ACCIDENT FORM';

export const FIRST_AID_COLUMNS = [
  { key: 'employee_name', label: 'Name of Employee' },
  { key: 'injury_date', label: 'Date of Injury' },
  { key: 'injury_description', label: 'Location and Description of Injury' },
  { key: 'explanation', label: 'Explain why and how it happened' },
  { key: 'supervisor_name', label: 'Supervisor Name and Date' },
];

export const SAFETY_FORMS = {
  crisis: {
    form_code: CRISIS_FORM_CODE, revision: CRISIS_REVISION, title: CRISIS_TITLE,
    contacts: CRISIS_CONTACTS,
  },
  evacuation: {
    form_code: EVAC_FORM_CODE, revision: EVAC_REVISION, title: EVAC_TITLE,
    instruction: EVAC_INSTRUCTION, work_areas: EVAC_WORK_AREAS, reasons: EVAC_REASONS,
  },
  first_aid: {
    form_code: FIRST_AID_FORM_CODE, revision: FIRST_AID_REVISION, title: FIRST_AID_TITLE,
    columns: FIRST_AID_COLUMNS,
  },
};
