// New-hire onboarding: the office starts it, the new hire completes it on a
// magic link with no account, and the packet lands in ADP — through the API
// once the Marketplace credentials exist, or keyed into RUN from the
// completed packet until then. docs/adp-run-onboarding.md is the map.
//
// Two routers because two audiences:
//   - the admin router mounts behind requireModuleWrite('onboarding')
//   - the portal router mounts publicly (isPublicPath '/onboarding-portal/'),
//     token-gated exactly like the partner portal: SHA-256 hash stored, clear
//     token in the link, single indexed lookup.
//
// SSN and bank numbers: encrypted at rest or NOT COLLECTED (onboarding-crypto).
// They never leave the server — every read shape returns last-4 — and are
// decrypted in exactly one place: building the ADP submission.

import { Router } from 'express';
import { randomUUID as uuid, randomBytes, createHash } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { hasExplicitGrant } from '../module-access.js';
import { parseJson } from '../custom-fields.js';
import { uniqueUsername } from '../usernames.js';
import { readyDocOrigin } from '../links.js';
import { cryptoEnabled, encryptField, decryptField, last4 } from '../onboarding-crypto.js';
import { adpEnabled, submitApplicantOnboard } from '../adp.js';

export const router = Router();
export const portalRouter = Router();

// Onboarding holds pay and identity data — admins, or an explicit grant.
const canManage = (u) => u?.role === 'admin' || hasExplicitGrant(u, 'onboarding');

const sha = (t) => createHash('sha256').update(t).digest('hex');

// What the new hire may write about themselves. Job facts (department, team,
// position, start date, pay) are the OFFICE's fields — a portal that accepted
// them would let a link edit its own pay rate.
const PORTAL_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'preferred_name', 'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'dob',
  'emergency_name', 'emergency_phone', 'emergency_relationship',
  'dd_bank_name', 'dd_account_type',
  'w4_filing_status', 'w4_dependents_amount', 'w4_other_income', 'w4_deductions', 'w4_extra_withholding',
  'language',
];
const ADMIN_FIELDS = [...PORTAL_FIELDS, 'department', 'team', 'position', 'start_date', 'pay_rate', 'pay_frequency', 'notes'];

// One shape for every read: ciphertext never leaves, last-4 does.
function shape(r) {
  if (!r) return null;
  const { token_hash: _th, ssn_enc, dd_routing_enc: _dr, dd_account_enc, ...rest } = r;
  return {
    ...rest,
    progress: parseJson(r.progress, {}) || {},
    has_ssn: !!ssn_enc, has_bank: !!dd_account_enc,
    w4_multiple_jobs: !!r.w4_multiple_jobs,
    sensitive_collection: cryptoEnabled(),
    adp_ready: adpEnabled(),
  };
}

function applyFields(db, rec, body, allowed) {
  const patch = {};
  for (const f of allowed) if (body[f] !== undefined) patch[f] = body[f] === '' ? null : String(body[f]).slice(0, 300);
  if (body.w4_multiple_jobs !== undefined) patch.w4_multiple_jobs = body.w4_multiple_jobs ? 1 : 0;
  // Sensitive fields: encrypted or refused, never stored bare.
  for (const [field, encCol, l4Col] of [['ssn', 'ssn_enc', 'ssn_last4'], ['dd_routing', 'dd_routing_enc', null], ['dd_account', 'dd_account_enc', 'dd_account_last4']]) {
    if (body[field] === undefined) continue;
    if (!cryptoEnabled()) return { error: 'Sensitive fields are not collected until encryption is configured (ONBOARDING_ENC_KEY).' };
    const clear = String(body[field]).trim();
    if (!clear) continue;
    patch[encCol] = encryptField(clear);
    if (l4Col) patch[l4Col] = last4(clear);
  }
  if (body.progress !== undefined && typeof body.progress === 'object') {
    patch.progress = JSON.stringify({ ...(parseJson(rec.progress, {}) || {}), ...body.progress });
  }
  if (!Object.keys(patch).length) return { patch: null };
  db.prepare(`UPDATE onboarding_records SET ${Object.keys(patch).map(k => `${k} = ?`).join(', ')},
    updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), rec.id);
  return { patch };
}

// ── Admin ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rows = db.prepare('SELECT * FROM onboarding_records ORDER BY created_at DESC LIMIT 500').all();
  res.json({ records: rows.map(shape), adp_ready: adpEnabled(), sensitive_collection: cryptoEnabled() });
});

router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const b = req.body || {};
  if (!String(b.first_name || '').trim() || !String(b.last_name || '').trim()) {
    return res.status(400).json({ error: 'First and last name are required to start an onboarding.' });
  }
  const db = getDb();
  const id = uuid();
  const token = randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO onboarding_records (id, token_hash, status, created_by, invited_at)
    VALUES (?, ?, 'invited', ?, datetime('now'))`).run(id, sha(token), req.user.name);
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(id);
  applyFields(db, rec, b, ADMIN_FIELDS);
  const out = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'onboarding', id, { name: `${b.first_name} ${b.last_name}` }, null, null, `${b.first_name} ${b.last_name}`);
  // The clear token exists in this response and nowhere else — same rule as
  // the partner portal. Lost link ⇒ reissue, which invalidates this one.
  res.status(201).json({ ...shape(out), link: `${readyDocOrigin()}/welcome/${token}` });
});

router.put('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (['completed', 'cancelled'].includes(rec.status)) return res.status(409).json({ error: `This onboarding is ${rec.status}.` });
  const out = applyFields(db, rec, req.body || {}, ADMIN_FIELDS);
  if (out.error) return res.status(400).json({ error: out.error });
  const next = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { fields: Object.keys(out.patch || {}) }, null, null, `${rec.first_name} ${rec.last_name}`);
  res.json(shape(next));
});

router.post('/:id/reissue', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (['completed', 'cancelled'].includes(rec.status)) return res.status(409).json({ error: `This onboarding is ${rec.status}.` });
  const token = randomBytes(24).toString('base64url');
  db.prepare("UPDATE onboarding_records SET token_hash = ?, invited_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(sha(token), rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { reissued: true }, null, null, `${rec.first_name} ${rec.last_name}`);
  res.json({ link: `${readyDocOrigin()}/welcome/${token}` });
});

router.post('/:id/cancel', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE onboarding_records SET status = 'cancelled', token_hash = NULL, updated_at = datetime('now') WHERE id = ?").run(rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { cancelled: true }, null, null, `${rec.first_name} ${rec.last_name}`);
  res.json({ ok: true });
});

// Push the packet into RUN. 503 with the reason until the Marketplace
// credentials exist — the button can render honestly either way.
router.post('/:id/submit-adp', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  if (!adpEnabled()) return res.status(503).json({ error: 'ADP is not connected yet — see docs/adp-run-onboarding.md. The packet below is ready to key into RUN.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (rec.status === 'cancelled') return res.status(409).json({ error: 'This onboarding was cancelled.' });
  try {
    const response = await submitApplicantOnboard({
      ...rec,
      ssn: decryptField(rec.ssn_enc),
      dd_routing: decryptField(rec.dd_routing_enc),
      dd_account: decryptField(rec.dd_account_enc),
    });
    db.prepare(`UPDATE onboarding_records SET status = 'submitted_to_adp', adp_submitted_at = datetime('now'),
      adp_response = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(response).slice(0, 4000), rec.id);
    logAudit(req.user, 'update', 'onboarding', rec.id, { submitted_to_adp: true }, null, null, `${rec.first_name} ${rec.last_name}`);
    res.json(shape(db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Close it out, optionally creating the person's ReadyDoc account — which
// starts Messages-only under the NULL-map rule until modules are granted.
router.post('/:id/complete', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (rec.status === 'cancelled') return res.status(409).json({ error: 'This onboarding was cancelled.' });
  let userId = rec.user_id;
  if (req.body?.create_account && !userId) {
    const name = [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim();
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) userId = existing.id;
    else {
      userId = uuid();
      // THE SIGN-IN NAME IS SET HERE, not left for the boot-time backfill.
      // Every other account-creation path (users.js POST and bulk, the Slack
      // importer, auditor passes) derives a username at creation;
      // this one did not, so a new starter onboarded through their own welcome
      // link had `username NULL` and could not sign in until the next process
      // restart happened to run backfillUsernames(). Found by the mirror sweep
      // the week this module was folded onto main.
      db.prepare(`INSERT INTO users (id, name, username, role, department, is_active) VALUES (?, ?, ?, 'operator', ?, 1)`)
        .run(userId, name, uniqueUsername(db, name, null), rec.department || 'production');
      logAudit(req.user, 'create', 'user', userId, { from_onboarding: rec.id }, null, null, name);
    }
  }
  db.prepare(`UPDATE onboarding_records SET status = 'completed', completed_at = datetime('now'),
    token_hash = NULL, user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(userId || null, rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { completed: true, user_id: userId || null }, null, null, `${rec.first_name} ${rec.last_name}`);
  res.json(shape(db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
});

// ── Portal (public, token-gated) ─────────────────────────────────────────────

function byToken(db, token) {
  if (!token || token.length < 16) return null;
  return db.prepare("SELECT * FROM onboarding_records WHERE token_hash = ? AND status NOT IN ('cancelled','completed')").get(sha(token));
}

// What the wizard renders — job facts included read-only, secrets as flags.
portalRouter.get('/:token', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return res.status(404).json({ error: 'This link is no longer valid. Ask the office for a new one.' });
  res.json(shape(rec));
});

portalRouter.put('/:token', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return res.status(404).json({ error: 'This link is no longer valid. Ask the office for a new one.' });
  if (['submitted_to_adp'].includes(rec.status)) return res.status(409).json({ error: 'This onboarding was already submitted — contact the office to correct anything.' });
  const out = applyFields(db, rec, req.body || {}, PORTAL_FIELDS);
  if (out.error) return res.status(400).json({ error: out.error });
  if (rec.status === 'invited') {
    db.prepare("UPDATE onboarding_records SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(rec.id);
  }
  res.json(shape(db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
});

portalRouter.post('/:token/finish', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return res.status(404).json({ error: 'This link is no longer valid. Ask the office for a new one.' });
  const missing = ['first_name', 'last_name', 'address1', 'city', 'state', 'zip', 'phone']
    .filter(f => !String(rec[f] || '').trim());
  if (missing.length) return res.status(400).json({ error: 'Still needed before finishing: ' + missing.join(', ').replace(/_/g, ' ') });
  db.prepare("UPDATE onboarding_records SET status = 'ready', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(rec.id);
  logAudit('onboarding-portal', 'update', 'onboarding', rec.id, { finished: true }, null, null, `${rec.first_name} ${rec.last_name}`);
  res.json({ ok: true });
});

export default router;
