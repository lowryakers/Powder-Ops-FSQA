// Approval asks in #ops-requests, and the approver's reply that answers one (D-336).
//
// A bot posts a STRUCTURED ask (`approval_ask` on POST /comms/channels/:id/messages)
// in #ops-requests or #ops-requests-test. When the configured approver replies in
// that thread, from a person's session, with an allowed phrase, the server records
// a RECOGNITION. A bot can read it (GET /comms/messages/:id/ask-status). Nothing
// lets a token create one: there is no write route, and a token's own "approve" is
// an ordinary message.
//
// The rules, each one a refusal somebody asked for by name:
//   - The ask id is the server's (uuid). The category is from a closed list, and
//     whether it is EXCLUDED (money, payments, QBO, Bill Pay, an outside party) is
//     the server's decision. A caller that sends `excluded` is refused.
//   - Only a bot posts an ask, only in the two ops channels by their CURRENT name,
//     never in a DM. OPS_CHANNELS is the constant the webhook already owns.
//   - A reply answers the LATEST ask in its thread that has not been deleted. If
//     that ask is already recognized, or excluded, nothing is recorded — an older
//     ask in the same thread is never approved by a reply aimed at a newer one;
//     the bot asks again.
//   - The approver is a USER ID in app_settings (`ops_thread_approver_user_id`),
//     else OPS_THREAD_APPROVER_USER_ID. Never a name. Unset recognizes nothing.
//   - A person's session only: not a token (even on the approver's account), not a
//     "view as" preview. isBotAccount is NOT used here — it is true for any account
//     that ever held a token, and the approver may one day mint one.
//   - The phrase is exact after normalising: approve · approved · yes approve.
//   - Reactions never count; nothing here is called from the reactions routes.
//   - An edit or a delete of the recognized reply VOIDS the recognition; the ask can
//     then be recognized again by a fresh, unedited reply. Deleting the ask voids
//     and closes it.
// Every function here is best-effort from the caller's point of view: a failure to
// record or void must never fail the message it rides on.
import crypto from 'crypto';
import { logAudit } from './db.js';
import { OPS_CHANNELS, isBotAuthor } from './ops-webhook.js';

import { ASK_CATEGORIES, EXCLUDED_CATEGORIES, isApprovalPhrase } from '../shared/ops-asks.js';

export { ASK_CATEGORIES, EXCLUDED_CATEGORIES, ALLOWED_PHRASES, normalizePhrase, isApprovalPhrase } from '../shared/ops-asks.js';
export const APPROVER_SETTING = 'ops_thread_approver_user_id';

const isOpsChannel = (channel) => !!channel && channel.kind !== 'dm' && OPS_CHANNELS.includes(String(channel.name || ''));

/** The approver's user id: the setting, else the environment, else null. */
export function approverId(db) {
  try {
    const v = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(APPROVER_SETTING)?.value;
    if (v && String(v).trim()) return String(v).trim();
  } catch { /* table always exists; never block a post on it */ }
  const env = String(process.env.OPS_THREAD_APPROVER_USER_ID || '').trim();
  return env || null;
}

/** A person's own session — not a token, not a "view as" preview. */
function isHumanSession(req) {
  return req?.auth?.kind === 'session' && !req.user?.via_token && !req.impersonated;
}

/**
 * Checked BEFORE the message is inserted. Returns null when the body carries no
 * ask, { error } (400) when it carries a bad one, or { category, excluded }.
 */
export function checkAsk(db, req, channel) {
  const raw = req.body?.approval_ask;
  if (raw === undefined || raw === null) return null;
  const refuse = (code, message) => ({ error: { status: 400, body: { error: code, message } } });
  if (typeof raw !== 'object' || Array.isArray(raw)) return refuse('approval_ask_invalid', 'approval_ask must be an object: { "category": "…" }.');
  if (!(req.auth?.kind === 'token' || isBotAuthor(db, req.user, false))) {
    return refuse('approval_ask_bot_only', 'Only a bot posts an approval ask. A person asks in their own words.');
  }
  if (!isOpsChannel(channel)) {
    return refuse('approval_ask_channel', `An approval ask is only taken in #${OPS_CHANNELS.join(' or #')}, never in a DM or another channel.`);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'excluded')) {
    return refuse('approval_ask_excluded_is_server_side', 'Whether an ask is excluded is decided by its category, on the server. Do not send "excluded".');
  }
  const category = String(raw.category || '').trim().toLowerCase();
  const allowed = ASK_CATEGORIES.includes(category);
  const excluded = EXCLUDED_CATEGORIES.includes(category);
  if (!allowed && !excluded) {
    return refuse('approval_ask_category', `Unknown category "${raw.category ?? ''}". Use one of: ${[...ASK_CATEGORIES, ...EXCLUDED_CATEGORIES].join(', ')}.`);
  }
  const parentId = req.body?.parent_id || null;
  if (parentId) {
    const parent = db.prepare('SELECT id, channel_id, parent_id, deleted_at FROM chat_messages WHERE id = ?').get(parentId);
    if (!parent || parent.channel_id !== channel.id || parent.deleted_at || parent.parent_id) {
      return refuse('approval_ask_parent', 'parent_id must be a top-level message in this channel that has not been deleted.');
    }
  }
  return { category, excluded: excluded ? 1 : 0 };
}

/** After the insert: the ask row and its audit entry. */
export function recordAsk(db, req, channel, message, ask) {
  const id = crypto.randomUUID();
  const threadId = message.parent_id || message.id;
  const tokenPrefix = req.auth?.kind === 'token' ? (req.auth.prefix || null) : null;
  db.prepare(`INSERT INTO chat_approval_asks (id, message_id, channel_id, thread_id, category, excluded, created_by, created_at, via_token, token_label)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, message.id, channel.id, threadId, ask.category, ask.excluded, req.user.id, message.created_at,
      req.auth?.kind === 'token' ? 1 : 0, tokenPrefix);
  logAudit(req.user, 'ops_thread_ask_recorded', 'chat_approval_ask', id, {
    ask_id: id, message_id: message.id, channel: channel.name, thread_id: threadId,
    category: ask.category, excluded: !!ask.excluded, token_prefix: tokenPrefix,
  }, null, null, `Ask in #${channel.name}`);
  return { ask_id: id, category: ask.category, excluded: !!ask.excluded, thread_id: threadId };
}

/** The ask a reply in this thread would answer: the latest one not deleted. */
function latestAsk(db, channelId, threadId) {
  return db.prepare(`SELECT a.* FROM chat_approval_asks a JOIN chat_messages m ON m.id = a.message_id
                     WHERE a.channel_id = ? AND a.thread_id = ? AND m.deleted_at IS NULL
                     ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`).get(channelId, threadId);
}

/**
 * After a reply is inserted. Records a recognition when every rule holds; returns
 * { recognized, reason }. Never throws to the caller.
 */
export function maybeRecognize(db, req, channel, reply) {
  try {
    if (!isOpsChannel(channel)) return { recognized: false, reason: 'not_ops_channel' };
    if (!reply.parent_id) return { recognized: false, reason: 'not_a_thread_reply' };
    if (!isHumanSession(req)) return { recognized: false, reason: 'not_a_person' };
    const approver = approverId(db);
    if (!approver) return { recognized: false, reason: 'approver_not_configured' };
    if (reply.user_id !== approver) return { recognized: false, reason: 'not_the_approver' };
    if (!isApprovalPhrase(reply.body)) return { recognized: false, reason: 'not_an_approval_phrase' };
    const ask = latestAsk(db, channel.id, reply.parent_id);
    if (!ask) return { recognized: false, reason: 'no_ask_in_thread' };
    if (ask.excluded) return { recognized: false, reason: 'excluded_category', ask_id: ask.id };
    const live = db.prepare("SELECT 1 FROM chat_approval_recognitions WHERE ask_id = ? AND status = 'recognized'").get(ask.id);
    if (live) return { recognized: false, reason: 'already_recognized', ask_id: ask.id };
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO chat_approval_recognitions (id, ask_id, reply_message_id, recognized_by, recognized_at, reply_text, status)
                VALUES (?, ?, ?, ?, ?, ?, 'recognized')`)
      .run(id, ask.id, reply.id, reply.user_id, reply.created_at, reply.body);
    logAudit(req.user, 'ops_thread_approval_recognized', 'chat_approval_ask', ask.id, {
      ask_id: ask.id, thread_id: ask.thread_id, channel: channel.name, reply_message_id: reply.id,
      approver_user_id: reply.user_id, reply_text: reply.body, category: ask.category,
    }, null, null, `Ask in #${channel.name}`);
    return { recognized: true, ask_id: ask.id };
  } catch (e) {
    console.warn('[ops-thread-asks] recognition skipped:', e.message);
    return { recognized: false, reason: 'error' };
  }
}

/**
 * A message was edited or deleted. A live recognition resting on it as the reply
 * is voided; if it is an ASK that was deleted, its recognitions are voided too.
 */
export function voidForMessage(db, messageId, reason, actor) {
  try {
    const rows = db.prepare(`SELECT r.*, a.channel_id, a.thread_id, a.category FROM chat_approval_recognitions r
                             JOIN chat_approval_asks a ON a.id = r.ask_id
                             WHERE r.status = 'recognized' AND (r.reply_message_id = ? OR (a.message_id = ? AND ? = 'deleted'))`)
      .all(messageId, messageId, reason);
    for (const r of rows) {
      const why = r.reply_message_id === messageId ? reason : 'ask_deleted';
      voidRow(db, r, why, actor);
    }
    return rows.length;
  } catch (e) {
    console.warn('[ops-thread-asks] void skipped:', e.message);
    return 0;
  }
}

function voidRow(db, r, why, actor) {
  db.prepare("UPDATE chat_approval_recognitions SET status = 'voided', voided_at = datetime('now'), void_reason = ? WHERE id = ? AND status = 'recognized'")
    .run(why, r.id);
  logAudit(actor || 'system', 'ops_thread_approval_voided', 'chat_approval_ask', r.ask_id, {
    ask_id: r.ask_id, reply_message_id: r.reply_message_id, void_reason: why,
    reply_text_at_recognition: r.reply_text, category: r.category,
  }, null, null, 'Ask approval voided');
}

/** One ask's state, re-checked against its messages now (a drift is voided and repaired). */
export function askState(db, ask) {
  const askMsg = db.prepare('SELECT deleted_at FROM chat_messages WHERE id = ?').get(ask.message_id);
  let live = db.prepare("SELECT * FROM chat_approval_recognitions WHERE ask_id = ? AND status = 'recognized'").get(ask.id);
  if (live) {
    const reply = db.prepare('SELECT edited_at, deleted_at FROM chat_messages WHERE id = ?').get(live.reply_message_id);
    const drift = !askMsg || askMsg.deleted_at ? 'ask_deleted' : !reply || reply.deleted_at ? 'deleted' : reply.edited_at ? 'edited' : null;
    if (drift) { voidRow(db, { ...live, category: ask.category }, drift, 'system'); live = null; }
  }
  const last = live || db.prepare('SELECT * FROM chat_approval_recognitions WHERE ask_id = ? ORDER BY rowid DESC LIMIT 1').get(ask.id);
  const deleted = !askMsg || !!askMsg.deleted_at;
  const status = deleted ? 'deleted' : live ? 'recognized' : last ? 'voided' : 'open';
  const configured = !!approverId(db);
  const approved = status === 'recognized' && !ask.excluded;
  return {
    ask_id: ask.id, message_id: ask.message_id, thread_id: ask.thread_id, channel_id: ask.channel_id,
    category: ask.category, excluded: !!ask.excluded, status, approved,
    reason: ask.excluded ? 'excluded_category' : deleted ? 'ask_deleted' : !configured && !approved ? 'approver_not_configured' : null,
    recognized_at: last?.recognized_at || null, recognized_by: last?.recognized_by || null,
    reply_message_id: last?.reply_message_id || null, reply_text: last?.reply_text ?? null,
    voided_at: last?.status === 'voided' ? last.voided_at : null, void_reason: last?.status === 'voided' ? last.void_reason : null,
    created_at: ask.created_at,
  };
}

/** The asks a message id names: the ask itself, or every ask in the thread it heads. */
export function asksFor(db, messageId) {
  const rows = db.prepare(`SELECT * FROM chat_approval_asks WHERE message_id = ? OR thread_id = ?
                           ORDER BY created_at ASC, rowid ASC`).all(messageId, messageId);
  return rows.map(a => askState(db, a));
}

/** The compact ask on a serialized message, or null. Cheap: one indexed lookup. */
export function askOnMessage(db, messageId) {
  try {
    const a = db.prepare('SELECT * FROM chat_approval_asks WHERE message_id = ?').get(messageId);
    if (!a) return null;
    const s = askState(db, a);
    return { ask_id: s.ask_id, category: s.category, excluded: s.excluded, thread_id: s.thread_id, status: s.status, approved: s.approved };
  } catch { return null; }
}
