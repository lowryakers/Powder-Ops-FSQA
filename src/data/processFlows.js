// Process flows for the Auditor View.
//
// Two different questions, two different shapes:
//
//   FLOWS       "show me your process for X" — a record's life from the event
//               that starts it to the signature that closes it, naming the form
//               at each step and who does it. This is what an auditor asks for.
//
//   DEPARTMENTS "what does this person do" — everything one team owns, signs
//               and is scheduled for. Useful to an auditor, and more useful
//               day-to-day to the team itself.
//
// Deliberately DATA, not drawings. The renderer is a few dozen lines and every
// flow reads the same way, so adding one is an entry here rather than a design
// exercise. Keep the wording matched to what the app actually does — a process
// map that describes an aspiration is worse than none, because an auditor will
// test it.
//
// `form` is the controlled document or log the step is recorded on. `actor` is
// the role, never a person: people change jobs and the map shouldn't need
// editing when they do.

export const FLOWS = [
  {
    id: 'production',
    title: 'Production run → QA sign-off',
    summary: 'A shift is worked, recorded by the team that ran it, and countersigned by QA. Corrections are amendments, never overwrites.',
    steps: [
      { actor: 'Scheduler', action: 'Run is scheduled to a room and day', form: 'Production Schedule' },
      { actor: 'Operator / Lead', action: 'Shift is worked and the end-of-day report filed — product, MO, lot, quantity, people, times, plus the team\'s own EOD survey', form: 'Production Log' },
      { actor: 'System', action: 'Entry lands in QA Review as awaiting signature; a missed report raises a banner on the log', form: 'QA Review Center' },
      { actor: 'QA', action: 'Reviews and signs off. A note can be flagged "needs a correction", which authorises the filer to amend that one entry', form: 'Production Log · QA sign-off' },
      { actor: 'Filer', action: 'Amends if asked. The amendment is stamped, the QA signature retires to Pending, and the original values stay in the trail', form: 'Production Log · amendment trail', branch: true },
    ],
    close: 'Signed entry, with every amendment and the retired signature preserved.',
  },
  {
    id: 'flavor',
    title: 'Batch tasting → Flavor Approval + Organoleptic',
    summary: 'One taste test, two controlled records. The decision releases the batch; the sensory scores are the evaluation behind it.',
    steps: [
      { actor: 'Batching', action: 'Batch is made and a sample pulled', form: 'Production Log' },
      { actor: 'QA', action: 'Tastes the sample and checks appearance, odor, taste, color and texture against the product\'s written specification (pass / fail, with what was seen on a fail), plus any adjustment made to get it right. A product with no specification on file has its draft written by this first test, for a QA lead to approve', form: 'Flavor Approval Form' },
      { actor: 'System', action: 'On approve or deny, files the matching sensory record and links the two both ways', form: 'Organoleptic Sensory Test (602-01)' },
      { actor: 'System', action: 'Any attribute that does not match the specification raises a draft disposal for review', form: 'Disposal record', branch: true },
      { actor: 'Anyone', action: 'The decision shows against the run in the Production Log, matched on MO #', form: 'Production Log' },
    ],
    close: 'Approved or denied batch, an organoleptic record, and a disposal draft if it failed.',
  },
  {
    id: 'coa',
    title: 'Lab request → results → Powder Ops COA',
    summary: 'Specifications are set per item and test, so results grade themselves and the certificate is issued from graded data rather than retyped.',
    steps: [
      { actor: 'QA', action: 'Specifications are logged per item and test — limits, method, units', form: 'COA Specifications' },
      { actor: 'QA', action: 'Raises a lab request: item, lot, and the tests to run picked from the specification list', form: 'COA Lab Request' },
      { actor: 'Outside lab', action: 'Runs the panel and returns a certificate', form: 'Lab COA (uploaded)' },
      { actor: 'System', action: 'Extracts each result, matches it to the active spec for that item and test, and grades pass or fail; the request rolls up to an overall result', form: 'COA test results' },
      { actor: 'QA', action: 'Reviews, e-signs, and downloads the facility certificate on letterhead', form: 'Powder Ops COA (PDF)' },
    ],
    close: 'A graded, signed certificate traceable to the specification it was judged against.',
  },
  {
    id: 'sanitation',
    title: 'Cleaning → verification → re-clean rule',
    summary: 'Cleaning is scheduled, recorded by whoever did it, verified by QA, and a room left idle too long is flagged before it is used again.',
    steps: [
      { actor: 'System', action: 'Master sanitation schedule generates the day\'s cleaning tasks', form: 'PM / cleaning schedules' },
      { actor: 'Sanitation', action: 'Cleans and records chemical, concentration, contact time and rinse verification', form: 'Sanitation record' },
      { actor: 'QA', action: 'Verifies the clean; food-contact equipment additionally needs hygiene clearance before use', form: 'QA Review Center' },
      { actor: 'System', action: 'A room not cleaned within 72 hours is flagged for re-clean before production', form: 'Re-clean status', branch: true },
    ],
    close: 'A verified clean, with idle rooms surfaced before they are used.',
  },
  {
    id: 'receiving',
    title: 'Delivery → receiving inspection → release',
    summary: 'One arrival can be several lines. The inspection number groups them so a receipt reads as one event.',
    steps: [
      { actor: 'Carrier', action: 'Material arrives at the dock', form: '—' },
      { actor: 'Warehouse', action: 'Inspects and files a line per item: PO, lot, quantity, expiry, condition, packing slip', form: 'Receiving Log' },
      { actor: 'System', action: 'Issues the inspection number at write time; further lines can be added to the same open receipt', form: 'Receiving Log' },
      { actor: 'QA / Warehouse', action: 'Sets status of release — accepted, rejected, or held pending', form: 'Receiving Log · Status of Release' },
    ],
    close: 'A released or rejected receipt, traceable by inspection number, PO and lot.',
  },
  {
    id: 'deviation',
    title: 'Something went wrong → deviation → CAPA',
    summary: 'Filing is open to anyone who sees a problem. Everything after filing is records integrity.',
    steps: [
      { actor: 'Anyone', action: 'Reports what happened — product, lot, description, impact', form: 'Deviation (442-01) / Non-Conformance' },
      { actor: 'QA', action: 'Investigates, decides product disposition, and holds stock if needed', form: 'On Hold record', branch: true },
      { actor: 'QA / Management', action: 'Raises a corrective action with an owner and a due date', form: 'CAPA' },
      { actor: 'Approvers', action: 'Sign with an e-signature intent statement. Any signature closes the record to further edits', form: 'Record approvals' },
    ],
    close: 'A signed investigation, a disposition, and a corrective action being tracked to closure.',
  },
  {
    id: 'document',
    title: 'Document change → approval → retraining',
    summary: 'A controlled document only changes through Document Control, and a change that affects training reopens it.',
    steps: [
      { actor: 'Anyone', action: 'Requests a change to a controlled document', form: 'Document Change Request (406-1)' },
      { actor: 'Document Control', action: 'Reviews, revises the document and issues the new revision with an effective date', form: 'Controlled Documents' },
      { actor: 'System', action: 'A change to a form definition or an acceptance criterion is parked until Document Control approves it — the app keeps serving the approved version meanwhile', form: 'Controlled Changes', branch: true },
      { actor: 'Trainer', action: 'Retrains the affected people against the new revision; the completion records which revision it was against', form: 'Training records' },
    ],
    close: 'A current revision in the registry and training that matches it.',
  },
  {
    id: 'signout',
    title: 'Tool or chemical signed out → returned → countersigned',
    summary: 'The same transaction on two controlled forms, kept separate because an auditor asking for 440-02 must get exactly those.',
    steps: [
      { actor: 'Employee', action: 'Signs an item out, recording condition. Chemicals additionally require a use specification', form: '703-01 Equipment/Tool/Chemical · 440-02 Knife/Blade' },
      { actor: 'Anyone', action: '"Out now" shows everything currently signed out across both forms', form: 'Sign In/Out · Out now' },
      { actor: 'Employee', action: 'Returns it and records the outcome — returned, used up, damaged or lost', form: 'Return details' },
      { actor: 'System', action: '"Used up" raises a restock suggestion for the office rather than a supply request', form: 'Supply Orders · suggestions', branch: true },
      { actor: 'QA', action: 'Countersigns routine returns, in batches from the review queue', form: 'QA Review Center' },
    ],
    close: 'A closed sign-out with condition recorded both ways.',
  },
];

export const DEPARTMENTS = [
  {
    id: 'qa',
    name: 'Quality Assurance',
    owns: ['Flavor Approvals + Organoleptic', 'COA specifications and lab requests', 'Deviations, Non-Conformances, On Hold', 'Disposals', 'Mock Recall', 'QA Inspections (light, brittle plastic & glass, temp & humidity)'],
    signs: ['Production Log entries', 'Cleaning and sanitation records', 'Scale verifications', 'Sign-out returns (703-01, 440-02, 418-02)'],
    scheduled: ['Daily temp & humidity checks', 'Light inspections by zone', 'Brittle plastic & glass by zone', 'Quality schedules (e.g. monthly tap water testing)'],
  },
  {
    id: 'document_control',
    name: 'Document Control',
    owns: ['Controlled document registry (SOPs, WIs, job descriptions)', 'Document Change Requests', 'Controlled Changes — form definitions and acceptance criteria', 'Org chart'],
    signs: ['Document revisions and effective dates', 'Approval of parked form/criteria changes'],
    scheduled: ['Document review due dates'],
  },
  {
    id: 'production',
    name: 'Production — Batching, Filling, Kitting',
    owns: ['Production Log entries and end-of-day reports', 'Batch samples for tasting and retention'],
    signs: ['Their own shift reports', 'Amendments when QA flags a correction'],
    scheduled: ['The production schedule by room and day', 'Equipment PMs on their lines'],
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    owns: ['Receiving Log', 'Component sign in/out (418-02)', 'Inventory and shipping per WI001'],
    signs: ['Receiving inspections and status of release'],
    scheduled: ['Forklift and pallet jack certification (three-yearly)', 'Warehouse PMs'],
  },
  {
    id: 'cleaning',
    name: 'Sanitation',
    owns: ['Sanitation records', 'Chemical dilution verification', 'Cleaning work instructions (WI012, WI018)'],
    signs: ['Their own cleaning records, verified by QA'],
    scheduled: ['Master sanitation schedule', '72-hour idle re-clean rule'],
  },
  {
    id: 'maintenance',
    name: 'Maintenance',
    owns: ['Equipment register', 'Lockout/Tagout procedures', 'Calibration instruments and records'],
    signs: ['Work order completion and readings'],
    scheduled: ['Preventive maintenance by equipment', 'Calibration due dates', 'Daily scale verification (417-01…05)'],
  },
  {
    id: 'office',
    name: 'Office & Management',
    owns: ['Supply orders and invoices', 'Time tracking and pay', 'Accounts payable and receivable', 'Newsletter'],
    signs: ['Supply order approvals', 'Time adjustments'],
    scheduled: ['Weekly data backup', 'Certification expiry monitoring'],
  },
];
