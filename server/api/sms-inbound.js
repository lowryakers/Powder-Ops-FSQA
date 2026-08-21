// Inbound SMS webhook (Twilio "A message comes in") — the text-to-AI layer.
// Danny texts a question to the Powder Ops number; the read-only AI data
// assistant (same engine as admin Ask AI) answers by SMS.
//
// Security model:
//  - Every request must carry a valid X-Twilio-Signature (HMAC of the exact
//    public webhook URL + params with our auth token), so only Twilio can
//    invoke this endpoint.
//  - Only allowlisted senders get answers. The allowlist is the USER ROSTER:
//    an account with a phone number AND `sms_access = 1`, granted in Settings.
//    FLAVOR_APPROVER_PHONE still works so Danny keeps answering before anyone
//    is set up. Texts from unknown numbers are acknowledged and dropped in
//    silence — telling an unknown caller "you are not authorised" confirms the
//    number reaches something worth probing.
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
import { smsEnabled, sendSms, approverPhone } from '../sms.js';
import { handleDannyInboundSms } from './danny.js';
import { applyFlavorReplyText } from './submit.js';
import { appBaseUrl } from '../links.js';
import { getDb, logAudit } from '../db.js';

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
// Who is texting, or null. Matching is on the last 10 digits so +1 and
// formatting differences between what someone typed in Settings and Twilio's
// E.164 don't quietly break the allowlist.
//
// `sms_access` is what authorises an answer — NOT merely having a phone number
// on the account. A number is a contact detail; being able to ask the system
// questions by text is a grant, and it defaults to off.
function knownSender(from) {
  const digits = last10(from);
  if (!digits) return null;
  try {
    const rows = getDb().prepare(
      "SELECT name, phone FROM users WHERE is_active = 1 AND sms_access = 1 AND phone IS NOT NULL AND phone != ''"
    ).all();
    const hit = rows.find(u => last10(u.phone) === digits);
    if (hit) return hit.name;
  } catch (e) {
    // A schema problem must not take the webhook down; fall through to the env.
    console.warn('[sms] sender lookup failed:', e.message);
  }
  // The original single-number allowlist, kept so texting works before anybody
  // has been given access in Settings.
  const danny = approverPhone();
  if (danny && last10(danny) && last10(danny) === digits) return 'Danny';
  return null;
}

router.post('/inbound', (req, res) => {
  if (!validSignature(req)) return res.status(403).type('text/xml').send('<Response></Response>');
  const from = req.body?.From || '';
  const to = req.body?.To || '';
  const body = String(req.body?.Body || '').trim();
  // Ack immediately (empty TwiML) — the answer can take longer than Twilio's
  // webhook timeout, so it goes back via the REST API instead of the reply.
  res.type('text/xml').send('<Response></Response>');

  // ── The Danny's List number is its own conversation ──
  // A second dedicated number keeps his task thread apart from his question
  // thread. Anything arriving ON that number is a task reply: stored verbatim
  // (MMS payment screenshots included) and filed by a person — never parsed
  // into a decision, never routed to the AI. Only his own number is heard;
  // anything else is acked and dropped in the usual silence.
  const dannyFrom = (process.env.DANNY_SMS_FROM || '').replace(/\D/g, '').slice(-10);
  if (dannyFrom && last10(to) === dannyFrom) {
    const expected = last10((process.env.DANNY_SMS_TO || '').trim() || approverPhone());
    if (!expected || last10(from) !== expected) return;
    (async () => {
      try {
        const media = [];
        const n = parseInt(req.body?.NumMedia || '0', 10) || 0;
        for (let i = 0; i < n; i++) if (req.body[`MediaUrl${i}`]) media.push(req.body[`MediaUrl${i}`]);
        const id = await handleDannyInboundSms(getDb(), last10(from), body, media);
        // The robot number must not be a void — with no human on this thread,
        // silence after a reply reads as "it didn't work".
        if (id && smsEnabled()) await sendSms(from, 'Got it — on the list.', { from: (process.env.DANNY_SMS_FROM || '').trim() });
      } catch (e) { console.warn('[sms] danny inbound failed:', e.message); }
    })();
    return;
  }

  const who = knownSender(from);
  if (!who || !body || !smsEnabled()) return;
  (async () => {
    try {
      // "Approve FA-12" texted back to the link's own thread is a decision,
      // not a question — tried FIRST, and only the exact pattern matches, so
      // every ordinary question still reaches the assistant.
      const flavorOut = await applyFlavorReplyText(getDb(), last10(from), body, who === 'Danny' ? 'Danny Augustyn' : who);
      if (flavorOut) {
        if (flavorOut.reply) await sendSms(from, flavorOut.reply);
        return;
      }
      logAudit(`sms:${who}`, 'create', 'sms_query', null, { question: body.slice(0, 300) });
      if (!aiEnabled()) {
        await sendSms(from, 'ReadyDoc: the AI assistant is not configured right now — ask Lowry.');
        return;
      }
      const { answer, used } = await answerQuestion({ question: body });
      const text = (answer || '').trim().slice(0, 1200) || 'I could not find an answer to that.';
      await sendSms(from, text);
      logAudit(`sms:${who}`, 'update', 'sms_query', null, { answered: true, queries: used?.length ?? 0 });
    } catch (e) {
      // SAY WHAT WENT WRONG. "Try rephrasing" was a guess dressed as advice: it
      // is the right answer for a question the assistant could not parse and
      // the wrong one for an expired API key, and the two are indistinguishable
      // from the phone. The reason goes to the sender — who is allowlisted
      // staff, not the public — and into the audit log, so it is answerable
      // without shell access to the server.
      const reason = String(e?.message || 'unknown error').replace(/\s+/g, ' ').slice(0, 140);
      console.warn('[sms] inbound answer failed:', reason);
      logAudit(`sms:${who}`, 'update', 'sms_query', null, { answered: false, error: reason });
      try { await sendSms(from, `ReadyDoc: couldn't answer that — ${reason}`); } catch { /* give up */ }
    }
  })();
});

export default router;
