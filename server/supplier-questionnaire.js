// FORM 404-1 Rev V2 — Supplier Qualification Questionnaire — TRANSCRIBED.
//
// The plant's own controlled form, word for word, from the Word document
// Document Control issued (Powder_Ops_Form_4041_Supplier_Qualification_
// Questionnaire_V2.docx). Same doctrine as receiving-checklist.js and
// audit-checklist.js: what a supplier is asked is Document Control's decision,
// so the wording is not editable in the app and a change is a Document Change
// Request that lands HERE, then in the form's revision stamp on every record.
//
// The form's table has three columns — Yes / No / N/A — beside every row,
// including rows that plainly want words ("How many full-time employees…").
// Both are kept: every row takes Yes / No / N/A, and rows whose text asks for
// a detail also take one. Nothing is added, reordered or reworded; the one
// typographic slip in the source ("Does your facility have a Food Facility
// Registration number?" is followed by "Expiration date:" on the same row)
// is carried as that row's detail prompt.
//
// The form's last block — Risk Evaluation and Quality Disposition, "For
// internal use only" — is NOT part of the link. That decision is taken in the
// register under SOP 404 § V (supplier-sop.js), which is where the seven risk
// criteria and the three dispositions already live; a second copy of the
// decision on the questionnaire page is the two-owners defect. Note for
// Document Control: the form's own internal block asks FOUR risk questions and
// SOP 404 § V.C.B.I lists SEVEN criteria — the two documents disagree, and this
// module follows the SOP for the decision and the form for the questions.

export const FORM = {
  code: 'FORM 404-1',
  revision: 'V2',
  title: 'Supplier Qualification Questionnaire',
  instruction: 'Please have the appropriate personnel complete the following. Submit completed and signed questionnaire to jake@powder-ops.com',
  footer: 'Form 404-1 Rev V2',
};

/** The header block, in the form's order. `required` decides what blocks submission. */
export const HEADER = [
  { key: 'supplier_name', label: 'Supplier Name:', required: true },
  { key: 'supplier_address', label: 'Supplier Address:', required: true },
  { key: 'completed_by', label: 'Name of person completing questionnaire:', required: true },
  { key: 'phone', label: 'Phone number:', required: true },
  { key: 'date', label: 'Date:', required: false, auto: true },   // stamped on submission
];

export const ANSWERS = ['yes', 'no', 'na'];
export const ANSWER_LABELS = { yes: 'Yes', no: 'No', na: 'N/A' };

/**
 * The 46 rows of the form, verbatim. `detail` names the prompt for the row's
 * free-text answer where the row asks for one; `attach` names the attachment
 * a row asks for, so the page can offer the upload beside the question.
 */
export const QUESTIONS = [
  { key: 'q01', text: 'Does your facility have a Food Facility Registration number?', detail: 'Expiration date:' },
  { key: 'q02', text: 'Has your facility been inspected by the FDA or other 3rd party within the last calendar year? If yes, list the auditing entity?', detail: 'Auditing entity' },
  { key: 'q03', text: 'Will you attach your most recent audit?', attach: 'audit_report' },
  { key: 'q04', text: 'Has your facility ever received a FDA Form 483 or a Warning Letter following an inspection?' },
  { key: 'q05', text: 'Has your facility ever had to conduct a recall?' },
  { key: 'q06', text: 'Please list all current DBAs (other business names), former DBAs, and parent companies for your facility:', detail: 'DBAs and parent companies' },
  { key: 'q07', text: 'Do you have a food safety program that includes a HACCP plan' },
  { key: 'q08', text: 'How many full-time employees work at your facility?', detail: 'Number of full-time employees' },
  { key: 'q09', text: 'How many employees are part of quality control personnel?', detail: 'Number in quality control' },
  { key: 'q10', text: 'Will you attach your current organization chart?', attach: 'org_chart' },
  { key: 'q11', text: 'Do you follow written procedures for quality control operations?' },
  { key: 'q12', text: 'Do you have training documentation of employees that includes date and training types?' },
  { key: 'q13', text: 'Do you follow written procedures cleaning your facility and maintaining the physical plant and grounds?' },
  { key: 'q14', text: 'Do you have a service contract with a pest control company?' },
  { key: 'q15', text: 'Do you follow written procedures for cleaning and sanitizing equipment and utensils?' },
  { key: 'q16', text: 'Do you follow written procedures for instrument calibrations?' },
  { key: 'q17', text: 'Do you follow written procedures for controlling temperature and humidity in your facility?' },
  { key: 'q18', text: 'Do you create written specifications for components, in-process materials, labels, packaging components, and finished products?' },
  { key: 'q19', text: 'Does quality control personnel ensure all specifications for components, in-process materials, labels, packaging components, and finished products are correct? Prior to releasing the finished products for distribution?' },
  { key: 'q20', text: 'Do you collect reserve samples for all finished products, and hold them in the same container closure system in which the packaged and labeled dietary supplements are distributed?' },
  { key: 'q21', text: 'Do you create master manufacturing records for each product and unique batch size you make?' },
  { key: 'q22', text: 'Please attach an example master manufacturing record (please redact any proprietary or confidential information).', attach: 'mmr_example' },
  { key: 'q23', text: 'Will you provide copies of all master manufacturing records associated with our manufactured products at any time upon request?' },
  { key: 'q24', text: 'Do you create batch production records for each product you make?' },
  { key: 'q25', text: 'Please attach an example batch production record (please redact any proprietary or confidential information).', attach: 'bpr_example' },
  { key: 'q26', text: 'Will you provide copies of all batch production records associated with our manufactured products at any time upon request?' },
  { key: 'q27', text: 'Do you follow written procedures for product complaints?' },
  { key: 'q28', text: 'Do you follow written procedures for investigations related to product complaints, out of specification results, etc.?' },
  { key: 'q29', text: 'Do you follow written procedures for manufacturing operations?' },
  { key: 'q30', text: 'Do you take appropriate precautions to prevent contamination of components or dietary supplements?' },
  { key: 'q31', text: 'Do you clearly identify, hold, and control under a quarantine system all incoming components, products awaiting disposition decisions by quality?' },
  { key: 'q32', text: 'Do you follow written procedures for packaging and labeling operations?' },
  { key: 'q33', text: 'Do you follow written procedures for holding and distribution operations?' },
  { key: 'q34', text: 'Do you maintain distribution records?' },
  { key: 'q35', text: 'Do your quality control personnel qualify the contract laboratories that you use? Which contract laboratories do you currently use for analytical testing?', detail: 'Contract laboratories used' },
  { key: 'q36', text: 'Which set(s) of FDA cGMP regulations does your facility comply with (e.g., 21 CFR 111, 110, 117, 210, etc.)?', detail: 'Regulations' },
  { key: 'q37', text: 'Do you have a table of contents for your standard operating procedures? If yes, please attach.', attach: 'sop_toc' },
  { key: 'q38', text: 'Does the company source materials outside of the United States that are distributed to Powder-Ops?' },
  { key: 'q39', text: 'Does the company have a Foreign Supplier Verification Program in place?' },
  { key: 'q40', text: 'Does the company comply with FSVP requirements by using qualified individuals for FSVP activities?' },
  { key: 'q41', text: 'Does the company maintain records for FSVP activities?' },
];

/** The signature line, as the form prints it. */
export const SIGNATURE = {
  fields: ['Questionnaire completed by', 'Signature', 'Title', 'Date'],
  // What typing a name MEANS here (21 CFR 11.50 asks the record to say). Not
  // form content — the form has no attestation text of its own — so it is
  // worded as the act, not as a declaration the supplier never saw on paper.
  meaning: 'By typing my name below I am signing this questionnaire as the person who completed it, in place of a handwritten signature. My name, title, the date and time, and the network address used are recorded with it.',
};

/** What a supplier may attach, keyed to the rows that ask for it. */
export const ATTACHMENT_KINDS = [
  { key: 'audit_report', label: 'Most recent audit' },
  { key: 'org_chart', label: 'Organization chart' },
  { key: 'mmr_example', label: 'Example master manufacturing record' },
  { key: 'bpr_example', label: 'Example batch production record' },
  { key: 'sop_toc', label: 'Table of contents of standard operating procedures' },
  { key: 'other', label: 'Other supporting document' },
];

/** Coerce a saved answers object to what the form accepts; unknown keys drop. */
export function normalizeAnswers(raw = {}, prev = {}) {
  const out = { ...prev };
  for (const h of HEADER) {
    if (h.auto) continue;
    if (h.key in raw) out[h.key] = String(raw[h.key] ?? '').trim().slice(0, 300);
  }
  for (const q of QUESTIONS) {
    if (q.key in raw) {
      const a = String(raw[q.key] ?? '').trim().toLowerCase();
      out[q.key] = ANSWERS.includes(a) ? a : '';
    }
    const dk = `${q.key}_detail`;
    if (dk in raw) out[dk] = String(raw[dk] ?? '').trim().slice(0, 1000);
  }
  return out;
}

/**
 * What still blocks submission — derived on every read, so the page's
 * "still needed" list and the server's refusal cannot disagree. A required
 * header field, and an answer for every row. Details and attachments are the
 * supplier's to give or withhold; Quality reads a blank as a blank.
 */
export function missingToSubmit(answers = {}) {
  const missing = [];
  for (const h of HEADER) if (h.required && !String(answers[h.key] || '').trim()) missing.push({ key: h.key, label: h.label.replace(/:$/, '') });
  const blank = QUESTIONS.filter(q => !ANSWERS.includes(answers[q.key]));
  if (blank.length) missing.push({ key: 'questions', label: `${blank.length} question${blank.length === 1 ? '' : 's'} not yet answered`, keys: blank.map(q => q.key) });
  return missing;
}

/** The answers as plain text — searchable in the register, and the PDF body. */
export function answersAsText(answers = {}, signature = null) {
  const lines = [`${FORM.code} ${FORM.revision} — ${FORM.title}`];
  for (const h of HEADER) lines.push(`${h.label} ${answers[h.key] || (h.auto && signature?.at ? signature.at.slice(0, 10) : '')}`.trim());
  for (const q of QUESTIONS) {
    const a = ANSWER_LABELS[answers[q.key]] || '—';
    const d = answers[`${q.key}_detail`];
    lines.push(`${q.text} ${a}${d ? ` — ${d}` : ''}`);
  }
  if (signature) lines.push(`Questionnaire completed by: ${signature.name} · Title: ${signature.title || ''} · Date: ${signature.at}`);
  return lines.join('\n');
}
