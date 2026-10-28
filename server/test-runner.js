// The Test Runner account (D-252): a bot that posts the #ops-requests test
// questions so the bots can be exercised without a person typing each one.
//
// RULES, each load-bearing:
//   - THE ACCOUNT IS KNOWN BY ITS ID, never its name. The seed records the id in
//     `app_settings.test_runner_user_id`; a person renamed "Test Runner" is not it.
//   - EVERYTHING IT CAN DO IS ONE ALLOW LIST (`testRunnerAllows`), checked on every
//     /api request the account makes, token or session alike: read ops-requests-test,
//     post a message or a reply in it, and `GET /bot/whoami`. Anything else is
//     `403 test_runner_scope` — another channel, a reaction, an edit, a delete, a
//     DM, an approve or sign route, every module. Its role does not matter, so
//     somebody promoting it in Settings opens nothing.
//   - It is an operator in the office department with no modules, never in a
//     channel but ops-requests-test (never auto-joined to #general), and has no
//     password. Its token is minted by an admin in Settings → Bot API tokens.
//   - Only in ops-requests-test does the webhook treat its post as a person's
//     (`isTestRunnerPost`), so a test question wakes Procurement the way a real one
//     does. The webhook's own flag still decides whether anything is sent.
import { v4 as uuid } from 'uuid';

export const TEST_RUNNER_NAME = 'Test Runner';
export const TEST_CHANNEL = 'ops-requests-test';
const ID_KEY = 'test_runner_user_id';
const JOINED_KEY = 'test_runner_joined_test_channel';

const setting = (db, key) => {
  try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null; } catch { return null; }
};
const setSetting = (db, key, value) => db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);

export function testRunnerId(db) { return setting(db, ID_KEY); }
export function isTestRunner(db, userId) { const id = testRunnerId(db); return !!id && !!userId && id === userId; }

function testChannel(db) {
  try {
    return db.prepare("SELECT * FROM chat_channels WHERE name = ? AND kind IN ('public','private') AND (archived IS NULL OR archived = 0)").get(TEST_CHANNEL) || null;
  } catch { return null; }
}

/**
 * Create the account once, and put it in ops-requests-test once that channel exists.
 * Every boot; idempotent. A person removing it from the channel is not undone.
 */
export function seedTestRunner(db, log = console) {
  let id = testRunnerId(db);
  if (!id) {
    const clash = db.prepare('SELECT id FROM users WHERE name = ? OR username = ?').get(TEST_RUNNER_NAME, TEST_RUNNER_NAME);
    if (clash) {
      log.warn?.(`[test-runner] an account named "${TEST_RUNNER_NAME}" already exists and is not the seeded one; not created.`);
      return null;
    }
    id = uuid();
    db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, module_access)
      VALUES (?, ?, ?, 'operator', 'office', 1, '{}')`).run(id, TEST_RUNNER_NAME, TEST_RUNNER_NAME);
    setSetting(db, ID_KEY, id);
    log.log?.('[test-runner] account created (no password, no token; mint its token in Settings → Bot API tokens).');
  }
  if (!setting(db, JOINED_KEY)) {
    const ch = testChannel(db);
    if (ch) {
      const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
      db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, 'member', ?)")
        .run(uuid(), ch.id, id, now);
      setSetting(db, JOINED_KEY, now);
      log.log?.(`[test-runner] added to #${TEST_CHANNEL}.`);
    }
  }
  return id;
}

/** Does this request fall inside the Test Runner's allow list? `path` is relative to /api. */
export function testRunnerAllows(db, method, path) {
  const ch = testChannel(db);
  const p = String(path || '').replace(/\/+$/, '');
  if (method === 'GET' && p === '/bot/whoami') return true;
  if (!ch) return false;
  const base = `/comms/channels/${ch.id}`;
  if (method === 'GET' && (p === base || p === `${base}/messages`)) return true;
  if (method === 'POST' && p === `${base}/messages`) return true;
  // Reading a thread or one message in the test channel — the bot's answers.
  const m = method === 'GET' && p.match(/^\/comms\/messages\/([^/]+)(\/thread)?$/);
  if (m) {
    try { return db.prepare('SELECT channel_id FROM chat_messages WHERE id = ?').get(m[1])?.channel_id === ch.id; } catch { return false; }
  }
  return false;
}

/** Mounted on /api after authentication: the Test Runner reaches its allow list and nothing else. */
export function testRunnerGuard(getDb) {
  return (req, res, next) => {
    if (!req.user) return next();
    const db = getDb();
    if (!isTestRunner(db, req.user.id)) return next();
    if (testRunnerAllows(db, req.method, req.path)) return next();
    return res.status(403).json({ error: 'test_runner_scope',
      message: `The Test Runner can only read and post in #${TEST_CHANNEL}.` });
  };
}

/** The webhook's one exception: a Test Runner post in ops-requests-test counts as a person's. */
export function isTestRunnerPost(db, channel, author) {
  return !!channel && channel.name === TEST_CHANNEL && isTestRunner(db, author?.id);
}
