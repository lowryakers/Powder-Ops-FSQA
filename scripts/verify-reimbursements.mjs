// Files a reimbursement the way the phone form does: multipart, custom_data as
// JSON TEXT (a multipart body carries only strings), a photo attached. The
// engine refused every such claim with "custom_data must be an object" until it
// learned to read the text. Caller sets PORT + DBPATH + the R2 stand-in.
const PORT = process.env.PORT || 4975; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d='') => { if (c) { pass++; console.log('  ✓ '+n); } else { fail++; console.log('  ✗ '+n+(d?' — '+d:'')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('rb-op','Van Driver','Van Driver','operator','warehouse',1,'SC-RB',datetime('now','+7 day'))`).run();
  db.prepare(`UPDATE users SET module_access = ? WHERE id = 'rb-op'`).run(JSON.stringify({ reimbursements: 'edit' }));
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b, tok) => fetch(`${URL}/api${p}`, { method: 'POST', headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
await post('/users/login', { name: 'Van Driver' });
await post('/users/set-password', { user_id: 'rb-op', password: 'Drive2026!', setup_code: 'SC-RB' });
const auth = await (await post('/users/login', { name: 'Van Driver', password: 'Drive2026!' })).json();
t('signed in', !!auth?.token);
const file = async (fields, withPhoto) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (withPhoto) fd.append('receipts', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'pump.png');
  const r = await fetch(`${URL}/api/reimbursements`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd });
  return { status: r.status, body: await r.json() };
};
const base = { amount: '85.55', spent_on: '2026-09-04', merchant: 'Maverick', category: 'Fuel', description: 'Filled up the Van', payment_method: 'Personal card' };
let r = await file({ ...base, custom_data: '{}' }, true);
t('a claim with a photo and no extra answers files (was: custom_data must be an object)', r.status === 201, JSON.stringify(r.body).slice(0, 120));
t('the photo is on the claim', r.body?.receipts?.length === 1 && r.body.receipts[0].filename === 'pump.png');
t('the amount and merchant landed', r.body?.amount === 85.55 && r.body?.merchant === 'Maverick');
r = await file({ ...base, custom_data: '{}' }, false);
t('a claim with no photo files too and reads as missing its receipt', r.status === 201 && (r.body?.receipts?.length || 0) === 0);
r = await file({ ...base, custom_data: '' }, false);
t('an empty custom_data string is "nothing", not an error', r.status === 201);
r = await file({ ...base, custom_data: 'not json' }, false);
t('unreadable custom_data is still refused in words', r.status === 400 && /custom_data/.test(r.body?.error || ''));
r = await file({ ...base, custom_data: '[1,2]' }, false);
t('an array is still refused', r.status === 400);
console.log(`\n${pass}/${pass+fail} assertions passed`); process.exit(fail ? 1 : 0);
