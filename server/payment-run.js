// The weekly payment run (D-360) — the bills Powder Ops pays this week, and why
// each one is on it, held back, or off it.
//
// THE RUN IS DERIVED, NOT STORED (PR A). Every read walks the bills that are in
// QuickBooks and answers, per bill, every check in one place (`evaluateBill`).
// A stored copy would go stale the moment Jake corrected a bill. The run is
// frozen only when it is sent for approval (PR B).
//
// RULES, each load-bearing:
//   - Only a bill ENTERED IN QBO is on a run: AP Drop status `in_qbo` with a
//     QuickBooks bill id. Anything earlier is counted, never listed as payable.
//   - A failed check keeps the bill OFF the run. A flag never does; flags are
//     ranked so the unusual reads first ("highlight") and the small stuff
//     after ("note").
//   - A must-pay vendor's bills are LOCKED at the top. They skip the PO and
//     receiving checks (CTLA, taxes) but not the duplicate or amount checks.
//   - The class (ProDough material / Powder Ops expense) is SUGGESTED here and
//     only ever STORED when a person confirms it. An unconfirmed bill fails.
//   - Nothing here writes, except `recordNewFailures`, which a scheduled job
//     calls: one `payment_check_failed` event per bill per distinct set of
//     failing checks, so the same failure is reported once.
import { randomUUID } from 'crypto';
import { normDocNumber } from './partner-recon.js';
import { readBillLines, readRemit, matchLinesToPo, lineFlags, abaValid } from './bill-lines.js';
import { plantDateOf } from './plant-clock.js';
import { isClosedDay, nextWorkday } from './plant-calendar.js';

export const PAYROLL_ANCHOR = '2026-11-23';       // a Monday; payroll every second week from it
export const PAYROLL_RUN_TIME = '12:00';
export const BILL_CLASSES = Object.freeze({
  prodough_material: 'ProDough material',
  powderops_expense: 'Powder Ops expense',
});
// Lowry approved these on 18 Nov 2026 (the plan's question 6).
export const THRESHOLDS = Object.freeze({
  price_note_pct: 2,        // bill above its PO by more than this: noted
  price_highlight_pct: 10,  // …by more than this: highlighted
  jump_multiple: 3,         // a bill this many times the vendor's usual: highlighted
  new_vendor_months: 12,    // no bill from them in this long, and no PO or supplier record: new
  duplicate_days: 30,       // same vendor and amount within this many days: possible duplicate
  qty_odd_pct: 20,          // a bill line's quantity this far off its PO line: odd (D-363)
});
export const RECIPIENT_EMAIL = 'lowry@powder-ops.com';
const DAY = 86400000;

export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
export const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A payroll week is every second week from Monday 23 Nov 2026. */
export function isPayrollWeek(dateStr) {
  const weeks = Math.round((Date.parse(`${mondayOf(dateStr)}T00:00:00Z`) - Date.parse(`${PAYROLL_ANCHOR}T00:00:00Z`)) / (7 * DAY));
  return weeks >= 0 && weeks % 2 === 0;
}

/** The run day of the week holding `dateStr`: Friday 12:00 in a payroll week, otherwise Thursday; a closed day moves to the next open one. */
export function runDayOfWeek(db, dateStr) {
  const monday = mondayOf(dateStr);
  const payroll = isPayrollWeek(monday);
  const planned = addDays(monday, payroll ? 4 : 3);
  const date = isClosedDay(db, planned) ? nextWorkday(db, planned) : planned;
  return { week_start: monday, payroll_week: payroll, planned, date, time: payroll ? PAYROLL_RUN_TIME : null, moved: date !== planned };
}

/** The next run on or after today, and the one after it (which decides what is not due yet). */
export function nextRun(db, today = plantDateOf()) {
  let run = runDayOfWeek(db, today);
  if (run.date < today) run = runDayOfWeek(db, addDays(run.week_start, 7));
  const after = runDayOfWeek(db, addDays(run.week_start, 7));
  return { ...run, following: after.date };
}

// ── matching helpers ─────────────────────────────────────────────────────────
const SUFFIX = /\b(inc|incorporated|llc|l\.l\.c|co|corp|corporation|company|ltd|limited|lp|llp|plc|the)\b/g;
export function foldVendor(v) {
  return String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
export function sameVendor(a, b) {
  const x = foldVendor(a), y = foldVendor(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}
/** PO00613, "PO #613", "613" are one PO. A reference cell may hold several. */
export function normPo(v) {
  let s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  s = s.replace(/^PO/, '');
  if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
  return s || null;
}
export function poRefs(v) {
  return [...new Set(String(v || '').split(/[,;/\n]|\s+and\s+/i).map(normPo).filter(Boolean))];
}
export function billAddressee(billTo) {
  const s = String(billTo || '');
  if (!s.trim()) return 'blank';
  if (/powder\s*-?\s*ops/i.test(s)) return 'powder_ops';
  if (/pro\s*-?\s*dough/i.test(s)) return 'prodough';
  return 'other';
}

/** Everything a set of checks needs, read once per request. */
export function loadContext(db, today = plantDateOf()) {
  const mustPays = db.prepare('SELECT * FROM payment_must_pays WHERE is_active = 1 ORDER BY vendor_name').all();
  const pos = new Map();
  try {
    for (const r of db.prepare("SELECT po_number, vendor, part_no, description, qty, unit_price, status, received_date, customer FROM purchase_orders WHERE po_number IS NOT NULL AND TRIM(po_number) <> ''").all()) {
      const k = normPo(r.po_number); if (!k) continue;
      if (!pos.has(k)) pos.set(k, []);
      pos.get(k).push(r);
    }
  } catch { /* procurement tables absent */ }
  const received = new Set();
  try {
    for (const r of db.prepare("SELECT po_number FROM receiving_log WHERE po_number IS NOT NULL AND TRIM(po_number) <> ''").all()) {
      for (const k of poRefs(r.po_number)) received.add(k);
    }
  } catch { /* receiving absent */ }
  const drops = db.prepare(`SELECT id, vendor_name, invoice_number, invoice_date, due_date, amount, status, bill_class, created_at
    FROM ap_drops WHERE status <> 'not_finance'`).all();
  const suppliers = (() => { try { return db.prepare('SELECT name, legacy_names, vendor_type FROM suppliers').all(); } catch { return []; } })();
  const poVendors = (() => { const s = new Set(); for (const rows of pos.values()) for (const r of rows) s.add(foldVendor(r.vendor)); return s; })();
  const bankDetails = (() => { try { return db.prepare('SELECT * FROM vendor_bank_details WHERE retired_at IS NULL ORDER BY recorded_at DESC').all(); } catch { return []; } })();
  return { today, mustPays, pos, received, drops, suppliers, poVendors, bankDetails, run: nextRun(db, today) };
}

export function mustPayFor(ctx, vendor) {
  return ctx.mustPays.find(m => sameVendor(m.vendor_name, vendor)) || null;
}

/** The bank details on file for a vendor (the latest a person confirmed), or null. */
export function bankDetailsFor(ctx, vendor) {
  return (ctx.bankDetails || []).find(b => sameVendor(b.vendor_name, vendor)) || null;
}

function supplierFor(ctx, vendor) {
  return ctx.suppliers.find(s => sameVendor(s.name, vendor)
    || String(s.legacy_names || '').split(/[|,;\n]/).some(n => n.trim() && sameVendor(n, vendor))) || null;
}

/** The class the app would suggest, with why. Never stored. */
export function suggestClass(ctx, drop) {
  if (drop.bill_class) return { value: drop.bill_class, why: 'confirmed' };
  const prior = ctx.drops.filter(d => d.id !== drop.id && d.bill_class && sameVendor(d.vendor_name, drop.vendor_name))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (prior) return { value: prior.bill_class, why: `${BILL_CLASSES[prior.bill_class]} last time for this vendor` };
  const sup = supplierFor(ctx, drop.vendor_name);
  if (sup && /ingredient|packaging|raw/i.test(sup.vendor_type || '')) return { value: 'prodough_material', why: `supplier type: ${sup.vendor_type}` };
  for (const k of poRefs(drop.po_or_co_ref)) {
    if (ctx.pos.has(k)) return { value: 'prodough_material', why: `against PO ${k}` };
  }
  if (sup?.vendor_type) return { value: 'powderops_expense', why: `supplier type: ${sup.vendor_type}` };
  return { value: null, why: 'no history for this vendor' };
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);

/**
 * Every check on one bill. Returns the checks, the flags ranked, and where the
 * bill goes: `failed` (off the run), `held` (not due before the following run),
 * or `on_run`.
 */
export function evaluateBill(ctx, drop) {
  const checks = [];
  const add = (key, label, state, reason, severity = null) => checks.push({ key, label, state, reason, severity });
  const mustPay = mustPayFor(ctx, drop.vendor_name);
  const amount = Number(drop.amount);
  const cls = drop.bill_class || null;

  // Class — confirmed by a person, or the bill cannot go.
  if (cls && BILL_CLASSES[cls]) add('class', 'Class', 'pass', BILL_CLASSES[cls]);
  else add('class', 'Class', 'fail', 'Not classified yet: confirm ProDough material or Powder Ops expense');

  if (Number.isFinite(amount) && amount > 0) add('amount', 'Amount', 'pass', money(amount));
  else add('amount', 'Amount', 'fail', 'No amount on the bill');

  // Paying company: the bill must be addressed to Powder Ops.
  const to = billAddressee(drop.bill_to);
  if (to === 'powder_ops') add('company', 'Addressed to', 'pass', 'Powder Ops');
  else if (to === 'prodough') add('company', 'Addressed to', 'flag', 'Addressed to ProDough, not Powder Ops', 'highlight');
  else if (to === 'blank') add('company', 'Addressed to', 'flag', 'Bill-to was not read: check it is addressed to Powder Ops', 'highlight');
  else add('company', 'Addressed to', 'fail', `Addressed to "${String(drop.bill_to).slice(0, 60)}", not Powder Ops`);

  // Duplicates.
  const num = normDocNumber(drop.invoice_number);
  const others = ctx.drops.filter(d => d.id !== drop.id && sameVendor(d.vendor_name, drop.vendor_name));
  const sameNumber = num ? others.find(d => normDocNumber(d.invoice_number) === num) : null;
  const sameAmount = !sameNumber && Number.isFinite(amount) ? others.find(d => Math.abs(Number(d.amount) - amount) < 0.005
    && d.invoice_date && drop.invoice_date
    && Math.abs(Date.parse(d.invoice_date) - Date.parse(drop.invoice_date)) <= THRESHOLDS.duplicate_days * DAY) : null;
  if (sameNumber) add('duplicate', 'Duplicate', 'fail', `Same invoice number as another bill from this vendor (${sameNumber.invoice_number}, ${sameNumber.status.replace(/_/g, ' ')})`);
  // Same vendor and amount, different invoice numbers, is usually a repeat
  // delivery (a note); with a number missing on either side it is the classic
  // re-sent bill (highlighted).
  else if (sameAmount) add('duplicate', 'Duplicate', 'flag', `Same vendor and amount as invoice ${sameAmount.invoice_number || '(no number)'} within ${THRESHOLDS.duplicate_days} days`,
    num && normDocNumber(sameAmount.invoice_number) ? 'note' : 'highlight');
  else add('duplicate', 'Duplicate', 'pass', 'No other bill with this number');

  // PO, receiving and total vs PO.
  const refs = poRefs(drop.po_or_co_ref);
  const poRows = refs.flatMap(k => ctx.pos.get(k) || []);
  if (mustPay) {
    add('po', 'PO', 'na', 'Must-pay: no PO needed');
    add('received', 'Goods received', 'na', 'Must-pay');
  } else if (!refs.length) {
    if (cls === 'powderops_expense') { add('po', 'PO', 'na', 'Expense: no PO'); add('received', 'Goods received', 'na', 'Expense'); }
    else { add('po', 'PO', 'fail', 'No PO number on the bill'); add('received', 'Goods received', 'na', 'No PO to check against'); }
  } else if (!poRows.length) {
    add('po', 'PO', 'fail', `PO ${refs.join(', ')} not found in Procurement`);
    add('received', 'Goods received', 'na', 'No PO to check against');
  } else {
    const vendorOk = poRows.some(r => sameVendor(r.vendor, drop.vendor_name));
    if (vendorOk) add('po', 'PO', 'pass', `PO ${refs.join(', ')}`);
    else add('po', 'PO', 'flag', `PO ${refs.join(', ')} is for ${poRows[0].vendor}, not ${drop.vendor_name || 'this vendor'}`, 'highlight');
    const got = refs.some(k => ctx.received.has(k)) || poRows.some(r => r.status === 'received' || r.received_date);
    if (got) add('received', 'Goods received', 'pass', 'Received against the PO');
    else add('received', 'Goods received', 'fail', `Nothing received against PO ${refs.join(', ')} yet`);
    const poTotal = poRows.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unit_price) || 0), 0);
    const p = Number.isFinite(amount) ? pct(amount, poTotal) : null;
    if (!poTotal || p === null) add('price', 'Total vs PO', 'na', 'The PO carries no prices');
    else if (p > THRESHOLDS.price_highlight_pct) add('price', 'Total vs PO', 'flag', `${p.toFixed(1)}% above the PO (${money(poTotal)})`, 'highlight');
    else if (p > THRESHOLDS.price_note_pct) add('price', 'Total vs PO', 'flag', `${p.toFixed(1)}% above the PO (${money(poTotal)})`, 'note');
    else add('price', 'Total vs PO', 'pass', p < -0.5 ? `${Math.abs(p).toFixed(0)}% of the PO not billed yet` : 'Matches the PO');
    // Line by line (D-363): read off the bill's own text on every look, never stored.
    const billLines = readBillLines(drop.extracted_text);
    const priced = poRows.filter(r => r.status !== 'cancelled' && (Number(r.qty) || Number(r.unit_price)));
    if (!billLines.length) add('lines', 'Lines vs PO', 'na', 'Lines were not read from the bill');
    else if (!priced.length) add('lines', 'Lines vs PO', 'na', 'The PO carries no quantities or prices');
    else {
      const lf = lineFlags(matchLinesToPo(billLines, priced), {
        qtyPct: THRESHOLDS.qty_odd_pct, noteBy: THRESHOLDS.price_note_pct, highlightBy: THRESHOLDS.price_highlight_pct, money,
      });
      if (!lf.length) add('lines', 'Lines vs PO', 'pass', `${billLines.length} line${billLines.length === 1 ? '' : 's'} match the PO`);
      for (const f of lf) add(f.key, f.label, 'flag', f.reason, f.severity);
    }
  }

  // Where the money goes (D-363). A bill that asks to be paid to bank details
  // other than those confirmed on file is the classic invoice fraud: it stays
  // off the run until a person confirms the change with the vendor by phone.
  const remit = readRemit(drop.extracted_text);
  const onFile = bankDetailsFor(ctx, drop.vendor_name);
  const shown = (r, l) => `routing ${r}${l ? `, account ending ${l}` : ''}`;
  if (!remit) add('bank', 'Bank details', 'na', onFile ? `None printed on the bill; on file: ${shown(onFile.routing, onFile.account_last4)}` : 'None printed on the bill');
  else if (!onFile) add('bank', 'Bank details', 'flag', `Bill asks to be paid to ${shown(remit.routing, remit.account_last4)}; none on file. Confirm by phone, then record them.`, 'highlight');
  else if (onFile.routing !== remit.routing || (remit.account_last4 && onFile.account_last4 && onFile.account_last4 !== remit.account_last4)) {
    add('bank', 'Bank details', 'fail', `Bank details CHANGED: the bill says ${shown(remit.routing, remit.account_last4)}, on file is ${shown(onFile.routing, onFile.account_last4)}. Confirm with the vendor by phone before recording the new ones.`);
  } else add('bank', 'Bank details', 'pass', `Match the details on file (${shown(onFile.routing, onFile.account_last4)})`);

  // Due date.
  let held = false;
  if (!drop.due_date) add('due', 'Due', 'flag', 'No due date on the bill', 'note');
  else if (drop.due_date < ctx.today) add('due', 'Due', 'flag', `Overdue since ${drop.due_date}`, 'highlight');
  else if (!mustPay && drop.due_date > ctx.run.following) { held = true; add('due', 'Due', 'pass', `Due ${drop.due_date}: waits for a later run`); }
  else add('due', 'Due', 'pass', `Due ${drop.due_date}`);

  // Unusual: a new vendor, a big jump.
  const since = addDays(ctx.today, -Math.round(THRESHOLDS.new_vendor_months * 30.4));
  const recent = others.filter(d => String(d.created_at).slice(0, 10) >= since);
  if (!mustPay && !recent.length && !supplierFor(ctx, drop.vendor_name) && ![...ctx.poVendors].some(v => sameVendor(v, drop.vendor_name))) {
    checks.push({ key: 'new_vendor', label: 'Vendor', state: 'flag', reason: 'New vendor: no bill, PO or supplier record before', severity: 'highlight' });
  }
  const prior = others.map(d => Number(d.amount)).filter(n => Number.isFinite(n) && n > 0);
  if (prior.length >= 2 && Number.isFinite(amount)) {
    const avg = prior.reduce((s, n) => s + n, 0) / prior.length;
    if (amount > avg * THRESHOLDS.jump_multiple) {
      checks.push({ key: 'jump', label: 'Size', state: 'flag', reason: `${(amount / avg).toFixed(1)}× this vendor's usual bill (${money(avg)})`, severity: 'highlight' });
    }
  }

  const failed = checks.filter(c => c.state === 'fail');
  const flags = checks.filter(c => c.state === 'flag').sort((a, b) => (a.severity === 'highlight' ? 0 : 1) - (b.severity === 'highlight' ? 0 : 1));
  return {
    checks, flags, failures: failed,
    highlight: flags.some(f => f.severity === 'highlight'),
    must_pay: mustPay ? { id: mustPay.id, label: mustPay.label || mustPay.vendor_name } : null,
    placement: failed.length ? 'failed' : held ? 'held' : 'on_run',
  };
}

/** Lines that are payable now: a bill entered in QuickBooks, not yet in a run or paid. */
// A bill ticked on a frozen run that is still waiting (draft or sent) is that
// run's, not the next one's (D-361). Unticked, or the run cancelled, it is back.
export function eligibleBills(db) {
  return db.prepare(`SELECT * FROM ap_drops d WHERE d.status = 'in_qbo' AND d.qbo_bill_id IS NOT NULL AND TRIM(d.qbo_bill_id) <> ''
    AND NOT EXISTS (SELECT 1 FROM payment_run_lines l JOIN payment_runs r ON r.id = l.run_id
      WHERE l.drop_id = d.id AND l.included = 1 AND r.status IN ('draft','sent'))
    ORDER BY COALESCE(d.due_date, '9999') , d.created_at`).all();
}

function lineOf(ctx, d) {
  const ev = evaluateBill(ctx, d);
  const refs = poRefs(d.po_or_co_ref);
  const what = refs.flatMap(k => ctx.pos.get(k) || []).map(r => r.description || r.part_no).filter(Boolean);
  const priced = refs.flatMap(k => ctx.pos.get(k) || []).filter(r => r.status !== 'cancelled' && Number(r.qty) && sameVendor(r.vendor, d.vendor_name));
  const qty = priced.slice(0, 2).map(r => `${Number(r.qty)}${Number(r.unit_price) ? ` × ${money(r.unit_price)}` : ''}`).join(' + ') || null;
  return {
    id: d.id, vendor: d.vendor_name, invoice_number: d.invoice_number, invoice_date: d.invoice_date, due_date: d.due_date, qty,
    amount: d.amount, bill_to: d.bill_to, po: d.po_or_co_ref, qbo_bill_id: d.qbo_bill_id, filename: d.filename,
    what: [...new Set(what)].slice(0, 3).join('; ') || null,
    remit: (() => { const r = readRemit(d.extracted_text); return r ? { routing: r.routing, account_last4: r.account_last4, evidence: r.evidence } : null; })(),
    bill_class: d.bill_class, bill_class_by: d.bill_class_by, suggested_class: suggestClass(ctx, d),
    ...ev,
  };
}

const rank = (a, b) => (a.must_pay ? 0 : 1) - (b.must_pay ? 0 : 1)
  || (a.highlight ? 0 : 1) - (b.highlight ? 0 : 1)
  || (a.flags.length ? 0 : 1) - (b.flags.length ? 0 : 1)
  || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));

/** The whole page: the next run, its bills by placement, the totals, and what is not in QuickBooks yet. */
export function paymentRun(db, today = plantDateOf()) {
  const ctx = loadContext(db, today);
  const lines = eligibleBills(db).map(d => lineOf(ctx, d));
  const by = (p) => lines.filter(l => l.placement === p).sort(rank);
  const onRun = by('on_run');
  const sum = (arr) => Math.round(arr.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  const notInQbo = db.prepare(`SELECT COUNT(*) n FROM ap_drops WHERE status IN ('new','triaged','matched','needs_info')
    OR (status = 'in_qbo' AND (qbo_bill_id IS NULL OR TRIM(qbo_bill_id) = ''))`).get().n;
  return {
    run: ctx.run, today,
    on_run: onRun, held: by('held'), failed: by('failed'),
    totals: {
      count: onRun.length, total: sum(onRun),
      materials: sum(onRun.filter(l => l.bill_class === 'prodough_material')),
      expenses: sum(onRun.filter(l => l.bill_class === 'powderops_expense')),
      must_pay: sum(onRun.filter(l => l.must_pay)),
      flagged: onRun.filter(l => l.flags.length).length,
      highlighted: onRun.filter(l => l.highlight).length,
      failed: lines.filter(l => l.placement === 'failed').length,
      held: lines.filter(l => l.placement === 'held').length,
    },
    not_in_qbo: notInQbo,
    must_pays: ctx.mustPays,
    thresholds: THRESHOLDS,
    classes: BILL_CLASSES,
  };
}

// ── vendor bank details (D-363) ────────────────────────────────────────────────
/**
 * Record the bank details a vendor is paid to, as confirmed by phone. From a
 * bill (`drop_id`): the details are re-read off that bill here, never taken
 * from the request. By hand: routing + last four. The previous details for the
 * vendor are retired in the same transaction. Returns the new row.
 */
export function recordBankDetails(db, body, user) {
  const note = String(body?.confirmed_note || '').trim();
  if (note.length < 5) throw Object.assign(new Error('Say how the details were confirmed: who you spoke to, and the number you called.'), { status: 400 });
  let vendor = String(body?.vendor_name || '').trim(), routing = String(body?.routing || '').replace(/\D/g, ''), last4 = String(body?.account_last4 || '').replace(/\D/g, '') || null;
  let dropId = null;
  if (body?.drop_id) {
    const d = db.prepare('SELECT id, vendor_name, extracted_text FROM ap_drops WHERE id = ?').get(body.drop_id);
    if (!d) throw Object.assign(new Error('Bill not found'), { status: 404 });
    const r = readRemit(d.extracted_text);
    if (!r) throw Object.assign(new Error('No bank details were read on that bill.'), { status: 400 });
    if (!d.vendor_name) throw Object.assign(new Error('The bill has no vendor name: set it in AP Drop first.'), { status: 400 });
    vendor = d.vendor_name; routing = r.routing; last4 = r.account_last4; dropId = d.id;
  }
  if (!vendor) throw Object.assign(new Error('Name the vendor.'), { status: 400 });
  if (!abaValid(routing)) throw Object.assign(new Error('That is not a valid 9-digit routing number.'), { status: 400 });
  if (last4 !== null && !/^\d{4}$/.test(last4)) throw Object.assign(new Error('Give the last four digits of the account, or leave it blank.'), { status: 400 });
  const id = randomUUID();
  const prior = db.prepare('SELECT * FROM vendor_bank_details WHERE retired_at IS NULL').all().filter(b => sameVendor(b.vendor_name, vendor));
  db.transaction(() => {
    for (const b of prior) db.prepare("UPDATE vendor_bank_details SET retired_at = datetime('now'), retired_by = ? WHERE id = ?").run(user?.name || null, b.id);
    db.prepare(`INSERT INTO vendor_bank_details (id, vendor_name, routing, account_last4, confirmed_note, from_drop_id, recorded_by, recorded_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, vendor, routing, last4, note, dropId, user?.name || null, user?.id || null);
  })();
  return { row: db.prepare('SELECT * FROM vendor_bank_details WHERE id = ?').get(id), replaced: prior };
}

export function listBankDetails(db) {
  return db.prepare('SELECT * FROM vendor_bank_details ORDER BY vendor_name, recorded_at DESC').all();
}

/** The bank feed's balance, when an account is linked and synced: { amount, as_of, accounts } or null. Read only. */
export function feedBalance(db) {
  try {
    const rows = db.prepare("SELECT name, current_balance, balance_as_of FROM bank_accounts WHERE is_active = 1 AND provider <> 'manual' AND current_balance IS NOT NULL").all();
    if (!rows.length) return null;
    const asOf = rows.map(r => r.balance_as_of).filter(Boolean).sort()[0] || null;
    return { amount: Math.round(rows.reduce((s, r) => s + Number(r.current_balance), 0) * 100) / 100, as_of: asOf, accounts: rows.map(r => r.name) };
  } catch { return null; }
}

// ── the score, the settings, the notices ──────────────────────────────────────
/** Bills that failed a check, by the week they were logged, for the last `weeks` weeks. A fixed record: fixing a bill later does not lower it. */
export function weeklyScore(db, { weeks = 8, today = plantDateOf() } = {}) {
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  const rows = db.prepare(`SELECT d.id, d.created_at, d.vendor_name, d.invoice_number,
      (SELECT detail FROM ap_drop_events e WHERE e.drop_id = d.id AND e.kind = 'payment_check_failed' ORDER BY e.at LIMIT 1) AS first_fail
    FROM ap_drops d WHERE d.status <> 'not_finance' AND date(d.created_at) >= ?`).all(first);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(first, 7 * i), end = addDays(start, 7);
    const inWeek = rows.filter(r => { const d = plantDateOf(r.created_at); return d >= start && d < end; });
    const failedRows = inWeek.filter(r => r.first_fail);
    const byCheck = {};
    for (const r of failedRows) {
      const keys = (() => { try { return JSON.parse(r.first_fail).checks || []; } catch { return []; } })();
      for (const k of keys) byCheck[k] = (byCheck[k] || 0) + 1;
    }
    out.push({ week_start: start, logged: inWeek.length, failed: failedRows.length, by_check: byCheck });
  }
  return out;
}

const SETTINGS_KEY = 'payment_run_settings';
// D-361: the approver's number is its own setting (blank = FLAVOR_APPROVER_PHONE),
// Lowry reviews before the text goes while `review_before_send` is on, and the
// materials invoice is weekly at cost until the accountant says otherwise.
export const MATERIALS_MODES = Object.freeze({ weekly_at_cost: 'One weekly deposit invoice: material bills at cost' });
// D-364: how ProDough's transfer is recorded against the deposit invoice, until the
// accountant confirms. 'transfer' marks the deposit paid when the transfer is
// confirmed in the bank; 'manual' leaves it for a person to mark.
export const DEPOSIT_PAYMENT_MODES = Object.freeze({
  transfer: 'The confirmed transfer pays the deposit and production invoices',
  manual: 'A person marks the deposit and production invoices paid',
});
const SETTING_DEFAULTS = Object.freeze({
  bill_owner_id: null, controller_id: null, notify_ids: [],
  approver_phone: null, review_before_send: true, materials_mode: 'weekly_at_cost', bank_balance: null, deposit_payment: 'transfer',
  production_price_field: null,
});
export function getSettings(db) {
  try { return { ...SETTING_DEFAULTS, ...JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTINGS_KEY)?.value || '{}') }; }
  catch { return { ...SETTING_DEFAULTS }; }
}
export function saveSettings(db, patch) {
  const next = { ...getSettings(db) };
  const user = (id) => (id ? db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(String(id))?.id || null : null);
  if ('bill_owner_id' in patch) next.bill_owner_id = user(patch.bill_owner_id);
  if ('controller_id' in patch) next.controller_id = user(patch.controller_id);
  if ('notify_ids' in patch) next.notify_ids = [...new Set((patch.notify_ids || []).map(user).filter(Boolean))];
  if ('approver_phone' in patch) {
    const digits = String(patch.approver_phone || '').replace(/\D/g, '').slice(-10);
    if (patch.approver_phone && digits.length !== 10) throw Object.assign(new Error('That does not look like a 10-digit phone number.'), { status: 400 });
    next.approver_phone = digits || null;
  }
  if ('bank_balance' in patch) {
    const b = patch.bank_balance;
    const n = Number(b?.amount);
    if (b !== null && (!Number.isFinite(n) || b?.amount === '' || b?.amount === null)) throw Object.assign(new Error('Enter the bank balance as a number.'), { status: 400 });
    next.bank_balance = b === null ? null : { amount: Math.round(n * 100) / 100, by: b.by || null, at: new Date().toISOString() };
  }
  if ('review_before_send' in patch) next.review_before_send = patch.review_before_send !== false;
  if ('materials_mode' in patch) {
    if (!MATERIALS_MODES[patch.materials_mode]) throw Object.assign(new Error(`Deposit invoice must be one of: ${Object.keys(MATERIALS_MODES).join(', ')}`), { status: 400 });
    next.materials_mode = patch.materials_mode;
  }
  if ('deposit_payment' in patch) {
    if (!DEPOSIT_PAYMENT_MODES[patch.deposit_payment]) throw Object.assign(new Error(`Deposit payment must be one of: ${Object.keys(DEPOSIT_PAYMENT_MODES).join(', ')}`), { status: 400 });
    next.deposit_payment = patch.deposit_payment;
  }
  if ('production_price_field' in patch) {
    // D-365: which price-list column prices a ProDough production invoice. Chosen, never guessed.
    const f = patch.production_price_field || null;
    if (f && !['price_fob_unit', 'price_wholesale_unit'].includes(f)) throw Object.assign(new Error('The ProDough price list must be the FOB unit price or the wholesale unit price.'), { status: 400 });
    next.production_price_field = f;
  }
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** Who hears that something went wrong: the stored list, else the account with Lowry's email, else the active admins. Never nobody. */
export function notifyRecipients(db) {
  const s = getSettings(db);
  const active = (ids) => ids.map(id => db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(id)).filter(Boolean);
  if (s.notify_ids?.length) { const list = active(s.notify_ids); if (list.length) return list; }
  const byEmail = db.prepare('SELECT id, name FROM users WHERE LOWER(TRIM(email)) = ? AND is_active = 1').all(RECIPIENT_EMAIL);
  if (byEmail.length === 1) return byEmail;
  return db.prepare("SELECT id, name FROM users WHERE role = 'admin' AND is_active = 1 AND name <> 'ReadyBot'").all();
}

/**
 * Record the failures nobody has been told about: one event per bill per
 * distinct set of failing checks. Returns the bills newly recorded. The only
 * write in this module.
 */
export function recordNewFailures(db, today = plantDateOf()) {
  const page = paymentRun(db, today);
  const fresh = [];
  const seen = db.prepare("SELECT detail FROM ap_drop_events WHERE drop_id = ? AND kind = 'payment_check_failed'");
  const ins = db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_name, kind, detail) VALUES (?, ?, 'system:payment-run', 'payment_check_failed', ?)");
  for (const l of page.failed) {
    const keys = l.failures.map(f => f.key).sort();
    const fp = keys.join(',');
    const already = seen.all(l.id).some(r => { try { return (JSON.parse(r.detail).checks || []).slice().sort().join(',') === fp; } catch { return false; } });
    if (already) continue;
    ins.run(randomUUID(), l.id, JSON.stringify({ checks: keys, reasons: l.failures.map(f => f.reason) }));
    fresh.push(l);
  }
  return fresh;
}

const billLine = (l) => `• ${l.vendor || '(no vendor)'} ${l.invoice_number ? `#${l.invoice_number} ` : ''}${money(l.amount)}: ${l.failures.map(f => f.reason).join('; ')}`;

/** New failures go to Lowry (or whoever is set) and to the bill owner (Jake). Fire-and-forget per recipient. */
export async function sendFailureNotices(db, { botDm, postMessageAs, pushToUser }, today = plantDateOf()) {
  const fresh = recordNewFailures(db, today);
  if (!fresh.length) return { sent: 0, bills: 0 };
  const s = getSettings(db);
  const owner = s.bill_owner_id ? db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(s.bill_owner_id) : null;
  const list = fresh.slice(0, 15).map(billLine).join('\n') + (fresh.length > 15 ? `\n…and ${fresh.length - 15} more` : '');
  let sent = 0;
  const say = async (u, body, title) => {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser?.(u.id, { title, body: `${fresh.length} bill${fresh.length === 1 ? '' : 's'}`, tag: 'payment-run-failed', url: '/?tab=payment-run' })?.catch?.(() => {});
      sent++;
    } catch (e) { console.warn('[payment-run] notice failed:', e.message); }
  };
  const ownerNote = owner ? `${owner.name} has been asked to fix them.` : '*Nobody is set as the bill owner* (Payment run → Settings), so nobody else was told.';
  for (const u of notifyRecipients(db)) {
    await say(u, `*Payment run: ${fresh.length} bill${fresh.length === 1 ? '' : 's'} kept off the run*\n${list}\n${ownerNote}\nOpen: /?tab=payment-run`, 'Bills kept off the payment run');
  }
  if (owner && !notifyRecipients(db).some(u => u.id === owner.id)) {
    await say(owner, `*${fresh.length} bill${fresh.length === 1 ? '' : 's'} can't be paid until fixed*\n${list}\nFix the bill in AP Drop (or confirm its class on the Payment run page): /?tab=payment-run`, 'Bills to fix before the payment run');
  }
  return { sent, bills: fresh.length };
}
