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

// Parse a Slack export .zip without importing — lists the channels (so an admin
// can pick which ones should be restored as private in this tool) and a rough
// message count per channel. Cheap enough for a one-time admin action.
export function previewSlackExport(buffer) {
  const db = getDb();
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const chanEntry = entries.find(x => x.entryName === 'channels.json' || x.entryName.endsWith('/channels.json'));
  const usersEntry = entries.find(x => x.entryName === 'users.json' || x.entryName.endsWith('/users.json'));
  let channelsJson = [];
  let usersJson = [];
  try { if (chanEntry) channelsJson = JSON.parse(chanEntry.getData().toString('utf8')) || []; } catch { /* ignore */ }
  try { if (usersEntry) usersJson = JSON.parse(usersEntry.getData().toString('utf8')) || []; } catch { /* ignore */ }
  const channels = channelsJson.filter(c => c.name).map(sc => {
    const files = entries.filter(e => !e.isDirectory && e.entryName.startsWith(sc.name + '/') && e.entryName.endsWith('.json'));
    let messages = 0;
    for (const f of files) { try { const arr = JSON.parse(f.getData().toString('utf8')); if (Array.isArray(arr)) messages += arr.length; } catch { /* skip */ } }
    return {
      name: sc.name,
      topic: sc.purpose?.value || sc.topic?.value || '',
      members: Array.isArray(sc.members) ? sc.members.length : 0,
      messages,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Author match check: which export people already match an existing user by
  // name, and which would be created new. The export was taken before the user
  // fixed display names, so this lets the admin remap the misses on import.
  const findUser = db.prepare('SELECT id, name FROM users WHERE LOWER(name) = LOWER(?)');
  const users = usersJson.filter(u => !u.is_bot && !u.deleted).map(su => {
    const displayName = su.profile?.real_name || su.real_name || su.profile?.display_name || su.name;
    const hit = (displayName && findUser.get(displayName)) || (su.profile?.display_name ? findUser.get(su.profile.display_name) : null);
    return {
      slack_id: su.id,
      name: displayName || su.name || su.id,
      handle: su.name || '',
      matched: !!hit,
      matched_user_id: hit?.id || null,
      matched_name: hit?.name || null,
    };
  }).sort((a, b) => Number(a.matched) - Number(b.matched) || a.name.localeCompare(b.name));

  return { channels, users, userCount: users.length, unmatchedCount: users.filter(u => !u.matched).length };
}

export function importSlackExport(buffer, importerUser, options = {}) {
  const db = getDb();
  // Names (as they appear in the Slack export) that should be restored as
  // private in this tool — the user flipped these to public only to export.
  const privateNames = new Set((options.privateChannels || []).map(n => String(n).toLowerCase()));
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const readJson = (name) => {
    const e = entries.find(x => x.entryName === name || x.entryName.endsWith('/' + name));
    if (!e) return null;
    try { return JSON.parse(e.getData().toString('utf8')); } catch { return null; }
  };

  // ── Users: map by display name; create missing ────────────────────────────
  // Admin-supplied overrides (slackId → existing user id) win over name-matching
  // — this is how misses from a pre-rename export get pointed at the right user.
  const chosenMap = options.userMap || {};
  const usersJson = readJson('users.json') || [];
  const slackUsers = {};   // slackId -> { name }
  const userMap = {};      // slackId -> our user id
  let usersCreated = 0, usersMapped = 0;
  const findUser = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)');
  const findById = db.prepare('SELECT id FROM users WHERE id = ?');
  const insUser = db.prepare('INSERT INTO users (id, name, role, department, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const su of usersJson) {
    const displayName = su.profile?.real_name || su.real_name || su.profile?.display_name || su.name;
    slackUsers[su.id] = { name: su.profile?.display_name || displayName };
    if (su.is_bot || su.deleted || !displayName) continue;      // known for text refs, but not import authors
    // 1) explicit admin mapping, 2) auto name-match, 3) create new
    const override = chosenMap[su.id] ? findById.get(chosenMap[su.id]) : null;
    const existing = override || findUser.get(displayName) || (su.profile?.display_name ? findUser.get(su.profile.display_name) : null);
    let ourId;
    if (existing) { ourId = existing.id; if (override) usersMapped++; }
    else { ourId = uuid(); insUser.run(ourId, displayName, 'operator', 'warehouse'); usersCreated++; }
    userMap[su.id] = ourId;
  }

  // ── Channels: get-or-create by name, honoring the private designation ─────
  // Channels the user marked private are created (or updated) as private, and
  // their Slack members (mapped to our users) + the importer are added so the
  // channel is actually visible to the right people. Public channels need no
  // membership rows (everyone can see them).
  const channelsJson = readJson('channels.json') || [];
  const channelMap = {};   // slackId -> { id, name, private }
  let channelsCreated = 0, channelsMadePrivate = 0;
  const getChan = db.prepare('SELECT id, kind FROM chat_channels WHERE name = ? ORDER BY (kind = \'dm\') LIMIT 1');
  const insChan = db.prepare('INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, ?, ?, ?, ?)');
  const setPrivate = db.prepare("UPDATE chat_channels SET kind = 'private', updated_at = datetime('now') WHERE id = ?");
  const addChanMember = db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)");
  for (const sc of channelsJson) {
    if (!sc.name) continue;
    const wantPrivate = privateNames.has(String(sc.name).toLowerCase());
    const existing = getChan.get(sc.name);
    let cid;
    if (existing) {
      cid = existing.id;
      if (wantPrivate && existing.kind === 'public') { setPrivate.run(cid); channelsMadePrivate++; }
    } else {
      cid = uuid();
      insChan.run(cid, wantPrivate ? 'private' : 'public', sc.name, sc.purpose?.value || sc.topic?.value || null, importerUser.id);
      channelsCreated++;
      if (wantPrivate) channelsMadePrivate++;
    }
    channelMap[sc.id] = { id: cid, name: sc.name, private: wantPrivate };
    // For private channels, seed membership from the export + the importer.
    if (wantPrivate) {
      addChanMember.run(uuid(), cid, importerUser.id, 'owner');
      for (const sid of (Array.isArray(sc.members) ? sc.members : [])) {
        const our = userMap[sid];
        if (our) addChanMember.run(uuid(), cid, our, 'member');
      }
    }
  }

  // ── Messages (+ threads + reactions), per channel, in ts order ────────────
  let messagesImported = 0, skipped = 0;
  const insMsg = db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const existsExt = db.prepare('SELECT id FROM chat_messages WHERE channel_id = ? AND external_id = ?');
  const insReaction = db.prepare('INSERT OR IGNORE INTO chat_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)');
  const KEEP_SUBTYPES = new Set([undefined, null, 'me_message', 'thread_broadcast', 'file_share', 'bot_message']);
  // Slack channel-management notices ("Lowry made this channel public", topic/
  // purpose/name changes, join/leave). Most carry a subtype and are dropped
  // above, but the privacy-conversion notice can arrive as plain text — this is
  // the safety net so it never lands as a real message.
  const SYSTEM_TEXT = /(made this channel (public|private)|converted (this|to) .*(public|private) channel|set the channel (topic|purpose|name)|(un)?archived this channel|renamed the channel|(has )?(joined|left) the (channel|group|conversation)|added .+ to (this|the) (channel|conversation))/i;

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
        if (m.text && SYSTEM_TEXT.test(m.text)) { skipped++; continue; }            // channel-management notices
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

  return { usersCreated, usersMapped, channelsCreated, channelsMadePrivate, messagesImported, skipped };
}
