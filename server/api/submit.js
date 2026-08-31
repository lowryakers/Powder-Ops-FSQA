import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { getType, CHEMICAL_USE_SPECS } from '../qms-config.js';
import { getChannelByName, postMessageAs, getBotUser } from './comms.js';
import { SCALE_FORMS, SCALE_PROCEDURE, procedureFor } from '../scale-forms.js';
import { recordScaleVerification } from './scale-verification.js';
import { activeChemicalNames, syncFlavorOrganoleptic } from './qms.js';
import { openSignOuts, syncKnifeStatus, toolIdOf } from '../knife-state.js';
import { readyDocOrigin } from '../links.js';
import { requireKioskToken } from '../kiosk-tokens.js';

const router = Router();

router.get('/equipment-list', requireKioskToken('maintenance'), (_req, res) => {
  const db = getDb();
  const equipment = db.prepare("SELECT id, name, type, location, asset_id FROM equipment WHERE status = 'active' ORDER BY name").all();
  res.json(equipment);
});

router.post('/work-order', requireKioskToken('maintenance'), (req, res) => {
  const db = getDb();
  const { equipment_id, title, description, priority, submitted_by, attachments } = req.body;

  // EQUIPMENT IS OPTIONAL, and that is the point of this form.
  //
  // The QR is posted where staff report problems, and a great many problems
  // are not a machine in the register: a leaking pipe, a light out, a door
  // that won't latch, a machine nobody has entered yet. Requiring it meant the
  // search came back "No equipment found" and the report was simply lost —
  // the person who scanned the code walked away, and nothing recorded that
  // anything was wrong.
  //
  // `work_orders.equipment_id` is nullable and every list LEFT JOINs it (the
  // fix for tasks raised from chat appearing on one screen and not another),
  // so a report with no machine behaves like any other task.
  if (!title || !submitted_by) {
    return res.status(400).json({ error: 'A title and your name are required.' });
  }

  const id = uuid();
  const due_date = new Date();
  due_date.setDate(due_date.getDate() + 7);

  db.prepare(`
    INSERT INTO work_orders (id, equipment_id, title, description, priority, assigned_to, due_date, attachments, task_group)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'maintenance')
  `).run(id, equipment_id || null, title, description || null, priority || 'normal', due_date.toISOString().split('T')[0], JSON.stringify(attachments || []));

  logAudit(submitted_by, 'submit_public', 'work_order', id, { title, submitted_by }, null, null, title);
  res.status(201).json({ id, message: 'Work order submitted successfully' });
});

// ── QMS kiosk helpers ─────────────────────────────────────────────────────────
function parseJson(raw, fallback) { if (!raw) return fallback; try { return JSON.parse(raw); } catch { return fallback; } }

// Next sequential record number for a QMS type (mirrors qms.js nextNumber).
function nextNumber(db, cfg) {
  const rows = db.prepare('SELECT record_number FROM qms_records WHERE record_type = ?').all(cfg.key);
  let max = 0;
  for (const r of rows) {
    const m = String(r.record_number || '').match(/\d+/g);
    if (m) max = Math.max(max, parseInt(m[m.length - 1], 10));
  }
  return (cfg.numberPrefix || '') + String(max + 1).padStart(cfg.numberPad || 3, '0');
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Knife / Blade kiosk ───────────────────────────────────────────────────────
// Public roster of registered knives so a floor user can pick theirs. Excludes
// decommissioned tools. Returns just enough to render + toggle each one.
// The kiosk catalogue. Whether a knife is OUT is read from the sign-out LOG,
// never from the master row's stored status — that column is a mirror, and it
// was the only thing the kiosk consulted, so a return recorded in the app left
// the scanner insisting the knife was still out and refusing to sign it out
// again. See server/knife-state.js for the rule.
router.get('/knife-list', requireKioskToken('knife'), (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM qms_records WHERE record_type = 'knife_accountability' AND (status IS NULL OR status != 'decommissioned') ORDER BY record_number").all();
  const held = openSignOuts(db);
  const list = rows.map(r => {
    const data = parseJson(r.data, {});
    const toolId = toolIdOf(r, data);
    const holder = held.get(toolId) || null;
    return {
      id: r.id,
      record_number: r.record_number,
      tool_id: toolId,
      status: holder ? 'issued' : 'available',
      // NO NAME ON A PUBLIC PATH. This route is unauthenticated — the knife
      // kiosk is a QR code and has no session — so anybody who knows the URL
      // could read which named employee is holding which controlled blade.
      // That is food-defence information about a person, and the kiosk does not
      // need it: it only has to say the knife is not available. The screen
      // already renders "issued to someone" when the name is absent, so this
      // costs nothing operationally. Found by probing the kiosk's own origin.
      // The name is still on the sign-out record itself, behind a session.
      issued_to: null,
      // What the operator needs when the answer surprises them: the log record
      // that says it is out, so they can go and look at it.
      sign_out_record: holder?.record_number || null,
    };
  });
  res.json(list);
});

// Check a knife out (Available → Issued) or back in (Issued → Available). The
// tool record holds current state (so the Master List stays accurate) and each
// check-out opens a knife_sign_out log record (Form 440-02) that the check-in
// closes — the log record then awaits the in-app QA review sign-off, mirroring
// the Equipment/Tool/Chemical Sign In-Out flow.
router.post('/knife', requireKioskToken('knife'), (req, res) => {
  const db = getDb();
  const { record_id, person, condition } = req.body;
  const name = (person || '').trim();
  if (!record_id || !name) return res.status(400).json({ error: 'Please pick a knife and enter your name.' });

  const row = db.prepare("SELECT * FROM qms_records WHERE id = ? AND record_type = 'knife_accountability'").get(record_id);
  if (!row) return res.status(404).json({ error: 'Knife not found' });
  if (row.status === 'decommissioned') return res.status(400).json({ error: 'This knife has been decommissioned.' });

  const data = parseJson(row.data, {});
  const toolId = toolIdOf(row, data);
  // Out or in is decided by the LOG, not by the master row's stored status.
  // Those two disagreed whenever a return was recorded in the app, and the
  // kiosk believed the stale one.
  const wasIssued = !!openSignOuts(db).get(toolId);
  const action = wasIssued ? 'in' : 'out';
  const cond = condition === 'Bad' ? 'Bad' : 'Good';
  const logCfg = getType('knife_sign_out');
  const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (wasIssued) {
    // Check in: clear the holder, record who returned it + condition.
    data.returned_by = name;
    data.condition = cond;
    data.issued_to = '';
  } else {
    // Check out: record the new holder + condition.
    data.issued_to = name;
    data.condition = cond;
    data.returned_by = '';
  }

  let logNumber = null;
  db.transaction(() => {
    db.prepare("UPDATE qms_records SET status = ?, data = ?, record_date = ?, updated_at = datetime('now') WHERE id = ?")
      .run(wasIssued ? 'available' : 'issued', JSON.stringify(data), today(), record_id);

    if (wasIssued) {
      // Close the open sign-out log entry for this tool (latest first). A tool
      // issued before the log existed has none — record the return standalone
      // so the accountability log still shows it.
      const open = db.prepare(`SELECT * FROM qms_records WHERE record_type = 'knife_sign_out' AND status = 'out'
        AND json_extract(data, '$.tool_id') = ? ORDER BY created_at DESC LIMIT 1`).get(toolId);
      if (open) {
        const logData = parseJson(open.data, {});
        logData.condition_returned = cond;
        logData.return_date = today();
        logData.return_time = nowTime();
        logData.returned_by = name;
        db.prepare("UPDATE qms_records SET status = 'returned', data = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(logData), open.id);
        logNumber = open.record_number;
      } else {
        const id = uuid();
        logNumber = nextNumber(db, logCfg);
        const logData = { tool_id: toolId, employee_name: name, condition_returned: cond, return_date: today(), return_time: nowTime(), returned_by: name };
        db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
          VALUES (?, 'knife_sign_out', ?, ?, 'returned', ?, 0, ?)`).run(id, logNumber, today(), JSON.stringify(logData), name);
      }
    } else {
      const id = uuid();
      logNumber = nextNumber(db, logCfg);
      const logData = { tool_id: toolId, employee_name: name, condition_out: cond, time_out: nowTime() };
      db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
        VALUES (?, 'knife_sign_out', ?, ?, 'out', ?, 0, ?)`).run(id, logNumber, today(), JSON.stringify(logData), name);
    }
  })();

  // Re-derive the mirror from what the log now says, rather than trusting the
  // status this handler just wrote — one function owns that column.
  syncKnifeStatus(db, toolId);

  logAudit(name, action === 'out' ? 'knife_check_out' : 'knife_check_in', 'knife_accountability', record_id,
    { tool_id: toolId, condition: cond, sign_out_record: logNumber, via: 'kiosk' }, null, null, toolId);

  res.status(201).json({ ok: true, action, tool_id: toolId, condition: cond, record_number: logNumber });
});

// ── Flavor approval by magic link ─────────────────────────────────────────────
// The approver (Danny) gets a texted link with a long random token — no login.
// GET shows the request; POST records the decision, closes the token, and
// announces the result in #batching.
function flavorByToken(db, token) {
  if (!token || token.length < 20) return null;
  const rows = db.prepare("SELECT * FROM qms_records WHERE record_type = 'flavor_approval' AND status = 'pending'").all();
  return rows.find(r => parseJson(r.data, {}).approval_token === token) || null;
}

router.get('/flavor-approval/:token', (req, res) => {
  const db = getDb();
  const row = flavorByToken(db, req.params.token);
  if (!row) return res.status(404).json({ error: 'This approval link is invalid or already used.' });
  const d = parseJson(row.data, {});
  res.json({
    record_number: row.record_number,
    product_name: d.product_name, lot_number: d.lot_number, work_order: d.work_order,
    batched_on: d.batched_on, sample_quantity: d.sample_quantity,
    // QA'S EVALUATION, SHOWN TO THE APPROVER — read-only, and the reason the
    // page is worth opening rather than replying to the text. The approver is
    // deciding whether to ship a batch; the scores are what that decision is
    // made on, and until now the page showed a product name and two buttons.
    // The name and date travel with them: an unattributed score is an opinion,
    // an attributed one is a record.
    sensory: {
      appearance: d.appearance || null, texture: d.texture || null, aroma: d.aroma || null,
      flavor: d.flavor || null, overall: d.overall || null,
      by: d.sensory_by || null, at: d.sensory_at || null, notes: d.sensory_notes || null,
    },
    batch_adjustments: d.batch_adjustments || null,
  });
});

/**
 * Apply a flavour decision to a pending record — shared by the magic link and
 * the reply-by-text path, so a decision is byte-for-byte the same record
 * whichever door it came through (the qms.js decide() doctrine).
 */
export async function applyFlavorDecision(db, row, { decision, name, comments, via = 'sms-link' }) {
  const d = parseJson(row.data, {});
  // THE APPROVER'S NAME IS REQUIRED, whichever door — the link page asks for
  // it, the text path resolves it from the sender's number.
  const decidedBy = String(name || '').trim();
  if (decidedBy.length < 2) return { error: 'Please type your name — an approval has to say who made it.', status: 400 };
  d.decided_by = decidedBy;
  d.decision_date = today();
  if (comments) d.comments = String(comments).slice(0, 500);
  delete d.approval_token; // single use
  db.prepare("UPDATE qms_records SET status = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(decision, JSON.stringify(d), row.id);
  logAudit(d.decided_by, decision === 'approved' ? 'flavor_approved' : 'flavor_denied', 'flavor_approval', row.id,
    { record_number: row.record_number, product: d.product_name, lot: d.lot_number, via }, null, null, d.product_name);

  // ONE TASTING, TWO RECORDS — WHICHEVER DOOR THE DECISION CAME THROUGH.
  //
  // The in-app decision has filed the paired Organoleptic record since it was
  // built, and this path — the magic link, which is the way the plant actually
  // decides a flavour — wrote its own UPDATE and called nothing. So a flavour
  // approved by text left the Organoleptic log empty, and a denied one raised
  // no draft disposal: exactly the two-doors-disagreeing gap that left QA's
  // inspection records unfiled for three months.
  try {
    const cfg = getType('flavor_approval');
    const fresh = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(row.id);
    const rec = { ...fresh, ...parseJson(fresh.data, {}) };
    if (cfg) syncFlavorOrganoleptic(db, cfg, rec, { name: d.decided_by });
  } catch (e) { console.error('[flavor→organoleptic]', e.message); }
  // Announce in #batching so the floor knows immediately.
  //
  // POSTED BY READYBOT, NOT BY A PERSON. It used to be authored by whichever
  // account matched `name LIKE 'Danny%'`, so every decision appeared in the
  // channel as "Danny Augustyn: Flavor approved" — under his name and his
  // avatar — no matter who actually tasted the batch and tapped the link. The
  // decision names its approver in the text, where it belongs; the messenger is
  // the system.
  try {
    const channel = getChannelByName(db, 'batching') || getChannelByName(db, 'general');
    const author = getBotUser(db);
    if (channel && author) {
      const emoji = decision === 'approved' ? '✅' : '❌';
      // Bot bold is *text*, never **text** — the chat renderer is not markdown.
      const facts = [
        d.lot_number && `Lot ${d.lot_number}`,
        d.mo_number && `MO ${d.mo_number}`,
        d.work_order && !d.mo_number && `WO ${d.work_order}`,
        row.record_number,
      ].filter(Boolean).join(' · ');
      const lines = [
        `${emoji} *Flavor ${decision}* — ${d.product_name || row.record_number}`,
        facts,
        `Decided by ${d.decided_by} by text${d.decision_date ? ` on ${d.decision_date}` : ''}`,
      ];
      if (d.comments) lines.push(`"${d.comments}"`);
      // A denial is not just news — it leaves product needing a disposition,
      // and the draft disposal the sync raises is where that happens.
      if (decision === 'denied') lines.push('This batch needs a disposition — a draft disposal has been raised.');
      lines.push(`${readyDocOrigin()}/?tab=flavor-approvals`);
      await postMessageAs(db, channel, author, lines.filter(Boolean).join('\n'));
    }
  } catch { /* best-effort */ }
  return { ok: true, decision, record_number: row.record_number, product: d.product_name };
}

router.post('/flavor-approval/:token', async (req, res) => {
  const db = getDb();
  const row = flavorByToken(db, req.params.token);
  if (!row) return res.status(404).json({ error: 'This approval link is invalid or already used.' });
  const decision = req.body?.decision === 'denied' ? 'denied' : req.body?.decision === 'approved' ? 'approved' : null;
  if (!decision) return res.status(400).json({ error: 'Decision must be approved or denied.' });
  const out = await applyFlavorDecision(db, row, {
    decision, name: req.body?.name, comments: req.body?.comments, via: 'sms-link',
  });
  if (out.error) return res.status(out.status || 400).json({ error: out.error });
  res.json(out);
});

/**
 * "Approve FA-12" texted back to the number that sent the link. The link
 * stays for anyone who prefers it; the reply keeps Danny in the one place he
 * works. Guarded three ways: the record must still be pending, the reply must
 * come FROM the number the link was TEXTED TO, and the decider's name is
 * resolved from that number — an approval still says who made it.
 */
export async function applyFlavorReplyText(db, fromDigits, text, senderName) {
  const m = String(text || '').trim().match(/^\s*(approve|approved|deny|denied|decline|declined)\s*[-–—:,]?\s*(FA[- ]?\d+)\s*$/i);
  if (!m) return null; // not a flavour decision — let the AI path have it
  const decision = /^app/i.test(m[1]) ? 'approved' : 'denied';
  const recordNumber = m[2].toUpperCase().replace(/[- ]/g, '').replace(/^FA/, 'FA-');
  const row = db.prepare("SELECT * FROM qms_records WHERE record_type = 'flavor_approval' AND status = 'pending' AND UPPER(REPLACE(record_number,'-','')) = ?")
    .get(recordNumber.replace(/-/g, ''));
  if (!row) return { reply: `I couldn't find a pending flavor approval ${recordNumber} — it may already be decided.` };
  const d = parseJson(row.data, {});
  const sentTo = String(d.last_texted_to || '').replace(/\D/g, '').slice(-10);
  if (!sentTo || sentTo !== fromDigits) {
    // The decision is a decision about product; a number the link was never
    // sent to does not get to make it by guessing a record number.
    return { reply: `That approval wasn't sent to this number, so I can't take the decision from here. Use the link, or ask for it to be re-sent.` };
  }
  if (!senderName) {
    return { reply: `I need to know who is deciding — this number isn't on the roster. Use the link instead, and type your name there.` };
  }
  const out = await applyFlavorDecision(db, row, { decision, name: senderName, via: 'sms-reply' });
  if (out.error) return { reply: `Couldn't record that: ${out.error}` };
  return { reply: `Got it — ${out.product || out.record_number} ${decision}. It's on the record as ${senderName}.` };
}

// ── Component Sign In/Out kiosk ───────────────────────────────────────────────
// Suggestion lists (item names / part numbers seen before) for quick entry.
router.get('/component-options', requireKioskToken('components'), (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT data FROM qms_records WHERE record_type = 'component_sign_out'").all();
  const items = new Set(), parts = new Set(), mos = new Set();
  for (const r of rows) {
    const d = parseJson(r.data, {});
    if (d.item_name) items.add(d.item_name);
    if (d.part_number) parts.add(d.part_number);
    if (d.mo_number) mos.add(d.mo_number);
  }
  // MO suggestions come from this log's own history, not the production
  // schedule — the kiosk is a public path and shouldn't widen what it exposes.
  res.json({
    item_names: [...items].sort(),
    part_numbers: [...parts].sort(),
    mo_numbers: [...mos].sort().reverse(),
  });
});

// Log a component sign-out (or sign-in) as a new record awaiting in-app WH/QA
// approval. `person` is the typed name at the kiosk.
router.post('/component-signout', requireKioskToken('components'), (req, res) => {
  const db = getDb();
  const cfg = getType('component_sign_out');
  const { direction, item_name, part_number, lot_number, mo_number, qty_pulled, person } = req.body;
  const name = (person || '').trim();
  if (!name || !item_name || !String(item_name).trim()) {
    return res.status(400).json({ error: 'Item name and your name are required.' });
  }

  const id = uuid();
  const number = nextNumber(db, cfg);
  const data = {
    direction: direction === 'In' ? 'In' : 'Out',
    item_name: String(item_name).trim(),
    part_number: part_number || '',
    lot_number: lot_number || '',
    mo_number: String(mo_number || '').trim(),
    qty_pulled: qty_pulled || '',
    signed_by: name,
  };

  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
    VALUES (?, 'component_sign_out', ?, ?, NULL, ?, 0, ?)`).run(id, number, today(), JSON.stringify(data), name);

  logAudit(name, 'submit_public', 'component_sign_out', id,
    { record_number: number, direction: data.direction, item_name: data.item_name, mo_number: data.mo_number, via: 'kiosk' }, null, null, data.item_name);

  res.status(201).json({ ok: true, record_number: number, direction: data.direction });
});

// ── Equipment/Tool/Chemical Sign In-Out kiosk ────────────────────────────────
// The editable item list (same one managed in the app) plus the approved
// chemical registry, grouped for the kiosk dropdown. `chemicals` tells the
// kiosk which items need a use specification.
router.get('/maintenance-items', requireKioskToken('maintenance'), (_req, res) => {
  const db = getDb();
  let rows = [];
  try { rows = db.prepare('SELECT name, category FROM maintenance_items ORDER BY sort_order, name').all(); } catch { /* table optional */ }
  // One definition of "chemical" — the approved registry PLUS anything filed
  // under the Chemicals category in the editable item list.
  const chemicals = activeChemicalNames(db);
  const have = new Set(rows.map(r => r.name));
  const merged = [...rows, ...chemicals.filter(n => !have.has(n)).map(name => ({ name, category: 'Chemicals' }))];
  const groups = [];
  const byCat = new Map();
  for (const r of merged) {
    const cat = r.category || 'Other';
    if (!byCat.has(cat)) { const g = { group: cat, items: [] }; byCat.set(cat, g); groups.push(g); }
    byCat.get(cat).items.push(r.name);
  }
  res.json({ items: merged.map(r => r.name), groups, chemicals, use_specs: CHEMICAL_USE_SPECS });
});

// Sign items out from the floor kiosk — creates a record (status Out) per item,
// awaiting the in-app QA return/review. `employee_name` is the typed name.
// items[] entries are strings or { name, qty, use_spec }; a chemical from the
// approved registry must carry a use_spec. tool_box applies to the whole batch.
router.post('/maintenance-signout', requireKioskToken('maintenance'), (req, res) => {
  const db = getDb();
  const cfg = getType('maintenance_sign_out');
  const { employee_name, item_description, items, asset_tag, condition_out, time_out, tool_box, use_spec, qty } = req.body;
  const name = (employee_name || '').trim();
  const list = (Array.isArray(items) && items.length ? items : [{ name: item_description, qty, use_spec }])
    .map(i => typeof i === 'string' ? { name: i.trim() } : { name: (i?.name || '').trim(), qty: i?.qty, use_spec: i?.use_spec })
    .filter(i => i.name);
  if (!name || !list.length) return res.status(400).json({ error: 'Item and your name are required.' });
  if (list.length > 25) return res.status(400).json({ error: 'Too many items in one sign-out.' });

  const chemicals = new Set(activeChemicalNames(db));
  for (const i of list) {
    if (chemicals.has(i.name)) {
      if (!CHEMICAL_USE_SPECS.includes(i.use_spec)) {
        return res.status(400).json({ error: `"${i.name}" is a chemical — pick its use specification (${CHEMICAL_USE_SPECS.join(', ')}).` });
      }
    } else {
      i.use_spec = undefined; // use spec only applies to chemicals
    }
    const q = Number(i.qty);
    i.qty = Number.isFinite(q) && q > 0 ? q : 1;
  }

  const created = [];
  const insert = db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
    VALUES (?, 'maintenance_sign_out', ?, ?, 'out', ?, 0, ?)`);
  db.transaction(() => {
    for (const item of list) {
      const id = uuid();
      const number = nextNumber(db, cfg);
      const data = {
        employee_name: name,
        item_description: item.name,
        qty: item.qty,
        tool_box: (tool_box || '').trim(),
        ...(item.use_spec ? { use_spec: item.use_spec } : {}),
        asset_tag: (list.length === 1 && asset_tag) || '',
        condition_out: condition_out === 'Bad' ? 'Bad' : 'Good',
        time_out: time_out || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      insert.run(id, number, today(), JSON.stringify(data), name);
      logAudit(name, 'submit_public', 'maintenance_sign_out', id,
        { record_number: number, item_description: item.name, qty: item.qty, tool_box: data.tool_box, use_spec: item.use_spec, via: 'kiosk' }, null, null, item.name);
      created.push({ record_number: number, item_description: item.name, qty: item.qty });
    }
  })();

  res.status(201).json({ ok: true, created, record_number: created[0].record_number, item_description: created[0].item_description });
});




// ── Scale Calibration Verification (Forms 417-01 … 417-05) ──────────────────
// The daily three-point scale check, run from the floor before production
// starts. Public like the other kiosk forms: a supervisor scans the QR at the
// scale and fills it in on their phone. Grading happens server-side, so a
// reading outside tolerance can never be filed as a pass.

router.get('/scale-forms', requireKioskToken('scale'), (_req, res) => {
  const db = getDb();
  let rooms;
  try {
    rooms = db.prepare(`SELECT DISTINCT room FROM calibration_instruments
      WHERE room IS NOT NULL AND room != '' ORDER BY room`).all().map(r => r.room);
  } catch { rooms = []; }
  // The kiosk is a public path, so the procedure travels with the forms — the
  // person on the floor needs the directions beside the boxes.
  res.json({ forms: SCALE_FORMS.map(f => ({ ...f, procedure: procedureFor(f) })), rooms, procedure: SCALE_PROCEDURE });
});

router.post('/scale-verification', requireKioskToken('scale'), (req, res) => {
  const db = getDb();
  const { error, record } = recordScaleVerification(db, req.body, {
    actor: (req.body?.performed_by || '').trim() || 'kiosk',
    source: 'kiosk',
  });
  if (error) return res.status(400).json({ error });
  res.status(201).json({ ok: true, record });
});

export default router;
