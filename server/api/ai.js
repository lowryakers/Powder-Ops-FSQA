import { Router } from 'express';
import { aiEnabled, aiModel, answerQuestion, translateToSpanish, translateCached, proofreadText } from '../ai.js';
import { logAudit } from '../db.js';

const router = Router();

// Lets the UI decide whether to show AI affordances. No secrets exposed.
router.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), model: aiEnabled() ? aiModel() : null });
});

// Translate text/strings to Spanish for a human to review. Editors only.
router.post('/translate', async (req, res) => {
  if (!(req.user?.role === 'admin' || req.user?.role === 'supervisor')) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI features are not configured on this server.' });
  const items = req.body?.items !== undefined ? req.body.items : req.body?.text;
  if (items === undefined || items === null) return res.status(400).json({ error: 'text or items is required' });
  try {
    const out = await translateToSpanish(items);
    logAudit(req.user, 'ai_translate', 'ai', null, { count: Array.isArray(items) ? items.length : 1 }, null, null);
    res.json({ items: out, text: out[0] });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Translation failed' });
  }
});

// Cached content translation for display — available to ANY authenticated user
// (operators included) so the floor view can show task titles/steps in Spanish.
// Never errors the caller: if AI is off or translation fails, the original
// strings come back unchanged (English) and the UI just shows source text.
router.post('/translate-content', async (req, res) => {
  const texts = req.body?.texts;
  const lang = req.body?.lang === 'en' ? 'en' : 'es';
  if (!Array.isArray(texts)) return res.status(400).json({ error: 'texts (array) is required' });
  if (texts.length === 0) return res.json({ translations: [] });
  if (texts.length > 200) return res.status(400).json({ error: 'Too many strings (max 200)' });
  if (!aiEnabled() || lang === 'en') {
    return res.json({ translations: texts.map(s => String(s ?? '')), enabled: aiEnabled() });
  }
  try {
    const translations = await translateCached(texts, lang);
    res.json({ translations, enabled: true });
  } catch {
    res.json({ translations: texts.map(s => String(s ?? '')), enabled: aiEnabled() });
  }
});

// Proofread document/test content — available to any authenticated user (the
// editor UI is only shown to those who can edit documents anyway).
router.post('/proofread', async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: 'AI features are not configured on this server.' });
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const out = await proofreadText(text);
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Proofread failed' });
  }
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
