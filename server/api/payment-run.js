// /api/payment-run — the weekly payment run page (D-360, PR A).
//
// Mounted WITHOUT requireModuleWrite (the AP Drop arrangement): the door is
// AP Drop's work-the-queue rule, checked here per route. Reading the run and
// confirming a bill's class: admin, the ap-drop edit grant, or an office/admin
// supervisor. The must-pay list and the settings: admin. A bot token reads at
// most; it never confirms a class (a person confirms) and never edits the list.
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { canWorkQueue } from './ap-drop.js';
import { paymentRun, weeklyScore, getSettings, saveSettings, notifyRecipients, BILL_CLASSES, suggestClass, loadContext } from '../payment-run.js';

const router = Router();
const isToken = (req) => req.auth?.kind === 'token';
const gate = (req, res) => {
  if (canWorkQueue(req.user)) return true;
  res.status(403).json({ error: 'The payment run is for whoever works the AP queue (the AP Drop edit grant, an office supervisor, or an admin).' });
  return false;
};
const adminOnly = (req, res) => {
  if (req.user?.role === 'admin' && !isToken(req)) return true;
  res.status(403).json({ error: 'Only an admin, signed in, can change this.' });
  return false;
};
const people = (db, ids) => (ids || []).map(id => db.prepare('SELECT id, name FROM users WHERE id = ?').get(id)).filter(Boolean);

router.get('/', (req, res) => {
  if (!gate(req, res)) return;
  const db = getDb();
  const page = paymentRun(db);
  const s = getSettings(db);
  res.json({
    ...page,
    score: weeklyScore(db),
    settings: {
      bill_owner: people(db, [s.bill_owner_id])[0] || null,
      controller: people(db, [s.controller_id])[0] || null,
      notify: notifyRecipients(db),
      notify_set: (s.notify_ids || []).length > 0,
    },
    can_admin: req.user?.role === 'admin' && !isToken(req),
    can_classify: !isToken(req),
  });
});

// A person confirms the class. The suggestion is offered; only this stores one.
router.post('/bills/:id/class', (req, res) => {
  if (!gate(req, res)) return;
  if (isToken(req)) return res.status(403).json({ error: 'A person confirms a bill\'s class; a bot may only suggest it.', code: 'person_only' });
  const db = getDb();
  const cls = String(req.body?.bill_class || '');
  if (!BILL_CLASSES[cls]) return res.status(400).json({ error: `Class must be one of: ${Object.keys(BILL_CLASSES).join(', ')}` });
  const row = db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bill not found' });
  if (['paid', 'closed', 'not_finance'].includes(row.status)) return res.status(409).json({ error: `This bill is ${row.status.replace(/_/g, ' ')}; its class is part of the record now.` });
  const suggested = suggestClass(loadContext(db), row);
  db.prepare("UPDATE ap_drops SET bill_class = ?, bill_class_by = ?, bill_class_at = datetime('now') WHERE id = ?").run(cls, req.user.name, row.id);
  db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_user_id, by_name, kind, detail) VALUES (?, ?, ?, ?, 'class_confirmed', ?)")
    .run(randomUUID(), row.id, req.user.id, req.user.name, JSON.stringify({ from: row.bill_class, to: cls, suggested: suggested.value, why: suggested.why }));
  logAudit(req.user, 'update', 'ap_drop', row.id, { field: 'bill_class', from: row.bill_class, to: cls, suggested: suggested.value }, row,
    db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(row.id), row.filename);
  res.json({ ok: true, bill_class: cls });
});

// ── the must-pay list: Lowry's, retired never deleted ─────────────────────────
router.post('/must-pays', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const vendor = String(req.body?.vendor_name || '').trim().slice(0, 200);
  if (vendor.length < 2) return res.status(400).json({ error: 'Name the vendor as it appears on its bills.' });
  const live = db.prepare('SELECT * FROM payment_must_pays WHERE is_active = 1').all().find(m => m.vendor_name.toLowerCase() === vendor.toLowerCase());
  if (live) return res.status(409).json({ error: `${live.vendor_name} is already on the list.` });
  const id = randomUUID();
  const label = String(req.body?.label || '').trim().slice(0, 200) || null;
  const note = String(req.body?.note || '').trim().slice(0, 1000) || null;
  db.prepare('INSERT INTO payment_must_pays (id, vendor_name, label, note, created_by) VALUES (?, ?, ?, ?, ?)').run(id, vendor, label, note, req.user.name);
  const row = db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'payment_must_pay', id, { vendor_name: vendor, label }, null, row, vendor);
  res.status(201).json(row);
});

router.post('/must-pays/:id/retire', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it comes off the list.' });
  const row = db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.is_active) return res.status(409).json({ error: 'Already off the list.' });
  db.prepare("UPDATE payment_must_pays SET is_active = 0, retired_by = ?, retired_at = datetime('now'), retire_reason = ? WHERE id = ?").run(req.user.name, reason, row.id);
  logAudit(req.user, 'retire', 'payment_must_pay', row.id, { reason }, row, db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(row.id), row.vendor_name);
  res.json({ ok: true });
});

router.get('/settings', (req, res) => {
  if (!gate(req, res)) return;
  res.json(getSettings(getDb()));
});

router.put('/settings', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const before = getSettings(db);
  const body = {};
  for (const k of ['bill_owner_id', 'controller_id', 'notify_ids']) if (k in (req.body || {})) body[k] = req.body[k];
  const after = saveSettings(db, body);
  logAudit(req.user, 'update', 'app_setting', 'payment_run_settings', {}, before, after, 'Payment run settings');
  res.json(after);
});

export default router;
