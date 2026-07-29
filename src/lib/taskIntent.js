// Does this message read like an assignment rather than a remark?
//
// The point is the message that gets typed into a department channel and then
// forgotten: "@Juan @Danilo need to label the Graham crackers with a wheat
// allergen." That's a task. It gets sent as chat, scrolls away, and nobody can
// tell later whether it was done. Catching it at the send button is the only
// moment someone is still willing to turn it into a tracked task.
//
// Deliberately conservative. A prompt that fires on ordinary conversation is
// worse than one that misses — people learn to dismiss it, and then it never
// works. Both halves must be present: someone to do it, and something to do.

// Imperative / request phrasing, English and Spanish. Anchored to word starts
// so "needle" doesn't match "need".
const DIRECTIVE = new RegExp([
  // English
  '\\bneeds? to\\b', '\\bneed(s|ed)? (you|someone|somebody|help)\\b', '\\bplease\\b',
  '\\bmake sure\\b', '\\bdon\'?t forget\\b', '\\bremember to\\b', '\\bcan you\\b',
  '\\bcould you\\b', '\\bwe need\\b', '\\bhas to be\\b', '\\bhave to\\b', '\\bmust be\\b',
  '\\bshould be\\b', '\\bfollow up\\b', '\\btake care of\\b', '\\bhandle\\b',
  '\\bset ?up\\b', '\\bclean up\\b', '\\bbefore (the )?(end of|eod|shift|tomorrow)\\b',
  '\\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|eod|end of)\\b',
  // Spanish — the floor runs bilingual, so an English-only heuristic would
  // quietly only work for half the supervisors.
  '\\bhay que\\b', '\\bnecesit(a|an|amos|o)\\b', '\\bpor favor\\b', '\\bfavor de\\b',
  '\\basegúr(ate|ense)\\b', '\\basegur(ate|ense)\\b', '\\bno olvid(es|en)\\b',
  '\\bdeben?\\b', '\\btienen? que\\b', '\\bantes de\\b',
].join('|'), 'i');

// Things that look directive but aren't a task worth tracking.
const NOT_A_TASK = /\?\s*$|\bthanks\b|\bthank you\b|\bgracias\b|^\s*(ok|okay|yes|no|sí|si)\b/i;

export function hasMention(body) {
  return /@[^\s@]/.test(body || '');
}

// A message is task-shaped when it names someone AND tells them to do
// something, and isn't just a question or an acknowledgement.
export function looksLikeTask(body) {
  const text = String(body || '').trim();
  if (text.length < 12) return false;          // too short to be an instruction
  if (NOT_A_TASK.test(text)) return false;
  return hasMention(text) && DIRECTIVE.test(text);
}

// A usable task title from the message: drop the @mentions (they become the
// assignee), collapse whitespace, take the first sentence, and cap it. The
// full message still goes into the description, so nothing is lost here.
export function suggestTitle(body, maxLen = 90) {
  let t = String(body || '')
    .replace(/@[\w.'-]+(\s+[A-ZÁÉÍÓÚÑ][\w.'-]+)?/g, ' ')  // "@Juan Gonzalez"
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = t.split(/(?<=[.!])\s+/)[0] || t;
  t = (firstSentence.length >= 12 ? firstSentence : t).trim();
  // Start it as an instruction, not mid-sentence.
  t = t.replace(/^(and|also|so|then|y|también)\s+/i, '');
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// The people named in the message, matched against the channel's members so a
// stray "@" or a misspelling doesn't become a bogus assignee.
export function mentionedUsers(body, users, nameOf) {
  const lower = String(body || '').toLowerCase();
  return (users || []).filter(u => {
    const forms = [nameOf ? nameOf(u) : u.username, u.name].filter(Boolean);
    return forms.some(f => lower.includes('@' + String(f).toLowerCase()));
  });
}

// Which Task Center team a channel belongs to. Channel names are the mapping —
// #warehouse, #filling-team, #batching — with the aliases people actually use.
const CHANNEL_TEAM = [
  [/maint/i, 'maintenance'],
  [/warehouse|shipping|receiv/i, 'warehouse'],
  [/^qa\b|quality/i, 'qa'],
  [/clean|sanitation/i, 'cleaning'],
  [/batch/i, 'batching'],
  [/fill|stick|hand.?fill|pouch|sachet|bottl/i, 'filling'],
  [/kitting/i, 'kitting'],
  [/doc.?control|document/i, 'document_control'],
];
export function teamForChannel(channelName) {
  const n = String(channelName || '');
  for (const [re, team] of CHANNEL_TEAM) if (re.test(n)) return team;
  return null;
}
