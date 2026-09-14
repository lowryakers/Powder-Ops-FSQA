// The public half of a join link: /join/<token>.
//
// Public by necessity — the person holding it has no account they can sign into
// yet, which is the whole reason the link exists. Same place in the order and
// the same doctrine as the partner portal and the onboarding welcome page.
//
// THE SURFACE IS TWO ROUTES AND IT SAYS ALMOST NOTHING. A GET answers with the
// person's own name and, when there is one, the channel they were invited to —
// enough for the page to read as addressed to them rather than as a stray form.
// It does NOT say what modules this plant runs, who else is in the channel, or
// anything about the roster: a token in a text message is not a session, and
// the reasoning is the same one that makes an external account's refusals 404s.
import express from 'express';
import { getDb, logAudit } from '../db.js';
import { resolveInvite, markInviteUsed } from '../user-invites.js';
import { issueSession } from './sessions.js';
import { hashPassword } from './users.js';

const router = express.Router();
const MIN_PASSWORD = 8;

const channelLabelFor = (db, id) => {
  if (!id) return null;
  const row = db.prepare('SELECT name FROM chat_channels WHERE id = ? AND archived = 0').get(id);
  return row?.name || null;
};

router.get('/:token', (req, res) => {
  const db = getDb();
  const r = resolveInvite(db, req.params.token);
  // A refusal is 200 with a reason, not a 404. The page has to SAY which of
  // used / withdrawn / expired it was — those need three different next steps,
  // and "not found" makes the person ask the office to guess.
  if (!r.ok) return res.json({ ok: false, reason: r.reason });
  res.json({
    ok: true,
    name: r.user.name,
    username: r.user.username || r.user.name,
    channel: channelLabelFor(db, r.invite.channel_id),
    expires_at: r.invite.expires_at,
    min_password: MIN_PASSWORD,
  });
});

router.post('/:token', (req, res) => {
  const db = getDb();
  const password = String(req.body?.password || '');
  const r = resolveInvite(db, req.params.token);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  // ONE TRANSACTION. The password and the spending of the link are one event:
  // a password set against a link still marked unused is a link that works
  // twice, and a link marked used with no password set locks the person out of
  // an account they cannot now be sent a new link for.
  db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ?, pin = NULL, setup_code = NULL, setup_code_expires_at = NULL,
                password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(hashPassword(password), r.user.id);
    markInviteUsed(db, r.invite.id, { ip: req.ip, ua: req.headers['user-agent'] });
  })();

  logAudit(r.user.name, 'set_password', 'user', r.user.id,
    { via: 'join_link', invite_id: r.invite.id }, null, null, r.user.name);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user.id);
  res.json(issueSession(db, fresh, res));
});

export default router;
