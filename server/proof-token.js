// The Artwork-Proofing service's one credential, checked in ONE place (D-126).
//
// The proofing service is a service holding a token, not a person holding a
// session: it calls five routes, all with `?token=<PRODUCT_MASTER_TOKEN>`
// (`readydoc.py` `_get`, `_post`, `_post_multipart`). Each route used to carry
// its own copy of the check — products.js had one for master.csv and the
// nutrition panel, artwork.js another for ingest — and `/artwork/snapshot`
// had none at all: it sat on the session-only router, so the global gate
// answered "Authentication required" to every call the proofer made. Three
// copies and one gap is how a route stops matching its siblings without
// anybody noticing; the proofer reports every failure as "no panel found",
// which reads as a data problem.
//
// So: one comparison, one reading of where the token travels, one refusal that
// SAYS WHICH REFUSAL IT IS. A 401 that does not distinguish "you sent nothing"
// from "you sent the wrong thing" is how a mangled URL (an `&amp;`, a token
// sent twice) gets diagnosed as a bad secret, or the other way round. The
// reason names the shape of the problem and never the expected value.
//
// Nothing here is looser than master.csv was: the same secret, compared as a
// SHA-256 hash in constant time, and off entirely while PRODUCT_MASTER_TOKEN is
// unset. The `X-Proof-Token` header was already accepted by ingest; it carries
// the same secret out of the query string (and out of access logs).

import { createHash, timingSafeEqual } from 'crypto';

const REASONS = {
  not_configured: 'This feed is off: PRODUCT_MASTER_TOKEN is not set on the server.',
  missing: 'No token was supplied. Send ?token=<PRODUCT_MASTER_TOKEN> (or an X-Proof-Token header).',
  repeated: 'The token was supplied more than once in the request. Send it once.',
  mismatch: 'The token does not match PRODUCT_MASTER_TOKEN on this server.',
};

/** Did the caller try to use the proof token at all? Decides which door a dual-door route takes. */
export function carriesProofToken(req) {
  return req.query?.token !== undefined || !!req.headers?.['x-proof-token'];
}

/** `{ ok: true }` or `{ ok: false, reason, message }`. Never echoes the expected value. */
export function checkProofToken(req) {
  const expected = process.env.PRODUCT_MASTER_TOKEN || '';
  if (!expected) return fail('not_configured');
  const q = req.query?.token;
  if (Array.isArray(q)) return fail('repeated');
  const supplied = q !== undefined && q !== '' ? q : req.headers?.['x-proof-token'];
  if (!supplied) return fail('missing');
  const a = createHash('sha256').update(String(supplied)).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) ? { ok: true } : fail('mismatch');
}

function fail(reason) {
  return { ok: false, reason, message: REASONS[reason] };
}

/** The refusal, in one shape. `text` keeps master.csv answering in plain text, as it always has. */
export function refuseProofToken(res, r, { text = false } = {}) {
  if (text) return res.status(401).type('text/plain').send(`Unauthorized: ${r.message}`);
  return res.status(401).json({ error: 'Unauthorized', reason: r.reason, message: r.message });
}

/** Route guard for a router mounted on the token door (ingest). */
export function requireProofToken(opts) {
  return (req, res, next) => {
    const r = checkProofToken(req);
    return r.ok ? next() : refuseProofToken(res, r, opts);
  };
}
