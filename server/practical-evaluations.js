// The second half of a powered-industrial-truck certification: watching
// somebody actually drive the thing.
//
// WHAT WAS MISSING. FORK-101 shipped with the plant's own twenty-question
// written quiz and nothing else, so passing it filed a completion and the
// matrix read "trained". 29 CFR 1910.178(l)(2)(ii) asks for three things —
// formal instruction, practical training, AND an evaluation of the operator's
// performance in the workplace — and (l)(6) says the employer shall CERTIFY
// that each operator has been trained and evaluated. A written pass on its own
// is one of the three, recorded as though it were all of them.
//
// THE FORM IS DRAFTED, NOT TRANSCRIBED, AND EVERY RECORD SAYS SO. The plant
// has no issued practical-evaluation form — the Master Index has nothing and
// no such document was supplied — so the items below are drawn from the
// standard's own topic list at (l)(3) rather than invented, and every record
// is stamped DRAFT-1 with an amber note on screen. The shipping truck
// inspection (D-052) is the worked precedent: the warehouse needs the record
// now, and when Document Control issues the form the code takes its number,
// `controlled.js` parks the change, and DRAFT-1 records are never re-stamped.
// The DCR draft is docs/v2/queued/dcr-forklift-practical-evaluation.md.
//
// **Do not "tidy" this wording without telling Document Control** — once it is
// issued it is theirs, exactly as with the shipping checklist.
//
// PURE: definitions in, verdicts out. No Express and no database, so what a
// certificate asserts about somebody's competence can be checked without
// standing up a server — the same doctrine as coa-submission.js and
// partner-recon.js.

export const EVALUATION_REVISION = 'DRAFT-1';

/** What an evaluator may say about one task. */
export const RESULTS = {
  competent: { label: 'Competent', label_es: 'Competente', passes: true },
  needs_practice: { label: 'Needs practice', label_es: 'Necesita práctica', passes: false },
  // NOT A PASS AND NOT A FAIL. A plant that does not load trailers this week
  // cannot demonstrate trailer entry, and recording that as competence would
  // be the fabricated-record refusal in a new place. It needs a note and it is
  // PRINTED ON THE CERTIFICATE by name, so an auditor reads exactly what was
  // and was not observed rather than having to assume.
  not_evaluated: { label: 'Not evaluated', label_es: 'No evaluado', passes: true, needsNote: true },
};
export const RESULT_KEYS = Object.keys(RESULTS);

// Truck classes the plant might evaluate on. The evaluation is per TRUCK TYPE
// because 1910.178(l)(4)(ii)(D) makes being assigned a different type of truck
// a trigger for refresher training — a certification that does not say which
// machine it was earned on cannot answer that.
export const TRUCK_TYPES = [
  'Sit-down counterbalance (Class IV/V)',
  'Stand-up reach truck (Class II)',
  'Order picker (Class II)',
  'Motorised hand/rider pallet truck (Class III)',
  'Other — describe',
];

const PC = (key, label, label_es) => ({ key, label, label_es });

/**
 * The evaluations this app knows how to run, keyed on the COURSE CODE.
 *
 * THERE IS NO `requires_practical` COLUMN, deliberately. A course requires an
 * evaluation exactly when there is a form here for it — one owner, nothing to
 * keep in step, and no way for a seeded flag and a missing form to disagree.
 * It is an explicit list rather than "every safety course", because whether
 * the pallet-jack course needs one is the plant's decision and no material for
 * it was supplied (the FLAVOURLESS_LINES rule).
 */
export const EVALUATIONS = {
  'FORK-101': {
    course_code: 'FORK-101',
    // No issued number yet — Document Control's to assign. Stamped null rather
    // than borrowed from another form, or a record would cite a number that
    // does not cover it.
    form_code: null,
    revision: EVALUATION_REVISION,
    title: 'Forklift Operator Practical Evaluation',
    title_es: 'Evaluación Práctica del Operador de Montacargas',
    basis: '29 CFR 1910.178(l)(2)(ii) and (l)(3) — practical training and evaluation of the operator’s performance in the workplace.',
    sections: [
      { key: 'inspection', label: 'Pre-use inspection', label_es: 'Inspección antes del uso', items: [
        PC('daily_check', 'Completes the daily inspection before use and records it', 'Hace la inspección diaria antes de usarlo y la registra'),
        PC('fluids_tyres', 'Checks fluids, tyres, forks, chains and the mast for damage', 'Revisa fluidos, llantas, horquillas, cadenas y el mástil por daños'),
        PC('controls_horn', 'Checks brakes, steering, horn, lights and the seat belt', 'Revisa frenos, dirección, claxon, luces y el cinturón'),
        PC('reports_defects', 'Takes the truck out of service and reports any defect before use', 'Saca el montacargas de servicio y reporta cualquier defecto antes de usarlo'),
      ] },
      { key: 'operation', label: 'Starting and controls', label_es: 'Arranque y controles', items: [
        PC('mount', 'Mounts and dismounts using three points of contact, never jumping', 'Sube y baja con tres puntos de contacto, sin saltar'),
        PC('seatbelt', 'Fastens the seat belt and keeps all body parts inside the truck', 'Se abrocha el cinturón y mantiene el cuerpo dentro del montacargas'),
        PC('smooth', 'Starts, accelerates, steers and stops smoothly and under control', 'Arranca, acelera, gira y frena suave y con control'),
      ] },
      { key: 'travel', label: 'Travelling', label_es: 'Manejo', items: [
        PC('fork_height', 'Travels with the forks low, 2 to 4 inches off the floor, and tilted back', 'Maneja con las horquillas bajas, de 2 a 4 pulgadas del piso e inclinadas hacia atrás'),
        PC('speed', 'Keeps to a safe speed for the surface and the load', 'Mantiene una velocidad segura para el piso y la carga'),
        PC('visibility', 'Travels in reverse when the load blocks the view forward', 'Maneja en reversa cuando la carga tapa la vista al frente'),
        PC('intersections', 'Sounds the horn and slows at corners, doorways and blind spots', 'Toca el claxon y baja la velocidad en esquinas, puertas y puntos ciegos'),
        PC('pedestrians', 'Yields to pedestrians and keeps a safe distance from people and racking', 'Cede el paso a los peatones y guarda distancia de las personas y la estantería'),
      ] },
      { key: 'load', label: 'Load handling', label_es: 'Manejo de carga', items: [
        PC('capacity', 'Checks the load against the data plate and does not exceed capacity', 'Compara la carga con la placa de datos y no excede la capacidad'),
        PC('approach', 'Squares up, sets fork width, and enters the pallet fully', 'Se alinea, ajusta el ancho de las horquillas y entra completo en la tarima'),
        PC('stability', 'Keeps the load centred and stable; does not lift or lower while moving', 'Mantiene la carga centrada y estable; no sube ni baja mientras se mueve'),
        PC('stacking', 'Stacks and destacks squarely, with the mast vertical at height', 'Apila y desapila derecho, con el mástil vertical en altura'),
      ] },
      { key: 'ramps_docks', label: 'Ramps, docks and trailers', label_es: 'Rampas, muelles y tráileres', items: [
        PC('ramps', 'On a ramp, travels with the load upgrade and does not turn on the grade', 'En una rampa, maneja con la carga hacia arriba y no gira en la pendiente'),
        PC('trailer_secured', 'Confirms the trailer is chocked or restrained before entering', 'Confirma que el tráiler esté con trancas o asegurado antes de entrar'),
        PC('dock_plate', 'Checks the dock plate and the trailer floor before driving on', 'Revisa la plancha del muelle y el piso del tráiler antes de entrar'),
      ] },
      { key: 'shutdown', label: 'Parking, shutdown and charging', label_es: 'Estacionar, apagar y cargar', items: [
        PC('park', 'Parks clear of aisles and exits, forks fully lowered', 'Estaciona fuera de pasillos y salidas, con las horquillas abajo'),
        PC('secure', 'Neutral, brake set, key removed before leaving the truck', 'Neutral, freno puesto y llave quitada antes de bajarse'),
        PC('charging', 'Follows the refuelling or battery-charging procedure, with PPE', 'Sigue el procedimiento de combustible o carga de batería, con equipo de protección'),
      ] },
    ],
  },
};

/** The evaluation a course requires, or null when it requires none. */
export function evaluationFor(courseCode) {
  return EVALUATIONS[String(courseCode || '').toUpperCase()] || null;
}

/** Every item across the form, flattened, in print order. */
export function itemsOf(form) {
  if (!form) return [];
  return form.sections.flatMap(s => s.items.map(i => ({ ...i, section: s.key, section_label: s.label })));
}

/**
 * What still stands between this evaluation and a signature — DERIVED on every
 * read, and called by BOTH sides. The form holds Sign until it is empty and
 * the server refuses with the same list, so the screen can never offer a
 * signature the server would then refuse (the `missingForCheck` rule).
 */
export function missingToSign(form, answers = {}, header = {}) {
  const missing = [];
  if (!String(header.employee_name || '').trim()) missing.push('the operator’s name');
  if (!String(header.evaluator_name || '').trim()) missing.push('who evaluated them');
  if (!String(header.evaluated_on || '').trim()) missing.push('the date it was evaluated');
  if (!String(header.truck_type || '').trim()) missing.push('which truck they were evaluated on');
  for (const item of itemsOf(form)) {
    const a = answers[item.key];
    const result = a?.result;
    if (!result || !RESULTS[result]) { missing.push(item.label); continue; }
    // "Not evaluated" is a real answer and the only one that has to explain
    // itself: without a reason it is indistinguishable from a box nobody read.
    if (RESULTS[result].needsNote && String(a.note || '').trim().length < 3) {
      missing.push(`why "${item.label}" was not evaluated`);
    }
  }
  return missing;
}

/**
 * The result of one evaluation — DERIVED from the answers, never stored as an
 * opinion. Correct a mis-tap and the verdict moves with it; a stored "pass"
 * would go stale the moment somebody fixed a typo, which is the defect the
 * mock-recall verdict and the receiving escalations already avoid.
 *
 * ANY "NEEDS PRACTICE" FAILS, and the failing items are named. A partial pass
 * is not competence to operate a powered industrial truck, and a verdict that
 * did not say which tasks were short would leave the retraining to guesswork.
 */
export function gradeEvaluation(form, answers = {}) {
  const items = itemsOf(form);
  const needs = [], notEvaluated = [];
  for (const item of items) {
    const result = answers[item.key]?.result;
    if (result === 'needs_practice') needs.push(item);
    else if (result === 'not_evaluated') notEvaluated.push(item);
  }
  const answered = items.filter(i => RESULTS[answers[i.key]?.result]).length;
  return {
    result: needs.length ? 'fail' : 'pass',
    competent: items.length - needs.length - notEvaluated.length,
    total: items.length,
    answered,
    needs_practice: needs.map(i => ({ key: i.key, label: i.label })),
    not_evaluated: notEvaluated.map(i => ({ key: i.key, label: i.label, note: answers[i.key]?.note || null })),
  };
}

/** Keep only answers the form actually asks for, and only legal values. */
export function normalizeAnswers(form, raw = {}) {
  const out = {};
  for (const item of itemsOf(form)) {
    const a = raw?.[item.key];
    if (!a) continue;
    const result = RESULT_KEYS.includes(a.result) ? a.result : null;
    if (!result) continue;
    out[item.key] = { result, note: String(a.note || '').trim().slice(0, 500) || null };
  }
  return out;
}
