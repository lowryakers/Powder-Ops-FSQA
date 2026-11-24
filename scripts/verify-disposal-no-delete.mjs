// D-383: a disposal is never hard-deleted, by anyone. Both doors — the single
// DELETE and the bulk delete — answer 403 DISPOSAL_DELETE_DISABLED and change
// nothing: not the disposal, not its items, not its signed approval. Editing and
// revoking an approval (the ways a wrong disposal is put right) still work.
//
// Caller sets PORT + DBPATH on a FRESH database.
const PORT = process.env.PORT || 5243;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('dn-a', 'NoDel Admin', 'admin', 'quality', null);
mkUser('dn-q', 'NoDel Quality', 'supervisor', 'qa', JSON.stringify({ disposals: 'edit' }));
mkUser('dn-o', 'NoDel Operator', 'operator', 'warehouse', JSON.stringify({ disposals: 'edit' }));

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
const A = await login('dn-a', 'NoDel Admin', 'NoDelAdmin2026!');
const Q = await login('dn-q', 'NoDel Quality', 'NoDelQuality2026!');
const O = await login('dn-o', 'NoDel Operator', 'NoDelOperator2026!');

const file = async (n) => (await call('POST', '/disposals', { disposal_date: '2026-11-20', reason: 'Expired', witness: 'Wes',
  items: [{ item_name: `NoDel Whey ${n}`, item_number: `RM-ND-${n}`, lot_number: `ND-LOT-${n}`, quantity: '25 kg' }] }, Q)).body?.id;
const D1 = await file(1), D2 = await file(2);
t('two disposals are filed', !!D1 && !!D2);
let r = await call('POST', `/disposals/${D1}/approve`, { role: 'quality_control', signature_password: 'NoDelQuality2026!' }, Q);
t('one is approved with the password', r.status === 200, `${r.status}`);

const snap = () => JSON.stringify({
  d: db.prepare('SELECT * FROM disposals ORDER BY id').all(),
  i: db.prepare('SELECT * FROM disposal_items ORDER BY id').all(),
});
const before = snap();
const refused = (x) => x.status === 403 && x.body?.code === 'DISPOSAL_DELETE_DISABLED';

for (const [who, h] of [['an admin', A], ['a QA supervisor with the edit grant', Q], ['an operator with the edit grant', O]]) {
  r = await call('DELETE', `/disposals/${D1}`, undefined, h);
  t(`${who}: deleting a signed disposal is refused (403)`, refused(r), `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('DELETE', `/disposals/${D2}`, undefined, h);
  t(`${who}: deleting an unsigned disposal is refused (403)`, refused(r), `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('POST', '/disposals/bulk-delete', { ids: [D1, D2] }, h);
  t(`${who}: bulk delete is refused (403)`, refused(r), `${r.status} ${JSON.stringify(r.body)}`);
}
t('every disposal, item and approval is exactly as it was', snap() === before);
t('no disposal_deleted audit entry was written',
  db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE '%delete%' AND entity_type = 'disposal'").get().n === 0);

r = await call('GET', `/disposals/${D1}`, undefined, Q);
t('the signed disposal still reads, still signed', r.status === 200 && r.body?.approval_state?.quality_control === 'signed', JSON.stringify(r.body?.approval_state));
r = await call('DELETE', `/disposals/${D1}/approve/quality_control`, { signature_password: 'NoDelQuality2026!' }, Q);
t('revoking an approval with the password still works', r.status === 200, `${r.status}`);
r = await call('PUT', `/disposals/${D2}`, { reason: 'Expired — corrected' }, Q);
t('editing a disposal still works', r.status === 200 && r.body?.reason === 'Expired — corrected', `${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
