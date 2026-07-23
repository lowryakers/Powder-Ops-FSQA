// Outbound SMS via Twilio's REST API (plain fetch — no SDK dependency).
// Degrades gracefully: without credentials, smsEnabled() is false and callers
// fall back to showing a copyable link instead of texting it.
//
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164, e.g. +15551234567)
// Optional: FLAVOR_APPROVER_PHONE (Danny's number for flavor approvals),
//           APP_BASE_URL (public origin for links; default start.powder-ops.com)

export function smsEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

export function approverPhone() {
  return process.env.FLAVOR_APPROVER_PHONE || null;
}

export function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://start.powder-ops.com').replace(/\/$/, '');
}

export async function sendSms(to, body) {
  if (!smsEnabled()) throw new Error('SMS is not configured on this server.');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }).toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Twilio error ${res.status}`);
  }
  return res.json();
}
