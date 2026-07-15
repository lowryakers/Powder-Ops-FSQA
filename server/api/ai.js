import { Router } from 'express';
import { aiEnabled, aiModel, answerQuestion } from '../ai.js';
import { logAudit } from '../db.js';

const router = Router();

// Lets the UI decide whether to show AI affordances. No secrets exposed.
router.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), model: aiEnabled() ? aiModel() : null });
});

// Simple per-process rate limit so the assistant can't be spammed.
const asked = new Map(); // userId -> timestamps[]
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 15;
function rateLimited(userId) {
  const now = Date.now();
  const hits = (asked.get(userId) || []).filter(t => now - t < WINDOW_MS);
  hits.push(now);
  asked.set(userId, hits);
  return hits.length > MAX_PER_WINDOW;
}

// Read-only natural-language query assistant. Admin-only; the model can only
// run guarded SELECT queries (see server/ai.js).
router.post('/ask', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Insufficient permissions' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI features are not configured on this server.' });
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'A question is required.' });
  if (rateLimited(req.user.id)) return res.status(429).json({ error: 'Too many questions — please wait a moment.' });

  try {
    const { answer, used } = await answerQuestion({ question });
    logAudit(req.user, 'ai_query', 'ai', null, { question, queries: used.length }, null, null);
    res.json({ answer, used });
  } catch (e) {
    res.status(502).json({ error: e.message || 'The assistant could not answer that.' });
  }
});

export default router;
