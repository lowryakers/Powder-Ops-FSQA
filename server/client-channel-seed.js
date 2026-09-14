// The client coordination channel, seeded once.
//
// M4 Dynamic and Powder Ops manufacture for each other constantly and the
// coordination has been happening across email threads, texts and phone calls —
// which is why the two companies keep arriving at different answers about the
// same order. This is one private channel where it happens in writing.
//
// SEEDED ONCE, GUARDED IN `app_settings`, AND NEVER AGAIN. The candidates-seed
// rule: a redeploy must never resurrect somebody who was removed from the
// channel, or re-open a channel that was archived. The guard is a marker, not a
// count of rows — "does the channel have members" would undo a deliberate
// removal on the next deploy.
//
// NO PASSWORD IS SET, HERE OR ANYWHERE. Each account is created signed-out with
// no password and no setup code; the office issues a code from Settings →
// Users → Reset password and hands it to that person, who then chooses their
// own. That is the same first-sign-in path every employee takes, and it means
// this file contains no credential to leak.
import { v4 as uuid } from 'uuid';
import { uniqueUsername, deriveUsername } from './usernames.js';
import { clientChannelGuide, isClientChannel } from '../shared/client-channels.js';
import { WIP_DEFINITION, WIP_LIMIT } from '../shared/client-channels.js';

const CHANNEL = 'client--m4';

const TOPIC = `Release: BOM confirmed · all materials on-site · WIP≤${WIP_LIMIT} (${WIP_DEFINITION}). `
  + 'Guide pinned. No schedule from chat. Exceptions: Lowry only.';

// The Account Manager. THE DISPLAY NAME IS "Alex" AND NOTHING ELSE — never
// "bot", "agent" or a product name, in the member list, the byline or anywhere
// a person reads it. A client talking to something labelled automated stops
// writing the detail that makes the channel worth having.
const ACCOUNT_MANAGER = { name: 'Alex', department: 'office', title: 'Account Manager' };

// M4 Dynamic's people. THE COMPANY IS A COLUMN, NOT A SUFFIX ON THE NAME.
// The plant has its own Matt (Formulations) and a member list with two of them
// is the ambiguity every other part of this codebase refuses — but writing it
// as "Matt (M4 Dynamic)" put the company inside the one string the person
// SIGNS IN WITH, and `deriveUsername` turned that into the sign-in name
// `Matt Dynamic)`. The name is the person; `users.external_org` is the company,
// shown beside it wherever a plant person reads a roster.
const ORG = 'M4 Dynamic';
const CLIENT_PEOPLE = [
  { name: 'Matt', org: ORG, email: 'matt@m4dynamic.com' },
  { name: 'Jean Salcedo', org: ORG, email: 'projects@m4dynamic.com' },
  { name: 'Cristian', org: ORG, email: 'ops@m4dynamic.com' },
  { name: 'Sophie', org: ORG, email: 'sophie@m4dynamic.com' },
  { name: 'M4 Purchasing', org: ORG, email: 'buyer@m4dynamic.com' },
  // `coordinator@m4dynamic.com` is optional and is deliberately NOT seeded —
  // an account nobody asked for is one nobody signs into, and adding it later
  // in Settings takes a minute.
];

// The Powder Ops side, matched against the roster that already exists — these
// are real accounts and are never created here. Matched on the first word of
// the name (the env-limits precedent) rather than an exact string, because the
// roster carries full legal names.
//
// Matched on the first word of the name OR on the local part of the work email,
// because one of the two is nearly always right and neither alone is: the
// roster carries full legal names, and a name can be recorded as an initial
// ("Adam B.") while the address is plain.
//
// DANNY IS NOT ON THIS LIST AND MUST NOT BE ADDED. That was stated when the
// channel was specified; it is a decision about who talks to the client, not an
// oversight, so it is written down rather than left to be noticed.
const PLANT_MEMBERS = ['lowry', 'adam', 'jake'];

// A NAMED PERSON WHO IS NOT ON THE ROSTER IS REPORTED, NEVER GUESSED AT.
// Nothing here creates a Powder Ops account — these are real employees who
// already have one — so a miss means the name is spelled differently, and
// adding a second account for the same person would be worse than the gap. The
// misses are written to `app_settings` as well as the boot log, so "who is
// still not in the channel" is answerable without shell access, and an admin
// adds them from the channel's member list in one click.
const plantMatch = (u, key) =>
  new RegExp(`^${key}\\b`, 'i').test(u.name || '') ||
  String(u.email || '').toLowerCase().split('@')[0] === key;

const setting = (db, key) => {
  try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null; }
  catch { return null; }
};

function makeAccount(db, { name, email, department, external, org }) {
  const existing = email
    ? db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email)
    : db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (existing) return existing;
  const id = uuid();
  // module_access NULL is this app's own way of writing "Messages only" — an
  // account with no map gets no ReadyDoc module at all and a welcome screen
  // with an Open Messages button. No Production, no Accounting, no AP Drop, no
  // Partner Reconciliation, no Procurement, and nothing to forget to un-tick.
  db.prepare(`INSERT INTO users (id, name, username, email, role, department, is_active, is_external, external_org, module_access)
              VALUES (?, ?, ?, ?, 'operator', ?, 1, ?, ?, NULL)`)
    .run(id, name, uniqueUsername(db, name, null), email || null, department || 'client',
      external ? 1 : 0, external ? (org || null) : null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * Create the M4 coordination channel, its roster and its pinned guide — once.
 * Safe to call on every boot; does nothing after the first.
 * @returns {{seeded: boolean, channel_id?: string, members?: number, missing?: string[]}}
 */
export function seedClientChannels(db) {
  try {
    if (setting(db, 'client_channels_seeded')) return { seeded: false };

    const alex = makeAccount(db, { ...ACCOUNT_MANAGER, external: false });
    const clients = CLIENT_PEOPLE.map(p => makeAccount(db, { ...p, external: true }));

    const roster = db.prepare("SELECT * FROM users WHERE is_active = 1 AND name != 'ReadyBot' AND role != 'auditor' ORDER BY name").all();
    const plant = [];
    const missing = [];
    for (const key of PLANT_MEMBERS) {
      const row = roster.find(u => plantMatch(u, key));
      if (row) plant.push(row); else missing.push(key);
    }

    let channel = db.prepare('SELECT * FROM chat_channels WHERE name = ?').get(CHANNEL);
    if (!channel) {
      const id = uuid();
      db.prepare(`INSERT INTO chat_channels (id, kind, name, topic, created_by, post_policy, is_default)
                  VALUES (?, 'private', ?, ?, ?, 'all', 0)`).run(id, CHANNEL, TOPIC, alex.id);
      channel = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
    }

    const add = db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)");
    add.run(uuid(), channel.id, alex.id, 'member');
    for (const u of plant) add.run(uuid(), channel.id, u.id, 'owner');
    for (const u of clients) add.run(uuid(), channel.id, u.id, 'member');

    // The guide is posted and PINNED. Posted alone it is the first message,
    // which is read by whoever was in the channel that day and by none of the
    // people who join next week — and those are exactly the people it is
    // written for. Inserted directly rather than through `postMessageAs` so a
    // boot does not push a notification to everyone at once.
    const already = db.prepare('SELECT COUNT(*) c FROM chat_messages WHERE channel_id = ?').get(channel.id).c;
    if (!already) {
      const mid = uuid();
      const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
      db.prepare(`INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, created_at, pinned_at, pinned_by)
                  VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`)
        .run(mid, channel.id, alex.id, clientChannelGuide(), now, now, alex.id);
    }

    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('client_channels_seeded', ?)")
      .run(new Date().toISOString());
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('client_channels_seed_missing', ?)")
      .run(JSON.stringify(missing));
    const members = db.prepare('SELECT COUNT(*) c FROM chat_channel_members WHERE channel_id = ?').get(channel.id).c;
    console.log(`[seed] ${CHANNEL}: ${members} member(s)`
      + (missing.length ? ` — NOT FOUND on the roster and NOT added: ${missing.join(', ')}. An admin adds them from the channel's member list.` : ''));
    return { seeded: true, channel_id: channel.id, members, missing };
  } catch (e) {
    console.warn('[seed] client channel:', e.message);
    return { seeded: false, error: e.message };
  }
}


/**
 * The company comes OUT of the name and into its own column — once.
 *
 * The first client accounts were created as "Matt (M4 Dynamic)" to tell them
 * from the plant's own Matt. That was the right instinct and the wrong place:
 * `users.name` is what a person signs in with and what the login screen calls
 * "first and last name", so the account Matt was texted a link for had the
 * sign-in name **`Matt Dynamic)`** — `deriveUsername` takes the first and last
 * word, and the last word was half a parenthesis.
 *
 * This moves the parenthetical to `external_org` and leaves the person's name
 * as their name. It runs on every boot and finds nothing after the first,
 * because a name with no parenthesis matches nothing.
 *
 * Three things it will not do:
 *   - touch an account that is not `is_external`. A plant employee with a
 *     parenthesis in their name has it for some other reason.
 *   - overwrite an `external_org` somebody has already set.
 *   - create an ambiguity. If the shortened name is already another account's
 *     name or sign-in name, the row is REPORTED and left exactly as it is —
 *     two people answering to one sign-in is worse than an ugly one.
 *
 * The sign-in name follows the name only when it was still the auto-derived
 * one (the `usernames.js` rule): a username an admin set by hand is a
 * decision.
 */
export function repairClientAccountNames(db) {
  const rows = (() => {
    try { return db.prepare('SELECT id, name, username, external_org FROM users WHERE is_external = 1').all(); }
    catch { return []; }
  })();
  const fixed = [];
  const skipped = [];
  const upd = db.prepare('UPDATE users SET name = ?, username = ?, external_org = ? WHERE id = ?');
  const clash = db.prepare('SELECT id FROM users WHERE (LOWER(name) = LOWER(?) OR LOWER(username) = LOWER(?)) AND id != ?');
  db.transaction(() => {
    for (const u of rows) {
      const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(u.name || '');
      if (!m) continue;
      const [, person, org] = [m[0], m[1].trim(), m[2].trim()];
      if (!person) continue;
      if (clash.get(person, person, u.id)) {
        skipped.push({ name: u.name, reason: `"${person}" is already another account's name or sign-in name` });
        continue;
      }
      const wasDerived = (u.username || '') === deriveUsername(u.name);
      const username = wasDerived ? (uniqueUsername(db, person, u.id) || u.username) : u.username;
      upd.run(person, username, u.external_org || org, u.id);
      fixed.push({ from: u.name, to: person, org: u.external_org || org, username });
    }
  })();
  for (const f of fixed) {
    console.log(`[seed] Client accounts: "${f.from}" is now ${f.to} of ${f.org} (signs in as ${f.username})`);
  }
  for (const s of skipped) console.warn(`[seed] Client accounts: kept "${s.name}" — ${s.reason}`);
  return { fixed, skipped };
}

export { CHANNEL as CLIENT_M4_CHANNEL, TOPIC as CLIENT_M4_TOPIC, isClientChannel };
