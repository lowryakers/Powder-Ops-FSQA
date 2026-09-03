// THE FORMS MASTER INDEX, as data.
//
// The plant's controlled forms are numbered (FORM 431-02, FORM 703-01…), and
// most of them are now worked in ReadyDoc as a task, a log or a record type
// rather than on paper. Nothing in the app said so: an auditor holding the
// Forms Master Index and looking at a ReadyDoc task had no way to tell which
// numbered form that task satisfies. SQF wants a record traceable to the
// controlled form it answers, and this is that link.
//
// FOUR RULES SHAPED THIS FILE.
//
//  1. IT IS DISPLAY ONLY. A form number is stamped onto nothing, changes no
//     workflow, gates no button, and no record's behaviour depends on it.
//     Adding traceability must not put a new way to fail in front of anybody
//     two weeks before an audit.
//
//  2. THE NUMBER IS DERIVED, NOT STORED. Matching happens at read time from
//     what the task or record already is (its schedule title, its record type,
//     its area). A stored copy would be a second source of truth to keep in
//     step with the registry, and the first sign of drift would be a task
//     claiming a form number Document Control had moved.
//
//  3. WHERE THE RECORD ALREADY KNOWS ITS OWN REVISION, THAT WINS. An internal
//     audit stores `checklist_revision`, a receiving checklist stores its own,
//     a scale verification stores the tolerances it was graded against. A
//     record filed under V4 must keep saying V4 after Document Control issues
//     V5 — the registry revision here is only the answer for things that carry
//     no revision of their own.
//
//  4. AN UNMAPPED TASK SHOWS NOTHING. Never a guess. A wrong form number on a
//     compliance record is worse than an absent one, so anything the index does
//     not cover is simply absent.
//
// Transcribed in full from MASTER_SOP_LOG_AND_INDICES_V2.xlsx (the FORMS tab,
// rows 4–61). Series 300 is a heading with no forms under it, which is why
// nothing here carries a 3xx number — it was never missing.
//
// `where` says what is true of the form today, and is what makes the registry
// honest about the parts of the plant ReadyDoc does not run:
//   readydoc  — worked in the app; `match` says where.
//   keychain  — moving to Keychain; not in ReadyDoc and not expected to be.
//   paper     — still on paper.
//   retired   — no longer in use (kept so the number is never reissued).

import { FORM_CODE, FORM_REVISION } from './dilution-forms.js';

// FORM 106-01's revision lives in shared/dilution-forms.js, which is what the
// dilution check actually grades against and stamps on its records. Importing
// it means the registry cannot quietly fall a revision behind the form.
const DILUTION_REVISION = FORM_REVISION.replace(FORM_CODE, '').trim();

export const FORM_REGISTRY = [
  /* ── Series 00X — cleaning, inspections, environment ─────────────────── */
  // Series 100, straight off the Master Index. Not wired to any task or record
  // yet, so it carries no `match` — it is listed, not claimed.
  { code: 'FORM 100-01', revision: 'V1', title: 'Material Verification Checklist', where: 'paper' },
  {
    code: FORM_CODE, revision: DILUTION_REVISION, title: 'Chemical Dilution Logbook',
    where: 'readydoc',
    match: { sanitationArea: /^chemical (verification|dilution)/i, taskTitle: /^chemical dilution/i },
  },
  {
    // The gap the coverage report kept naming, closed off the Master Index at
    // last: the restroom cleaning log IS a numbered form, 108-1, so the 106
    // records filed under "Restroom" resolve to it now instead of to nothing.
    code: 'FORM 108-1', revision: 'V2', title: 'Restroom Cleaning Log',
    where: 'readydoc',
    match: { sanitationArea: /^restroom/i, taskTitle: /^restroom.*clean/i },
  },
  {
    // ANCHORED, and that is the whole point. Unanchored, `/break\s?room|
    // lobby|office/` matched "Brittle Plastic/Glass — Break Room" and all
    // three Office zones, so BPG inspection records came out numbered as the
    // Breakroom Cleaning Log. A room name appears in several forms' areas;
    // only the ones that START with it are that room's cleaning log.
    code: 'FORM 108-2', revision: 'V2', title: 'Breakroom, Lobby and Office Area Cleaning Log',
    where: 'readydoc',
    match: { sanitationArea: /^break\s?room\s*[,/]/i, taskTitle: /^break\s?room\s*[,/]/i },
  },
  {
    // NOT `module: 'sanitation'`. That looked like a sensible default and was
    // the worst line in the file: the sanitation log also holds restroom
    // cleans, warehouse cleans and 464 chemical dilution checks, and a
    // module-wide match would have printed "Production Cleaning Log" on every
    // one of them. A form number on the wrong record is exactly what rule 4
    // forbids, so this matches production cleaning and nothing else.
    code: 'FORM 108-03', revision: 'V2', title: 'Production Cleaning Log',
    where: 'readydoc',
    match: {
      sanitationArea: /^(production|room\s|batching|pre-?op|changeover|line\s)/i,
      taskTitle: /production line pre-?op|changeover clean/i,
    },
  },
  {
    code: 'FORM 110-01', revision: 'V3', title: 'Light Inspection Form Zone 1',
    where: 'readydoc', match: { taskTitle: /light inspection.*zone\s*1/i, sanitationArea: /light inspection.*zone\s*1/i },
  },
  {
    code: 'FORM 110-02', revision: 'V1', title: 'Light Inspection Form Zone 2',
    where: 'readydoc', match: { taskTitle: /light inspection.*zone\s*2/i, sanitationArea: /light inspection.*zone\s*2/i },
  },
  {
    // THE REGISTRY SAYS 110-03 AND THE APP SAID 110-04. Document Control's
    // index is the authority on the number, and its note is explicit ("MUST
    // UPDATE FORM # TO FORM 110-03 IN READY DOC"), so 110-03 is what a task
    // and a record display. Flagged in the panel rather than silently
    // corrected anywhere else, because renumbering a form is their act.
    code: 'FORM 110-03', revision: 'V2', title: 'Temperature and Humidity Control',
    where: 'readydoc',
    match: { taskTitle: /temp(erature)?\s*[/&]?\s*(and\s*)?humidity/i, sanitationArea: /temp(erature)?\s*[/&]?\s*(and\s*)?humidity/i },
    note: 'The Master Index numbers this 110-03; ReadyDoc previously showed 110-04.',
  },
  {
    code: 'FORM 111-01', revision: 'V4', title: 'Cleaning Log Checklist',
    where: 'keychain', note: 'Number terminated; attaches to the BPR (FORM 413-1) in Keychain.',
  },
  {
    code: 'FORM 111-02', revision: 'V1', title: 'Chemical Sign Out / Request Form',
    where: 'retired', note: 'Superseded by FORM 703-01 (Equipment/Tool/Chemical Sign In-Out).',
  },

  /* ── Series 200 — warehouse and receiving ────────────────────────────── */
  {
    // Anchored for the same reason as FORM 108-2: three BPG zones and a Light
    // Inspection zone are named "Warehouse Area", and a bare /warehouse/ took
    // all of them.
    code: 'FORM 202-01', revision: 'V1', title: 'Warehouse Cleaning Log',
    where: 'readydoc',
    match: { sanitationArea: /^warehouse\s*[&/]\s*grounds/i, taskTitle: /^warehouse\s*[&/]\s*grounds/i },
  },
  {
    code: 'FORM 204-01', revision: 'V1', title: 'Receiving Inspection Checklist',
    where: 'readydoc', match: { module: 'receiving-log' }, revisionFrom: 'checklist_revision',
  },

  /* ── Series 400 — quality system ─────────────────────────────────────── */
  // Read off the Master Index (V2, 2026-08). Marked "WHY IS THIS STILL NOT IN
  // USE" on the sheet, so it is listed as paper rather than claimed for
  // ReadyDoc — the register should say what is true, not what is intended.
  { code: 'FORM 402', revision: 'V2', title: 'Quality Assurance Incoming Raw Materials, Labels and Component Sampling', where: 'paper', note: 'Master Index queries whether this is still in use.' },
  { code: 'FORM 403-01', revision: 'V1', title: 'Internal Audit Checklist', where: 'readydoc', match: { module: 'internal-audits' }, revisionFrom: 'checklist_revision' },
  { code: 'FORM 404-1', revision: 'V2', title: 'Supplier Qualification Questionnaire', where: 'keychain' },
  { code: 'FORM 404-2', revision: 'V1', title: 'Raw Material Questionnaire Form', where: 'keychain' },
  { code: 'FORM 405-1', revision: 'V1', title: 'Product Release Form', where: 'keychain' },
  { code: 'FORM 405-02', revision: 'V1', title: 'Product Release Waiver (Pending Final QA Testing)', where: 'keychain' },
  { code: 'FORM 406-1', revision: 'V2', title: 'Document Change Request', where: 'readydoc', match: { module: 'document-control' } },
  { code: 'FORM 408-1', revision: 'V1', title: 'Non-Conformance Report', where: 'readydoc', match: { qmsType: 'non_conformance' } },
  { code: 'FORM 408-2', revision: 'V2', title: 'CAPA Report', where: 'readydoc', match: { module: 'capa' } },
  { code: 'FORM 409-1', revision: 'V2', title: 'Annual (cGMP) Training Quiz', where: 'readydoc', match: { module: 'training' } },
  { code: 'FORM 409-02', revision: 'V4', title: 'Training Form', where: 'readydoc', match: { module: 'training' } },
  { code: 'FORM 411-1', revision: 'V4', title: 'Disposal Form', where: 'readydoc', match: { module: 'disposals' } },
  { code: 'FORM 413-1', revision: 'V1', title: 'Manufacturing (Batch Production Record)', where: 'keychain' },
  { code: 'FORM 413-1 (X-Ray)', revision: 'V2', title: 'X-Ray Operation Record', where: 'keychain' },
  { code: 'FORM 413-2', revision: 'V1', title: 'Finished Product Specification Form', where: 'paper', note: 'Not yet supplied — needs access.' },
  { code: 'FORM 415-1', revision: 'V2', title: 'Recall Form', where: 'readydoc', match: { module: 'mock-recall' }, revisionFrom: 'checklist_revision' },

  /* Scale verification — FIVE FORMS, FIVE NUMBERS. Each defines its own
     nominal weights and tolerances, and 417-02 uses a different weight
     placement from the other four, so one number over all five would put five
     different acceptance criteria under a single identity. The revision comes
     from server/scale-forms.js, which is what the record is actually graded
     against. */
  { code: 'FORM 417-01', title: 'Scale Verification — Batching (Platform Scale)', where: 'readydoc', match: { scaleForm: '417-01' } },
  { code: 'FORM 417-02', title: 'Scale Verification — Batching (Pallet Scale)', where: 'readydoc', match: { scaleForm: '417-02' } },
  { code: 'FORM 417-03', title: 'Scale Verification — Stick Filling', where: 'readydoc', match: { scaleForm: '417-03' } },
  { code: 'FORM 417-04', title: 'Scale Verification — Filling', where: 'readydoc', match: { scaleForm: '417-04' } },
  { code: 'FORM 417-05', title: 'Scale Verification — Kitting', where: 'readydoc', match: { scaleForm: '417-05' } },

  { code: 'FORM 418-01', revision: 'V1', title: 'QA Film / Pouch Inspection Checklist', where: 'readydoc', match: { module: 'film-inspection' } },
  { code: 'FORM 418-02', revision: 'V1', title: 'Component Warehouse Sign Out', where: 'readydoc', match: { qmsType: 'component_sign_out' } },
  { code: 'FORM 419-01', revision: 'V1', title: 'Complaint Investigation Report', where: 'readydoc', match: { module: 'complaints' } },
  { code: 'FORM 424-01', revision: 'V2', title: 'On Hold Form', where: 'readydoc', match: { qmsType: 'on_hold' } },
  {
    code: 'FORM 431-01', revision: 'V5', title: 'Brittle Plastic and Glass Diagram',
    where: 'readydoc', match: { document: 'FORM 431-01' },
  },
  {
    code: 'FORM 431-02', revision: 'V5', title: 'Brittle Plastic and Glass Log',
    where: 'readydoc',
    match: { taskTitle: /^brittle plastic/i, sanitationArea: /^brittle plastic/i },
  },
  { code: 'FORM 438-01', revision: 'V1', title: 'Employee Grievance Complaint', where: 'paper', note: 'Marked "archive?" on the Master Index — confirm with Document Control.' },
  // Two numbers, two record types: the master list is the register of every
  // blade in the plant, the accountability form is one person taking one out
  // and bringing it back. Both matching `knife_accountability` would have made
  // the sign-out log answer to the master list's number.
  { code: 'FORM 440-01', revision: 'V2', title: 'Knife / Razor Blade / Scissors Master List', where: 'readydoc', match: { qmsType: 'knife_accountability' } },
  { code: 'FORM 440-02', revision: 'V2', title: 'Knife / Razor Blade / Scissors Accountability', where: 'readydoc', match: { qmsType: 'knife_sign_out' } },
  { code: 'FORM 442-01', revision: 'V1', title: 'Deviation Report', where: 'readydoc', match: { qmsType: 'deviation' } },

  /* ── Series 500 — safety and crisis ──────────────────────────────────── */
  { code: 'FORM 501-01', revision: 'V5', title: 'Crisis Management Contact List', where: 'readydoc', match: { module: 'safety' } },
  { code: 'FORM 501-02', revision: 'V1', title: 'Headcount Evacuation Form', where: 'readydoc', match: { module: 'safety' } },
  { code: 'FORM 502-01', revision: 'V1', title: 'First Aid Injury / Accident Form', where: 'readydoc', match: { module: 'safety' } },

  /* ── Series 600 — testing and environment ────────────────────────────── */
  { code: 'FORM 602-01', revision: 'V2', title: 'Organoleptic Sensory Test', where: 'readydoc', match: { qmsType: 'organoleptic' } },
  { code: 'FORM 604-01', revision: 'V1', title: 'Master Site List (EMP)', where: 'readydoc', match: { module: 'quality-schedules' } },

  /* ── Series 700 — chemicals, equipment, tools ────────────────────────── */
  { code: 'FORM 700-01', revision: 'V1', title: 'Approved Chemical List', where: 'readydoc', match: { module: 'chemicals' } },
  { code: 'FORM 700-02', revision: 'V1', title: 'Chemical Incident Log Template', where: 'readydoc', match: { module: 'chemicals' } },
  { code: 'FORM 702-01', revision: 'V3', title: 'Daily Forklift Inspection', where: 'readydoc', match: { taskTitle: /forklift/i } },
  {
    code: 'FORM 703-01', revision: 'V2', title: 'Equipment / Tool / Chemical Sign In-Out',
    where: 'readydoc', match: { qmsType: 'maintenance_sign_out' },
    note: 'Renamed from "Maintenance Sign-Out Sheet".',
  },
];

/** Everything worked in ReadyDoc, for the panel's default view. */
export const inReadyDoc = () => FORM_REGISTRY.filter(f => f.where === 'readydoc');

const testMatch = (pattern, value) =>
  !!pattern && !!value && (pattern instanceof RegExp ? pattern.test(String(value)) : String(pattern) === String(value));

// SPECIFICITY DECIDES, NOT POSITION IN THE ARRAY.
//
// A subject usually knows several things about itself at once: a light
// inspection record carries BOTH `sanitationArea: 'Light Inspection Zone 1'`
// and `module: 'sanitation'`. Walking the array once and returning the first
// entry that matched on anything would hand it FORM 108-03 (the Production
// Cleaning Log, which claims the whole sanitation module and is listed higher),
// and the zone forms below it could never be reached.
//
// So the passes run in order of how precisely each key identifies a form: an
// exact record type or scale code first, then a title pattern, then the
// module-wide fallback last. Within one pass array order still breaks ties,
// which is why the registry stays grouped by series and readable.
const MATCH_PASSES = ['qmsType', 'scaleForm', 'document', 'taskTitle', 'sanitationArea', 'module'];

/**
 * The form a thing satisfies, or null.
 *
 * `subject` carries whatever the caller knows — a task title, a QMS record
 * type, a sanitation area, a module id, a scale form code.
 */
export function formFor(subject = {}) {
  for (const key of MATCH_PASSES) {
    if (!subject[key]) continue;
    for (const f of FORM_REGISTRY) {
      if (f.match && testMatch(f.match[key], subject[key])) return f;
    }
  }
  return null;
}

/**
 * "FORM 431-02 V5" — what a card or a record header prints.
 *
 * `recordRevision` is the revision the RECORD itself stored when it was filed;
 * it wins over the registry's current one, so a record filed under V4 keeps
 * saying V4 after V5 is issued.
 */
export function formLabel(subject = {}, recordRevision = null) {
  const f = formFor(subject);
  if (!f) return null;
  const rev = recordRevision || f.revision;
  return rev ? `${f.code} ${rev}` : f.code;
}
