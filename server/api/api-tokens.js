import { Router } from 'express';
import { getDb } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import {
  SCOPES, TOKEN_GRANTS, createToken, listTokens, revokeToken, updateScopes, updateGrants, ScopeError, rateLimits,
} from '../api-tokens.js';
import { APPROVE_ROUTES, APPROVE_SEGMENTS, TOKEN_DENY } from '../middleware/no-token-approve.js';
import { WRITE_AREAS } from '../bot-api.js';
import { botApprovalReport } from '../bot-approval-report.js';

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
    grants: Object.entries(TOKEN_GRANTS).map(([key, description]) => ({ key, description })),
    limits: rateLimits(),
    write_areas: WRITE_AREAS.map(r => ({ area: r.area, label: r.label, bulk: !!r.bulk, grant: r.grant || null })),
    token_deny: TOKEN_DENY.map(r => ({ category: r.category, label: r.label })),
    approve_guard: { segments: APPROVE_SEGMENTS, routes: APPROVE_ROUTES.map(r => r.label) },
  });
});

// Has a bot ever approved anything, and what can each token approve (D-279)?
// Read-only: writes nothing, not even an audit row.
router.get('/approval-check', (_req, res) => res.json(botApprovalReport(getDb())));

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

// Edit a live token's scopes (D-165). Admin session only, like minting; a token
// never reaches this (TOKEN_DENY refuses /api-tokens on every method, and the
// router-level guard above is the second statement of it).
router.post('/:id/scopes', (req, res) => {
  try {
    const t = updateScopes(getDb(), req.params.id, req.body?.scopes, req.user);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  } catch (err) {
    if (err instanceof ScopeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Give or take a GRANT (D-171) — an extra write area for one token. Admin
// session only, the same door as scopes.
router.post('/:id/grants', (req, res) => {
  try {
    const t = updateGrants(getDb(), req.params.id, req.body?.grants, req.user);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
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
