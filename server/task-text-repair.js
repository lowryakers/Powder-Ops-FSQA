/**
 * Rejoin maintenance task text that an import split on commas.
 *
 * The plant's equipment list was imported from prose, and something along the
 * way split every sentence at its commas. One task became eight:
 *
 *   "Examine equipment for signs of damage" / "leaks" / "loose parts" /
 *   "unusual sounds" / "vibrations" / "heat" / "odors" / "and cleanliness."
 *
 * which is a single sentence, and which reads to an auditor as eight
 * maintenance activities, six of which are single words. 73 machines are in
 * that state.
 *
 * THE RULE IS MECHANICAL, NOT INTERPRETIVE. A fragment continues the previous
 * one when it cannot begin a sentence — it starts lowercase, or with "and"/
 * "or". A fragment that starts with a capital begins a new task. That is
 * exactly the inverse of splitting on ", " and it restores the author's own
 * words; nothing is rephrased, corrected or dropped. Their typo
 * "Maonthly-Inspect drive motor" survives intact, deliberately — the same rule
 * the internal-audit checklist follows.
 *
 * PURE, so the preview and the commit cannot disagree, and so the decision can
 * be checked without a database.
 */

// A fragment that can't start a sentence. Deliberately narrow: anything that
// looks like it could stand alone is left alone.
function isContinuation(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  // Starts lowercase → it was mid-sentence when the comma cut it.
  if (/^[a-z]/.test(s)) return true;
  // "And ..." / "Or ..." at the start of a fragment is the tail of a list.
  if (/^(and|or)\b/i.test(s)) return true;
  return false;
}

/**
 * One frequency's list of tasks → the list as it was written.
 * Returns the repaired list plus how many fragments were folded back in.
 */
export function repairTaskList(list) {
  if (!Array.isArray(list)) return { repaired: [], joined: 0 };
  const out = [];
  let joined = 0;
  for (const raw of list) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    if (out.length && isContinuation(text)) {
      // Re-insert the comma the split removed. The fragment already carries
      // its own leading "and"/"or" where the author wrote one.
      out[out.length - 1] = `${out[out.length - 1]}, ${text}`;
      joined++;
      continue;
    }
    out.push(text);
  }
  return { repaired: out, joined };
}

/** A whole `maintenance_tasks` object → repaired, with a count of what moved. */
export function repairTasks(tasks) {
  const out = {};
  let joined = 0;
  let before = 0;
  for (const [freq, list] of Object.entries(tasks || {})) {
    if (!Array.isArray(list)) { out[freq] = list; continue; }
    before += list.filter(x => String(x ?? '').trim()).length;
    const r = repairTaskList(list);
    joined += r.joined;
    if (r.repaired.length) out[freq] = r.repaired;
  }
  const after = Object.values(out).reduce((t, l) => t + (Array.isArray(l) ? l.length : 0), 0);
  return { tasks: out, joined, before, after, changed: joined > 0 };
}

/**
 * How sure are we that THIS machine's tasks were comma-split, rather than
 * simply typed in lower case?
 *
 * A one-word fragment ("leaks", "gaskets", "odors") cannot be a maintenance
 * task somebody wrote on purpose — it is the unmistakable signature of a
 * sentence cut at its commas. Anything longer ("check filters") might be either,
 * so a machine whose fragments are ALL multi-word is reported as uncertain and
 * left unticked for a person to judge. One certain fragment is enough to trust
 * the machine; the threshold is about not pre-ticking the ones nobody split.
 */
export function repairConfidence(tasks) {
  let single = 0, multi = 0;
  for (const list of Object.values(tasks || {})) {
    if (!Array.isArray(list)) continue;
    list.forEach((raw, i) => {
      const text = String(raw ?? '').trim();
      if (i === 0 || !isContinuation(text)) return;
      // EXACTLY one word. A two-word fragment like "check filters" is a
      // perfectly plausible hand-typed task, and treating it as proof would
      // pre-tick machines nobody split — the opposite of the point.
      if (text.split(/\s+/).length === 1) single++; else multi++;
    });
  }
  return { single_word_fragments: single, multi_word_fragments: multi, confident: single > 0 };
}
