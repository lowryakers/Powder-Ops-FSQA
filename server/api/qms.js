import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { smsEnabled, sendSms, approverPhone, smsStatus, OPT_OUT_LINE } from '../sms.js';
import { readyDocOrigin } from '../links.js';
import { requireRole } from '../middleware/auth.js';
import { nextDisposalNumber } from './disposals.js';
import { QMS_TYPES, getType, canSignApproval, RETURN_REASONS, USED_UP_REASON } from '../qms-config.js';
import { syncKnifeStatus, syncAllKnifeStatuses } from '../knife-state.js';
import { activeChemicalNames } from '../chemicals.js';
import { createReadStream } from 'fs';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────
function parseJson(raw, fallback) { if (!raw) return fallback; try { return JSON.parse(raw); } catch { return fallback; } }

// Flatten a stored row into the shape the client renders: type-specific fields
// from `data` are spread to the top level alongside the built-in columns.
function flatten(row) {
  const data = parseJson(row.data, {});
  return {
    ...data,
    id: row.id,
    record_type: row.record_type,
    record_number: row.record_number,
    record_date: row.record_date,
    status: row.status,
    paper_record: row.paper_record,
    document_url: row.document_url,
    capa_id: row.capa_id,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    approvals: parseJson(row.approvals, {}),
  };
}

// Build the data JSON from the request body, keeping only configured field keys.
function pickData(cfg, body) {
  const data = {};
  for (const f of cfg.fields) {
    if (body[f.key] !== undefined) {
      let v = body[f.key];
      if (f.type === 'multiselect') v = Array.isArray(v) ? v : (v ? [v] : []);
      if (f.type === 'checkbox') v = !!v;
      data[f.key] = v;
    }
  }
  return data;
}

// Next sequential record number for a type, honouring its prefix + padding.
function nextNumber(db, cfg) {
  const rows = db.prepare('SELECT record_number FROM qms_records WHERE record_type = ?').all(cfg.key);
  let max = 0;
  for (const r of rows) {
    // Use the LAST numeric group so year-prefixed numbers work ("25-001" → 1).
    const m = String(r.record_number || '').match(/\d+/g);
    if (m) max = Math.max(max, parseInt(m[m.length - 1], 10));
  }
  return (cfg.numberPrefix || '') + String(max + 1).padStart(cfg.numberPad || 3, '0');
}

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas + newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function requireType(req, res) {
  const cfg = getType(req.params.type);
  if (!cfg) { res.status(404).json({ error: 'Unknown record type' }); return null; }
  // Per-type module enforcement: writes need Edit on the type's module for
  // users with a granular access map (mirrors requireModuleWrite in server.js).
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.user && req.user.role !== 'admin') {
    if (req.user.role === 'auditor') { res.status(403).json({ error: 'Auditor accounts are read-only.' }); return null; }
    const ma = req.user.module_access;
    if (ma != null && !Array.isArray(ma) && ma[cfg.moduleId] !== 'edit') {
      res.status(403).json({ error: 'You have view-only access to this module.' });
      return null;
    }
  }
  return cfg;
}

// ── config (must precede /:type) ────────────────────────────────────────────
// Editable Maintenance Sign In/Out item list, stored in the DB and managed in
// the app. Read helper + admin write endpoint.
// Returns [{ name, category }] ordered for display. Category groups the dropdown.
function maintenanceItems(db) {
  try { return db.prepare('SELECT name, category FROM maintenance_items ORDER BY sort_order, name').all(); }
  catch { return []; }
}

// Build the dropdown `options` for the item field: grouped by category into
// optgroups, preserving category order of first appearance; uncategorized items
// fall into a trailing "Other" group.
function maintenanceItemOptions(rows) {
  const groups = [];
  const byCat = new Map();
  for (const r of rows) {
    const cat = r.category || 'Other';
    if (!byCat.has(cat)) { const g = { group: cat, items: [] }; byCat.set(cat, g); groups.push(g); }
    byCat.get(cat).items.push(r.name);
  }
  // A single uncategorized flat list stays flat (no pointless "Other" wrapper).
  if (groups.length === 1 && groups[0].group === 'Other') return groups[0].items;
  return groups;
}

// Chemicals from the approved registry are checkable-out items too. They're
// merged in at read time (never stored in maintenance_items) so the sign-out
// dropdown always tracks the registry. The list itself lives in
// server/chemicals.js — sanitation asks the same question and must get the
// same answer. Re-exported here so existing importers are untouched.
export { activeChemicalNames };
function withChemicals(db, rows) {
  const have = new Set(rows.map(r => r.name));
  const chems = activeChemicalNames(db).filter(n => !have.has(n));
  return [...rows, ...chems.map(name => ({ name, category: 'Chemicals' }))];
}

router.get('/maintenance-items', (req, res) => {
  res.json({ items: maintenanceItems(getDb()) });
});

// Flavor approval status keyed by MO #, so the Production Log and the Schedule
// can show "flavor approved / denied" against a run without either module
// having to know how flavor approvals are stored.
//
// One request returning a map rather than a lookup per row: the alternative is
// a query per production entry, and this screen already renders hundreds.
// Bounded to decided records from the last year — an approval from two years
// ago is not what anyone is checking against today's schedule.
router.get('/flavor-approvals/by-mo', (req, res) => {
  const db = getDb();
  const out = {};
  try {
    const rows = db.prepare(`SELECT record_number, record_date, status, data FROM qms_records
      WHERE record_type = 'flavor_approval' AND status IN ('approved','denied')
        AND COALESCE(record_date, date(created_at)) >= date('now', '-1 year')
      ORDER BY COALESCE(record_date, date(created_at))`).all();
    for (const r of rows) {
      const d = parseJson(r.data, {});
      const mo = String(d.mo_number || '').trim();
      if (!mo) continue;
      // Last decision wins — a re-tasted batch is described by its latest call.
      out[mo] = {
        record_number: r.record_number,
        status: r.status,
        decided_by: d.decided_by || null,
        decision_date: d.decision_date || r.record_date || null,
        batch_adjustments: d.batch_adjustments || null,
        organoleptic_record_id: d.organoleptic_record_id || null,
      };
    }
  } catch { /* table optional */ }
  res.json(out);
});

router.put('/maintenance-items', (req, res) => {
  if (!(req.user?.role === 'admin' || req.user?.role === 'supervisor')) {
    return res.status(403).json({ error: 'Only admins or supervisors can edit the item list.' });
  }
  // Accept either strings (legacy) or { name, category } objects.
  const raw = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!raw) return res.status(400).json({ error: 'items (array) is required' });
  const seen = new Set();
  const items = [];
  for (const it of raw) {
    const name = String((typeof it === 'string' ? it : it?.name) || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const category = typeof it === 'object' && it?.category ? String(it.category).trim() : null;
    items.push({ name, category: category || null });
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM maintenance_items').run();
    const ins = db.prepare('INSERT INTO maintenance_items (id, name, sort_order, category) VALUES (?, ?, ?, ?)');
    items.forEach((it, i) => ins.run(uuid(), it.name, i, it.category));
  })();
  logAudit(req.user, 'update', 'maintenance_items', null, { count: items.length }, null, null);
  res.json({ items });
});

router.get('/config', (_req, res) => {
  // Inject the current (editable) sign-out item list — plus the approved
  // chemical registry — into the Item Description dropdown field.
  const db = getDb();
  const rows = maintenanceItems(db);
  const merged = rows.length ? withChemicals(db, rows) : [];
  const options = maintenanceItemOptions(merged);
  // Registered (non-decommissioned) knives → the sign-out log's tool dropdown.
  let knifeIds = [];
  try {
    knifeIds = db.prepare("SELECT record_number, data FROM qms_records WHERE record_type = 'knife_accountability' AND (status IS NULL OR status != 'decommissioned') ORDER BY record_number").all()
      .map(r => { try { return JSON.parse(r.data || '{}').tool_id || r.record_number; } catch { return r.record_number; } });
  } catch { /* table optional */ }
  const types = Object.values(QMS_TYPES).map(t => {
    if (t.key === 'maintenance_sign_out' && merged.length) {
      return { ...t, fields: t.fields.map(f => f.key === 'item_description' ? { ...f, options } : f) };
    }
    if (t.key === 'knife_sign_out' && knifeIds.length) {
      return { ...t, fields: t.fields.map(f => f.key === 'tool_id' ? { ...f, options: knifeIds } : f) };
    }
    return t;
  });
  res.json({ types });
});

// ── My checked-out items (sidebar reminder) ──────────────────────────────────
// Everything the signed-in user currently has out across the sign-out logs,
// matched by employee name. Registered before the '/:type' routes so 'mine'
// isn't captured as a type.
const MY_CHECKOUT_TYPES = ['maintenance_sign_out', 'knife_sign_out'];
router.get('/mine/checked-out', (req, res) => {
  const db = getDb();
  const me = (req.user?.name || '').trim().toLowerCase();
  if (!me) return res.json([]);
  const out = [];
  for (const type of MY_CHECKOUT_TYPES) {
    let rows;
    try { rows = db.prepare("SELECT * FROM qms_records WHERE record_type = ? AND status = 'out'").all(type).map(flatten); } catch { rows = []; }
    for (const r of rows) {
      if ((r.employee_name || '').trim().toLowerCase() !== me) continue;
      out.push({
        id: r.id, type, module: QMS_TYPES[type]?.moduleId, record_number: r.record_number,
        item: r.item_description || r.tool_id || 'Item', qty: r.qty || null, date: r.record_date,
      });
    }
  }
  out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  res.json(out);
});

// Close out your own sign-out. Deliberately does NOT require module edit
// access: you can always close what you personally checked out. QA still
// reviews/approves the record afterwards.
//
// "Returned" is not the only way a sign-out ends. A chemical runs out, an
// abrasive is used up, a tool is broken or lost — none of those come back, and
// with only a Return button the record either stayed open forever or was closed
// as a return that never happened. `return_reason` already existed on the
// record and in the log's filters; what was missing was any way to SET it from
// the one screen where people actually close these out.
router.post('/mine/checked-out/:id/return', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id);
  if (!row || !MY_CHECKOUT_TYPES.includes(row.record_type) || row.status !== 'out') {
    return res.status(404).json({ error: 'Checked-out record not found' });
  }
  const flat = flatten(row);
  if ((flat.employee_name || '').trim().toLowerCase() !== (req.user?.name || '').trim().toLowerCase()) {
    return res.status(403).json({ error: 'You can only return items you checked out yourself.' });
  }
  // Only the outcomes the log knows about — an outcome you cannot filter on is
  // a sentence, and this column is one people filter.
  const reason = RETURN_REASONS.includes(req.body?.return_reason) ? req.body.return_reason : 'Returned';
  const cameBack = reason === 'Returned';
  const data = parseJson(row.data, {});
  const now = new Date();
  data.return_date = now.toISOString().slice(0, 10);
  data.return_time = now.toTimeString().slice(0, 5);
  data.returned_by = req.user.name;
  data.return_reason = reason;
  // Condition is a fact about an item you are handing back. Asking for it on
  // something that no longer exists invites a meaningless "Good".
  if (cameBack && !data.condition_returned) {
    data.condition_returned = req.body?.condition === 'Bad' ? 'Bad' : 'Good';
  }
  if (req.body?.comments) {
    const note = String(req.body.comments).slice(0, 500);
    data.comments = data.comments ? `${data.comments}\n${note}` : note;
  }
  // `status` still becomes 'returned' — it means "closed, no longer out", and
  // it is what CheckedOutPanel, the badges and QA Review all read. The outcome
  // is what says whether anything physically came back.
  db.prepare("UPDATE qms_records SET status = 'returned', data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(data), row.id);
  logAudit(req.user, 'update', row.record_type, row.id,
    { self_return: true, return_date: data.return_date, return_reason: reason, condition_returned: data.condition_returned },
    null, null, String(flat.item_description || flat.tool_id || row.record_number));
  // Used up raises a restock SUGGESTION for the office — no extra write, the
  // suggestion is this record read through `openSuggestions()`.
  res.json({ ok: true, return_reason: reason, suggests_restock: reason === USED_UP_REASON });
});

// ── Flavor approval: text the taste-test request to the approver ─────────────
// Generates (or reuses) the record's magic approval token and, when Twilio is
// configured, texts the link to the flavor approver (Danny). Always returns
// the link so it can be sent manually from any phone when SMS is off.
// IS TEXTING ACTUALLY WORKING? Admin-only, and it never returns a secret.
//
// "Nothing sent and nothing said why" is the state this ends. A missing
// variable, a typo'd variable NAME and a carrier rejection all looked the same
// from the app, so this reports which of the three it is — and the test send
// surfaces Twilio's own error code, which is the part that actually says what
// to change.
router.get('/sms-status', requireRole('admin'), (req, res) => {
  // THE DOMAIN IN THE TEXT IS PART OF THE CONFIGURATION, and it is set by an
  // env var nobody can see from the app. Carriers scan the links in A2P
  // traffic, and a shared free-hosting subdomain is indistinguishable from
  // anyone else's traffic on that host — which is how approval texts start
  // being filtered with nothing anywhere saying so. Reported here so the
  // domain can be checked, and re-checked after it is changed.
  const origin = readyDocOrigin();
  let host = null;
  try { host = new URL(origin).hostname; } catch { /* a malformed value is its own answer */ }
  const shared = !!host && /\.(up\.railway\.app|onrender\.com|herokuapp\.com|vercel\.app)$/i.test(host);
  res.json({
    ...smsStatus(),
    link_origin: origin,
    link_warning: shared
      ? `Texted links point at ${host}, a shared hosting domain. Carriers cannot tell it apart from anyone else's traffic on that host, which is a common cause of approval texts being filtered. Point a branded domain at the app and set READYDOC_ORIGIN to it.`
      : (!host ? `READYDOC_ORIGIN does not look like a URL (${origin}). Texted links will be broken.` : null),
  });
});

router.post('/sms-test', requireRole('admin'), async (req, res) => {
  const digits = String(req.body?.to || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return res.status(400).json({ error: 'Enter a 10-digit number to test with.' });
  if (!smsEnabled()) return res.status(400).json({ error: smsStatus().missing.length ? `Not configured — missing ${smsStatus().missing.join(', ')}.` : 'SMS is not configured.' });
  try {
    const r = await sendSms(`+1${digits}`, `ReadyDoc test message — texting is configured correctly. ${OPT_OUT_LINE}`);
    logAudit(req.user, 'create', 'sms_test', r?.sid || null, `Test text to …${digits.slice(-4)}`);
    // 'queued'/'accepted' is Twilio taking it, not the carrier delivering it.
    res.json({ ok: true, sid: r?.sid || null, status: r?.status || null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// The three or four numbers a flavour approval is ever texted to. Not all of
// them are ReadyDoc accounts (a co-packer contact, a partner), which is why
// this is its own list rather than a filter over `users`.
router.get('/sms-contacts', (req, res) => {
  res.json(getDb().prepare('SELECT id, name, phone FROM sms_contacts ORDER BY name').all());
});

router.post('/sms-contacts', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const digits = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
  if (!name || digits.length !== 10) return res.status(400).json({ error: 'A name and a 10-digit phone number are both required.' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sms_contacts WHERE phone = ?').get(digits);
  if (existing) return res.status(409).json({ error: 'That number is already saved.' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO sms_contacts (id, name, phone, created_by) VALUES (?, ?, ?, ?)')
    .run(id, name, digits, req.user?.name || 'system');
  logAudit(req.user, 'create', 'sms_contact', id, `Saved ${name} for approval texts`);
  res.status(201).json({ id, name, phone: digits });
});

router.delete('/sms-contacts/:id', (req, res) => {
  const db = getDb();
  const c = db.prepare('SELECT * FROM sms_contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  db.prepare('DELETE FROM sms_contacts WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'sms_contact', req.params.id, `Removed ${c.name}`);
  res.json({ ok: true });
});

router.post('/flavor_approval/:id/send', async (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM qms_records WHERE id = ? AND record_type = 'flavor_approval'").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'This request has already been decided.' });
  const data = parseJson(row.data, {});
  if (!data.approval_token) {
    data.approval_token = crypto.randomBytes(24).toString('base64url');
    db.prepare("UPDATE qms_records SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), row.id);
  }
  const link = `${readyDocOrigin()}/approve/${data.approval_token}`;
  const summary = [data.product_name, data.lot_number && `Lot ${data.lot_number}`, data.work_order && `WO ${data.work_order}`].filter(Boolean).join(' · ');
  // WHO IT GOES TO IS CHOSEN AT SEND TIME.
  //
  // It used to be one number in an env var, so the only way to text a second
  // approver was a redeploy — and in practice the link was copied out and
  // pasted into a personal text, which leaves no record of who was asked.
  // A number passed here wins; FLAVOR_APPROVER_PHONE stays the default so
  // nothing changes for the ordinary case.
  const digits = String(req.body?.to || '').replace(/\D/g, '').slice(-10);
  if (req.body?.to && digits.length !== 10) {
    return res.status(400).json({ error: 'That does not look like a 10-digit phone number.' });
  }
  const to = digits ? `+1${digits}` : approverPhone();

  let texted = false, smsError = null;
  if (smsEnabled() && to) {
    try {
      // The opt-out line rides on every message WE start. Carriers ask for it
      // on recurring traffic, and it costs the reader nothing. The reply
      // keywords keep the approver in Messages — the link stays for anyone
      // who prefers a screen with the batch details on it.
      await sendSms(to, `Powder Ops — flavor approval needed: ${summary}. Tap to approve or deny: ${link} Or just reply "Approve ${row.record_number}" or "Deny ${row.record_number}". ${OPT_OUT_LINE}`);
      texted = true;
      // The number is recorded ON THE RECORD, not only in the audit log: the
      // reply-by-text path must verify the decision comes from the number the
      // link was sent to, and an audit row is not addressable by token.
      data.last_texted_to = to;
      db.prepare("UPDATE qms_records SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), row.id);
      logAudit(req.user, 'qms_updated', 'flavor_approval', row.id,
        { record_number: row.record_number, texted_to: to });
    } catch (e) { smsError = e.message; }
  }
  res.json({ ok: true, link, texted, sent_to: texted ? to : null, sms_configured: smsEnabled() && !!to, sms_error: smsError });
});

// ── list + summary ──────────────────────────────────────────────────────────
router.get('/:type/summary', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const rows = db.prepare('SELECT * FROM qms_records WHERE record_type = ?').all(cfg.key).map(flatten);
  const total = rows.length;
  const pendingApproval = rows.filter(r => !r.paper_record && cfg.approvals.some(a => a.required && !r.approvals[a.key])).length;
  const paper = rows.filter(r => r.paper_record).length;
  res.json({ total, pending_approval: pendingApproval, paper });
});

router.get('/:type', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const rows = db.prepare('SELECT * FROM qms_records WHERE record_type = ? ORDER BY (record_date IS NULL), record_date DESC, created_at DESC').all(cfg.key);
  res.json(rows.map(r => withPermissions(flatten(r), r, req.user)));
});

router.get('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withPermissions(flatten(row), row, req.user));
});

// ── evidence files on a record ───────────────────────────────────────────────
//
// A quality event is half photographs — the damaged pallet, the wrong label,
// the lab slip, the supplier's email. They used to live in somebody's phone and
// the record only described them, which is the gap an auditor asking "show me"
// finds. Same storage path as equipment manuals and course materials (R2 via
// putStream), and the same rule: `extracted_text` is SEARCHED, never shipped.
const attachUpload = mediaUpload({ files: 10 }).array('files', 10);
const uploadAttachments = (req, res, next) => attachUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

router.get('/:type/:id/attachments', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare('SELECT * FROM qms_attachments WHERE record_id = ? ORDER BY created_at DESC').all(req.params.id);
  } catch { /* table optional */ }
  Promise.all(rows.map(async f => ({
    id: f.id, title: f.title, filename: f.filename, content_type: f.content_type,
    size: f.size, uploaded_by: f.uploaded_by, created_at: f.created_at,
    searchable: f.text_status === 'ok' && !!f.extracted_text,
    text_status: f.text_status,
    url: await presignGet(f.storage_key, f.filename),
  }))).then(out => res.json(out)).catch(e => res.status(500).json({ error: e.message }));
});

router.post('/:type/:id/attachments', uploadAttachments, async (req, res) => {
  const files = req.files || [];
  try {
    const cfg = requireType(req, res); if (!cfg) return;
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    const db = getDb();
    const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Attaching evidence follows the same rule as amending the record: the
    // filer while it is unsigned, plus QA/supervisors/Document Control, and
    // admins always. Adding evidence to a signed record would change what the
    // signature covered.
    if (!mayEdit(req.user, row)) {
      return res.status(403).json({
        error: hasAnySignature(row)
          ? `${row.record_number} carries an approval signature — revoke it, attach the file, then sign again.`
          : 'You can only attach files to records you filed. Ask QA, a supervisor or Document Control.',
      });
    }
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });

    const out = [];
    for (const f of files) {
      const id = uuid();
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `qms/${cfg.key}/${row.id}/${id}-${safe}`;
      await putStream(key, createReadStream(f.path), f.mimetype);

      // Best-effort: a photo has no text and that is fine. The row records
      // that rather than implying the file was read.
      let text = null, status = 'none';
      try {
        const buf = await getObjectBuffer(key);
        text = await extractInvoiceText(buf, f.mimetype, f.originalname);
        status = text && text.trim() ? 'ok' : 'empty';
      } catch (e) {
        status = 'failed';
        console.warn('[qms] attachment text extraction failed:', e.message);
      }

      db.prepare(`INSERT INTO qms_attachments (id, record_id, record_type, title, filename, content_type, size, storage_key, extracted_text, text_status, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, row.id, cfg.key, (req.body?.title || '').slice(0, 200) || null,
        (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null,
        key, text || null, status, req.user?.name || null);
      out.push({ id, filename: f.originalname, searchable: status === 'ok' });
    }
    logAudit(req.user, 'create', 'qms_attachment', row.id,
      { record_number: row.record_number, files: out.map(o => o.filename) }, null, null, row.record_number);
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/:type/:id/attachments/:fileId', async (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!mayEdit(req.user, row)) {
    return res.status(403).json({
      error: hasAnySignature(row)
        ? `${row.record_number} carries an approval signature — removing its evidence needs the signature revoked first.`
        : 'You can only change records you filed.',
    });
  }
  const f = db.prepare('SELECT * FROM qms_attachments WHERE id = ? AND record_id = ?').get(req.params.fileId, row.id);
  if (!f) return res.status(404).json({ error: 'File not found' });

  db.prepare('DELETE FROM qms_attachments WHERE id = ?').run(f.id);
  logAudit(req.user, 'delete', 'qms_attachment', row.id,
    { record_number: row.record_number, filename: f.filename }, f, null, row.record_number);
  // Only purge the object once nothing references it — the same refcount rule
  // forwarded comms attachments and shared equipment manuals follow.
  const stillRef = db.prepare('SELECT 1 FROM qms_attachments WHERE storage_key = ? LIMIT 1').get(f.storage_key);
  if (!stillRef) { try { await deleteObject(f.storage_key); } catch { /* object already gone */ } }
  res.json({ success: true });
});

// Cross-module automation: a failed organoleptic sensory test means the product
// must be dispositioned, so open a DRAFT disposal pre-filled from the test and
// back-linked to it (source_type/source_id). Idempotent — one draft per source
// test; never auto-deletes, so a QA reviewer stays in control.
function syncOrganolepticDisposal(db, cfg, rec, user) {
  if (cfg.key !== 'organoleptic' || !cfg.passFail) return null;
  const failed = cfg.passFail.fields.some(k => {
    const n = parseInt(rec[k], 10);
    return !Number.isNaN(n) && n < cfg.passFail.threshold;
  });
  if (!failed) return null;
  const exists = db.prepare("SELECT id FROM disposals WHERE source_type = 'organoleptic' AND source_id = ?").get(rec.id);
  if (exists) return null;
  const id = uuid();
  const number = nextDisposalNumber(db);
  const notes = `Auto-generated from Organoleptic test ${rec.record_number || ''} (FAIL). Draft — review and complete: add disposal date, quantity, witness, and approvals.`;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO disposals (id, disposal_number, reason, notes, status, source_type, source_id, created_by)
      VALUES (?, ?, ?, ?, 'draft', 'organoleptic', ?, ?)`).run(
      id, number, 'Organoleptic sensory test failure', notes, rec.id, user?.name || 'system');
    db.prepare(`INSERT INTO disposal_items (id, disposal_id, item_name, item_number, lot_number, quantity, reason_disposed, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(
      uuid(), id, rec.product || null, rec.part_number || null, rec.lot || null, rec.quantity || null, 'Organoleptic FAIL');
  });
  tx();
  logAudit(user, 'disposal_created', 'disposal', id, { disposal_number: number, source: 'organoleptic', source_record: rec.record_number }, null, null);
  return id;
}

// One taste test, two records — Flavor Approval and Organoleptic Sensory.
//
// The plant does a single tasting: Danny or Adam tries the batch and decides.
// That event is simultaneously a flavor approval (a decision about a batch) and
// an organoleptic evaluation (a rated sensory test). They are separate
// CONTROLLED FORMS with their own numbering, and an auditor asking for the
// Organoleptic log must get organoleptic records — so this creates a linked
// record rather than pretending one log can stand in for the other. Same
// reasoning as keeping 440-02 and 703-01 apart in Sign In/Out.
//
// Linked both ways and idempotent: the flavor approval holds
// `organoleptic_record_id`, the organoleptic record holds
// `source_flavor_approval_id`, and a re-save UPDATES that record instead of
// filing a second one.
// A knife sign-out written HERE must move the master list too.
//
// The kiosk used to be the only thing that touched `knife_accountability`
// status, so recording a return in the log left the master row saying `issued`
// and the scanner refused to sign the knife out again. The log is the
// authority; this keeps the mirror honest whichever door the record came
// through. Best-effort — a mirror failing must never fail the record.
function syncKnifeMaster(db, cfg, rec) {
  if (cfg.key !== 'knife_sign_out') return null;
  const toolId = String(rec?.tool_id || '').trim();
  if (!toolId) return null;
  return syncKnifeStatus(db, toolId);
}

const SENSORY_KEYS = ['appearance', 'texture', 'aroma', 'flavor', 'overall'];

export function syncFlavorOrganoleptic(db, cfg, rec, user) {
  if (cfg.key !== 'flavor_approval') return null;
  // Only once a decision has been made — a pending approval is a batch waiting
  // to be tasted, and there is no sensory evaluation to record yet.
  if (!['approved', 'denied'].includes(String(rec.status || ''))) return null;
  const org = getType('organoleptic');
  if (!org) return null;

  const data = {
    product: rec.product_name || null,
    mo_number: rec.mo_number || null,
    lot: rec.lot_number || null,
    quantity: rec.sample_quantity || null,
    evaluator: rec.decided_by || user?.name || null,
    lab_testing: 'No',
    note: [
      `Recorded from Flavor Approval ${rec.record_number || ''}`.trim(),
      rec.batch_adjustments ? `Batch adjustments: ${rec.batch_adjustments}` : null,
      rec.comments || null,
    ].filter(Boolean).join(' · '),
    source_flavor_approval_id: rec.id,
  };
  for (const k of SENSORY_KEYS) if (rec[k]) data[k] = String(rec[k]);

  const existingId = rec.organoleptic_record_id;
  if (existingId) {
    const row = db.prepare("SELECT * FROM qms_records WHERE id = ? AND record_type = 'organoleptic'").get(existingId);
    if (row) {
      // A signed organoleptic record is history — the flavor approval must not
      // rewrite it. Leave it alone and say so in the log.
      const appr = parseJson(row.approvals, {});
      if (Object.values(appr || {}).some(Boolean)) {
        console.warn(`[flavor→organoleptic] ${row.record_number} is signed; not updating from ${rec.record_number}`);
        return existingId;
      }
      const merged = { ...parseJson(row.data, {}), ...data };
      db.prepare(`UPDATE qms_records SET record_date = ?, data = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(rec.decision_date || rec.record_date || row.record_date, JSON.stringify(merged), existingId);
      logAudit(user, 'qms_updated', 'organoleptic', existingId,
        { synced_from: 'flavor_approval', source_record: rec.record_number }, row, null, row.record_number);
      const updated = flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(existingId));
      try { syncOrganolepticDisposal(db, org, updated, user); } catch (e) { console.error('[organoleptic→disposal]', e.message); }
      return existingId;
    }
  }

  const id = uuid();
  const number = nextNumber(db, org);
  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
    VALUES (?, 'organoleptic', ?, ?, NULL, ?, 0, ?)`).run(
    id, number, rec.decision_date || rec.record_date || null, JSON.stringify(data), user?.name || 'system');
  // Back-link on the flavor approval so the next save updates rather than
  // files a second organoleptic record.
  const faData = { ...parseJson(db.prepare('SELECT data FROM qms_records WHERE id = ?').get(rec.id)?.data, {}), organoleptic_record_id: id };
  db.prepare('UPDATE qms_records SET data = ? WHERE id = ?').run(JSON.stringify(faData), rec.id);

  logAudit(user, 'qms_created', 'organoleptic', id,
    { record_number: number, source: 'flavor_approval', source_record: rec.record_number }, null, null, number);

  // A failed tasting still raises the disposal draft, exactly as it would had
  // the organoleptic record been filed by hand.
  const created = flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id));
  try { syncOrganolepticDisposal(db, org, created, user); } catch (e) { console.error('[organoleptic→disposal]', e.message); }
  return id;
}

// ── create ───────────────────────────────────────────────────────────────────
router.post('/:type', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const id = uuid();
  const number = (req.body.record_number && String(req.body.record_number).trim()) || nextNumber(db, cfg);
  const data = pickData(cfg, req.body);
  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, document_url, capa_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, cfg.key, number, req.body.record_date || null, req.body.status || cfg.defaultStatus || null,
    JSON.stringify(data), req.body.paper_record ? 1 : 0, req.body.document_url || null,
    req.body.capa_id || null, req.body.notes || null, req.user.name);
  logAudit(req.user, 'qms_created', cfg.key, id, { record_number: number });
  const created = flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id));
  try { syncOrganolepticDisposal(db, cfg, created, req.user); } catch (e) { console.error('[organoleptic→disposal]', e.message); }
  try { syncFlavorOrganoleptic(db, cfg, created, req.user); } catch (e) { console.error('[flavor→organoleptic]', e.message); }
  try { syncKnifeMaster(db, cfg, created); } catch (e) { console.error('[knife→master]', e.message); }
  // Re-read: the sync hooks can write back to this record (the flavor approval
  // gets its organoleptic_record_id), and the caller should get the row as it
  // now stands rather than as it was a moment before.
  const fresh = flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id));
  try { fresh.possible_duplicate = findPossibleDuplicate(db, cfg, fresh); } catch { /* advisory only */ }
  res.status(201).json(fresh);
});

// Duplicate watcher: warn (never block) when a just-created record shares two
// or more identifying values (lot, product, work order, part #) with another
// record of the same type from the last 2 days — usually a double entry.
const DUP_KEYS = ['lot', 'lot_number', 'product', 'product_name', 'product_description', 'work_order', 'item_number', 'part_number'];
function findPossibleDuplicate(db, cfg, rec) {
  const mine = DUP_KEYS.map(k => [k, String(rec[k] ?? '').trim().toLowerCase()]).filter(([, v]) => v);
  if (mine.length < 2) return null;
  const recent = db.prepare(`SELECT record_number, data FROM qms_records
    WHERE record_type = ? AND id != ? AND created_at >= datetime('now', '-2 days')`).all(cfg.key, rec.id);
  for (const r of recent) {
    const d = parseJson(r.data, {});
    const matches = mine.filter(([k, v]) => String(d[k] ?? '').trim().toLowerCase() === v);
    if (matches.length >= 2) return { record_number: r.record_number, fields: matches.map(([k]) => k) };
  }
  return null;
}

// ── who may change a filed record ────────────────────────────────────────────
//
// FILING stays open on purpose: anyone who sees a deviation should be able to
// report it without hunting for permission. Everything after that is a
// records-integrity question, and these are SQF/GMP records.
//
// This was missing entirely — any signed-in operator could edit or hard-delete
// any deviation, non-conformance or on-hold record. bulk-delete already had the
// admin check; the single-record paths never got it.
const isRecordsRole = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'document_control'].includes((u?.department || '').toLowerCase());

function hasAnySignature(row) {
  const a = parseJson(row.approvals, {});
  return Object.values(a || {}).some(Boolean);
}

// Correcting a record you filed is normal work; correcting someone else's is a
// QA act. Once ANY approval signature is on it, the record is closed to
// everyone but an admin — a signed record that can still be edited is not a
// record.
function mayEdit(user, row) {
  if (user?.role === 'admin') return true;
  if (hasAnySignature(row)) return false;
  if (isRecordsRole(user)) return true;
  return !!user?.name && row.created_by === user.name;
}

// Deleting is for a mis-filed draft, never for history. Admin only, and never
// once something has been signed — that record gets voided through its status,
// not removed from the log.
function mayDelete(user, row) {
  if (user?.role !== 'admin') return false;
  return !hasAnySignature(row);
}

// What THIS user may do to THIS record, decided by the same two functions the
// write paths enforce. The client used to gate Edit on module permission alone,
// which offered the button on records the server would refuse — someone would
// fill the form in and the save would do nothing. The server is the authority;
// the client renders what it's told rather than keeping a second copy of the
// rule, which is how the two drift apart.
function withPermissions(flat, row, user) {
  const canEdit = mayEdit(user, row);
  const canDelete = mayDelete(user, row);
  return {
    ...flat,
    can_edit: canEdit,
    can_delete: canDelete,
    edit_block_reason: canEdit ? null
      : hasAnySignature(row)
        ? 'This record carries an approval signature. Only an admin can amend it — or the signature can be revoked first.'
        : 'You can only correct records you filed. Ask QA, a supervisor or Document Control to amend it.',
    // A missing Delete button with no explanation reads as a broken screen, and
    // people ask whether it's a bug — it isn't, it's the rule. Say which rule.
    delete_block_reason: canDelete ? null
      : hasAnySignature(row)
        ? 'This record has been signed, so it is history and cannot be deleted. Change its status instead — or revoke the signature, correct it, and sign again.'
        : 'Deleting a filed record is admin-only, because a deleted record is indistinguishable from one that never existed. If it was filed in error, change its status or ask an admin.',
  };
}

// ── update ───────────────────────────────────────────────────────────────────
router.put('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!mayEdit(req.user, existing)) {
    return res.status(403).json({
      error: hasAnySignature(existing)
        ? `${existing.record_number} carries an approval signature — only an admin can amend it.`
        : `You can only correct ${cfg.label} records you filed.`,
    });
  }
  // approvals are NOT settable here — they go through /approve
  const data = { ...parseJson(existing.data, {}), ...pickData(cfg, req.body) };
  db.prepare(`UPDATE qms_records SET record_number=?, record_date=?, status=?, data=?, paper_record=?, document_url=?, capa_id=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
    req.body.record_number ?? existing.record_number,
    req.body.record_date !== undefined ? (req.body.record_date || null) : existing.record_date,
    req.body.status !== undefined ? (req.body.status || null) : existing.status,
    JSON.stringify(data),
    req.body.paper_record !== undefined ? (req.body.paper_record ? 1 : 0) : existing.paper_record,
    req.body.document_url !== undefined ? (req.body.document_url || null) : existing.document_url,
    req.body.capa_id !== undefined ? (req.body.capa_id || null) : existing.capa_id,
    req.body.notes ?? existing.notes, req.params.id);
  logAudit(req.user, 'qms_updated', cfg.key, req.params.id, { record_number: existing.record_number });
  const updatedRow = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id);
  const updated = withPermissions(flatten(updatedRow), updatedRow, req.user);
  try { syncOrganolepticDisposal(db, cfg, updated, req.user); } catch (e) { console.error('[organoleptic→disposal]', e.message); }
  try { syncFlavorOrganoleptic(db, cfg, updated, req.user); } catch (e) { console.error('[flavor→organoleptic]', e.message); }
  // Both the old and the new tool id: retyping a sign-out onto a different
  // knife leaves the first one showing as still out otherwise.
  try { syncKnifeMaster(db, cfg, flatten(existing)); } catch (e) { console.error('[knife→master]', e.message); }
  try { syncKnifeMaster(db, cfg, updated); } catch (e) { console.error('[knife→master]', e.message); }
  const freshRow = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id);
  res.json(withPermissions(flatten(freshRow), freshRow, req.user));
});

// ── bulk ─────────────────────────────────────────────────────────────────────
router.post('/:type/bulk-delete', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  if (req.user.role !== 'admin') return res.status(403).json({ error: `Only an admin can permanently delete ${cfg.label}.` });
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const ph = ids.map(() => '?').join(',');
  const candidates = db.prepare(`SELECT * FROM qms_records WHERE record_type = ? AND id IN (${ph})`).all(cfg.key, ...ids);
  // A signed record is history — skip it and say so rather than silently
  // taking the whole selection down with it.
  const signed = candidates.filter(hasAnySignature);
  const found = candidates.filter(r => !hasAnySignature(r));
  if (found.length) {
    const fph = found.map(() => '?').join(',');
    db.prepare(`DELETE FROM qms_records WHERE id IN (${fph})`).run(...found.map(r => r.id));
  }
  for (const r of found) logAudit(req.user, 'qms_deleted', cfg.key, r.id, { record_number: r.record_number }, r, null);
  res.json({
    deleted: found.length,
    skipped_signed: signed.length,
    ...(signed.length ? { message: `${signed.length} signed record${signed.length > 1 ? 's were' : ' was'} kept — change status instead of deleting.` } : {}),
  });
});

router.post('/:type/bulk-update', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  // Same rule as editing one record, applied to a selection: changing status
  // or the paper-record flag across a batch is a QA act, not general access.
  if (!isRecordsRole(req.user)) {
    return res.status(403).json({ error: `Only QA, supervisors or admins can bulk-edit ${cfg.label}.` });
  }
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object is required' });

  // ANY field of the record type, not just status and the paper flag.
  //
  // Correcting a supplier name or a lot number across forty records was
  // forty trips through the form. The keys allowed are exactly the type's own
  // `fields` plus the scalars, so a patch can never write a key the form does
  // not define.
  const FIELD_KEYS = new Set(cfg.fields.map(f => f.key));
  const dataPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!FIELD_KEYS.has(k)) continue;
    const f = cfg.fields.find(x => x.key === k);
    let val = v;
    if (f.type === 'multiselect') val = Array.isArray(val) ? val : (val ? [val] : []);
    if (f.type === 'checkbox') val = !!val;
    dataPatch[k] = val;
  }
  const scalars = {};
  if (patch.paper_record !== undefined) scalars.paper_record = patch.paper_record ? 1 : 0;
  if (patch.status !== undefined) scalars.status = patch.status || null;
  if (patch.record_date !== undefined) scalars.record_date = patch.record_date || null;
  if (patch.notes !== undefined) scalars.notes = patch.notes || null;
  if (!Object.keys(dataPatch).length && !Object.keys(scalars).length) {
    return res.status(400).json({ error: 'Nothing in this change applies to these records.' });
  }

  const rows = db.prepare(
    `SELECT * FROM qms_records WHERE record_type = ? AND id IN (${ids.map(() => '?').join(',')})`).all(cfg.key, ...ids);

  const updated = [], skipped = [];
  const stmt = db.prepare(`UPDATE qms_records SET data = ?, paper_record = ?, status = ?, record_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const row of rows) {
      // A SIGNED RECORD IS NOT PART OF A BATCH. The same rule as editing one:
      // any approval signature closes it to everyone but an admin. Skipping and
      // reporting beats failing the whole selection — the other thirty-nine
      // corrections are real work.
      if (!mayEdit(req.user, row)) {
        skipped.push({
          record_number: row.record_number,
          reason: hasAnySignature(row) ? 'signed' : 'not yours to correct',
        });
        continue;
      }
      const data = { ...parseJson(row.data, {}), ...dataPatch };
      stmt.run(
        JSON.stringify(data),
        scalars.paper_record !== undefined ? scalars.paper_record : row.paper_record,
        scalars.status !== undefined ? scalars.status : row.status,
        scalars.record_date !== undefined ? scalars.record_date : row.record_date,
        scalars.notes !== undefined ? scalars.notes : row.notes,
        row.id);
      // Audited INDIVIDUALLY, with before and after — a bulk edit has to leave
      // the trail a manual one would, or the log cannot answer "who changed
      // this record". Plus one summary row for the action itself.
      const after = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(row.id);
      logAudit(req.user, 'qms_updated', cfg.key, row.id,
        { record_number: row.record_number, bulk: true, patch: { ...dataPatch, ...scalars } },
        row, after, row.record_number);
      updated.push(row.record_number);
    }
  });
  tx();

  logAudit(req.user, 'qms_bulk_updated', cfg.key, null,
    { count: updated.length, skipped: skipped.length, patch: { ...dataPatch, ...scalars } });
  // Bulk-marking sign-outs returned is a real workflow, and it moves the master
  // list exactly as a single edit does.
  if (cfg.key === 'knife_sign_out') {
    try { syncAllKnifeStatuses(db); } catch (e) { console.error('[knife→master]', e.message); }
  }
  res.json({
    updated: updated.length,
    skipped,
    ...(skipped.length ? { message: `${skipped.length} record${skipped.length > 1 ? 's were' : ' was'} left unchanged — a signed record is changed by status, not edited.` } : {}),
  });
});

// ── approvals ─────────────────────────────────────────────────────────────────
router.post('/:type/:id/approve', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const appr = cfg.approvals.find(a => a.key === req.body.role);
  if (!appr) return res.status(400).json({ error: 'Unknown approval role' });
  if (!canSignApproval(req.user, appr)) return res.status(403).json({ error: 'You are not authorized to sign this approval.' });
  const approvals = parseJson(row.approvals, {});
  // Capture the meaning of the signature (SQF/GMP e-signature intent), not just
  // who/when. Stored with the signature so it prints on the record and can't be
  // separated from the act of signing.
  const attestation = appr.attestation || `I certify that I have reviewed this ${(cfg.singular || 'record').toLowerCase()} and approve it in the capacity of ${appr.label}.`;
  approvals[appr.key] = { name: req.user.name, user_id: req.user.id, role: req.user.role, signed_at: new Date().toISOString(), attestation };
  db.prepare("UPDATE qms_records SET approvals=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(approvals), req.params.id);
  logAudit(req.user, `qms_signed_${appr.key}`, cfg.key, req.params.id, { record_number: row.record_number, attestation });
  {
    const r = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id);
    res.json(withPermissions(flatten(r), r, req.user));
  }
});

// Bulk QA review — ROUTINE records only. Limited to the high-volume sign-out
// logs, and within them only records where the item came back and both
// conditions were Good. Anything critical (bad condition, still out, or any
// other record type — deviations, NCs, holds…) must be signed individually so
// the audit trail shows deliberate review. Each signature is still a full
// per-record e-signature with attestation, marked as batch-reviewed.
// Exported so the QA Review Center works from the SAME definition of "routine"
// rather than a second, looser one. A record that fails `routine` is never
// offered as a checkbox anywhere — it has to be opened and signed deliberately.
const NEEDS_A_LOOK = ['Damaged', 'Lost'];

export const BULK_APPROVE = {
  // An outcome of Damaged or Lost is NOT routine: something went wrong and it
  // deserves QA opening the record, not a checkbox in a list. Used up is
  // routine — a chemical finishing is the ordinary end of a sign-out.
  maintenance_sign_out: { role: 'quality', routine: (r) => r.status === 'returned' && r.condition_out !== 'Bad' && r.condition_returned !== 'Bad' && !NEEDS_A_LOOK.includes(r.return_reason) },
  knife_sign_out: { role: 'quality', routine: (r) => r.status === 'returned' && r.condition_out !== 'Bad' && r.condition_returned !== 'Bad' && !NEEDS_A_LOOK.includes(r.return_reason) },
  // A component pull has no condition to triage on — what QA is confirming is
  // that the right lot went to the right MO, which is on every row.
  component_sign_out: { role: 'quality', routine: () => true },
};
/**
 * Sign one QMS approval. The QA Review Center calls this rather than writing
 * its own SQL, so a signature from the queue is byte-for-byte the signature the
 * module writes — same attestation, same audit entry.
 */
export function signQmsApproval(db, cfg, id, user, roleKey, { batch = false } = {}) {
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(id, cfg.key);
  if (!row) return { error: 'Not found', status: 404 };
  const appr = (cfg.approvals || []).find(a => a.key === roleKey);
  if (!appr) return { error: 'Unknown approval role', status: 400 };
  if (!canSignApproval(user, appr)) return { error: 'You are not authorized to sign this approval.', status: 403 };
  const flat = flatten(row);
  if (flat.approvals[roleKey]) return { error: `${flat.record_number} is already signed.`, status: 409 };
  const rule = BULK_APPROVE[cfg.key];
  if (batch && rule && !rule.routine(flat)) {
    return { error: `${flat.record_number} is not routine — open it and sign it individually.`, status: 400 };
  }
  const attestation = batch
    ? `I certify that I have reviewed this ${(cfg.singular || 'record').toLowerCase()} as part of a batch review of routine returned items in good condition, and approve it in the capacity of ${appr.label}.`
    : (appr.attestation || `I certify that I have reviewed this ${(cfg.singular || 'record').toLowerCase()} and approve it in the capacity of ${appr.label}.`);
  const approvals = { ...flat.approvals, [roleKey]: { name: user.name, user_id: user.id, role: user.role, signed_at: new Date().toISOString(), attestation, ...(batch ? { batch: true } : {}) } };
  db.prepare("UPDATE qms_records SET approvals=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(approvals), id);
  logAudit(user, `qms_signed_${roleKey}`, cfg.key, id, { record_number: flat.record_number, attestation, ...(batch ? { batch: true } : {}) });
  return { ok: true };
}

router.post('/:type/bulk-approve', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const rule = BULK_APPROVE[cfg.key];
  if (!rule) return res.status(400).json({ error: 'Bulk sign-off is only available for routine sign-out logs.' });
  const appr = cfg.approvals.find(a => a.key === rule.role);
  if (!appr || !canSignApproval(req.user, appr)) return res.status(403).json({ error: 'You are not authorized to sign this approval.' });
  const db = getDb();
  const rows = db.prepare('SELECT * FROM qms_records WHERE record_type = ?').all(cfg.key);
  let signed = 0, skipped = 0;
  const attestation = `I certify that I have reviewed this ${(cfg.singular || 'record').toLowerCase()} as part of a batch review of routine returned items in good condition, and approve it in the capacity of ${appr.label}.`;
  const upd = db.prepare("UPDATE qms_records SET approvals=?, updated_at=datetime('now') WHERE id=?");
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.paper_record) continue;
      const flat = flatten(row);
      if (flat.approvals[rule.role]) continue; // already signed
      if (!rule.routine(flat)) { skipped++; continue; }
      const approvals = { ...flat.approvals, [rule.role]: { name: req.user.name, user_id: req.user.id, role: req.user.role, signed_at: new Date().toISOString(), attestation, batch: true } };
      upd.run(JSON.stringify(approvals), row.id);
      logAudit(req.user, `qms_signed_${rule.role}`, cfg.key, row.id, { record_number: flat.record_number, batch: true });
      signed++;
    }
  });
  tx();
  res.json({ signed, skipped });
});

router.delete('/:type/:id/approve/:role', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const approvals = parseJson(row.approvals, {});
  const sig = approvals[req.params.role];
  if (!sig) return res.status(404).json({ error: 'Not signed' });
  if (req.user.role !== 'admin' && sig.user_id !== req.user.id) return res.status(403).json({ error: 'Only an admin or the original signer can revoke.' });
  delete approvals[req.params.role];
  db.prepare("UPDATE qms_records SET approvals=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(approvals), req.params.id);
  logAudit(req.user, `qms_unsigned_${req.params.role}`, cfg.key, req.params.id, { record_number: row.record_number });
  {
    const r = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id);
    res.json(withPermissions(flatten(r), r, req.user));
  }
});

// ── delete (single) ──────────────────────────────────────────────────────────
router.delete('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!mayDelete(req.user, existing)) {
    return res.status(403).json({
      error: hasAnySignature(existing)
        ? `${existing.record_number} has been signed and can no longer be deleted. Change its status instead.`
        : `Only an admin can permanently delete ${cfg.label}.`,
    });
  }
  db.prepare('DELETE FROM qms_records WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'qms_deleted', cfg.key, req.params.id, { record_number: existing.record_number }, existing, null);
  // Deleting the open sign-out is what frees the knife — without this the
  // master list keeps it issued to somebody with no record saying so.
  try { syncKnifeMaster(db, cfg, flatten(existing)); } catch (e) { console.error('[knife→master]', e.message); }
  res.json({ success: true });
});

// ── CSV import (seed historical paper logs) ──────────────────────────────────
export function importCsv(db, cfg, csvText, actor) {
  const rows = parseCsv(csvText).filter(r => r.some(c => (c || '').trim()));
  if (!rows.length) return { imported: 0 };
  // find header row: the one containing the number column keyword
  const norm = (s) => (s || '').toLowerCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
  const numKeys = (cfg.csv?.number || []).map(norm);
  const mapKeys = Object.entries(cfg.csv?.map || {}).map(([k, v]) => [norm(k), v]);
  const isNumberCol = (h) => numKeys.includes(h); // exact only — avoids matching "deviation description"
  // Header row = first row that has the number column or a known field header
  // (skips title banners like "Shelf-life Extensions").
  let headerIdx = rows.findIndex(r => r.some(c => { const h = norm(c); return isNumberCol(h) || mapKeys.some(([k]) => k === h); }));
  if (headerIdx < 0) headerIdx = 0;
  const header = rows[headerIdx].map(norm);
  // Exact header→field mapping only. Short keys like "date"/"lot" would wrongly
  // grab long headers ("management verified, (initial and date)") on substring,
  // so we require an exact normalized match; unmapped columns are ignored.
  const autoNumber = !!cfg.csv?.autoNumber;
  const colMap = header.map(h => {
    if (isNumberCol(h)) return '__number';
    const exact = mapKeys.find(([k]) => k === h);
    return exact ? exact[1] : null;
  });
  // Some logs put the record number in an unlabelled first column — if no header
  // matched as the number, treat column 0 as the record number (unless the log
  // has no ID column at all, in which case we auto-number below).
  if (!autoNumber && !colMap.includes('__number')) colMap[0] = '__number';
  // For status-tracked types, the "done" column maps to record status.
  const doneStatus = (cfg.statuses || []).find(s => s.done)?.value;
  const ins = db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, notes, data, paper_record, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  // seed a running auto-number counter from the current max for this type
  let counter = autoNumber ? (() => { let m = 0; for (const rr of db.prepare('SELECT record_number FROM qms_records WHERE record_type = ?').all(cfg.key)) { const g = String(rr.record_number || '').match(/\d+/g); if (g) m = Math.max(m, parseInt(g[g.length - 1], 10)); } return m; })() : 0;
  let imported = 0;
  const tx = db.transaction(() => {
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const cells = rows[r];
      let number = null, recordDate = null, notes = null, status = cfg.defaultStatus || null; const data = {};
      colMap.forEach((target, ci) => {
        const val = (cells[ci] || '').trim();
        if (!target || !val) return;
        if (target === '__number') number = val;
        else if (target === 'record_date') recordDate = val;
        else if (target === '__notes') notes = val;
        else if (target === '__status') status = /true|yes|done|released|complete/i.test(val) ? (doneStatus || 'released') : (cfg.defaultStatus || null);
        else data[target] = val;
      });
      // skip placeholder/blank rows (no body, no date, no number)
      if (!Object.keys(data).length && !recordDate && !number && !notes) continue;
      if (autoNumber) number = (cfg.numberPrefix || '') + String(++counter).padStart(cfg.numberPad || 3, '0');
      else if (!number) number = `row-${r}`;
      ins.run(uuid(), cfg.key, number, recordDate, status, notes, JSON.stringify(data), actor);
      imported++;
    }
  });
  tx();
  return { imported };
}

router.post('/:type/import', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  // Bulk-writing history into a compliance log is an admin act.
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: `Only an admin can import ${cfg.label} history.` });
  }
  const db = getDb();
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'csv is required' });
  const result = importCsv(db, cfg, csv, req.user.name);
  logAudit(req.user, 'qms_imported', cfg.key, null, result);
  res.json(result);
});

// ── PDF export ────────────────────────────────────────────────────────────────
router.get('/:type/:id/pdf', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const rec = flatten(row);
  const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${cfg.short}_${(rec.record_number || rec.id).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`);
  pdf.pipe(res);

  pdf.fontSize(15).font('Helvetica-Bold').text(cfg.singular, { align: 'center' });
  pdf.fontSize(8).font('Helvetica').text(cfg.formCode || '', { align: 'center' });
  pdf.moveDown(0.6);
  pdf.fontSize(10).font('Helvetica-Bold')
    .text(`${cfg.short} #: ${rec.record_number || '—'}`, { continued: true })
    .text(`      ${cfg.dateLabel || 'Date'}: ${rec.record_date || '—'}`);
  pdf.moveDown(0.5);

  pdf.font('Helvetica').fontSize(9);
  for (const f of cfg.fields) {
    let v = rec[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'checkbox') v = v ? 'Yes' : 'No';
    if (Array.isArray(v)) v = v.join(', ');
    pdf.font('Helvetica-Bold').text(`${f.label}: `, { continued: true }).font('Helvetica').text(String(v));
    pdf.moveDown(0.2);
  }
  if (rec.notes) { pdf.moveDown(0.2).font('Helvetica-Bold').text('Notes: ', { continued: true }).font('Helvetica').text(rec.notes); }

  if (cfg.statuses?.length) {
    const sd = cfg.statuses.find(s => s.value === rec.status);
    pdf.moveDown(0.4).font('Helvetica-Bold').text('Status: ', { continued: true }).font('Helvetica').text(sd?.label || rec.status || '—');
  }
  if (cfg.passFail) {
    const vals = cfg.passFail.fields.map(k => parseInt(rec[k], 10)).filter(n => !Number.isNaN(n));
    if (vals.length) {
      pdf.moveDown(0.4).font('Helvetica-Bold').text('Result: ', { continued: true }).font('Helvetica')
        .text(vals.some(n => n < cfg.passFail.threshold) ? 'FAIL' : 'PASS');
    }
  }
  if (cfg.approvals?.length) {
    pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Approvals');
    pdf.fontSize(9).font('Helvetica').moveDown(0.2);
    if (rec.paper_record) {
      pdf.font('Helvetica-Oblique').text('Logged on paper — signatures on file on the original form.').font('Helvetica').moveDown(0.2);
    }
    const sigDate = (s) => (s?.signed_at ? new Date(s.signed_at).toLocaleString() : '__________');
    for (const a of cfg.approvals) {
      const s = rec.approvals[a.key];
      pdf.font('Helvetica-Bold').text(`${a.label}${a.required ? ' *' : ''}: `, { continued: true })
        .font('Helvetica').text(`${s?.name || '__________________'}     Date: ${sigDate(s)}`);
      if (s?.attestation) {
        pdf.fontSize(8).font('Helvetica-Oblique').text(`   "${s.attestation}"`).font('Helvetica').fontSize(9);
      }
      pdf.moveDown(0.25);
    }
  }

  // Chain-of-custody: the full audit trail for this record, so the exported PDF
  // is a self-contained auditor artifact (who did what, when).
  const history = db.prepare(
    'SELECT timestamp, actor, action FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC'
  ).all(cfg.key, req.params.id);
  if (history.length) {
    const humanize = (a) => String(a || '')
      .replace(/^qms_signed_/, 'Signed — ')
      .replace(/^qms_unsigned_/, 'Signature revoked — ')
      .replace(/_/g, ' ');
    pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Record History');
    pdf.fontSize(8).font('Helvetica').moveDown(0.2);
    for (const h of history) {
      const ts = h.timestamp ? new Date(h.timestamp).toLocaleString() : '';
      pdf.text(`${ts}   ·   ${h.actor || 'system'}   ·   ${humanize(h.action)}`);
      pdf.moveDown(0.15);
    }
  }
  pdf.end();
});

export default router;
