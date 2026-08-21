// Outbound SMS via Twilio's REST API (plain fetch — no SDK dependency).
// Degrades gracefully: without credentials, smsEnabled() is false and callers
// fall back to showing a copyable link instead of texting it.
//
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and ONE sender:
//        TWILIO_MESSAGING_SERVICE_SID  (preferred once A2P 10DLC is registered)
//        TWILIO_FROM                   (E.164, e.g. +15551234567)
// Optional: FLAVOR_APPROVER_PHONE (the default flavor-approval recipient)
//
// A MESSAGING SERVICE IS THE RIGHT SENDER ONCE A2P IS APPROVED. US A2P 10DLC
// ties a campaign to a Messaging Service, and a number that is registered but
// sent from directly still gets rejected by the carrier (Twilio error 30034
// "unregistered number"). If the SID is set it wins; TWILIO_FROM stays
// supported for a trial account or a non-US number.
//
// Link origins live in ./links.js — texted links must point at the app, not at
// the launcher host.

const val = (k) => (process.env[k] || '').trim() || null;

export function smsEnabled() {
  return !!(val('TWILIO_ACCOUNT_SID') && val('TWILIO_AUTH_TOKEN')
    && (val('TWILIO_MESSAGING_SERVICE_SID') || val('TWILIO_FROM')));
}

export function approverPhone() {
  return val('FLAVOR_APPROVER_PHONE');
}

/**
 * The confirmation a newly consented number receives — and the SAME wording
 * registered with Twilio as the campaign's opt-in message.
 *
 * IT IS DEFINED ONCE, HERE, AND SHOWN IN SETTINGS. Consent here is given in
 * person and recorded by an administrator, so the carrier expects the first
 * message a number ever receives to be this: it closes the loop in writing and
 * carries the STOP instructions. Registering one wording with the carrier and
 * sending another is the kind of drift nobody notices until a campaign audit.
 */
export const OPTIN_MESSAGE = 'Powder Ops ReadyDoc: you are now set up for quality approval requests and operational replies. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.';

/**
 * The opt-out line carried by every message ReadyDoc STARTS.
 *
 * It goes on messages we initiate — an approval request, a test — and NOT on a
 * reply to somebody who has just texted us a question: an answer that ends in
 * boilerplate reads as a robot, and the person is plainly not looking for the
 * way out at the moment they asked. One constant, so the wording in the
 * campaign registration and the wording on a phone stay the same sentence.
 */
export const OPT_OUT_LINE = 'Reply STOP to opt out.';

/**
 * Send that confirmation to a ten-digit US number. Returns Twilio's payload;
 * THROWS like any other send, so the caller decides whether that matters —
 * for the consent tick it does not, because the consent is already recorded.
 */
export async function sendOptIn(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) throw new Error('A ten-digit mobile number is needed to send the confirmation.');
  return sendSms(`+1${digits}`, OPTIN_MESSAGE);
}

/**
 * What is and is not configured — WITHOUT ever returning a secret.
 *
 * "Nothing was sent and nothing said why" is the failure this exists to end:
 * a missing variable, a typo'd name and a carrier rejection all looked
 * identical from the app, which is a bad place to be debugging from.
 */
export function smsStatus() {
  const sid = val('TWILIO_ACCOUNT_SID');
  const from = val('TWILIO_FROM');
  const svc = val('TWILIO_MESSAGING_SERVICE_SID');
  const missing = [];
  if (!sid) missing.push('TWILIO_ACCOUNT_SID');
  if (!val('TWILIO_AUTH_TOKEN')) missing.push('TWILIO_AUTH_TOKEN');
  if (!svc && !from) missing.push('TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM');
  return {
    enabled: smsEnabled(),
    missing,
    // Enough to recognise the value, never enough to use it.
    account_sid_tail: sid ? `…${sid.slice(-4)}` : null,
    sender: svc ? { kind: 'messaging_service', value: `…${svc.slice(-4)}` }
      : from ? { kind: 'from_number', value: from } : null,
    // A bare From number after A2P registration is the usual cause of a silent
    // carrier rejection, so it is called out rather than left to be discovered.
    warning: (!svc && from)
      ? 'Sending from a number directly. Once A2P 10DLC is approved, set TWILIO_MESSAGING_SERVICE_SID to the Messaging Service that holds your campaign — carriers reject unregistered senders (error 30034).'
      : null,
    default_recipient: approverPhone() ? `…${approverPhone().slice(-4)}` : null,
    // Returned so the wording registered with the carrier can be read (and
    // copied) from Settings rather than from a chat message six weeks old.
    optin_message: OPTIN_MESSAGE,
  };
}

export async function sendSms(to, body, opts = {}) {
  if (!smsEnabled()) {
    const { missing } = smsStatus();
    throw new Error(`SMS is not configured on this server — missing ${missing.join(', ')}.`);
  }
  const sid = val('TWILIO_ACCOUNT_SID');
  const auth = Buffer.from(`${sid}:${val('TWILIO_AUTH_TOKEN')}`).toString('base64');
  const svc = val('TWILIO_MESSAGING_SERVICE_SID');

  const params = { To: to, Body: body };
  // An explicit From wins over the Messaging Service: Danny's List uses a
  // DEDICATED number so his task thread stays one conversation — the service
  // would send from any number in its pool and split it.
  if (opts.from) params.From = opts.from;
  else if (svc) params.MessagingServiceSid = svc;
  else params.From = val('TWILIO_FROM');

  // TWILIO_API_BASE exists only to point the tests at a stand-in, the same way
  // QBO_API_BASE does. It is never set in production.
  const base = val('TWILIO_API_BASE') || 'https://api.twilio.com';
  const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Twilio's own code and help link are the useful part of the error — the
    // message alone ("The From number is not a valid phone number") rarely
    // says what to change.
    const bits = [payload.message || `Twilio error ${res.status}`];
    if (payload.code) bits.push(`(code ${payload.code})`);
    if (payload.more_info) bits.push(payload.more_info);
    throw new Error(bits.join(' '));
  }
  // A message can be ACCEPTED and still fail at the carrier a moment later.
  // The status is returned so a caller can say "queued" rather than "sent".
  return payload;
}
