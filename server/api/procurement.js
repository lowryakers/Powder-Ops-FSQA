import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

// Procurement & demand planning for the office (Jake).
//
// Three things live here:
//   • Demand planning — set a quantity against a finished good and the BOM
//     explosion says what parts that needs, rolled down through intermediates
//     and blends, with the 5% cushion his sheet always added.
//   • Purchase orders — what's actually on order, with the KPIs he watches.
//   • Reference data — parts/pricing and sample tracking from his workbooks.
//
// Scenarios replace "make a copy of the sheet to edit": demand rows and POs
// carry a scenario_id (NULL = live). Work inside a scenario, then revert
// (delete it) or apply it over the live plan.

const router = Router();
const MODULE_ID = 'procurement';

function may(user, level = 'view') {
  if (user?.role === 'admin') return true;
  const ma = user?.module_access;
  if (!ma) return false;
  if (Array.isArray(ma)) return level === 'view' && ma.includes(MODULE_ID);
  const lvl = ma[MODULE_ID];
  return level === 'edit' ? lvl === 'edit' : lvl === 'edit' || lvl === 'view';
}
function requireAccess(req, res, level) {
  if (!may(req.user, level)) { res.status(403).json({ error: 'You do not have access to Procurement.' }); return false; }
  return true;
}

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
// Scenario id from the query string; '' / 'live' both mean the live plan.
const scenarioOf = (req) => {
  const s = req.query.scenario || req.body?.scenario_id;
  return s && s !== 'live' ? String(s) : null;
};
const quarterOf = (date) => {
  const d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
};

// ── Scenarios ────────────────────────────────────────────────────────────────

router.get('/scenarios', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  res.json(getDb().prepare('SELECT * FROM procurement_scenarios ORDER BY created_at DESC').all());
});

// Creating a scenario snapshots the live demand plan and open POs into it, so
// it opens as an exact copy of what he was just looking at.
router.post('/scenarios', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const name = String(req.body?.name || '').trim() || `Working copy ${new Date().toISOString().slice(0, 10)}`;
  const id = uuid();

  db.transaction(() => {
    db.prepare('INSERT INTO procurement_scenarios (id, name, note, created_by) VALUES (?, ?, ?, ?)')
      .run(id, name, req.body?.note || null, req.user.name);
    db.prepare(`INSERT INTO procurement_demand (id, scenario_id, product_number, product_name, requested_qty, quarter, notes)
      SELECT lower(hex(randomblob(16))), ?, product_number, product_name, requested_qty, quarter, notes
      FROM procurement_demand WHERE scenario_id IS NULL`).run(id);
    db.prepare(`INSERT INTO purchase_orders (id, scenario_id, po_number, vendor, part_no, description, qty, uom,
      unit_price, order_date, expected_date, received_date, status, urgent, notes, created_by)
      SELECT lower(hex(randomblob(16))), ?, po_number, vendor, part_no, description, qty, uom,
        unit_price, order_date, expected_date, received_date, status, urgent, notes, created_by
      FROM purchase_orders WHERE scenario_id IS NULL`).run(id);
  })();

  logAudit(req.user, 'create', 'procurement_scenario', id, { name }, null, null, name);
  res.status(201).json(db.prepare('SELECT * FROM procurement_scenarios WHERE id = ?').get(id));
});

// Revert: throw the working copy away. Live is untouched by definition.
router.delete('/scenarios/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const sc = db.prepare('SELECT * FROM procurement_scenarios WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: 'Scenario not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM procurement_demand WHERE scenario_id = ?').run(sc.id);
    db.prepare('DELETE FROM purchase_orders WHERE scenario_id = ?').run(sc.id);
    db.prepare('DELETE FROM procurement_scenarios WHERE id = ?').run(sc.id);
  })();
  logAudit(req.user, 'delete', 'procurement_scenario', sc.id, { reverted: true }, sc, null, sc.name);
  res.json({ deleted: sc.id });
});

// Apply: the working copy becomes live, in one transaction.
router.post('/scenarios/:id/apply', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const sc = db.prepare('SELECT * FROM procurement_scenarios WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: 'Scenario not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM procurement_demand WHERE scenario_id IS NULL').run();
    db.prepare(`INSERT INTO procurement_demand (id, scenario_id, product_number, product_name, requested_qty, quarter, notes)
      SELECT lower(hex(randomblob(16))), NULL, product_number, product_name, requested_qty, quarter, notes
      FROM procurement_demand WHERE scenario_id = ?`).run(sc.id);
    db.prepare('DELETE FROM purchase_orders WHERE scenario_id IS NULL').run();
    db.prepare(`INSERT INTO purchase_orders (id, scenario_id, po_number, vendor, part_no, description, qty, uom,
      unit_price, order_date, expected_date, received_date, status, urgent, notes, created_by)
      SELECT lower(hex(randomblob(16))), NULL, po_number, vendor, part_no, description, qty, uom,
        unit_price, order_date, expected_date, received_date, status, urgent, notes, created_by
      FROM purchase_orders WHERE scenario_id = ?`).run(sc.id);
    db.prepare("UPDATE procurement_scenarios SET applied_at = datetime('now') WHERE id = ?").run(sc.id);
  })();

  logAudit(req.user, 'update', 'procurement_scenario', sc.id, { applied: true }, sc, null, sc.name);
  res.json({ applied: sc.id });
});

// ── Demand planning ──────────────────────────────────────────────────────────

router.get('/demand', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const db = getDb();
  const scenario = scenarioOf(req);
  const rows = scenario
    ? db.prepare('SELECT * FROM procurement_demand WHERE scenario_id = ? ORDER BY product_name').all(scenario)
    : db.prepare('SELECT * FROM procurement_demand WHERE scenario_id IS NULL ORDER BY product_name').all();
  res.json(rows);
});

router.put('/demand/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM procurement_demand WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found in the plan' });
  db.prepare(`UPDATE procurement_demand SET requested_qty = ?, quarter = ?, notes = ?,
    updated_at = datetime('now') WHERE id = ?`)
    .run(num(req.body?.requested_qty), req.body?.quarter ?? existing.quarter, req.body?.notes ?? existing.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM procurement_demand WHERE id = ?').get(req.params.id));
});

// The explosion. Start from the finished goods with a quantity against them,
// then walk down: every part that is itself a product (an intermediate, a
// blend) becomes the next level's requested quantity. Depth is capped because
// a bad BOM edit could otherwise cycle forever.
function explode(db, planRows) {
  const bomRows = db.prepare('SELECT product_number, product_name, part_no, part_description, uom, bom_qty, fill_weight FROM procurement_boms').all();
  const byProduct = new Map();
  for (const r of bomRows) {
    if (!byProduct.has(r.product_number)) byProduct.set(r.product_number, []);
    byProduct.get(r.product_number).push(r);
  }

  const totals = new Map();   // part_no -> { part_no, description, uom, qty }
  const add = (row, qty) => {
    const cur = totals.get(row.part_no) || { part_no: row.part_no, description: row.part_description, uom: row.uom, qty: 0 };
    cur.qty += qty;
    totals.set(row.part_no, cur);
  };

  let level = planRows
    .filter(p => Number(p.requested_qty) > 0)
    .map(p => ({ product: p.product_number, qty: Number(p.requested_qty) }));

  for (let depth = 0; depth < 12 && level.length; depth++) {
    const next = new Map();
    for (const { product, qty } of level) {
      for (const row of byProduct.get(product) || []) {
        const need = qty * (Number(row.bom_qty) || 0) * (Number(row.fill_weight) || 1);
        if (!need) continue;
        add(row, need);
        // A part with its own BOM is an intermediate — carry the demand down.
        if (byProduct.has(row.part_no)) next.set(row.part_no, (next.get(row.part_no) || 0) + need);
      }
    }
    level = [...next].map(([product, qty]) => ({ product, qty }));
  }

  return [...totals.values()]
    .map(t => ({ ...t, qty: Math.round(t.qty * 10000) / 10000, qty_with_cushion: Math.round(t.qty * 1.05 * 10000) / 10000 }))
    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
}

// Parts demand for the current plan, joined to pricing so the value of what
// needs buying is visible next to the quantity.
router.get('/demand/parts', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const db = getDb();
  const scenario = scenarioOf(req);
  const plan = scenario
    ? db.prepare('SELECT * FROM procurement_demand WHERE scenario_id = ?').all(scenario)
    : db.prepare('SELECT * FROM procurement_demand WHERE scenario_id IS NULL').all();

  const parts = explode(db, plan);
  const priceRows = db.prepare('SELECT part_no, vendor, price, current_price, moq, lead_time_days FROM procurement_parts').all();
  const priceBy = new Map();
  for (const p of priceRows) if (!priceBy.has(p.part_no)) priceBy.set(p.part_no, p);

  res.json(parts.map(p => {
    const pr = priceBy.get(p.part_no);
    const unit = pr ? (pr.current_price ?? pr.price) : null;
    return {
      ...p,
      vendor: pr?.vendor || null,
      unit_price: unit,
      moq: pr?.moq ?? null,
      lead_time_days: pr?.lead_time_days ?? null,
      extended_cost: unit != null ? Math.round(p.qty_with_cushion * unit * 100) / 100 : null,
    };
  }));
});

// ── Purchase orders ──────────────────────────────────────────────────────────

const PO_FIELDS = ['po_number', 'vendor', 'part_no', 'description', 'qty', 'uom', 'unit_price',
  'order_date', 'expected_date', 'received_date', 'status', 'urgent', 'notes'];
const PO_STATUSES = ['draft', 'open', 'confirmed', 'shipped', 'received', 'cancelled'];

router.get('/pos', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const db = getDb();
  const scenario = scenarioOf(req);
  const { status, quarter, q, vendor } = req.query;

  let sql = `SELECT * FROM purchase_orders WHERE scenario_id IS ${scenario ? '?' : 'NULL'}`;
  const params = scenario ? [scenario] : [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (vendor) { sql += ' AND vendor = ?'; params.push(vendor); }
  if (q) {
    sql += ` AND (LOWER(vendor) LIKE LOWER(?) OR LOWER(COALESCE(po_number,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(part_no,'')) LIKE LOWER(?) OR LOWER(COALESCE(description,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(notes,'')) LIKE LOWER(?))`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY COALESCE(expected_date, order_date, created_at) DESC LIMIT 2000';

  let rows = db.prepare(sql).all(...params);
  rows = rows.map(r => ({
    ...r,
    total: Math.round((Number(r.qty) || 0) * (Number(r.unit_price) || 0) * 100) / 100,
    quarter: quarterOf(r.expected_date || r.order_date),
    // Delayed = past its expected date and still not received.
    delayed: !!(r.expected_date && r.expected_date < new Date().toISOString().slice(0, 10)
      && !['received', 'cancelled'].includes(r.status)),
  }));
  if (quarter) rows = rows.filter(r => r.quarter === quarter);
  res.json(rows);
});

router.post('/pos', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const body = req.body || {};
  if (!body.vendor) return res.status(400).json({ error: 'vendor is required' });
  const id = uuid();
  const values = PO_FIELDS.map(f => {
    if (f === 'qty' || f === 'unit_price') return num(body[f]);
    if (f === 'urgent') return body.urgent ? 1 : 0;
    if (f === 'status') return PO_STATUSES.includes(body.status) ? body.status : 'open';
    return body[f] ?? null;
  });
  db.prepare(`INSERT INTO purchase_orders (id, scenario_id, ${PO_FIELDS.join(', ')}, created_by)
    VALUES (?, ?, ${PO_FIELDS.map(() => '?').join(', ')}, ?)`)
    .run(id, scenarioOf(req), ...values, req.user.name);
  const created = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'purchase_order', id, { vendor: created.vendor, qty: created.qty }, null, created, created.po_number || created.vendor);
  res.status(201).json(created);
});

router.put('/pos/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
  const body = req.body || {};
  const next = {};
  for (const f of PO_FIELDS) {
    if (body[f] === undefined) { next[f] = existing[f]; continue; }
    if (f === 'qty' || f === 'unit_price') next[f] = num(body[f]);
    else if (f === 'urgent') next[f] = body.urgent ? 1 : 0;
    else if (f === 'status') next[f] = PO_STATUSES.includes(body.status) ? body.status : existing.status;
    else next[f] = body[f] ?? null;
  }
  // Marking received without a date fills today's — the date is the point.
  if (next.status === 'received' && !next.received_date) next.received_date = new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE purchase_orders SET ${PO_FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...PO_FIELDS.map(f => next[f]), req.params.id);
  const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'purchase_order', req.params.id,
    updated.status !== existing.status ? { status: { from: existing.status, to: updated.status } } : null,
    existing, updated, updated.po_number || updated.vendor);
  res.json(updated);
});

router.delete('/pos/:id', (req, res) => {
  if (!requireAccess(req, res, 'edit')) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'purchase_order', req.params.id, null, existing, null, existing.po_number || existing.vendor);
  res.json({ deleted: req.params.id });
});

// KPI cards: open POs, anything urgent or running late, and the money already
// committed. Quarter-filterable off the expected (else order) date.
router.get('/summary', (req, res) => {
  if (!requireAccess(req, res, 'view')) return;
  const db = getDb();
  const scenario = scenarioOf(req);
  const rows = db.prepare(`SELECT * FROM purchase_orders WHERE scenario_id IS ${scenario ? '?' : 'NULL'}`)
    .all(...(scenario ? [scenario] : []));
  const today = new Date().toISOString().slice(0, 10);
  const quarter = req.query.quarter || null;

  const inScope = rows.filter(r => !quarter || quarterOf(r.expected_date || r.order_date) === quarter);
  const open = inScope.filter(r => !['received', 'cancelled'].includes(r.status));
  const delayed = open.filter(r => r.expected_date && r.expected_date < today);
  const urgent = open.filter(r => r.urgent);
  const scheduledSpend = open.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.unit_price) || 0), 0);

  // Quarters present in the data, so the filter offers only real options.
  const quarters = [...new Set(rows.map(r => quarterOf(r.expected_date || r.order_date)).filter(Boolean))].sort().reverse();

  res.json({
    open_count: open.length,
    urgent_delayed_count: new Set([...urgent, ...delayed].map(r => r.id)).size,
    scheduled_spend: Math.round(scheduledSpend * 100) / 100,
    delayed_count: delayed.length,
    urgent_count: urgent.length,
    quarters,
  });
});

// ── Reference data: parts / pricing and samples ──────────────────────────────

function listRoute(pathName, table, searchCols, orderBy) {
  router.get(pathName, (req, res) => {
    if (!requireAccess(req, res, 'view')) return;
    const db = getDb();
    const { q } = req.query;
    let sql = `SELECT * FROM ${table} WHERE 1=1`;
    const params = [];
    if (q) {
      sql += ` AND (${searchCols.map(c => `LOWER(COALESCE(${c},'')) LIKE LOWER(?)`).join(' OR ')})`;
      searchCols.forEach(() => params.push(`%${q}%`));
    }
    sql += ` ORDER BY ${orderBy} LIMIT 3000`;
    res.json(db.prepare(sql).all(...params));
  });
}

listRoute('/parts', 'procurement_parts', ['part_no', 'description', 'vendor', 'notes'], 'description');
listRoute('/samples', 'procurement_samples', ['item_name', 'vendor', 'status', 'notes', 'ordering_notes'], 'item_name');
listRoute('/boms', 'procurement_boms', ['bom_number', 'product_number', 'product_name', 'part_no', 'part_description'], 'product_name, part_description');

function updateRoute(pathName, table, fields) {
  router.put(pathName, (req, res) => {
    if (!requireAccess(req, res, 'edit')) return;
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const next = fields.map(f => (req.body?.[f] === undefined ? existing[f] : req.body[f]));
    db.prepare(`UPDATE ${table} SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...next, req.params.id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id));
  });
}

updateRoute('/parts/:id', 'procurement_parts',
  ['part_no', 'description', 'vendor', 'price', 'current_price', 'moq', 'lead_time_days', 'priority', 'notes']);
updateRoute('/samples/:id', 'procurement_samples',
  ['item_name', 'vendor', 'status', 'viable', 'qc_approved', 'quality_rank', 'demand_qty', 'price', 'moq', 'lead_time', 'notes', 'ordering_notes']);

export default router;
