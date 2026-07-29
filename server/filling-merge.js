import { v4 as uuid } from 'uuid';
import { getChannelByName } from './api/comms.js';

// One-time merge of Sticks + Hand Fill into a single Filling team.
//
// The people merge; the equipment does not. Every historical run keeps which
// machine it went through, moved from the team column onto a new `line` tag —
// so "how much did the stick packer do last quarter" is still answerable after
// the teams became one. New lines (auto pouch, sachet, bottling) can be tagged
// the same way without inventing a team for each.
//
// Idempotent throughout: it looks for old values and stops finding them, so a
// redeploy is a no-op. Nothing is deleted except the two emptied channels,
// and those are only removed after their messages have been moved.

const TEAM = 'Filling';
const TEAM_TO_LINE = { 'Stick Pack': 'sticks', 'Hand Fill': 'hand_fill' };
const OLD_DEPARTMENTS = ['sticks', 'hand_fill'];
const NEW_CHANNEL = 'filling-team';
// Both spellings the two channels have gone by.
const OLD_CHANNELS = ['sticks', 'stick pack', 'hand fill', 'hand-fill', 'handfill'];

export function mergeFillingTeam(db) {
  try {
    const done = [];

    // ── Departments and task groups ──────────────────────────────────────────
    for (const [table, col] of [['users', 'department'], ['work_orders', 'task_group'], ['pm_schedules', 'task_group']]) {
      if (!hasColumn(db, table, col)) continue;
      const n = db.prepare(
        `UPDATE ${table} SET ${col} = 'filling' WHERE ${col} IN (${OLD_DEPARTMENTS.map(() => '?').join(',')})`,
      ).run(...OLD_DEPARTMENTS).changes;
      if (n) done.push(`${table}.${col}: ${n}`);
    }

    // ── Production runs: team collapses, the machine becomes a tag ────────────
    for (const table of ['production_entries', 'production_schedule']) {
      if (!hasColumn(db, table, 'team')) continue;
      for (const [oldTeam, line] of Object.entries(TEAM_TO_LINE)) {
        const n = db.prepare(
          `UPDATE ${table} SET team = ?, line = COALESCE(NULLIF(line, ''), ?) WHERE team = ?`,
        ).run(TEAM, line, oldTeam).changes;
        if (n) done.push(`${table} ${oldTeam}→${TEAM}/${line}: ${n}`);
      }
    }

    // Pay roster carries its own team names.
    if (hasColumn(db, 'pay_employees', 'team')) {
      const n = db.prepare("UPDATE pay_employees SET team = ? WHERE team IN ('Stick', 'Sticks', 'Stick Pack', 'Hand Fill')")
        .run(TEAM).changes;
      if (n) done.push(`pay_employees.team: ${n}`);
    }

    const channels = mergeChannels(db);
    if (channels) done.push(channels);

    if (done.length) console.log(`[migrate] Filling merge — ${done.join(', ')}`);
  } catch (e) {
    console.warn('[migrate] Filling merge skipped:', e.message);
  }
}

// Fold both channels into one #filling-team, interleaved by timestamp. Messages
// keep their author, thread parent, reactions and attachments because nothing
// is recreated — only the channel_id moves.
function mergeChannels(db) {
  if (!tableExists(db, 'chat_channels')) return null;

  const olds = db.prepare(
    `SELECT * FROM chat_channels WHERE lower(name) IN (${OLD_CHANNELS.map(() => '?').join(',')})`,
  ).all(...OLD_CHANNELS);
  const existingTarget = getChannelByName(db, NEW_CHANNEL);
  if (!olds.length && existingTarget) return null;   // already merged
  if (!olds.length) return null;                      // nothing to merge

  // Reuse the busiest old channel as the target so the fewest rows move, then
  // rename it. If #filling-team somehow already exists, merge into that.
  const counts = new Map(olds.map(c => [c.id,
    db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ?').get(c.id).n]));
  const target = existingTarget
    || olds.slice().sort((a, b) => counts.get(b.id) - counts.get(a.id))[0];
  const sources = olds.filter(c => c.id !== target.id);

  const moved = { messages: 0, members: 0, channels: 0 };
  db.transaction(() => {
    for (const src of sources) {
      for (const [table, col] of [
        ['chat_messages', 'channel_id'],
        ['chat_attachments', 'channel_id'],
        ['chat_mentions', 'channel_id'],
        ['chat_reminders', 'channel_id'],
      ]) {
        if (!tableExists(db, table) || !hasColumn(db, table, col)) continue;
        const n = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(target.id, src.id).changes;
        if (table === 'chat_messages') moved.messages += n;
      }
      // Members: carry across anyone not already in the target, keeping the
      // later of the two last_read_at marks so nothing reappears as unread.
      if (tableExists(db, 'chat_channel_members')) {
        const incoming = db.prepare('SELECT * FROM chat_channel_members WHERE channel_id = ?').all(src.id);
        const has = db.prepare('SELECT * FROM chat_channel_members WHERE channel_id = ? AND user_id = ?');
        const add = db.prepare(`INSERT INTO chat_channel_members (id, channel_id, user_id, role, last_read_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`);
        const bump = db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE id = ?');
        for (const m of incoming) {
          const existing = has.get(target.id, m.user_id);
          if (!existing) {
            add.run(uuid(), target.id, m.user_id, m.role || 'member', m.last_read_at, m.created_at);
            moved.members++;
          } else if (m.last_read_at && (!existing.last_read_at || m.last_read_at > existing.last_read_at)) {
            bump.run(m.last_read_at, existing.id);
          }
        }
        db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ?').run(src.id);
      }
      db.prepare('DELETE FROM chat_channels WHERE id = ?').run(src.id);
      moved.channels++;
    }
    if (target.name !== NEW_CHANNEL) {
      db.prepare("UPDATE chat_channels SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(NEW_CHANNEL, target.id);
    }
  })();

  return `#${NEW_CHANNEL}: ${moved.messages} messages, ${moved.members} members from ${moved.channels} channel(s)`;
}

const tableExists = (db, name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
const hasColumn = (db, table, col) => {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
};
