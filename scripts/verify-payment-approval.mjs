// verify:paymentapproval — the payment run, part B (D-361), live.
// A run is prepared (frozen), Lowry enters the bank balance and sends it, and
// Danny's link page shows what ProDough owes, lets him untick a bill (never a
// must-pay), approve once and say he has sent the money. The link is hashed,
// replaced by a re-send or the reminder, spent by the transfer, and dead on
// cancel. Runs, lines and the log cannot be deleted. Caller sets PORT + DBPATH.
// Control: main before this — /api/payment-approval is 404 and the run cannot be prepared.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5229);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PayRunB2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify(ma));
mk('pb-boss', 'Paula Boss', 'admin', 'admin', {});
mk('pb-jake', 'Jay Buyer', 'operator', 'warehouse', { 'ap-drop': 'edit' });
mk('pb-op', 'Otto Floor', 'operator', 'filling', { operator: 'view' });
let n = 0;
const drop = (o) => {
  const id = `pb-d${++n}`;
  db.prepare(`INSERT INTO ap_drops (id, filename, storage_key, content_sha256, status, qbo_bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, bill_to, po_or_co_ref, bill_class, created_at)
    VALUES (?, ?, 'k', ?, 'in_qbo', ?, ?, ?, ?, ?, ?, 'Powder Ops LLC', ?, ?, datetime('now'))`)
    .run(id, `${id}.pdf`, `sha-${id}`, `QB-B${n}`, o.vendor, o.inv, iso(-5), o.due ?? iso(2), o.amount, o.po || null, o.cls);
  return id;
};
const po = (num, vendor, qty, price) => {
  db.prepare("INSERT INTO purchase_orders (id, po_number, vendor, part_no, description, qty, unit_price, status) VALUES (?, ?, ?, 'RM-1', ?, ?, ?, 'open')")
    .run(`pb-po-${num}`, num, vendor, `${vendor} raw material`, qty, price);
  db.prepare("INSERT INTO receiving_log (id, inspection_no, date_received, po_number, part_number, quantity_received) VALUES (?, ?, ?, ?, 'RM-1', ?)")
    .run(`pb-rx-${num}`, `A-100-8${num.slice(-3)}`, iso(-2), num, qty);
};
po('PO00811', 'Gamma Whey', 100, 10);
po('PO00812', 'Theta Cocoa', 50, 10);
const mat1 = drop({ vendor: 'Gamma Whey', inv: 'G-1', amount: 1000, po: 'PO00811', cls: 'prodough_material' });
const mat2 = drop({ vendor: 'Theta Cocoa', inv: 'T-1', amount: 500, po: 'PO00812', cls: 'prodough_material' });
const lab = drop({ vendor: 'CTLA Labs', inv: 'L-9', amount: 640, cls: 'powderops_expense' });
const exp = drop({ vendor: 'Zeta Janitorial', inv: 'Z-1', amount: 300, cls: 'powderops_expense' });
db.close();

const call = async (m, p, b, tok, headers = {}) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...headers, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const T = {};
for (const [id, nm] of [['pb-boss', 'Paula Boss'], ['pb-jake', 'Jay Buyer'], ['pb-op', 'Otto Floor']]) T[id] = await login(id, nm);
t('everyone signs in', Object.values(T).every(Boolean));
t('the admin puts CTLA on the must-pay list', (await call('POST', '/payment-run/must-pays', { vendor_name: 'CTLA' }, T['pb-boss'])).status === 201);

console.log('\n── settings');
t('a bad approver number is refused', (await call('PUT', '/payment-run/settings', { approver_phone: '555-12' }, T['pb-boss'])).status === 400);
let r = await call('PUT', '/payment-run/settings', { approver_phone: '(801) 555-0199', materials_mode: 'weekly_at_cost' }, T['pb-boss']);
t('the approver number is stored as ten digits', r.status === 200 && r.json?.approver_phone === '8015550199', JSON.stringify(r.json));
t('an unknown materials-invoice mode is refused', (await call('PUT', '/payment-run/settings', { materials_mode: 'monthly' }, T['pb-boss'])).status === 400);

console.log('\n── preparing the run freezes it');
t('someone without the AP queue cannot prepare a run', (await call('POST', '/payment-run/runs', { kind: 'weekly' }, T['pb-op'])).status === 403);
t('an urgent run is the admin\'s', (await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [exp], reason: 'test' }, T['pb-jake'])).status === 403);
r = await call('POST', '/payment-run/runs', { kind: 'weekly' }, T['pb-jake']);
const run = r.json || {};
t('Jake prepares this week\'s run', r.status === 201 && run.status === 'draft' && run.lines?.length === 4, JSON.stringify(r.json)?.slice(0, 300));
t('…a second weekly run for the same week is refused', (await call('POST', '/payment-run/runs', { kind: 'weekly' }, T['pb-jake'])).status === 409);
t('…the must-pay is first and locked', run.lines?.[0]?.drop_id === lab && run.lines[0].must_pay === true);
t('…the qty × unit price travels with the line', run.lines?.find(l => l.drop_id === mat1)?.qty_text === '100 × $10.00', JSON.stringify(run.lines?.find(l => l.drop_id === mat1)));
r = await call('GET', '/payment-run', null, T['pb-jake']);
t('frozen bills leave the live list (they are the run\'s now)', !(r.json?.on_run || []).some(l => [mat1, mat2, lab, exp].includes(l.id)) && r.json?.runs?.[0]?.id === run.id);
const d2 = new Database(DBP); d2.prepare("UPDATE ap_drops SET amount = 9999 WHERE id = ?").run(mat1); d2.close();
t('correcting a bill afterwards does not move the frozen line', (await call('GET', `/payment-run/runs/${run.id}`, null, T['pb-jake'])).json?.lines?.find(l => l.drop_id === mat1)?.amount === 1000);
const d3 = new Database(DBP); d3.prepare("UPDATE ap_drops SET amount = 1000 WHERE id = ?").run(mat1); d3.close();

console.log('\n── Lowry enters the balance and sends it');
t('it cannot be sent before the bank balance is entered', (await call('POST', `/payment-run/runs/${run.id}/send`, {}, T['pb-boss'])).status === 400);
t('only an admin enters the balance', (await call('POST', `/payment-run/runs/${run.id}/bank-balance`, { amount: 500 }, T['pb-jake'])).status === 403);
r = await call('POST', `/payment-run/runs/${run.id}/bank-balance`, { amount: 500 }, T['pb-boss']);
const s1 = r.json?.summary || {};
t('ProDough owes = materials + shortfall (expenses less the balance)', s1.materials === 1500 && s1.expenses === 940 && s1.shortfall === 440 && s1.owes === 1940, JSON.stringify(s1));
t('…said in one sentence', /ProDough owes Powder Ops \$1,940\.00: materials \$1,500\.00 \+ shortfall \$440\.00\./.test(r.json?.sentence || ''), r.json?.sentence);
t('only an admin sends it', (await call('POST', `/payment-run/runs/${run.id}/send`, {}, T['pb-jake'])).status === 403);
r = await call('POST', `/payment-run/runs/${run.id}/send`, {}, T['pb-boss']);
const link1 = r.json?.link || '';
const tok1 = link1.split('/pay/')[1];
t('sent: with no texting set up, the link comes back to send by hand', r.status === 200 && !r.json.texted && /\/pay\/[A-Za-z0-9_-]{30,}$/.test(link1), JSON.stringify(r.json)?.slice(0, 200));
t('…the token is stored hashed, never in clear', q('SELECT token_hash FROM payment_runs WHERE id = ?', run.id)[0]?.token_hash?.length === 64
  && !q('SELECT * FROM payment_runs WHERE id = ?', run.id).some(row => JSON.stringify(row).includes(tok1)));
t('…Lowry is recorded as the reviewer', q('SELECT reviewed_by, status FROM payment_runs WHERE id = ?', run.id)[0]?.reviewed_by === 'Paula Boss');
t('a balance cannot change once sent', (await call('POST', `/payment-run/runs/${run.id}/bank-balance`, { amount: 0 }, T['pb-boss'])).status === 409);

console.log('\n── Danny\'s page');
t('a made-up link is refused', (await call('GET', '/payment-approval/not-a-real-link-at-all-xxxxxxxxxxxx')).status === 404);
r = await call('GET', `/payment-approval/${tok1}`, null, null, { 'User-Agent': 'DannyPhone/1.0' });
t('the link opens the run with no sign-in, ProDough owes first', r.status === 200 && r.json?.summary?.owes === 1940 && r.json.lines.length === 4);
t('…and shows the approver no log and no names from the plant', !('events' in (r.json || {})) && !('created_by' in (r.json || {})) && !('sent_to' in (r.json || {})));
t('…opening is logged with the device', q("SELECT device FROM payment_run_events WHERE run_id = ? AND kind = 'opened'", run.id).some(e => e.device === 'DannyPhone/1.0'));
const lineOf = (id) => r.json.lines.find(l => l.id === (run.lines.find(x => x.drop_id === id) || {}).id);
r = await call('POST', `/payment-approval/${tok1}/lines/${run.lines.find(x => x.drop_id === lab).id}`, { included: false, name: 'Danny A' });
t('a must-pay cannot be unticked', r.status === 409);
r = await call('POST', `/payment-approval/${tok1}/lines/${run.lines.find(x => x.drop_id === mat2).id}`, { included: false, name: 'Danny A' });
t('unticking a material bill takes it off the materials invoice too', r.status === 200 && r.json?.summary?.materials === 1000 && r.json.summary.owes === 1440, JSON.stringify(r.json?.summary));
t('…logged with his name', q("SELECT by_name FROM payment_run_events WHERE run_id = ? AND kind = 'unticked'", run.id)[0]?.by_name === 'Danny A');
t('approving needs a name', (await call('POST', `/payment-approval/${tok1}/approve`, {})).status === 400);
r = await call('POST', `/payment-approval/${tok1}/approve`, { name: 'Danny A' }, null, { 'User-Agent': 'DannyPhone/1.0' });
t('Danny approves', r.status === 200 && r.json?.status === 'approved');
t('…the ticked bills move to "in payment run" against this run', q("SELECT COUNT(*) n FROM ap_drops WHERE status = 'in_payment_run' AND payment_run_id = ?", run.id)[0].n === 3);
t('…the unticked bill stays in QuickBooks and is back on next week\'s live list', q('SELECT status FROM ap_drops WHERE id = ?', mat2)[0].status === 'in_qbo'
  && (await call('GET', '/payment-run', null, T['pb-jake'])).json?.on_run?.some(l => l.id === mat2));
t('…the totals approved are frozen with the decision', JSON.parse(q('SELECT approved_totals FROM payment_runs WHERE id = ?', run.id)[0].approved_totals).owes === 1440);
t('nothing can be unticked after approval', (await call('POST', `/payment-approval/${tok1}/lines/${run.lines.find(x => x.drop_id === exp).id}`, { included: false, name: 'Danny A' })).status === 409);
t('approving twice is refused', (await call('POST', `/payment-approval/${tok1}/approve`, { name: 'Danny A' })).status === 409);
await new Promise(res => setTimeout(res, 600));
t('Lowry is told it was approved', q("SELECT m.body FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.kind = 'dm' AND m.body LIKE '%approved by Danny A%'").length >= 1);
r = await call('POST', `/payment-approval/${tok1}/transferred`, { name: 'Danny A', amount: 1440 });
t('"I\'ve sent $1,440" is recorded and spends the link', r.status === 200 && r.json?.status === 'transferred'
  && (await call('GET', `/payment-approval/${tok1}`)).status === 404);

console.log('\n── kept for good');
const w = new Database(DBP);
const refuses = (sql) => { try { w.prepare(sql).run(); return false; } catch { return true; } };
t('a run cannot be deleted', refuses('DELETE FROM payment_runs'));
t('a run line cannot be deleted', refuses('DELETE FROM payment_run_lines'));
t('the log cannot be deleted or rewritten', refuses('DELETE FROM payment_run_events') && refuses("UPDATE payment_run_events SET by_name = 'x'"));
w.close();

console.log('\n── an urgent run, a re-send, the reminder, a cancel');
r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat2], reason: '' }, T['pb-boss']);
t('an urgent run needs a reason', r.status === 400);
r = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat2], reason: 'Supplier on hold' }, T['pb-boss']);
const urg = r.json || {};
t('the admin prepares an urgent run with the bill he picked', r.status === 201 && urg.kind === 'urgent' && urg.lines?.length === 1 && /-U$/.test(urg.run_no), urg.run_no);
await call('POST', `/payment-run/runs/${urg.id}/bank-balance`, { amount: 0 }, T['pb-boss']);
const tokA = (await call('POST', `/payment-run/runs/${urg.id}/send`, {}, T['pb-boss'])).json?.link?.split('/pay/')[1];
const tokB = (await call('POST', `/payment-run/runs/${urg.id}/send`, {}, T['pb-boss'])).json?.link?.split('/pay/')[1];
t('sending again kills the old link', (await call('GET', `/payment-approval/${tokA}`)).status === 404 && (await call('GET', `/payment-approval/${tokB}`)).status === 200);
const { sendReminders, prepareWeeklyRun } = await import('../server/payment-approval.js');
const { getDb } = await import('../server/db.js');
const appDb = getDb();
const sent = [];
const deps = { botDm: (_d, uid) => ({ bot: { id: 'bot' }, dm: { id: `dm-${uid}` } }), postMessageAs: async (_d, dm, _b, body) => { sent.push({ to: dm.id, body }); }, pushToUser: () => Promise.resolve() };
const fri = new Date(Date.parse(`${urg.week_start}T00:00:00Z`) + 4 * 86400000).toISOString().slice(0, 10);
let rem = await sendReminders(appDb, deps, { now: new Date(Date.now() + 86400000), wallDate: fri, wallTime: '09:59' });
t('no reminder before Friday 10 AM', rem.reminded === 0);
rem = await sendReminders(appDb, deps, { now: new Date(Date.now() + 86400000), wallDate: fri, wallTime: '10:00' });
t('at Friday 10 AM: one reminder, with a new link, and a note to Lowry', rem.reminded === 1 && (await call('GET', `/payment-approval/${tokB}`)).status === 404
  && sent.some(s => /is not approved yet/.test(s.body) && /\/pay\//.test(s.body)), JSON.stringify(rem));
rem = await sendReminders(appDb, deps, { now: new Date(Date.now() + 2 * 86400000), wallDate: fri, wallTime: '15:00' });
t('…only once per run', rem.reminded === 0);
t('a cancel needs a reason', (await call('POST', `/payment-run/runs/${urg.id}/cancel`, {}, T['pb-boss'])).status === 400);
r = await call('POST', `/payment-run/runs/${urg.id}/cancel`, { reason: 'Paid by card' }, T['pb-boss']);
t('cancelled: the bill is back on the live list', r.status === 200 && (await call('GET', '/payment-run', null, T['pb-jake'])).json?.on_run?.some(l => l.id === mat2));
sent.length = 0;
const prep = await prepareWeeklyRun(appDb, deps);
t('run day with this week already prepared: nothing frozen twice, Lowry told why', prep.frozen === false && sent.some(s => /already prepared/.test(s.body)), JSON.stringify(prep));

console.log('\n── the pages');
const pr2 = await call('POST', '/payment-run/runs', { kind: 'urgent', ids: [mat2], reason: 'Page check' }, T['pb-boss']);
await call('POST', `/payment-run/runs/${pr2.json.id}/bank-balance`, { amount: 0 }, T['pb-boss']);
const tokP = (await call('POST', `/payment-run/runs/${pr2.json.id}/send`, {}, T['pb-boss'])).json?.link?.split('/pay/')[1];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${URL}/pay/${tokP}`);
await phone.waitForSelector('[data-pay-page]', { timeout: 15000 }).catch(() => {});
t('390px: Danny\'s page shows what ProDough owes and the bill', (await phone.locator('[data-pay-owes]').textContent().catch(() => ''))?.includes('$500.00')
  && await phone.locator('[data-pay-line]').count() === 1);
t('390px: Approve waits for a name', await phone.locator('[data-pay-approve]').isDisabled());
await phone.fill('[data-pay-name]', 'Danny A');
await phone.click('[data-pay-approve]');
await phone.click('[data-pay-confirm]');
await phone.waitForSelector('[data-pay-transfer]', { timeout: 10000 }).catch(() => {});
t('390px: approving by tapping turns the page to "I\'ve sent"', await phone.locator('[data-pay-sent]').count() === 1);
t('390px: nothing pans sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await phone.close();
for (const [wd, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: wd, height: h } });
  const me = (await call('GET', '/users/me', null, T['pb-boss'])).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [T['pb-boss'], me]);
  await page.goto(`${URL}/?tab=payment-run`);
  await page.waitForSelector('[data-prepared-runs]', { timeout: 15000 }).catch(() => {});
  t(`${wd}px: the office page lists the prepared runs with their status`, await page.locator('[data-frozen-run]').count() >= 3
    && await page.locator('[data-run-status="transferred"]').count() >= 1);
  t(`${wd}px: nothing pans sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
