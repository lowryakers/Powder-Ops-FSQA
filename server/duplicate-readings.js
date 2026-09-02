// A READING THAT REPEATS THE PREVIOUS CHECK'S IS PROBABLY THE PREVIOUS CHECK.
//
// Maria recorded yesterday's temperature and humidity against today's task.
// Nothing caught it, so today held a record with yesterday's numbers and
// yesterday held no record at all — and the only way back was to reopen the
// task and re-date the record by hand. The mechanism to prevent it already
// existed (the completion form asks "when was this done?") and defaults to
// today, which is exactly the answer somebody transcribing yesterday's sheet
// does not stop to change.
//
// THIS IS A QUESTION, NOT A REFUSAL, and that is the whole design. A stable
// room genuinely reads 68°F and 35% two mornings running; a rule that refused
// identical readings would block correct work and be switched off within a
// week. So the server refuses ONCE with a machine-readable flag naming the
// record it matched, and accepts the same submission with `confirm` set. The
// operator answers a question they are in a position to answer — "is this
// today's check, or yesterday's?" — instead of being told they are wrong.
//
// Pure: readings in, an answer out. No Express, no database.

/** Values worth comparing: present, non-blank, and trimmed. */
export function normalizeReadings(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    // "68 F" and "68F" and "68" are the same reading typed three ways on a
    // phone keypad. Compare the number where there is one, the text otherwise.
    const num = s.replace(/[^\d.-]/g, '');
    out[k] = num !== '' && !Number.isNaN(Number(num)) ? String(Number(num)) : s.toLowerCase();
  }
  return out;
}

/**
 * Do two sets of readings say the same thing? Both must carry at least one
 * value — A BLANK READING IS A GAP, NOT A MATCH (the ATP rule), and two empty
 * sets matching would fire on every task that records nothing at all.
 */
export function sameReadings(a, b) {
  const x = normalizeReadings(a);
  const y = normalizeReadings(b);
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  if (!kx.length || !ky.length) return false;
  if (kx.length !== ky.length) return false;
  return kx.every(k => y[k] !== undefined && y[k] === x[k]);
}

/**
 * The prior check to compare against is the IMMEDIATELY PRECEDING one, never
 * the whole history. A room that has read 68/35 all month is not filing a
 * duplicate every day — the failure being caught is specifically "the numbers
 * from the last check went into this one".
 *
 * @param prior   {readings, completed_at, completed_by, performed_on} or null
 * @param incoming the readings being filed now
 * @returns null, or a descriptor the caller turns into the question.
 */
export function duplicateReadings(prior, incoming) {
  if (!prior) return null;
  const priorReadings = typeof prior.readings === 'string'
    ? (() => { try { return JSON.parse(prior.readings); } catch { return null; } })()
    : prior.readings;
  if (!sameReadings(priorReadings, incoming)) return null;
  const when = String(prior.performed_on || prior.completed_at || '').slice(0, 10);
  return {
    prior_work_order_id: prior.id || null,
    prior_date: when || null,
    prior_by: prior.completed_by || null,
    values: normalizeReadings(incoming),
    // Written here rather than in the route so the wording cannot differ
    // between the two completion forms.
    message: when
      ? `These are the same readings as the check on ${when}. Is this today's check, or ${when}'s being entered now?`
      : 'These are the same readings as the previous check. Is this a new check?',
  };
}
