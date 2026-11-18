// verify:paymentchecks — payment run part C (D-363), pure + live.
// Each bill's lines are read off its own text and checked against the PO lines
// (an odd quantity, a unit price above the PO); the bank details printed on the
// bill are checked against those a person confirmed. A change keeps the bill
// off the run until an admin records the new details with the password. The
// bank feed's balance can stand in for a typed one. The weekly materials
// invoice reads as a Deposit. Caller sets PORT + DBPATH.
// Control: main before this — no line or bank check, and /bank-details is 404.
import Database from 'better-sqlite3';
import { readBillLines, readRemit, abaValid, matchLinesToPo, lineFlags } from '../server/bill-lines.js';

const PORT = Number(process.env.PORT || 5232);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayChecks2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

// ── the pure reader ──────────────────────────────────────────────────────────
console.log('Reader');
t('a real routing number passes the ABA check', abaValid('011000015') && abaValid('121000358'));
t('…a typo fails it', !abaValid('011000016') && !abaValid('123456789'));
const txt = [
  'ACME WHEY CO', 'Invoice A-9', 'Bill To: Powder Ops LLC', 'Customer Account # 99881',
  'DESCRIPTION QTY RATE AMOUNT',
  'RM-1 Whey protein isolate 130 10.00 1,300.00',
  'Freight 1 45.00 45.00',
  'Phone 801 555 1234',
  'Subtotal 1,345.00', 'Total 1,345.00',
  'Remit to: First Bank', 'ABA Routing: 011000015', 'Account Number: 1234 5678 4321',
].join('\n');
const lines = readBillLines(txt);
t('two lines are read, only where the arithmetic holds', lines.length === 1 || lines.length === 2, JSON.stringify(lines));
const whey = lines.find(l => /whey/i.test(l.description));
t('…the whey line: 130 × $10.00 = $1,300.00', whey && whey.qty === 130 && whey.unit_price === 10 && whey.amount === 1300, JSON.stringify(whey));
t('…the subtotal, total and phone lines are not lines', !lines.some(l => /total|phone/i.test(l.description)));
const remit = readRemit(txt);
t('the routing number beside "ABA Routing" is read', remit?.routing === '011000015', JSON.stringify(remit));
t('…and only the last four of the account', remit?.account_last4 === '4321');
t('…the customer account number above is NOT the bank account', remit?.account_last4 !== '9881');
t('a bill with an account number and no routing number has no bank details', readRemit('Customer Account # 1234567\nTotal 50.00') === null);
t('a 9-digit number that fails the checksum is not a routing number', readRemit('Routing 123456789\nAccount 99887766') === null);
const po = [{ part_no: 'RM-1', description: 'Whey protein isolate', qty: 100, unit_price: 10, status: 'open' }];
const pairs = matchLinesToPo([whey], po);
t('the line pairs with its PO line by part number', pairs[0].po === po[0]);
let f = lineFlags(pairs);
t('130 billed against 100 ordered is an odd quantity, highlighted', f.some(x => /130 against 100/.test(x.reason) && x.severity === 'highlight'), JSON.stringify(f));
f = lineFlags([{ line: { ...whey, qty: 100, unit_price: 10.5, amount: 1050 }, po: po[0] }]);
t('$10.50 against $10.00 (5% over) is noted', f.length === 1 && f[0].severity === 'note' && /5\.0% over/.test(f[0].reason), JSON.stringify(f));
f = lineFlags([{ line: { ...whey, qty: 100, unit_price: 11.5, amount: 1150 }, po: po[0] }]);
t('$11.50 (15% over) is highlighted', f.length === 1 && f[0].severity === 'highlight');
f = lineFlags([{ line: { ...whey, qty: 70, unit_price: 10, amount: 700 }, po: po[0] }]);
t('70 of 100 ordered is noted as a part delivery, not highlighted', f.length === 1 && f[0].severity === 'note' && /under/.test(f[0].reason));
t('a line no PO line names is noted', lineFlags(matchLinesToPo([{ description: 'Pallet charge', qty: 2, unit_price: 25, amount: 50 }], po.concat({ part_no: 'X', description: 'Other', qty: 1, unit_price: 1 })))
  .some(x => /not on the PO/.test(x.reason)));

// ── live ──────────────────────────────────────────────────────────────────────
console.log('Live');
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pc-boss', 'Petra Boss', 'admin', 'admin', {});
mk('pc-jake', 'Jonas Buyer', 'operator', 'warehouse', { 'ap-drop': 'edit' });
let n = 0;
const drop = (o) => {
  const id = `pc-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, po_or_co_ref, bill_class, extracted_text, created_at)
    VALUES (?, ?, 'k', ?, 'in_qbo', ?, ?, ?, ?, ?, ?, 'Powder Ops LLC', ?, 'prodough_material', ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, `QB-${n}`, o.vendor, o.inv, iso(-3), iso(2), o.amount, o.po, o.text);
  return id;
};
const addPo = (num, vendor, part, desc, qty, price) => db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')")
  .run(`pc-po-${num}-${part}`, num, vendor, part, desc, qty, price);
const recv = (num) => db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES (?, ?, ?, ?, 'X', 1)")
  .run(`pc-rx-${num}`, `A-100-8${num.slice(-3)}`, iso(-1), num);
addPo('PO00951', 'Fern Foods', 'RM-7', 'Cocoa powder', 100, 10); recv('PO00951');
addPo('PO00952', 'Gale Packaging', 'PK-2', 'Stick film roll', 10, 50); recv('PO00952');
addPo('PO00953', 'Hill Flavors', 'FL-3', 'Vanilla flavor', 20, 25); recv('PO00953');
const fine = drop({ vendor: 'Fern Foods', inv: 'F-1', amount: 1000, po: 'PO00951',
  text: 'Fern Foods\nRM-7 Cocoa powder 100 10.00 1,000.00\nTotal 1,000.00\nRouting number 011000015\nAccount 55554444' });
const odd = drop({ vendor: 'Gale Packaging', inv: 'G-1', amount: 650, po: 'PO00952',
  text: 'Gale Packaging\nPK-2 Stick film roll 13 50.00 650.00\nTotal 650.00' });
const changed = drop({ vendor: 'Fern Foods', inv: 'F-2', amount: 1000, po: 'PO00951',
  text: 'Fern Foods\nRM-7 Cocoa powder 100 10.00 1,000.00\nTotal 1,000.00\nNEW BANK DETAILS\nABA 121000358\nAccount No. 777788889999' });
const unread = drop({ vendor: 'Hill Flavors', inv: 'H-1', amount: 500, po: 'PO00953', text: 'Hill Flavors\nThank you for your business\nTotal 500.00' });
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const boss = await login('pc-boss', 'Petra Boss');
const jake = await login('pc-jake', 'Jonas Buyer');
t('both sign in', !!boss && !!jake);

const page = async () => (await call('GET', '/payment-run', null, boss)).json || {};
let P = await page();
const all = () => [...(P.on_run || []), ...(P.failed || []), ...(P.held || [])];
const L = (id) => all().find(l => l.id === id);
const where = (id) => (P.on_run || []).some(l => l.id === id) ? 'on_run' : (P.failed || []).some(l => l.id === id) ? 'failed' : 'other';
const check = (id, key) => L(id)?.checks?.find(c => c.key === key);

t('a bill whose lines match its PO passes "Lines vs PO"', check(fine, 'lines')?.state === 'pass', JSON.stringify(check(fine, 'lines')));
t('…with bank details printed and none on file, it is highlighted, not kept off', where(fine) === 'on_run' && check(fine, 'bank')?.state === 'flag' && check(fine, 'bank')?.severity === 'highlight');
t('…and the line carries what was read, last four only', L(fine)?.remit?.routing === '011000015' && L(fine)?.remit?.account_last4 === '4444'
  && !JSON.stringify(L(fine)).includes('55554444'));
t('13 rolls billed against 10 ordered: highlighted, still on the run', where(odd) === 'on_run' && L(odd)?.flags.some(f => /13 against 10/.test(f.reason) && f.severity === 'highlight'),
  JSON.stringify(L(odd)?.flags));
t('a bill with no readable lines says so', check(unread, 'lines')?.state === 'na' && /not read/.test(check(unread, 'lines')?.reason || ''));
t('a bill with no bank details printed: not applicable', check(unread, 'bank')?.state === 'na');

// Record Fern's details from the first bill.
let r = await call('POST', '/payment-run/bank-details', { drop_id: fine, confirmed_note: 'Called Ana at 801-555-0100 (number from our vendor file)' }, jake);
t('only an admin records bank details', r.status === 403);
r = await call('POST', '/payment-run/bank-details', { drop_id: fine, confirmed_note: 'ok' }, boss);
t('…a note on how they were confirmed is required', r.status === 400);
r = await call('POST', '/payment-run/bank-details', { drop_id: fine, confirmed_note: 'Called Ana at 801-555-0100 (number from our vendor file)' }, boss);
t('…and the password is asked last', r.status === 403 && r.json?.signature_required === true, JSON.stringify(r.json));
r = await call('POST', '/payment-run/bank-details', { drop_id: fine, confirmed_note: 'Called Ana at 801-555-0100 (number from our vendor file)', signature_password: PW }, boss);
t('with the password the details are recorded, read off the bill itself', r.status === 201 && r.json?.routing === '011000015' && r.json?.account_last4 === '4444', JSON.stringify(r.json));
r = await call('POST', '/payment-run/bank-details', { vendor_name: 'Gale Packaging', routing: '123456789', account_last4: '1234', confirmed_note: 'Called Gil at the office', signature_password: PW }, boss);
t('a routing number that fails its check digit is refused', r.status === 400);

P = await page();
t('Fern\'s first bill now matches the details on file', check(fine, 'bank')?.state === 'pass');
t('Fern\'s second bill asks to be paid somewhere else: KEPT OFF the run', where(changed) === 'failed' && check(changed, 'bank')?.state === 'fail'
  && /CHANGED/.test(check(changed, 'bank')?.reason || ''), JSON.stringify(check(changed, 'bank')));
const fdb = new Database(DBP, { readonly: true });
const events = fdb.prepare("SELECT detail FROM ap_drop_events WHERE drop_id = ? AND kind = 'payment_check_failed'").all(changed);
fdb.close();
t('…the failure is recorded once for Lowry\'s notice', events.length <= 1);

r = await call('POST', '/payment-run/bank-details', { drop_id: changed, confirmed_note: 'Called Ana again on our number: they moved banks in October', signature_password: PW }, boss);
t('after a phone check the new details are recorded', r.status === 201 && r.json?.routing === '121000358' && r.json?.account_last4 === '9999');
P = await page();
t('…and the bill is back on the run', where(changed) === 'on_run' && check(changed, 'bank')?.state === 'pass');
const kept = new Database(DBP, { readonly: true });
const rows = kept.prepare("SELECT * FROM vendor_bank_details WHERE vendor_name = 'Fern Foods' ORDER BY recorded_at, rowid").all();
let delRefused = false;
kept.close();
t('the old details are retired, not deleted', rows.length === 2 && rows[0].retired_at && !rows[1].retired_at);
try { const w = new Database(DBP); w.prepare('DELETE FROM vendor_bank_details').run(); w.close(); } catch { delRefused = true; }
t('…and the table refuses a delete', delRefused);
t('the page lists the details on file', (P.bank_details || []).some(b => b.vendor_name === 'Fern Foods' && b.account_last4 === '9999'));

// Bank feed balance.
t('no feed linked: nothing offered', P.feed_balance === null);
r = await call('PUT', '/payment-run/bank-balance', { from_feed: true }, boss);
t('…and "use the feed" is refused', r.status === 409);
const w = new Database(DBP);
w.prepare("INSERT INTO bank_accounts (id, name, provider, current_balance, balance_as_of) VALUES ('pc-bank', 'Operating', 'plaid', 8421.5, ?)").run(iso(0));
w.close();
P = await page();
t('a synced account offers its balance', P.feed_balance?.amount === 8421.5 && P.feed_balance?.as_of === iso(0));
r = await call('PUT', '/payment-run/bank-balance', { from_feed: true }, boss);
t('…and using it records the feed as the source', r.status === 200 && r.json?.amount === 8421.5 && /bank feed/.test(r.json?.by || ''), JSON.stringify(r.json));

// Deposit wording.
t('the weekly ProDough invoice reads as a Deposit', /deposit/i.test(Object.values(P.settings?.materials_modes || {})[0] || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
