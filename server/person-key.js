/**
 * A person is their name's WORDS, accent-folded and sorted.
 *
 * Extracted from the Training Log importer, where matching the string as
 * written left 92 of 94 people unlinked: the log writes "Vera, Yetzon" on one
 * sheet and "Yetzon Vera" on the next, and the roster spells accents the log
 * drops. Sorting the words makes the comparison order-independent, which beats
 * deciding which side of a comma is the surname — a call that
 * "Lopez Fernande, Estefany Maria" would get wrong.
 *
 * EXTRACTED RATHER THAN COPIED. The org chart needed the same match to link its
 * positions to accounts, and a second copy is how one importer starts matching
 * people the other does not.
 */
export function personKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')          // "Vergara, Kimberly (?)" — the author's own uncertainty
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean).sort()
    .join(' ');
}
