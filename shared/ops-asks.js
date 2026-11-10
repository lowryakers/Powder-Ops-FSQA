// The #ops-requests approval-ask vocabulary (D-336). PURE — no database, no
// Express — so the server and any check read one definition.

// Categories a reply can approve.
export const ASK_CATEGORIES = Object.freeze(['ops', 'code', 'process', 'staffing', 'training', 'artwork', 'internal']);
// Categories that can be ASKED and are never recognized from a thread reply:
// money, payments, QuickBooks, Bill Pay, anything going to an outside party.
export const EXCLUDED_CATEGORIES = Object.freeze(['money', 'payment', 'qbo', 'bill_pay', 'outside_party']);
// The whole reply, after normalizePhrase, must be one of these — never a substring.
export const ALLOWED_PHRASES = Object.freeze(['approve', 'approved', 'yes approve']);

/** Lowercase, apostrophes dropped, every other mark a space, spaces collapsed. */
export function normalizePhrase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True only for an allowed phrase, said exactly. "not approved" and "please approve" are not. */
export function isApprovalPhrase(text) {
  const n = normalizePhrase(text);
  return n.length > 0 && ALLOWED_PHRASES.includes(n);
}
