// What kind of controlled document a number names (D-317). ONE definition, read
// by the importer (server and screen), the "filed under the wrong type" pile in
// Doc Control Review, and the Change type control on a document.
//
// Only prefixes that say one thing are read. PROTOCOL, HACCP, QP and the bare
// letters carry no opinion, and POLICY is deliberately not read: a controlled
// policy (POLICY 002) is listed on the SOPs tab today, and no Document Control
// tab lists the `policy` type, so suggesting it would hide the document.
const PREFIXES = [
  [/^\s*WI\b|^\s*WI[-\s]?\d/i, 'work_instruction'],
  [/^\s*JD\b|^\s*JD[-\s]?\d/i, 'job_description'],
  [/^\s*FORM\b/i, 'form'],
  [/^\s*SOP\b|^\s*SOP[-\s]?\d/i, 'sop'],
];

export function typeFromNumber(docNumber) {
  const n = String(docNumber || '');
  for (const [re, type] of PREFIXES) if (re.test(n)) return type;
  return null;
}

// The types a person may move a document between, each with the tab it shows on.
// `form` has no registry tab: a form's home is the Forms tab (the form register).
export const RETYPE_TARGETS = [
  { value: 'sop', label: 'SOP', tab: 'SOPs' },
  { value: 'work_instruction', label: 'Work Instruction', tab: 'Work Instructions' },
  { value: 'job_description', label: 'Job Description', tab: 'Job Descriptions' },
  { value: 'form', label: 'Form', tab: null },
];
export const RETYPE_VALUES = new Set(RETYPE_TARGETS.map(t => t.value));
export const TYPE_LABELS = { sop: 'SOP', work_instruction: 'Work Instruction', job_description: 'Job Description', policy: 'Policy', form: 'Form', reference: 'Reference' };
