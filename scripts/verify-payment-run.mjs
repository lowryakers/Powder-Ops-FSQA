// verify:paymentrun — the weekly payment run page (D-360, PR A), live.
// Bills in QuickBooks are checked and placed: on the run (must-pays locked
// first, highlighted next), kept off the run with the reason, or not due yet.
// A person confirms each bill's class; the must-pay list is Lowry's; a failure
// is reported once. Caller sets PORT + DBPATH.
// Control: main before this — /api/payment-run is 404 and nothing after holds.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5228);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayRun2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pr-boss', 'Paula Boss', 'admin', 'admin', {});
mk('pr-jake', 'Jay Buyer', 'operator', 'warehouse', { 'ap-drop': 'edit' });
mk('pr-op', 'Otto Floor', 'operator', 'filling', { operator: 'view', 'ap-drop': 'view' });
let n = 0;
const drop = (o) => {
  const id = `pr-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, po_or_co_ref, bill_class, created_at)
    VALUES (?, ?, 'k', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, o.status || 'in_qbo', o.qbo === undefined ? `QB-${n}` : o.qbo, o.vendor, o.inv, o.invDate || iso(-5), o.due ?? iso(3), o.amount, o.to ?? 'Powder Ops LLC', o.po || null, o.cls || null);
  return id;
};
const po = (num, vendor, qty, price, received = false) => {
  db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')")
    .run(`pr-po-${num}-${Math.random()}`, num, vendor, 'RM-1', `${vendor} raw material`, qty, price);
  if (received) db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES (?, ?, ?, ?, 'RM-1', ?)")
    .run(`pr-rx-${num}`, `A-100-9${num.slice(-3)}`, iso(-2), num, qty);
};
po('PO00901', 'Acme Whey Co', 100, 10, true);      // $1,000, received
po('PO00902', 'Beta Packaging', 50, 20, false);    // $1,000, nothing received
po('PO00903', 'Crest Cocoa', 10, 100, true);       // $1,000, received
const ok = drop({ vendor: 'Acme Whey Co', inv: 'A-1', amount: 1000, po: 'PO 901', cls: 'prodough_material' });
const notRecv = drop({ vendor: 'Beta Packaging', inv: 'B-1', amount: 1000, po: 'PO00902', cls: 'prodough_material' });
const pricey = drop({ vendor: 'Crest Cocoa', inv: 'C-1', amount: 1250, po: 'PO00903', cls: 'prodough_material' });
const unclassed = drop({ vendor: 'Acme Whey Co', inv: 'A-2', amount: 1000, po: 'PO00901' });
const ctla = drop({ vendor: 'CTLA Labs', inv: 'L-77', amount: 640, cls: 'powderops_expense' });
const prodough = drop({ vendor: 'Delta Supplies', inv: 'D-1', amount: 80, cls: 'powderops_expense', to: 'ProDough Inc' });
const dupe1 = drop({ vendor: 'Echo Services', inv: 'INV-0042', amount: 300, cls: 'powderops_expense', status: 'paid' });
const dupe2 = drop({ vendor: 'Echo Services', inv: '42', amount: 300, cls: 'powderops_expense' });
const later = drop({ vendor: 'Acme Whey Co', inv: 'A-3', amount: 1000, po: 'PO00901', cls: 'prodough_material', due: iso(40) });
const notQbo = drop({ vendor: 'Acme Whey Co', inv: 'A-4', amount: 5, po: 'PO00901', cls: 'prodough_material', qbo: null });
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
for (const [id, nm] of [['pr-boss', 'Paula Boss'], ['pr-jake', 'Jay Buyer'], ['pr-op', 'Otto Floor']]) T[id] = await login(id, nm);
t('everyone signs in', Object.values(T).every(Boolean));

let r = await call('GET', '/payment-run', null, T['pr-op']);
t('someone without the AP queue cannot read the run', r.status === 403);
r = await call('POST', '/payment-run/must-pays', { vendor_name: 'CTLA Labs', label: 'Lab testing' }, T['pr-jake']);
t('only an admin edits the must-pay list', r.status === 403);
r = await call('POST', '/payment-run/must-pays', { vendor_name: 'CTLA', label: 'Lab testing' }, T['pr-boss']);
t('the admin adds CTLA to the must-pay list', r.status === 201);
t('…a second CTLA is refused', (await call('POST', '/payment-run/must-pays', { vendor_name: 'ctla' }, T['pr-boss'])).status === 409);

r = await call('GET', '/payment-run', null, T['pr-jake']);
const P = r.json || {};
const where = (id) => (P.on_run || []).some(l => l.id === id) ? 'on_run' : (P.failed || []).some(l => l.id === id) ? 'failed' : (P.held || []).some(l => l.id === id) ? 'held' : 'absent';
const line = (id) => [...(P.on_run || []), ...(P.failed || []), ...(P.held || [])].find(l => l.id === id);
t('Jake (the AP Drop edit grant) reads the run', r.status === 200 && !!P.run?.date);
t('a clean material bill is on the run', where(ok) === 'on_run');
t('the must-pay is locked FIRST, skipping PO and receiving', P.on_run?.[0]?.id === ctla && line(ctla)?.must_pay
  && line(ctla).checks.find(c => c.key === 'po')?.state === 'na', JSON.stringify(P.on_run?.map(l => l.vendor)));
t('a bill with nothing received is kept off, with the reason', where(notRecv) === 'failed'
  && /Nothing received against PO 902/.test(line(notRecv).failures.map(f => f.reason).join()), JSON.stringify(line(notRecv)?.failures));
t('25% above its PO is highlighted, and still on the run', where(pricey) === 'on_run' && line(pricey).highlight
  && /25\.0% above the PO/.test(line(pricey).flags.map(f => f.reason).join()));
t('highlighted bills come before plain ones', P.on_run.findIndex(l => l.id === pricey) < P.on_run.findIndex(l => l.id === ok));
t('an unclassified bill is off, with the suggestion from vendor history', where(unclassed) === 'failed'
  && line(unclassed).suggested_class?.value === 'prodough_material', JSON.stringify(line(unclassed)?.suggested_class));
t('a bill addressed to ProDough is flagged and highlighted', line(prodough)?.flags.some(f => /Addressed to ProDough/.test(f.reason) && f.severity === 'highlight'));
t('the same invoice number as a paid bill (INV-0042 = 42) is kept off', where(dupe2) === 'failed'
  && line(dupe2).failures.some(f => f.key === 'duplicate'));
t('a bill due after the following run waits', where(later) === 'held');
t('a bill not in QuickBooks is not listed, only counted', where(notQbo) === 'absent' && P.not_in_qbo >= 1);
t('totals split materials and expenses', P.totals?.materials === 2250 && P.totals?.expenses === 720 && P.totals?.must_pay === 640, JSON.stringify(P.totals));
t('the run is Thursday, or Friday noon in a payroll week', (P.run.payroll_week ? new Date(`${P.run.planned}T12:00:00Z`).getUTCDay() === 5 && P.run.time === '12:00'
  : new Date(`${P.run.planned}T12:00:00Z`).getUTCDay() === 4), JSON.stringify(P.run));

console.log('\n── Jake confirms the class (D-366: the bill owner, admins as backup)');
r = await call('POST', `/payment-run/bills/${unclassed}/class`, { bill_class: 'prodough_material' }, T['pr-jake']);
t('before he is named bill owner, Jake is refused', r.status === 403 && r.json?.code === 'not_bill_owner', JSON.stringify(r.json));
await call('PUT', '/payment-run/settings', { bill_owner_id: 'pr-jake' }, T['pr-boss']);
r = await call('POST', `/payment-run/bills/${unclassed}/class`, { bill_class: 'nonsense' }, T['pr-jake']);
t('an unknown class is refused', r.status === 400);
r = await call('POST', `/payment-run/bills/${unclassed}/class`, { bill_class: 'prodough_material' }, T['pr-jake']);
t('Jake confirms it', r.status === 200);
t('…stored with his name and an event', q('SELECT bill_class, bill_class_by FROM ap_drops WHERE id = ?', unclassed)[0]?.bill_class_by === 'Jay Buyer'
  && q("SELECT COUNT(*) n FROM ap_drop_events WHERE drop_id = ? AND kind = 'class_confirmed'", unclassed)[0].n === 1);
r = await call('GET', '/payment-run', null, T['pr-jake']);
t('…and the bill moves onto the run', (r.json?.on_run || []).some(l => l.id === unclassed));
t('a paid bill\'s class cannot be changed', (await call('POST', `/payment-run/bills/${dupe1}/class`, { bill_class: 'prodough_material' }, T['pr-jake'])).status === 409);

console.log('\n── settings, notices, the record');
r = await call('PUT', '/payment-run/settings', { bill_owner_id: 'pr-jake', notify_ids: ['pr-boss'] }, T['pr-jake']);
t('only an admin changes who is told', r.status === 403);
r = await call('PUT', '/payment-run/settings', { bill_owner_id: 'pr-jake', notify_ids: ['pr-boss'], controller_id: 'nobody-here' }, T['pr-boss']);
t('the admin sets the bill owner; an unknown account is dropped, never guessed', r.status === 200 && r.json?.bill_owner_id === 'pr-jake' && r.json?.controller_id === null);
const { sendFailureNotices } = await import('../server/payment-run.js');
const { getDb } = await import('../server/db.js');
const sent = [];
const deps = { botDm: (_d, uid) => ({ bot: { id: 'bot' }, dm: { id: `dm-${uid}` } }), postMessageAs: async (_d, dm, _b, body) => { sent.push({ to: dm.id, body }); }, pushToUser: () => Promise.resolve() };
const appDb = getDb();
let res = await sendFailureNotices(appDb, deps);
t('the failures are reported to the admin set and to the bill owner', res.bills >= 2 && sent.some(s => s.to === 'dm-pr-boss') && sent.some(s => s.to === 'dm-pr-jake'),
  JSON.stringify(res));
t('…naming the bill and the reason', sent.some(s => /Beta Packaging.*Nothing received/.test(s.body)));
sent.length = 0;
res = await sendFailureNotices(appDb, deps);
t('the same failure is reported once', res.bills === 0 && sent.length === 0);
r = await call('GET', '/payment-run', null, T['pr-boss']);
const thisWeek = r.json?.score?.at(-1);
t('the weekly score counts bills that failed a check in the week logged', thisWeek?.failed >= 2 && thisWeek.by_check?.received >= 1, JSON.stringify(thisWeek));
const mp = q("SELECT id FROM payment_must_pays WHERE vendor_name = 'CTLA'")[0];
t('taking a must-pay off needs a reason', (await call('POST', `/payment-run/must-pays/${mp.id}/retire`, {}, T['pr-boss'])).status === 400);
t('…with one it is retired, not deleted', (await call('POST', `/payment-run/must-pays/${mp.id}/retire`, { reason: 'test' }, T['pr-boss'])).status === 200
  && q('SELECT is_active FROM payment_must_pays WHERE id = ?', mp.id)[0]?.is_active === 0);
t('a must-pay row cannot be deleted at all', (() => { try { appDb.prepare('DELETE FROM payment_must_pays').run(); return false; } catch { return true; } })());

console.log('\n── the page');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const me = (await call('GET', '/users/me', null, T['pr-boss'])).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['pr-boss'], me]);
  await page.goto(`${URL}/?tab=payment-run`);
  await page.waitForSelector('[data-payment-run]', { timeout: 15000 }).catch(() => {});
  t(`${w}px: the page shows the run, the kept-off list and the must-pay list`, await page.locator('[data-run-on] [data-bill]').count() >= 3
    && await page.locator('[data-run-failed] [data-bill]').count() >= 2 && await page.locator('[data-must-pay-list]').count() === 1);
  t(`${w}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
