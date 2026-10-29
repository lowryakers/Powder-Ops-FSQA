// GET /api/admin/ops-monitor/status (D-259) — admin SESSION only, like the
// webhook's status route (D-251). A bot token is refused even if its account
// were somehow an admin, and there is no route that changes or fires the monitor.
// The body names no URL, key, account id or email.
import express from 'express';
import { getDb } from '../db.js';
import { opsMonitorStatus } from '../ops-monitor.js';

const router = express.Router();

router.get('/status', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.auth?.kind === 'token' || req.user.via_token) return res.status(403).json({ error: 'token_denied', message: 'Only a signed-in admin can read this.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  res.json(opsMonitorStatus(getDb()));
});

export default router;
