// The organoleptic scale, and what counts as a finished evaluation.
//
// ONE DEFINITION, BOTH SIDES. The server refuses to text an approval whose
// tasting has not been recorded, and the log decides which button to offer on
// the same fact — so if these were two copies they would eventually disagree,
// and the disagreement would look like the app refusing an action it had just
// offered. Same reasoning as shared/comms-permissions.js, where the client's
// bare `m.user_id === me.id` and the server's author-OR-admin drifted in both
// directions at once.

export const SENSORY_KEYS = ['appearance', 'texture', 'aroma', 'flavor', 'overall'];

export const SENSORY_LABELS = [
  ['appearance', 'Appearance'],
  ['texture', 'Texture'],
  ['aroma', 'Aroma'],
  ['flavor', 'Flavor'],
  ['overall', 'Overall'],
];

// The form's own 1–5 scale, and the only values a score may take. A record
// grading on an invented scale is not comparable to the ones beside it.
export const SENSORY_SCORES = ['1', '2', '3', '4', '5'];

/**
 * Has the sensory evaluation actually been done?
 *
 * ALL FIVE OR NONE OF IT COUNTS. A record carrying three scores is a
 * half-finished tasting, and treating it as complete would let a batch be sent
 * for approval on an evaluation nobody finished — then file it in the
 * Organoleptic log as though it were whole.
 */
export function sensoryComplete(rec) {
  return SENSORY_KEYS.every(k => String(rec?.[k] ?? '').trim() !== '');
}
