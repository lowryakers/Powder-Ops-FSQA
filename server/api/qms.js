import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { nextDisposalNumber } from './disposals.js';
import { QMS_TYPES, getType, canSignApproval } from '../qms-config.js';

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
// dropdown always tracks the registry.
export function activeChemicalNames(db) {
  try { return db.prepare('SELECT name FROM approved_chemicals ORDER BY name').all().map(r => r.name); }
  catch { return []; }
}
function withChemicals(db, rows) {
  const have = new Set(rows.map(r => r.name));
  const chems = activeChemicalNames(db).filter(n => !have.has(n));
  return [...rows, ...chems.map(name => ({ name, category: 'Chemicals' }))];
}

router.get('/maintenance-items', (req, res) => {
  res.json({ items: maintenanceItems(getDb()) });
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
  res.json(rows.map(flatten));
});

router.get('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(flatten(row));
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
  res.status(201).json(created);
});

// ── update ───────────────────────────────────────────────────────────────────
router.put('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!existing) return res.status(404).json({ error: 'Not found' });
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
  const updated = flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id));
  try { syncOrganolepticDisposal(db, cfg, updated, req.user); } catch (e) { console.error('[organoleptic→disposal]', e.message); }
  res.json(updated);
});

// ── bulk ─────────────────────────────────────────────────────────────────────
router.post('/:type/bulk-delete', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  if (req.user.role !== 'admin') return res.status(403).json({ error: `Only an admin can permanently delete ${cfg.label}.` });
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const ph = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id, record_number FROM qms_records WHERE record_type = ? AND id IN (${ph})`).all(cfg.key, ...ids);
  db.prepare(`DELETE FROM qms_records WHERE record_type = ? AND id IN (${ph})`).run(cfg.key, ...ids);
  for (const r of found) logAudit(req.user, 'qms_deleted', cfg.key, r.id, { record_number: r.record_number }, r, null);
  res.json({ deleted: found.length });
});

router.post('/:type/bulk-update', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch object is required' });
  const ph = ids.map(() => '?').join(',');
  const sets = [], vals = [];
  if (patch.paper_record !== undefined) { sets.push('paper_record=?'); vals.push(patch.paper_record ? 1 : 0); }
  if (patch.status !== undefined) { sets.push('status=?'); vals.push(patch.status || null); }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields in patch' });
  const info = db.prepare(`UPDATE qms_records SET ${sets.join(', ')}, updated_at=datetime('now') WHERE record_type = ? AND id IN (${ph})`).run(...vals, cfg.key, ...ids);
  logAudit(req.user, 'qms_bulk_updated', cfg.key, null, { count: info.changes, patch });
  res.json({ updated: info.changes });
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
  res.json(flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id)));
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
  res.json(flatten(db.prepare('SELECT * FROM qms_records WHERE id = ?').get(req.params.id)));
});

// ── delete (single) ──────────────────────────────────────────────────────────
router.delete('/:type/:id', (req, res) => {
  const cfg = requireType(req, res); if (!cfg) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM qms_records WHERE id = ? AND record_type = ?').get(req.params.id, cfg.key);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM qms_records WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'qms_deleted', cfg.key, req.params.id, { record_number: existing.record_number }, existing, null);
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
