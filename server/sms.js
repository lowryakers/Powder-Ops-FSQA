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
  };
}

export async function sendSms(to, body) {
  if (!smsEnabled()) {
    const { missing } = smsStatus();
    throw new Error(`SMS is not configured on this server — missing ${missing.join(', ')}.`);
  }
  const sid = val('TWILIO_ACCOUNT_SID');
  const auth = Buffer.from(`${sid}:${val('TWILIO_AUTH_TOKEN')}`).toString('base64');
  const svc = val('TWILIO_MESSAGING_SERVICE_SID');

  const params = { To: to, Body: body };
  if (svc) params.MessagingServiceSid = svc;
  else params.From = val('TWILIO_FROM');

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
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
