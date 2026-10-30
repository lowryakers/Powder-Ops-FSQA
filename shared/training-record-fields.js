// What a training record says about HOW somebody was trained (D-264).
//
// SQF 2.9.2.3 and FORM 408-02 ask a training record for: the document and
// revision trained on, the date trained, the trainer, the method, the trainer's
// statement that the person is competent, and the language. The date the record
// was entered and who entered it are kept too, set by the server and never
// editable. This file is the ONE list of the choices; the server validates
// against it and the screens draw from it.

/** The four ways the plant trains, as Daniela's form names them. */
export const METHODS = [
  { key: 'verbal', label: 'Verbal' },
  { key: 'hands_on', label: 'Hands-on' },
  { key: 'read_and_sign', label: 'Read and sign' },
  { key: 'quiz', label: 'Quiz' },
];

/**
 * Values written before D-264. Records keep what they were filed with; these
 * are only how they read. `online_test` is a quiz; the others are not
 * converted, because "in person" does not say whether it was verbal or hands-on.
 */
export const LEGACY_METHODS = {
  in_person: 'In person (older record)',
  online_test: 'Quiz (online test)',
  external: 'Outside training (older record)',
};

export const METHOD_KEYS = METHODS.map(m => m.key);

export function methodLabel(m) {
  if (!m) return 'Not recorded';
  return METHODS.find(x => x.key === m)?.label || LEGACY_METHODS[m] || m;
}

/** A method a NEW write may carry. Old values stay readable but are not offered. */
export const isMethod = (m) => METHOD_KEYS.includes(m);

export const LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'es', label: 'Spanish' },
  { key: 'both', label: 'English and Spanish' },
];
export const isLanguage = (l) => LANGUAGES.some(x => x.key === l);
export const languageLabel = (l) => LANGUAGES.find(x => x.key === l)?.label || 'Not recorded';

/** The words the trainer ticks (D-269). */
export const COMPETENCE_TICK = 'I confirm this person understands this training.';

/**
 * The trainer's statement of competence, as stored on the record: the ticked
 * words with the trainer's name. Ticking it is the trainer saying it (or the
 * person keying the record in saying the trainer said it — "recorded by"
 * shows which).
 */
export function competenceStatement(trainer) {
  const who = String(trainer || '').trim() || 'The trainer';
  return `${who}: "${COMPETENCE_TICK}"`;
}

/**
 * A passed quiz is the other evidence of competence: an in-app test (a test
 * attempt) or a score at or above the course's pass mark.
 */
export function passedQuiz(r, passMark = 80) {
  if (r?.test_attempt_id) return true;
  const raw = r?.score;
  if (raw === null || raw === undefined || String(raw).trim() === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= Number(passMark ?? 80);
}

/**
 * COMPETENCE IS REQUIRED (D-269, superseding D-264's flag-only rule). A
 * completion a person files — the record form, the group entry, Group Sheets,
 * the task card — saves only with a passed quiz OR the trainer's tick. A
 * failed result is not a completion and is not asked. The importers file
 * history as it was and are not asked either.
 */
export function competenceMissing(r, passMark = 80) {
  if (r?.status === 'failed') return false;
  if (passedQuiz(r, passMark)) return false;
  return !(r?.competence_confirmed || String(r?.competence_statement || '').trim());
}

export const COMPETENCE_REQUIRED_MSG = `A passed quiz, or the trainer's tick "${COMPETENCE_TICK}", is required to save a training record.`;

/** Kept for the record list's flag: a record with neither reads "no competence statement". */
export const wantsCompetence = () => true;

/** Problems with the how-it-was-trained fields on a write, in words. */
export function trainingFieldErrors(b, today) {
  const out = [];
  if (b.method != null && b.method !== '' && !isMethod(b.method) && !LEGACY_METHODS[b.method]) {
    out.push(`Method must be one of: ${METHODS.map(m => m.label).join(', ')}.`);
  }
  if (b.language != null && b.language !== '' && !isLanguage(b.language)) {
    out.push(`Language must be one of: ${LANGUAGES.map(l => l.label).join(', ')}.`);
  }
  for (const k of ['training_date', 'completion_date']) {
    if (b[k] && today && String(b[k]).slice(0, 10) > today) {
      out.push("The date trained can't be in the future.");
      break;
    }
  }
  return out;
}

// ── External training (D-286) ─────────────────────────────────────────────────
// Training given by somebody outside ReadyDoc — a fire company, a forklift
// school, a supplier's course. The outside trainer cannot sign here, so the
// person entering it signs instead, with a different meaning: not "I trained
// this person and they are competent" but "I recorded this external training,
// and its certificate is attached". The outside trainer's name is a FACT on the
// record, never a signature. A certificate is required.
export const EXTERNAL_MEANING = 'Recorded external training';
export const EXTERNAL_TICK = 'I recorded this external training. The certificate is attached.';
export function externalStatement(recorder, trainer) {
  const who = String(recorder || '').trim() || 'The recorder';
  return `${who}: "I recorded external training given by ${String(trainer || '').trim() || 'an outside trainer'}. The certificate is attached."`;
}
/** Why an external-training entry cannot be saved, in words, or null. */
export function externalProblem(r) {
  if (!r?.external_training) return null;
  if (String(r.external_trainer || '').trim().length < 2) return 'Name the outside trainer or company that gave the training.';
  if (!String(r.document_url || r.certificate_url || '').trim()) return 'Attach the certificate — external training is recorded from its certificate.';
  return null;
}
