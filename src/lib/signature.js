// Asking for the password at the moment of signing.
//
// The server refuses a QA signature that arrives without one (403 +
// `signature_required`), so the flow is: send the request, get refused, ask,
// send it again with the password. THE FIRST REQUEST IS NEVER SENT WITH A
// PASSWORD — nothing is cached, nothing is held in a variable between
// signatures, and a person who walks away mid-signature leaves nothing behind.
//
// ONE PROMPT FOR THE WHOLE APP. `<SignaturePrompt />` is mounted once and
// listens for this event; every signing screen calls `withSignature` and knows
// nothing about the modal. A prompt per module is how one of them ends up
// asking for something subtly different.

const EVENT = 'readydoc-signature-request';

/**
 * Run a request, and if the server asks for a password, ask and run it again.
 *
 * `send(extra)` is called with `{}` first and `{ signature_password }` on the
 * retry, so the caller keeps ownership of what it is sending.
 *
 * Cancelling throws with `cancelled: true` — a caller shows nothing for that,
 * because the person chose it and an error toast reads as a failure.
 */
export async function withSignature(send, { title, detail } = {}) {
  try {
    return await send({});
  } catch (e) {
    if (!e?.signatureRequired) throw e;
    // Keep asking while the password is wrong; the server does the rate
    // limiting, and a modal that closes on a typo loses the whole batch.
    let message = null;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const password = await askForPassword({ title, detail, message });
      if (password == null) {
        const cancelled = new Error('Signature cancelled.');
        cancelled.cancelled = true;
        throw cancelled;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        return await send({ signature_password: password });
      } catch (e2) {
        if (!e2?.signatureRequired) throw e2;
        message = e2.message;
      }
    }
  }
}

/** Resolves with the typed password, or null if the person cancelled. */
export function askForPassword(opts = {}) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { ...opts, resolve } }));
  });
}

export const SIGNATURE_EVENT = EVENT;
