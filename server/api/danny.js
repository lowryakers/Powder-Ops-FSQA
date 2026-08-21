// Danny's List — the request log for the person the whole org routes through.
//
// Danny works by text message, talk-to-text, and will not open ReadyDoc. So
// this module owns the MEMORY, never the pipe: what is outstanding, what he
// said (verbatim), and when. The outgoing text is composed HERE, in the
// batched "Your list:" format he already gets, and copied into the real
// iMessage thread — a Twilio pipe can be added per-item later without touching
// any of this, because the log never cares how a message travelled.
//
// Three rules that keep it honest:
//  - HIS WORDS ARE THE RECORD. A reply is stored verbatim and filed by a
//    person; nothing here parses "yeah that's fine go ahead" into a status.
//    He changes his mind quickly, and "what did Danny actually say, and when"
//    is the argument this log exists to settle.
//  - COMPOSING NEVER REWRITES. The list text is the item titles as captured —
//    the module formats, it does not phrase.
//  - A DECISION RECORDED BY HAND SAYS SO. Danny approves half of these
//    standing next to you; "approved verbally, recorded by <name>" is a
//    first-class outcome, the same doctrine as source:'paper' on NFP.

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { hasExplicitGrant } from '../module-access.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { createReadStream } from 'fs';
import crypto from 'crypto';
import { smsEnabled, sendSms, approverPhone } from '../sms.js';

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const cryptoRandom = () => crypto.randomBytes(24).toString('base64url');

/**
 * The PUBLIC shortcut endpoint — mounted separately in server.js, before the
 * auth middleware, because the caller is the iOS Shortcuts app holding a
 * token, not a browser holding a session. iOS never routes a URL into an
 * installed PWA, so "open ReadyDoc to log this" always meant a Safari tab and
 * a login screen; a direct POST means the Shortcut never leaves Messages at
 * all — it logs the reply and shows "Logged ✓" as a notification.
 *
 * The token authorises exactly this one insert. It cannot read the list.
 */
export function handleShortcutReply(req, res) {
  const db = getDb();
  const token = String(req.body?.token || req.query?.token || '').trim();
  const body = String(req.body?.body || req.body?.text || '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token.' });
  const hash = sha256(token);
  const user = db.prepare("SELECT id, name FROM users WHERE shortcut_token_hash = ? AND is_active = 1").get(hash);
  // A wrong token and a right token read the same from outside bar the status;
  // no hint about whether the endpoint is live for probing.
  if (!user) return res.status(401).json({ error: 'Not authorised.' });
  if (!body) return res.status(400).json({ error: 'Nothing to log — the clipboard was empty.' });
  const dup = db.prepare("SELECT id FROM danny_replies WHERE body = ? AND created_at > datetime('now', '-1 hour')").get(body);
  if (dup) return res.json({ ok: true, duplicate: true, message: 'Already logged.' });
  const id = uuid();
  db.prepare('INSERT INTO danny_replies (id, body, received_via, created_by) VALUES (?, ?, ?, ?)')
    .run(id, body, 'shortcut', user.name);
  logAudit(user.name, 'create', 'danny_reply', id, { via: 'shortcut', chars: body.length });
  res.status(201).json({ ok: true, duplicate: false, message: 'Logged — file it in ReadyDoc when you\'re back at a screen.' });
}

const router = Router();

// READS ARE GATED TOO, unlike most modules. The mount guard deliberately lets
// any mapped user GET a guarded module — cross-module reads are load-bearing
// elsewhere (the warehouse reading QA's film inspections). This list is
// different in kind: it is one person's private queue of the owner's payments
// and decisions, and "the warehouse can see what Danny is being asked to pay"
// is a leak, not a feature. The grant (or admin) is required to see anything.
// ADMINS INCLUDED. The first cut let role==='admin' straight through, which is
// the house rule everywhere else — and it meant every admin got the owner's
// payment queue on deploy day without anyone granting it. Opt-in means opt-in.
router.use((req, res, next) => {
  if (hasExplicitGrant(req.user, 'dannys-list')) return next();
  return res.status(403).json({ error: "Danny's List is granted per person in Settings — this account does not have it (admins included)." });
});

export const KINDS = ['approval', 'payment', 'action', 'fyi', 'assigned_to_me'];
export const STATUSES = ['open', 'waiting', 'approved', 'declined', 'scheduled', 'done', 'dropped'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// What "still needs something" means, in one place — the tabs, the compose
// picker and the triage screen all read it.
const OUTSTANDING = "('open','waiting','scheduled')";

const parseEvents = (raw) => { try { return JSON.parse(raw || '[]') || []; } catch { return []; } };

function addEvent(db, item, type, by, text) {
  const events = parseEvents(item.events);
  events.push({ at: new Date().toISOString(), by: by || 'system', type, ...(text ? { text: String(text) } : {}) });
  db.prepare("UPDATE danny_items SET events = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(events), item.id);
  return events;
}

const money = (n) => (n == null || n === '' ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

// One line of the "Your list:" text — the title as captured, with the facts a
// payment travels with tacked on compactly. Nothing is rephrased.
export function composeLine(it) {
  // Titles can be typed multi-line now; a list line is still one line.
  const bits = [String(it.title).replace(/\s*\n+\s*/g, ' ').trim()];
  if (it.amount != null && it.amount !== '') bits.push(`— ${money(it.amount)}`);
  if (it.reference) bits.push(`(${it.reference})`);
  if (it.due_date) bits.push(`— need by ${it.due_date}`);
  return `- ${bits.join(' ')}`;
}

export function composeList(items) {
  return ['Your list:', ...items.map(composeLine)].join('\n');
}

// The chase, phrased per kind the way the real thread phrases it. Prefilled
// and editable client-side — the module suggests, the sender decides.
export function composeChase(it) {
  const facts = [money(it.amount), it.reference && `(${it.reference})`].filter(Boolean).join(' ');
  const tail = [String(it.title).replace(/\s*\n+\s*/g, ' ').trim(), facts].filter(Boolean).join(' — ');
  const due = it.due_date ? ` It's needed by ${it.due_date}.` : '';
  if (it.kind === 'payment') return `Did you pay this? ${tail}.${due}`;
  if (it.kind === 'approval') return `Any word on this one? ${tail}.${due}`;
  return `Where are we on this? ${tail}.${due}`;
}

/* ── Items ────────────────────────────────────────────────────────────────── */

router.get('/', (req, res) => {
  const db = getDb();
  const { view, kind, q } = req.query;
  let sql = 'SELECT * FROM danny_items WHERE 1=1';
  const params = [];
  if (view === 'outstanding') sql += ` AND status IN ${OUTSTANDING}`;
  else if (view === 'done') sql += ` AND status NOT IN ${OUTSTANDING}`;
  if (kind && KINDS.includes(kind)) { sql += ' AND kind = ?'; params.push(kind); }
  if (q) { sql += ' AND (title LIKE ? OR details LIKE ? OR reference LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, COALESCE(due_date, \'9999\'), created_at DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params).map(r => ({ ...r, events: parseEvents(r.events) }));
  const unfiled = db.prepare('SELECT COUNT(*) c FROM danny_replies WHERE filed = 0').get().c;
  res.json({ items: rows, unfiled_replies: unfiled });
});

router.post('/', (req, res) => {
  const db = getDb();
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : null;
  const title = String(req.body?.title || '').trim();
  if (!kind) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
  if (!title) return res.status(400).json({ error: 'A title is required — it is the line Danny will read.' });
  const priority = PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'normal';
  const amount = req.body?.amount === '' || req.body?.amount == null ? null : Number(req.body.amount);
  if (amount != null && !Number.isFinite(amount)) return res.status(400).json({ error: 'amount must be a number' });

  const id = uuid();
  db.prepare(`INSERT INTO danny_items (id, kind, title, details, amount, reference, due_date, priority, created_by, events)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, kind, title, String(req.body?.details || '').trim() || null, amount,
      String(req.body?.reference || '').trim() || null, String(req.body?.due_date || '').trim() || null,
      priority, req.user.name,
      JSON.stringify([{ at: new Date().toISOString(), by: req.user.name, type: 'captured' }]));
  logAudit(req.user, 'create', 'danny_item', id, { kind, title, amount }, null, null, title);
  const row = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(id);
  res.status(201).json({ ...row, events: parseEvents(row.events) });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  const fields = {};
  for (const k of ['title', 'details', 'reference', 'due_date']) {
    if (req.body?.[k] !== undefined) fields[k] = String(req.body[k] || '').trim() || null;
  }
  if (fields.title === null) return res.status(400).json({ error: 'A title is required.' });
  if (req.body?.amount !== undefined) {
    const amount = req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount);
    if (amount != null && !Number.isFinite(amount)) return res.status(400).json({ error: 'amount must be a number' });
    fields.amount = amount;
  }
  if (req.body?.priority !== undefined) {
    if (!PRIORITIES.includes(req.body.priority)) return res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
    fields.priority = req.body.priority;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to change.' });
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE danny_items SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(fields), it.id);
  logAudit(req.user, 'update', 'danny_item', it.id, { changed: Object.keys(fields) }, it, null, it.title);
  const row = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(it.id);
  res.json({ ...row, events: parseEvents(row.events) });
});

// Move an item's status by hand — including recording a decision Danny gave
// verbally or by tapback in the thread. The note carries his words when there
// are any; `recorded_by` on the event says a person filed it.
router.post('/:id/status', (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  const note = String(req.body?.note || '').trim();
  const decided = ['approved', 'declined', 'scheduled', 'done'].includes(status);
  db.prepare(`UPDATE danny_items SET status = ?, decided_at = CASE WHEN ? THEN COALESCE(decided_at, datetime('now')) ELSE decided_at END, updated_at = datetime('now') WHERE id = ?`)
    .run(status, decided ? 1 : 0, it.id);
  addEvent(db, it, `status:${status}`, req.user.name, note || null);
  logAudit(req.user, 'update', 'danny_item', it.id, { status, note: note || undefined }, { status: it.status }, { status }, it.title);
  const row = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(it.id);
  res.json({ ...row, events: parseEvents(row.events) });
});

// A real delete, not a status. This list is one person's working queue, not a
// compliance record — a typo'd capture or a test item deserves to be GONE, and
// forcing it to live forever as "dropped" is what makes a queue unreadable.
// The full item, events and all, goes into the audit trail, so nothing is
// erasable without trace; attachments' objects are removed with their rows.
router.delete('/:id', async (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  const files = db.prepare('SELECT * FROM danny_attachments WHERE item_id = ?').all(it.id);
  db.transaction(() => {
    db.prepare('DELETE FROM danny_attachments WHERE item_id = ?').run(it.id);
    db.prepare('DELETE FROM danny_items WHERE id = ?').run(it.id);
  })();
  for (const f of files) {
    try { if (storageEnabled()) await deleteObject(f.storage_key); } catch { /* row is gone; orphaned, not leaked */ }
  }
  logAudit(req.user, 'delete', 'danny_item', it.id,
    { kind: it.kind, status: it.status, attachments: files.length }, it, null, it.title);
  res.json({ ok: true });
});

// An unfiled junk reply (a mis-copy, a test) can be discarded outright —
// distinct from "Done filing", which says the reply was READ and handled.
router.delete('/replies/:id', async (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM danny_replies WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const media = db.prepare('SELECT * FROM danny_reply_media WHERE reply_id = ?').all(r.id);
  db.transaction(() => {
    db.prepare('DELETE FROM danny_reply_media WHERE reply_id = ?').run(r.id);
    db.prepare('DELETE FROM danny_replies WHERE id = ?').run(r.id);
  })();
  for (const m of media) {
    try { if (storageEnabled()) await deleteObject(m.storage_key); } catch { /* orphaned, not leaked */ }
  }
  logAudit(req.user, 'delete', 'danny_reply', r.id, { via: r.received_via, chars: r.body.length }, r, null);
  res.json({ ok: true });
});

router.post('/:id/note', (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  const note = String(req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'A note is required.' });
  const events = addEvent(db, it, 'note', req.user.name, note);
  logAudit(req.user, 'update', 'danny_item', it.id, { note }, null, null, it.title);
  res.json({ ok: true, events });
});

/* ── Composing the text ───────────────────────────────────────────────────── */

// Build the "Your list:" message for the ticked items. Marks each as waiting
// and stamps last_sent_at — copying IS sending in practice, and an item that
// was copied and then not sent is one status click to put back.
router.post('/compose', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one item.' });
  const items = ids.map(id => db.prepare('SELECT * FROM danny_items WHERE id = ?').get(id)).filter(Boolean);
  if (!items.length) return res.status(404).json({ error: 'No such items.' });
  const text = items.length === 1
    ? composeLine(items[0]).replace(/^- /, '')
    : composeList(items);
  const tx = db.transaction(() => {
    for (const it of items) {
      db.prepare(`UPDATE danny_items SET status = CASE WHEN status = 'open' THEN 'waiting' ELSE status END,
        last_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(it.id);
      addEvent(db, it, 'sent_in_list', req.user.name, null);
    }
  });
  tx();
  logAudit(req.user, 'update', 'danny_item', null, { action: 'composed_list', items: items.length }, null, null);
  res.json({ text, items: items.length });
});

router.post('/:id/chase', (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  const text = composeChase(it);
  db.prepare("UPDATE danny_items SET chase_count = chase_count + 1, updated_at = datetime('now') WHERE id = ?").run(it.id);
  addEvent(db, it, 'chased', req.user.name, null);
  logAudit(req.user, 'update', 'danny_item', it.id, { action: 'chase', count: it.chase_count + 1 }, null, null, it.title);
  res.json({ text });
});

/* ── His replies ──────────────────────────────────────────────────────────── */

router.get('/replies', async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM danny_replies WHERE filed = 0 ORDER BY created_at ASC LIMIT 100').all();
  res.json(await Promise.all(rows.map(async r => ({
    ...r,
    media: storageEnabled()
      ? await Promise.all(db.prepare('SELECT * FROM danny_reply_media WHERE reply_id = ?').all(r.id)
          .map(async m => ({ id: m.id, content_type: m.content_type, url: await presignGet(m.storage_key) })))
      : [],
  }))));
});

router.post('/replies', (req, res) => {
  const db = getDb();
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'The reply text is required.' });
  // The same reply logged twice (a Shortcut fired twice, a double paste) is one
  // reply. Recent-identical is a duplicate, not new information.
  const dup = db.prepare("SELECT id FROM danny_replies WHERE body = ? AND created_at > datetime('now', '-1 hour')").get(body);
  if (dup) return res.status(200).json({ id: dup.id, duplicate: true });
  const id = uuid();
  const via = ['manual', 'shortcut', 'sms'].includes(req.body?.via) ? req.body.via : 'manual';
  db.prepare('INSERT INTO danny_replies (id, body, received_via, created_by) VALUES (?, ?, ?, ?)')
    .run(id, body, via, req.user.name);
  logAudit(req.user, 'create', 'danny_reply', id, { via, chars: body.length });
  res.status(201).json({ id, duplicate: false });
});

// File (part of) a reply against one item: outcome + his words. One reply is
// routinely filed against several items — he answers the whole list at once.
router.post('/replies/:id/file', (req, res) => {
  const db = getDb();
  const reply = db.prepare('SELECT * FROM danny_replies WHERE id = ?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.body?.item_id);
  if (!it) return res.status(404).json({ error: 'Item not found' });
  const outcome = req.body?.outcome;
  const OUTCOMES = ['approved', 'declined', 'scheduled', 'done', 'feedback'];
  if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: `outcome must be one of ${OUTCOMES.join(', ')}` });

  // The excerpt is his words for THIS item; default the whole reply, because
  // losing his phrasing is losing the record.
  const excerpt = String(req.body?.excerpt || '').trim() || reply.body;
  const tx = db.transaction(() => {
    if (outcome !== 'feedback') {
      db.prepare(`UPDATE danny_items SET status = ?, decided_at = COALESCE(decided_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
        .run(outcome, it.id);
    }
    addEvent(db, it, outcome === 'feedback' ? 'danny_feedback' : `danny_${outcome}`, 'Danny (filed by ' + req.user.name + ')', excerpt);
    // A screenshot that arrived WITH the reply (his payment confirmation)
    // belongs on the item it answers. Filing transfers it.
    for (const m of db.prepare('SELECT * FROM danny_reply_media WHERE reply_id = ?').all(reply.id)) {
      db.prepare('INSERT INTO danny_attachments (id, item_id, storage_key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), it.id, m.storage_key, 'texted-by-danny.' + (String(m.content_type || '').includes('png') ? 'png' : String(m.content_type || '').includes('pdf') ? 'pdf' : 'jpg'), m.content_type, m.size, 'Danny (SMS)');
      db.prepare('DELETE FROM danny_reply_media WHERE id = ?').run(m.id);
    }
  });
  tx();
  logAudit(req.user, 'update', 'danny_item', it.id,
    { action: 'reply_filed', outcome, reply_id: reply.id }, { status: it.status },
    { status: outcome === 'feedback' ? it.status : outcome }, it.title);
  const row = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(it.id);
  res.json({ ...row, events: parseEvents(row.events) });
});

router.post('/replies/:id/handled', (req, res) => {
  const db = getDb();
  const reply = db.prepare('SELECT * FROM danny_replies WHERE id = ?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  db.prepare('UPDATE danny_replies SET filed = 1 WHERE id = ?').run(reply.id);
  logAudit(req.user, 'update', 'danny_reply', reply.id, { handled: true });
  res.json({ ok: true });
});

/* ── The Twilio pipe (optional, per send) ─────────────────────────────────── */

// A SECOND number, dedicated to this list — never the AI/flavour number, so
// Danny's task thread and his question thread stay separate conversations.
// Off entirely until DANNY_SMS_FROM is set; the copy-paste pipe keeps working
// regardless, because the log never cares how a message travelled.
//
// Env: DANNY_SMS_FROM (E.164, a number in the approved A2P campaign) and
// optionally DANNY_SMS_TO (Danny's mobile; falls back to FLAVOR_APPROVER_PHONE).
export function dannySmsConfigured() {
  return smsEnabled() && !!(process.env.DANNY_SMS_FROM || '').trim();
}
const dannyTo = () => (process.env.DANNY_SMS_TO || '').trim() || approverPhone();

router.get('/sms-config', (req, res) => {
  res.json({ enabled: dannySmsConfigured(), to: dannyTo() ? `…${String(dannyTo()).slice(-4)}` : null });
});

// Send the composed list (or a chase) down the Twilio pipe instead of copying.
// Same composition, same events — only the transport differs.
router.post('/send', async (req, res) => {
  if (!dannySmsConfigured()) return res.status(503).json({ error: 'Direct texting is not configured (DANNY_SMS_FROM). Use Copy — it is the same message.' });
  const to = dannyTo();
  if (!to) return res.status(503).json({ error: 'No recipient configured (DANNY_SMS_TO or FLAVOR_APPROVER_PHONE).' });
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one item.' });
  const items = ids.map(id => db.prepare('SELECT * FROM danny_items WHERE id = ?').get(id)).filter(Boolean);
  if (!items.length) return res.status(404).json({ error: 'No such items.' });
  const text = items.length === 1 ? composeLine(items[0]).replace(/^- /, '') : composeList(items);
  try {
    // From the dedicated number, deliberately NOT the Messaging Service — the
    // service would pick any number in its pool and split Danny's thread.
    const r = await sendSms(to, text, { from: (process.env.DANNY_SMS_FROM || '').trim() });
    const tx = db.transaction(() => {
      for (const it of items) {
        db.prepare(`UPDATE danny_items SET status = CASE WHEN status = 'open' THEN 'waiting' ELSE status END,
          last_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(it.id);
        addEvent(db, it, 'texted_direct', req.user.name, null);
      }
    });
    tx();
    logAudit(req.user, 'update', 'danny_item', null, { action: 'texted_direct', items: items.length, sid: r?.sid || null }, null, null);
    res.json({ ok: true, sent: items.length, status: r?.status || null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * Inbound from the dedicated number — called by sms-inbound.js AFTER the
 * Twilio signature check, only for messages arriving on DANNY_SMS_FROM. His
 * reply lands VERBATIM in the same inbox the paste and the Shortcut feed;
 * nothing here decides anything. MMS media (the payment-confirmation
 * screenshot) is fetched from Twilio and parked in R2 against the reply, and
 * filing the reply carries it onto the item.
 */
export async function handleDannyInboundSms(db, from, body, mediaUrls = []) {
  const text = String(body || '').trim();
  const id = uuid();
  const finalBody = text || (mediaUrls.length ? '(photo)' : '');
  if (!finalBody) return null;
  const dup = db.prepare("SELECT id FROM danny_replies WHERE body = ? AND created_at > datetime('now', '-1 hour')").get(finalBody);
  if (dup && !mediaUrls.length) return dup.id;
  db.prepare('INSERT INTO danny_replies (id, body, received_via, created_by) VALUES (?, ?, ?, ?)')
    .run(id, finalBody, 'sms', 'Danny');
  logAudit('sms:Danny', 'create', 'danny_reply', id, { via: 'sms', chars: finalBody.length, media: mediaUrls.length });

  if (mediaUrls.length && storageEnabled()) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    for (const [i, url] of mediaUrls.entries()) {
      try {
        const resp = await fetch(url, { headers: { Authorization: auth } });
        if (!resp.ok) continue;
        const contentType = resp.headers.get('content-type') || 'application/octet-stream';
        const ext = contentType.includes('png') ? 'png' : contentType.includes('pdf') ? 'pdf' : 'jpg';
        const key = `danny/replies/${id}/${i}.${ext}`;
        const buf = Buffer.from(await resp.arrayBuffer());
        await putStream(key, buf, contentType);
        db.prepare('INSERT INTO danny_reply_media (id, reply_id, storage_key, content_type, size) VALUES (?, ?, ?, ?, ?)')
          .run(uuid(), id, key, contentType, buf.length);
      } catch (e) { console.warn('[danny] media fetch failed:', e.message); }
    }
  }
  return id;
}

/* ── The iOS Shortcut's key ───────────────────────────────────────────────── */

// Generate (or replace) the caller's shortcut token. Returned in clear exactly
// once and stored as SHA-256 — the same rule as every magic link here. The
// token authorises precisely one act (logging a reply body), so a leaked one
// cannot read the list, decide anything, or touch any other module.
router.post('/shortcut-token', (req, res) => {
  const db = getDb();
  const token = cryptoRandom();
  db.prepare("UPDATE users SET shortcut_token_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(sha256(token), req.user.id);
  logAudit(req.user, 'update', 'user', req.user.id, { action: 'danny_shortcut_token_issued' }, null, null, req.user.name);
  res.json({ token });
});

/* ── Attachments (payment confirmations, the invoice a request travels with) ─ */

const attachUpload = mediaUpload({ files: 5 }).array('files', 5);
const receiveFiles = (req, res, next) => attachUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

router.post('/:id/attachments', receiveFiles, async (req, res) => {
  const db = getDb();
  const it = db.prepare('SELECT * FROM danny_items WHERE id = ?').get(req.params.id);
  if (!it) { cleanupTemp(req.files); return res.status(404).json({ error: 'Not found' }); }
  if (!storageEnabled()) { cleanupTemp(req.files); return res.status(503).json({ error: 'File storage is not configured (R2).' }); }
  const oversize = rejectOversize(req.files);
  if (oversize) { cleanupTemp(req.files); return res.status(413).json({ error: oversize }); }
  try {
    const out = [];
    for (const f of req.files || []) {
      const key = `danny/${it.id}/${uuid()}-${f.originalname}`;
      await putStream(key, createReadStream(f.path), f.mimetype);
      const id = uuid();
      db.prepare('INSERT INTO danny_attachments (id, item_id, storage_key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, it.id, key, f.originalname, f.mimetype, f.size, req.user.name);
      out.push({ id, filename: f.originalname });
    }
    addEvent(db, it, 'attachment', req.user.name, out.map(o => o.filename).join(', '));
    logAudit(req.user, 'update', 'danny_item', it.id, { attached: out.length }, null, null, it.title);
    res.status(201).json(out);
  } finally { cleanupTemp(req.files); }
});

router.get('/:id/attachments', async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM danny_attachments WHERE item_id = ? ORDER BY created_at').all(req.params.id);
  res.json(await Promise.all(rows.map(async a => ({
    id: a.id, filename: a.filename, content_type: a.content_type, size: a.size,
    uploaded_by: a.uploaded_by, created_at: a.created_at,
    url: storageEnabled() ? await presignGet(a.storage_key) : null,
  }))));
});

router.delete('/attachments/:id', async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM danny_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM danny_attachments WHERE id = ?').run(a.id);
  try { if (storageEnabled()) await deleteObject(a.storage_key); } catch { /* row is gone; the object is orphaned, not leaked */ }
  logAudit(req.user, 'delete', 'danny_attachment', a.id, { filename: a.filename });
  res.json({ ok: true });
});

export default router;
