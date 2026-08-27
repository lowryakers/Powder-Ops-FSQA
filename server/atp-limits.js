// PREVENTIVE CONTROL #1 — the ATP limit, as a value owned by a document.
//
// Protocol 003 (Food Safety Plan) V4 states the plant's first preventive
// control as a number:
//
//   Operational step   Packaging Powder Filling and Rework
//   Hazard             Pathogens
//   CRITICAL LIMIT     No more than 35 RLU
//   Monitoring         Application of cleaning; visual inspection prior to set
//                      up. Per the cleaning SOP. At the beginning of every run.
//                      Qualified quality assurance specialist.
//   Corrective action  Re-clean line.
//
// Until this module existed, that number lived in exactly one place in the
// whole system: the plain text of a PDF. `sanitation_records.atp_reading` was
// captured, rendered and exported, and NOTHING compared it to anything — a 60
// RLU reading filed with `result = 'pass'` and no mechanism objected. A stated
// critical limit that nothing enforces is the one audit finding a reader can
// reach without being shown anything.
//
// FOUR RULES SHAPED THIS FILE. They are the ones `scale-forms.js` already
// follows, because this is the same kind of object: an acceptance criterion.
//
//  1. NOT USER-EDITABLE. Changing a critical limit is a Document Change
//     Request against Protocol 003, not a settings toggle. The limit is
//     registered with `controlled.js` so a change to the deployed value is
//     PARKED until Document Control approves it, exactly as a scale tolerance
//     is.
//
//  2. THE GRADE CAN FAIL A RECORD, NEVER PASS ONE. A scale verification is
//     wholly defined by its three readings, so `gradeReadings()` decides the
//     result outright. A clean is not: it can fail visual inspection, or for a
//     reason nobody wrote a field for, while its swab reads 12 RLU. So an
//     over-limit reading forces `fail`, and an in-limit reading leaves the
//     filer's own answer alone. Asymmetric on purpose — see `applyGrade`.
//
//  3. A MISSING READING IS A GAP IN THE RECORD, NOT A FAILURE. Blank grades to
//     `null` and changes nothing. Most cleans in the log carry no ATP reading
//     at all and back-dating a failure onto them would be inventing history —
//     the same rule `env-limits.js` follows for an unparseable temperature.
//
//  4. THE LIMIT TRAVELS WITH THE RECORD. `gradeAtp` returns the limit and the
//     document revision it came from so the caller can stamp them alongside the
//     reading. A record graded against 35 must go on saying 35 after Document
//     Control issues 30, the same way a scale verification keeps the tolerance
//     it was graded against and a receiving checklist keeps its revision.
//
// The reading is in RLU (relative light units), which is what the luminometer
// reports. The unit is part of the criterion, not decoration — see the note in
// `controlled.js` about kg vs lb on Form 417-01.

export const ATP_LIMIT = {
  /** Maximum acceptable reading. At or below this is a pass. */
  max: 35,
  unit: 'RLU',
  /** The document revision that owns the number, printed on refusals. */
  document: 'Protocol 003',
  revision: 'V4',
  control: 'PC #1',
  hazard: 'Pathogens',
  /** The plan's own wording, kept verbatim. */
  statement: 'No more than 35 RLU',
  correctiveAction: 'Re-clean line.',
};

/** Where the limit came from, for a message a person has to act on. */
export const atpSource = () =>
  `${ATP_LIMIT.document} ${ATP_LIMIT.revision}, ${ATP_LIMIT.control} — "${ATP_LIMIT.statement}"`;

/**
 * Grade one ATP reading against the plan's critical limit.
 *
 * Returns `null` when there is nothing to grade — no reading, or a value that
 * is not a finite number. Null means "the record is silent", which is a
 * different fact from a failure and must not be rendered as one.
 *
 * @param {number|string|null|undefined} reading
 * @returns {{value:number, limit:number, unit:string, pass:boolean,
 *            source:string, correctiveAction:string}|null}
 */
export function gradeAtp(reading) {
  if (reading === null || reading === undefined || reading === '') return null;
  const value = Number(reading);
  if (!Number.isFinite(value)) return null;
  return {
    value,
    limit: ATP_LIMIT.max,
    unit: ATP_LIMIT.unit,
    // Float comparison with the same epsilon `gradeReadings` uses, so a
    // luminometer reporting exactly 35 is never failed by binary rounding.
    pass: value <= ATP_LIMIT.max + 1e-9,
    source: atpSource(),
    correctiveAction: ATP_LIMIT.correctiveAction,
  };
}

/**
 * The write-path rule, in one place so every door applies it identically.
 *
 * Takes the result the filer chose and the graded reading, and returns the
 * result that may actually be stored, plus a reason when the two differ.
 *
 * ONE DIRECTION ONLY (rule 2 above): over the limit forces `fail`; within the
 * limit never upgrades anything. A cleaner who swabbed 12 RLU and still marked
 * the clean `reclean` because the guard was cracked is telling the truth, and
 * a grader that overruled them would be filing a false record.
 */
export function applyGrade(chosenResult, grade) {
  if (!grade || grade.pass) return { result: chosenResult, overridden: false, reason: null };
  return {
    result: 'fail',
    overridden: chosenResult !== 'fail',
    reason: `ATP ${grade.value} ${grade.unit} exceeds the critical limit of `
      + `${grade.limit} ${grade.unit} (${grade.source}). Corrective action: ${grade.correctiveAction}`,
  };
}

/**
 * What a failed ATP reading should DO, given what happened last time.
 *
 * THE PLANT'S RULE, decided 27 Aug 2026: one failed swab is re-swabbed; two
 * consecutive failures raise the re-clean immediately.
 *
 * The reasoning is about what a single reading can mean. An ATP swab has real
 * false positives — residue on a glove, technique, a swab past its date — so
 * ONE failure could be the swab rather than the line. Two in a row is the line:
 * re-cleaning did not fix it and somebody other than the cleaner needs to look.
 * Raising a work order on the first reading would put a task in a queue every
 * time a swab went wrong, and a task people learn to dismiss is worse than no
 * task at all.
 *
 * "Consecutive" means the immediately preceding GRADED reading for the same
 * area was also a failure. A pass in between resets it — which is the correct
 * reading of "we re-swabbed and it came back clean".
 *
 * @param {ReturnType<typeof gradeAtp>} grade  the reading just taken
 * @param {boolean} priorGradedFail  was the previous graded reading for this
 *   area a failure, with no passing reading since?
 * @returns {{stage:'reswab'|'escalate', message:string}|null}
 */
export function atpEscalation(grade, priorGradedFail) {
  if (!grade || grade.pass) return null;
  const reading = `${grade.value} ${grade.unit}`;
  if (!priorGradedFail) {
    return {
      stage: 'reswab',
      message: `ATP ${reading} is over the ${grade.limit} ${grade.unit} limit. `
        + 'Re-clean and swab again — a single high reading can be the swab rather than the line. '
        + 'If the second reading also fails, a re-clean task is raised automatically.',
    };
  }
  return {
    stage: 'escalate',
    message: `ATP ${reading} is over the ${grade.limit} ${grade.unit} limit, and this is the SECOND `
      + 'failed reading in a row. Re-cleaning has not brought the line within limit, so a re-clean '
      + 'task has been raised for this area. ' + ATP_LIMIT.correctiveAction,
  };
}

/**
 * The `controlled.js` entry, so changing the number is a document change.
 *
 * Kept HERE rather than in controlled.js because the shape of the snapshot and
 * the shape of the limit are one decision: whoever adds a field to `ATP_LIMIT`
 * is the person who has to say whether it is part of the acceptance criterion,
 * and they are looking at this file when they do it.
 *
 * `upgrade` exists for the same reason the scale entry has one — a snapshot
 * written before a field came under control is a BASELINE, not a change, and
 * must be adopted silently rather than parking the control over a shape change
 * nobody made.
 */
export function atpControlledEntry() {
  return {
    scope: 'acceptance',
    key: 'atp:pc-1',
    label: 'ATP critical limit — Preventive Control #1 (Protocol 003)',
    current: () => ({
      max: ATP_LIMIT.max,
      unit: ATP_LIMIT.unit,
      document: ATP_LIMIT.document,
      revision: ATP_LIMIT.revision,
    }),
    apply: (snap) => {
      if (typeof snap?.max === 'number') ATP_LIMIT.max = snap.max;
      if (snap?.unit) ATP_LIMIT.unit = snap.unit;
      if (snap?.document) ATP_LIMIT.document = snap.document;
      if (snap?.revision) ATP_LIMIT.revision = snap.revision;
    },
    upgrade: (snap) => {
      if (!snap || typeof snap.max !== 'number') return null;
      const missing = ['unit', 'document', 'revision'].filter(k => snap[k] === undefined);
      return missing.length ? { ...snap, ...Object.fromEntries(missing.map(k => [k, ATP_LIMIT[k]])) } : null;
    },
  };
}
