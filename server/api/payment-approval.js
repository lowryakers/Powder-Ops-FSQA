// /api/payment-approval/:token — Danny's page (D-361). PUBLIC: the approver has
// no account. The link carries a hashed, expiring, single-use token (see
// server/payment-approval.js), and every act here logs the typed name, the
// address and the device. Nothing here can freeze, send or cancel a run.
import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { runByToken, runView, untick, approve, recordTransfer, logEvent, announce } from '../payment-approval.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';

const router = Router();
const meta = (req) => ({ ip: req.ip, device: req.get('user-agent') || null });
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
const deps = { botDm, postMessageAs, pushToUser };

const open = (req, res) => {
  const out = runByToken(getDb(), req.params.token);
  if (out.error) { res.status(out.status).json({ error: out.error }); return null; }
  return out.run;
};

router.get('/:token', (req, res) => {
  const run = open(req, res); if (!run) return;
  const db = getDb();
  logEvent(db, run.id, 'opened', meta(req));
  res.json(runView(db, run.id, { forApprover: true }));
});

router.post('/:token/lines/:lineId', (req, res) => {
  const run = open(req, res); if (!run) return;
  try { res.json(untick(getDb(), run, req.params.lineId, req.body?.included !== false, { name: req.body?.name, ...meta(req) })); }
  catch (e) { fail(res, e); }
});

router.post('/:token/approve', (req, res) => {
  const run = open(req, res); if (!run) return;
  const db = getDb();
  try {
    const v = approve(db, run, { name: req.body?.name, ...meta(req) });
    logAudit(String(req.body?.name || '').trim(), 'approve', 'payment_run', run.id, { run_no: run.run_no, via: 'link', owes: v.summary.owes, ip: req.ip }, null, null, run.run_no);
    res.json(v);
    announce(db, deps, run.id, 'approved').catch(() => {});
  } catch (e) { fail(res, e); }
});

router.post('/:token/transferred', (req, res) => {
  const run = open(req, res); if (!run) return;
  const db = getDb();
  try {
    const v = recordTransfer(db, run, { name: req.body?.name, amount: req.body?.amount, ...meta(req) });
    logAudit(String(req.body?.name || '').trim(), 'update', 'payment_run', run.id, { action: 'transfer_sent', amount: v.transferred_amount, via: 'link', ip: req.ip }, null, null, run.run_no);
    res.json(v);
    announce(db, deps, run.id, 'transferred').catch(() => {});
  } catch (e) { fail(res, e); }
});

export default router;
