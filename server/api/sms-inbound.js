// Inbound SMS webhook (Twilio "A message comes in") — the text-to-AI layer.
// Danny texts a question to the Powder Ops number; the read-only AI data
// assistant (same engine as admin Ask AI) answers by SMS.
//
// Security model:
//  - Every request must carry a valid X-Twilio-Signature (HMAC of the exact
//    public webhook URL + params with our auth token), so only Twilio can
//    invoke this endpoint.
//  - Only allowlisted senders get answers (FLAVOR_APPROVER_PHONE for now);
//    texts from unknown numbers are acknowledged and silently dropped.
//  - Answers go through answerQuestion(), which is restricted to read-only
//    SELECTs with sensitive tables/columns filtered.
//
// Twilio console setup (one-time): Phone Numbers → your number → Messaging →
// "A message comes in" → Webhook, HTTP POST, URL:
//   https://start.powder-ops.com/api/sms/inbound
// (Must match APP_BASE_URL exactly — the signature is computed over this URL.)

import { Router } from 'express';
import crypto from 'crypto';
import { aiEnabled, answerQuestion } from '../ai.js';
import { smsEnabled, sendSms, approverPhone, appBaseUrl } from '../sms.js';
import { logAudit } from '../db.js';

const router = Router();

// X-Twilio-Signature = base64(HMAC-SHA1(auth_token, url + sorted(key+value)))
function validSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers['x-twilio-signature'];
  if (!token || !sig) return false;
  const url = `${appBaseUrl()}/api/sms/inbound`;
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest();
  let given;
  try { given = Buffer.from(String(sig), 'base64'); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Compare numbers by their last 10 digits so +1 / formatting differences
// between the env var and Twilio's E.164 don't break the allowlist.
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
function knownSender(from) {
  const danny = approverPhone();
  if (danny && last10(danny) && last10(danny) === last10(from)) return 'Danny';
  return null;
}

router.post('/inbound', (req, res) => {
  if (!validSignature(req)) return res.status(403).type('text/xml').send('<Response></Response>');
  const from = req.body?.From || '';
  const body = String(req.body?.Body || '').trim();
  // Ack immediately (empty TwiML) — the answer can take longer than Twilio's
  // webhook timeout, so it goes back via the REST API instead of the reply.
  res.type('text/xml').send('<Response></Response>');

  const who = knownSender(from);
  if (!who || !body || !smsEnabled()) return;
  (async () => {
    try {
      logAudit(`sms:${who}`, 'create', 'sms_query', null, { question: body.slice(0, 300) });
      if (!aiEnabled()) {
        await sendSms(from, 'ReadyDoc: the AI assistant is not configured right now — ask Lowry.');
        return;
      }
      const { answer } = await answerQuestion({ question: body });
      const text = (answer || '').trim().slice(0, 1200) || 'I could not find an answer to that.';
      await sendSms(from, text);
    } catch (e) {
      console.warn('[sms] inbound answer failed:', e.message);
      try { await sendSms(from, 'ReadyDoc: sorry, I hit an error answering that. Try rephrasing.'); } catch { /* give up */ }
    }
  })();
});

export default router;
