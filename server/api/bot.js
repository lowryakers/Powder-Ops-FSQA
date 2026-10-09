import { Router } from 'express';
import { getDb } from '../db.js';
import { rateLimits } from '../api-tokens.js';
import { BOT_ROUTES, PAGE_MAX } from '../bot-api.js';

// GET /api/bot/whoami — a bot's self-check (D-162). Who the token acts as,
// what it may do, when it runs out, and how fast it may call. Answers a session
// too, so a person can see the same shape.
const router = Router();

router.get('/whoami', (req, res) => {
  const u = req.user;
  const token = req.auth?.kind === 'token'
    ? getDb().prepare('SELECT label, token_prefix, scopes, expires_at, created_at FROM api_tokens WHERE id = ?').get(req.auth.tokenId)
    : null;
  res.json({
    auth: req.auth?.kind || 'session',
    user: { id: u.id, name: u.name, role: u.role, department: u.department, module_access: u.module_access || null },
    scopes: req.auth?.kind === 'token' ? req.auth.scopes : null,
    tokenPrefix: token?.token_prefix || null,
    label: token?.label || null,
    expires_at: token?.expires_at || null,
    rate_limits: rateLimits(),
    page_max: PAGE_MAX,
    routes: BOT_ROUTES.map(r => `${r.method} ${r.path}`),
  });
});

export default router;
