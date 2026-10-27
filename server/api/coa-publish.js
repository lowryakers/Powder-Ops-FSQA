// The lot rule's signed-in side (D-246) and publishing (D-247). Mounted inside
// the COA router, so the COA module grant reaches it.
//
//  · A lot: its state under the rule, its batches, its override and what the
//    doors recorded about it.
//  · Overrides and would-block reviews are Quality's; the password on the
//    override, never a token ("override" and "publish" are approve-class
//    path segments in no-token-approve.js).
//  · Publishing is an admin's act (an open decision, recorded); withdrawing is
//    Quality's or an admin's. The two public switches are an admin's, each with
//    a reason and the password. Nothing here moves the gate's mode.
import { Router } from 'express';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit, dataDir } from '../db.js';
import { isQaReviewer } from '../qa-signing.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { evaluateLotSync, activeOverride, MIN_OVERRIDE_REASON, canPublishCoa, gateMode, MODE_WORDS } from '../coa-lot-gate.js';
import { publishChecks, publishLot, withdrawPublication, listPublications, buildPublicSnapshots, newPublicId, MIN_WITHDRAW_REASON } from '../coa-publications.js';
import { publicState } from '../coa-public-snapshot.js';
import { certificateHtml } from '../coa-public-render.js';

const router = Router();
const UPLOAD_DIR = path.join(dataDir(), 'coa-files');
const isQa = (u) => u?.role === 'admin' || isQaReviewer(u);
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const lotLabel = (item, base) => `${item} · lot ${base}`;

// ── A lot ───────────────────────────────────────────────────────────────────
router.get('/lots/:item/:base', (req, res) => {
  const db = getDb();
  const { item, base } = req.params;
  const lot = evaluateLotSync(db, item, base);
  res.json({
    item_number: item, base_lot: base, mode: gateMode(db), mode_words: MODE_WORDS[gateMode(db)], on_list: lot.on_list,
    product: lot.product ? { display_name: lot.product.display_name, slug: lot.product.slug, brand_owner: lot.product.brand_owner, gf_claim: !!lot.product.gf_claim } : null,
    plan: lot.plan ? { name: lot.plan.name, version: lot.plan.version, status: lot.plan.status } : null,
    state: lot.state, met: lot.met, summary: lot.summary, problems: lot.problems, batches: lot.batches, missing_tests: lot.missing_tests,
    claim_supported: lot.claim_supported, override: activeOverride(db, item, base),
    events: db.prepare('SELECT * FROM coa_gate_events WHERE item_number = ? AND base_lot = ? ORDER BY at DESC LIMIT 50').all(item, base)
      .map(e => ({ ...e, reasons: parse(e.reasons, []) })),
    publications: listPublications(db, { item, baseLot: base }),
    can_publish: canPublishCoa(req.user), can_override: isQa(req.user),
  });
});

// The publish checklist: every check in words. Reads the lab reports again.
router.get('/lots/:item/:base/publish-check', async (req, res) => {
  const chk = await publishChecks(getDb(), req.params.item, req.params.base, UPLOAD_DIR);
  res.json({ ok: chk.ok, checks: chk.checks, summary: chk.lot.summary, public: publicState(getDb()) });
});

// The in-app preview: the public page exactly as it would render, with a
// throwaway public id. Shown in a frame inside ReadyDoc, never a new tab.
router.get('/lots/:item/:base/preview', async (req, res) => {
  const db = getDb();
  const chk = await publishChecks(db, req.params.item, req.params.base, UPLOAD_DIR);
  const usable = chk.batches.filter(b => b.snapshot);
  if (!usable.length) return res.status(409).json({ error: 'Nothing on this lot is signed yet, so there is nothing to preview.', checks: chk.checks });
  const snaps = buildPublicSnapshots(db, { ...chk, batches: usable }, req.params.base, usable.map(() => `preview${newPublicId().slice(0, 6)}`));
  res.json({ ok: chk.ok, checks: chk.checks, pages: snaps.map(s => ({ batch: s.batch, html: certificateHtml(s, { base: '/tested' }) })) });
});

router.post('/lots/:item/:base/publish', async (req, res) => {
  if (!canPublishCoa(req.user)) return res.status(403).json({ error: 'Publishing a certificate is an admin decision for now.' });
  const db = getDb();
  const { item, base } = req.params;
  const chk = await publishChecks(db, item, base, UPLOAD_DIR);
  if (!chk.ok) return res.status(409).json({ error: `This lot cannot be published yet: ${chk.checks.filter(c => !c.ok).map(c => c.text).join(' ')}`, checks: chk.checks });
  if (!gateSignature(req, res, { action: 'coa_publish' })) return;
  let out;
  try { out = publishLot(db, chk, { by: req.user.name, baseLot: base }); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  for (const p of out) {
    logAudit(req.user, 'publish', 'coa_publication', p.id, { ...p, item_number: item, base_lot: base, ...signatureEvidence() }, null, null, `${lotLabel(item, base)} · batch ${p.batch ?? '—'}`);
  }
  const state = publicState(db);
  res.status(201).json({ published: out, live: state.enabled === 'on' && state.brand_allowed,
    note: state.enabled === 'on' && state.brand_allowed ? 'Live on the public page.' : 'Published, but the public page is switched off, so nobody outside can see it yet.' });
});

// ── Overrides (D5) ──────────────────────────────────────────────────────────
// Opens the production QA sign-off door for one lot while strict would block
// it. It never makes a certificate signable and never enables publishing.
router.post('/lots/:item/:base/override', (req, res) => {
  if (!isQa(req.user)) return res.status(403).json({ error: 'Only Quality or an admin can override the lot rule.' });
  if (req.auth?.kind === 'token' || req.user?.via_token) return res.status(403).json({ error: 'An override is a person\'s decision; a bot token cannot make one.' });
  const db = getDb();
  const { item, base } = req.params;
  if (!db.prepare('SELECT 1 FROM coa_products WHERE item_number = ?').get(item)) return res.status(404).json({ error: 'The lot rule does not apply to this item (it is not on the COA product list).' });
  if (activeOverride(db, item, base)) return res.status(409).json({ error: 'An override is already in force for this lot.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < MIN_OVERRIDE_REASON) return res.status(400).json({ error: `Say why, in at least ${MIN_OVERRIDE_REASON} characters.` });
  if (!gateSignature(req, res, { action: 'coa_lot_override' })) return;
  const id = uuid();
  db.prepare('INSERT INTO coa_lot_overrides (id, item_number, base_lot, reason, by_name) VALUES (?, ?, ?, ?, ?)').run(id, item, base, reason, req.user.name);
  const row = db.prepare('SELECT * FROM coa_lot_overrides WHERE id = ?').get(id);
  logAudit(req.user, 'override', 'coa_lot_override', id, { ...row, lot_state: evaluateLotSync(db, item, base).summary, ...signatureEvidence() }, null, row, lotLabel(item, base));
  res.status(201).json(row);
});

router.post('/lots/:item/:base/override/revoke', (req, res) => {
  if (!isQa(req.user)) return res.status(403).json({ error: 'Only Quality or an admin can revoke an override.' });
  const db = getDb();
  const o = activeOverride(db, req.params.item, req.params.base);
  if (!o) return res.status(404).json({ error: 'No override is in force for this lot.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the override is being revoked.' });
  if (!gateSignature(req, res, { action: 'coa_lot_override_revoke' })) return;
  db.prepare("UPDATE coa_lot_overrides SET revoked_at = datetime('now'), revoked_by = ?, revoke_reason = ? WHERE id = ?").run(req.user.name, reason, o.id);
  const after = db.prepare('SELECT * FROM coa_lot_overrides WHERE id = ?').get(o.id);
  logAudit(req.user, 'revoke', 'coa_lot_override', o.id, { reason, ...signatureEvidence() }, o, after, lotLabel(o.item_number, o.base_lot));
  res.json(after);
});

router.get('/overrides', (_req, res) => {
  res.json({ overrides: getDb().prepare('SELECT * FROM coa_lot_overrides ORDER BY at DESC LIMIT 500').all() });
});

// ── What the doors decided (D4) ─────────────────────────────────────────────
router.get('/gate-events', (req, res) => {
  const db = getDb();
  const where = req.query.pending === '1' ? 'WHERE would_block = 1 AND review IS NULL' : req.query.would_block === '1' ? 'WHERE would_block = 1' : '';
  const rows = db.prepare(`SELECT * FROM coa_gate_events ${where} ORDER BY at DESC LIMIT 500`).all().map(e => ({ ...e, reasons: parse(e.reasons, []) }));
  res.json({ events: rows });
});

router.post('/gate-events/:id/review', (req, res) => {
  if (!isQa(req.user)) return res.status(403).json({ error: 'Only Quality or an admin reviews what the lot rule would have blocked.' });
  const db = getDb();
  const e = db.prepare('SELECT * FROM coa_gate_events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'No such event.' });
  if (!e.would_block) return res.status(409).json({ error: 'Only an event the rule would have blocked is reviewed.' });
  const review = req.body?.review;
  if (!['correct', 'false_block'].includes(review)) return res.status(400).json({ error: 'Say whether strict was right to block it (correct) or wrong (false_block).' });
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) return res.status(400).json({ error: 'Say why, in a few words.' });
  db.prepare("UPDATE coa_gate_events SET review = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?").run(review, req.user.name, note, e.id);
  const after = db.prepare('SELECT * FROM coa_gate_events WHERE id = ?').get(e.id);
  logAudit(req.user, 'update', 'coa_gate_event', e.id, { review, note }, e, after, lotLabel(e.item_number, e.base_lot));
  res.json({ ...after, reasons: parse(after.reasons, []) });
});

// ── Publications ────────────────────────────────────────────────────────────
router.get('/publications', (req, res) => {
  const db = getDb();
  res.json({ publications: listPublications(db, { item: req.query.item || null, baseLot: req.query.base_lot || null }), public: publicState(db), can_publish: canPublishCoa(req.user), can_withdraw: isQa(req.user) });
});

router.post('/publications/:id/withdraw', (req, res) => {
  if (!isQa(req.user)) return res.status(403).json({ error: 'Only Quality or an admin can withdraw a public certificate.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < MIN_WITHDRAW_REASON) return res.status(400).json({ error: `Say why, in at least ${MIN_WITHDRAW_REASON} characters.` });
  const db = getDb();
  const p = db.prepare('SELECT * FROM coa_publications WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such publication.' });
  if (p.status !== 'published') return res.status(409).json({ error: `This publication is already ${p.status}.` });
  if (!gateSignature(req, res, { action: 'coa_withdraw' })) return;
  const out = withdrawPublication(db, p.id, { by: req.user.name, reason });
  if (out.error) return res.status(out.status).json({ error: out.error });
  const strip = (r) => r && { ...r, snapshot: undefined };
  logAudit(req.user, 'withdraw', 'coa_publication', p.id, { reason, public_id: p.public_id, certificate_number: p.certificate_number, ...signatureEvidence() }, strip(out.before), strip(out.after), `${lotLabel(p.item_number, p.base_lot)} · batch ${p.batch ?? '—'}`);
  res.json(strip(out.after));
});

// ── The two public switches (E1) ────────────────────────────────────────────
// `public_coa_indexable` and `public_nonclaim_gluten_display` have no switch
// here on purpose: the page is noindex and non-claim gluten is hidden.
const SWITCHES = {
  enabled: { label: 'the public certificate page', values: ['off', 'on'] },
  brand: { label: 'ProDough publishing', values: ['off', 'on'] },
};
router.get('/public-switches', (_req, res) => res.json(publicState(getDb())));
router.put('/public-switches/:key', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can switch the public page.' });
  const sw = SWITCHES[req.params.key];
  if (!sw) return res.status(404).json({ error: 'No such switch.' });
  const value = req.body?.value;
  if (!sw.values.includes(value)) return res.status(400).json({ error: `Must be ${sw.values.join(' or ')}.` });
  const db = getDb();
  const before = publicState(db);
  const was = req.params.key === 'enabled' ? before.enabled : (before.brand_allowed ? 'on' : 'off');
  if (was === value) return res.json({ ...before, unchanged: true });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: `Say why ${sw.label} is being switched ${value}.`, reason_required: true });
  if (!gateSignature(req, res, { action: 'coa_public_switch' })) return;
  if (req.params.key === 'enabled') {
    db.prepare(`INSERT INTO coa_settings (key, value, updated_by, updated_at) VALUES ('public_coa_enabled', ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(value, req.user.name);
  } else {
    db.prepare("UPDATE coa_brands SET public_publish_allowed = ? WHERE name = 'ProDough'").run(value === 'on' ? 1 : 0);
  }
  const after = publicState(db);
  logAudit(req.user, 'update', req.params.key === 'enabled' ? 'coa_setting' : 'coa_brand', req.params.key === 'enabled' ? 'public_coa_enabled' : 'brand-prodough',
    { switch: req.params.key, from: was, to: value, reason, ...signatureEvidence() }, before, after, sw.label);
  res.json(after);
});

export default router;
