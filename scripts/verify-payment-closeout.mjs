// verify:paymentcloseout — the payment run, part D (D-364), live, with the S3 stand-in.
// After Danny approves and sends the money: a person confirms it landed (the bank
// feed only offers matches), each ticked bill is paid with a method, a date, a
// reference, proof (stored and hashed) and the QBO mark — or sent back with a
// reason to the next run — the deposit invoice is recorded and paid, the
// shortfall is booked, and the run closes only when nothing is open. Admin or
// the Controller; a token never. Payment rows cannot be deleted.
// Caller sets PORT + DBPATH and the R2_* stand-in variables.
// Control: main before this — /runs/:id/closeout is 404 and nothing below holds.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5233);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayRunD2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pd-boss', 'Paula Boss', 'admin', 'admin', {});
mk('pd-ctl', 'Cora Controller', 'operator', 'office', { 'ap-drop': 'edit' });
mk('pd-jake', 'Jay Buyer', 'operator', 'warehouse', { 'ap-drop': 'edit' });
let n = 0;
const drop = (o) => {
  const id = `pd-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, bill_class, po_or_co_ref, created_at)
    VALUES (?, ?, 'k', ?, 'in_qbo', ?, ?, ?, ?, ?, ?, 'Powder Ops LLC', ?, ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, `QB-D${n}`, o.vendor, o.inv, iso(-5), iso(2), o.amount, o.cls, o.po || null);
  return id;
};
db.prepare("INSERT INTO partner_accounts (id, name, code) VALUES ('pd-p', 'Delta Partner', 'DP')").run();
db.prepare("INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status) VALUES ('pd-pdoc', 'pd-p', 'payable', 'invoice', 'DP-77', 200, 'final')").run();
db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES ('pd-po', 'PO00911', 'Gamma Whey', 'RM-1', 'Whey', 100, 10, 'open')").run();
db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES ('pd-rx', 'A-100-8911', ?, 'PO00911', 'RM-1', 100)").run(iso(-2));
const mat = drop({ vendor: 'Gamma Whey', inv: 'G-1', amount: 1000, cls: 'prodough_material', po: 'PO00911' });
const exp = drop({ vendor: 'Zeta Janitorial', inv: 'Z-1', amount: 600, cls: 'powderops_expense' });
const back = drop({ vendor: 'Kappa Labels', inv: 'K-1', amount: 300, cls: 'powderops_expense' });
const ptn = drop({ vendor: 'Delta Partner', inv: 'DP-77', amount: 200, cls: 'powderops_expense' });
db.close();

const call = async (m, p, b, tok, headers = {}) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...headers, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const upload = async (p, tok, name, type, bytes) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${URL}/api${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const T = {};
for (const [id, nm] of [['pd-boss', 'Paula Boss'], ['pd-ctl', 'Cora Controller'], ['pd-jake', 'Jay Buyer']]) T[id] = await login(id, nm);
t('everyone signs in', Object.values(T).every(Boolean));

console.log('\n── an approved, transferred run');
let r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat, exp, back, ptn], reason: 'Close-out check' }, T['pd-boss']);
const run = r.json || {};
t('the admin prepares a run with four bills', r.status === 201 && run.lines?.length === 4, JSON.stringify(r.json)?.slice(0, 200));
const lineFor = (dropId) => run.lines.find(l => l.drop_id === dropId)?.id;
await call('POST', `/payment-run/runs/${run.id}/bank-balance`, { amount: 600 }, T['pd-boss']);
const tok = (await call('POST', `/payment-run/runs/${run.id}/send`, {}, T['pd-boss'])).json?.link?.split('/pay/')[1];
r = await call('GET', `/payment-run/runs/${run.id}/closeout`, null, T['pd-boss']);
t('before Danny approves there is no close-out', r.status === 409);
await call('POST', `/payment-approval/${tok}/approve`, { name: 'Danny A' });
r = await call('GET', `/payment-run/runs/${run.id}/closeout`, null, T['pd-boss']);
t('approved, not yet sent: the close-out says Danny has not sent it', r.status === 200 && r.json?.open?.[0]?.key === 'transfer_sent', JSON.stringify(r.json?.open));
const owes = r.json?.transfer?.expected;
t('ProDough owes the deposit (materials) plus the shortfall', owes === 1500, String(owes)); // 1000 + (1100 − 600)
t('nothing can be confirmed before Danny says he sent it', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500 }, T['pd-boss'])).status === 409);
await call('POST', `/payment-approval/${tok}/transferred`, { name: 'Danny A', amount: 1500 });
// The Delta bill is routed to the partner ledger after it was frozen on the run.
{ const x = new Database(DBP); x.prepare("UPDATE ap_drops SET partner_document_id = 'pd-pdoc' WHERE id = ?").run(ptn); x.close(); }

const w = new Database(DBP);
w.prepare("INSERT INTO bank_accounts (id, name) VALUES ('pd-bank', 'Powder Ops Operating')").run();
w.prepare("INSERT INTO bank_transactions (id, account_id, posted_date, description, amount) VALUES ('pd-txn', 'pd-bank', ?, 'TRANSFER FROM PRODOUGH', 1500)").run(iso(0));
w.prepare("INSERT INTO bank_transactions (id, account_id, posted_date, description, amount) VALUES ('pd-txn2', 'pd-bank', ?, 'SOMETHING ELSE', 999)").run(iso(0));
w.close();

console.log('\n── who may close it out');
t('Jake (AP queue, not the Controller) is refused', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500 }, T['pd-jake'])).status === 403);
t('the Controller is refused until named in the settings', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500 }, T['pd-ctl'])).status === 403);
t('the admin names the Controller', (await call('PUT', '/payment-run/settings', { controller_id: 'pd-ctl' }, T['pd-boss'])).status === 200);
const minted = (await call('POST', '/api-tokens', { user_id: 'pd-jake', label: 'Verify bot', scopes: ['read', 'write'] }, T['pd-boss'])).json?.plaintext;
t('a bot token cannot record the close-out', !!minted && [401, 403].includes((await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500 }, minted)).status));

console.log('\n── 1. the transfer landed');
r = await call('GET', `/payment-run/runs/${run.id}/closeout`, null, T['pd-ctl']);
t('the bank feed offers the matching deposit and only that', r.json?.transfer?.feed_matches?.length === 1 && r.json.transfer.feed_matches[0].id === 'pd-txn', JSON.stringify(r.json?.transfer?.feed_matches));
t('…and the Controller is told she can close out', r.json?.can_close_out === true);
t('paying a bill before the transfer is confirmed is refused', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/paid`, { method: 'qbo_ach', reference: 'ACH-1' }, T['pd-ctl'])).json?.code === 'TRANSFER_NOT_CONFIRMED');
t('a feed line that is not a match is refused', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500, bank_txn_id: 'pd-txn2' }, T['pd-ctl'])).status === 400);
t('a date in the future is refused', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500, received_on: iso(3) }, T['pd-ctl'])).status === 400);
r = await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500, bank_txn_id: 'pd-txn' }, T['pd-ctl']);
t('the Controller confirms it landed, against the feed line', r.status === 200 && r.json?.transfer?.received_amount === 1500 && r.json.transfer.received_bank_txn === 'pd-txn', JSON.stringify(r.json?.transfer));
t('…in "transfer" mode the deposit invoice is paid by the transfer', r.json?.deposit?.amount === 1000 && r.json.deposit.paid_from === 'transfer' && r.json.deposit.paid_amount === 1000, JSON.stringify(r.json?.deposit));
t('…confirming twice is refused', (await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1500 }, T['pd-ctl'])).status === 409);

console.log('\n── 2. paying the bills');
t('a payment needs a method', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/paid`, { reference: 'ACH-1' }, T['pd-ctl'])).status === 400);
t('a payment needs a reference', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/paid`, { method: 'qbo_ach' }, T['pd-ctl'])).status === 400);
r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/paid`, { method: 'qbo_ach', reference: 'ACH-1' }, T['pd-ctl']);
const expLine = r.json?.lines?.find(l => l.drop_id === exp);
t('Zeta is paid by QBO Bill Pay ACH: still owes proof and the QBO mark', r.status === 200 && expLine?.state === 'paid_incomplete' && expLine.missing.length === 2, JSON.stringify(expLine));
t('…the bill reads paid in AP Drop', q('SELECT status FROM ap_drops WHERE id = ?', exp)[0]?.status === 'paid');
t('…a second payment on the same bill is refused', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/paid`, { method: 'check', reference: 'CK 9' }, T['pd-ctl'])).status === 409);
t('proof that is not a PDF or a photo is refused', (await upload(`/payment-run/runs/${run.id}/lines/${lineFor(exp)}/proof`, T['pd-ctl'], 'note.txt', 'text/plain', 'hello')).status === 415);
r = await upload(`/payment-run/runs/${run.id}/lines/${lineFor(exp)}/proof`, T['pd-ctl'], 'ach-confirmation.pdf', 'application/pdf', '%PDF-1.4 proof of payment');
t('the ACH confirmation is attached', r.status === 200, JSON.stringify(r.json)?.slice(0, 200));
t('…stored with its fingerprint', /^[0-9a-f]{64}$/.test(q('SELECT proof_sha256 FROM payment_run_payments WHERE drop_id = ?', exp)[0]?.proof_sha256 || ''));
t('…a second proof is refused (the first is the record)', (await upload(`/payment-run/runs/${run.id}/lines/${lineFor(exp)}/proof`, T['pd-ctl'], 'again.pdf', 'application/pdf', '%PDF-1.4 x')).status === 409);
r = await call('GET', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/proof`, null, T['pd-boss']);
t('…and can be opened again', r.status === 200 && !!r.json?.url && r.json.name === 'ach-confirmation.pdf');
r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/qbo`, { qbo_payment_id: 'BP-4401' }, T['pd-ctl']);
t('marked paid in QBO: the bill is done', r.json?.lines?.find(l => l.drop_id === exp)?.state === 'done');

r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(mat)}/paid`, { method: 'debit_card', reference: 'Billtrust 88', qbo_payment_id: 'BP-4402' }, T['pd-ctl']);
t('Gamma is paid by debit card with its QBO number in one go', r.json?.lines?.find(l => l.drop_id === mat)?.missing?.join() === 'proof of payment');
await upload(`/payment-run/runs/${run.id}/lines/${lineFor(mat)}/proof`, T['pd-ctl'], 'receipt.png', 'image/png', '\x89PNG card receipt');

r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(ptn)}/paid`, { method: 'qbo_ach', reference: 'ACH-2' }, T['pd-ctl']);
t('a partner bill is paid by its settlement on Partner Reconciliation, not here', r.status === 409 && r.json?.code === 'SETTLE_ON_PARTNER_REC', JSON.stringify(r.json));

console.log('\n── sending a bill back');
t('sending back needs a reason', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(back)}/send-back`, { reason: 'no' }, T['pd-ctl'])).status === 400);
r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(back)}/send-back`, { reason: 'Vendor asked us to hold until the credit note' }, T['pd-ctl']);
t('Kappa is sent back', r.json?.lines?.find(l => l.drop_id === back)?.state === 'sent_back');
t('…the bill is back in QBO, off this run, for next week', (() => { const d = q('SELECT status, payment_run_id FROM ap_drops WHERE id = ?', back)[0]; return d?.status === 'in_qbo' && d.payment_run_id == null; })());
r = await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(ptn)}/send-back`, { reason: 'Settled on Partner Reconciliation instead' }, T['pd-ctl']);
t('the partner bill is sent back too', r.status === 200);

console.log('\n── 3 & 4. the deposit invoice and the shortfall');
r = await call('POST', `/payment-run/runs/${run.id}/close`, {}, T['pd-ctl']);
t('closing is refused while things are open, naming them', r.status === 409 && r.json?.code === 'RUN_NOT_FINISHED'
  && r.json.open.some(o => o.key === 'deposit_invoice') && r.json.open.some(o => o.key === 'shortfall'), JSON.stringify(r.json?.open));
t('the deposit invoice needs its QBO number', (await call('POST', `/payment-run/runs/${run.id}/deposit-invoice`, {}, T['pd-ctl'])).status === 400);
r = await call('POST', `/payment-run/runs/${run.id}/deposit-invoice`, { qbo_invoice_no: 'INV-2207' }, T['pd-ctl']);
t('the deposit invoice is recorded', r.json?.deposit?.qbo_invoice_no === 'INV-2207');
t('…marking it paid again is refused (the transfer paid it)', (await call('POST', `/payment-run/runs/${run.id}/deposit-paid`, {}, T['pd-ctl'])).status === 409);
t('the shortfall needs a note', (await call('POST', `/payment-run/runs/${run.id}/shortfall`, { note: 'x' }, T['pd-ctl'])).status === 400);
r = await call('POST', `/payment-run/runs/${run.id}/shortfall`, { note: 'Booked on the Deposit invoice INV-2207 as a second line' }, T['pd-ctl']);
t('the shortfall is booked', r.json?.shortfall?.note?.startsWith('Booked'));
t('with every bill paid or sent back, nothing is left open', r.json?.open?.length === 0 && r.json.can_close === true, JSON.stringify(r.json?.open));

console.log('\n── closing');
r = await call('POST', `/payment-run/runs/${run.id}/close`, {}, T['pd-ctl']);
t('the Controller closes the run', r.status === 200 && r.json?.closed === true && r.json.closed_by === 'Cora Controller');
t('…a closed run takes no more changes', (await call('POST', `/payment-run/runs/${run.id}/lines/${lineFor(exp)}/qbo`, { qbo_payment_id: 'x' }, T['pd-ctl'])).status === 409);
t('…the deposit is waiting for the final production bill (part E)', q('SELECT applied_to, paid_at FROM prodough_deposits WHERE run_id = ?', run.id).every(d => d.paid_at && d.applied_to == null));
t('…every step is on the run\'s log', ['received', 'paid', 'proof', 'qbo_marked', 'sent_back', 'deposit_invoice', 'shortfall_booked', 'closed']
  .every(k => q('SELECT 1 FROM payment_run_events WHERE run_id = ? AND kind = ?', run.id, k).length));
t('…and in the audit log', q("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'payment_run' AND entity_id = ? AND action LIKE 'payment_run_%'", run.id)[0].n >= 8
  || q("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'payment_run' AND entity_id = ?", run.id)[0].n >= 8);

console.log('\n── manual mode, and kept for good');
t('the deposit mode is an admin setting with two choices', (await call('PUT', '/payment-run/settings', { deposit_payment: 'sometimes' }, T['pd-boss'])).status === 400
  && (await call('PUT', '/payment-run/settings', { deposit_payment: 'manual' }, T['pd-boss'])).status === 200);
const k = new Database(DBP);
const refuses = (sql) => { try { k.prepare(sql).run(); return false; } catch { return true; } };
t('a payment record cannot be deleted', refuses('DELETE FROM payment_run_payments'));
t('a deposit record cannot be deleted', refuses('DELETE FROM prodough_deposits'));
k.close();

console.log('\n── the weekly task');
const { closeoutDigest } = await import('../server/payment-closeout.js');
const { getDb } = await import('../server/db.js');
const sent = [];
const deps = { botDm: (_d, uid) => ({ bot: { id: 'bot' }, dm: { id: `dm-${uid}` } }), postMessageAs: async (_d, dm, _b, body) => { sent.push({ to: dm.id, body }); }, pushToUser: () => Promise.resolve() };
const dig = await closeoutDigest(getDb(), deps);
t('with every run closed, the weekly task says nothing', !sent.length, JSON.stringify(dig));

console.log('\n── the page');
const r2 = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [back], reason: 'Page check' }, T['pd-boss']);
await call('POST', `/payment-run/runs/${r2.json.id}/bank-balance`, { amount: 0 }, T['pd-boss']);
const tok2 = (await call('POST', `/payment-run/runs/${r2.json.id}/send`, {}, T['pd-boss'])).json?.link?.split('/pay/')[1];
await call('POST', `/payment-approval/${tok2}/approve`, { name: 'Danny A' });
await call('POST', `/payment-approval/${tok2}/transferred`, { name: 'Danny A', amount: 300 });
sent.length = 0;
await closeoutDigest(getDb(), deps);
t('an open run is in the weekly task, to Lowry and the Controller', sent.some(s => s.to === 'dm-pd-ctl') && sent.some(s => /Confirm/.test(s.body)), JSON.stringify(sent).slice(0, 300));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [wd, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: wd, height: h } });
  const me = (await call('GET', '/users/me', null, T['pd-ctl'])).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([kk, u]) => { localStorage.setItem('auth_token', kk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['pd-ctl'], me]);
  await page.goto(`${URL}/?tab=payment-run`);
  await page.waitForSelector('[data-closeout]', { timeout: 15000 }).catch(() => {});
  t(`${wd}px: the close-out shows on the transferred run`, await page.locator('[data-closeout]').count() >= 1);
  t(`${wd}px: it offers "It landed" (or, once confirmed, the bills to pay)`, await page.locator('[data-closeout-received], [data-pay-open]').count() >= 1);
  t(`${wd}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (wd === 1280) {
    await page.fill('[data-closeout-amount]', '300').catch(() => {});
    await page.click('[data-closeout-received]').catch(() => {});
    await page.waitForSelector('[data-pay-open]', { timeout: 10000 }).catch(() => {});
    t('1280px: confirming by clicking turns the section to paying the bills', await page.locator('[data-pay-open]').count() >= 1);
  }
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
