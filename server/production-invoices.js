// The weekly payment run, part E (D-365): production invoices to ProDough.
//
// When an MO closes or a customer order ships in MRPEasy, ProDough is invoiced
// once for it: the per-unit price from our price list, matched to ProDough's
// PO, less the weekly Deposits ProDough has already paid (Chris, D-363: "adjust
// the final bill to the difference from what is owed and what was paid for the
// deposit"). The Controller creates the invoice in QBO and sends it; the amount
// still owed rides Danny's next run as "production" and is paid by his transfer.
//
// RULES, each load-bearing:
//   - READYDOC DOES NOT READ MRPEASY. A person records the closed MO or the
//     shipped order (MO number, ProDough's PO, the SKUs and quantities, and the
//     unit price printed on ProDough's PO). Nothing here is invented from the
//     production log.
//   - ONE INVOICE PER PO, EVER. The PO is folded (`normPo`) and a partial unique
//     index refuses a second live invoice on it; the refusal names the first.
//     Voiding is the only way the PO frees up, and it needs a reason.
//   - NO PO, NO PRICE, NO MATCH: NO INVOICE. The order is HELD with the reasons
//     and Lowry is told. A missing price-list price, a SKU not in the catalog, a
//     PO price that differs from the list price, a missing quantity — each is
//     named. "Check again" re-reads the price list after it is corrected.
//   - THE PRICE LIST FIELD IS CHOSEN BY AN ADMIN (`production_price_field`),
//     never guessed. Until it is chosen every order is held and says so.
//   - DEPOSITS COME OFF WHOLE, AND ONCE. The Controller ticks which paid Deposits
//     this invoice absorbs; each is stamped `applied_to` this invoice and can
//     never be applied again. More deposits than the invoice total is refused
//     (pick fewer); a void releases them.
//   - PEOPLE RECORD THESE, NOT TOKENS. Prices are never written here; the price
//     list is Products' (gated by D-342).
import { randomUUID } from 'crypto';
import { plantDateOf } from './plant-clock.js';
import { getSettings, notifyRecipients, normPo, money } from './payment-run.js';

export const SOURCES = Object.freeze({ mo_closed: 'MO closed', order_shipped: 'Customer order shipped' });
export const PRICE_FIELDS = Object.freeze({
  price_fob_unit: 'FOB unit price',
  price_wholesale_unit: 'Wholesale unit price',
});
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const parse = (s, d) => { try { return JSON.parse(s ?? 'null') ?? d; } catch { return d; } };
const num = (v) => (v === '' || v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN));

/** Clean the lines a person typed: { sku, qty, po_unit_price }. Blank rows dropped. */
export function cleanLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map(l => ({ sku: String(l?.sku || '').trim(), qty: num(l?.qty), po_unit_price: num(l?.po_unit_price) }))
    .filter(l => l.sku || l.qty !== null || l.po_unit_price !== null);
}

/** Price the lines against the list and ProDough's PO. Returns { lines, total, reasons }. Writes nothing. */
export function priceOrder(db, { prodough_po, lines }, field = getSettings(db).production_price_field) {
  const reasons = [];
  if (!normPo(prodough_po)) reasons.push('No ProDough PO number: there is nothing to match the invoice to.');
  if (!field || !PRICE_FIELDS[field]) reasons.push('No price list is chosen for ProDough invoices yet. An admin picks it in the payment run settings.');
  const clean = cleanLines(lines);
  if (!clean.length) reasons.push('No lines: name at least one SKU and quantity.');
  const find = db.prepare('SELECT * FROM products WHERE UPPER(TRIM(sku)) = ? OR UPPER(TRIM(legacy_sku)) = ? LIMIT 1');
  const out = clean.map((l) => {
    const p = l.sku ? find.get(l.sku.toUpperCase(), l.sku.toUpperCase()) : null;
    const line = { sku: p?.sku || l.sku, name: p ? [p.flavor, p.category, p.pack].filter(Boolean).join(' · ') : null, qty: l.qty, po_unit_price: l.po_unit_price, unit_price: null, amount: null };
    if (!l.sku) { reasons.push('A line has no SKU.'); return line; }
    if (!p) { reasons.push(`SKU ${l.sku} is not in the product catalog.`); return line; }
    if (!(l.qty > 0)) reasons.push(`${line.sku}: the quantity is missing or not a number above zero.`);
    const list = field && PRICE_FIELDS[field] ? p[field] : null;
    if (field && PRICE_FIELDS[field] && (list === null || list === undefined)) reasons.push(`${line.sku}: no ${PRICE_FIELDS[field].toLowerCase()} on the price list.`);
    if (l.po_unit_price === null) reasons.push(`${line.sku}: the unit price on ProDough's PO is not entered.`);
    else if (Number.isNaN(l.po_unit_price)) reasons.push(`${line.sku}: the PO price is not a number.`);
    else if (list !== null && list !== undefined && Math.abs(Number(list) - l.po_unit_price) >= 0.005) {
      reasons.push(`${line.sku}: ProDough's PO says ${money(l.po_unit_price)} each, the price list says ${money(list)}.`);
    }
    if (list !== null && list !== undefined) {
      line.unit_price = round(Number(list) * 10000) / 10000;
      if (l.qty > 0) line.amount = round(Number(list) * l.qty);
    }
    return line;
  });
  const total = reasons.length ? null : round(out.reduce((s, l) => s + (l.amount || 0), 0));
  return { lines: out, total, reasons: [...new Set(reasons)] };
}

const nextRef = (db) => {
  const n = db.prepare("SELECT COUNT(*) n FROM production_invoices").get().n;
  return `PI-${String(n + 1).padStart(4, '0')}`;
};

function liveForPo(db, key, exceptId = null) {
  if (!key) return null;
  return db.prepare("SELECT id, ref_no, status FROM production_invoices WHERE prodough_po_key = ? AND status <> 'void' AND id IS NOT ?").get(key, exceptId);
}

/** One invoice row with its derived bits. */
export function invoiceView(db, row) {
  if (!row) return null;
  const onRun = db.prepare(`SELECT r.id, r.run_no, r.status FROM payment_runs r, json_each(r.production_json) j
    WHERE r.status <> 'cancelled' AND json_extract(j.value, '$.id') = ? LIMIT 1`).get(row.id);
  const deposits = parse(row.deposit_ids, []).map(id => db.prepare('SELECT d.id, d.amount, d.qbo_invoice_no, r.run_no FROM prodough_deposits d JOIN payment_runs r ON r.id = d.run_id WHERE d.id = ?').get(id)).filter(Boolean);
  return {
    ...row, lines: parse(row.lines_json, []), hold_reasons: parse(row.hold_reasons, []), deposits, lines_json: undefined, deposit_ids: undefined,
    source_label: SOURCES[row.source], price_label: PRICE_FIELDS[row.price_field] || null,
    on_run: onRun || null,
    can_void: !['paid', 'void'].includes(row.status) && !onRun,
  };
}
const byId = (db, id) => {
  const row = db.prepare('SELECT * FROM production_invoices WHERE id = ?').get(id);
  if (!row) throw fail(404, 'That production invoice is not on file.');
  return row;
};

/** Record a closed MO or shipped order. Held (with reasons) or ready to invoice. */
export function recordOrder(db, body, user) {
  const source = String(body?.source || '');
  if (!SOURCES[source]) throw fail(400, `Say what happened: ${Object.values(SOURCES).join(' or ')}.`);
  const mo = String(body?.mo_number || '').trim() || null;
  const ref = String(body?.order_ref || '').trim() || null;
  if (source === 'mo_closed' && !mo) throw fail(400, 'Give the MO number.');
  if (source === 'order_shipped' && !ref && !mo) throw fail(400, 'Give the customer order number (or the MO).');
  const date = isoDate(body?.event_date) || plantDateOf();
  if (date > plantDateOf()) throw fail(400, 'The date cannot be in the future.');
  const po = String(body?.prodough_po || '').trim() || null;
  const key = normPo(po);
  const dup = liveForPo(db, key);
  if (dup) throw fail(409, `ProDough PO ${po} is already on ${dup.ref_no} (${dup.status.replace('_', ' ')}). One invoice per PO; void that one first if it is wrong.`, { code: 'PO_ALREADY_INVOICED', existing: dup.ref_no });
  const field = getSettings(db).production_price_field || null;
  const priced = priceOrder(db, { prodough_po: po, lines: body?.lines }, field);
  const id = randomUUID();
  db.prepare(`INSERT INTO production_invoices (id, ref_no, source, mo_number, order_ref, prodough_po, prodough_po_key, event_date, lines_json, price_field, total,
      amount_due, status, hold_reasons, recorded_by, recorded_by_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, nextRef(db), source, mo, ref, po, key, date, JSON.stringify(priced.lines), field, priced.total, priced.total,
      priced.reasons.length ? 'held' : 'to_invoice', priced.reasons.length ? JSON.stringify(priced.reasons) : null, user.name, user.id || null,
      String(body?.notes || '').trim().slice(0, 500) || null);
  return invoiceView(db, byId(db, id));
}

/** A held order, corrected (PO, lines) and/or priced again after the price list moved. */
export function recheckOrder(db, id, body, _user) {
  const row = byId(db, id);
  if (row.status !== 'held') throw fail(409, 'Only a held order is checked again.');
  const po = 'prodough_po' in (body || {}) ? (String(body.prodough_po || '').trim() || null) : row.prodough_po;
  const key = normPo(po);
  const dup = liveForPo(db, key, row.id);
  if (dup) throw fail(409, `ProDough PO ${po} is already on ${dup.ref_no}. One invoice per PO.`, { code: 'PO_ALREADY_INVOICED', existing: dup.ref_no });
  const typed = Array.isArray(body?.lines) ? body.lines : parse(row.lines_json, []);
  const field = getSettings(db).production_price_field || null;
  const priced = priceOrder(db, { prodough_po: po, lines: typed }, field);
  db.prepare(`UPDATE production_invoices SET prodough_po = ?, prodough_po_key = ?, lines_json = ?, price_field = ?, total = ?, amount_due = ?, status = ?, hold_reasons = ? WHERE id = ?`)
    .run(po, key, JSON.stringify(priced.lines), field, priced.total, priced.total, priced.reasons.length ? 'held' : 'to_invoice',
      priced.reasons.length ? JSON.stringify(priced.reasons) : null, row.id);
  return invoiceView(db, byId(db, row.id));
}

/** Paid Deposits not yet taken off a production invoice. */
export function openDeposits(db) {
  return db.prepare(`SELECT d.id, d.amount, d.qbo_invoice_no, d.paid_at, r.run_no FROM prodough_deposits d JOIN payment_runs r ON r.id = d.run_id
    WHERE d.paid_at IS NOT NULL AND d.applied_to IS NULL ORDER BY d.paid_at`).all();
}

/** The Controller created it in QBO (with the deposits taken off) and sent it to ProDough. */
export function markInvoiced(db, id, body, user) {
  const row = byId(db, id);
  if (row.status !== 'to_invoice') throw fail(409, row.status === 'held' ? 'This order is held; fix what it names first.' : 'This invoice is already recorded.');
  const no = String(body?.qbo_invoice_no || '').trim();
  if (!no) throw fail(400, 'Give the QBO invoice number.');
  const ids = [...new Set((Array.isArray(body?.deposit_ids) ? body.deposit_ids : []).map(String))];
  const open = new Map(openDeposits(db).map(d => [d.id, d]));
  const missing = ids.filter(d => !open.has(d));
  if (missing.length) throw fail(409, 'A deposit picked is not paid yet or is already taken off another invoice.', { code: 'DEPOSIT_NOT_OPEN' });
  const applied = round(ids.reduce((s, d) => s + open.get(d).amount, 0));
  if (applied - row.total > 0.005) throw fail(400, `The deposits picked (${money(applied)}) are more than this invoice (${money(row.total)}). Pick fewer.`, { code: 'DEPOSITS_EXCEED_TOTAL' });
  const due = round(row.total - applied);
  db.transaction(() => {
    const stamp = db.prepare("UPDATE prodough_deposits SET applied_to = ?, applied_at = datetime('now') WHERE id = ? AND applied_to IS NULL");
    for (const d of ids) if (stamp.run(row.id, d).changes !== 1) throw fail(409, 'A deposit was taken off another invoice a moment ago. Look again.', { code: 'DEPOSIT_NOT_OPEN' });
    db.prepare(`UPDATE production_invoices SET qbo_invoice_no = ?, invoiced_by = ?, invoiced_at = datetime('now'), deposit_ids = ?, deposits_applied = ?, amount_due = ?,
        status = ?, paid_from = ?, paid_by = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') END WHERE id = ?`)
      .run(no.slice(0, 80), user.name, JSON.stringify(ids), applied, due, due > 0 ? 'invoiced' : 'paid', due > 0 ? null : 'deposits',
        due > 0 ? null : user.name, due > 0 ? 'invoiced' : 'paid', row.id);
  })();
  return invoiceView(db, byId(db, row.id));
}

/** Void: a wrong invoice frees its PO and its deposits. Never one that is paid or on a live run. */
export function voidInvoice(db, id, body, user) {
  const row = byId(db, id);
  const v = invoiceView(db, row);
  if (row.status === 'void') throw fail(409, 'Already void.');
  if (row.status === 'paid') throw fail(409, 'A paid invoice is not voided here; correct it in QBO and tell Lowry.');
  if (v.on_run) throw fail(409, `This invoice is on payment run ${v.on_run.run_no}. Cancel that run first, or let it be paid.`);
  const why = String(body?.reason || '').trim();
  if (why.length < 5) throw fail(400, 'Say why it is void; it stays on file with the reason.');
  db.transaction(() => {
    db.prepare("UPDATE prodough_deposits SET applied_to = NULL, applied_at = NULL WHERE applied_to = ?").run(row.id);
    db.prepare("UPDATE production_invoices SET status = 'void', void_reason = ?, void_by = ?, void_at = datetime('now') WHERE id = ?").run(why.slice(0, 500), user.name, row.id);
  })();
  return invoiceView(db, byId(db, row.id));
}

/** What rides Danny's next run: invoiced, something still owed, not on a live run. */
export function openProductionInvoices(db) {
  return db.prepare(`SELECT i.* FROM production_invoices i WHERE i.status = 'invoiced' AND i.amount_due > 0
      AND NOT EXISTS (SELECT 1 FROM payment_runs r, json_each(r.production_json) j WHERE r.status <> 'cancelled' AND json_extract(j.value, '$.id') = i.id)
    ORDER BY i.invoiced_at`).all()
    .map(i => ({ id: i.id, ref_no: i.ref_no, prodough_po: i.prodough_po, qbo_invoice_no: i.qbo_invoice_no, mo_number: i.mo_number,
      total: i.total, deposits_applied: i.deposits_applied, amount: i.amount_due }));
}

/** Mark the run's production invoices paid (by the transfer, or by hand). Returns how many moved. */
export function payRunProduction(db, run, { from, by, only = null }) {
  const items = parse(run.production_json, []).filter(p => !only || p.id === only);
  const up = db.prepare("UPDATE production_invoices SET status = 'paid', paid_run_id = ?, paid_from = ?, paid_by = ?, paid_at = datetime('now') WHERE id = ? AND status = 'invoiced'");
  return items.reduce((n, p) => n + up.run(run.id, from, by, p.id).changes, 0);
}

/** The run's production invoices with their current state, for the close-out. */
export function runProduction(db, run) {
  return parse(run.production_json, []).map(p => {
    const row = db.prepare('SELECT status, paid_at, paid_by, paid_from FROM production_invoices WHERE id = ?').get(p.id) || {};
    return { ...p, status: row.status || 'missing', paid: row.status === 'paid', paid_at: row.paid_at || null, paid_by: row.paid_by || null, paid_from: row.paid_from || null };
  });
}

export function listInvoices(db) {
  const rows = db.prepare("SELECT * FROM production_invoices ORDER BY CASE status WHEN 'held' THEN 0 WHEN 'to_invoice' THEN 1 WHEN 'invoiced' THEN 2 WHEN 'paid' THEN 3 ELSE 4 END, created_at DESC LIMIT 300").all();
  const invoices = rows.map(r => invoiceView(db, r));
  const count = (s) => invoices.filter(i => i.status === s).length;
  return {
    invoices, counts: { held: count('held'), to_invoice: count('to_invoice'), invoiced: count('invoiced'), paid: count('paid'), void: count('void') },
    open_deposits: openDeposits(db), price_field: getSettings(db).production_price_field || null, price_fields: PRICE_FIELDS, sources: SOURCES,
  };
}

/** Lowry hears about a held order; the Controller about one ready to create in QBO. */
export async function announceOrder(db, deps, view) {
  if (!view) return 0;
  const what = `${view.source_label}: ${view.mo_number ? `MO ${view.mo_number}` : view.order_ref}${view.prodough_po ? `, ProDough PO ${view.prodough_po}` : ''}`;
  let users, body;
  if (view.status === 'held') {
    users = notifyRecipients(db);
    body = `*Not invoiced to ProDough: ${view.ref_no}*\n${what}\n${view.hold_reasons.map(r => `• ${r}`).join('\n')}\nOpen: /?tab=payment-run&view=production`;
  } else if (view.status === 'to_invoice') {
    const c = getSettings(db).controller_id;
    users = c ? db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').all(c) : [];
    if (!users.length) users = notifyRecipients(db);
    body = `*Production invoice ${view.ref_no} to create in QBO*\n${what}\nTotal ${money(view.total)}. Take off any paid Deposits, create it in QBO, send it to ProDough, then record the QBO number.\nOpen: /?tab=payment-run&view=production`;
  } else return 0;
  let sent = 0;
  for (const u of users) {
    try {
      const { bot, dm } = deps.botDm(db, u.id);
      await deps.postMessageAs(db, dm, bot, body);
      deps.pushToUser?.(u.id, { title: view.status === 'held' ? 'Production order held' : 'Production invoice to create', body: what.slice(0, 120), tag: 'production-invoice', url: '/?tab=payment-run' })?.catch?.(() => {});
      sent++;
    } catch (e) { console.warn('[production-invoices] message failed:', e.message); }
  }
  return sent;
}

/** The weekly digest's lines: held orders and invoices not yet created. */
export function pendingLines(db) {
  const rows = db.prepare("SELECT ref_no, status, mo_number, order_ref FROM production_invoices WHERE status IN ('held','to_invoice') ORDER BY created_at").all();
  return rows.map(r => `${r.ref_no} (${r.mo_number ? `MO ${r.mo_number}` : r.order_ref}): ${r.status === 'held' ? 'held, not invoiced' : 'to create in QBO'}`);
}
