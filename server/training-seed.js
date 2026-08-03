import { v4 as uuid } from 'uuid';

// Standard food-manufacturing training catalog aligned to GMP / SQF 2.9
// (training program, competency, role-based requirements, refresher cadence).
// required_roles / required_departments empty ⇒ required of ALL active staff.
// retrain_months: 12 = annual, 24 = biennial, null = one-time.
const COURSES = [
  { code: 'ONB-101', title: 'New Hire Food Safety Orientation', category: 'Onboarding', retrain_months: null, roles: [], depts: [], has_test: false,
    description: 'Facility orientation covering site rules, food safety expectations, GMP basics, and emergency procedures. Completed before starting on the floor.' },
  { code: 'GMP-101', title: 'Good Manufacturing Practices (GMP)', category: 'GMP', retrain_months: 12, roles: [], depts: [], has_test: true,
    description: 'Core GMP requirements: personal hygiene, hand washing, jewelry/clothing policy, eating/drinking rules, and facility conduct.' },
  { code: 'HYG-101', title: 'Personal Hygiene & PPE', category: 'GMP', retrain_months: 12, roles: [], depts: [], has_test: false,
    description: 'Hygiene practices, gowning, hairnets/beard nets, glove use, and PPE requirements in production areas.' },
  { code: 'ALG-101', title: 'Allergen Awareness & Control', category: 'Allergen', retrain_months: 12, roles: [], depts: [], has_test: true,
    description: 'The major allergens, cross-contact prevention, allergen changeover/cleaning, labeling, and segregation.' },
  { code: 'FS-101', title: 'Food Safety & HACCP Awareness', category: 'Food Safety', retrain_months: 12, roles: [], depts: [], has_test: false,
    description: 'Introduction to hazards (biological, chemical, physical), CCPs, and each employee’s role in the food safety plan.' },
  { code: 'FD-101', title: 'Food Defense & Intentional Adulteration', category: 'Food Defense', retrain_months: 12, roles: [], depts: [], has_test: true,
    description: 'Food defense awareness, recognizing and reporting suspicious activity, and site security expectations.' },
  { code: 'SAN-101', title: 'Sanitation & SSOP', category: 'Sanitation', retrain_months: 12, roles: [], depts: ['cleaning', 'production'], has_test: false,
    description: 'Master sanitation, SSOPs, cleaning/sanitizing procedures, and verification of clean equipment.' },
  { code: 'CHEM-101', title: 'Chemical Handling & HazCom', category: 'Safety', retrain_months: 12, roles: [], depts: ['cleaning', 'warehouse', 'production', 'maintenance'], has_test: false,
    description: 'Safe handling, storage, and labeling of chemicals; SDS access; approved-chemical program.' },
  { code: 'RECALL-101', title: 'Recall, Traceability & Withdrawal', category: 'Food Safety', retrain_months: 12, roles: ['admin', 'supervisor'], depts: ['qa', 'warehouse'], has_test: false,
    description: 'Lot traceability, mock recall procedure, and roles during a recall or market withdrawal.' },
  { code: 'HACCP-201', title: 'HACCP Principles (HACCP Team)', category: 'HACCP', retrain_months: 24, roles: ['admin', 'supervisor'], depts: ['qa'], has_test: false,
    description: 'The seven HACCP principles, hazard analysis, CCP determination, and reassessment — for HACCP team members.' },
];

// Authorable starter tests. type: multiple_choice | true_false. correct is the
// index into options (or 'true'/'false'). These are templates — edit freely.
const TESTS = {
  'GMP-101': {
    title: 'GMP Basics Quiz', passing_score: 80,
    questions: [
      { type: 'true_false', prompt: 'Hand washing is required after using the restroom, before starting work, and after breaks.', options: ['True', 'False'], correct: 'true' },
      { type: 'multiple_choice', prompt: 'Which of the following is permitted in a production area?', options: ['Wearing a wristwatch', 'Chewing gum', 'A properly worn hairnet and beard net', 'Open beverage containers'], correct: '2' },
      { type: 'true_false', prompt: 'Jewelry such as rings and earrings may be worn on the production floor as long as it is clean.', options: ['True', 'False'], correct: 'false' },
      { type: 'multiple_choice', prompt: 'If you notice a hygiene or GMP violation, you should:', options: ['Ignore it', 'Report it to your supervisor', 'Wait until the next audit', 'Fix it only if you have time'], correct: '1' },
    ],
  },
  'ALG-101': {
    title: 'Allergen Awareness Quiz', passing_score: 80,
    questions: [
      { type: 'multiple_choice', prompt: 'Which is NOT one of the major food allergens?', options: ['Milk', 'Peanuts', 'Black pepper', 'Soy'], correct: '2' },
      { type: 'true_false', prompt: 'Cross-contact happens when an allergen is unintentionally transferred to a food that should not contain it.', options: ['True', 'False'], correct: 'true' },
      { type: 'multiple_choice', prompt: 'The best way to prevent allergen cross-contact during a changeover is to:', options: ['Wipe with a dry cloth', 'Perform a validated allergen cleaning', 'Run the line faster', 'Do nothing if the next product is similar'], correct: '1' },
    ],
  },
  'FD-101': {
    title: 'Food Defense Quiz', passing_score: 80,
    questions: [
      { type: 'true_false', prompt: 'Food defense protects the food supply from intentional contamination or adulteration.', options: ['True', 'False'], correct: 'true' },
      { type: 'multiple_choice', prompt: 'If you see an unknown person in a restricted production area, you should:', options: ['Assume they belong there', 'Report it to a supervisor immediately', 'Take a photo for later', 'Leave the area'], correct: '1' },
      { type: 'true_false', prompt: 'Leaving exterior doors propped open is acceptable when the weather is warm.', options: ['True', 'False'], correct: 'false' },
    ],
  },
};

// ── The plant's own Work Instructions ────────────────────────────────────────
//
// The catalog above is the standard GMP/SQF program. These are Powder Ops'
// machine and area Work Instructions — the trainings the historical Training
// Log has been recording for three years under headings like "Mixer (WI)" and
// "Warehouse (WI)". Without them those columns have nothing to import into.
//
// **The course code IS the document number.** An auditor asking "show me who
// is trained on WI007" gets a straight answer, and the course can't drift away
// from the document it teaches.
//
// Cadence is deliberately one-time + retrain-on-revision rather than annual:
// being retrained because the work instruction changed is the rule these
// documents actually imply, and inventing an annual requirement would put
// everyone overdue on a date nobody agreed to. Set a cadence per course in
// Training → Courses if the program calls for one.
const WI_COURSES = [
  { code: 'WI001', title: 'Warehouse Operations', category: 'Other', depts: ['warehouse'],
    description: 'Warehouse shipping, receiving and inventory per WI001: order management, picking and packing, weighing and carrier selection, pre-receiving prep, counting and inspection, documentation, storage, and inventory audits.' },
  { code: 'WI003', title: 'Volumetric Stick Pack Machine', category: 'Other', depts: ['filling'],
    description: 'Operating the volumetric dual-lane stick pack machine per WI003: loading film for each lane, forming tubes, calibrating the volumetric filler, monitoring seals and cuts, sampling beginning/middle/end from every super sack, and shutdown.' },
  { code: 'WI004', title: 'Hand Filling', category: 'Other', depts: ['filling'],
    description: 'Hand filling and pouch packing per WI004: tare and fill to weight, heat seal, inspect the seal, verify lot code and Best By date, batch identification across super sacks, and retention/lab sampling.' },
  { code: 'WI007', title: 'Auger Stick Pack Machine', category: 'Other', depts: ['filling'],
    description: 'Operating the auger stick pack machine per WI007: film loading and tensioning, HMI parameters, auger filler dosing, vertical and horizontal sealing, cutting, discharge, and troubleshooting sensor alarms.' },
  { code: 'WI012', title: 'Cleaning the Auger Stick Pack Machine', category: 'Sanitation', depts: ['filling', 'cleaning'],
    description: 'Cleaning the auger stick pack machine per WI012: shutdown with lockout/tagout and zero-energy verification, disassembly into labeled tubs, washing and sanitizing product-contact parts, clean-in-place, wear inspection, and reassembly with a test cycle.' },
  { code: 'WI018', title: 'Cleaning the Hexagon Tumbler Mixer', category: 'Sanitation', depts: ['batching', 'cleaning'],
    description: 'Cleaning the hexagon tumbler mixer per WI018: pre-cleaning shutdown, lid and gasket cleaning, clean-in-place of shell and frame, seal and latch inspection, and reassembly with a seal check before startup.' },
  { code: 'WI021', title: 'Hexagon Tumbler Mixer Operation', category: 'Other', depts: ['batching'],
    description: 'Operating the hexagon tumbler mixer per WI021: pre-use checks and discharge valve lockout, loading super sacks by forklift, pre-run guard and lid checks, timed mixing, stop vs E-stop use, and controlled discharge.' },
  // Not a work instruction — a standing safety awareness training the log has
  // recorded as "FIRE DRILL Fire extinguisher, and exits". Annual, because
  // emergency-response awareness is one of the few things that genuinely is.
  { code: 'SAF-201', title: 'Fire Extinguisher & Emergency Exit Awareness', category: 'Safety',
    depts: [], retrain_months: 12, has_test: true,
    description: 'Emergency evacuation and fire extinguisher awareness: alarm response, keeping exit routes clear, the PASS technique, when NOT to fight a fire, primary/secondary exits and the assembly point.' },
];

// The plant's own test, transcribed from the signed document (answer key
// included) rather than generated — this is the paper people already take.
const WI_TESTS = {
  'SAF-201': {
    title: 'Fire Extinguisher and Emergency Exit Awareness TEST', passing_score: 80,
    questions: [
      { type: 'multiple_choice', prompt: 'What should you do first when you hear the fire alarm?', options: ['Finish your task first', 'Evacuate using the nearest safe exit', 'Look for the source of the fire', 'Hide in an office'], correct: '1' },
      { type: 'multiple_choice', prompt: 'Why must exit routes stay clear at all times?', options: ['To make the hallway look neat', 'To allow fast and safe evacuation', 'To store emergency equipment', 'To keep doors closed'], correct: '1' },
      { type: 'multiple_choice', prompt: 'What does PASS stand for?', options: ['Pull, Aim, Squeeze, Sweep', 'Push, Alert, Secure, Shut', 'Protect, Assist, Stop, Stand', 'Pull, Activate, Spray, Stop'], correct: '0' },
      { type: 'multiple_choice', prompt: 'When should you not attempt to use a fire extinguisher?', options: ['When the fire is small and contained', 'When you are trained and the exit is clear', 'When the fire is large, smoky, or your exit is blocked', 'When the extinguisher is near the exit'], correct: '2' },
      { type: 'multiple_choice', prompt: 'What is the purpose of the assembly point?', options: ['To store supplies', 'To take attendance after evacuation', 'To wait for lunch break', 'To inspect equipment'], correct: '1' },
      { type: 'true_false', prompt: 'All employees should try to fight a fire before evacuating.', options: ['True', 'False'], correct: 'false' },
      { type: 'multiple_choice', prompt: 'How can competency be verified for this training?', options: ['Only by years of service', 'By quiz, observation, or return demonstration', 'By verbal reminder only', 'By job title only'], correct: '1' },
      { type: 'multiple_choice', prompt: 'What should you do if you notice a blocked exit?', options: ['Ignore it', 'Move it only if convenient', 'Report it immediately', 'Place a sign over it'], correct: '2' },
      { type: 'multiple_choice', prompt: 'Who should use a fire extinguisher?', options: ['Any employee who wants to try', 'Only trained employees and only if it is safe', 'Only supervisors', 'Only maintenance staff'], correct: '1' },
      { type: 'multiple_choice', prompt: 'What should employees know before an emergency occurs?', options: ['Where the coffee machine is', 'The primary and secondary exits and the assembly point', 'The inventory count', 'The shipping schedule'], correct: '1' },
    ],
  },
};

/**
 * Add the plant's Work Instruction courses, one at a time and keyed on the
 * document number.
 *
 * Deliberately NOT the all-or-nothing guard `seedTrainingCourses` uses: that
 * one bails the moment the catalog is non-empty, so it can never introduce a
 * course again. This runs on every boot and adds only what is missing.
 *
 * A course whose code is already present is left completely alone — an edited
 * title, a cadence someone set, or a course retired with `active = 0` are all
 * decisions, and a redeploy must not undo them. Courses are retired rather
 * than deleted, so the row survives to say "don't re-add me".
 */
export function seedWorkInstructionCourses(db) {
  const find = db.prepare('SELECT id FROM training_courses WHERE code = ?');
  const insCourse = db.prepare(`INSERT INTO training_courses
    (id, code, title, category, description, retrain_months, required_roles, required_departments, has_test, passing_score, active)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 80, 1)`);
  const insTest = db.prepare('INSERT INTO training_tests (id, course_id, version, title, passing_score, is_current) VALUES (?, ?, 1, ?, ?, 1)');
  const insQ = db.prepare('INSERT INTO training_questions (id, test_id, position, type, prompt, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');

  let added = 0, tests = 0;
  db.transaction(() => {
    for (const c of WI_COURSES) {
      if (find.get(c.code)) continue;
      const courseId = uuid();
      insCourse.run(courseId, c.code, c.title, c.category, c.description,
        c.retrain_months ?? null, JSON.stringify(c.depts), c.has_test ? 1 : 0);
      added++;
      const t = WI_TESTS[c.code];
      if (c.has_test && t) {
        const testId = uuid();
        insTest.run(testId, courseId, t.title, t.passing_score);
        t.questions.forEach((q, i) =>
          insQ.run(uuid(), testId, i, q.type, q.prompt, JSON.stringify(q.options), String(q.correct)));
        tests++;
      }
    }
  })();
  if (added) console.log(`[seed] Added ${added} Work Instruction training course(s)${tests ? `, ${tests} with the plant's own test` : ''}`);
}

export function seedTrainingCourses(db) {
  const existing = db.prepare('SELECT COUNT(*) c FROM training_courses').get().c;
  if (existing > 0) return;

  const insCourse = db.prepare(`INSERT INTO training_courses
    (id, code, title, category, description, retrain_months, required_roles, required_departments, has_test, passing_score, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 80, 1)`);
  const insTest = db.prepare('INSERT INTO training_tests (id, course_id, version, title, passing_score, is_current) VALUES (?, ?, 1, ?, ?, 1)');
  const insQ = db.prepare('INSERT INTO training_questions (id, test_id, position, type, prompt, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');

  const tx = db.transaction(() => {
    for (const c of COURSES) {
      const courseId = uuid();
      insCourse.run(courseId, c.code, c.title, c.category, c.description, c.retrain_months,
        JSON.stringify(c.roles), JSON.stringify(c.depts), c.has_test ? 1 : 0);
      const t = TESTS[c.code];
      if (c.has_test && t) {
        const testId = uuid();
        insTest.run(testId, courseId, t.title, t.passing_score);
        t.questions.forEach((q, i) =>
          insQ.run(uuid(), testId, i, q.type, q.prompt, JSON.stringify(q.options), String(q.correct)));
      }
    }
  });
  tx();
  console.log(`[seed] Seeded ${COURSES.length} training courses (${Object.keys(TESTS).length} with starter tests)`);
}
