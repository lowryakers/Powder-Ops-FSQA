import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

// One-time seed of the AP / AR ledgers from the Monday.com board exports.
//
// Idempotent by the natural key an accountant would use — vendor/customer plus
// invoice number (falling back to the CO/PO number when an invoice number was
// never issued) — so re-running never doubles a balance.
//
// Monday carried the state in two places: a Status column and the board group
// ("Past Due", "Paid", "New / Not Due Yet"…). Both are used, with the group
// winning, because that's the one the office actually maintained.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSeed() {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'seed-data', 'ap-ar.json'), 'utf8'));
  } catch { return null; }
}

function apStatus(row) {
  if ((row.monday_status || '').toLowerCase() === 'paid') return 'paid';
  if ((row.invoice_approved || '').toLowerCase().startsWith('approved')) return 'approved';
  return 'awaiting_approval';
}

function arStatus(row) {
  const group = (row.group || '').toLowerCase();
  const status = (row.monday_status || '').toLowerCase();
  if (group.startsWith('paid') || status === 'paid') return 'paid';
  if (group.startsWith('new')) return 'sent';
  if (group.startsWith('complete')) return 'sent';
  return 'sent'; // Payment Due / Past Due are both sent-and-unpaid; the due date says which
}

export function seedFinanceFromMonday(db) {
  const seed = loadSeed();
  if (!seed) return;

  let apAdded = 0, arAdded = 0;
  const apExists = db.prepare(`SELECT 1 FROM ap_invoices WHERE LOWER(vendor) = LOWER(?) AND COALESCE(invoice_number, po_number, '') = ?`);
  const arExists = db.prepare(`SELECT 1 FROM ar_invoices WHERE LOWER(customer) = LOWER(?) AND COALESCE(invoice_number, co_number, '') = ?`);

  const insAp = db.prepare(`INSERT INTO ap_invoices
    (id, vendor, invoice_number, invoice_date, due_date, terms, amount, amount_paid, status,
     priority, invoice_link, ach_link, pay_link, pay_confirmation, paid_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Monday import')`);
  const insAr = db.prepare(`INSERT INTO ar_invoices
    (id, customer, invoice_number, po_number, co_number, invoice_date, due_date, amount, amount_received,
     status, person, order_type, notes, invoice_link, pay_confirmation, paid_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Monday import')`);

  const tx = db.transaction(() => {
    for (const r of seed.ap || []) {
      const key = r.invoice_number || r.po_number || '';
      if (!r.vendor || apExists.get(r.vendor, key)) continue;
      const status = apStatus(r);
      insAp.run(uuid(), r.vendor, r.invoice_number, null, r.due_date, r.terms,
        r.amount || 0, status === 'paid' ? (r.amount || 0) : 0, status,
        r.priority, r.invoice_link, r.ach_link, r.pay_link, r.pay_confirmation,
        status === 'paid' ? r.due_date : null);
      apAdded++;
    }
    for (const r of seed.ar || []) {
      const key = r.invoice_number || r.co_number || '';
      if (!r.customer || arExists.get(r.customer, key)) continue;
      const status = arStatus(r);
      insAr.run(uuid(), r.customer, r.invoice_number, r.po_number, r.co_number,
        r.created, r.due_date, r.amount || 0, status === 'paid' ? (r.amount || 0) : 0,
        status, r.person, r.order_type, r.notes, r.invoice_link, r.pay_confirmation,
        status === 'paid' ? r.due_date : null);
      arAdded++;
    }
  });
  tx();

  if (apAdded || arAdded) {
    console.log(`[seed] Imported ${apAdded} AP and ${arAdded} AR invoices from the Monday export`);
  }
}
