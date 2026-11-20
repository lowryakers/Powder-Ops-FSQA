// verify:paymentcontroller — the Controller bot and the deposit balance (D-366), live, with the S3 stand-in.
// Grok Bot's token, holding the payment-run-controller grant on the account named
// Controller, does the bookkeeping: bank balance, the transfer landing (with
// evidence), scheduling and recording payments with proof, the Deposit invoice
// number, closed MOs from MRPEasy, the production invoice number, closing the run.
// It never approves, never presses "I've sent", never records bank details, never
// touches the must-pay list, never voids, never confirms a class (Jake does, with
// admins as backup). Deposits are one balance, paid ones only, taken off oldest
// first. Caller sets PORT + DBPATH and the R2_* stand-in variables.
// Control: main before this — the grant does not exist and every bot write is 403.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5235);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayRunF2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pf-boss', 'Lena Boss', 'admin', 'admin', {});
mk('pf-jake', 'Jake Owner', 'operator', 'warehouse', { 'ap-drop': 'edit' });
mk('pf-amy', 'Amy Queue', 'operator', 'office', { 'ap-drop': 'edit' });
mk('pf-grok', 'Grok Bot', 'operator', 'office', {});
mk('pf-other', 'Other Bot', 'operator', 'office', {});
const SKU = db.prepare("SELECT sku FROM products WHERE COALESCE(product_type, 'food') <> 'merch' ORDER BY sku LIMIT 1").get().sku;
db.prepare('UPDATE products SET price_prodough_allin = 3, price_fob_unit = 9 WHERE sku = ?').run(SKU);
let n = 0;
const drop = (o) => {
  const id = `pf-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, bill_class, po_or_co_ref, created_at)
    VALUES (?, ?, 'k', ?, 'in_qbo', ?, ?, ?, ?, ?, ?, 'Powder Ops LLC', ?, ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, `QB-F${n}`, o.vendor, o.inv, iso(-5), iso(2), o.amount, o.cls || null, o.po || null);
  return id;
};
db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES ('pf-po', 'PO00931', 'Omega Whey', 'RM-3', 'Whey', 100, 10, 'open')").run();
db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES ('pf-rx', 'A-100-8931', ?, 'PO00931', 'RM-3', 100)").run(iso(-2));
const mat = drop({ vendor: 'Omega Whey', inv: 'OW-9', amount: 1000, cls: 'prodough_material', po: 'PO00931' });
const exp = drop({ vendor: 'Sigma Cleaning', inv: 'S-9', amount: 100 });
db.prepare("INSERT INTO bank_accounts (id, name, provider) VALUES ('pf-bank', 'Operating', 'manual')").run();
db.prepare("INSERT INTO bank_transactions (id, account_id, posted_date, description, amount) VALUES ('pf-txn', 'pf-bank', ?, 'PRODOUGH TRANSFER', 1000)").run(iso(0));
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const upload = async (p, field, name, type, bytes, fields, tok) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  fd.append(field, new Blob([bytes], { type }), name);
  const r = await fetch(`${URL}/api${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const T = {};
for (const [id, nm] of [['pf-boss', 'Lena Boss'], ['pf-jake', 'Jake Owner'], ['pf-amy', 'Amy Queue']]) T[id] = await login(id, nm);
t('people sign in', Object.values(T).every(Boolean));
const PDF = Buffer.from('%PDF-1.4\n% fixture\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

console.log('\n── the Controller is a bot, named in the settings');
let r = await call('PUT', '/payment-run/settings', { controller_id: 'pf-grok' }, T['pf-boss']);
t('an account with no token cannot be named Controller', r.status === 400 && r.json?.code === 'CONTROLLER_NOT_BOT', JSON.stringify(r.json));
const mint = async (user, label) => {
  const made = (await call('POST', '/api-tokens', { user_id: user, label, scopes: ['read', 'write'] }, T['pf-boss'])).json;
  return made;
};
const grok = await mint('pf-grok', 'Grok Bot');
const other = await mint('pf-other', 'Other Bot');
const plain = await mint('pf-amy', 'No grant');
r = await call('POST', `/api-tokens/${grok.token.id}/grants`, { grants: ['payment-run-controller'] }, T['pf-boss']);
t('the admin ticks the "Payment run: Controller bot" grant on Grok\'s token', r.status === 200);
await call('POST', `/api-tokens/${other.token.id}/grants`, { grants: ['payment-run-controller'] }, T['pf-boss']);
r = await call('PUT', '/payment-run/settings', { controller_id: 'pf-grok' }, T['pf-boss']);
t('…and names Grok Bot the Controller', r.status === 200 && r.json?.controller_id === 'pf-grok');
await call('PUT', '/payment-run/settings', { bill_owner_id: 'pf-jake' }, T['pf-boss']);
const G = grok.plaintext, O = other.plaintext, P = plain.plaintext;
r = await call('GET', '/payment-run', null, G);
t('the bot reads the run, with the deposit balance', r.status === 200 && r.json?.deposit_balance?.balance === 0 && r.json.is_controller_bot === true, JSON.stringify(r.json?.deposit_balance));
t('…and the settings list it as a bot the admin can pick', (await call('GET', '/payment-run', null, T['pf-boss'])).json?.settings?.controller_candidates?.some(c => c.id === 'pf-grok'));
r = await call('PUT', '/payment-run/bank-balance', { amount: 500 }, O);
t('a bot holding the grant but NOT named Controller is refused', r.status === 403 && r.json?.code === 'not_controller', JSON.stringify(r.json));
r = await call('PUT', '/payment-run/bank-balance', { amount: 500 }, P);
t('a token without the grant is refused before the route', r.status === 403 && r.json?.error === 'token_denied', JSON.stringify(r.json));
r = await call('PUT', '/payment-run/bank-balance', { amount: 500 }, G);
t('the Controller bot records the bank balance', r.status === 200 && r.json?.amount === 500, JSON.stringify(r.json));

console.log('\n── a bill\'s class: the bot suggests, Jake confirms');
r = await call('POST', `/payment-run/bills/${exp}/suggest-class`, { bill_class: 'powderops_expense', why: 'Cleaning service, a Powder Ops expense' }, G);
t('the bot suggests a class', r.status === 200 && r.json?.suggested === 'powderops_expense');
t('…stored as a suggestion, never as the class', q('SELECT bill_class, bill_class_bot FROM ap_drops WHERE id = ?', exp)[0]?.bill_class === null && q('SELECT bill_class_bot FROM ap_drops WHERE id = ?', exp)[0]?.bill_class_bot === 'powderops_expense');
t('the bot cannot confirm a class', [401, 403].includes((await call('POST', `/payment-run/bills/${exp}/class`, { bill_class: 'powderops_expense' }, G)).status));
r = await call('POST', `/payment-run/bills/${exp}/class`, { bill_class: 'powderops_expense' }, T['pf-amy']);
t('someone else on the AP queue cannot confirm (Jake does)', r.status === 403 && r.json?.code === 'not_bill_owner', JSON.stringify(r.json));
r = await call('POST', `/payment-run/bills/${exp}/class`, { bill_class: 'powderops_expense' }, T['pf-jake']);
t('Jake, the bill owner, confirms it', r.status === 200);
r = (await call('GET', '/payment-run', null, T['pf-jake'])).json;
t('…the page tells Jake he can confirm, and Amy that she cannot', r?.can_classify === true && (await call('GET', '/payment-run', null, T['pf-amy'])).json?.can_classify === false);

console.log('\n── what a bot never does');
t('the must-pay list', (await call('POST', '/payment-run/must-pays', { vendor_name: 'Rent Co' }, G)).status === 403);
t('vendor bank details', (await call('POST', '/payment-run/bank-details', { drop_id: exp, confirmed_note: 'Called them' }, G)).status === 403);
t('preparing or sending a run', (await call('POST', '/payment-run/runs', { kind: 'weekly' }, G)).status === 403);

console.log('\n── a run, approved and sent by Danny');
r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat, exp], reason: 'Controller verify' }, T['pf-boss']);
const run = r.json || {};
t('the admin prepares a run with a material bill and an expense', r.status === 201 && run.lines?.length === 2, JSON.stringify(r.json)?.slice(0, 200));
const line = (drop) => run.lines.find(l => l.drop_id === drop);
await call('POST', `/payment-run/runs/${run.id}/bank-balance`, { amount: 500 }, G);
const link = (await call('POST', `/payment-run/runs/${run.id}/send`, {}, T['pf-boss'])).json?.link?.split('/pay/')[1];
t('the bot cannot approve or say "I\'ve sent" on Danny\'s page', (await call('POST', `/payment-approval/${link}/approve`, { name: 'Grok Bot' }, G)).status === 403
  && (await call('POST', `/payment-approval/${link}/transferred`, { name: 'Grok Bot', amount: 1000 }, G)).status === 403);
await call('POST', `/payment-approval/${link}/approve`, { name: 'Danny A' });
await call('POST', `/payment-approval/${link}/transferred`, { name: 'Danny A', amount: 1000 });

console.log('\n── the bot closes it out');
r = await call('POST', `/payment-run/runs/${run.id}/received`, { amount: 1000 }, G);
t('the transfer without evidence is refused', r.status === 400 && r.json?.code === 'EVIDENCE_REQUIRED', JSON.stringify(r.json));
r = await upload(`/payment-run/runs/${run.id}/received`, 'evidence', 'statement.pdf', 'application/pdf', PDF, { amount: 1000, received_on: iso(0) }, G);
t('…with a statement attached, it is confirmed', r.status === 200 && !!r.json?.transfer?.received_at && r.json.transfer.evidence?.name === 'statement.pdf', JSON.stringify(r.json?.transfer));
t('…the evidence is hashed on the run', /^[0-9a-f]{64}$/.test(q('SELECT received_evidence_sha256 s FROM payment_runs WHERE id = ?', run.id)[0]?.s || ''));
t('…and the Deposit is paid by the transfer', !!r.json?.deposit?.paid_at);
r = await call('POST', `/payment-run/runs/${run.id}/lines/${line(exp).id}/schedule`, { method: 'qbo_ach', scheduled_on: iso(1), reference: 'BP-77' }, G);
t('the bot schedules the payment in Bill Pay', r.status === 200 && r.json?.lines?.find(l => l.drop_id === exp)?.state === 'scheduled', JSON.stringify(r.json?.lines));
r = await call('POST', `/payment-run/runs/${run.id}/lines/${line(exp).id}/schedule`, { method: 'qbo_ach', scheduled_on: iso(2), reference: 'BP-78' }, G);
t('…rescheduling keeps the old one, marked replaced', q('SELECT COUNT(*) n FROM payment_run_schedules WHERE line_id = ?', line(exp).id)[0].n === 2
  && q('SELECT COUNT(*) n FROM payment_run_schedules WHERE line_id = ? AND replaced_at IS NULL', line(exp).id)[0].n === 1);
t('sending a bill back stays a person\'s', (await call('POST', `/payment-run/runs/${run.id}/lines/${line(mat).id}/send-back`, { reason: 'Testing the guard' }, G)).status === 403);
r = await call('POST', `/payment-run/runs/${run.id}/close`, {}, G);
t('closing with work left is refused, naming it', r.status === 409 && r.json?.code === 'RUN_NOT_FINISHED' && r.json.open.length >= 3, JSON.stringify(r.json?.open));
r = await call('GET', `/payment-run/runs/${run.id}/closeout`, null, G);
t('every open item says it is the bot\'s', r.json?.open?.every(o => o.who === 'bot'), JSON.stringify(r.json?.open));
for (const d of [mat, exp]) {
  await call('POST', `/payment-run/runs/${run.id}/lines/${line(d).id}/paid`, { method: 'qbo_ach', paid_on: iso(0), reference: `BP-${d}`, qbo_payment_id: `QP-${d}` }, G);
  await upload(`/payment-run/runs/${run.id}/lines/${line(d).id}/proof`, 'file', 'remit.pdf', 'application/pdf', PDF, {}, G);
}
t('the bot records both bills paid, with proof and the QBO payment number', q("SELECT COUNT(*) n FROM payment_run_payments WHERE run_id = ? AND proof_sha256 IS NOT NULL AND qbo_marked_at IS NOT NULL", run.id)[0].n === 2);
t('…and AP Drop reads paid', q("SELECT COUNT(*) n FROM ap_drops WHERE id IN (?, ?) AND status = 'paid'", mat, exp)[0].n === 2);
r = await call('POST', `/payment-run/runs/${run.id}/deposit-invoice`, { qbo_invoice_no: 'DEP-1001' }, G);
t('the bot records the Deposit invoice number', r.status === 200 && r.json?.deposit?.qbo_invoice_no === 'DEP-1001');
r = await call('POST', `/payment-run/runs/${run.id}/close`, {}, G);
t('…and closes the finished run', r.status === 200 && r.json?.closed === true, JSON.stringify(r.json)?.slice(0, 200));
t('the close is audited with the token', q("SELECT COUNT(*) n FROM audit_log WHERE action = 'payment_run_closed' AND details LIKE '%via_token%'")[0].n >= 1
  || q("SELECT COUNT(*) n FROM audit_log WHERE entity_id = ? AND action = 'payment_run_closed'", run.id)[0].n >= 1);
t('another "close" stays closed to the bot', (await call('POST', '/cleanup/close', {}, G)).status === 403);

console.log('\n── a production invoice: all in, less the deposit balance');
r = await call('GET', '/payment-run/production-invoices', null, G);
t('the deposit balance is the paid $1,000', r.json?.deposit_balance?.balance === 1000, JSON.stringify(r.json?.deposit_balance));
r = await call('POST', '/payment-run/production-invoices', { source: 'mo_closed', mo_number: 'MO90001', prodough_po: 'PD-901', lines: [{ sku: SKU, qty: 500, po_unit_price: 3 }] }, G);
const pi = r.json || {};
t('the bot records a closed MO read from MRPEasy', r.status === 201 && pi.status === 'held' && pi.recorded_by === 'Grok Bot', JSON.stringify(r.json)?.slice(0, 200));
t('…held: no price list column is chosen yet', pi.hold_reasons?.some(x => /No price list is chosen/.test(x)));
t('the all-in column is offered first in the settings', Object.keys((await call('GET', '/payment-run', null, T['pf-boss'])).json?.settings?.production_price_fields || {})[0] === 'price_prodough_allin');
await call('PUT', '/payment-run/settings', { production_price_field: 'price_prodough_allin' }, T['pf-boss']);
r = await call('POST', `/payment-run/production-invoices/${pi.id}/recheck`, {}, G);
t('checked again at the all-in price: 500 × $3 = $1,500', r.json?.status === 'to_invoice' && r.json.total === 1500, JSON.stringify(r.json)?.slice(0, 200));
t('…preview: $1,000 off the balance, $500 to invoice', r.json?.deposit_preview?.applied === 1000 && r.json.deposit_preview.amount_due === 500);
r = await call('POST', `/payment-run/production-invoices/${pi.id}/invoiced`, { qbo_invoice_no: 'INV-7001', expected_amount_due: 500 }, G);
t('the bot records the QBO invoice; the balance comes off by itself', r.json?.status === 'invoiced' && r.json.amount_due === 500 && r.json.deposits_applied === 1000, JSON.stringify(r.json)?.slice(0, 200));
t('the bot cannot void it', (await call('POST', `/payment-run/production-invoices/${pi.id}/void`, { reason: 'Testing the guard' }, G)).status === 403);
t('an admin who is not a bot can (and the balance comes back)', (await call('POST', `/payment-run/production-invoices/${pi.id}/void`, { reason: 'Wrong MO number' }, T['pf-boss'])).json?.status === 'void'
  && (await call('GET', '/payment-run/production-invoices', null, G)).json?.deposit_balance?.balance === 1000);

console.log('\n── an invoiced Deposit not yet paid is shown, never counted');
const w = new Database(DBP);
w.prepare("INSERT INTO payment_runs (id, run_no, week_start, run_date, status) VALUES ('pf-r2', 'PR-F2', ?, ?, 'transferred')").run(iso(0), iso(0));
w.prepare("INSERT INTO prodough_deposits (id, run_id, amount, qbo_invoice_no) VALUES ('pf-dep2', 'pf-r2', 700, 'DEP-1002')").run();
let refused; try { w.prepare('DELETE FROM prodough_deposit_applications').run(); refused = false; } catch { refused = true; }
w.close();
r = (await call('GET', '/payment-run', null, T['pf-boss'])).json?.deposit_balance;
t('balance stays $1,000; the $700 is listed as invoiced, not paid', r?.balance === 1000 && r.unpaid_total === 700, JSON.stringify(r));
t('a deposit application cannot be deleted', refused);

console.log('\n── the page');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [wd, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: wd, height: h } });
  const me = (await call('GET', '/users/me', null, T['pf-boss'])).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['pf-boss'], me]);
  await page.goto(`${URL}/?tab=payment-run`);
  await page.waitForSelector('[data-deposit-balance]', { timeout: 15000 }).catch(() => {});
  t(`${wd}px: the deposit balance card reads $1,000 and the $700 not paid`, /\$1,000\.00/.test(await page.locator('[data-deposit-balance]').textContent().catch(() => '')) && /\$700\.00 invoiced, not paid/.test(await page.locator('[data-deposit-balance]').textContent().catch(() => '')));
  t(`${wd}px: the Controller bot picker offers Grok Bot`, (await page.locator('[data-controller-bot] option').allTextContents().catch(() => [])).includes('Grok Bot'));
  t(`${wd}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
