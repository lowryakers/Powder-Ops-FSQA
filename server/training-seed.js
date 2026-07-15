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
