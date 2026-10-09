import { Router } from 'express';
import { getDb } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import {
  SCOPES, createToken, listTokens, revokeToken, ScopeError, rateLimits, WRITE_DRAFT_ALLOW,
} from '../api-tokens.js';
import { APPROVE_ROUTES, APPROVE_SEGMENTS } from '../middleware/no-token-approve.js';

// Managing the bots' API tokens (D-161). Admin-only throughout, and only from a
// SESSION — a token can never mint or revoke a token (requireRole passes a
// non-admin token user nowhere, and a token is never admin by construction).

const router = Router();
router.use(requireRole('admin'));
router.use((req, res, next) => (req.auth?.kind === 'token'
  ? res.status(403).json({ error: 'approve_requires_human_session' }) : next()));

router.get('/', (_req, res) => {
  const db = getDb();
  // The accounts a token may be tied to: active, non-admin, and not a guest
  // client. Listed so the screen offers nothing the server would refuse.
  const accounts = db.prepare(`SELECT id, name, role, department FROM users
    WHERE is_active = 1 AND role != 'admin' AND COALESCE(is_external, 0) = 0 ORDER BY name`).all();
  res.json({
    tokens: listTokens(db),
    accounts,
    scopes: SCOPES,
    limits: rateLimits(),
    write_draft_allow: WRITE_DRAFT_ALLOW.map(r => r.label),
    approve_guard: { segments: APPROVE_SEGMENTS, routes: APPROVE_ROUTES.map(r => r.label) },
  });
});

router.post('/', (req, res) => {
  const db = getDb();
  const b = req.body || {};
  try {
    const { token, plaintext } = createToken(db, {
      userId: b.user_id, label: b.label, scopes: b.scopes, expiresAt: b.expires_at || null,
    }, req.user);
    // The ONLY response that ever carries the clear text.
    res.status(201).json({ token, plaintext });
  } catch (err) {
    if (err instanceof ScopeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

router.post('/:id/revoke', (req, res) => {
  const t = revokeToken(getDb(), req.params.id, req.user);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

export default router;
