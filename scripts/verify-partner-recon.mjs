// verify:partnerrecon — D-203. Partner Reconciliation: what a settlement was
// made of, the same on the partner's link, no open copy of a settled document,
// due dates on final documents, the credit as a ledger, and void/delete kept
// person-only.
//
// Live against a fresh server (verify-all sets PORT and DBPATH, and the S3
// stand-in for the import). Seeds the August settlement as it really was —
// I123 9,642.92 + I124 17,234.57 manufacturing, I125 2,672.12 + I126 1,032.90
// materials, M4's 1537 77,080.00 + 1543 1,200.00 — against a $200,000
// manufacturing credit, settles it, and asserts the numbers the office and M4
// both have to be able to read.
//
// Control: `main` before the change — the settlement detail carries no
// `how_cleared`, so the first "how cleared" assertion fails and the re-import of
// a settled number under another spelling creates a copy.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5123;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('pr-admin', 'Recon Admin', 'admin', 'admin', null);
mk('pr-office', 'Recon Office', 'supervisor', 'office', { 'partner-reconciliation': 'edit' });
mk('pr-floor', 'Recon Floor', 'operator', 'warehouse', { 'partner-reconciliation': 'edit' });
mk('pr-bot', 'Recon Bot', 'operator', 'office', { 'partner-reconciliation': 'edit' });
db.prepare(`INSERT OR IGNORE INTO partner_accounts (id, name, terms_days) VALUES ('pr-m4', 'A1 Partner Dynamics', 30)`).run();
const PID = 'pr-m4';

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'PartnerRecon!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'PartnerRecon!!1' })).body?.token;
};
const admin = await signIn('Recon Admin', 'pr-admin');
const office = await signIn('Recon Office', 'pr-office');
const floor = await signIn('Recon Floor', 'pr-floor');
t('sessions', !!admin && !!office && !!floor);
const bot = (await json('POST', '/api-tokens', { user_id: 'pr-bot', label: 'recon test bot', scopes: ['read', 'write'] }, admin)).body?.plaintext;
t('a write token for a non-admin account (temp database only)', !!bot);

const r2 = (n) => Math.round(n * 100) / 100;
const add = async (doc) => {
  const r = await json('POST', `/partners/${PID}/documents`, { issued_date: '2026-07-01', terms_days: 30, doc_type: 'invoice', ...doc }, office);
  return r.body?.[0]?.id;
};
const fin = (id) => json('POST', `/partners/documents/${id}/finalize`, {}, office);

console.log('\n── the August settlement ──');
let r = await json('POST', `/partners/${PID}/credits`, { amount: 200000, applies_to: 'manufacturing', direction: 'receivable', label: 'Manufacturing credit' }, office);
t('a $200,000 manufacturing credit', r.status === 201, String(r.status));
const ids = {};
for (const [n, dir, amt, cat] of [
  ['I123', 'receivable', 9642.92, 'manufacturing'], ['I124', 'receivable', 17234.57, 'manufacturing'],
  ['I125', 'receivable', 2672.12, 'materials'], ['I126', 'receivable', 1032.90, 'materials'],
  ['1537', 'payable', 77080.00, 'manufacturing'], ['1543', 'payable', 1200.00, 'materials'],
]) {
  ids[n] = await add({ doc_number: n, direction: dir, amount: amt, category: cat });
  await fin(ids[n]);
}
t('six documents filed and final', Object.values(ids).every(Boolean));
const rec = (await json('GET', `/partners/${PID}/reconcile?as_of=2026-08-31`, null, office)).body;
t('the balance before settling is the real one: credit draws 26,877.49', rec?.credit?.drawn_this_period === 26877.49, String(rec?.credit?.drawn_this_period));
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-08-31', expected_net: rec.credit.net_amount, payment_reference: 'ACH 0918' }, office);
const sid = r.body?.id;
t('settled: $74,574.98 to the partner', r.status === 201 && r.body.net_amount === -74574.98 && r.body.owed_to === 'them', JSON.stringify(r.body));

console.log('\n── (a) the settlement opened ──');
const det = (await json('GET', `/partners/settlements/${sid}`, null, office)).body;
const how = Object.fromEntries((det?.documents || []).map(d => [d.doc_number, d]));
t('all six documents are in it', det?.documents?.length === 6, String(det?.documents?.length));
t('I123 9,642.92 CREDITED', how.I123?.how_cleared === 'credited' && how.I123.credited_amount === 9642.92 && how.I123.remainder === 0, JSON.stringify(how.I123 && { h: how.I123.how_cleared, c: how.I123.credited_amount }));
t('I124 17,234.57 CREDITED', how.I124?.how_cleared === 'credited' && how.I124.credited_amount === 17234.57);
t('I125 2,672.12 and I126 1,032.90 NETTED', how.I125?.how_cleared === 'netted' && how.I126?.how_cleared === 'netted' && how.I125.signed === 2672.12 && how.I126.signed === 1032.9);
t('1537 77,080.00 and 1543 1,200.00 PAID', how['1537']?.how_cleared === 'paid' && how['1543']?.how_cleared === 'paid' && how['1537'].signed === 77080);
t('the math: 30,582.51 − 26,877.49 = 3,705.02, against 78,280.00', det.math.receivable === 30582.51 && det.credit.drawn_this_period === 26877.49 && det.credit.side_net_after_credit === 3705.02 && det.math.payable === 78280, JSON.stringify({ m: det.math, c: det.credit }));
t('…net paid 74,574.98 (78,280.00 − 3,705.02)', det.math.net_after_credit === -74574.98 && r2(78280 - det.credit.side_net_after_credit) === 74574.98);
t('credit 200,000.00 before → 173,122.51 after', det.credit.balance_before === 200000 && det.credit.balance_after === 173122.51, JSON.stringify(det.credit));
t('each document carries its lines and file name fields', 'line_items' in how.I123 && 'filename' in how.I123 && 'category' in how.I123);
t('the payment reference travels with it', det.settlement.payment_reference === 'ACH 0918');

console.log('\n── (b) the partner\'s link ──');
const ptok = (await json('POST', `/partners/${PID}/portal-tokens`, { label: 'pr link' }, office)).body?.token;
const portal = (await json('GET', `/partner-portal/${ptok}`)).body;
const pst = portal?.settlements?.find(s => s.period_end === '2026-08-31');
const phow = Object.fromEntries((pst?.documents || []).map(d => [d.doc_number, d]));
t('the link lists the six August documents under that settlement', pst?.documents?.length === 6, String(pst?.documents?.length));
t('…in their words: I123 covered by the credit, I125 netted, 1537 paid to you', phow.I123?.how_cleared === 'covered_by_credit' && phow.I125?.how_cleared === 'netted' && phow['1537']?.how_cleared === 'paid_to_you');
t('…their side: what they owed is "you_owe"', phow.I123?.side === 'you_owe' && phow['1537']?.side === 'you_are_owed');
t('…the credit 200,000 → 173,122.51 on their side too', pst.credit?.balance_before === 200000 && pst.credit?.balance_after === 173122.51 && pst.credit?.applied === 26877.49);
const leaks = JSON.stringify(portal);
t('no storage key, extracted text, creator or internal fields reach the link', !/storage_key|extracted_text|created_by|finalized_by|updated_by|parsed_amount/.test(leaks));
t('the link carries the credit as a ledger', portal.credit_ledger?.groups?.[0]?.total === 26877.49 && portal.credit_ledger.remaining === 173122.51);
const other = db.prepare(`INSERT OR IGNORE INTO partner_accounts (id, name, terms_days) VALUES ('pr-other', 'ZZ Other Co', 30)`).run();
void other;
db.prepare(`INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status, issued_date, due_date, terms_days)
  VALUES ('pr-other-doc', 'pr-other', 'receivable', 'invoice', 'X1', 10, 'final', '2026-07-01', '2026-07-31', 30)`).run();
r = await json('GET', `/partner-portal/${ptok}/documents/pr-other-doc/file`);
t('the token stays scoped to its partner (another account\'s document is 404)', r.status === 404, String(r.status));

console.log('\n── (c) no open copy of a settled document ──');
r = await json('POST', `/partners/${PID}/documents`, { doc_number: 'INV-I123', direction: 'receivable', amount: 9642.92, issued_date: '2026-10-12' }, office);
t('filing "INV-I123" again is REFUSED 409, naming the settlement', r.status === 409 && /already settled 2026-08-31/.test(r.body?.error || '') && r.body?.settlement_id === sid, JSON.stringify(r.body));
r = await json('POST', `/partners/${PID}/documents`, { doc_number: 'i123', direction: 'receivable', amount: 1.00, allow_duplicate: true }, office);
t('…a different amount and allow_duplicate do not get past it', r.status === 409);
r = await json('POST', `/partners/${PID}/documents`, { doc_number: 'I123', direction: 'payable', amount: 50 }, office);
t('…the same number the OTHER way is a different document', r.status === 201);

const pdf = () => new Blob([Buffer.from('%PDF-1.4\n%fake\n')], { type: 'application/pdf' });
const importRows = async (rows, auth) => {
  const fd = new FormData();
  for (let i = 0; i < rows.length; i++) fd.append('files', pdf(), `I${i}.pdf`);
  fd.append('rows', JSON.stringify(rows));
  const res = await fetch(`${BASE}/api/partners/${PID}/documents/import`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
};
r = await importRows([{ direction: 'receivable', doc_number: 'I123', amount: 9642.92, allow_duplicate: true }], office);
t('re-importing I123 is skipped "already settled 2026-08-31", even with allow_duplicate', r.status === 201 && r.body?.created?.length === 0 && /already settled 2026-08-31/.test(r.body?.skipped?.[0]?.reason || ''), JSON.stringify(r.body));

const d1589 = await add({ doc_number: '1589', direction: 'receivable', amount: 500, category: 'materials' });
r = await importRows([{ direction: 'receivable', doc_number: 'INV-1589', amount: 500 }], office);
t('"INV-1589" is recognised as "1589" and skipped', r.body?.created?.length === 0 && /1589/.test(r.body?.skipped?.[0]?.reason || ''), JSON.stringify(r.body?.skipped));
r = await importRows([{ direction: 'receivable', doc_number: '#1589', amount: 600 }], office);
t('…a different amount is still flagged, worded as such', r.body?.created?.length === 0 && /different amount/i.test(r.body?.skipped?.[0]?.reason || ''), JSON.stringify(r.body?.skipped));
r = await importRows([{ direction: 'receivable', doc_number: '1589', amount: 500, allow_duplicate: true }], bot);
t('a TOKEN cannot override a duplicate with allow_duplicate', r.body?.created?.length === 0, JSON.stringify(r.body));
r = await importRows([{ direction: 'receivable', doc_number: '1589', amount: 500, allow_duplicate: true }], office);
t('a PERSON may, and the override is in the audit trail', r.body?.created?.length === 1
  && db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'partner_document' AND details LIKE '%\"allow_duplicate\":true%'").get().c === 1);
void d1589;

// The 12 Oct copies, as they exist on the live ledger: written straight in,
// since no door will create them any more.
const copy = (id, n, amt, cat) => db.prepare(`INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status, category, issued_date, terms_days, due_date, source)
  VALUES (?, ?, 'receivable', 'invoice', ?, ?, 'final', ?, '2026-08-05', 30, '2026-09-04', 'import')`).run(id, PID, n, amt, cat);
copy('pr-c123', 'I123', 9642.92, 'manufacturing'); copy('pr-c124', 'I124', 17234.57, 'manufacturing');
copy('pr-c125', 'I125', 2672.12, 'materials'); copy('pr-c126', 'I126', 1032.90, 'materials');
let docs = (await json('GET', `/partners/${PID}/documents?unsettled=1`, null, office)).body;
t('the office banner lists the four copies', (docs.settled_twins || []).map(x => x.doc_number).sort().join() === 'I123,I124,I125,I126', JSON.stringify(docs.settled_twins?.map(x => x.doc_number)));
t('…each names the settlement it duplicates', docs.settled_twins.every(x => x.twin.period_end === '2026-08-31' && x.twin.settlement_id === sid));
t('…and the floor is not shown it', !('settled_twins' in (await json('GET', `/partners/${PID}/documents?unsettled=1`, null, floor)).body));
let live = (await json('GET', `/partners/${PID}/reconcile?as_of=2026-12-31`, null, office)).body;
t('while they stand, the copies draw the credit a second time', live.credit.draws.some(d => d.document_id === 'pr-c123'));
for (const c of ['pr-c123', 'pr-c124', 'pr-c125', 'pr-c126']) await json('POST', `/partners/documents/${c}/void`, {}, office);
docs = (await json('GET', `/partners/${PID}/documents?unsettled=1`, null, office)).body;
t('voided by a person, the banner clears itself', (docs.settled_twins || []).length === 0);
live = (await json('GET', `/partners/${PID}/reconcile?as_of=2026-12-31`, null, office)).body;
t('…and the credit no longer draws on them', !live.credit.draws.some(d => ['pr-c123', 'pr-c124'].includes(d.document_id)));
const settledList = (await json('GET', `/partners/${PID}/documents?settled=1`, null, office)).body;
t('"Show settled" lists the settled documents with their period', settledList.documents.length === 6 && settledList.documents.every(d => d.settled_period === '2026-08-31'));

console.log('\n── (d) dates on an unsettled final document ──');
db.prepare(`INSERT INTO partner_documents (id, partner_id, direction, doc_type, doc_number, amount, status, issued_date, terms_days, due_date, source)
  VALUES ('pr-i136', ?, 'receivable', 'invoice', 'I136', 1051.92, 'final', '2026-09-24', 30, '2026-05-26', 'ap-drop')`).run(PID);
r = await json('PUT', '/partners/documents/pr-i136/dates', { due_date: '2026-10-24' }, office);
t('the office sets I136\'s due date to 2026-10-24', r.status === 200 && r.body?.due_date === '2026-10-24' && r.body.amount === 1051.92, JSON.stringify(r.body));
t('…audited with before and after', /"due_date":"2026-05-26"/.test(db.prepare("SELECT details FROM audit_log WHERE entity_id = 'pr-i136' ORDER BY rowid DESC LIMIT 1").get()?.details || ''));
r = await json('PUT', '/partners/documents/pr-i136/dates', { due_date: '2026-05-26' }, office);
t('a due date before the issue date is refused (the I136 mistake)', r.status === 400);
r = await json('PUT', '/partners/documents/pr-i136/dates', { amount: 1, direction: 'payable', due_date: '2026-10-25' }, office);
const i136 = db.prepare("SELECT amount, direction FROM partner_documents WHERE id = 'pr-i136'").get();
t('…only the dates move — an amount or direction in the body is ignored', r.status === 200 && i136.amount === 1051.92 && i136.direction === 'receivable');
r = await json('PUT', `/partners/documents/${ids.I125}/dates`, { due_date: '2026-10-24' }, office);
t('a SETTLED document refuses with 400', r.status === 400);
r = await json('PUT', '/partners/documents/pr-i136/dates', { due_date: '2026-10-24' }, floor);
t('the floor cannot (403)', r.status === 403);
r = await json('PUT', '/partners/documents/pr-i136/dates', { due_date: '2026-10-24' }, bot);
t('a token cannot (403)', r.status === 403, String(r.status));

console.log('\n── (e) the credit as a ledger ──');
const credit = (await json('GET', `/partners/${PID}/credits`, null, office)).body[0];
const ledger = (await json('GET', `/partners/credits/${credit.id}/ledger`, null, office)).body;
const appsTotal = db.prepare('SELECT ROUND(SUM(amount), 2) t FROM partner_credit_applications WHERE credit_id = ?').get(credit.id).t;
t('200,000.00 → August draws 26,877.49 → 173,122.51', ledger.facility === 200000 && ledger.groups.length === 1 && ledger.groups[0].total === 26877.49 && ledger.remaining === 173122.51, JSON.stringify(ledger));
t('the ledger sums to the draw rows', ledger.applied_to_date === appsTotal);
t('…and its balance is the opening the live credit starts from', live.credit.opening_balance === ledger.remaining);
t('the August group names I123 and I124', ledger.groups[0].draws.map(d => d.doc_number).sort().join() === 'I123,I124');

console.log('\n── (f) void and delete stay person-only ──');
const open = await add({ doc_number: 'TV1', direction: 'receivable', amount: 10 });
r = await json('POST', `/partners/documents/${open}/void`, {}, bot);
t('a token POST to /void is 403 token_denied', r.status === 403 && /token_denied/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
r = await json('DELETE', `/partners/documents/${open}`, null, bot);
t('a token DELETE is 403 token_denied', r.status === 403 && /token_denied/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
r = await json('DELETE', `/partners/documents/${ids.I123}`, null, admin);
t('an admin deleting a SETTLED document is 400', r.status === 400);
r = await json('POST', `/partners/documents/${ids.I123}/void`, {}, office);
t('voiding a settled document is 400', r.status === 400);

console.log('\n── D-205: September — the documents a person chooses ──');
// The plant's real September: materials I128 I131 I132 I136 I137 owed by M4,
// manufacturing I135 I138 I139 I140 against the credit, M4's bills 1589/1590
// issued 9/7 and due 10/7. I136 is already on the ledger (the dates check above).
const sep = {};
for (const [n, dir, amt, cat, issued] of [
  ['I128', 'receivable', 5379.17, 'materials', '2026-08-25'], ['I131', 'receivable', 4577.10, 'materials', '2026-09-05'],
  ['I132', 'receivable', 49.65, 'materials', '2026-09-10'], ['I137', 'receivable', 7336.87, 'materials', '2026-09-26'],
  ['I135', 'receivable', 29009.64, 'manufacturing', '2026-09-02'], ['I138', 'receivable', 29009.64, 'manufacturing', '2026-09-12'],
  ['I139', 'receivable', 29009.64, 'manufacturing', '2026-09-19'], ['I140', 'receivable', 29009.64, 'manufacturing', '2026-09-28'],
  ['1589', 'payable', 33053.67, 'manufacturing', '2026-09-07'], ['1590', 'payable', 33053.67, 'manufacturing', '2026-09-07'],
]) {
  sep[n] = await add({ doc_number: n, direction: dir, amount: amt, category: cat, issued_date: issued, terms_days: 30 });
  await fin(sep[n]);
}
db.prepare("UPDATE partner_documents SET category = 'materials' WHERE id = 'pr-i136'").run();
sep.I136 = 'pr-i136';
t('the September documents are filed and final', Object.values(sep).every(Boolean));
let due = (await json('GET', `/partners/${PID}/reconcile?as_of=2026-09-30&basis=due`, null, office)).body;
t('basis=due as at 9/30 is I128 only: M4 owes 5,379.17', due.credit?.net_amount === 5379.17 && due.basis === 'due', JSON.stringify({ n: due.credit?.net_amount, r: due.receivable_total }));
t('…the rest read "not due"', due.documents.excluded.filter(d => d.exclusion === 'not_due').length >= 10);
let iss = (await json('GET', `/partners/${PID}/reconcile?as_of=2026-09-30&basis=issued`, null, office)).body;
t('basis=issued as at 9/30 includes 1589/1590: we owe M4 47,712.63', iss.credit?.net_amount === -47712.63 && iss.basis === 'issued', JSON.stringify({ n: iss.credit?.net_amount, r: iss.receivable_total, p: iss.payable_total }));
t('…and the partner link reads the same number on the same basis', (await json('GET', `/partner-portal/${ptok}?basis=issued&as_of=2026-09-30`)).body?.amount_due === 47712.63);
const chosen = ['I128', 'I131', 'I132', 'I136', 'I137', 'I135', 'I138', 'I139', 'I140'].map(n => sep[n]);
const pv = (await json('POST', `/partners/${PID}/settle/preview`, { as_of: '2026-09-30', document_ids: chosen }, office)).body;
t('the preview of the nine: M4 owes 18,394.71, credit draws 116,038.56', pv.credit?.net_amount === 18394.71 && pv.credit?.drawn_this_period === 116038.56, JSON.stringify(pv.credit && { n: pv.credit.net_amount, d: pv.credit.drawn_this_period }));
t('…the credit draws only on the ticked manufacturing documents', pv.credit.draws.length === 4 && pv.credit.draws.every(d => ['I135', 'I138', 'I139', 'I140'].includes(d.doc_number)));
t('…credit 173,122.51 before → 57,083.95 after', pv.credit.opening_balance === 173122.51 && pv.credit.remaining_balance === 57083.95);
t('…and the preview wrote nothing', db.prepare('SELECT COUNT(*) c FROM partner_settlements').get().c === 1);
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-09-30', document_ids: [...chosen, ids.I125], expected_net: 18394.71 }, office);
t('a settled document among the chosen is refused (400), naming it', r.status === 400 && /I125 \(already settled\)/.test(r.body?.error || ''), JSON.stringify(r.body));
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-09-30', document_ids: [...chosen, 'pr-c123'], expected_net: 18394.71 }, office);
t('a void document among the chosen is refused (400)', r.status === 400 && /void/.test(r.body?.error || ''));
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-09-30', document_ids: chosen, expected_net: 18000 }, office);
t('a stale expected_net is refused (409)', r.status === 409);
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-09-30', document_ids: chosen, expected_net: 18394.71 }, bot);
t('a bot token cannot settle (403)', r.status === 403 && db.prepare('SELECT COUNT(*) c FROM partner_settlements').get().c === 1, JSON.stringify(r.body));
r = await json('POST', `/partners/${PID}/settle`, { as_of: '2026-09-30', document_ids: chosen, expected_net: 18394.71, payment_reference: 'ACH 1015' }, office);
const sid2 = r.body?.id;
t('settled: M4 pays 18,394.71 for the nine', r.status === 201 && r.body.net_amount === 18394.71 && r.body.owed_to === 'us' && r.body.document_count === 9, JSON.stringify(r.body));
t('…recorded as chosen documents', r.body?.basis === 'selected');
t('…exactly the nine are stamped', db.prepare('SELECT COUNT(*) c FROM partner_documents WHERE settlement_id = ?').get(sid2).c === 9);
t('…1589 and 1590 stay open for October', db.prepare('SELECT COUNT(*) c FROM partner_documents WHERE id IN (?, ?) AND settlement_id IS NULL').get(sep['1589'], sep['1590']).c === 2);
const led2 = (await json('GET', `/partners/credits/${credit.id}/ledger`, null, office)).body;
t('…the credit ledger reads 173,122.51 → 57,083.95 for September', led2.groups.length === 2 && led2.groups[1].before === 173122.51 && led2.groups[1].after === 57083.95 && led2.remaining === 57083.95, JSON.stringify(led2.groups.map(g => [g.before, g.after])));
const audit2 = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE entity_type = 'partner_settlement' AND entity_id = ?").get(sid2)?.details || '{}');
t('…the audit names the basis and the nine ids', audit2.basis === 'selected' && audit2.document_ids?.length === 9);
const det2 = (await json('GET', `/partners/settlements/${sid2}`, null, office)).body;
t('the settled detail shows the nine, four credited', det2.documents.length === 9 && det2.documents.filter(d => d.how_cleared === 'credited').length === 4 && det2.settlement.basis === 'selected');
const aug = (await json('GET', `/partners/settlements/${sid}`, null, office)).body;
t('the August settlement (no document_ids) still holds its six and reads "due"', aug.settlement.basis === 'due' && aug.documents.length === 6 && aug.credit.balance_after === 173122.51);

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${BASE}/manifest.webmanifest`);
const me = (await json('GET', '/users/me', null, office)).body;
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [office, me]);
await page.goto(`${BASE}/?tab=partner-reconciliation`);
await page.waitForTimeout(1500);
const settledTab = page.getByRole('tab', { name: /Settled/ }).first();
if (await settledTab.count()) await settledTab.click();
await page.locator(`[data-settlement-row="${sid}"]`).click().catch(() => {});
await page.waitForSelector(`[data-settlement-detail="${sid}"]`, { timeout: 8000 }).catch(() => {});
const detailText = await page.locator(`[data-settlement-detail="${sid}"]`).innerText().catch(() => '');
if (!detailText && process.env.PR_DEBUG) console.log((await page.locator('body').innerText()).slice(0, 1500));
t('the Settled row opens to its six documents', (await page.locator(`[data-settlement-detail="${sid}"] [data-settled-doc]`).count()) === 6, detailText.slice(0, 200));
t('…with Credited / Netted / Paid chips', (await page.locator('[data-how="credited"]').count()) === 2 && (await page.locator('[data-how="netted"]').count()) === 2 && (await page.locator('[data-how="paid"]').count()) === 2);
t('…the credit 200,000 → 173,122.51', /\$200,000\.00 before this settlement → \$173,122\.51 after/.test(detailText));
t('…and the math line reads 3,705.02', /\$3,705\.02/.test(detailText) && /\$74,574\.98/.test(detailText));

await page.getByRole('tab', { name: /balance/i }).first().click().catch(() => {});
await page.locator('[data-basis-opt="issued"]').click().catch(() => {});
await page.waitForTimeout(800);
await page.locator('[data-choose-open]').click().catch(() => {});
await page.waitForSelector('[data-choose-docs]', { timeout: 8000 }).catch(() => {});
t('the Balance tab has "Choose documents" listing 1589 and 1590 to tick', (await page.locator('[data-choose-row="1589"]').count()) === 1 && (await page.locator('[data-choose-row="1590"]').count()) === 1);
await page.waitForSelector('[data-choose-who]', { timeout: 8000 }).catch(() => {});
t('…and the selected total shows before Mark PAID', /\$/.test(await page.locator('[data-choose-who]').innerText().catch(() => '')) && /Mark PAID — \$/.test(await page.locator('[data-choose-settle]').innerText().catch(() => '')));
const ppage = await browser.newPage({ viewport: { width: 390, height: 900 } });
await ppage.goto(`${BASE}/partner/${ptok}`);
await ppage.waitForSelector('[data-portal-settlement="2026-08-31"]', { timeout: 8000 }).catch(() => {});
await ppage.locator('[data-portal-settlement="2026-08-31"] button').first().click().catch(() => {});
t('the partner page says "Already settled 2026-08-31" and opens to six documents',
  /Already settled 2026-08-31/.test(await ppage.locator('[data-portal-settlement="2026-08-31"]').innerText().catch(() => ''))
  && (await ppage.locator('[data-portal-settled-doc]').count()) === 6);
t('…with "Covered by the credit" on I123 and I124', (await ppage.locator('[data-portal-how="covered_by_credit"]').count()) === 2);
const overflow = await ppage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
t('…no sideways scroll at 390px', !overflow);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
