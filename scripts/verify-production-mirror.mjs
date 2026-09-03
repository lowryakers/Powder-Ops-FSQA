// production_entries scalars mirror mo_lines line 0 — executed live.
//
// AMENDABLE let a correction patch product/MO/lot/room/times/quantity directly
// on a multi-MO entry, and the mirror block deferred to the patch, so a
// QA-signed shift record could contradict its own lines. And room / the shift
// window were derived once at filing and never again.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4919;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('pm-adm','Mirror Admin','Mirror Admin','admin','qa',1,'SC-PM',datetime('now','+7 day'))`).run();
db.close();
await post('/users/login', { name: 'Mirror Admin' });
await post('/users/set-password', { user_id: 'pm-adm', password: 'MirrorPW2026!', setup_code: 'SC-PM' });
token = (await J(await post('/users/login', { name: 'Mirror Admin', password: 'MirrorPW2026!' })))?.token;
t('signed in', !!token);
const row = (id) => { const d = new Database(process.env.DBPATH, { readonly: true }); const r = d.prepare('SELECT * FROM production_entries WHERE id = ?').get(id); d.close(); return r; };
const today = new Date().toLocaleDateString('en-CA');
const REASON = 'correcting the line after review';

console.log('\nA Batching shift with two MOs');
const created = await J(await post('/production/entries', {
  date: today, team: 'Batching', people_count: 2, submitted_by: 'Bernardo',
  mo_lines: [
    { product_name: 'Vanilla Whey', mo_number: 'MO1', lot_number: 'L1', room: 'Batching 1', start_time: '08:00', end_time: '10:00', quantity: 100, batches: 1 },
    { product_name: 'Choc Whey', mo_number: 'MO2', lot_number: 'L2', room: 'Batching 2', start_time: '10:30', end_time: '12:00', quantity: 50, batches: 1 },
  ],
  cleaning_events: [{ level: 'Partial Clean', scope: ['Room'], room: 'Batching 1', start_time: '07:00', end_time: '07:45' }],
}));
t('filed', !!created?.id, JSON.stringify(created || {}).slice(0, 120));
const id = created?.id;
{
  const r = row(id);
  t('scalars mirror line 0 + the derived window', r?.product_name === 'Vanilla Whey' && r?.mo_number === 'MO1' && r?.room === 'Batching 1' && r?.start_time === '07:00' && r?.end_time === '12:00' && Number(r?.quantity_completed) === 150,
    JSON.stringify({ p: r?.product_name, mo: r?.mo_number, room: r?.room, s: r?.start_time, e: r?.end_time, q: r?.quantity_completed }));
}

console.log('\nA direct patch of a mirrored column is refused, and names the line');
{
  const r = await put(`/production/entries/${id}`, { product_name: 'Something Else', reason: REASON });
  const b = await J(r);
  t('PUT product_name on a multi-MO entry → 400', r.status === 400, `got ${r.status}`);
  t('...naming the field and the fix', /Product/.test(b?.error || '') && /line/i.test(b?.error || '') && (b?.mirrored || []).includes('product_name'), b?.error);
  t('nothing changed', row(id)?.product_name === 'Vanilla Whey');
  const r2 = await put(`/production/entries/${id}`, { room: 'Batching 2', reason: REASON });
  t('PUT room → 400 too', r2.status === 400, `got ${r2.status}`);
}

console.log('\nCorrecting the LINE moves the mirror, room and window with it');
{
  const r = await put(`/production/entries/${id}`, { reason: REASON, mo_lines: [
    { product_name: 'Vanilla Whey V2', mo_number: 'MO1', lot_number: 'L1', room: 'Batching 2', start_time: '09:00', end_time: '10:00', quantity: 100, batches: 1 },
    { product_name: 'Choc Whey', mo_number: 'MO2', lot_number: 'L2', room: 'Batching 2', start_time: '10:30', end_time: '13:00', quantity: 50, batches: 1 },
  ] });
  t('the line amend is accepted', r.ok, `got ${r.status} ${JSON.stringify(await J(r) || {}).slice(0, 100)}`);
  const x = row(id);
  t('product follows line 0', x?.product_name === 'Vanilla Whey V2', x?.product_name);
  t('ROOM FOLLOWS LINE 0', x?.room === 'Batching 2', `room=${x?.room}`);
  t('the window still starts at the earliest event (the clean, 07:00)', x?.start_time === '07:00', `start=${x?.start_time}`);
  t('and ends at the latest (13:00)', x?.end_time === '13:00', `end=${x?.end_time}`);
}

console.log('\nAn unrelated amend leaves the derived facts alone');
{
  const before = row(id);
  const r = await put(`/production/entries/${id}`, { notes: 'a note', reason: REASON });
  t('notes amend accepted', r.ok);
  const after = row(id);
  t('room / window / product untouched', after.room === before.room && after.start_time === before.start_time && after.end_time === before.end_time && after.product_name === before.product_name);
}

console.log('\nA single-MO entry keeps its scalars amendable');
{
  const s = await J(await post('/production/entries', { date: today, team: 'Kitting', room: '5', product_name: 'Single', mo_number: 'MO9', lot_number: 'L9',
    start_time: '08:00', end_time: '16:00', quantity_completed: 10, people_count: 1, submitted_by: 'K' }));
  t('filed', !!s?.id, JSON.stringify(s || {}).slice(0, 100));
  const r = await put(`/production/entries/${s?.id}`, { product_name: 'Single Corrected', reason: REASON });
  t('product_name amends directly when there are no lines', r.ok && row(s?.id)?.product_name === 'Single Corrected', `got ${r.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
