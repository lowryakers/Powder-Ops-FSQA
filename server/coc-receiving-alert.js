// A DELIVERY'S COC / COA IS FILED → THE DOCK IS TOLD (D-392, A-20261125-002 / -003).
//
// When a certificate of compliance or a COA is filed in the supplier library
// (D-391) with the PO it covers, ReadyBot posts ONE message in the receiving
// channel: who it is from, the PO, the parts, lots and quantity, a mismatch
// warning when the filer wrote one, and a link to the supplier's documents.
// The dock reads #receiving--shipping; it does not read Lowry's inbox.
//
// - The channel is an ADMIN SETTING (`app_settings.receiving_alert_channel_id`),
//   never a UUID in code. Unset, gone or archived ⇒ nothing is posted and the
//   upload still succeeds; the response says why.
// - Never a DM, a client channel or an HR door: those are private by rule.
// - One message per upload call, however many files it carried.
// - Best-effort: a chat failure never fails the filing.
import { postMessageAs, getBotUser } from './api/comms.js';
import { readyDocOrigin } from './links.js';
import { FILE_KIND_LABEL } from '../shared/supplier-documents.js';
import { isClientChannel } from '../shared/client-channels.js';
import { isHrDoor } from '../shared/hr-door.js';

export const ALERT_SETTING = 'receiving_alert_channel_id';
export const ALERT_KINDS = ['coc', 'coa'];

const KIND_TEXT = { coc: 'Certificate of compliance', coa: 'Certificate of analysis' };

/** Why a channel cannot carry the alert, or null. */
export function channelRefusal(ch) {
  if (!ch) return 'That channel does not exist.';
  if (ch.kind === 'dm') return 'A direct message cannot carry the receiving alert.';
  if (isClientChannel(ch.name)) return 'A client channel cannot carry the receiving alert.';
  if (isHrDoor(ch.name)) return 'An HR channel cannot carry the receiving alert.';
  if (ch.archived) return 'That channel is archived.';
  return null;
}

/** The configured channel row, or { channel: null, reason }. */
export function alertChannel(db) {
  const id = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ALERT_SETTING)?.value || null;
  if (!id) return { channel: null, channel_id: null, reason: 'no_channel_set' };
  const ch = db.prepare('SELECT id, kind, name, archived FROM chat_channels WHERE id = ?').get(id);
  const refusal = channelRefusal(ch);
  if (refusal) return { channel: null, channel_id: id, reason: ch ? (ch.archived ? 'channel_archived' : 'channel_not_allowed') : 'channel_missing' };
  return { channel: ch, channel_id: id, reason: null };
}

/** The channels an admin may pick: not a DM, client channel or HR door, not archived. */
export function alertChannelOptions(db) {
  return db.prepare("SELECT id, kind, name, archived FROM chat_channels WHERE kind != 'dm' AND archived = 0 ORDER BY name COLLATE NOCASE")
    .all().filter(c => !channelRefusal(c)).map(c => ({ id: c.id, name: c.name, kind: c.kind }));
}

/** Does this filing call for the alert? */
export function wantsAlert({ kind, po_number, notify_receiving } = {}) {
  if (!ALERT_KINDS.includes(kind) || !String(po_number || '').trim()) return false;
  return !(notify_receiving === false || String(notify_receiving).toLowerCase() === 'false');
}

/**
 * The message text (PURE). `*bold*` is the chat renderer's bold, and
 * `[label](url)` its link grammar.
 */
export function formatReceivingAlert({ origin = '', supplier, kind, files = [], po_number, part_number, lot_number, qty_note, mismatch_note }) {
  const kindLabel = KIND_TEXT[kind] || FILE_KIND_LABEL[kind] || 'Document';
  const head = mismatch_note
    ? `⚠️ *${supplier.name} · ${po_number} — ${kindLabel} on file (CHECK MISMATCH)*`
    : `📄 *${supplier.name} · ${po_number} — ${kindLabel} on file, OK to receive*`;
  const lines = [head, `Part: ${part_number || '—'} · Lot: ${lot_number || '—'} · Qty: ${qty_note || '—'}`];
  if (mismatch_note) lines.push(`Mismatch: ${mismatch_note}`);
  if (files.length) lines.push(`File${files.length === 1 ? '' : 's'}: ${files.map(f => f.filename).join(', ')}`);
  lines.push(`[Open in Supplier Docs](${origin}/?tab=suppliers&supplier=${encodeURIComponent(supplier.id)})`);
  return lines.join('\n');
}

/**
 * Post the alert. Never throws. Returns { posted, channel_id, reason?, message_id? }.
 */
export async function notifyReceivingDocument(db, fields) {
  try {
    const { channel, channel_id, reason } = alertChannel(db);
    if (!channel) {
      if (reason !== 'no_channel_set') console.warn(`[receiving-alert] not posted: ${reason}`);
      return { posted: false, channel_id, reason };
    }
    const text = formatReceivingAlert({ origin: readyDocOrigin(), ...fields });
    const msg = await postMessageAs(db, channel, getBotUser(db), text);
    return msg ? { posted: true, channel_id, message_id: msg.id } : { posted: false, channel_id, reason: 'not_posted' };
  } catch (e) {
    console.warn('[receiving-alert] failed:', e.message);
    return { posted: false, channel_id: null, reason: 'error' };
  }
}
