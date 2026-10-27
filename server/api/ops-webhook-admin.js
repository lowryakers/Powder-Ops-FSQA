// GET /api/admin/ops-webhook/status (D-251) — admin SESSION only. A bot token is
// refused even if its account were somehow an admin: the token never sees the
// webhook's state and there is no route here that changes it. No URL, no key.
import express from 'express';
import { getDb } from '../db.js';
import { opsWebhookStatus } from '../ops-webhook.js';

const router = express.Router();

router.get('/status', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.auth?.kind === 'token' || req.user.via_token) return res.status(403).json({ error: 'token_denied', message: 'Only a signed-in admin can read this.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  res.json(opsWebhookStatus(getDb()));
});

export default router;
