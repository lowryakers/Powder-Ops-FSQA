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

/**
 * The trainer's statement of competence, in fixed words. The trainer is named
 * in it; ticking it on the form is the trainer saying it (or the person keying
 * the record in saying the trainer said it — "recorded by" shows which).
 */
export function competenceStatement(trainer) {
  const who = String(trainer || '').trim() || 'The trainer';
  return `${who} trained the people on this record and observed that each one can do the work this training covers.`;
}

/**
 * Verbal and hands-on training are judged by the trainer watching, so they
 * want the statement. A record without it is filed and flagged, not refused:
 * a past session somebody is logging today may have no trainer to ask.
 */
export const wantsCompetence = (method) => method === 'verbal' || method === 'hands_on';

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
