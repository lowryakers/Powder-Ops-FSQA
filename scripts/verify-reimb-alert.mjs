// verify:reimbalert — D-254, live. A reimbursement claim OVER $100 messages the
// office through ReadyBot the moment it is filed, so a large one can be paid before
// payroll. Asserts: $85 and exactly $100 send nothing; $150 reaches an admin and an
// office supervisor, not the filer and not a warehouse supervisor; a second edit
// of that claim sends nothing more; a $50 claim edited to $120 alerts then; the
// list flags the claim (`large`, `large_over`); the ReadyBot messages screen lists
// the audience and a chosen list narrows it.
//
// Caller sets PORT + DBPATH (the server is already up).
// Control: remove the two `alertLargeClaim` calls from api/reimbursements.js — no
// DM is ever sent and the delivery assertions fail.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5147;
const B = `http://localhost:${PORT}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, id, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ra-admin', 'Alert Admin', 'admin', 'admin', null);
mk('ra-office', 'Alert Office', 'supervisor', 'office', { reimbursements: 'edit' });
mk('ra-ware', 'Alert Warehouse', 'supervisor', 'warehouse', { reimbursements: 'edit' });
mk('ra-filer', 'Alert Filer', 'operator', 'warehouse', { reimbursements: 'edit' });

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const signIn = async (id) => {
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return (await J(await c('POST', '/users/login', { name: id, password: 'Passw0rd!!' })))?.token;
};
const admin = await signIn('ra-admin');
const office = await signIn('ra-office');
const filer = await signIn('ra-filer');
t('three people sign in', !!admin && !!office && !!filer);

const file = async (amount, tk = filer, extra = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ amount: String(amount), spent_on: '2026-10-20', merchant: 'Harbor Freight', category: 'Equipment', description: 'Pallet jack wheels', custom_data: '{}', ...extra })) fd.append(k, v);
  const r = await fetch(`${B}/reimbursements`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body: fd });
  return { status: r.status, body: await J(r) };
};
// ReadyBot DMs to a person carrying the alert.
const alerts = (uid) => db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
  JOIN chat_channel_members cm ON cm.channel_id = ch.id AND cm.user_id = ?
  WHERE ch.kind = 'dm' AND m.body LIKE '%Reimbursement over%'`).all(uid);
const settle = () => new Promise(r => setTimeout(r, 600));

console.log('── under the line ──');
let r = await file(85);
t('an $85 claim files', r.status === 201, JSON.stringify(r.body).slice(0, 120));
t('…and is not flagged', r.body?.large === false);
r = await file(100);
t('exactly $100 is not over $100', r.status === 201 && r.body?.large === false);
await settle();
t('neither sends anything', alerts('ra-admin').length === 0 && alerts('ra-office').length === 0);

console.log('\n── over the line ──');
r = await file(150);
const big = r.body;
t('a $150 claim files and is flagged', r.status === 201 && big?.large === true);
await settle();
t('the admin gets a ReadyBot message', alerts('ra-admin').length === 1, String(alerts('ra-admin').length));
t('…and so does the office supervisor', alerts('ra-office').length === 1);
const msg = alerts('ra-office')[0]?.body || '';
t('…naming who, how much, where, and what to do', /Alert Filer/.test(msg) && /\$150\.00/.test(msg) && /Harbor Freight/.test(msg)
  && /before payroll/.test(msg) && /\?tab=reimbursements/.test(msg), msg);
t('a warehouse supervisor is not told', alerts('ra-ware').length === 0);
t('the filer is not told about their own claim', alerts('ra-filer').length === 0);
const row = db.prepare('SELECT large_alert_at, large_alert_to FROM reimbursements WHERE id = ?').get(big?.id);
t('the claim records when and to whom', !!row?.large_alert_at && JSON.parse(row.large_alert_to || '[]').includes('Alert Office'));

r = await c('PUT', `/reimbursements/${big.id}`, { amount: 175, category: 'Equipment', merchant: 'Harbor Freight' }, filer);
await settle();
t('editing it again sends nothing more', r.status === 200 && alerts('ra-office').length === 1);

console.log('\n── raised over the line by an edit ──');
r = await file(50);
const small = r.body;
r = await c('PUT', `/reimbursements/${small.id}`, { amount: 120, category: 'Equipment', merchant: 'Home Depot' }, filer);
await settle();
t('a $50 claim edited to $120 alerts then', r.status === 200 && alerts('ra-office').length === 2 && /Home Depot/.test(alerts('ra-office')[1]?.body || ''));

console.log('\n── the office filing for somebody ──');
r = await file(300, office, { user_id: 'ra-filer' });
await settle();
t('the office supervisor is not told about a claim they keyed in for somebody else', r.status === 201 && r.body?.person === 'Alert Filer' && alerts('ra-office').length === 2);
t('…the admin is', alerts('ra-admin').length === 3);

console.log('\n── the list and Settings ──');
const list = await J(await c('GET', '/reimbursements', null, admin));
t('the list carries the line and the flag', list?.large_over === 100
  && list.reimbursements.find(x => x.id === big.id)?.large === true
  && list.reimbursements.find(x => Number(x.amount) === 85)?.large === false);
let aud = await J(await c('GET', '/flash/readybot-audience', null, admin));
let entry = aud?.audiences?.find(a => a.key === 'large_reimbursements');
t('ReadyBot messages lists the alert with its default audience', entry?.setting === 'reimbursement_alert_recipients' && entry?.source === 'default'
  && entry.recipients.some(u => u.id === 'ra-office') && !entry.recipients.some(u => u.id === 'ra-ware'));
aud = await J(await c('PUT', '/flash/readybot-audience/reimbursement_alert_recipients', { ids: ['ra-office'] }, admin));
entry = aud?.audiences?.find(a => a.key === 'large_reimbursements');
t('choosing one person narrows it', entry?.source === 'setting' && entry.recipients.length === 1 && entry.recipients[0].id === 'ra-office');
await file(200);
await settle();
t('…and the next alert goes to that person only', alerts('ra-office').length === 3 && alerts('ra-admin').length === 3);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
