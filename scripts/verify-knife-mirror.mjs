// knife_accountability.status mirrors the sign-out log — executed against a
// live server through the three doors that skipped the sync.
//
// knife-state.js documents the failure: "a return recorded in the app closed
// the log record and left the master row saying issued forever -- an operator
// standing at the scanner could not sign out a knife physically on the rack."
// It was fixed on POST/PUT/DELETE and re-introduced through the self-return
// door on the Checked Out panel, bulk-delete and the CSV import.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4916;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
const mk = (tok) => (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('kn-op','Knife Operator','Knife Operator','admin','production',1,'SC-KN',datetime('now','+7 day'))`).run();
db.close();
const anon = mk(null);
await anon('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Knife Operator' }) });
await anon('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'kn-op', password: 'KnifePW2026!', setup_code: 'SC-KN' }) });
const tok = (await J(await anon('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Knife Operator', password: 'KnifePW2026!' }) })))?.token;
const me = mk(tok);
t('signed in', !!tok);

const master = () => { const d = new Database(process.env.DBPATH, { readonly: true });
  const r = d.prepare("SELECT status, data FROM qms_records WHERE record_type='knife_accountability' AND json_extract(data,'$.tool_id')='K-MIRROR'").get();
  d.close(); return r ? { status: r.status, issued_to: JSON.parse(r.data || '{}').issued_to || '' } : null; };
const signOut = () => me('/qms/knife_sign_out', { method: 'POST', body: JSON.stringify({ tool_id: 'K-MIRROR', employee_name: 'Knife Operator', condition_out: 'Good', time_out: '08:00', issued_by: 'QA' }) });

console.log('\nA knife on the master list, signed out');
{
  const r = await me('/qms/knife_accountability', { method: 'POST', body: JSON.stringify({ tool_id: 'K-MIRROR', description: 'Mirror test knife', location: 'Room 7' }) });
  t('the master row exists', r.ok && master()?.status === 'available', `got ${r.status} master=${JSON.stringify(master())}`);
  const so = await J(await signOut());
  t('sign-out is filed', !!so?.id);
  t('the master reads ISSUED to the operator', master()?.status === 'issued' && master()?.issued_to === 'Knife Operator', JSON.stringify(master()));
  globalThis.firstSignOut = so;
}

console.log('\nThe self-return door (the one the floor uses) moves the mirror');
{
  const r = await me(`/qms/mine/checked-out/${globalThis.firstSignOut.id}/return`, { method: 'POST', body: JSON.stringify({ condition: 'Good' }) });
  t('self-return is accepted', r.ok, `got ${r.status}`);
  t('THE MASTER READS AVAILABLE AGAIN', master()?.status === 'available' && master()?.issued_to === '', JSON.stringify(master()));
  // The symptom itself: with the mirror stuck on issued, the next sign-out was
  // refused at the scanner. It must succeed now.
  const again = await signOut();
  const b = await J(again);
  t('THE KNIFE CAN BE SIGNED OUT AGAIN', again.ok && !!b?.id, `got ${again.status} ${JSON.stringify(b || {}).slice(0, 80)}`);
  t('and the master reads issued once more', master()?.status === 'issued');
  globalThis.secondSignOut = b;
}

console.log('\nBulk-deleting an open sign-out frees the knife');
{
  const r = await me('/qms/knife_sign_out/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [globalThis.secondSignOut.id] }) });
  const b = await J(r);
  t('the open sign-out is deleted', r.ok && b?.deleted === 1, `got ${r.status} ${JSON.stringify(b || {})}`);
  t('and the master follows — available', master()?.status === 'available', JSON.stringify(master()));
}

console.log('\nA CSV import of history moves the mirror too');
{
  const csv = 'tool_id,employee_name,condition_out,time_out,issued_by\nK-MIRROR,Knife Operator,Good,09:00,QA\n';
  const r = await me('/qms/knife_sign_out/import', { method: 'POST', body: JSON.stringify({ csv }) });
  const b = await J(r);
  t('the import lands', r.ok, `got ${r.status} ${JSON.stringify(b || {}).slice(0, 100)}`);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const imported = d.prepare("SELECT status, data FROM qms_records WHERE record_type='knife_sign_out' ORDER BY rowid DESC LIMIT 1").get(); d.close();
  t('the imported row is an OPEN sign-out for this knife', imported?.status === 'out' && /K-MIRROR/.test(imported?.data || ''),
    `import=${JSON.stringify(b || {}).slice(0, 80)} row=${JSON.stringify(imported || {}).slice(0, 120)}`);
  t('an imported OPEN sign-out shows on the master', master()?.status === 'issued', JSON.stringify(master()));
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
