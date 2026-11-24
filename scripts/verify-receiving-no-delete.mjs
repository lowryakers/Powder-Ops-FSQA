// D-386: a receiving record is never hard-deleted, by anyone. DELETE
// /api/receiving/:id answers 403 RECEIVING_DELETE_DISABLED for every role and
// changes nothing: not the line, not its inspection, not the sign-off. Editing a
// line and revoking a sign-off with the password (the ways a wrong one is put
// right) still work.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5245;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('rn-a', 'NoDel Rcv Admin', 'admin', 'quality', null);
mkUser('rn-s', 'NoDel Rcv Super', 'supervisor', 'warehouse', JSON.stringify({ 'receiving-log': 'edit' }));
mkUser('rn-w', 'NoDel Rcv Loader', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'edit' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const tok = (await call('POST', '/users/login', { name, password: pw })).body?.token;
  return { ...H, Authorization: `Bearer ${tok}` };
};
const A = await login('rn-a', 'NoDel Rcv Admin', 'NoDelRcvAdmin2026!');
const S = await login('rn-s', 'NoDel Rcv Super', 'NoDelRcvSuper2026!');
const W = await login('rn-w', 'NoDel Rcv Loader', 'NoDelRcvLoader2026!');

// A signed inspection with a line on it, and a line on an unsigned one.
let r = await call('POST', '/receiving/checklist', { vendor: 'NoDel Vendor' }, W);
const NO = r.body?.inspection_no;
const { allItems } = await import('../server/receiving-checklist.js');
await call('POST', '/receiving/checklist', { inspection_no: NO, answers: Object.fromEntries(allItems().map(i => [i.key, 'na'])) }, W);
const L1 = (await call('POST', '/receiving', { inspection_no: NO, date_received: '2026-11-24', part_number: 'ND-1', part_description: 'Whey', quantity_received: 40, uom: 'bag' }, W)).body?.id;
r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'NoDelRcvLoader2026!' }, W);
t('an inspection is signed off with the password', r.status === 200 && !!r.body?.reviewed_at, `${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
const L2 = (await call('POST', '/receiving', { date_received: '2026-11-24', part_number: 'ND-2', part_description: 'Cocoa', quantity_received: 5, uom: 'bag' }, W)).body?.id;
t('a line on the signed inspection, and one on an unsigned inspection', !!L1 && !!L2);

const snap = () => JSON.stringify({
  l: db.prepare('SELECT * FROM receiving_log ORDER BY id').all(),
  c: db.prepare('SELECT * FROM receiving_checklists ORDER BY id').all(),
});
const before = snap();
const refused = (x) => x.status === 403 && x.body?.code === 'RECEIVING_DELETE_DISABLED';
for (const [who, h] of [['an admin', A], ['a warehouse supervisor with the edit grant', S], ['an operator with the edit grant', W]]) {
  r = await call('DELETE', `/receiving/${L1}`, undefined, h);
  t(`${who}: deleting the signed inspection's line is refused (403)`, refused(r), `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('DELETE', `/receiving/${L2}`, undefined, h);
  t(`${who}: deleting an unsigned line is refused (403)`, refused(r), `${r.status} ${JSON.stringify(r.body)}`);
}
r = await call('DELETE', '/receiving/no-such-id', undefined, A);
t('a line that does not exist gets the same refusal, never a 404', refused(r));
t('every line, inspection and sign-off is exactly as it was', snap() === before);
t('no delete audit entry was written', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'receiving_record' AND action LIKE '%delete%'").get().n === 0);

r = await call('PUT', `/receiving/${L2}`, { quantity_received: 6 }, W);
t('editing a line still works', r.status === 200 && r.body?.quantity_received === 6, `${r.status}`);
r = await call('DELETE', `/receiving/checklist/${NO}/review`, { signature_password: 'NoDelRcvLoader2026!' }, W);
t('revoking the sign-off with the password still works', r.status === 200, `${r.status}`);
r = await call('POST', `/receiving/checklist/${NO}/review`, { signature_password: 'NoDelRcvLoader2026!' }, W);
t('…and signing again', r.status === 200 && !!r.body?.reviewed_at, `${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
