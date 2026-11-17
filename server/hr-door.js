// The HR front door (D-356).
//
// Every employee has one entry in Messages called "HR". What they type there
// goes to the HR team and nobody else: it is a PRIVATE channel `hr--<their user
// id>` whose members are that employee and the HR team. Built on the channel
// machinery that already keeps private channels private — reads, search, Ask,
// sockets and pushes are all membership-scoped — rather than a shared channel
// with a filter, where every one of those paths would be a new place to leak.
import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';
import { HR_PREFIX, isHrDoor, hrDoorOwner } from '../shared/hr-door.js';

const SETTING = 'hr_door_readers';

const parse = (t) => { try { const v = JSON.parse(t || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };

/** The HR team: the stored list, else admins + office/HR supervisors. Never empty while an admin exists. */
export function hrReaders(db) {
  const stored = parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING)?.value);
  const active = (ids) => ids.length ? db.prepare(`SELECT id, name FROM users WHERE is_active = 1 AND COALESCE(is_external,0) = 0
    AND id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids) : [];
  let out = stored ? active(stored) : db.prepare(`SELECT id, name FROM users WHERE is_active = 1 AND COALESCE(is_external,0) = 0 AND name != 'ReadyBot'
      AND (role = 'admin' OR (role IN ('supervisor','admin') AND lower(COALESCE(department,'')) IN ('office','hr'))) ORDER BY name`).all();
  if (!out.length) out = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND role = 'admin' AND name != 'ReadyBot' ORDER BY name").all();
  return { readers: out, configured: !!stored };
}
export const isHrReader = (db, userId) => hrReaders(db).readers.some(r => r.id === userId);

export function setHrReaders(db, ids, actor) {
  const clean = [...new Set((ids || []).map(String))];
  const real = clean.length ? db.prepare(`SELECT id FROM users WHERE is_active = 1 AND COALESCE(is_external,0) = 0 AND id IN (${clean.map(() => '?').join(',')})`).all(...clean).map(r => r.id) : [];
  if (!real.length) return { error: 'Name at least one person for the HR team.' };
  const before = hrReaders(db).readers.map(r => r.name);
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTING, JSON.stringify(real));
  const changed = syncHrDoors(db);
  logAudit(actor, 'update', 'hr_door_readers', SETTING, { before, after: hrReaders(db).readers.map(r => r.name), doors_changed: changed });
  return { ok: true };
}

/** Every door holds exactly its employee + the HR team. Returns how many doors changed. */
export function syncHrDoors(db) {
  const readers = hrReaders(db).readers.map(r => r.id);
  const doors = db.prepare("SELECT id, name FROM chat_channels WHERE name LIKE ? ESCAPE '\\'").all(`${HR_PREFIX.replace(/[-_%]/g, c => '\\' + c)}%`);
  const add = db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, 'member')");
  let changed = 0;
  for (const d of doors) {
    if (!isHrDoor(d.name)) continue;
    const owner = hrDoorOwner(d.name);
    const keep = new Set([owner, ...readers]);
    const have = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(d.id).map(r => r.user_id);
    let touched = false;
    for (const uid of keep) if (!have.includes(uid)) { add.run(uuid(), d.id, uid); touched = true; }
    for (const uid of have) if (!keep.has(uid)) { db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').run(d.id, uid); touched = true; }
    if (touched) changed++;
  }
  return changed;
}

/** The employee's door, made the first time they (or HR moving a message for them) need it. */
export function doorFor(db, userId) {
  const u = db.prepare('SELECT id, name, is_active, is_external FROM users WHERE id = ?').get(userId);
  if (!u || !u.is_active || u.is_external || u.name === 'ReadyBot') return null;
  const name = `${HR_PREFIX}${u.id}`;
  let c = db.prepare('SELECT * FROM chat_channels WHERE name = ?').get(name);
  if (!c) {
    const id = uuid();
    db.prepare("INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, 'private', ?, ?, ?)")
      .run(id, name, 'Private — you and the HR team', u.id);
    c = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
  }
  if (c.archived) db.prepare('UPDATE chat_channels SET archived = 0 WHERE id = ?').run(c.id);
  syncHrDoors(db);
  return db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(c.id);
}

/** What a door is called for the person looking at it. */
export function hrDoorLabel(db, channel, viewerId) {
  const owner = hrDoorOwner(channel.name);
  if (!owner) return null;
  if (owner === viewerId) return { mine: true, owner_id: owner, owner_name: null, display: 'HR' };
  const n = db.prepare('SELECT name FROM users WHERE id = ?').get(owner)?.name || 'someone';
  return { mine: false, owner_id: owner, owner_name: n, display: `HR · ${n}` };
}
