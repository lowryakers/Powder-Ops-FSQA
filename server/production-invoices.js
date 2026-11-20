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
//   - THE INVOICE IS THE FULL ALL-IN PRICE of the finished product (materials
//     included), never labour or machine time only (the accountant, D-366).
//   - DEPOSITS ARE ONE RUNNING BALANCE (D-366, superseding part E's pick-which):
//     the paid Deposits less everything already taken off. When the QBO invoice
//     number is recorded the balance is taken off automatically, OLDEST DEPOSIT
//     FIRST, in part if need be, up to the invoice total. Only PAID Deposits
//     count; an invoiced-unpaid one is shown beside the balance. A void releases
//     what its invoice took (the rows stay, stamped released).
//   - A PERSON OR THE CONTROLLER BOT RECORDS THESE (D-366: the bot reads MRPEasy
//     and holds the payment-run-controller grant). A void is Lowry's or an
//     admin's, never a bot's. Prices are never written here; the price list is
//     Products' (gated by D-342).
import { randomUUID } from 'crypto';
import { plantDateOf } from './plant-clock.js';
import { getSettings, notifyRecipients, normPo, money } from './payment-run.js';

export const SOURCES = Object.freeze({ mo_closed: 'MO closed', order_shipped: 'Customer order shipped' });
export const PRICE_FIELDS = Object.freeze({
  price_prodough_allin: 'All-in price to ProDough (per unit)',
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
  const deposits = db.prepare(`SELECT a.deposit_id AS id, a.amount AS applied, a.released_at, d.amount, d.qbo_invoice_no, r.run_no
    FROM prodough_deposit_applications a JOIN prodough_deposits d ON d.id = a.deposit_id JOIN payment_runs r ON r.id = d.run_id
    WHERE a.invoice_id = ? ORDER BY d.paid_at, a.applied_at`).all(row.id);
  const preview = row.status === 'to_invoice' && row.total != null ? previewDeposits(db, row.total) : null;
  return {
    ...row, lines: parse(row.lines_json, []), hold_reasons: parse(row.hold_reasons, []), deposits, lines_json: undefined, deposit_ids: undefined,
    source_label: SOURCES[row.source], price_label: PRICE_FIELDS[row.price_field] || null,
    on_run: onRun || null,
    // What recording the QBO number would take off right now: create the QBO invoice for amount_due.
    deposit_preview: preview,
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

/**
 * The ProDough deposit balance: every PAID Deposit, oldest first, with what is
 * left on it after the applications not released. Unpaid Deposits (invoiced in
 * QBO, not paid yet) are listed apart and never counted.
 */
export function depositBalance(db) {
  const paid = db.prepare(`SELECT d.id, d.amount, COALESCE(d.paid_amount, d.amount) AS paid, d.qbo_invoice_no, d.paid_at, r.run_no,
      COALESCE((SELECT SUM(a.amount) FROM prodough_deposit_applications a WHERE a.deposit_id = d.id AND a.released_at IS NULL), 0) AS used
    FROM prodough_deposits d JOIN payment_runs r ON r.id = d.run_id
    WHERE d.paid_at IS NOT NULL ORDER BY d.paid_at, d.created_at`).all()
    .map(d => ({ ...d, remaining: round(d.paid - d.used) }));
  const open = paid.filter(d => d.remaining > 0.004);
  const unpaid = db.prepare(`SELECT d.id, d.amount, d.qbo_invoice_no, r.run_no FROM prodough_deposits d JOIN payment_runs r ON r.id = d.run_id
    WHERE d.paid_at IS NULL AND d.qbo_invoice_no IS NOT NULL ORDER BY d.created_at`).all();
  return {
    balance: round(open.reduce((s, d) => s + d.remaining, 0)),
    deposits: open, oldest: open[0]?.paid_at || null,
    unpaid, unpaid_total: round(unpaid.reduce((s, d) => s + d.amount, 0)),
  };
}

/** Paid Deposits with something left on them, oldest first (the close-out and part D read this). */
export function openDeposits(db) { return depositBalance(db).deposits; }

/** What the balance would take off an invoice of `total` now: oldest first, in part if need be. Writes nothing. */
export function previewDeposits(db, total) {
  let left = round(total);
  const take = [];
  for (const d of depositBalance(db).deposits) {
    if (left <= 0.004) break;
    const amt = round(Math.min(d.remaining, left));
    take.push({ deposit_id: d.id, run_no: d.run_no, qbo_invoice_no: d.qbo_invoice_no, amount: amt });
    left = round(left - amt);
  }
  const applied = round(take.reduce((s, t) => s + t.amount, 0));
  return { take, applied, amount_due: round(total - applied) };
}

/**
 * The QBO invoice was created (for the preview's amount due) and sent to
 * ProDough. The deposit balance is taken off here, oldest first. `expected_amount_due`,
 * when sent, must match what is taken off now, or the QBO invoice and this
 * record would disagree (the balance moved since the invoice was made).
 */
export function markInvoiced(db, id, body, user) {
  const row = byId(db, id);
  if (row.status !== 'to_invoice') throw fail(409, row.status === 'held' ? 'This order is held; fix what it names first.' : 'This invoice is already recorded.');
  if (Array.isArray(body?.deposit_ids) && body.deposit_ids.length) throw fail(400, 'Deposits are taken off automatically now, oldest first. Leave deposit_ids out.', { code: 'DEPOSITS_AUTOMATIC' });
  const no = String(body?.qbo_invoice_no || '').trim();
  if (!no) throw fail(400, 'Give the QBO invoice number.');
  let result;
  db.transaction(() => {
    const p = previewDeposits(db, row.total);
    if (body?.expected_amount_due !== undefined && body.expected_amount_due !== null && body.expected_amount_due !== '') {
      const exp = Number(body.expected_amount_due);
      if (!Number.isFinite(exp) || Math.abs(exp - p.amount_due) >= 0.005) {
        throw fail(409, `The deposit balance moved: this invoice now comes to ${money(p.amount_due)} after deposits, not ${money(exp)}. Correct the QBO invoice, then record it again.`, { code: 'AMOUNT_DUE_CHANGED', amount_due: p.amount_due });
      }
    }
    const ins = db.prepare('INSERT INTO prodough_deposit_applications (id, deposit_id, invoice_id, amount, applied_by) VALUES (?, ?, ?, ?, ?)');
    for (const t of p.take) ins.run(randomUUID(), t.deposit_id, row.id, t.amount, user.name);
    const due = p.amount_due;
    db.prepare(`UPDATE production_invoices SET qbo_invoice_no = ?, invoiced_by = ?, invoiced_at = datetime('now'), deposit_ids = ?, deposits_applied = ?, amount_due = ?,
        status = ?, paid_from = ?, paid_by = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') END WHERE id = ?`)
      .run(no.slice(0, 80), user.name, JSON.stringify(p.take.map(t => t.deposit_id)), p.applied, due, due > 0 ? 'invoiced' : 'paid', due > 0 ? null : 'deposits',
        due > 0 ? null : user.name, due > 0 ? 'invoiced' : 'paid', row.id);
    result = p;
  })();
  return { ...invoiceView(db, byId(db, row.id)), applied_now: result };
}

/** Void: a wrong invoice frees its PO and puts its deposits back on the balance. Never one that is paid or on a live run. */
export function voidInvoice(db, id, body, user) {
  const row = byId(db, id);
  const v = invoiceView(db, row);
  if (row.status === 'void') throw fail(409, 'Already void.');
  if (row.status === 'paid') throw fail(409, 'A paid invoice is not voided here; correct it in QBO and tell Lowry.');
  if (v.on_run) throw fail(409, `This invoice is on payment run ${v.on_run.run_no}. Cancel that run first, or let it be paid.`);
  const why = String(body?.reason || '').trim();
  if (why.length < 5) throw fail(400, 'Say why it is void; it stays on file with the reason.');
  db.transaction(() => {
    db.prepare("UPDATE prodough_deposit_applications SET released_at = datetime('now'), released_by = ?, release_reason = ? WHERE invoice_id = ? AND released_at IS NULL")
      .run(user.name, `Invoice ${row.ref_no} void: ${why}`.slice(0, 500), row.id);
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
    open_deposits: openDeposits(db), deposit_balance: depositBalance(db), price_field: getSettings(db).production_price_field || null, price_fields: PRICE_FIELDS, sources: SOURCES,
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
    body = `*Production invoice ${view.ref_no} to create in QBO*\n${what}\nTotal ${money(view.total)} (all in)${view.deposit_preview ? `, less ${money(view.deposit_preview.applied)} from the deposit balance = ${money(view.deposit_preview.amount_due)} due` : ''}. Create it in QBO for that amount, send it to ProDough, then record the QBO number.\nOpen: /?tab=payment-run&view=production`;
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
