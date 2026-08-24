// Getting an auditor into the evidence binder without a password.
//
// The old instruction — "the auditor signs in as auditor@powder-ops.com and
// sets a password on first sign-in" — could not work: login matches on
// `users.username` or `users.name`, never on an email address, so that string
// returned "User not found". Even once corrected, a username-and-password is
// the wrong credential for a visitor who is here for one day: the account's
// password was never set, the PIN bridge asks for a PIN nobody has, and five
// wrong attempts lock the account for fifteen minutes with the auditor waiting.
//
// A pass is a link instead. It either works or it has been revoked, and neither
// state depends on anybody remembering anything. Same posture as the partner
// portal and the NFP approval links: SHA-256 in the table, clear text returned
// exactly once, expiring, revocable, and audited on every use.
//
// THE PASS DOES NOT WIDEN ANYTHING. Redeeming issues an ordinary session for an
// `auditor` account, so every read afterwards goes through the same role rules
// as an auditor signing in normally — read-only everywhere, writes refused, no
// comms, and App.jsx sends the role straight to the binder from any URL.
import express from 'express';
import { randomBytes, createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { uniqueUsername } from '../usernames.js';
import { issueSession } from './sessions.js';

const router = express.Router();          // admin-only management
export const publicRouter = express.Router(); // the redeem half

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

// An auditor pass is a credential, so the lookup is a single indexed query on
// the hash — not a scan comparing candidates, which is what the flavor-approval
// link does and what the NFP link deliberately moved away from.
function resolvePass(db, raw) {
  const token = String(raw || '').trim();
  if (token.length < 20) return { error: 'That is not a valid auditor pass.' };
  const row = db.prepare('SELECT * FROM auditor_passes WHERE token_hash = ?').get(hashToken(token));
  if (!row) return { error: 'This auditor pass was not recognised. Ask for a new link.' };
  if (row.revoked_at) return { error: 'This auditor pass has been revoked. Ask for a new link.' };
  if (row.expires_at <= new Date().toISOString()) return { error: 'This auditor pass has expired. Ask for a new link.' };
  return { pass: row };
}

// The account a pass signs in as.
//
// It is named for the visitor so the audit trail reads "Carol Pierce" rather
// than a shared "Auditor" that says nothing about who was actually looking. Two
// things keep that account from becoming a second way in:
//
//  * `password_hash` is set to random bytes nobody holds. That is not security
//    theatre — a PIN-less, password-less account is claimable by anyone who
//    types its name at the login screen (`/users/set-password` sets one
//    directly when there is no PIN to confirm). An unguessable hash makes
//    set-password refuse with "Password already set" and makes a password
//    login impossible. The pass is the only door.
//  * the role is `auditor`, which is read-only everywhere by construction.
function auditorAccountFor(db, visitorName, actor) {
  const name = String(visitorName).trim();
  const existing = db.prepare(
    "SELECT * FROM users WHERE role = 'auditor' AND LOWER(name) = LOWER(?) LIMIT 1").get(name);
  if (existing) {
    if (!existing.is_active) {
      db.prepare("UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(existing.id);
    }
    return existing;
  }
  const id = uuid();
  // users.username is UNIQUE, and the visitor's name may well already be on the
  // roster — a consultant who also has a staff account, or simply a second
  // Carol. Inserting the name straight in threw "UNIQUE constraint failed".
  // uniqueUsername() is the roster's own rule for this and returns a free
  // variant; the display NAME still reads exactly as typed, which is what goes
  // on the records. A same-named staff account is deliberately NOT reused: the
  // pass must grant read-only auditor access and nothing that account happens
  // to carry.
  const username = uniqueUsername(db, name) || `${name} ${Date.now().toString(36)}`;
  db.prepare(`INSERT INTO users (id, name, username, role, department, is_active, password_hash, module_access)
              VALUES (?, ?, ?, 'auditor', 'qa', 1, ?, NULL)`)
    .run(id, name, username, `pass:${randomBytes(32).toString('hex')}`);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  logAudit(actor, 'create', 'user', id,
    { reason: 'auditor_pass', note: 'Read-only auditor account created for an audit pass. Signs in by link only.' },
    null, null, name);
  return user;
}

// --- Management (admin only) -------------------------------------------------

router.use(requireRole('admin'));

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.id, p.visitor_name, p.note, p.created_at, p.created_by, p.expires_at,
           p.revoked_at, p.revoked_by, p.last_used_at, p.use_count, u.name AS account_name
    FROM auditor_passes p JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT 50`).all();
  const now = new Date().toISOString();
  res.json(rows.map(r => ({
    ...r,
    status: r.revoked_at ? 'revoked' : (r.expires_at <= now ? 'expired' : 'active'),
  })));
});

router.post('/', (req, res) => {
  const db = getDb();
  const visitor_name = String(req.body?.visitor_name || '').trim();
  const note = String(req.body?.note || '').trim() || null;
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.body?.days, 10) || DEFAULT_DAYS));
  // The name is the whole point of binding a pass to its own account — an
  // unnamed pass would put a shared "Auditor" on every record they opened.
  if (visitor_name.length < 2) {
    return res.status(400).json({ error: "Who is this pass for? The name goes on every record they open." });
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + days);

  // Returned in the clear exactly once. There is nowhere to look it up again,
  // which is the property that makes storing only the hash worth anything.
  const token = randomBytes(32).toString('base64url');
  const id = uuid();

  let created;
  try {
    created = db.transaction(() => {
      const user = auditorAccountFor(db, visitor_name, req.user);
      db.prepare(`INSERT INTO auditor_passes (id, token_hash, visitor_name, user_id, note, created_by, expires_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, hashToken(token), visitor_name, user.id, note, req.user?.name || 'system', expires.toISOString());
      return user;
    })();
  } catch (err) {
    // A database constraint is not a message anybody can act on. Say what went
    // wrong in terms of the thing on screen.
    console.error('[auditor-pass] issue failed:', err.message);
    return res.status(500).json({ error: 'Could not issue the pass. Try a slightly different name, or check the server log.' });
  }

  logAudit(req.user, 'create', 'auditor_pass', id,
    { visitor_name, expires_at: expires.toISOString(), days, note }, null, null, visitor_name);

  res.status(201).json({
    id, visitor_name, note, account_name: created.name,
    expires_at: expires.toISOString(), status: 'active', use_count: 0,
    token, // once
  });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM auditor_passes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pass not found' });
  if (row.revoked_at) return res.status(400).json({ error: 'That pass is already revoked.' });
  db.prepare("UPDATE auditor_passes SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?")
    .run(req.user?.name || 'system', req.params.id);
  logAudit(req.user, 'revoke', 'auditor_pass', row.id,
    { visitor_name: row.visitor_name, used: row.use_count }, null, null, row.visitor_name);
  res.json({ ok: true });
});

// --- Redeem (public) ---------------------------------------------------------

// Public because the holder has no session yet — that is the point. The token
// is the credential and it is checked here before anything is issued.
publicRouter.post('/redeem', (req, res) => {
  const db = getDb();
  const { pass, error } = resolvePass(db, req.body?.token);
  if (error) {
    // Deliberately not logged against a user: there isn't one, and a bad pass
    // is far more often a truncated copy-paste than an attack.
    logAudit('auditor-pass', 'login_failed', 'auditor_pass', null, { reason: 'invalid_pass' });
    return res.status(401).json({ error });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(pass.user_id);
  if (!user) return res.status(401).json({ error: 'The account behind this pass is no longer active.' });

  db.prepare("UPDATE auditor_passes SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE id = ?")
    .run(pass.id);
  logAudit(user, 'login', 'user', user.id,
    { via: 'auditor_pass', pass_id: pass.id, visitor_name: pass.visitor_name }, null, null, user.name);

  // An auditor account never carries a password expiry — it has no password to
  // expire, and PasswordExpiredGate would strand the visitor on a change-your-
  // password screen they can do nothing with.
  res.json(issueSession(db, { ...user, password_changed_at: null }));
});

// Whether a pass is good, without spending it — so the binder can say "this
// link has expired" on the sign-in screen instead of after a failed redeem.
publicRouter.get('/check/:token', (req, res) => {
  const { pass, error } = resolvePass(getDb(), req.params.token);
  if (error) return res.status(404).json({ valid: false, error });
  res.json({ valid: true, visitor_name: pass.visitor_name, expires_at: pass.expires_at });
});

export default router;
