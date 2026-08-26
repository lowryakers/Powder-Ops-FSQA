import { Router } from 'express';
import { getDb } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import {
  KIOSKS, MODES, kioskMode, setKioskMode, issueToken, revokeToken,
  listTokens, untokenedHits, resetUntokened,
} from '../kiosk-tokens.js';

// Managing the keys that bind a QR poster to its kiosk.
//
// Admin-only throughout. Issuing a key is what makes a printed poster work and
// revoking one is what stops it, so this is the same class of act as issuing an
// auditor pass — not something a supervisor should reach by having a module.

const router = Router();
router.use(requireRole('admin'));

router.get('/', (_req, res) => {
  const db = getDb();
  const tokens = listTokens(db);
  const hits = untokenedHits(db);
  res.json({
    mode: kioskMode(db),
    modes: MODES,
    kiosks: KIOSKS.map(k => ({
      ...k,
      // "Is this poster covered" is the question the screen has to answer, and
      // it is about LIVE keys — a revoked one is history, not coverage.
      live: tokens.filter(t => t.slug === k.slug && !t.revoked_at).length,
      untokened_requests: hits[k.slug] || 0,
    })),
    tokens,
    untokened_total: Object.entries(hits).filter(([k]) => !k.startsWith('_'))
      .reduce((n, [, v]) => n + v, 0),
    untokened_last_at: hits._last_at || null,
  });
});

router.post('/mode', (req, res) => {
  const db = getDb();
  const mode = String(req.body?.mode || '');
  if (!MODES.includes(mode)) return res.status(400).json({ error: `Mode must be one of ${MODES.join(', ')}.` });
  // REFUSING TO BREAK THE FLOOR. Switching to `on` while a kiosk has no live
  // key takes that poster down the moment somebody scans it, and the person
  // holding the phone cannot fix it. The count of untokened requests is a
  // warning, not a block — a poster may simply not have been scanned yet — but
  // a kiosk with no key at all is a certainty, so that one is refused.
  if (mode === 'on') {
    const tokens = listTokens(db).filter(t => !t.revoked_at);
    const uncovered = KIOSKS.filter(k => !tokens.some(t => t.slug === k.slug));
    if (uncovered.length) {
      return res.status(400).json({
        error: `Issue a key for ${uncovered.map(k => k.label).join(', ')} and reprint those posters first — `
          + 'switching on now would stop them working with nobody at the poster able to fix it.',
        uncovered: uncovered.map(k => k.slug),
      });
    }
  }
  res.json({ mode: setKioskMode(db, mode, req.user) });
});

router.post('/', (req, res) => {
  const db = getDb();
  try {
    const issued = issueToken(db, {
      slug: String(req.body?.slug || ''), label: req.body?.label,
      note: req.body?.note, actor: req.user,
    });
    // Clear text exactly once. After this it exists only inside the poster.
    res.status(201).json(issued);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', (req, res) => {
  const row = revokeToken(getDb(), req.params.id, req.user);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.post('/reset-counter', (req, res) => {
  resetUntokened(getDb(), req.user);
  res.json({ ok: true });
});

export default router;
