// verify:productioninvoices — the payment run, part E (D-365), live.
// A closed MO or shipped order is recorded; it is HELD (no PO, no price list
// chosen, an unknown SKU, a PO price that differs from the list) or READY. One
// invoice per ProDough PO, folded. The Controller records the QBO invoice with
// the paid Deposits taken off (whole, once; never more than the total); what is
// still owed rides Danny's next run and his confirmed transfer pays it. A void
// frees the PO and the deposits; nothing is deleted. Caller sets PORT + DBPATH.
// Control: main before this — /payment-run/production-invoices is 404.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5234);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayRunE2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pe-boss', 'Petra Boss', 'admin', 'admin', {});
mk('pe-ctl', 'Carl Controller', 'operator', 'office', { 'ap-drop': 'edit' });
mk('pe-jake', 'Jim Buyer', 'operator', 'warehouse', { 'ap-drop': 'edit' });
const skus = db.prepare("SELECT sku FROM products WHERE COALESCE(product_type, 'food') <> 'merch' ORDER BY sku LIMIT 2").all().map(r => r.sku);
const [SKU_A, SKU_B] = skus;
db.prepare('UPDATE products SET price_fob_unit = 2.5, price_wholesale_unit = 3.1 WHERE sku = ?').run(SKU_A);
db.prepare('UPDATE products SET price_fob_unit = NULL, price_wholesale_unit = NULL WHERE sku = ?').run(SKU_B);
let n = 0;
const drop = (o) => {
  const id = `pe-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, bill_class, po_or_co_ref, created_at)
    VALUES (?, ?, 'k', ?, 'in_qbo', ?, ?, ?, ?, ?, ?, 'Powder Ops LLC', ?, ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, `QB-E${n}`, o.vendor, o.inv, iso(-5), iso(2), o.amount, o.cls, o.po || null);
  return id;
};
db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES ('pe-po', 'PO00921', 'Omega Whey', 'RM-2', 'Whey', 100, 10, 'open')").run();
db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES ('pe-rx', 'A-100-8921', ?, 'PO00921', 'RM-2', 100)").run(iso(-2));
const mat = drop({ vendor: 'Omega Whey', inv: 'OW-1', amount: 1000, cls: 'prodough_material', po: 'PO00921' });
const exp1 = drop({ vendor: 'Sigma Cleaning', inv: 'S-1', amount: 100, cls: 'powderops_expense' });
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
const T = {};
for (const [id, nm] of [['pe-boss', 'Petra Boss'], ['pe-ctl', 'Carl Controller'], ['pe-jake', 'Jim Buyer']]) T[id] = await login(id, nm);
t('everyone signs in, and two catalog SKUs are on hand', Object.values(T).every(Boolean) && skus.length === 2);
await call('PUT', '/payment-run/settings', { controller_id: 'pe-ctl' }, T['pe-boss']);
const PI = '/payment-run/production-invoices';
const rec = (body, who = 'pe-jake') => call('POST', PI, body, T[who]);

console.log('\n── recording, and what holds an order');
let r = await rec({ source: 'mo_closed', mo_number: 'MO80001', prodough_po: 'PD-501', lines: [{ sku: SKU_A, qty: 1000, po_unit_price: 2.5 }] });
const a = r.json || {};
t('Jake records a closed MO', r.status === 201 && /^PI-\d{4}$/.test(a.ref_no || ''), JSON.stringify(r.json)?.slice(0, 200));
t('…held: no price list is chosen yet, and it says so', a.status === 'held' && a.hold_reasons?.some(x => /No price list is chosen/.test(x)), JSON.stringify(a.hold_reasons));
t('only an admin chooses the price list, and only a unit price', (await call('PUT', '/payment-run/settings', { production_price_field: 'price_fob_unit' }, T['pe-jake'])).status === 403
  && (await call('PUT', '/payment-run/settings', { production_price_field: 'price_srp' }, T['pe-boss'])).status === 400);
t('the admin picks the FOB unit price', (await call('PUT', '/payment-run/settings', { production_price_field: 'price_fob_unit' }, T['pe-boss'])).json?.production_price_field === 'price_fob_unit');
r = await call('POST', `${PI}/${a.id}/recheck`, {}, T['pe-jake']);
t('"check again" reads the price list: ready to invoice, 1,000 × $2.50 = $2,500', r.json?.status === 'to_invoice' && r.json.total === 2500 && r.json.lines[0].unit_price === 2.5, JSON.stringify(r.json)?.slice(0, 300));
r = await rec({ source: 'mo_closed', mo_number: 'MO80002', prodough_po: ' pd 501 ', lines: [{ sku: SKU_A, qty: 10, po_unit_price: 2.5 }] });
t('the same ProDough PO written another way is refused, naming the first', r.status === 409 && r.json?.code === 'PO_ALREADY_INVOICED' && r.json.existing === a.ref_no, JSON.stringify(r.json));
r = await rec({ source: 'mo_closed', mo_number: 'MO80003', lines: [{ sku: SKU_A, qty: 10, po_unit_price: 2.5 }] });
const noPo = r.json || {};
t('no PO: held, not invoiced', noPo.status === 'held' && noPo.hold_reasons.some(x => /No ProDough PO/.test(x)));
r = await rec({ source: 'order_shipped', order_ref: 'SO-77', prodough_po: 'PD-502', lines: [{ sku: SKU_A, qty: 200, po_unit_price: 2.4 }, { sku: SKU_B, qty: 5, po_unit_price: 1 }, { sku: 'NOPE-XXX', qty: 1, po_unit_price: 1 }] });
const b = r.json || {};
t('a shipped order with three problems: held, each named', b.status === 'held' && b.total === null
  && b.hold_reasons.some(x => x.includes('$2.40') && x.includes('$2.50')) && b.hold_reasons.some(x => x.includes(SKU_B) && /no fob unit price/i.test(x))
  && b.hold_reasons.some(x => /NOPE-XXX is not in the product catalog/.test(x)), JSON.stringify(b.hold_reasons));
r = await call('POST', `${PI}/${b.id}/recheck`, { lines: [{ sku: SKU_A, qty: 200, po_unit_price: 2.5 }] }, T['pe-jake']);
t('corrected lines: ready, $500', r.json?.status === 'to_invoice' && r.json.total === 500, JSON.stringify(r.json)?.slice(0, 200));
t('the date cannot be in the future', (await rec({ source: 'mo_closed', mo_number: 'MO8', prodough_po: 'PD-9', event_date: iso(4), lines: [] })).status === 400);
t('an MO closure needs its MO number', (await rec({ source: 'mo_closed', prodough_po: 'PD-10', lines: [] })).status === 400);

console.log('\n── a Deposit to take off (run 1: materials, transfer confirmed)');
r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat], reason: 'Deposit' }, T['pe-boss']);
const run1 = r.json || {};
await call('POST', `/payment-run/runs/${run1.id}/bank-balance`, { amount: 0 }, T['pe-boss']);
let link = (await call('POST', `/payment-run/runs/${run1.id}/send`, {}, T['pe-boss'])).json?.link?.split('/pay/')[1];
await call('POST', `/payment-approval/${link}/approve`, { name: 'Danny A' });
await call('POST', `/payment-approval/${link}/transferred`, { name: 'Danny A', amount: 1000 });
r = await call('POST', `/payment-run/runs/${run1.id}/received`, { amount: 1000 }, T['pe-ctl']);
t('run 1 has no production on it and its $1,000 deposit is paid by the transfer', r.json?.production?.length === 0 && r.json.deposit?.paid_from === 'transfer', JSON.stringify(r.json?.deposit));
const list = (await call('GET', PI, null, T['pe-ctl'])).json || {};
const dep = list.open_deposits?.[0];
t('the deposit is offered to take off a production invoice', list.open_deposits?.length === 1 && dep.amount === 1000 && list.can_invoice === true);

console.log('\n── the Controller creates them in QBO');
t('Jake cannot record the QBO invoice', (await call('POST', `${PI}/${a.id}/invoiced`, { qbo_invoice_no: 'INV-9001' }, T['pe-jake'])).status === 403);
r = await call('POST', `${PI}/${b.id}/invoiced`, { qbo_invoice_no: 'INV-9002', deposit_ids: [dep.id] }, T['pe-ctl']);
t('more deposits than the invoice total is refused', r.status === 400 && r.json?.code === 'DEPOSITS_EXCEED_TOTAL', JSON.stringify(r.json));
t('a held order cannot be invoiced', (await call('POST', `${PI}/${noPo.id}/invoiced`, { qbo_invoice_no: 'X' }, T['pe-ctl'])).status === 409);
r = await call('POST', `${PI}/${a.id}/invoiced`, { qbo_invoice_no: 'INV-9001', deposit_ids: [dep.id] }, T['pe-ctl']);
t('PI A: $2,500 less the $1,000 deposit = $1,500 owed', r.json?.status === 'invoiced' && r.json.deposits_applied === 1000 && r.json.amount_due === 1500, JSON.stringify(r.json)?.slice(0, 300));
t('…the deposit is stamped as taken off it', q('SELECT applied_to FROM prodough_deposits WHERE id = ?', dep.id)[0]?.applied_to === a.id);
r = await call('POST', `${PI}/${b.id}/invoiced`, { qbo_invoice_no: 'INV-9002', deposit_ids: [dep.id] }, T['pe-ctl']);
t('the same deposit cannot come off twice', r.status === 409 && r.json?.code === 'DEPOSIT_NOT_OPEN');

console.log('\n── a void frees the PO and the deposit');
t('a void needs a reason', (await call('POST', `${PI}/${a.id}/void`, { reason: 'x' }, T['pe-ctl'])).status === 400);
r = await call('POST', `${PI}/${a.id}/void`, { reason: 'Wrong quantity on the MO' }, T['pe-ctl']);
t('PI A is void, kept with its reason', r.json?.status === 'void' && r.json.void_reason === 'Wrong quantity on the MO');
t('…its deposit is free again', q('SELECT applied_to FROM prodough_deposits WHERE id = ?', dep.id)[0]?.applied_to === null);
r = await rec({ source: 'mo_closed', mo_number: 'MO80001', prodough_po: 'PD-501', lines: [{ sku: SKU_A, qty: 800, po_unit_price: 2.5 }] }, 'pe-ctl');
const a2 = r.json || {};
t('the PO can be invoiced again: ready, $2,000', a2.status === 'to_invoice' && a2.total === 2000, JSON.stringify(r.json)?.slice(0, 200));
r = await call('POST', `${PI}/${a2.id}/invoiced`, { qbo_invoice_no: 'INV-9003', deposit_ids: [dep.id] }, T['pe-ctl']);
t('PI A2: $2,000 less $1,000 = $1,000 owed', r.json?.amount_due === 1000);
r = await call('POST', `${PI}/${b.id}/invoiced`, { qbo_invoice_no: 'INV-9002', deposit_ids: [] }, T['pe-ctl']);
t('PI B with no deposit: $500 owed', r.json?.amount_due === 500);

console.log('\n── what is owed rides Danny\'s next run, and his transfer pays it');
r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [exp1], reason: 'Production' }, T['pe-boss']);
const run2 = r.json || {};
t('run 2 carries both production invoices: $1,500', run2.production?.length === 2 && run2.summary?.production === 1500 && run2.summary.production_count === 2, JSON.stringify(run2.summary));
t('…in the sentence Danny reads', /2 production runs \$1,500\.00/.test(run2.sentence || ''), run2.sentence);
t('an invoice on a live run cannot be voided', (await call('POST', `${PI}/${b.id}/void`, { reason: 'Testing the guard' }, T['pe-ctl'])).status === 409);
await call('POST', `/payment-run/runs/${run2.id}/bank-balance`, { amount: 100 }, T['pe-boss']);
link = (await call('POST', `/payment-run/runs/${run2.id}/send`, {}, T['pe-boss'])).json?.link?.split('/pay/')[1];
await call('POST', `/payment-approval/${link}/approve`, { name: 'Danny A' });
await call('POST', `/payment-approval/${link}/transferred`, { name: 'Danny A', amount: 1500 });
r = await call('GET', `/payment-run/runs/${run2.id}/closeout`, null, T['pe-ctl']);
t('before the money lands, both are open on the close-out', r.json?.open?.filter(o => o.key.startsWith('production:')).length === 2, JSON.stringify(r.json?.open));
r = await call('POST', `/payment-run/runs/${run2.id}/received`, { amount: 1500 }, T['pe-ctl']);
t('the confirmed transfer pays both (transfer mode)', r.json?.production?.every(p => p.paid && p.paid_from === 'transfer') && !r.json.open.some(o => o.key.startsWith('production:')), JSON.stringify(r.json?.production));
t('…and the invoices read paid', q("SELECT COUNT(*) n FROM production_invoices WHERE status = 'paid' AND paid_run_id = ?", run2.id)[0].n === 2);
t('marking one paid again is refused', (await call('POST', `/payment-run/runs/${run2.id}/production/${b.id}/paid`, {}, T['pe-ctl'])).status === 409);
t('a paid invoice is not on the next run', (await call('GET', PI, null, T['pe-ctl'])).json?.invoices?.find(i => i.id === b.id)?.status === 'paid');

console.log('\n── people, not bots; kept for good');
const minted = (await call('POST', '/api-tokens', { user_id: 'pe-jake', label: 'Verify bot E', scopes: ['read', 'write'] }, T['pe-boss'])).json?.plaintext;
t('a bot token cannot record an order', !!minted && [401, 403].includes((await call('POST', PI, { source: 'mo_closed', mo_number: 'MO9', prodough_po: 'PD-9', lines: [] }, minted)).status));
const w = new Database(DBP);
let refused; try { w.prepare('DELETE FROM production_invoices').run(); refused = false; } catch { refused = true; }
w.close();
t('a production invoice cannot be deleted', refused);

console.log('\n── the page');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [wd, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: wd, height: h } });
  const me = (await call('GET', '/users/me', null, T['pe-ctl'])).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['pe-ctl'], me]);
  await page.goto(`${URL}/?tab=payment-run`);
  await page.waitForSelector('[data-production-invoices]', { timeout: 15000 }).catch(() => {});
  t(`${wd}px: the production invoices are listed`, await page.locator('[data-pi-row]').count() >= 4);
  t(`${wd}px: the held order says why`, (await page.locator('[data-pi-row="held"] [data-pi-reasons]').first().textContent().catch(() => '')).includes('No ProDough PO'));
  t(`${wd}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (wd === 1280) {
    await page.click('[data-pi-add]');
    await page.fill('[data-pi-mo]', 'MO80099');
    await page.fill('[data-pi-po]', 'PD-599');
    await page.fill('[data-pi-sku]', SKU_A);
    await page.fill('[data-pi-qty]', '4');
    await page.fill('[data-pi-price]', '2.5');
    await page.click('[data-pi-save]');
    await page.waitForSelector('[data-pi-row="to_invoice"]', { timeout: 10000 }).catch(() => {});
    t('1280px: recording by typing gives an order ready to create in QBO', await page.locator('[data-pi-row="to_invoice"] [data-pi-invoice]').count() === 1);
  }
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
