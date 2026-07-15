import { Router } from 'express';
import { aiEnabled, aiModel } from '../ai.js';

const router = Router();

// Lets the UI decide whether to show AI affordances. No secrets exposed.
router.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), model: aiEnabled() ? aiModel() : null });
});

export default router;
