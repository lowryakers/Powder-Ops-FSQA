// Slack workspace-export importer (Comms Phase 5f). Takes a Slack export .zip
// (users.json, channels.json, and per-channel daily message JSON) and loads the
// history into the chat_* tables. Idempotent: messages carry their Slack ts in
// external_id, so re-importing the same export skips duplicates.
//
// Design decisions agreed with the user:
// - Map authors to existing users by NAME (not email); create any that are missing
//   as active, password-less accounts (they set a password on first login).
// - Public channels only (the user makes everything public before exporting).
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import { getDb } from './db.js';

// Common Slack emoji shortcodes → unicode. Unmapped reactions are skipped rather
// than shown as literal ":name:" text.
const EMOJI_MAP = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', white_check_mark: '✅', heavy_check_mark: '✅',
  heart: '❤️', tada: '🎉', eyes: '👀', pray: '🙏', fire: '🔥', joy: '😂', smile: '😄', smiley: '😃',
  grinning: '😀', sob: '😭', rocket: '🚀', clap: '👏', ok_hand: '👌', wave: '👋', raised_hands: '🙌',
  warning: '⚠️', x: '❌', question: '❓', exclamation: '❗', bulb: '💡', star: '⭐', '100': '💯',
  point_up: '☝️', muscle: '💪', coffee: '☕', beer: '🍺', pizza: '🍕', thinking_face: '🤔', sweat_smile: '😅',
};

function slackTsToIso(ts) {
  const sec = parseFloat(ts);
  if (!isFinite(sec)) return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  return new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// Convert Slack mrkdwn to our plain @mention / #channel / link text.
function cleanText(text, slackUsers) {
  if (!text) return '';
  return String(text)
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id) => '@' + (slackUsers[id]?.name || 'unknown'))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_m, n) => '#' + n)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, u, l) => `${l} (${u})`)
    .replace(/<(https?:[^>]+)>/g, (_m, u) => u)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

export function importSlackExport(buffer, importerUser) {
  const db = getDb();
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const readJson = (name) => {
    const e = entries.find(x => x.entryName === name || x.entryName.endsWith('/' + name));
    if (!e) return null;
    try { return JSON.parse(e.getData().toString('utf8')); } catch { return null; }
  };

  // ── Users: map by display name; create missing ────────────────────────────
  const usersJson = readJson('users.json') || [];
  const slackUsers = {};   // slackId -> { name }
  const userMap = {};      // slackId -> our user id
  let usersCreated = 0;
  const findUser = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)');
  const insUser = db.prepare('INSERT INTO users (id, name, role, department, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const su of usersJson) {
    const displayName = su.profile?.real_name || su.real_name || su.profile?.display_name || su.name;
    slackUsers[su.id] = { name: su.profile?.display_name || displayName };
    if (su.is_bot || su.deleted || !displayName) continue;      // known for text refs, but not import authors
    const existing = findUser.get(displayName) || (su.profile?.display_name ? findUser.get(su.profile.display_name) : null);
    let ourId;
    if (existing) ourId = existing.id;
    else { ourId = uuid(); insUser.run(ourId, displayName, 'operator', 'warehouse'); usersCreated++; }
    userMap[su.id] = ourId;
  }

  // ── Channels: get-or-create public channels by name ───────────────────────
  const channelsJson = readJson('channels.json') || [];
  const channelMap = {};   // slackId -> { id, name }
  let channelsCreated = 0;
  const getChan = db.prepare("SELECT id FROM chat_channels WHERE kind = 'public' AND name = ?");
  const insChan = db.prepare("INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, 'public', ?, ?, ?)");
  for (const sc of channelsJson) {
    if (!sc.name) continue;
    const existing = getChan.get(sc.name);
    let cid;
    if (existing) cid = existing.id;
    else { cid = uuid(); insChan.run(cid, sc.name, sc.purpose?.value || sc.topic?.value || null, importerUser.id); channelsCreated++; }
    channelMap[sc.id] = { id: cid, name: sc.name };
  }

  // ── Messages (+ threads + reactions), per channel, in ts order ────────────
  let messagesImported = 0, skipped = 0;
  const insMsg = db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const existsExt = db.prepare('SELECT id FROM chat_messages WHERE channel_id = ? AND external_id = ?');
  const insReaction = db.prepare('INSERT OR IGNORE INTO chat_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)');
  const KEEP_SUBTYPES = new Set([undefined, null, 'me_message', 'thread_broadcast', 'file_share', 'bot_message']);

  const run = db.transaction(() => {
    for (const sc of channelsJson) {
      const chan = channelMap[sc.id];
      if (!chan) continue;
      const files = entries.filter(e => !e.isDirectory && e.entryName.startsWith(sc.name + '/') && e.entryName.endsWith('.json'));
      let msgs = [];
      for (const f of files) { try { const arr = JSON.parse(f.getData().toString('utf8')); if (Array.isArray(arr)) msgs.push(...arr); } catch { /* skip bad file */ } }
      msgs = msgs.filter(m => (m.type === undefined || m.type === 'message') && m.ts).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

      const tsToId = {};
      for (const m of msgs) {
        if (m.subtype && !KEEP_SUBTYPES.has(m.subtype)) { skipped++; continue; }   // channel_join/leave/etc.
        const uid = userMap[m.user];
        if (!uid) { skipped++; continue; }                                          // unmapped author/bot
        if (existsExt.get(chan.id, m.ts)) { skipped++; continue; }                  // idempotent re-import
        const body = cleanText(m.text, slackUsers) || null;
        const parentId = (m.thread_ts && m.thread_ts !== m.ts) ? (tsToId[m.thread_ts] || null) : null;
        if (!body) { skipped++; continue; }
        const id = uuid();
        insMsg.run(id, chan.id, uid, body, parentId, m.ts, slackTsToIso(m.ts));
        tsToId[m.ts] = id;
        messagesImported++;
        if (Array.isArray(m.reactions)) {
          for (const r of m.reactions) {
            const emoji = EMOJI_MAP[r.name];
            if (!emoji) continue;
            for (const ru of (r.users || [])) { const our = userMap[ru]; if (our) insReaction.run(uuid(), id, our, emoji); }
          }
        }
      }
    }
  });
  run();

  return { usersCreated, channelsCreated, messagesImported, skipped };
}
