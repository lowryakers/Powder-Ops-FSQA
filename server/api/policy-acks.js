// The employee's side of a policy acknowledgement (D-169).
//
// Mounted WITHOUT requireModuleWrite, the employee-documents arrangement: the
// person asked to acknowledge the PTO policy is very often an operator with no
// Policies grant, and the policy may not be ticked "employees can read". Sending
// it to them IS the act of showing it to them, so this router serves the policy
// to the person it was sent to and to nobody else. The office's side (sending,
// chasing, cancelling) lives on the Policies router.
import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { presignGet } from '../storage.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { ATTESTATION, ackState, contentSha } from '../policy-acks.js';

const router = Router();

function shape(r, p) {
  return {
    id: r.id, policy_id: r.policy_id, title: p.title, version: p.version, category: p.category,
    status: r.status, state: ackState(r, p), due_date: r.due_date, note: r.note,
    sent_by: r.sent_by, sent_at: r.sent_at, opened_at: r.opened_at,
    acknowledged_at: r.acknowledged_at, ack_version: r.ack_version,
    overdue: ackState(r, p) === 'overdue',
  };
}

router.get('/mine', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT a.*, p.title, p.version, p.category, p.body, p.storage_key, p.status AS policy_status
    FROM policy_acknowledgements a JOIN policies p ON p.id = a.policy_id
    WHERE a.user_id = ? AND a.status != 'cancelled' ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.sent_at DESC LIMIT 200`).all(req.user.id);
  const shaped = rows.map(r => shape(r, { title: r.title, version: r.version, category: r.category, body: r.body, storage_key: r.storage_key }));
  res.json({ pending: shaped.filter(r => r.status === 'pending'), done: shaped.filter(r => r.status === 'acknowledged') });
});

function load(req, res) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM policy_acknowledgements WHERE id = ?').get(req.params.id);
  // Not yours ⇒ not found. A 403 would confirm somebody else was sent this.
  if (!r || r.user_id !== req.user.id) { res.status(404).json({ error: 'Not found' }); return null; }
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(r.policy_id);
  if (!p) { res.status(404).json({ error: 'Not found' }); return null; }
  return { db, r, p };
}

router.get('/:id', async (req, res) => {
  const ctx = load(req, res); if (!ctx) return;
  const { db, r, p } = ctx;
  if (r.status === 'pending' && !r.opened_at) {
    db.prepare("UPDATE policy_acknowledgements SET opened_at = datetime('now') WHERE id = ?").run(r.id);
    r.opened_at = new Date().toISOString();
  }
  res.json({
    ...shape(r, p),
    summary: p.summary, body: p.body, filename: p.filename, content_type: p.content_type,
    file_url: p.storage_key ? await presignGet(p.storage_key, p.filename) : null,
    can_acknowledge: r.status === 'pending' && p.status === 'published',
    // The words are the policy's own title and version, so what is ticked says
    // WHICH policy and WHICH version was agreed to.
    attestation: ATTESTATION(p.title, p.version),
    signer_name: req.user.name,
    signature: r.signature ? JSON.parse(r.signature) : null,
  });
});

router.post('/:id/sign', (req, res) => {
  const ctx = load(req, res); if (!ctx) return;
  const { db, r, p } = ctx;
  if (r.status !== 'pending') return res.status(409).json({ error: `This was already ${r.status}.` });
  if (p.status !== 'published') return res.status(409).json({ error: 'This policy is no longer in force, so there is nothing to acknowledge.' });
  const b = req.body || {};
  const name = String(b.signed_name || '').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!name) return res.status(400).json({ error: 'Type your full name to acknowledge.' });
  if (norm(name) !== norm(req.user.name)) return res.status(400).json({ error: `The name must be the name on your account (${req.user.name}).` });
  if (!b.attest) return res.status(400).json({ error: 'Read the statement and tick the box.' });
  if (!gateSignature(req, res, { action: 'policy_acknowledge' })) return;

  const at = new Date().toISOString();
  const attestation = ATTESTATION(p.title, p.version);
  const sig = { name, at, ip: req.ip || null, ua: String(req.headers['user-agent'] || '').slice(0, 200), attestation, verified: true };
  const sha = contentSha(p);
  const done = db.prepare(`UPDATE policy_acknowledgements SET status = 'acknowledged', acknowledged_at = ?, signature = ?,
    ack_version = ?, ack_sha256 = ?, ack_filename = ? WHERE id = ? AND status = 'pending'`)
    .run(at, JSON.stringify(sig), p.version || null, sha, p.filename || null, r.id);
  if (!done.changes) return res.status(409).json({ error: 'This was already acknowledged.' });
  logAudit(req.user, 'sign', 'policy_acknowledgement', r.id,
    { ...signatureEvidence(), policy_id: p.id, signed_as: name, version: p.version || null, content_sha256: sha }, null, null, p.title);
  res.json({ ok: true, acknowledged_at: at, version: p.version || null });
});

export default router;
