// Partial receipt + invoice figures — executed, not asserted.
// Boots against a running server on a fresh database (PORT/DBPATH set by the
// caller) and drives the real endpoints over HTTP, exactly as the screen does.
const PORT = process.env.PORT || 4842;
const B = `http://localhost:${PORT}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sup-office','Office Admin','Office Admin','admin','office',1,'SEED-CODE', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sup-oper','Floor Operator','Floor Operator','operator','production',1,'SEED-CODE2', datetime('now','+7 day'))`).run();
  db.close();
}
await post('/users/login', { name: 'Office Admin' });
await post('/users/set-password', { user_id: 'sup-office', password: 'OfficeSecret2026', setup_code: 'SEED-CODE' });
token = (await J(await post('/users/login', { name: 'Office Admin', password: 'OfficeSecret2026' })))?.token;
t('admin signed in', !!token);

console.log('\n── partial receipt ──');
const order = await J(await post('/office/supply/orders', { item_name: 'Barstool', qty: 3, uom: 'ea', supplier: 'Costco' }));
t('an order files', !!order?.id);
t('a new order has received nothing', order.qty_received === 0 && order.receipt_state === 'none', JSON.stringify(order.receipt_state));
t('outstanding is the whole order', order.outstanding === 3, `${order.outstanding}`);

// One of three arrives.
let o = await J(await post(`/office/supply/orders/${order.id}/receive`, { qty: 1, note: 'Two back-ordered' }));
t('one of three is recorded', o.qty_received === 1, `${o.qty_received}`);
t('the state is PARTIAL, not received', o.receipt_state === 'partial', o.receipt_state);
t('two are still outstanding', o.outstanding === 2, `${o.outstanding}`);
// The whole point: a part-delivered order must not close.
t('the STATUS stays open while any of it is outstanding', o.status === 'ordered', o.status);
t('nothing claims it was received in full', o.received_at == null);
t('the delivery is on the record with its note', o.receipt_history.length === 1 && /back-ordered/i.test(o.receipt_history[0].note));
t('who took it in is recorded', o.receipt_history[0].by === 'Office Admin');

// The rest turns up later — a second event, not an edit of the first.
o = await J(await post(`/office/supply/orders/${order.id}/receive`, { qty: 2 }));
t('the second delivery accumulates', o.qty_received === 3, `${o.qty_received}`);
t('the order is now complete', o.receipt_state === 'complete' && o.outstanding === 0);
t('the status follows the count', o.status === 'received', o.status);
t('received_at is stamped only now', !!o.received_at);
t('both deliveries are on the record', o.receipt_history.length === 2);

// Refusals.
let r = await post(`/office/supply/orders/${order.id}/receive`, { qty: 1 });
t('receiving MORE than was ordered is refused', r.status === 400, `${r.status}`);
r = await post(`/office/supply/orders/${order.id}/receive`, { qty: 0 });
t('receiving nothing is refused', r.status === 400);
r = await post(`/office/supply/orders/${order.id}/receive`, { qty: -1 });
t('a correction with no reason is refused', r.status === 400);

// A miscount is corrected by a negative entry, not by rewriting the number.
o = await J(await post(`/office/supply/orders/${order.id}/receive`, { qty: -1, note: 'Miscounted — one was damaged' }));
t('a reasoned correction applies', o.qty_received === 2, `${o.qty_received}`);
t('the correction reopens the order', o.receipt_state === 'partial' && o.status === 'ordered', o.status);
t('THE CORRECTION IS ON THE RECORD, not an erasure', o.receipt_history.length === 3 && o.receipt_history[2].qty === -1);
r = await post(`/office/supply/orders/${order.id}/receive`, { qty: -99, note: 'below zero' });
t('a correction below zero is refused', r.status === 400);

// An order with no quantity written down cannot be part-received.
const noQty = await J(await post('/office/supply/orders', { item_name: 'Paper towels' }));
t('an order with no quantity says so', noQty.qty_known === false);
o = await J(await post(`/office/supply/orders/${noQty.id}/receive`, { qty: 1 }));
t('receiving one closes it, since there is nothing to be a part of', o.receipt_state === 'complete' && o.status === 'received');

// The status control and the count cannot disagree.
const flip = await J(await post('/office/supply/orders', { item_name: 'Gloves', qty: 10, uom: 'box' }));
o = await J(await put(`/office/supply/orders/${flip.id}`, { status: 'received' }));
t('marking received in full moves the COUNT with it', o.qty_received === 10 && o.receipt_state === 'complete', `${o.qty_received}`);
t('and says so on the record', o.receipt_history.length === 1 && /in full/i.test(o.receipt_history[0].note));

// Permission: this closes a purchasing record, so it is the office's.
token = (await J(await post('/users/login', { name: 'Floor Operator' })))?.token || token;
{
  const db = new Database(process.env.DBPATH);
  db.prepare("UPDATE users SET password_hash = NULL, setup_code = 'SEED-CODE2', setup_code_expires_at = datetime('now','+7 day') WHERE id = 'sup-oper'").run();
  db.close();
}
await post('/users/set-password', { user_id: 'sup-oper', password: 'FloorSecret2026', setup_code: 'SEED-CODE2' });
const opTok = (await J(await post('/users/login', { name: 'Floor Operator', password: 'FloorSecret2026' })))?.token;
const before = token; token = opTok;
r = await post(`/office/supply/orders/${flip.id}/receive`, { qty: 1 });
t('an operator cannot receive an order', r.status === 403, `${r.status}`);
token = before;

console.log('\n── invoice figures ──');
// The reading path without storage: file the text the way the indexer does and
// check the figures land on the record. (Uploading needs R2; reading does not.)
const { readInvoiceFigures } = await import('../server/invoice-figures.js');
const text = 'ACME SUPPLY CO\nInvoice Date: 08/31/2026\nSubtotal 530.00\nSales Tax 39.88\nTOTAL AMOUNT DUE 569.88\n';
const invId = 'inv-test-1';
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO supply_invoices (id, filename, storage_key, size, content_type, uploaded_by, extracted_text)
              VALUES (?, 'acme-88123.pdf', 'invoices/x/acme.pdf', 100, 'application/pdf', 'Office Admin', ?)`).run(invId, text);
  // A second invoice whose total was TYPED — the one that must never move.
  db.prepare(`INSERT OR REPLACE INTO supply_invoices (id, filename, storage_key, size, content_type, uploaded_by, extracted_text, total, total_source)
              VALUES ('inv-test-2', 'typed.pdf', 'invoices/y/typed.pdf', 100, 'application/pdf', 'Office Admin', ?, 12.34, 'typed')`).run(text);
  db.close();
}
t('the pure reader agrees with the fixture', readInvoiceFigures(text).total === 569.88);

let inv = await J(await post(`/office/supply/invoices/${invId}/read`, {}));
t('the total is read off the file', inv.total === 569.88, `${inv.total}`);
t('the date is read off the file', inv.invoice_date === '2026-08-31', inv.invoice_date);
t('it is marked as READ, not typed', inv.total_source === 'read', inv.total_source);
t('the LINE it was read from travels with it', /TOTAL AMOUNT DUE/.test(inv.figures?.total_evidence || ''));
t('the OCR text itself is never shipped to the client', inv.extracted_text === undefined);
t('but the record says whether there was any', inv.searchable === true);

const typed = await J(await post('/office/supply/invoices/inv-test-2/read', {}));
t('A TYPED TOTAL IS NEVER OVERWRITTEN BY A READ', typed.total === 12.34, `${typed.total}`);

// Editing the total makes it a person's answer, and a later read must respect that.
await put(`/office/supply/invoices/${invId}`, { total: 600 });
const edited = await J(await post(`/office/supply/invoices/${invId}/read`, {}));
t('editing the total makes it typed', edited.total === 600 && edited.total_source === 'typed', `${edited.total}/${edited.total_source}`);

console.log('\n── the order total follows the invoice, on a click ──');
await put(`/office/supply/orders/${flip.id}`, { invoice_id: invId });
let list = await J(await req('/office/supply/orders?status=received'));
let row = list.find(x => x.id === flip.id);
t('the linked invoice offers its total', row.suggested_total === 600, `${row.suggested_total}`);
t('the suggestion names the file it came from', row.suggested_total_from === 'acme-88123.pdf');
// SUGGESTED, NEVER APPLIED — one invoice routinely covers several orders.
t('THE ORDER TOTAL IS NOT SET BY LINKING', row.total == null, `${row.total}`);
await put(`/office/supply/orders/${flip.id}`, { total: row.suggested_total });
list = await J(await req('/office/supply/orders?status=received'));
row = list.find(x => x.id === flip.id);
t('accepting it sets the total', row.total === 600);
t('and the suggestion withdraws itself', row.suggested_total === undefined);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
