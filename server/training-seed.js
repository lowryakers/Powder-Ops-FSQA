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
  // Powered industrial trucks. Both are three-yearly because 29 CFR
  // 1910.178(l)(4)(iii) requires the operator's performance to be evaluated at
  // least once every three years — and the plant's own quiz answers Q17 the
  // same way. This is the one cadence here taken from a rule rather than a
  // guess, so it is set rather than left to the user.
  { code: 'FORK-101', title: 'Forklift Safety & Certification', category: 'Safety',
    depts: ['warehouse', 'batching'], retrain_months: 36, has_test: true,
    description: 'Powered industrial truck operation under 29 CFR 1910.178: forklift characteristics, load centre and centre of gravity, the stability triangle, load handling, pre-shift inspection, trailer and dock safety, travelling on ramps, refuelling and battery changing, and safe mounting and dismounting.' },
  { code: 'PJ-101', title: 'Electric Pallet Jack Safety', category: 'Safety',
    depts: ['warehouse'], retrain_months: 36, has_test: false,
    description: 'Powered pallet jack operation: three-wheel design and the rear drive/brake wheel, the steering-handle controls, stopping by "plugging" and its tipping risk, walkie vs walkie-rider types, and the requirement to be checked out on the specific machine. Pre-use inspection to a company checklist (brakes, controls, emergency switch) with repairs before use. Safe operation: forks lowered, squared and wide enough, load centred and within rated capacity, extra caution on high-lift carriages, all body parts inside the vehicle boundaries, facing the direction of travel, one hand on the controls, horn where needed, wide turns, no riders, no pushing or pulling other loads or vehicles, no raising or lowering while moving, and a complete stop before stepping off.' },
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
  // The plant's own Forklift Safety Quiz, both languages, graded against the
  // MASTER KEY sheet that shipped with it. The Spanish is the plant's own
  // wording carried into prompt_es/options_es rather than machine-translated —
  // a translation of a safety test is not the test people signed. Accents and
  // a handful of plain misspellings ("Obretos", "montecargas", "programodo",
  // "desconetar", "obtacles") were corrected; no answer or meaning changed.
  'FORK-101': {
    title: 'Forklift Safety Quiz · Prueba de Seguridad con Montacargas', passing_score: 80,
    questions: [
      { type: 'multiple_choice', correct: '3',
        prompt: 'Who can operate forklifts?', prompt_es: '¿Quiénes pueden operar un montacargas?',
        options: ['Truck drivers.', 'Supervisors.', 'Any employee on duty.', 'Trained and authorized workers.'],
        options_es: ['Choferes de camión.', 'Supervisores.', 'Cualquier empleado de turno.', 'Obreros entrenados y autorizados.'] },
      { type: 'multiple_choice', correct: '0',
        prompt: 'How many people can ride on a forklift?', prompt_es: '¿Cuánta gente puede ir en un montacargas?',
        options: ['Only the operator, unless the truck is equipped for passengers.', 'The operator plus any other authorized operator.', 'Up to three if reasonable hand holds are available.', 'There is no pre-determined limit.'],
        options_es: ['Solo el operador, a menos que el montacargas esté hecho para pasajeros.', 'El operador más cualquier otro operador autorizado.', 'Hasta tres si hay manijas adecuadas disponibles.', 'No hay límite predeterminado.'] },
      { type: 'multiple_choice', correct: '3',
        prompt: 'The "stability triangle" is used to describe:', prompt_es: 'Se usa el "triángulo de estabilidad" para describir:',
        options: ['The forklift suspension system.', 'The proper way for getting on and off a forklift.', 'A method for making a "three point turn" with rear steering.', 'How the unit/load center of gravity can tip over a forklift.'],
        options_es: ['El sistema de suspensión del montacargas.', 'La manera correcta de entrar y salir del montacargas.', 'Un método para dar una "vuelta de tres puntos" con las ruedas traseras.', 'Cómo el centro de gravedad de la unidad/carga puede hacer volcar al montacargas.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: 'How often should operators inspect their forklift?', prompt_es: '¿Cuán a menudo deben los operadores revisar su montacargas?',
        options: ['Hourly.', 'Weekly.', 'Every shift.', 'Monthly.'],
        options_es: ['Cada hora.', 'Cada semana.', 'Cada turno.', 'Cada mes.'] },
      { type: 'multiple_choice', correct: '1',
        prompt: 'Who has the right-of-way?', prompt_es: '¿Quién tiene derecho a la vía?',
        options: ['The largest forklift.', 'Pedestrians.', 'Forklifts approaching from the right.', 'Forklifts in the main aisle.'],
        options_es: ['El montacargas más grande.', 'Los peatones.', 'Los montacargas que vienen por la derecha.', 'Los montacargas en el pasillo principal.'] },
      { type: 'multiple_choice', correct: '0',
        prompt: 'What is the first thing to do before driving into a trailer?', prompt_es: '¿Qué se debe hacer primero antes de entrar en un tráiler?',
        options: ['Check that the trailer is secured with chocks or another locking mechanism.', 'Raise the forks high enough to clear the dock plate.', 'Turn on available lighting.', 'Advise dock supervisor that you are entering the trailer.'],
        options_es: ['Ver si el tráiler está asegurado con trancas u otros mecanismos de seguridad.', 'Alzar las puntas lo justo para pasar la plancha del muelle.', 'Encender las luces.', 'Avisar al supervisor del muelle que va a entrar en el tráiler.'] },
      { type: 'multiple_choice', correct: '1',
        prompt: 'How high should a load be carried?', prompt_es: '¿Qué tan alto se debe llevar una carga?',
        options: ['Low enough to see over.', 'As low as possible, preferably 2 to 4 inches off the ground.', 'High enough to clear obstacles in your path.', 'High enough to see under.'],
        options_es: ['Lo suficientemente bajo para ver por encima.', 'Lo más bajo posible, preferiblemente de 2 a 4 pulgadas del piso.', 'Lo suficientemente alto para evitar objetos a su paso.', 'Lo suficientemente alto para ver por debajo.'] },
      { type: 'multiple_choice', correct: '3',
        prompt: 'When traveling down a ramp or incline:', prompt_es: 'Al bajar una rampa o declive:',
        options: ['Avoid turning if possible.', 'Back up when loaded.', 'Back down when loaded.', 'Both A. and C.'],
        options_es: ['Evite girar si es posible.', 'Vaya marcha atrás hacia arriba cuando esté cargado.', 'Vaya marcha atrás hacia abajo cuando esté cargado.', 'A. y C.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: 'How soon should repairs be made to a forklift?', prompt_es: '¿Qué tan pronto se debe reparar un montacargas?',
        options: ['As soon as possible.', 'At the next scheduled maintenance time.', 'Before the unit is used.', 'At the end of your shift.'],
        options_es: ['En cuanto sea posible.', 'En el próximo mantenimiento programado.', 'Antes de usar la unidad.', 'Al final de su turno.'] },
      { type: 'multiple_choice', correct: '3',
        prompt: 'When is it OK to travel with a load raised more than a few inches?', prompt_es: '¿Cuándo está bien ir con la carga elevada más de unas pocas pulgadas?',
        options: ['Whenever there is sufficient clearance.', 'Whenever you know the floor to be free of bumps.', 'Whenever you need to see under the load.', 'Never.'],
        options_es: ['Cuando haya suficiente espacio.', 'Cuando sepa que el piso está libre de irregularidades.', 'Cuando necesite ver bajo la carga.', 'Nunca.'] },
      { type: 'multiple_choice', correct: '0',
        prompt: 'The minimum distance the forks should extend into a pallet is:', prompt_es: '¿Cuál es la distancia mínima que las puntas deben entrar en una paleta?',
        options: ['All the way.', 'Half way.', 'Quarter way.', 'Far enough to balance the load.'],
        options_es: ['Al fondo.', 'A medias.', 'Una cuarta parte.', 'Lo suficiente para equilibrar la carga.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: 'When should an operator raise or lower a load?', prompt_es: '¿Cuándo debe un operador subir o bajar una carga?',
        options: ["As soon as it's secure on the tines.", 'When approaching the lift.', 'Only while stopped.', 'When necessary to improve load balance.'],
        options_es: ['Apenas esté segura en las puntas.', 'Al acercarse a levantar.', 'Solo al estar detenido.', 'Cuando sea necesario mejorar el equilibrio de la carga.'] },
      { type: 'multiple_choice', correct: '1',
        prompt: 'Who is responsible for verifying the security of a trailer before loading or unloading?', prompt_es: '¿Quién es responsable de verificar la seguridad de un tráiler antes de cargar o descargar?',
        options: ['The dock supervisor.', 'The forklift operator.', 'The truck driver.', 'Whoever the company designates.'],
        options_es: ['El supervisor del muelle.', 'El operador del montacargas.', 'El camionero.', 'Quien sea que la compañía señale.'] },
      { type: 'multiple_choice', correct: '0',
        prompt: 'Training on one type of vehicle:', prompt_es: 'El entrenarse en un tipo de vehículo:',
        options: ['Qualifies the operator for that type of vehicle.', 'Is sufficient for all company forklifts.', 'Should be done every three years.', 'Should be done every five years.'],
        options_es: ['Acredita al operador en ese tipo de vehículo.', 'Es suficiente para todo montacargas de la compañía.', 'Se debe realizar cada tres años.', 'Se debe realizar cada cinco años.'] },
      { type: 'multiple_choice', correct: '3',
        prompt: 'A forklift is "unattended" and must be shut off with the controls neutralized and the brakes set when:', prompt_es: 'Un montacargas está "sin atender" y debe apagarse con los controles en neutral y los frenos puestos cuando:',
        options: ['The operator is within sight.', 'The operator is out of sight.', 'The operator is more than 25 feet away.', 'Either B. or C.'],
        options_es: ['El operador está a la vista.', 'El operador no está a la vista.', 'El operador está a más de 8 metros de distancia.', 'Ya sea B. o C.'] },
      { type: 'multiple_choice', correct: '0',
        prompt: 'The first thing to do when changing the battery or refueling:', prompt_es: 'Lo primero que se debe hacer al cambiar la batería o poner combustible:',
        options: ['Shut off the engine.', 'Disconnect fuel lines or battery cables.', 'Put on correct personal protective equipment.', 'Depends on the unit.'],
        options_es: ['Apagar el motor.', 'Desconectar el combustible o los cables de la batería.', 'Ponerse el equipo protector personal correcto.', 'Depende de la unidad.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: "A forklift operator's performance must be evaluated:", prompt_es: 'Se debe evaluar el trabajo del operador del montacargas:',
        options: ['Monthly.', 'Yearly.', 'Every three years.', 'Every five years.'],
        options_es: ['Cada mes.', 'Cada año.', 'Cada tres años.', 'Cada cinco años.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: 'When mounting or dismounting a forklift:', prompt_es: 'Al subir o bajar de un montacargas:',
        options: ['Face away from the forklift.', 'Face toward the forklift.', 'Use three points of contact.', 'Jump on or off.'],
        options_es: ['No mire hacia el montacargas.', 'Mire hacia el montacargas.', 'Use tres puntos de contacto.', 'Brinque para subir o bajar.'] },
      { type: 'multiple_choice', correct: '2',
        prompt: 'You can get under a raised load:', prompt_es: 'Usted puede estar bajo una carga alzada:',
        options: ['To check for debris that may fall off.', 'To be sure that the fork position is correct.', 'Never get under a raised load.', 'Whenever it is necessary.'],
        options_es: ['Para ver escombros que hayan caído.', 'Para asegurarse que las puntas estén bien.', 'No se ponga nunca bajo una carga alzada.', 'Cuando sea necesario.'] },
      { type: 'multiple_choice', correct: '1',
        prompt: 'Gas or diesel spills:', prompt_es: 'Derrames de gas o diésel:',
        options: ['Are not a problem as they will evaporate quickly.', 'Should be cleaned up immediately following proper safety procedures.', 'May explode so remove the forklift from the area.', 'None of the above.'],
        options_es: ['No son problema porque se evaporan enseguida.', 'Se deben limpiar enseguida siguiendo normas apropiadas de seguridad.', 'Pueden explotar, retire el montacargas de la zona.', 'Ninguna de las respuestas indicadas.'] },
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
  // prompt_es / options_es carry the plant's OWN Spanish where a test has it.
  // The floor is bilingual; a safety test people can't read is not a control.
  const insQ = db.prepare(`INSERT INTO training_questions
    (id, test_id, position, type, prompt, prompt_es, options, options_es, correct_answer, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

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
          insQ.run(uuid(), testId, i, q.type, q.prompt, q.prompt_es || null,
            JSON.stringify(q.options), q.options_es ? JSON.stringify(q.options_es) : null,
            String(q.correct)));
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
