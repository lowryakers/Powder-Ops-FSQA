// Which optional services are actually switched on.
//
// Everything optional in ReadyDoc degrades gracefully — no R2 and the paperclip
// is hidden, no Anthropic key and translation quietly stays English, no VAPID
// and nobody gets a push. That is the right behaviour and it has one cost: a
// feature that is off looks EXACTLY like a feature that is broken. Somebody
// sets four variables in Railway under names of their own choosing, the upload
// button never appears, and there is nothing anywhere that says why.
//
// So this is the screen that says why. Two rules make it safe to look at:
//
//   1. NO SECRET IS EVER RETURNED — not masked, not truncated, not the last
//      four characters. Only whether each NAME is set. The names are already
//      in the repo; the values are the whole secret.
//   2. "SET" IS NOT "WORKS." Four variables can all be present and still be
//      wrong: a revoked token, a bucket that doesn't exist, a typo'd account
//      id. Storage therefore has a live round-trip test — write a small object,
//      read it back, delete it — because that is the only answer that means
//      anything, and it is the answer somebody is actually looking for.
//
// Admin-only. It reveals the shape of the deployment, and knowing which
// services are unconfigured is a thing to keep among the people who configure
// them.

import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { storageEnabled, putObject, getObjectBuffer, deleteObject } from '../storage.js';
import { aiEnabled } from '../ai.js';
import { voyageEnabled } from '../embeddings.js';
import { pushEnabled } from '../push.js';
import { quickbooksEnabled } from '../quickbooks.js';
import { bankFeedEnabled } from '../bank-feed.js';
import { smsEnabled } from '../sms.js';
import { adpEnabled } from '../adp.js';
import { cryptoEnabled as onboardingCryptoEnabled } from '../onboarding-crypto.js';

const router = Router();

const isSet = (name) => !!String(process.env[name] || '').trim();

/**
 * The catalogue.
 *
 * `required` is what has to be present for `enabled()` to become true, and it
 * is what the screen names when something is missing — "set R2_BUCKET" is
 * actionable in a way that "file storage is not configured" is not.
 * `optional` is listed separately so nobody goes hunting for a variable that
 * was never needed.
 *
 * REQUIRED MUST MATCH WHAT THE GATE ACTUALLY TESTS. If this list is stricter
 * than `enabled()`, the panel reports a variable missing on a service that is
 * working and somebody goes looking for a fault that isn't there; if it is
 * looser, it says everything is set beside a service that is off, which is the
 * exact confusion this screen exists to end. Three of these are narrower than
 * they look and are commented where they are: the approver phone, the VAPID
 * subject and the QuickBooks refresh token.
 */
const SERVICES = [
  {
    id: 'storage',
    label: 'File storage (Cloudflare R2)',
    // Named in full because this is the one people ask about: it gates every
    // upload in the app, and the failure is always silent.
    what: 'Every file in ReadyDoc — chat attachments, equipment manuals, nutrition panels, artwork, '
      + 'training evidence, invoices, course videos and the Friday backups.',
    enabled: storageEnabled,
    required: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
    optional: ['R2_ENDPOINT'],
    off: 'Uploads are hidden rather than offered and refused. Everything else works.',
    testable: true,
  },
  {
    id: 'ai',
    label: 'AI (Anthropic)',
    what: 'EN/ES translation, the Ask AI assistant, comms Ask, manual-vs-task comparison and policy drafting.',
    enabled: aiEnabled,
    required: ['ANTHROPIC_API_KEY'],
    off: 'Translation silently stays English and the Ask features are hidden.',
  },
  {
    id: 'embeddings',
    label: 'Semantic search (Voyage AI)',
    what: 'The Smart and Ask modes in comms search. Keyword search works without it.',
    enabled: voyageEnabled,
    required: ['VOYAGE_API_KEY'],
    optional: ['VOYAGE_MODEL', 'VOYAGE_BASE_URL'],
    off: 'Comms search falls back to keyword only.',
  },
  {
    id: 'push',
    label: 'Phone notifications (web push)',
    what: '@mentions, DMs and the alerts that chase people — QA corrections, pay reviews, temperature excursions.',
    enabled: pushEnabled,
    // The subject is not part of the gate — push works without it — so it is
    // listed as optional rather than reported missing on a working service.
    required: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
    optional: ['VAPID_SUBJECT'],
    off: 'Nobody receives anything on their phone. In-app notifications still work.',
    // The one failure mode worth naming here, because it looks like success on
    // the phone and is invisible everywhere else.
    note: 'Changing these keys silently breaks every device already subscribed. '
      + 'Messages → Settings → Notifications lists who is affected.',
  },
  {
    id: 'sms',
    label: 'Text messages (Twilio)',
    what: 'Texting a flavor-approval link, and the text-to-AI reply line.',
    enabled: smsEnabled,
    // Twilio is configured or it isn't; the approver's number decides who a
    // flavor link goes to, which is a different question and not part of the
    // gate. Listing it as required would report a fault on a working account.
    required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
    optional: ['FLAVOR_APPROVER_PHONE', 'APP_BASE_URL'],
    off: 'Approval links are shown on screen to copy and text by hand.',
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    what: 'Pulling bills and invoices into AP/AR. Read-only — nothing is ever written back.',
    enabled: quickbooksEnabled,
    // The refresh token ROTATES and the current one is persisted in
    // app_settings, so an installation that has connected once no longer needs
    // the env var. Reporting it missing would send someone to re-issue a token
    // that is working.
    required: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REALM_ID'],
    optional: ['QBO_REFRESH_TOKEN', 'QBO_ENV'],
    off: 'Import the reports QuickBooks exports natively instead — see the QuickBooks tab.',
  },
  {
    id: 'bank_feed',
    label: 'Bank feed (Plaid)',
    what: 'Pulling transactions straight from the bank into reconciliation.',
    enabled: bankFeedEnabled,
    required: ['PLAID_CLIENT_ID', 'PLAID_SECRET'],
    optional: ['PLAID_ENV'],
    off: 'Statement import still works, and always will — it is not a fallback.',
  },
  {
    id: 'onboarding_crypto',
    label: 'Onboarding — sensitive fields (SSN, bank details)',
    what: 'Whether the new-hire welcome wizard asks for the SSN and direct-deposit details at all. '
      + 'They are stored AES-256-GCM encrypted under this key and only ever shown as the last four.',
    enabled: onboardingCryptoEnabled,
    required: ['ONBOARDING_ENC_KEY'],
    off: 'The wizard skips those fields and tells the new hire the office will collect them directly. '
      + 'Everything else in onboarding works.',
    note: 'Generate once with `openssl rand -hex 32`. Changing it afterwards makes every value already '
      + 'stored unreadable, so it is set once and kept.',
  },
  {
    id: 'adp',
    label: 'ADP (RUN Powered by ADP) — onboarding hand-off',
    what: 'The Submit to ADP button on a completed onboarding packet, which pushes the new hire into '
      + "RUN's Applicant Onboarding so the office never re-keys the packet.",
    enabled: adpEnabled,
    // Mutual TLS: ADP issues a client certificate at app registration and every
    // call presents it, so the cert and key are part of the gate, not extras.
    required: ['ADP_CLIENT_ID', 'ADP_CLIENT_SECRET', 'ADP_CERT_PEM', 'ADP_KEY_PEM'],
    optional: ['ADP_API_BASE', 'ADP_TOKEN_URL'],
    off: 'The packet is still collected and shown; the office keys it into RUN by hand from the same screen.',
    note: 'There is no self-serve API key on the RUN plan. The credentials come from registering an app on '
      + 'the ADP Marketplace (developers.adp.com) — docs/adp-run-onboarding.md is the step-by-step.',
  },
  {
    id: 'product_master',
    label: 'Artwork proofing hand-off',
    what: 'The product master CSV the proofing service reads, and the results it posts back.',
    enabled: () => isSet('PRODUCT_MASTER_TOKEN'),
    required: ['PRODUCT_MASTER_TOKEN'],
    off: 'The master.csv endpoint is off entirely, so proofing cannot fetch the catalogue.',
    note: 'The proofing service needs this same value as its READYDOC_TOKEN — one shared secret, two halves '
      + 'of one integration.',
  },
];

const describe = (s) => {
  const missing = s.required.filter(n => !isSet(n));
  return {
    id: s.id,
    label: s.label,
    what: s.what,
    off: s.off,
    note: s.note || null,
    enabled: !!s.enabled(),
    testable: !!s.testable,
    // Names only. Never a value, never a fragment of one.
    required: s.required.map(name => ({ name, set: isSet(name) })),
    optional: (s.optional || []).map(name => ({ name, set: isSet(name) })),
    missing,
  };
};

router.get('/', requireRole('admin'), (req, res) => {
  const services = SERVICES.map(describe);
  res.json({
    services,
    counts: { total: services.length, on: services.filter(s => s.enabled).length },
  });
});

/* ── Proving it, rather than reporting it ─────────────────────────────────── */

/**
 * Write a small object, read it back, delete it.
 *
 * The round trip is the point. Credentials that are present but wrong fail
 * here and nowhere else until somebody tries to upload a manual and gets a
 * message about the server. The object is tiny, uniquely named, and removed
 * again — and the DELETE failing is reported separately, because a bucket you
 * can write to but not clean up is a real thing to know about.
 */
router.post('/storage/test', requireRole('admin'), async (req, res) => {
  if (!storageEnabled()) {
    return res.status(503).json({
      ok: false,
      step: 'configure',
      error: 'File storage is not configured.',
      missing: SERVICES.find(s => s.id === 'storage').required.filter(n => !isSet(n)),
    });
  }

  const key = `_readydoc-connection-test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = `ReadyDoc storage check ${new Date().toISOString()}`;
  const started = Date.now();

  try {
    await putObject(key, Buffer.from(body), 'text/plain');
  } catch (e) {
    return res.json({ ok: false, step: 'write', error: e.message });
  }

  try {
    const got = await getObjectBuffer(key);
    if (Buffer.from(got).toString('utf8') !== body) {
      return res.json({ ok: false, step: 'read', error: 'The bytes read back did not match what was written.' });
    }
  } catch (e) {
    return res.json({ ok: false, step: 'read', error: e.message });
  }

  let cleaned = true, cleanupError = null;
  try { await deleteObject(key); } catch (e) { cleaned = false; cleanupError = e.message; }

  res.json({ ok: true, ms: Date.now() - started, cleaned, cleanup_error: cleanupError });
});

export default router;
