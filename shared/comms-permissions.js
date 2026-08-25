// Who may change a message that is already posted.
//
// ONE DEFINITION, BOTH SIDES. The client used to decide this on its own with a
// bare `m.user_id === me.id`, while the server allowed the author OR an admin —
// so the two disagreed in both directions at once: an admin was never offered
// the button on somebody else's message even though the server would have
// honoured it, and the author was offered it on their own even after the rule
// was meant to narrow. That is the same "a rule the client keeps its own copy
// of" failure `qms.js` documents, and the fix is the same shape as
// `shared/form-registry.js` — define it once, import it in both places.
//
// The server is still the enforcer. Nothing here gates anything by itself; it
// decides what to OFFER on the client and what to ALLOW on the server, from the
// same function, so the two cannot drift.

/**
 * Deleting a message is an ADMIN action and nothing else (decided 2026-08-25).
 *
 * Not "the author, plus admins". A chat message is the plant's record of who
 * said what and when — it is converted into compliance records, quoted into
 * work orders, and searched months later — so letting anybody quietly remove
 * their own is the wrong default for this room. Removing one is moderation, and
 * moderation belongs to somebody accountable for the channel.
 *
 * The author is not left stuck: `canEditMessage` still lets them correct what
 * they wrote, which is what "I said that wrong" actually calls for. Edit keeps
 * the message and its history; delete removes it from the conversation.
 *
 * If this is ever widened again — to supervisors, or back to authors — widen it
 * HERE. A second `role === 'admin'` written into a component is how this ends
 * up meaning two different things on two screens.
 */
export function canDeleteMessage(user /* , message */) {
  return user?.role === 'admin';
}

/**
 * Editing stays with the author, unchanged. Deliberately in this file beside
 * delete rather than left inline: they read as one permission and are not, and
 * keeping them apart on the page is what stops the next change to one of them
 * quietly moving the other.
 */
export function canEditMessage(user, message) {
  return !!user && !!message && message.user_id === user.id;
}
